#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use vellum_lib::document::{self, LoadedDocument};
use vellum_lib::state::AppState;
use vellum_lib::watcher;
use vellum_lib::widget::{build_widget_response, WidgetRegistry, WidgetState};

fn first_markdown_arg() -> Option<String> {
    let args = std::env::args_os()
        .skip(1)
        .filter_map(|arg| arg.to_str().map(str::to_owned))
        .collect::<Vec<_>>();
    first_markdown_from_args(&args)
}

#[derive(Debug, Default)]
struct PendingOpenPaths {
    paths: Mutex<VecDeque<String>>,
}

impl PendingOpenPaths {
    fn push(&self, path: String) {
        match self.paths.lock() {
            Ok(mut paths) => paths.push_back(path),
            Err(error) => eprintln!("pending open paths lock poisoned: {error}"),
        }
    }
}

#[tauri::command]
fn drain_pending_open_paths(state: tauri::State<PendingOpenPaths>) -> Result<Vec<String>, String> {
    let mut paths = state
        .paths
        .lock()
        .map_err(|_| "Pending open paths lock poisoned".to_string())?;
    Ok(paths.drain(..).collect())
}

#[tauri::command]
async fn load_document(
    path: String,
    state: tauri::State<'_, AppState>,
    widget_state: tauri::State<'_, WidgetState>,
    app_handle: tauri::AppHandle,
) -> Result<LoadedDocument, String> {
    let doc = document::load_markdown_file(Path::new(&path))?;
    let canonical = PathBuf::from(&doc.path);

    // W1: 将「判定 -> 清空注册表 -> 重建 watcher -> 写 current」收拢进同一临界区。
    // 统一锁序：current -> watcher -> widget_state.0，彻底消除 TOCTOU 竞态。
    // S2: AppState 与 WidgetRegistry 为纯内存状态，中毒时通过 into_inner() 安全自愈，避免文档切换永久不可逆失败。
    {
        let mut current_lock = state.current.lock().unwrap_or_else(|p| p.into_inner());
        let mut watcher_lock = state.watcher.lock().unwrap_or_else(|p| p.into_inner());

        let has_watcher = watcher_lock.is_some();
        let path_changed = should_clear_registry(current_lock.as_ref(), &canonical);
        let rebuild_watcher = needs_watcher_rebuild(current_lock.as_ref(), &canonical, has_watcher);

        if path_changed {
            let mut registry = widget_state.0.lock().unwrap_or_else(|p| p.into_inner());
            apply_rebind(&mut registry, &mut current_lock, &canonical, path_changed);
        }

        if rebuild_watcher {
            *watcher_lock = None;
            match watcher::watch_file(app_handle.clone(), canonical.clone()) {
                Ok(w) => *watcher_lock = Some(w),
                Err(e) => eprintln!("file watcher disabled: {e}"),
            }
        }
    }

    Ok(doc)
}

#[tauri::command]
async fn save_document(
    path: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<document::SaveOutcome, String> {
    let canonical = dunce::canonicalize(Path::new(&path))
        .map_err(|error| format!("Cannot open file: {error}"))?;

    // 闸门 1：只允许写当前已加载的文档（AppState.current 是唯一可信锚点）。
    let current = state
        .current
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();

    // 闸门 2：mdlog 记录中拒绝写入（前端门禁之外的服务端兜底）。
    // 与 read_mdlog_state 命令同一判定链：sidecar 存活即视为记录中。
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let mdlog_active = vellum_lib::widget::read_mdlog_state_from_path(
        Some(&canonical),
        &vellum_lib::widget::is_pid_alive_win32,
        now,
    )
    .is_some();

    document::check_save_gates(current.as_deref(), &canonical, mdlog_active)?;

    document::save_markdown_file(&canonical, &content)
}

#[tauri::command]
async fn resolve_asset(
    state: tauri::State<'_, AppState>,
    asset_src: String,
) -> Result<String, String> {
    let anchor_dir = {
        // S2: AppState 仅保存当前文档路径；中毒时安全读取 inner 引用，防止资产解析永久失败。
        let current = state.current.lock().unwrap_or_else(|p| p.into_inner());
        current
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .ok_or_else(|| "No document is loaded".to_string())?
    };
    document::resolve_asset_to_data_url(&anchor_dir, &asset_src)
}

/// Obsidian `[[wikilink]]` 解析：目标 → 磁盘上的笔记绝对路径（找不到为 null）。
///
/// 只读存在性检查，无状态、无副作用；`from_path` 是当前文档路径（解析基准，也是找
/// `.obsidian` 库根的起点）。前端在一次打开里只调一次（目标清单去重后整批传）。
#[tauri::command]
async fn resolve_wikilinks(
    from_path: String,
    targets: Vec<String>,
) -> Result<std::collections::HashMap<String, Option<String>>, String> {
    Ok(document::resolve_wikilink_map(Path::new(&from_path), &targets))
}

/// 从一组命令行参数中提取第一个 .md / .markdown 文件路径。
fn first_markdown_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .find(|arg| {
            let lower = arg.to_ascii_lowercase();
            lower.ends_with(".md") || lower.ends_with(".markdown")
        })
        .cloned()
}

/// 纯函数：判定是否需要清空 widget 注册表（路径切换或首次加载，P8）。
/// 同路径下即便 watcher 缺失触发自愈，也绝不清空注册表，保留存活 iframe 的 URL。
fn should_clear_registry(current: Option<&PathBuf>, next: &Path) -> bool {
    match current {
        Some(cur) => cur != next,
        None => true,
    }
}

/// 纯函数：判定是否需要重建 watcher（路径切换、首次加载或 watcher 缺失自愈，P8）。
fn needs_watcher_rebuild(current: Option<&PathBuf>, next: &Path, has_watcher: bool) -> bool {
    should_clear_registry(current, next) || !has_watcher
}

/// 纯函数：执行重新绑定状态转移（S6/P8/C8）。
/// 当路径改变或首次加载（path_changed 为 true）时，清空 widget 注册表并将 current 更新为 next；
/// 若路径不变（同路径重载或 watcher 异常恢复），则严格保留 registry 内容。
/// 返回 true 表示触发了注册表清空与路径重置。
fn apply_rebind(
    registry: &mut WidgetRegistry,
    current: &mut Option<PathBuf>,
    next: &Path,
    path_changed: bool,
) -> bool {
    if path_changed {
        registry.clear();
        *current = Some(next.to_path_buf());
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_rebind, first_markdown_from_args, needs_watcher_rebuild, should_clear_registry,
    };

    #[test]
    fn tauri_conf_csp_contains_frame_src_for_widget() {
        let conf_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let content = std::fs::read_to_string(&conf_path).expect("read tauri.conf.json");
        let parsed: serde_json::Value =
            serde_json::from_str(&content).expect("parse tauri.conf.json");

        let csp = parsed["app"]["security"]["csp"]
            .as_str()
            .expect("security.csp must be a string");

        let expected_csp = "default-src 'self'; connect-src ipc: http://ipc.localhost; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; frame-src http://vellum-widget.localhost";
        assert_eq!(csp, expected_csp);
    }

    #[test]
    fn apply_rebind_clears_registry_on_path_change() {
        let mut registry = vellum_lib::widget::WidgetRegistry::default();
        registry
            .insert("w1".to_string(), "<div>1</div>".to_string())
            .unwrap();
        assert_eq!(registry.len(), 1);

        let mut current = Some(std::path::PathBuf::from("C:/notes/doc1.md"));
        let next = std::path::Path::new("C:/notes/doc2.md");

        let path_changed = should_clear_registry(current.as_ref(), next);
        let rebinded = apply_rebind(&mut registry, &mut current, next, path_changed);
        assert!(rebinded);
        assert_eq!(registry.len(), 0);
        assert_eq!(current, Some(std::path::PathBuf::from("C:/notes/doc2.md")));
    }

    #[test]
    fn apply_rebind_preserves_registry_on_same_path_with_watcher() {
        let mut registry = vellum_lib::widget::WidgetRegistry::default();
        registry
            .insert("w1".to_string(), "<div>1</div>".to_string())
            .unwrap();
        assert_eq!(registry.len(), 1);

        let p1 = std::path::PathBuf::from("C:/notes/doc1.md");
        let mut current = Some(p1.clone());

        let path_changed = should_clear_registry(current.as_ref(), &p1);
        let rebinded = apply_rebind(&mut registry, &mut current, &p1, path_changed);
        assert!(!rebinded);
        assert_eq!(registry.len(), 1);
        assert_eq!(current, Some(p1));
    }

    #[test]
    fn apply_rebind_preserves_registry_when_watcher_missing_for_healing() {
        let mut registry = vellum_lib::widget::WidgetRegistry::default();
        registry
            .insert("w1".to_string(), "<div>1</div>".to_string())
            .unwrap();
        assert_eq!(registry.len(), 1);

        let p1 = std::path::PathBuf::from("C:/notes/doc1.md");
        let mut current = Some(p1.clone());

        // P8: 同路径下 watcher 缺失时仅重建 watcher，apply_rebind 绝不清空注册表
        let path_changed = should_clear_registry(current.as_ref(), &p1);
        let rebinded = apply_rebind(&mut registry, &mut current, &p1, path_changed);
        assert!(!rebinded);
        assert_eq!(registry.len(), 1);
        assert_eq!(current, Some(p1));
    }

    #[test]
    fn rebind_and_watcher_matrix_evaluation() {
        let p1 = std::path::PathBuf::from("C:/notes/live.md");
        let p2 = std::path::PathBuf::from("C:/notes/other.md");
        // 首次加载（current 为 None）：清空注册表 + 重建 watcher
        assert!(should_clear_registry(None, &p1));
        assert!(needs_watcher_rebuild(None, &p1, false));
        assert!(needs_watcher_rebuild(None, &p1, true));

        // 路径不同（切换文档）：清空注册表 + 重建 watcher
        assert!(should_clear_registry(Some(&p1), &p2));
        assert!(needs_watcher_rebuild(Some(&p1), &p2, true));

        // P8 核心测试：相同路径但 watcher 缺失（异常恢复）：
        // 必须重建 watcher，但绝不清空注册表！
        assert!(!should_clear_registry(Some(&p1), &p1));
        assert!(needs_watcher_rebuild(Some(&p1), &p1, false));

        // 相同路径且 watcher 正常（同路径热重载）：两者均不触发
        assert!(!should_clear_registry(Some(&p1), &p1));
        assert!(!needs_watcher_rebuild(Some(&p1), &p1, true));
    }

    #[test]
    fn extracts_first_markdown_path_case_insensitively() {
        let args = vec![
            "vellum.exe".to_string(),
            "C:/notes/README.MARKDOWN".to_string(),
            "C:/notes/later.md".to_string(),
        ];
        assert_eq!(
            first_markdown_from_args(&args),
            Some("C:/notes/README.MARKDOWN".to_string())
        );
    }

    #[test]
    fn ignores_non_markdown_arguments() {
        let args = vec!["vellum.exe".to_string(), "--verbose".to_string()];
        assert_eq!(first_markdown_from_args(&args), None);
    }
}

fn main() {
    // 多实例（2026-09-12）：不再设单实例锁。每次启动都是独立进程/窗口，
    // 各自从命令行参数加载自己的文档；settings Store 跨进程共享、后写覆盖
    // （阅读位置按文件路径键控，不同文件的实例互不干扰）。
    vellum_lib::association::register_markdown_association();
    let pending_open_paths = PendingOpenPaths::default();
    if let Some(path) = first_markdown_arg() {
        pending_open_paths.push(path);
    }

    tauri::Builder::default()
        .register_uri_scheme_protocol("vellum-widget", |ctx, request| {
            let widget_state = ctx.app_handle().state::<WidgetState>();
            let mut registry = widget_state.0.lock().unwrap_or_else(|p| p.into_inner());
            build_widget_response(
                request.method().as_str(),
                &request.uri().to_string(),
                &mut registry,
            )
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(pending_open_paths)
        .manage(AppState::default())
        .manage(WidgetState::default())
        .invoke_handler(tauri::generate_handler![
            load_document,
            resolve_asset,
            resolve_wikilinks,
            save_document,
            drain_pending_open_paths,
            vellum_lib::widget::register_widget,
            vellum_lib::widget::unregister_widget,
            vellum_lib::widget::read_mdlog_state,
        ])
        .setup(|app| {
            // 兜底：3 秒后强制显示窗口，防止前端 JS 加载失败导致窗口永久隐藏。
            let window = app
                .get_webview_window("main")
                .expect("main window not found");
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let _ = window.show();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run 素笺");
}
