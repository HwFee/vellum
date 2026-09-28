use notify::RecommendedWatcher;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

/// 库根的标记目录：`.vellum` 优先、其次 `.obsidian`（同级两者都在时 `.vellum` 赢）。
/// `LibraryRef` 进 `Opened.library` 随文档原子换代——库三命令只认它，不再现场向上搜。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryMarker {
    Vellum,
    Obsidian,
}

impl LibraryMarker {
    pub fn dir_name(self) -> &'static str {
        match self {
            Self::Vellum => ".vellum",
            Self::Obsidian => ".obsidian",
        }
    }
}

/// 库根的锚定结果：`explicit` = 用户直接打开了那个文件夹（不看标记也算库）；
/// `marker` = 由向上搜索命中的标记目录（`.vellum` / `.obsidian`）。
/// 两者可以同真：显式打开的库恰好带标记目录。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRef {
    pub root: PathBuf,
    pub explicit: bool,
    pub marker: Option<LibraryMarker>,
}

/// 一次「打开」的全貌：文档本体 + 所属库（None = 单文件模式）。
/// 两者在 `load_document` / `open_library` / `open_library_at` 的同一临界区原子替换——
/// 换文档时库根同步换代是模式判定不自相矛盾的前提。
#[derive(Debug, Clone)]
pub struct Opened {
    pub doc: PathBuf,
    pub library: Option<LibraryRef>,
}

/// Canonicalized path of the currently loaded Markdown document and its active watcher.
/// This is the only trusted anchor for resolving local asset paths and sidecar metadata,
/// ensuring the frontend can never steer file reads outside the open document's directory.
#[derive(Debug, Default)]
pub struct AppState {
    /// `Option<Opened>`：文档路径与库归属原子共存亡；`opened.doc` 即旧语义的 current。
    pub current: Mutex<Option<Opened>>,
    /// 当前文档的文件监听器。drop 时自动停止监听并结束事件循环线程。
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    /// wikilink 悬停预览的读取白名单：resolve_wikilinks 对当前文档解析命中的全部
    /// canonical 笔记路径。read_note_preview 只认集合内的路径——前端报任意路径也
    /// 读不到白名单外的文件。随文档切换清空（load_document 临界区内），由下一次解析重建。
    pub preview_allow: Mutex<HashSet<PathBuf>>,
}
