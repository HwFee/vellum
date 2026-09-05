#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Emitter, Manager};
use vellum_lib::document::{self, LoadedDocument};
use vellum_lib::state::AppState;
use vellum_lib::watcher;

#[cfg(windows)]
mod early_single_instance {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{
        GetLastError, ERROR_ALREADY_EXISTS, ERROR_SUCCESS, HWND, LPARAM, WPARAM,
    };
    use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SendMessageTimeoutW, SMTO_NORMAL, WM_COPYDATA,
    };

    /// 与 tauri-plugin-single-instance 的 WM_COPYDATA 数据标识一致
    const WMCOPYDATA_SINGLE_INSTANCE_DATA: usize = 1542;
    /// 应用唯一标识（与 tauri.conf.json 的 identifier 一致）
    const APP_ID: &str = "local.vellum";
    /// 重试次数（等待首实例创建 IPC 窗口）
    const MAX_RETRIES: u32 = 30;
    /// 每次重试间隔（毫秒）
    const RETRY_DELAY_MS: u64 = 100;

    fn encode_wide(string: impl AsRef<OsStr>) -> Vec<u16> {
        string
            .as_ref()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// 在 Tauri 初始化之前检查是否已有实例运行。
    /// 如果已有实例：通过 WM_COPYDATA 将命令行参数转发给首个实例，然后立即退出。
    /// 返回 true 表示已有实例（应该退出），false 表示这是首个实例。
    pub fn check_and_forward() -> bool {
        // 使用与插件不同的 mutex 名称，避免与插件自身的 mutex 冲突
        let mutex_name = encode_wide(format!("{}-early-sim", APP_ID));
        // 使用与插件相同的窗口类名/窗口名，以便找到插件创建的隐藏 IPC 窗口
        let class_name = encode_wide(format!("{}-sic", APP_ID));
        let window_name = encode_wide(format!("{}-siw", APP_ID));

        unsafe {
            // 创建（或打开已存在的）命名 mutex。
            // 句柄故意泄漏（进程退出时由内核回收），确保 mutex 对象
            // 在整个进程生命周期内存活，使后续实例能检测到本实例。
            let hmutex = CreateMutexW(std::ptr::null(), 1, mutex_name.as_ptr());
            if hmutex.is_null() {
                eprintln!(
          "[vellum] single-instance: CreateMutexW failed with error {}. Continuing startup.",
          GetLastError()
        );
                return false;
            }
            let mutex_error = GetLastError();
            if mutex_error == ERROR_SUCCESS {
                // 句柄故意不关闭，确保 mutex 在整个首实例生命周期内存在。
                return false;
            }
            if mutex_error != ERROR_ALREADY_EXISTS {
                eprintln!(
          "[vellum] single-instance: CreateMutexW returned unexpected error {}. Continuing startup.",
          mutex_error
        );
                return false;
            }

            // 已有实例运行。重试查找其 IPC 窗口（首实例可能仍在启动中，窗口尚未创建）。
            let mut hwnd: HWND = std::ptr::null_mut();
            for _ in 0..MAX_RETRIES {
                hwnd = FindWindowW(class_name.as_ptr(), window_name.as_ptr());
                if !hwnd.is_null() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS));
            }

            if hwnd.is_null() {
                // mutex 存在说明首实例进程仍在运行（进程退出时内核自动销毁 mutex），
                // 但 IPC 窗口在超时内未找到（极端情况：首实例卡在初始化阶段）。
                // 仍然退出以避免创建任何可见窗口；文件本次不会被打开，
                // 但用户体验远优于闪现一个透明窗口。
                eprintln!("[vellum] single-instance: IPC window not found after retries, exiting.");
                return true;
            }

            // 构造与插件相同的数据格式：cwd|arg0|arg1|...
            let cwd = std::env::current_dir().unwrap_or_default();
            let cwd_str = cwd.to_str().unwrap_or_default();
            let args = std::env::args().collect::<Vec<String>>().join("|");
            let data = format!("{}|{}\0", cwd_str, args);
            let bytes = data.as_bytes();

            let cds = COPYDATASTRUCT {
                dwData: WMCOPYDATA_SINGLE_INSTANCE_DATA,
                cbData: bytes.len() as _,
                lpData: bytes.as_ptr() as _,
            };

            // 使用 SendMessageTimeoutW 防止首实例消息泵繁忙时无限阻塞
            let mut result: usize = 0;
            let sent = SendMessageTimeoutW(
                hwnd,
                WM_COPYDATA,
                0 as WPARAM,
                &cds as *const _ as LPARAM,
                SMTO_NORMAL,
                5000, // 5 秒超时
                &mut result as *mut _ as *mut usize,
            );
            if sent == 0 {
                eprintln!(
          "[vellum] single-instance: SendMessageTimeoutW failed with error {}. Exiting duplicate instance.",
          GetLastError()
        );
            }
            true // 即使转发失败也退出，避免重复实例创建窗口
        }
    }
}

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
    app_handle: tauri::AppHandle,
) -> Result<LoadedDocument, String> {
    let doc = document::load_markdown_file(Path::new(&path))?;
    let canonical = PathBuf::from(&doc.path);

    // 切换文档时重建监听器：先 drop 旧的（停止其线程），再为新路径创建。
    // 监听失败不应阻断文档加载（例如网络盘不支持 notify），仅记录错误。
    {
        let mut watcher_lock = state
            .watcher
            .lock()
            .map_err(|_| "Watcher lock poisoned".to_string())?;
        *watcher_lock = None;
        match watcher::watch_file(app_handle.clone(), canonical.clone()) {
            Ok(w) => *watcher_lock = Some(w),
            Err(e) => eprintln!("file watcher disabled: {e}"),
        }
    }

    let mut current = state
        .current
        .lock()
        .map_err(|_| "Document state lock poisoned".to_string())?;
    *current = Some(canonical);
    Ok(doc)
}

#[tauri::command]
async fn resolve_asset(
    state: tauri::State<'_, AppState>,
    asset_src: String,
) -> Result<String, String> {
    let anchor_dir = {
        let current = state
            .current
            .lock()
            .map_err(|_| "Document state lock poisoned".to_string())?;
        current
            .as_ref()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .ok_or_else(|| "No document is loaded".to_string())?
    };
    document::resolve_asset_to_data_url(&anchor_dir, &asset_src)
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

#[cfg(test)]
mod tests {
    use super::first_markdown_from_args;

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
    // 在任何 Tauri 代码运行之前检查单实例。
    // 如果已有实例运行，通过 WM_COPYDATA 转发命令行参数后立即退出，
    // 避免第二个进程创建窗口/WebView2 从而产生闪现。
    #[cfg(windows)]
    if early_single_instance::check_and_forward() {
        std::process::exit(0);
    }

    vellum_lib::association::register_markdown_association();
    let pending_open_paths = PendingOpenPaths::default();
    if let Some(path) = first_markdown_arg() {
        pending_open_paths.push(path);
    }

    tauri::Builder::default()
        // 官方单实例插件必须最先注册，接收 early_single_instance 转发的 WM_COPYDATA。
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = first_markdown_from_args(&args) {
                app.state::<PendingOpenPaths>().push(path);
                // 事件仅用于唤醒前端；路径由原子 drain command 读取，避免监听竞态。
                let _ = app.emit("pending-open-paths", ());
            }

            if let Some(window) = app.get_webview_window("main") {
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.unminimize();
                }
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(pending_open_paths)
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            load_document,
            resolve_asset,
            drain_pending_open_paths
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
