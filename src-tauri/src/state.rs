use std::path::PathBuf;
use std::sync::Mutex;
use notify::RecommendedWatcher;

/// Canonicalized path of the currently loaded Markdown document and its active watcher.
/// This is the only trusted anchor for resolving local asset paths and sidecar metadata,
/// ensuring the frontend can never steer file reads outside the open document's directory.
#[derive(Debug, Default)]
pub struct AppState {
    pub current: Mutex<Option<PathBuf>>,
    /// 当前文档的文件监听器。drop 时自动停止监听并结束事件循环线程。
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}
