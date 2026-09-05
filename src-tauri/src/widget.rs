use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::http::{header, Response, StatusCode};
use tauri::State;
use crate::state::AppState;
use crate::watcher::sidecar_path_for;

pub const MAX_WIDGET_HTML_BYTES: usize = 512 * 1024; // 512KB
pub const MAX_REGISTRY_CAPACITY: usize = 64;
pub const HEARTBEAT_TIMEOUT_MS: u64 = 120_000;

/// 存储单篇 Markdown 文档中已注册交互块的内存注册表。
/// 限制单条 HTML <= 512KB，总容量 <= 64 条，按 LRU 顺序淘汰。
#[derive(Debug, Default)]
pub struct WidgetRegistry {
    entries: HashMap<String, String>,
    order: VecDeque<String>,
}

impl WidgetRegistry {
    pub fn insert(&mut self, id: String, html: String) -> Result<(), String> {
        if html.len() > MAX_WIDGET_HTML_BYTES {
            return Err("Widget HTML exceeds maximum size of 512KB".to_string());
        }

        if let Some(pos) = self.order.iter().position(|x| x == &id) {
            self.order.remove(pos);
        } else if self.entries.len() >= MAX_REGISTRY_CAPACITY {
            if let Some(oldest_id) = self.order.pop_front() {
                self.entries.remove(&oldest_id);
            }
        }

        self.order.push_back(id.clone());
        self.entries.insert(id, html);
        Ok(())
    }

    /// 读取 widget HTML 并将该项移至 LRU 队列尾部（提鲜，成真 LRU，S1）。
    pub fn get(&mut self, id: &str) -> Option<&str> {
        if let Some(pos) = self.order.iter().position(|x| x == id) {
            let item = self.order.remove(pos).unwrap();
            self.order.push_back(item);
        }
        self.entries.get(id).map(String::as_str)
    }

    /// 只读查看 widget HTML，不影响 LRU 队列顺序。
    pub fn peek(&self, id: &str) -> Option<&str> {
        self.entries.get(id).map(String::as_str)
    }

    pub fn remove(&mut self, id: &str) -> bool {
        if let Some(pos) = self.order.iter().position(|x| x == id) {
            self.order.remove(pos);
        }
        self.entries.remove(id).is_some()
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// 注册 widget 命令返回的数据契约（必须为 camelCase 序列化）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegisterResult {
    pub id: String,
    pub url: String,
}

/// sidecar `<文件>.mdlog` 的落盘 JSON 格式定义。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MdlogSidecarData {
    #[serde(default)]
    pub version: Option<u32>,
    #[serde(default)]
    pub session_id: Option<String>,
    pub pid: u32,
    #[serde(default)]
    pub connected_at: Option<u64>,
    pub last_write_at: u64,
    pub heartbeat_at: u64,
    #[serde(default)]
    pub anchor_lost: Option<bool>,
}

/// 从请求 URI 中提取 widget id。
/// 支持形如 "http://vellum-widget.localhost/<id>" 或 "vellum-widget://localhost/<id>"。
fn extract_widget_id(uri: &str) -> Option<&str> {
    let path = if let Some(idx) = uri.find("://") {
        let after_scheme = &uri[idx + 3..];
        let slash_pos = after_scheme.find('/')?;
        &after_scheme[slash_pos..]
    } else {
        uri
    };

    let trimmed = path.trim_matches('/');
    if trimmed.is_empty() || trimmed.contains('/') {
        None
    } else {
        Some(trimmed)
    }
}

/// 为 widget 协议响应附加严苛且统一的四条安全响应头。
fn apply_security_headers(
    builder: tauri::http::response::Builder,
) -> tauri::http::response::Builder {
    builder
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:",
        )
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
}

/// 纯函数：构建 widget 自定义 URI 协议响应（包含 200 与 404 分支）。
/// 无论 200 还是 404，一律强制写入四条安全头。
pub fn build_widget_response(
    method: &str,
    uri: &str,
    registry: &mut WidgetRegistry,
) -> Response<Vec<u8>> {
    if method != "GET" {
        return apply_security_headers(Response::builder().status(StatusCode::NOT_FOUND))
            .body(b"Not Found".to_vec())
            .unwrap();
    }

    let maybe_id = extract_widget_id(uri);
    match maybe_id.and_then(|id| registry.get(id)) {
        Some(html) => apply_security_headers(Response::builder().status(StatusCode::OK))
            .body(html.as_bytes().to_vec())
            .unwrap(),
        None => apply_security_headers(Response::builder().status(StatusCode::NOT_FOUND))
            .body(b"Not Found".to_vec())
            .unwrap(),
    }
}

/// 纯函数：判定 sidecar 对应的记录进程是否仍然有效。
/// 判据：pid 存活 且 now - heartbeatAt <= 120_000ms。
pub fn judge_mdlog_alive(
    state: &MdlogSidecarData,
    now: u64,
    pid_alive: &dyn Fn(u32) -> bool,
) -> bool {
    if !pid_alive(state.pid) {
        return false;
    }
    now.saturating_sub(state.heartbeat_at) <= HEARTBEAT_TIMEOUT_MS
}

/// Windows 原生 Win32 进程存活检查：
/// 1. OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)；
/// 2. 成功获取句柄后调用 GetExitCodeProcess 复核，并在返回前必须 CloseHandle 释放（G2）；
/// 3. 若 OpenProcess 失败：仅在权限不足（ERROR_ACCESS_DENIED）或共享冲突时降级为 true；进程不存在时返回 false（A1）。
#[cfg(windows)]
pub fn is_pid_alive_win32(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION, STILL_ACTIVE,
    };
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    if pid == 0 {
        return false;
    }

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !handle.is_null() {
            let mut exit_code: u32 = 0;
            let success = GetExitCodeProcess(handle, &mut exit_code);
            // G2: 成功获取非零句柄后，必须显式释放内核对象，杜绝句柄泄漏
            CloseHandle(handle);
            if success != 0 {
                return exit_code == STILL_ACTIVE as u32;
            }
            return true;
        }

        let err = GetLastError();
        // A1: 仅在因权限不足（ERROR_ACCESS_DENIED）或共享冲突等无法判定时才降级为 true；
        // 对于进程不存在的明确失败（如 ERROR_INVALID_PARAMETER 或 ERROR_FILE_NOT_FOUND 等），返回 false。
        if err == ERROR_ACCESS_DENIED || err == ERROR_SHARING_VIOLATION {
            return true;
        }
        false
    }
}

#[cfg(not(windows))]
pub fn is_pid_alive_win32(_pid: u32) -> bool {
    true
}

/// Tauri 状态容器：统一托管 WidgetRegistry，无全局 static 变量。
#[derive(Debug, Default)]
pub struct WidgetState(pub Mutex<WidgetRegistry>);

/// `read_mdlog_state` 返回的前端契约数据（严格 camelCase）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MdlogStateResponse {
    pub last_write_at: u64,
    pub heartbeat_at: u64,
    pub expires_at: u64,
}

/// 纯函数：根据当前激活文档路径读取同级 sidecar 文件并仲裁存活。
/// 抽离本函数使存活判断可完全脱离 Tauri 运行时进行高可靠单元测试。
pub fn read_mdlog_state_from_path(
    current_path: Option<&Path>,
    pid_alive: &dyn Fn(u32) -> bool,
    now: u64,
) -> Option<MdlogStateResponse> {
    let current = current_path?;
    let sidecar_path = sidecar_path_for(current);

    if !sidecar_path.is_file() {
        return None;
    }

    let content = std::fs::read_to_string(&sidecar_path).ok()?;
    let data: MdlogSidecarData = serde_json::from_str(&content).ok()?;

    if !judge_mdlog_alive(&data, now, pid_alive) {
        return None;
    }

    let expires_at = data.heartbeat_at.saturating_add(HEARTBEAT_TIMEOUT_MS);
    Some(MdlogStateResponse {
        last_write_at: data.last_write_at,
        heartbeat_at: data.heartbeat_at,
        expires_at,
    })
}

/// 注册交互块 HTML 并返回随机 128-bit UUID 及访问 URL。
#[tauri::command]
pub async fn register_widget(
    state: State<'_, WidgetState>,
    html: String,
) -> Result<RegisterResult, String> {
    if html.len() > MAX_WIDGET_HTML_BYTES {
        return Err("Widget HTML exceeds maximum size of 512KB".to_string());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let url = format!("http://vellum-widget.localhost/{id}");

    let mut registry = state
        .0
        .lock()
        .map_err(|_| "Widget registry lock poisoned".to_string())?;
    registry.insert(id.clone(), html)?;

    Ok(RegisterResult { id, url })
}

/// 卸载指定的交互块。
#[tauri::command]
pub async fn unregister_widget(
    state: State<'_, WidgetState>,
    id: String,
) -> Result<(), String> {
    let mut registry = state
        .0
        .lock()
        .map_err(|_| "Widget registry lock poisoned".to_string())?;
    registry.remove(&id);
    Ok(())
}

/// 读取当前文档的 mdlog sidecar 存活状态（无入参命令，强制锚定 AppState.current）。
#[tauri::command]
pub async fn read_mdlog_state(
    state: State<'_, AppState>,
) -> Result<Option<MdlogStateResponse>, String> {
    let current = state
        .current
        .lock()
        .map_err(|_| "AppState current lock poisoned".to_string())?
        .clone();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let result = read_mdlog_state_from_path(current.as_deref(), &is_pid_alive_win32, now);
    Ok(result)
}
