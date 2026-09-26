//! 库面板三命令的纯逻辑：文件列表 / 全库检索 / 反向链接。
//!
//! 「库根」= 距当前文档最近的、含 `.obsidian` 目录的祖先目录（复用 document.rs 的
//! `find_vault_root`）；找不到时退化为文档所在目录。三个命令都以 `AppState.current`
//! 为唯一锚点——前端不传路径，读取面天然收窄在当前文档所在的库里。
//! 遍历复用 `collect_markdown_files`（点目录 / node_modules 跳过、限深 12、
//! 限项 50 000），读文件经 `read_text_capped`（>2MB 或非 UTF-8 静默跳过）。

use crate::document::{collect_markdown_files, find_vault_root, markdown_stem};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 检索与反链读文件的上限：超过 2MB 的笔记不做全文逐行扫（结果截断由前端收口）。
const LIBRARY_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
/// 单文件命中上限 / 全库命中上限（超过后者即截断）。
const SEARCH_MAX_PER_FILE: usize = 20;
const SEARCH_MAX_TOTAL: usize = 300;
/// 检索摘录窗口：命中前至多 30 字、后至多 60 字（char 计）。
const SNIPPET_BEFORE_CHARS: usize = 30;
const SNIPPET_AFTER_CHARS: usize = 60;
/// 反链摘录：单文件至多 5 行，单行至多 120 字（去首尾空白后）。
const BACKLINK_MAX_SNIPPETS: usize = 5;
const BACKLINK_SNIPPET_CHARS: usize = 120;
/// 查询串上限（防病态长输入把逐行扫拖成卡顿）。
const SEARCH_QUERY_MAX_CHARS: usize = 200;

/// `list_library` 的文件项（严格 camelCase）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFile {
    pub path: String,
    pub rel_path: String,
}

/// `list_library` 返回契约：库根信息 + 文件清单（含遍历截断标志）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListing {
    pub root: String,
    pub root_name: String,
    pub is_vault: bool,
    pub files: Vec<LibraryFile>,
    pub truncated: bool,
}

/// 检索命中行（严格 camelCase）。`match_start` / `match_len` 是 **char 索引**
/// ——前端按 `Array.from(snippet)` 的码点序列切片，两边单位必须一致。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMatch {
    /// 1-based 行号
    pub line: usize,
    /// 命中行上下裁出的摘录：首尾裁切处补 `…`，tab 已换空格、行尾 \r 已剥
    pub snippet: String,
    pub match_start: usize,
    pub match_len: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySearchFile {
    pub path: String,
    pub rel_path: String,
    pub matches: Vec<LibraryMatch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySearch {
    pub files: Vec<LibrarySearchFile>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkSnippet {
    /// 1-based 行号
    pub line: usize,
    /// 命中行去首尾空白后的摘录（超 120 字截断补 `…`）
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkFile {
    pub path: String,
    pub rel_path: String,
    pub snippets: Vec<BacklinkSnippet>,
}

/// 库根：含 `.obsidian` 的最近祖先；没有则文档所在目录。返回 (root, is_vault)。
fn library_root(current: &Path) -> Option<(PathBuf, bool)> {
    let dir = current.parent()?;
    match find_vault_root(dir) {
        Some(root) => Some((root, true)),
        None => Some((dir.to_path_buf(), false)),
    }
}

/// 读一个文件的全文：>2MB、非普通文件、非 UTF-8 一律静默跳过（库检索不该被
/// 单个大文件或编码损坏的笔记挂住）。
fn read_text_capped(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > LIBRARY_MAX_FILE_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    String::from_utf8(bytes).ok()
}

/// `list_library`：库根 + Markdown 文件清单。
pub fn list_library(current: &Path) -> Result<LibraryListing, String> {
    let (root, is_vault) =
        library_root(current).ok_or_else(|| "no document loaded".to_string())?;
    let (files, truncated) = collect_markdown_files(&root);
    Ok(LibraryListing {
        root_name: root
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string()),
        root: root.to_string_lossy().to_string(),
        is_vault,
        files: files
            .into_iter()
            .map(|(path, rel_path)| LibraryFile {
                path: path.to_string_lossy().to_string(),
                rel_path,
            })
            .collect(),
        truncated,
    })
}

/// 逐字符小写化：`char::to_lowercase` 可能产出多字符（如 `İ`→`i̇`），折叠成
/// String 序列再比——多字符扩展不会错位，`ß` 这类单字符小写也保持原义不被误中。
fn lower_chars(text: &str) -> Vec<String> {
    text.chars().map(|c| c.to_lowercase().collect()).collect()
}

/// 返回一行内命中的 char 起始索引列表（大小写不敏感，逐字符小写序列比对）。
fn find_all(line: &str, needle_lower: &[String]) -> Vec<usize> {
    let hay = lower_chars(line);
    let n = needle_lower.len();
    if n == 0 || hay.len() < n {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for i in 0..=(hay.len() - n) {
        if hay[i..i + n] == needle_lower[..] {
            hits.push(i);
        }
    }
    hits
}

/// 从命中位置裁摘录（前 30 / 后 60 char），补 `…`；match_start 是 snippet 内的 char 索引。
fn make_match(line_no: usize, line: &str, hit_char: usize, needle_len: usize) -> LibraryMatch {
    let chars: Vec<char> = line.chars().collect();
    let from = hit_char.saturating_sub(SNIPPET_BEFORE_CHARS);
    let to = (hit_char + needle_len + SNIPPET_AFTER_CHARS).min(chars.len());
    let mut snippet: String = chars[from..to].iter().collect();
    let mut match_start = hit_char - from;
    if from > 0 {
        snippet.insert(0, '…');
        match_start += 1;
    }
    if to < chars.len() {
        snippet.push('…');
    }
    LibraryMatch {
        line: line_no,
        snippet,
        match_start,
        match_len: needle_len,
    }
}

/// `search_library`：全库 Markdown 逐行大小写不敏感检索。
/// 空查询 → 空结果；>200 char → Err。单文件至多 20 处、全库 300 处截断；
/// 文件按 rel 路径序输出，零命中文件不计。
pub fn search_library(current: &Path, query: &str) -> Result<LibrarySearch, String> {
    let query = query.trim();
    if query.chars().count() > SEARCH_QUERY_MAX_CHARS {
        return Err("query too long".to_string());
    }
    let (root, _) = library_root(current).ok_or_else(|| "no document loaded".to_string())?;
    if query.is_empty() {
        return Ok(LibrarySearch {
            files: Vec::new(),
            truncated: false,
        });
    }
    let needle = lower_chars(query);
    let (files, _) = collect_markdown_files(&root);

    let mut out: Vec<LibrarySearchFile> = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;
    'walk: for (path, rel_path) in files {
        let Some(text) = read_text_capped(&path) else { continue };
        let mut matches: Vec<LibraryMatch> = Vec::new();
        'lines: for (line_idx, raw_line) in text.lines().enumerate() {
            // 行尾 \r 剥掉（CRLF 笔记不把它带进摘录）；tab → 空格在 snippet 内完成
            let line = raw_line.trim_end_matches('\r');
            let tabbed = line.replace('\t', " ");
            for hit in find_all(&tabbed, &needle) {
                matches.push(make_match(line_idx + 1, &tabbed, hit, needle.len()));
                if matches.len() >= SEARCH_MAX_PER_FILE {
                    break 'lines;
                }
            }
        }
        if !matches.is_empty() {
            total += matches.len();
            out.push(LibrarySearchFile {
                path: path.to_string_lossy().to_string(),
                rel_path,
                matches,
            });
            if total >= SEARCH_MAX_TOTAL {
                truncated = true;
                break 'walk;
            }
        }
    }
    Ok(LibrarySearch {
        files: out,
        truncated,
    })
}

/// 一行里的全部 `[[…]]` 目标（`![[…]]` 内嵌式同样命中——`[[` 是同一个模式）。
/// inner 取 `|` 别名前、`#` 片段前，去首尾空白与 `.md` / `.markdown` 后缀（大小写不敏感）。
fn wikilink_targets(line: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut rest = line;
    while let Some(open) = rest.find("[[") {
        let after_open = &rest[open + 2..];
        let Some(close) = after_open.find("]]") else { break };
        let inner = &after_open[..close];
        rest = &after_open[close + 2..];
        let target = inner.split('|').next().unwrap_or("");
        let target = target.split('#').next().unwrap_or("").trim();
        let lower = target.to_lowercase();
        // 后缀是 ASCII，按字节长度往回切一定落在 char 边界上
        let stripped = if lower.ends_with(".markdown") {
            &target[..target.len() - ".markdown".len()]
        } else if lower.ends_with(".md") {
            &target[..target.len() - ".md".len()]
        } else {
            target
        };
        if !stripped.is_empty() {
            targets.push(stripped.to_string());
        }
    }
    targets
}

/// 反链判据：目标末段小写 == 当前文档 stem 小写；目标带 '/' 时还要求
/// 「当前文档的库内相对路径（去扩展名、小写、'/' 分隔）」以该目标结尾——
/// `sub/a` 命中 `x/sub/a.md`，`other/a` 不命中。
fn is_backlink_target(target: &str, stem_lower: &str, current_rel_noext_lower: &str) -> bool {
    let lower = target.to_lowercase();
    let last = lower.rsplit('/').next().unwrap_or(lower.as_str());
    if last != stem_lower {
        return false;
    }
    if lower.contains('/') {
        // 后缀判定必须落在路径段边界上：ends_with("sub/a") 会把 xsub/a 误当命中，
        // 只有「恰好等于目标」或「以 '/目标' 结尾」才算
        return current_rel_noext_lower == lower
            || current_rel_noext_lower.ends_with(&format!("/{lower}"));
    }
    true
}

/// 当前文档在库内的相对路径（'/' 分隔）。库根就是文档目录时退化为文件名。
fn rel_path_of(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| {
            p.components()
                .map(|c| c.as_os_str().to_string_lossy().to_string())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}

/// 去掉相对路径尾的 `.md` / `.markdown` 扩展名（大小写不敏感），用于 slash 判据。
fn strip_rel_ext(rel: &str) -> &str {
    let lower = rel.to_ascii_lowercase();
    if lower.ends_with(".markdown") {
        &rel[..rel.len() - ".markdown".len()]
    } else if lower.ends_with(".md") {
        &rel[..rel.len() - ".md".len()]
    } else {
        rel
    }
}

/// 反链摘录行：去首尾空白后至多 120 char，超出补 `…`。
fn snippet_line(line: &str) -> String {
    let trimmed = line.trim();
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() > BACKLINK_SNIPPET_CHARS {
        let mut cut: String = chars[..BACKLINK_SNIPPET_CHARS].iter().collect();
        cut.push('…');
        cut
    } else {
        trimmed.to_string()
    }
}

/// `find_backlinks`：扫库内每篇（除当前文档）找 `[[当前文档]]` 反链。
/// 代码围栏（``` 或 ~~~ 起止的行）内不算；每篇至多 5 条摘录；结果按 rel 排序。
pub fn find_backlinks(current: &Path) -> Result<Vec<BacklinkFile>, String> {
    let (root, _) = library_root(current).ok_or_else(|| "no document loaded".to_string())?;
    let current_rel = rel_path_of(&root, current);
    let Some(stem_lower) = current
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(markdown_stem)
        .map(|stem| stem.to_lowercase())
    else {
        return Ok(Vec::new());
    };
    let current_rel_noext_lower = strip_rel_ext(&current_rel).to_lowercase();

    let (files, _) = collect_markdown_files(&root);
    let mut out: Vec<BacklinkFile> = Vec::new();
    for (path, rel_path) in files {
        // 自引不算反链（rel 同一份遍历产物，形态一致可直接比字符串）
        if rel_path == current_rel {
            continue;
        }
        let Some(text) = read_text_capped(&path) else { continue };
        let mut snippets: Vec<BacklinkSnippet> = Vec::new();
        let mut in_fence = false;
        for (line_idx, raw_line) in text.lines().enumerate() {
            let line = raw_line.trim_end_matches('\r');
            let trimmed = line.trim_start();
            if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
                in_fence = !in_fence;
                continue;
            }
            if in_fence {
                continue;
            }
            let hit = wikilink_targets(line)
                .iter()
                .any(|target| is_backlink_target(target, &stem_lower, &current_rel_noext_lower));
            if hit {
                snippets.push(BacklinkSnippet {
                    line: line_idx + 1,
                    snippet: snippet_line(line),
                });
                if snippets.len() >= BACKLINK_MAX_SNIPPETS {
                    break;
                }
            }
        }
        if !snippets.is_empty() {
            out.push(BacklinkFile {
                path: path.to_string_lossy().to_string(),
                rel_path,
                snippets,
            });
        }
    }
    Ok(out)
}
