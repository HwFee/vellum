use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

pub(crate) const MAX_FILE_SIZE_BYTES: u64 = 50 * 1024 * 1024;
/// 临时文件名后缀：原子写先写同目录临时文件再 rename 覆盖原文件。
const SAVE_TEMP_SUFFIX: &str = ".vellum-tmp";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocument {
    pub path: String,
    pub file_name: String,
    pub parent_path: String,
    pub markdown: String,
}

/// `save_document` 的返回契约（严格 camelCase）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub path: String,
    pub bytes_written: usize,
}

/// Result of resolving an asset source: either a local file to inline, or a
/// remote/data URL the webview can load directly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AssetRef {
    Local(PathBuf),
    Remote(String),
}

fn is_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext = ext.to_ascii_lowercase();
            ext == "md" || ext == "markdown"
        })
        .unwrap_or(false)
}

fn mime_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("ico") => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn check_file_size(path: &Path) -> Result<(), String> {
    let size = std::fs::metadata(path)
        .map_err(|error| format!("Cannot read file metadata: {error}"))?
        .len();
    if size > MAX_FILE_SIZE_BYTES {
        return Err(format!("file too large: {size} bytes (max 50 MB)"));
    }
    Ok(())
}

pub fn load_markdown_file(path: &Path) -> Result<LoadedDocument, String> {
    let canonical =
        dunce::canonicalize(path).map_err(|error| format!("Cannot open file: {error}"))?;

    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }

    if !is_markdown_extension(&canonical) {
        return Err(format!("Not a Markdown file: {}", canonical.display()));
    }

    check_file_size(&canonical)?;

    let markdown = std::fs::read_to_string(&canonical)
        .map_err(|error| format!("Cannot read UTF-8 Markdown: {error}"))?;

    let file_name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_string();

    let parent_path = canonical
        .parent()
        .map(|parent| parent.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(LoadedDocument {
        path: canonical.to_string_lossy().to_string(),
        file_name,
        parent_path,
        markdown,
    })
}

/// Resolve an asset source against the directory that anchors local paths
/// (the loaded document's parent directory). `http:`, `https:` and `data:`
/// sources are classified as `Remote`; everything else must stay inside the
/// anchor directory.
pub fn resolve_local_asset_path(anchor_dir: &Path, asset_src: &str) -> Result<AssetRef, String> {
    if asset_src.starts_with("http://")
        || asset_src.starts_with("https://")
        || asset_src.starts_with("data:")
    {
        return Ok(AssetRef::Remote(asset_src.to_string()));
    }

    let decoded = urlencoding::decode(asset_src)
        .map_err(|error| format!("Invalid asset URL: {error}"))?
        .replace('\\', "/");

    let asset_path = PathBuf::from(decoded);

    let candidate = if asset_path.is_absolute() {
        asset_path
    } else {
        anchor_dir.join(asset_path)
    };

    let canonical_candidate =
        dunce::canonicalize(candidate).map_err(|error| format!("Cannot resolve asset: {error}"))?;

    let canonical_anchor_dir = dunce::canonicalize(anchor_dir)
        .map_err(|error| format!("Cannot canonicalize anchor directory: {error}"))?;

    if !canonical_candidate.starts_with(&canonical_anchor_dir) {
        return Err(format!(
            "Asset path escapes the Markdown directory: {}",
            canonical_candidate.display()
        ));
    }

    Ok(AssetRef::Local(canonical_candidate))
}

/// 原文件的主导换行风格：出现 CRLF 即按 CRLF 处理，否则 LF。
fn dominant_eol(existing: &str) -> &'static str {
    if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// 把入参统一成 LF 再套用目标换行风格 —— 前端 textarea 会把 CRLF 归一成 LF，
/// 若不还原，一次提交就把整篇文档的换行符翻新。Rust 侧是本功能唯一的 CRLF 还原点。
fn apply_eol(content: &str, eol: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    if eol == "\r\n" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    }
}

/// 纯函数：草稿写盘前的双闸门（服务端兜底，与前端门禁互为冗余）。
/// - 闸门 1（当前文档）：只允许写「已加载文档」这一个 canonical 路径
/// - 闸门 2（mdlog）：记录进行中拒绝写入，前端门禁被绕过时的第二道防线
pub fn check_save_gates(
    current: Option<&Path>,
    target: &Path,
    mdlog_active: bool,
) -> Result<(), String> {
    match current {
        Some(expected) if expected == target => {}
        _ => return Err("Only the currently loaded document can be saved".to_string()),
    }

    if mdlog_active {
        return Err("mdlog 记录中：断开连接后才能修改".to_string());
    }

    Ok(())
}

/// 原子写入 Markdown：同目录临时文件 + rename 覆盖，保持原文件的 EOL 风格。
/// 调用方（`save_document` 命令）负责闸门判定；本函数只做格式与体积校验后落盘。
pub fn save_markdown_file(path: &Path, content: &str) -> Result<SaveOutcome, String> {
    let canonical =
        dunce::canonicalize(path).map_err(|error| format!("Cannot open file: {error}"))?;

    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }

    if !is_markdown_extension(&canonical) {
        return Err(format!("Not a Markdown file: {}", canonical.display()));
    }

    if content.len() as u64 > MAX_FILE_SIZE_BYTES {
        return Err(format!(
            "content too large: {} bytes (max {} bytes)",
            content.len(),
            MAX_FILE_SIZE_BYTES
        ));
    }

    // 读不出旧内容（例如非 UTF-8）时按 LF 处理：宁可保持用户输入的换行，也不臆造 CRLF。
    let existing = std::fs::read_to_string(&canonical).unwrap_or_default();
    let payload = apply_eol(content, dominant_eol(&existing));

    let file_name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Cannot resolve file name".to_string())?;
    let temp_path = canonical.with_file_name(format!(".{file_name}{SAVE_TEMP_SUFFIX}"));

    if let Err(error) = std::fs::write(&temp_path, payload.as_bytes()) {
        // 防御性清理：写临时文件失败（磁盘满等）时不留下半截文件。
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Cannot write temporary file: {error}"));
    }

    if let Err(error) = std::fs::rename(&temp_path, &canonical) {
        // 防御性清理：rename 失败（目标被占用等）时回退到原文件状态。
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Cannot replace document: {error}"));
    }

    Ok(SaveOutcome {
        path: canonical.to_string_lossy().to_string(),
        bytes_written: payload.len(),
    })
}

pub fn resolve_asset_to_data_url(anchor_dir: &Path, asset_src: &str) -> Result<String, String> {
    match resolve_local_asset_path(anchor_dir, asset_src)? {
        AssetRef::Remote(url) => Ok(url),
        AssetRef::Local(path) => {
            check_file_size(&path)?;
            let bytes =
                std::fs::read(&path).map_err(|error| format!("Cannot read asset: {error}"))?;
            let mime = mime_type_for_path(&path);
            let encoded = STANDARD.encode(&bytes);
            Ok(format!("data:{mime};base64,{encoded}"))
        }
    }
}
