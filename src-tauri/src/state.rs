use notify::RecommendedWatcher;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

/// Canonicalized path of the currently loaded Markdown document and its active watcher.
/// This is the only trusted anchor for resolving local asset paths and sidecar metadata,
/// ensuring the frontend can never steer file reads outside the open document's directory.
#[derive(Debug, Default)]
pub struct AppState {
    pub current: Mutex<Option<PathBuf>>,
    /// 当前文档的文件监听器。drop 时自动停止监听并结束事件循环线程。
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    /// wikilink 悬停预览的读取白名单：resolve_wikilinks 对当前文档解析命中的全部
    /// canonical 笔记路径。read_note_preview 只认集合内的路径——前端报任意路径也
    /// 读不到白名单外的文件。随文档切换清空（load_document 临界区内），由下一次解析重建。
    pub preview_allow: Mutex<HashSet<PathBuf>>,
}
