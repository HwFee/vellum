use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

use crate::state::LibraryMarker;

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
    /// 本次打开判定出的库（None = 单文件模式）：打开时定死、随文档原子换代。
    /// 前端据此决定侧栏形态与库命令是否可发，不自行向上探测。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub library: Option<crate::state::LibraryRef>,
    /// 文档内 wikilink 目标的解析表（打开时一次算好随文档返回，字段恒序列化——
    /// 前端以存在性判「是否已在打开时解析」，缺席才退回第二次 resolve_wikilinks IPC）。
    /// 空表 = 无 wikilink 或解析全落空；命中路径同步进 preview_allow（悬停预览白名单）。
    pub wikilinks: std::collections::HashMap<String, Option<String>>,
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
        library: None,
        wikilinks: std::collections::HashMap::new(),
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

/// 纯函数：同目录临时文件路径（`.<name>.<uuid 前 8 位>.vellum-tmp`）。
/// 唯一后缀是必需的：`save_document` 是 async 命令，Tauri 可并发轮询两次 invoke，
/// 固定临时名会让两次保存交错写同一文件（产出混合内容），或让后到者 rename 时找不到源文件。
pub(crate) fn save_temp_path(canonical: &Path) -> Result<PathBuf, String> {
    let file_name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Cannot resolve file name".to_string())?;
    let unique = uuid::Uuid::new_v4().simple().to_string();

    Ok(canonical.with_file_name(format!(".{file_name}.{}{SAVE_TEMP_SUFFIX}", &unique[..8])))
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

    // 读不出旧内容时**拒绝保存**，不得降级为 LF：把「读失败」与「空文件」混为一谈，
    // 一次保存就把 CRLF 文档整篇翻新（且 rename 只需 DELETE 权限，读失败时仍可能成功）。
    let existing = std::fs::read_to_string(&canonical)
        .map_err(|error| format!("Cannot read existing document: {error}"))?;
    let payload = apply_eol(content, dominant_eol(&existing));

    let temp_path = save_temp_path(&canonical)?;

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

/// 库根标记目录：`.vellum` 优先、其次 `.obsidian`（同级都在时 `.vellum` 赢）。
/// Obsidian 库只读兼容：`.obsidian` 只用来判定库根，一个字节都不往里写。
const VELLUM_MARKER_DIR: &str = ".vellum";
const OBSIDIAN_MARKER_DIR: &str = ".obsidian";

/// 向上搜索的深度上限：从「起始目录 = 第 1 级」起最多检查 8 级。
/// 库根判定（find_library_root）与 wikilink 祖先解析（resolve_by_ancestors）
/// 共用这一个常量与同一条 walk_ancestors——两处深度语义必须逐字一致，
/// 否则会出现「模式判定说不是库、链接解析却找到了库」的自相矛盾。
/// 8 级是 UNC 场景下网络往返次数的暴露面上限（每级至多 2 次 is_dir）。
pub const ANCESTOR_WALK_MAX_DEPTH: usize = 8;

/// 库索引遍历的硬上限（防御病态目录树把命令挂住）。
const VAULT_WALK_MAX_DEPTH: usize = 12;
const VAULT_WALK_MAX_ENTRIES: usize = 50_000;

/// 用户主目录：向上搜索的语义停止点——越过主目录的祖先（盘符根、共享根）
/// 不可能是「用户的库」，继续向上只是白白多碰几级文件系统。
/// 判定时先 canonicalize：junction / symlink 展开后再比（比对双方都已是 canonical）。
fn home_dir() -> Option<PathBuf> {
    dirs::home_dir().and_then(|home| dunce::canonicalize(home).ok())
}

/// `current` 是否是早停边界：文件系统根（parent 为 None）或用户主目录。
fn is_walk_boundary(current: &Path, home: Option<&Path>) -> bool {
    current.parent().is_none() || home.is_some_and(|home| current == home)
}

/// 向上遍历的唯一实现：从 `start`（第 1 级）起逐级向上，至多 8 级，
/// 遇用户主目录 / 盘符根 / UNC 根即在「该级仍经 visit 判定后」停下。
/// 返回 visit 首个回 Some 时的产物；全程只读检查，无副作用。
fn walk_ancestors<T>(
    start: &Path,
    home: Option<&Path>,
    visit: impl for<'a> Fn(&'a Path) -> Option<T>,
) -> Option<T> {
    let mut current = Some(start.to_path_buf());
    let mut depth = 0usize;

    while let Some(dir) = current {
        depth += 1;
        if depth > ANCESTOR_WALK_MAX_DEPTH {
            return None;
        }
        if let Some(found) = visit(&dir) {
            return Some(found);
        }
        if is_walk_boundary(&dir, home) {
            return None;
        }
        current = dir.parent().map(Path::to_path_buf);
    }

    None
}

/// 目录里命中的库标记：`.vellum` 与 `.obsidian` 同级都在时 `.vellum` 赢。
/// 显式打开文件夹进库模式时也用它记 marker（显式库可以恰好带标记目录）。
pub fn marker_at(dir: &Path) -> Option<LibraryMarker> {
    if dir.join(VELLUM_MARKER_DIR).is_dir() {
        Some(LibraryMarker::Vellum)
    } else if dir.join(OBSIDIAN_MARKER_DIR).is_dir() {
        Some(LibraryMarker::Obsidian)
    } else {
        None
    }
}

/// 向上找库根：从 `from_dir`（第 1 级）起最多 8 级，命中 `.vellum` / `.obsidian`
/// 目录的最近祖先即库根；同级两标记都在时 `.vellum` 赢。
/// 遇用户主目录或盘符根 / UNC 根即判「不是库」（该级仍会先经 marker 判定——
/// 主目录本身带标记时它仍是库根，只是不再向上越过）。
/// 每级至多 2 次 `is_dir()`；`parent()` 是纯字面操作，junction / symlink 不成环。
pub fn find_library_root(from_dir: &Path) -> Option<(PathBuf, LibraryMarker)> {
    let home = home_dir();
    walk_ancestors(from_dir, home.as_deref(), |dir| {
        marker_at(dir).map(|marker| (dir.to_path_buf(), marker))
    })
}

/// wikilink 目标是否可以作为相对路径使用。
///
/// 拒绝：空、绝对路径（`/x`、`C:\x`、`\\server\share`）、含 `..` 段的路径、含 NUL 等
/// 控制字符的文本。本命令只做只读存在性检查，但目标来自文档内容，仍按不可信输入处理——
/// 少一个 `..` 就等于多一条「顺着链接走出库外」的读路径。
fn is_resolvable_target(target: &str) -> bool {
    if target.is_empty() || target.chars().any(|c| c.is_control()) {
        return false;
    }

    let path = Path::new(target);
    if path.is_absolute() {
        return false;
    }

    // Windows 上 `C:foo` 这类「有前缀但非绝对」的写法同样拒绝（前缀组件）
    !path.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::Prefix(_)
                | std::path::Component::RootDir
        )
    })
}

/// 目标在一个目录下的候选文件名：已带 `.md` / `.markdown` 的按原样，否则依次补两个扩展名。
fn target_candidates(dir: &Path, target: &str) -> [Option<PathBuf>; 2] {
    let lower = target.to_ascii_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        let direct = dir.join(target);
        return [Some(direct), None];
    }
    [Some(dir.join(format!("{target}.md"))), Some(dir.join(format!("{target}.markdown")))]
}

/// 祖先目录逐级向上找目标文件（先按原样，再补 `.md` / `.markdown`）。
/// 与 find_library_root 同一条 walk_ancestors：8 级帽、主目录 / 盘根早停逐字一致。
/// 大小写交给文件系统（Windows 不区分大小写，不做手工折叠）。只读检查，返回 canonical 路径。
fn resolve_by_ancestors(from_dir: &Path, target: &str) -> Option<PathBuf> {
    let home = home_dir();
    walk_ancestors(from_dir, home.as_deref(), |dir| {
        target_candidates(dir, target)
            .into_iter()
            .flatten()
            .find_map(|candidate| {
                dunce::canonicalize(&candidate)
                    .ok()
                    .filter(|canonical| canonical.is_file())
            })
    })
}

/// 全库 basename 索引：`<去扩展名的小写 basename>` → 命中文件。
/// 打开时只在文档确有 wikilink 目标才建：目录打开的清单可直接折叠，否则按库根扫一次。
pub type BasenameIndex = HashMap<String, Vec<PathBuf>>;

/// 递归遍历库根（跳过点目录与 node_modules、限深限项），返回全部 Markdown 文件的
/// `(绝对路径, 相对库根的 '/' 分隔路径)`，按 rel 排序；条目预算耗尽时 truncated=true。
/// basename 索引（wikilink 解析兜底）与库面板三命令共用这一份遍历规则。
pub fn collect_markdown_files(root: &Path) -> (Vec<(PathBuf, String)>, bool) {
    let mut files: Vec<(PathBuf, String)> = Vec::new();
    let mut budget = VAULT_WALK_MAX_ENTRIES;
    collect_dir(root, root, 0, &mut budget, &mut files);
    files.sort_by(|left, right| left.1.cmp(&right.1));
    (files, budget == 0)
}

fn collect_dir(
    dir: &Path,
    root: &Path,
    depth: usize,
    budget: &mut usize,
    out: &mut Vec<(PathBuf, String)>,
) {
    if depth > VAULT_WALK_MAX_DEPTH {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return, // 读不了的目录不是错误：索引少一部分，结果退化成空集
    };

    for entry in entries.flatten() {
        if *budget == 0 {
            return;
        }
        *budget -= 1;

        let Ok(file_type) = entry.file_type() else { continue };
        let name = entry.file_name().to_string_lossy().to_string();

        if file_type.is_dir() {
            if name.starts_with('.') || name == "node_modules" {
                continue;
            }
            collect_dir(&entry.path(), root, depth + 1, budget, out);
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        if let Some(stem) = markdown_stem(&name) {
            if !stem.is_empty() {
                let rel = entry
                    .path()
                    .strip_prefix(root)
                    .map(|p| {
                        p.components()
                            .map(|c| c.as_os_str().to_string_lossy().to_string())
                            .collect::<Vec<_>>()
                            .join("/")
                    })
                    .unwrap_or_default();
                out.push((entry.path(), rel));
            }
        }
    }
}

pub fn basename_index_from_files(files: &[(PathBuf, String)]) -> BasenameIndex {
    let mut index: BasenameIndex = HashMap::new();
    for (path, _rel) in files {
        let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
            continue;
        };
        if let Some(stem) = markdown_stem(&name) {
            if !stem.is_empty() {
                index
                    .entry(stem.to_ascii_lowercase())
                    .or_default()
                    .push(path.clone());
            }
        }
    }
    index
}

/// 递归遍历库根（跳过点目录与 node_modules、限深限项），建一次索引供本次调用的
/// 全部目标共用——逐个目标重扫整库会让一篇 160 处链接的笔记扫 160 遍。
pub fn build_basename_index(root: &Path) -> BasenameIndex {
    let (files, _truncated) = collect_markdown_files(root);
    basename_index_from_files(&files)
}

/// 文件名去掉 `.md` / `.markdown` 后的主名；不是 Markdown 文件返回 None。
pub fn markdown_stem(name: &str) -> Option<&str> {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".markdown") {
        return Some(&name[..name.len() - ".markdown".len()]);
    }
    if lower.ends_with(".md") {
        return Some(&name[..name.len() - ".md".len()]);
    }
    None
}

/// 唯一 basename 兜底。命中多个时取「路径组件最少」的那个，同长再按路径字典序——
/// 结果与目录遍历顺序无关（确定性优先于「猜哪个更像」）。CJK 不受 ASCII 折叠影响。
fn resolve_by_basename(index: &BasenameIndex, target: &str) -> Option<PathBuf> {
    let basename = Path::new(target)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())?;
    let matches = index.get(&basename.to_ascii_lowercase())?;

    matches
        .iter()
        .min_by(|left, right| {
            let left_components = left.components().count();
            let right_components = right.components().count();
            left_components
                .cmp(&right_components)
                .then_with(|| left.to_string_lossy().cmp(&right.to_string_lossy()))
        })
        .map(|path| dunce::canonicalize(path).unwrap_or_else(|_| path.clone()))
}

/// 解析一篇文档里的全部 wikilink 目标（纯函数，无副作用，只做只读存在性检查）：
/// 1. 目标不合法（空 / 绝对 / 含 `..` / 含控制字符）→ None
/// 2. 从文档所在目录逐级向上找（与模式判定同一条 8 级 / 主目录边界）
/// 3. 仍找不到时，在向上命中 `.vellum` / `.obsidian` 的库根内按**唯一 basename** 兜底
///
/// 返回表按**调用方传入的原字符串**键控（渲染层按 `data-wikilink` 原样查表）。
/// `vault_index` 由调用方预建（`build_basename_index`）——多次解析共用一份索引，
/// 避免同一库被反复遍历（打开时一次解析与后续 resolve_wikilinks 各扫一遍）。
/// None = 单文件模式：无 basename 兜底，只剩祖先逐级向上找。
pub fn resolve_wikilink_map(
    from_path: &Path,
    targets: &[String],
    vault_index: Option<&BasenameIndex>,
) -> HashMap<String, Option<String>> {
    let from_dir = from_path.parent().map(Path::to_path_buf);

    let mut resolved: HashMap<String, Option<String>> = HashMap::new();

    for target in targets {
        let path = if !is_resolvable_target(target) {
            None
        } else {
            from_dir
                .as_deref()
                .and_then(|dir| resolve_by_ancestors(dir, target))
                .or_else(|| {
                    vault_index.and_then(|index| resolve_by_basename(index, target))
                })
        };

        resolved.insert(
            target.clone(),
            path.map(|path| path.to_string_lossy().to_string()),
        );
    }

    resolved
}

/// 打开时顺带把 wikilink 解析表算出来：随文档一并返回，
/// 不再让前端等第二次 IPC 才见链接。
/// `index` 由调用方预建——`resolve_open_target` 只在文档确有目标时建一次
/// （目录清单折叠或按库根另扫），打开与解析共用一份数据，不重复扫库。
pub fn resolve_wikilinks_for_document(
    from_path: &Path,
    targets: &[String],
    index: Option<&BasenameIndex>,
) -> HashMap<String, Option<String>> {
    resolve_wikilink_map(from_path, targets, index)
}

pub fn extract_wikilink_targets(markdown: &str) -> Vec<String> {
    let masked = mask_code(markdown);
    let mut seen = std::collections::HashSet::new();
    let mut targets = Vec::new();
    for inner in wikilink_inners(&masked) {
        let target = wikilink_target(inner);
        if target.is_empty() || !seen.insert(target.clone()) {
            continue;
        }
        targets.push(target);
    }
    targets
}

fn wikilink_inners(text: &str) -> Vec<&str> {
    let bytes = text.as_bytes();
    let len = bytes.len();
    let mut inners = Vec::new();
    let mut search = 0usize;

    while search + 1 < len {
        if bytes[search] != b'[' || bytes[search + 1] != b'[' {
            search += 1;
            continue;
        }
        let inner_start = search + 2;
        let mut cursor = inner_start;
        let mut matched = false;
        while cursor < len {
            match bytes[cursor] {
                b'[' | b'\n' => break,
                b']' => {
                    if cursor + 1 < len
                        && bytes[cursor + 1] == b']'
                        && cursor > inner_start
                    {
                        inners.push(&text[inner_start..cursor]);
                        matched = true;
                    }
                    break;
                }
                _ => cursor += 1,
            }
        }
        search = if matched { cursor + 2 } else { search + 1 };
    }

    inners
}

fn wikilink_target(inner: &str) -> String {
    let inner = inner.trim_matches(is_js_space);
    let head = inner.split('|').next().unwrap_or("");
    let target = head.split('#').next().unwrap_or("").trim_matches(is_js_space);
    markdown_stem(target).unwrap_or(target).to_string()
}

fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

fn fence_marker(line: &str) -> Option<u8> {
    let mut rest = line;
    let mut skipped = 0usize;
    for c in line.chars() {
        if skipped < 3 && is_js_space(c) {
            skipped += 1;
            rest = &rest[c.len_utf8()..];
        } else {
            break;
        }
    }
    let marker = *rest.as_bytes().first()?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    if rest.as_bytes().iter().take_while(|b| **b == marker).count() >= 3 {
        Some(marker)
    } else {
        None
    }
}

fn mask_code(markdown: &str) -> String {
    let mut fence: Option<u8> = None;
    markdown
        .split('\n')
        .map(|line| {
            if let Some(marker) = fence_marker(line) {
                match fence {
                    None => fence = Some(marker),
                    Some(current) if current == marker => fence = None,
                    _ => {}
                }
                return String::new();
            }
            if fence.is_some() {
                return String::new();
            }
            mask_inline_code(line)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn mask_inline_code(line: &str) -> String {
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut index = 0usize;

    while index < line.len() {
        if bytes[index] != b'`' {
            let c = line[index..].chars().next().unwrap();
            out.push(c);
            index += c.len_utf8();
            continue;
        }
        let mut run = 0usize;
        while index + run < line.len() && bytes[index + run] == b'`' {
            run += 1;
        }
        let needle = vec![b'`'; run];
        let Some(offset) = find_subslice(&bytes[index + run..], &needle) else {
            out.push_str(&line[index..]);
            break;
        };
        let close = index + run + offset;
        out.extend(std::iter::repeat_n(' ', close + run - index));
        index = close + run;
    }

    out
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// `read_note_preview` 的返回契约（严格 camelCase）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePreview {
    pub path: String,
    pub file_name: String,
    pub markdown: String,
    pub truncated: bool,
}

/// 悬停预览单篇笔记的读取上限：64 KiB 足够填满预览卡（卡片只展示开头几屏）。
const NOTE_PREVIEW_MAX_BYTES: u64 = 64 * 1024;

/// 读一篇已解析 wikilink 笔记的开头部分供悬停预览。
///
/// 三道闸门：dunce 规范化后必须在 `allow` 白名单内（`resolve_wikilinks` 写进
/// `AppState.preview_allow` 的 canonical 路径）、必须是 Markdown 扩展名、必须是普通文件。
/// 读至多 64 KiB；截断点回退到最后一个合法 UTF-8 边界，避免半截多字节字符出乱码。
/// `truncated` 告知前端「还有下文」。
pub fn read_note_preview_file(
    path: &Path,
    allow: &std::collections::HashSet<PathBuf>,
) -> Result<NotePreview, String> {
    let canonical = dunce::canonicalize(path)
        .map_err(|error| format!("Cannot open file: {error}"))?;
    if !allow.contains(&canonical) {
        return Err("note is not in the preview allowlist".to_string());
    }
    if !is_markdown_extension(&canonical) {
        return Err("not a markdown file".to_string());
    }
    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| format!("Cannot stat file: {error}"))?;
    if !metadata.is_file() {
        return Err("not a file".to_string());
    }
    let file_len = metadata.len();
    let file = std::fs::File::open(&canonical)
        .map_err(|error| format!("Cannot open file: {error}"))?;
    let mut bytes = Vec::new();
    file.take(NOTE_PREVIEW_MAX_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Cannot read file: {error}"))?;
    let bytes_read = bytes.len() as u64;
    let markdown = match std::str::from_utf8(&bytes) {
        Ok(text) => text.to_owned(),
        Err(error) => String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned(),
    };
    Ok(NotePreview {
        path: canonical.to_string_lossy().to_string(),
        file_name: canonical
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        markdown,
        truncated: file_len > bytes_read,
    })
}
