## 工作包 1：Rust 后端（基础、双路监听与沙箱协议）

本工作包负责 Tauri 后端基础设施的改造与扩展，包含 AppState 解耦迁移、文件监听双路独立防抖、widget 沙箱自定义 URI 协议与注册表、sidecar 状态读取与存活校验命令，以及 main.rs 声明周期集成与 CSP 安全配置。

---

### Task 1.1: 抽取 `AppState` 到 `vellum_lib::state`

**Files:**
- Create: `src-tauri/src/state.rs`
- Create: `src-tauri/src/state_tests.rs`
- Modify: `src-tauri/src/lib.rs:1-10`
- Modify: `src-tauri/src/main.rs:160-175`

**Interfaces:**
- Consumes: `notify::RecommendedWatcher`, `std::path::PathBuf`, `std::sync::Mutex`
- Produces:
  ```rust
  // src-tauri/src/state.rs
  pub struct AppState {
      pub current: Mutex<Option<PathBuf>>,
      pub watcher: Mutex<Option<RecommendedWatcher>>,
  }
  ```
  Neighboring tasks (Task 1.4, Task 1.5) rely on `vellum_lib::state::AppState` for path anchoring and Tauri state management.

- [ ] **Step 1: Write the failing test**

在 `src-tauri/src/state_tests.rs` 创建测试文件，并在 `src-tauri/src/lib.rs` 引入测试模块声明：

```rust
// src-tauri/src/state_tests.rs
use std::path::PathBuf;
use crate::state::AppState;

fn assert_send_sync<T: Send + Sync>() {}

#[test]
fn app_state_implements_send_and_sync() {
    assert_send_sync::<AppState>();
}

#[test]
fn app_state_initializes_empty_and_allows_interior_mutability() {
    let state = AppState::default();
    {
        let current = state.current.lock().expect("lock current");
        assert_eq!(*current, None);
    }
    {
        let watcher = state.watcher.lock().expect("lock watcher");
        assert!(watcher.is_none());
    }

    {
        let mut current = state.current.lock().expect("lock current");
        *current = Some(PathBuf::from("C:/notes/test.md"));
    }

    let current = state.current.lock().expect("lock current");
    assert_eq!(*current, Some(PathBuf::from("C:/notes/test.md")));
}
```

在 `src-tauri/src/lib.rs` 中追加：
```rust
#[cfg(test)]
mod state_tests;
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml --test-threads=1
```
预期输出包含编译失败：
```
error[E0432]: unresolved import `crate::state`
 --> src\state_tests.rs:2:12
  |
2 | use crate::state::AppState;
  |            ^^^^^ could not find `state` in the crate root
```

- [ ] **Step 3: Write minimal implementation**

创建 `src-tauri/src/state.rs`：
```rust
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
```

在 `src-tauri/src/lib.rs` 暴露模块：
```rust
pub mod association;
pub mod document;
pub mod state;
pub mod watcher;

#[cfg(test)]
mod document_tests;
#[cfg(test)]
mod state_tests;
```

在 `src-tauri/src/main.rs` 替换原本地 `struct AppState`：
删除原第 162-170 行：
```rust
// 删除 main.rs 中的旧私有定义：
// #[derive(Debug, Default)]
// struct AppState {
//     current: Mutex<Option<PathBuf>>,
//     watcher: Mutex<Option<RecommendedWatcher>>,
// }
```
并在 `src-tauri/src/main.rs` 顶部引入：
```rust
use vellum_lib::state::AppState;
```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
预期输出：
```
test state_tests::app_state_implements_send_and_sync ... ok
test state_tests::app_state_initializes_empty_and_allows_interior_mutability ... ok
test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```
（包含原 13 个 document 单元测试、2 个新 state 单元测试，以及 main.rs 2 个测试，共 17 个测试全部通过）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/state_tests.rs src-tauri/src/lib.rs src-tauri/src/main.rs
git commit -m "refactor(backend): extract AppState into vellum_lib::state"
```

### Task 1.2: `watcher.rs` 双路独立防抖改造

**Files:**
- Modify: `src-tauri/src/watcher.rs`
- Create: `src-tauri/src/watcher_tests.rs`
- Modify: `src-tauri/src/lib.rs:1-15`

**Interfaces:**
- Consumes: `tauri::{AppHandle, Emitter}`, `notify::RecommendedWatcher`, `std::path::PathBuf`
- Produces:
  ```rust
  // src-tauri/src/watcher.rs
  pub fn sidecar_path_for(file_path: &Path) -> PathBuf;
  pub struct DoubleDebounceTracker { ... }
  #[derive(Debug, Default, PartialEq, Eq)]
  pub struct DebounceEmits {
      pub file_changed: bool,
      pub mdlog_state_changed: bool,
  }
  pub fn watch_file(app: AppHandle, file_path: PathBuf) -> Result<RecommendedWatcher, String>;
  ```
  Neighboring tasks / frontend rely on the two emitted Tauri events:
  - `"file-changed"`: 目标日志 Markdown 变动（400ms 防抖）
  - `"mdlog-state-changed"`: 同级 `<日志>.mdlog` sidecar 状态文件变动（400ms 防抖，互不顶槽）

- [ ] **Step 1: Write the failing test**

创建 `src-tauri/src/watcher_tests.rs`，覆盖 sidecar 命名规则、双路事件互不顶槽独立计时、最小超时选择以及分别触发逻辑：

```rust
// src-tauri/src/watcher_tests.rs
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::watcher::{sidecar_path_for, DebounceEmits, DoubleDebounceTracker};

#[test]
fn derives_correct_sidecar_path() {
    let doc = Path::new("C:/notes/session.md");
    let sidecar = sidecar_path_for(doc);
    assert_eq!(sidecar, PathBuf::from("C:/notes/session.md.mdlog"));

    let doc_upper = Path::new("C:/notes/README.MARKDOWN");
    let sidecar_upper = sidecar_path_for(doc_upper);
    assert_eq!(sidecar_upper, PathBuf::from("C:/notes/README.MARKDOWN.mdlog"));
}

#[test]
fn log_event_does_not_affect_sidecar_deadline() {
    let target = PathBuf::from("C:/notes/log.md");
    let debounce = Duration::from_millis(400);
    let mut tracker = DoubleDebounceTracker::new(target.clone(), debounce);

    let now = Instant::now();
    tracker.handle_event_paths(&[target.clone()], now);

    assert!(tracker.log_deadline.is_some());
    assert!(tracker.sidecar_deadline.is_none());
}

#[test]
fn sidecar_event_does_not_affect_log_deadline() {
    let target = PathBuf::from("C:/notes/log.md");
    let sidecar = PathBuf::from("C:/notes/log.md.mdlog");
    let debounce = Duration::from_millis(400);
    let mut tracker = DoubleDebounceTracker::new(target, debounce);

    let now = Instant::now();
    tracker.handle_event_paths(&[sidecar], now);

    assert!(tracker.log_deadline.is_none());
    assert!(tracker.sidecar_deadline.is_some());
}

#[test]
fn independent_deadlines_take_minimum_timeout() {
    let target = PathBuf::from("C:/notes/log.md");
    let sidecar = PathBuf::from("C:/notes/log.md.mdlog");
    let debounce = Duration::from_millis(400);
    let mut tracker = DoubleDebounceTracker::new(target.clone(), debounce);

    let t0 = Instant::now();
    tracker.handle_event_paths(&[target], t0);

    let t1 = t0 + Duration::from_millis(100);
    tracker.handle_event_paths(&[sidecar], t1);

    // log 到期时间为 t0 + 400ms，sidecar 到期时间为 t1 + 400ms = t0 + 500ms
    // 在 t1 时刻，超时应为 (t0 + 400ms) - t1 = 300ms（取两者之较早者）
    let idle = Duration::from_secs(3600);
    let timeout = tracker.compute_timeout(t1, idle);
    assert_eq!(timeout, Duration::from_millis(300));
}

#[test]
fn poll_expired_emits_each_event_independently() {
    let target = PathBuf::from("C:/notes/log.md");
    let sidecar = PathBuf::from("C:/notes/log.md.mdlog");
    let debounce = Duration::from_millis(400);
    let mut tracker = DoubleDebounceTracker::new(target.clone(), debounce);

    let t0 = Instant::now();
    tracker.handle_event_paths(&[target], t0);
    let t1 = t0 + Duration::from_millis(200);
    tracker.handle_event_paths(&[sidecar], t1);

    // 在 t0 + 400ms 时，log 到期，但 sidecar（到期于 t0 + 600ms）未到期
    let emits_at_400 = tracker.poll_expired(t0 + Duration::from_millis(400));
    assert_eq!(
        emits_at_400,
        DebounceEmits {
            file_changed: true,
            mdlog_state_changed: false,
        }
    );
    assert!(tracker.log_deadline.is_none());
    assert!(tracker.sidecar_deadline.is_some());

    // 在 t0 + 600ms 时，sidecar 到期
    let emits_at_600 = tracker.poll_expired(t0 + Duration::from_millis(600));
    assert_eq!(
        emits_at_600,
        DebounceEmits {
            file_changed: false,
            mdlog_state_changed: true,
        }
    );
    assert!(tracker.sidecar_deadline.is_none());
}
```

并在 `src-tauri/src/lib.rs` 追加：
```rust
#[cfg(test)]
mod watcher_tests;
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml --test watcher_tests
```
预期输出包含编译失败：
```
error[E0432]: unresolved import `crate::watcher::DoubleDebounceTracker`
error[E0432]: unresolved import `crate::watcher::sidecar_path_for`
error[E0432]: unresolved import `crate::watcher::DebounceEmits`
```

- [ ] **Step 3: Write minimal implementation**

修改 `src-tauri/src/watcher.rs`：

```rust
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// 防抖静默期：连续文件变更事件在此期间合并为一次重载。
pub const DEBOUNCE: Duration = Duration::from_millis(400);

/// 依据目标 Markdown 文件路径推导同级 `<目标>.mdlog` sidecar 文件路径。
pub fn sidecar_path_for(file_path: &Path) -> PathBuf {
    let mut name = file_path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".mdlog");
    file_path.with_file_name(name)
}

/// 标识单次超时检测需要触发的 Tauri 事件。
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DebounceEmits {
    pub file_changed: bool,
    pub mdlog_state_changed: bool,
}

/// 双路独立防抖状态机：
/// target 变更 -> 400ms log_deadline -> emit "file-changed"
/// sidecar 变更 -> 400ms sidecar_deadline -> emit "mdlog-state-changed"
/// 两路计时独立维护，互不顶替、互不合并。
pub struct DoubleDebounceTracker {
    pub target: PathBuf,
    pub sidecar_target: PathBuf,
    pub log_deadline: Option<Instant>,
    pub sidecar_deadline: Option<Instant>,
    pub debounce: Duration,
}

impl DoubleDebounceTracker {
    pub fn new(target: PathBuf, debounce: Duration) -> Self {
        let sidecar_target = sidecar_path_for(&target);
        Self {
            target,
            sidecar_target,
            log_deadline: None,
            sidecar_deadline: None,
            debounce,
        }
    }

    /// 根据接收到的事件路径，分别刷新对应管线的 deadline。
    pub fn handle_event_paths(&mut self, paths: &[PathBuf], now: Instant) {
        if paths.iter().any(|p| p == &self.target) {
            self.log_deadline = Some(now + self.debounce);
        }
        if paths.iter().any(|p| p == &self.sidecar_target) {
            self.sidecar_deadline = Some(now + self.debounce);
        }
    }

    /// 计算下一次 `recv_timeout` 的等待时长（取两路 deadline 的较早者）。
    pub fn compute_timeout(&self, now: Instant, idle_wait: Duration) -> Duration {
        match (self.log_deadline, self.sidecar_deadline) {
            (Some(ld), Some(sd)) => {
                let earliest = ld.min(sd);
                if earliest <= now {
                    Duration::ZERO
                } else {
                    earliest - now
                }
            }
            (Some(ld), None) => {
                if ld <= now {
                    Duration::ZERO
                } else {
                    ld - now
                }
            }
            (None, Some(sd)) => {
                if sd <= now {
                    Duration::ZERO
                } else {
                    sd - now
                }
            }
            (None, None) => idle_wait,
        }
    }

    /// 提取已到期的事件并清除对应 deadline。
    pub fn poll_expired(&mut self, now: Instant) -> DebounceEmits {
        let mut emits = DebounceEmits::default();

        if let Some(ld) = self.log_deadline {
            if ld <= now {
                emits.file_changed = true;
                self.log_deadline = None;
            }
        }

        if let Some(sd) = self.sidecar_deadline {
            if sd <= now {
                emits.mdlog_state_changed = true;
                self.sidecar_deadline = None;
            }
        }

        emits
    }
}

/// 启动针对目标文件及其同级 sidecar 的双路监听器。
/// 返回的 `RecommendedWatcher` drop 时自动停止监听并结束内部事件循环线程。
pub fn watch_file(app: AppHandle, file_path: PathBuf) -> Result<RecommendedWatcher, String> {
    let parent = file_path
        .parent()
        .ok_or_else(|| "Cannot resolve parent directory for watch".to_string())?
        .to_path_buf();

    let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|error| format!("Watcher init failed: {error}"))?;

    watcher
        .watch(&parent, RecursiveMode::NonRecursive)
        .map_err(|error| format!("Watch failed: {error}"))?;

    let target = file_path.clone();
    let app_handle = app.clone();
    std::thread::spawn(move || {
        let idle_wait = Duration::from_secs(3600);
        let mut tracker = DoubleDebounceTracker::new(target, DEBOUNCE);

        loop {
            let now = Instant::now();
            let timeout = tracker.compute_timeout(now, idle_wait);

            match rx.recv_timeout(timeout) {
                Ok(Ok(event)) => {
                    tracker.handle_event_paths(&event.paths, Instant::now());
                }
                Ok(Err(_)) => continue,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }

            let emits = tracker.poll_expired(Instant::now());
            if emits.file_changed {
                let _ = app_handle.emit("file-changed", ());
            }
            if emits.mdlog_state_changed {
                let _ = app_handle.emit("mdlog-state-changed", ());
            }
        }
    });

    Ok(watcher)
}
```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
预期输出：
```
test watcher_tests::derives_correct_sidecar_path ... ok
test watcher_tests::log_event_does_not_affect_sidecar_deadline ... ok
test watcher_tests::sidecar_event_does_not_affect_log_deadline ... ok
test watcher_tests::independent_deadlines_take_minimum_timeout ... ok
test watcher_tests::poll_expired_emits_each_event_independently ... ok
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/watcher.rs src-tauri/src/watcher_tests.rs src-tauri/src/lib.rs
git commit -m "feat(watcher): support independent double-deadline debounce for log and sidecar"
```

### Task 1.3: `widget.rs` 核心数据结构与纯函数（注册表 LRU、协议响应构造与存活仲裁）

**Files:**
- Modify: `src-tauri/Cargo.toml:10-30`
- Create: `src-tauri/src/widget.rs`
- Create: `src-tauri/src/widget_tests.rs`
- Modify: `src-tauri/src/lib.rs:1-20`

**Interfaces:**
- Consumes: `uuid::Uuid`, `windows_sys::Win32`
- Produces:
  ```rust
  // src-tauri/src/widget.rs
  pub const MAX_WIDGET_HTML_BYTES: usize = 512 * 1024; // 524_288 bytes (512KB)
  pub const MAX_REGISTRY_CAPACITY: usize = 64;
  pub const HEARTBEAT_TIMEOUT_MS: u64 = 120_000;

  pub struct WidgetRegistry { ... }
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
  #[serde(rename_all = "camelCase")]
  pub struct RegisterResult {
      pub id: String,
      pub url: String,
  }
  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct MdlogSidecarData {
      pub pid: u32,
      pub last_write_at: u64,
      pub heartbeat_at: u64,
      ...
  }
  pub fn build_widget_response(
      method: &str,
      uri: &str,
      registry: &WidgetRegistry,
  ) -> tauri::http::Response<Vec<u8>>;
  pub fn judge_mdlog_alive(
      state: &MdlogSidecarData,
      now: u64,
      pid_alive: &dyn Fn(u32) -> bool,
  ) -> bool;
  pub fn is_pid_alive_win32(pid: u32) -> bool;
  ```
  Neighboring tasks (Task 1.4, Task 1.5) rely on `WidgetRegistry`, `build_widget_response`, `judge_mdlog_alive`, and `is_pid_alive_win32`.

- [ ] **Step 1: Write the failing test**

在 `src-tauri/Cargo.toml` 中添加 `uuid` 依赖：
```toml
[dependencies]
uuid = { version = "1", features = ["v4"] }
```

创建 `src-tauri/src/widget_tests.rs`：

```rust
// src-tauri/src/widget_tests.rs
use crate::widget::{
    build_widget_response, judge_mdlog_alive, MdlogSidecarData, RegisterResult, WidgetRegistry,
    MAX_REGISTRY_CAPACITY, MAX_WIDGET_HTML_BYTES,
};

#[test]
fn registry_rejects_html_exceeding_512kb() {
    let mut registry = WidgetRegistry::default();
    let oversized = "a".repeat(MAX_WIDGET_HTML_BYTES + 1);
    let result = registry.insert("oversized-id".to_string(), oversized);

    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err(),
        "Widget HTML exceeds maximum size of 512KB"
    );
    assert_eq!(registry.len(), 0);
}

#[test]
fn registry_evicts_oldest_entry_when_exceeding_64_entries() {
    let mut registry = WidgetRegistry::default();

    // 填满 64 条
    for i in 0..MAX_REGISTRY_CAPACITY {
        let id = format!("widget-{i}");
        let html = format!("<div>widget {i}</div>");
        registry.insert(id, html).expect("insert within capacity");
    }
    assert_eq!(registry.len(), MAX_REGISTRY_CAPACITY);
    assert!(registry.get("widget-0").is_some());

    // 插入第 65 条，应当淘汰最旧的 widget-0
    registry
        .insert("widget-64".to_string(), "<div>widget 64</div>".to_string())
        .expect("insert 65th item");

    assert_eq!(registry.len(), MAX_REGISTRY_CAPACITY);
    assert!(registry.get("widget-0").is_none());
    assert!(registry.get("widget-64").is_some());
    assert!(registry.get("widget-1").is_some());
}

#[test]
fn register_result_serializes_to_camel_case() {
    let res = RegisterResult {
        id: "abc-123".to_string(),
        url: "http://vellum-widget.localhost/abc-123".to_string(),
    };
    let json = serde_json::to_string(&res).unwrap();
    assert!(json.contains("\"id\":\"abc-123\""));
    assert!(json.contains("\"url\":\"http://vellum-widget.localhost/abc-123\""));
}

#[test]
fn build_widget_response_returns_200_with_all_4_security_headers() {
    let mut registry = WidgetRegistry::default();
    registry
        .insert("test-id".to_string(), "<h1>Hello</h1>".to_string())
        .unwrap();

    let response = build_widget_response(
        "GET",
        "http://vellum-widget.localhost/test-id",
        &registry,
    );

    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(
        response.headers().get("Content-Type").unwrap(),
        "text/html; charset=utf-8"
    );
    assert_eq!(
        response.headers().get("Content-Security-Policy").unwrap(),
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"
    );
    assert_eq!(
        response.headers().get("X-Content-Type-Options").unwrap(),
        "nosniff"
    );
    assert_eq!(
        response.headers().get("Cache-Control").unwrap(),
        "no-store"
    );
    assert_eq!(response.body(), b"<h1>Hello</h1>");
}

#[test]
fn build_widget_response_returns_404_with_all_4_security_headers_for_unknown_or_invalid() {
    let registry = WidgetRegistry::default();

    // 1. 未知 id
    let resp_404 = build_widget_response(
        "GET",
        "vellum-widget://localhost/non-existent",
        &registry,
    );
    assert_eq!(resp_404.status().as_u16(), 404);
    assert_eq!(
        resp_404.headers().get("Content-Type").unwrap(),
        "text/html; charset=utf-8"
    );
    assert_eq!(
        resp_404.headers().get("Content-Security-Policy").unwrap(),
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"
    );

    // 2. 非 GET 请求拒绝为 404
    let resp_post = build_widget_response(
        "POST",
        "http://vellum-widget.localhost/test-id",
        &registry,
    );
    assert_eq!(resp_post.status().as_u16(), 404);

    // 3. 越界或非法多段路径
    let resp_traversal = build_widget_response(
        "GET",
        "http://vellum-widget.localhost/id/extra/path",
        &registry,
    );
    assert_eq!(resp_traversal.status().as_u16(), 404);
}

#[test]
fn judge_mdlog_alive_matrix_evaluation() {
    let sidecar = MdlogSidecarData {
        version: Some(1),
        session_id: Some("sess-1".to_string()),
        pid: 9999,
        connected_at: Some(1000),
        last_write_at: 1000,
        heartbeat_at: 100_000,
        anchor_lost: Some(false),
    };

    // 1. pid 存活 且 心跳正常（相差 50s <= 120s） -> true
    let alive = judge_mdlog_alive(&sidecar, 150_000, &|pid| pid == 9999);
    assert!(alive);

    // 2. pid 存活 但 心跳超时（相差 120_001ms > 120s） -> false
    let timeout = judge_mdlog_alive(&sidecar, 220_001, &|pid| pid == 9999);
    assert!(!timeout);

    // 3. pid 已死 且 心跳正常 -> false
    let dead_pid = judge_mdlog_alive(&sidecar, 150_000, &|_pid| false);
    assert!(!dead_pid);

    // 4. pid 已死 且 心跳超时 -> false
    let dead_both = judge_mdlog_alive(&sidecar, 250_000, &|_pid| false);
    assert!(!dead_both);
}
```

在 `src-tauri/src/lib.rs` 中声明：
```rust
#[cfg(test)]
mod widget_tests;
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml --test widget_tests
```
预期输出包含编译失败：
```
error[E0432]: unresolved import `crate::widget`
```

- [ ] **Step 3: Write minimal implementation**

创建 `src-tauri/src/widget.rs`：

```rust
use std::collections::{HashMap, VecDeque};
use tauri::http::{header, Response, StatusCode};

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

    pub fn get(&self, id: &str) -> Option<&str> {
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
    registry: &WidgetRegistry,
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
/// 3. 若 OpenProcess 失败（权限不足或进程降权），降级为依据心跳时间判定（返回 true 允许通过）。
#[cfg(windows)]
pub fn is_pid_alive_win32(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, STILL_ACTIVE,
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
                return exit_code == STILL_ACTIVE;
            }
            return true;
        }

        let err = GetLastError();
        if err == ERROR_ACCESS_DENIED {
            return true;
        }
        // 无法判定时降级依赖心跳时间
        true
    }
}

#[cfg(not(windows))]
pub fn is_pid_alive_win32(_pid: u32) -> bool {
    true
}
```

在 `src-tauri/src/lib.rs` 暴露 `widget` 模块：
```rust
pub mod association;
pub mod document;
pub mod state;
pub mod watcher;
pub mod widget;

#[cfg(test)]
mod document_tests;
#[cfg(test)]
mod state_tests;
#[cfg(test)]
mod watcher_tests;
#[cfg(test)]
mod widget_tests;
```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
预期输出：
```
test widget_tests::registry_rejects_html_exceeding_512kb ... ok
test widget_tests::registry_evicts_oldest_entry_when_exceeding_64_entries ... ok
test widget_tests::register_result_serializes_to_camel_case ... ok
test widget_tests::build_widget_response_returns_200_with_all_4_security_headers ... ok
test widget_tests::build_widget_response_returns_404_with_all_4_security_headers_for_unknown_or_invalid ... ok
test widget_tests::judge_mdlog_alive_matrix_evaluation ... ok
test result: ok. 26 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/widget.rs src-tauri/src/widget_tests.rs src-tauri/src/lib.rs
git commit -m "feat(widget): implement widget registry LRU, secure response builder, and alive judge"
```

### Task 1.4: `widget.rs` Tauri 命令实现（`register_widget`、`unregister_widget`、`read_mdlog_state`）

**Files:**
- Modify: `src-tauri/src/widget.rs`
- Modify: `src-tauri/src/widget_tests.rs`

**Interfaces:**
- Consumes: `vellum_lib::state::AppState`, `tauri::State`
- Produces:
  ```rust
  // src-tauri/src/widget.rs
  #[derive(Debug, Default)]
  pub struct WidgetState(pub std::sync::Mutex<WidgetRegistry>);

  #[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
  #[serde(rename_all = "camelCase")]
  pub struct MdlogStateResponse {
      pub last_write_at: u64,
      pub heartbeat_at: u64,
      pub expires_at: u64,
  }

  #[tauri::command]
  pub async fn register_widget(
      state: tauri::State<'_, WidgetState>,
      html: String,
  ) -> Result<RegisterResult, String>;

  #[tauri::command]
  pub async fn unregister_widget(
      state: tauri::State<'_, WidgetState>,
      id: String,
  ) -> Result<(), String>;

  #[tauri::command]
  pub async fn read_mdlog_state(
      state: tauri::State<'_, crate::state::AppState>,
  ) -> Result<Option<MdlogStateResponse>, String>;
  ```
  Neighboring tasks (Task 1.5, WP3 前端) rely on these exact command names and data schemas:
  - Command: `register_widget` -> `{ id: string, url: string }`
  - Command: `unregister_widget` -> `()`
  - Command: `read_mdlog_state` -> `{ lastWriteAt: number, heartbeatAt: number, expiresAt: number } | null`

- [ ] **Step 1: Write the failing test**

在 `src-tauri/src/widget_tests.rs` 中追加测试：

```rust
// 追加至 src-tauri/src/widget_tests.rs
use std::fs;
use std::path::Path;
use crate::widget::{
    read_mdlog_state_from_path, MdlogStateResponse, WidgetState,
};

#[test]
fn read_mdlog_state_returns_none_when_current_doc_is_none() {
    let result = read_mdlog_state_from_path(None, &|_| true, 100_000);
    assert_eq!(result, None);
}

#[test]
fn read_mdlog_state_returns_none_when_sidecar_file_does_not_exist() {
    let temp_doc = std::env::temp_dir().join("test_non_existent_doc.md");
    let result = read_mdlog_state_from_path(Some(&temp_doc), &|_| true, 100_000);
    assert_eq!(result, None);
}

#[test]
fn read_mdlog_state_returns_none_for_corrupted_json() {
    let temp_doc = std::env::temp_dir().join("test_corrupted_doc.md");
    let temp_sidecar = std::env::temp_dir().join("test_corrupted_doc.md.mdlog");
    fs::write(&temp_sidecar, "{ corrupted json").unwrap();

    let result = read_mdlog_state_from_path(Some(&temp_doc), &|_| true, 100_000);
    let _ = fs::remove_file(&temp_sidecar);

    assert_eq!(result, None);
}

#[test]
fn read_mdlog_state_reads_valid_sidecar_and_computes_expires_at() {
    let temp_doc = std::env::temp_dir().join("test_valid_doc.md");
    let temp_sidecar = std::env::temp_dir().join("test_valid_doc.md.mdlog");

    let sidecar_json = r#"{
        "version": 1,
        "sessionId": "pi-test-session",
        "pid": 4321,
        "connectedAt": 1000,
        "lastWriteAt": 50000,
        "heartbeatAt": 60000,
        "anchorLost": false
    }"#;
    fs::write(&temp_sidecar, sidecar_json).unwrap();

    // 当前时间 70_000（心跳过去 10s <= 120s，pid 存活）
    let result = read_mdlog_state_from_path(Some(&temp_doc), &|pid| pid == 4321, 70_000);
    let _ = fs::remove_file(&temp_sidecar);

    assert_eq!(
        result,
        Some(MdlogStateResponse {
            last_write_at: 50000,
            heartbeat_at: 60000,
            expires_at: 180_000, // 60000 + 120_000
        })
    );
}

#[test]
fn read_mdlog_state_returns_none_when_heartbeat_expired_or_pid_dead() {
    let temp_doc = std::env::temp_dir().join("test_expired_doc.md");
    let temp_sidecar = std::env::temp_dir().join("test_expired_doc.md.mdlog");

    let sidecar_json = r#"{
        "pid": 4321,
        "lastWriteAt": 50000,
        "heartbeatAt": 60000
    }"#;
    fs::write(&temp_sidecar, sidecar_json).unwrap();

    // 1. 超时测试：当前时间 180_001（心跳相差 120_001ms > 120s）
    let res_expired = read_mdlog_state_from_path(Some(&temp_doc), &|pid| pid == 4321, 180_001);
    assert_eq!(res_expired, None);

    // 2. pid 死亡测试：pid_alive 返回 false
    let res_dead = read_mdlog_state_from_path(Some(&temp_doc), &|_| false, 70_000);
    assert_eq!(res_dead, None);

    let _ = fs::remove_file(&temp_sidecar);
}

#[test]
fn widget_state_registers_and_unregisters() {
    let state = WidgetState::default();
    {
        let mut reg = state.0.lock().unwrap();
        reg.insert("w-1".to_string(), "<div>1</div>".to_string()).unwrap();
        assert_eq!(reg.len(), 1);
        assert!(reg.get("w-1").is_some());

        reg.remove("w-1");
        assert_eq!(reg.len(), 0);
        assert!(reg.get("w-1").is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml --test widget_tests
```
预期输出包含编译失败：
```
error[E0432]: unresolved import `crate::widget::read_mdlog_state_from_path`
error[E0432]: unresolved import `crate::widget::WidgetState`
error[E0432]: unresolved import `crate::widget::MdlogStateResponse`
```

- [ ] **Step 3: Write minimal implementation**

在 `src-tauri/src/widget.rs` 中实现 `WidgetState`、纯解析函数 `read_mdlog_state_from_path` 以及三个 Tauri 命令：

```rust
// 追加至 src-tauri/src/widget.rs
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use crate::state::AppState;
use crate::watcher::sidecar_path_for;

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
```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
预期输出：
```
test widget_tests::read_mdlog_state_returns_none_when_current_doc_is_none ... ok
test widget_tests::read_mdlog_state_returns_none_when_sidecar_file_does_not_exist ... ok
test widget_tests::read_mdlog_state_returns_none_for_corrupted_json ... ok
test widget_tests::read_mdlog_state_reads_valid_sidecar_and_computes_expires_at ... ok
test widget_tests::read_mdlog_state_returns_none_when_heartbeat_expired_or_pid_dead ... ok
test widget_tests::widget_state_registers_and_unregisters ... ok
test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/widget.rs src-tauri/src/widget_tests.rs
git commit -m "feat(widget): implement register_widget, unregister_widget, and read_mdlog_state commands"
```

### Task 1.5: `main.rs` 与 `tauri.conf.json` 全局集成（自定义协议拦截、生命周期守卫、CSP 配置）

**Files:**
- Modify: `src-tauri/tauri.conf.json:20-24`
- Modify: `src-tauri/src/main.rs:1-320`

**Interfaces:**
- Consumes:
  - `vellum_lib::state::AppState`
  - `vellum_lib::widget::{build_widget_response, read_mdlog_state, register_widget, unregister_widget, WidgetState}`
- Produces:
  - `register_uri_scheme_protocol("vellum-widget", ...)` 协议拦截端点
  - `tauri.conf.json` CSP: `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; frame-src http://vellum-widget.localhost"`
  - `load_document` canonical 路径守卫（同路径热重载不 drop 旧 watcher、不清注册表）
  - 全局命令分发：`register_widget`、`unregister_widget`、`read_mdlog_state`
  - 全局事件发出：`"file-changed"`、`"mdlog-state-changed"`

- [ ] **Step 1: Write the failing test**

在 `src-tauri/src/main.rs` 内的 `mod tests` 追加对 CSP 配置与路径守卫判据的单元测试：

```rust
// 追加在 src-tauri/src/main.rs 中的 #[cfg(test)] mod tests
#[test]
fn tauri_conf_csp_contains_frame_src_for_widget() {
    let conf_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let content = std::fs::read_to_string(&conf_path).expect("read tauri.conf.json");
    let parsed: serde_json::Value = serde_json::from_str(&content).expect("parse tauri.conf.json");

    let csp = parsed["app"]["security"]["csp"]
        .as_str()
        .expect("security.csp must be a string");

    let expected_csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; frame-src http://vellum-widget.localhost";
    assert_eq!(csp, expected_csp);
}

#[test]
fn load_document_guard_detects_same_canonical_path() {
    let current_path = Some(std::path::PathBuf::from("C:/notes/live.md"));
    let new_path = std::path::PathBuf::from("C:/notes/live.md");
    let is_same = current_path.as_ref() == Some(&new_path);
    assert!(is_same, "Same canonical path must be recognized to prevent watcher recreation");

    let other_path = std::path::PathBuf::from("C:/notes/other.md");
    let is_other = current_path.as_ref() == Some(&other_path);
    assert!(!is_other, "Different canonical path must trigger watcher recreation");
}
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml --bin vellum tests::tauri_conf_csp_contains_frame_src
```
预期输出失败（因为 `tauri.conf.json` 目前尚未包含 `frame-src http://vellum-widget.localhost`）：
```
thread 'tests::tauri_conf_csp_contains_frame_src' panicked at src\main.rs:
assertion `left == right` failed
  left: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:"
 right: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; frame-src http://vellum-widget.localhost"
```

- [ ] **Step 3: Write minimal implementation**

1. 修改 `src-tauri/tauri.conf.json`（仅 CSP 字段追加 `frame-src`，其余逐字不动）：
```json
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; frame-src http://vellum-widget.localhost"
    }
```

2. 修改 `src-tauri/src/main.rs`：
引入 `vellum_lib::widget` 导出的状态与命令，改造 `load_document` 并装配 Tauri Builder：

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{Emitter, Manager};
use vellum_lib::document::{self, LoadedDocument};
use vellum_lib::state::AppState;
use vellum_lib::watcher;
use vellum_lib::widget::{
    build_widget_response, read_mdlog_state, register_widget, unregister_widget, WidgetState,
};

// ... 省略 early_single_instance、first_markdown_arg、PendingOpenPaths、drain_pending_open_paths 原代码 ...

#[tauri::command]
async fn load_document(
    path: String,
    state: tauri::State<'_, AppState>,
    widget_state: tauri::State<'_, WidgetState>,
    app_handle: tauri::AppHandle,
) -> Result<LoadedDocument, String> {
    let doc = document::load_markdown_file(Path::new(&path))?;
    let canonical = PathBuf::from(&doc.path);

    let is_same_doc = {
        let current = state
            .current
            .lock()
            .map_err(|_| "Document state lock poisoned".to_string())?;
        current.as_ref() == Some(&canonical)
    };

    if !is_same_doc {
        // G1: 仅当 canonical 绝对路径改变（切换文档）时，才清空 widget 注册表并重建 watcher。
        // 同一文档的热重载保持 watcher 与 registry 存活，彻底杜绝 sidecar deadline 被扼杀与 iframe 失效。
        {
            let mut registry = widget_state
                .0
                .lock()
                .map_err(|_| "Widget registry lock poisoned".to_string())?;
            registry.clear();
        }
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
    }

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

// ... 省略 first_markdown_from_args 与 tests ...

fn main() {
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
        .register_uri_scheme_protocol("vellum-widget", |ctx, request| {
            let widget_state = ctx.app_handle().state::<WidgetState>();
            let registry = widget_state.0.lock().unwrap_or_else(|p| p.into_inner());
            build_widget_response(
                request.method().as_str(),
                &request.uri().to_string(),
                &registry,
            )
        })
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = first_markdown_from_args(&args) {
                app.state::<PendingOpenPaths>().push(path);
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
        .manage(WidgetState::default())
        .invoke_handler(tauri::generate_handler![
            load_document,
            resolve_asset,
            drain_pending_open_paths,
            register_widget,
            unregister_widget,
            read_mdlog_state,
        ])
        .setup(|app| {
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
```

- [ ] **Step 4: Run test to verify it passes**

执行后端与前端全量验证命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml
npm test
```
预期输出：
1. `cargo test` 全量通过（34+ 用例全部 ok，0 failed）
2. `npm test` 现有前端基线全量通过（17 文件全部通过，175 用例全部 ok）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/main.rs
git commit -m "feat(main): integrate vellum-widget protocol, lifecycle guard, and CSP frame-src"
```





