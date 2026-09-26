#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;
use vellum_lib::document::{self, LoadedDocument};
use vellum_lib::library;
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
    // 统一锁序：current -> watcher -> widget_state.0 -> preview_allow，彻底消除 TOCTOU 竞态。
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
            // 预览白名单随文档切换整批作废：上一篇允许预览的笔记集合不带给新文档，
            // 由下一次 resolve_wikilinks 重建。
            state
                .preview_allow
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .clear();
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

/// 纯函数：`resolve_wikilinks` 的基准路径闸门——只允许以「当前已加载文档」为
/// 解析基准（收窄前前端可用任意 from_path 探测文件存在性，这是一个路径神谕）。
fn require_current_document(current: Option<&Path>, from: &Path) -> Result<(), String> {
    match current {
        Some(path) if path == from => Ok(()),
        _ => Err("from_path is not the current document".to_string()),
    }
}

/// Obsidian `[[wikilink]]` 解析：目标 → 磁盘上的笔记绝对路径（找不到为 null）。
///
/// `from_path` 是当前文档路径（解析基准，也是找 `.obsidian` 库根的起点），且必须
/// 等于 AppState.current——否则拒绝。解析命中的路径集合同步写入 preview_allow，
/// 作为 read_note_preview 的读取白名单。
///
/// 锁序：先取 current 立刻放锁（扫库期间不持任何锁），结果落定后才锁 preview_allow
/// 整体替换（同一代际重建）。
#[tauri::command]
async fn resolve_wikilinks(
    from_path: String,
    targets: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, Option<String>>, String> {
    let from = dunce::canonicalize(Path::new(&from_path))
        .map_err(|error| format!("Cannot open file: {error}"))?;
    {
        let current = state.current.lock().unwrap_or_else(|p| p.into_inner());
        require_current_document(current.as_deref(), &from)?;
    }
    let map = document::resolve_wikilink_map(&from, &targets);
    // 复查闸门（锁序同前：current -> preview_allow）：扫库期间用户可能已经换文档——
    // 那时 load_document 的临界区已按新代际清空/重建白名单，迟到解析的结果表只许带回
    // （前端会按当前文档判时效），绝不许覆写新一代的 allow。
    {
        let current = state.current.lock().unwrap_or_else(|p| p.into_inner());
        if current.as_deref() != Some(from.as_path()) {
            return Ok(map);
        }
    }
    let allow: HashSet<PathBuf> = map
        .values()
        .filter_map(|resolved| resolved.as_ref().map(PathBuf::from))
        .collect();
    *state.preview_allow.lock().unwrap_or_else(|p| p.into_inner()) = allow;
    Ok(map)
}

/// 库面板：文件列表（库根 = 含 `.obsidian` 的最近祖先，否则文档所在目录）。
/// 锚点一律是 AppState.current——前端不传路径；遍历放 spawn_blocking 不占运行时线程。
#[tauri::command]
async fn list_library(
    state: tauri::State<'_, AppState>,
) -> Result<library::LibraryListing, String> {
    let current = state
        .current
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
        .ok_or_else(|| "no document loaded".to_string())?;
    tauri::async_runtime::spawn_blocking(move || library::list_library(&current))
        .await
        .map_err(|error| format!("list_library failed: {error}"))?
}

/// 库面板：全库全文检索（大小写不敏感、char 粒度）。同上锚定 current，重活入 spawn_blocking。
#[tauri::command]
async fn search_library(
    query: String,
    state: tauri::State<'_, AppState>,
) -> Result<library::LibrarySearch, String> {
    let current = state
        .current
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
        .ok_or_else(|| "no document loaded".to_string())?;
    tauri::async_runtime::spawn_blocking(move || library::search_library(&current, &query))
        .await
        .map_err(|error| format!("search_library failed: {error}"))?
}

/// 库面板：反向链接（哪些笔记 `[[链到本篇]]`）。同上锚定 current。
#[tauri::command]
async fn find_backlinks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<library::BacklinkFile>, String> {
    let current = state
        .current
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
        .ok_or_else(|| "no document loaded".to_string())?;
    tauri::async_runtime::spawn_blocking(move || library::find_backlinks(&current))
        .await
        .map_err(|error| format!("find_backlinks failed: {error}"))?
}

/// wikilink 悬停预览：读一篇已解析笔记的开头部分（≤64KiB）。
/// 读取面收窄到 preview_allow 白名单——即「当前文档 wikilink 解析命中的笔记」。
#[tauri::command]
async fn read_note_preview(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<document::NotePreview, String> {
    // 克隆白名单后立即放锁：读盘不持锁（白名单是小型 HashSet<PathBuf>）
    let allow = state
        .preview_allow
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone();
    document::read_note_preview_file(Path::new(&path), &allow)
}


/// 导出为 PDF（2026-09-21）：前端「导出为 PDF」视图（方案三·纸张舞台，Ctrl+P）的落盘端。
///
/// 规格对齐上游 kami 的 WeasyPrint 模板（tw93/kami references/production.md）：A4、
/// 边距 20mm/22mm、宣纸底色、首页留白、第 2 页起页眉页码 + 页脚「题名 · 素笺」。
/// 页眉页脚不是 Chromium 的 headerTemplate，而是 CSS @page 边盒——前端在导出视图挂载时
/// 注入规则（ExportPdfView / buildExportPageStyle），Chromium printToPDF 在
/// preferCSSPageSize 下会渲染边盒内容（Playwright 实机验证见 docs/design/shots/margin-box-test.pdf）。
///
/// 实现：对主窗口的 WebView2 直接调 CDP Page.printToPDF——同一页面上演，不另起隐藏
/// webview。打印底稿藏在导出视图里（屏幕态 display:none，@media print 下独占纸面），
/// 整套分页/版式复用 kami.css 打印段。COM 调用必须发生在主线程（with_webview 负责派发），
/// 而 CDP 回执异步经消息泵回来，所以本命令在 spawn_blocking 线程里用 mpsc 等回执，
/// 主线程事件循环保持转动，互不阻塞。
#[tauri::command]
async fn export_pdf(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || export_pdf_blocking(&window, &path))
        .await
        .map_err(|error| format!("export task join failed: {error}"))?
}

#[cfg(windows)]
fn export_pdf_blocking(window: &tauri::WebviewWindow, path: &str) -> Result<(), String> {
    use base64::Engine as _;
    use std::sync::mpsc;
    use std::time::Duration;

    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows_core::{w, HSTRING};

    // 闸门：只收 .pdf 绝对路径（前端系统保存对话框之外的服务端兜底，与 save_document 同理）。
    let target = Path::new(path);
    let is_pdf = target
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
    if !target.is_absolute() || !is_pdf {
        return Err(format!("invalid export path: {path}"));
    }

    // CDP 参数：边距单位是英寸（20mm≈0.7874in、22mm≈0.8661in），与前端 @page 常量同值。
    // preferCSSPageSize 让 @page 的 A4 尺寸与边盒页眉页脚生效；printBackground 带出宣纸底色。
    let params = serde_json::json!({
        "printBackground": true,
        "preferCSSPageSize": true,
        "marginTop": 0.7874,
        "marginBottom": 0.7874,
        "marginLeft": 0.8661,
        "marginRight": 0.8661,
    })
    .to_string();

    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    window
        .with_webview(move |webview| {
            let tx_fallback = tx.clone();
            let dispatch = move || -> Result<(), String> {
                let core = unsafe { webview.controller().CoreWebView2() }
                    .map_err(|error| format!("CoreWebView2 unavailable: {error}"))?;
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result: windows_core::Result<()>, json: String| {
                        let outcome = result
                            .map(|_| json)
                            .map_err(|error| format!("printToPDF failed: {error}"));
                        let _ = tx.send(outcome);
                        Ok(())
                    },
                ));
                unsafe {
                    core.CallDevToolsProtocolMethod(
                        w!("Page.printToPDF"),
                        &HSTRING::from(params.as_str()),
                        &handler,
                    )
                }
                .map_err(|error| format!("CallDevToolsProtocolMethod failed: {error}"))?;
                Ok(())
            };
            // 派发失败（主线程退出等）不能让 rx 空等：错误同样走通道回传。
            if let Err(error) = dispatch() {
                let _ = tx_fallback.send(Err(error));
            }
        })
        .map_err(|error| format!("with_webview dispatch failed: {error}"))?;

    let json = rx
        .recv_timeout(Duration::from_secs(30))
        .map_err(|error| format!("printToPDF timed out: {error}"))??;

    let data = serde_json::from_str::<serde_json::Value>(&json)
        .ok()
        .and_then(|value| value["data"].as_str().map(str::to_owned))
        .ok_or_else(|| "printToPDF response missing data".to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| format!("PDF base64 decode failed: {error}"))?;
    std::fs::write(target, bytes).map_err(|error| format!("write {path} failed: {error}"))
}

#[cfg(not(windows))]
fn export_pdf_blocking(_window: &tauri::WebviewWindow, _path: &str) -> Result<(), String> {
    Err("export_pdf is only supported on Windows".to_string())
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
        apply_rebind, first_markdown_from_args, needs_watcher_rebuild, require_current_document,
        should_clear_registry,
    };
    use std::path::{Path, PathBuf};

    #[test]
    fn tauri_conf_csp_contains_frame_src_for_widget() {
        let conf_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let content = std::fs::read_to_string(&conf_path).expect("read tauri.conf.json");
        let parsed: serde_json::Value =
            serde_json::from_str(&content).expect("parse tauri.conf.json");

        let csp = parsed["app"]["security"]["csp"]
            .as_str()
            .expect("security.csp must be a string");

        let expected_csp = "default-src 'self'; connect-src ipc: http://ipc.localhost https://github.com; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; frame-src http://vellum-widget.localhost";
        assert_eq!(csp, expected_csp);
    }

    /// 自动更新（task 10）：三处配置缺一，`check()` 就整条走不通——endpoints 为空时
    /// `UpdaterBuilder::build()` 直接返回 `EmptyEndpoints`，`createUpdaterArtifacts` 缺失则
    /// 打包不产出 `.sig`，签名校验永远失败。pubkey 由 `tauri signer generate` 产出后替换占位。
    #[test]
    fn tauri_conf_declares_updater_plugin_and_artifacts() {
        let conf_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let content = std::fs::read_to_string(&conf_path).expect("read tauri.conf.json");
        let parsed: serde_json::Value =
            serde_json::from_str(&content).expect("parse tauri.conf.json");

        let endpoints = parsed["plugins"]["updater"]["endpoints"]
            .as_array()
            .expect("plugins.updater.endpoints must be an array");
        assert_eq!(
            endpoints,
            &vec![serde_json::json!(
                "https://github.com/HwFee/vellum/releases/latest/download/latest.json"
            )]
        );

        let pubkey = parsed["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("plugins.updater.pubkey must be a string");
        assert!(!pubkey.is_empty());

        assert_eq!(
            parsed["bundle"]["createUpdaterArtifacts"],
            serde_json::json!(true)
        );

        // 插件在 setup 阶段就会把这段 JSON 反序列化成自己的 Config（`api.config()` 是有类型的），
        // 失败会让 `Builder::run` 直接 Err ⇒ `main()` 的 expect 崩在启动那一行。这里用同一个类型
        // 走一遍，等于把「配置对插件仍然合法」钉成编译期的契约：日后插件新增必填字段 / 改名，
        // 这条会在 `cargo test` 当场红，而不是等到启动崩。
        let updater_config: tauri_plugin_updater::Config =
            serde_json::from_value(parsed["plugins"]["updater"].clone())
                .expect("plugins.updater must deserialize into tauri_plugin_updater::Config");
        assert_eq!(updater_config.endpoints.len(), 1);
        assert_eq!(
            updater_config.endpoints[0].as_str(),
            "https://github.com/HwFee/vellum/releases/latest/download/latest.json"
        );
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

    #[test]
    fn resolve_gate_accepts_current_document() {
        let current = PathBuf::from("C:/notes/a.md");
        assert!(require_current_document(Some(&current), Path::new("C:/notes/a.md")).is_ok());
    }

    #[test]
    fn resolve_gate_rejects_foreign_path() {
        let current = PathBuf::from("C:/notes/a.md");
        let error =
            require_current_document(Some(&current), Path::new("C:/notes/b.md")).unwrap_err();
        assert!(error.contains("not the current document"));
    }

    #[test]
    fn resolve_gate_rejects_when_nothing_loaded() {
        assert!(require_current_document(None, Path::new("C:/notes/a.md")).is_err());
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(pending_open_paths)
        .manage(AppState::default())
        .manage(WidgetState::default())
        .invoke_handler(tauri::generate_handler![
            load_document,
            resolve_asset,
            resolve_wikilinks,
            read_note_preview,
            list_library,
            search_library,
            find_backlinks,
            save_document,
            drain_pending_open_paths,
            export_pdf,
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
