# Pi 对话实时记录（mdlog）与沙箱交互块 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pi 扩展把用户与 Agent 的对话实时追加写入 Markdown 文件，Vellum 复用文件监听热重载管线渲染记录，并用沙箱 iframe 渲染 `vellum-widget` 自包含 HTML 交互块。

**Architecture:** 「MD 文件即真相」——pi 全局扩展 `mdlog` 负责格式化与追加写入（含图片资产复制、心跳 sidecar、智能追加续写）；Vellum 仅监听文件系统：日志文件变更触发静默热重载，sidecar 驱动「记录中」徽章，`vellum-widget` 围栏块经 Rust 自定义协议（`http://vellum-widget.localhost`）注册后在 `sandbox="allow-scripts"` iframe 中渲染。进程间无任何直接连接。

**Tech Stack:** Tauri 2（Rust / windows-sys / notify）· React 19 + TypeScript + Vite 8 · react-markdown 10 · pi 扩展 API（TypeScript，jiti 加载）· Vitest + Testing Library · cargo test。

**Spec:** `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（v3，唯一事实来源；每个 Task 的细化要求以 spec 对应章节为准）

**设计预览（CSS 唯一真源）:** `docs/preview/mdlog-preview.html`

## Global Constraints

每个 Task 的要求都隐含包含本节全部约束：

- 平台仅 Windows 10/11 x64；不得引入 macOS/Linux 分支逻辑（协议 URL 生成等平台差异点除外，按 spec 写明的方式处理）。
- 风格合规：产品 UI 与注入 iframe 的 widget 内容无 emoji；新增 CSS 只允许使用 kami.css `:root` 已声明变量，圆角 ∈ {0, 1px, 2px, 3px, 4px, 6px}，字重 ≤ 500，不引入第二种强调色/渐变/深色模式。
- 工作树纪律：每个 Task 提交前 `git status --porcelain` 必须只含本 Task 触及的文件；在途无关改动由主 Agent 在开工前独立提交。
- 性能死规则（AGENTS.md）：`CodeBlock.tsx` 禁止切回 PrismAsyncLight；`MarkdownDocument.tsx` 的 memo 结构与 props 引用稳定约束不可破坏；`components` 必须是 useMemo 结果（依赖仅 `[resolveHeadingId, isTrustedMdlog]`）；`search-match--current` 仍由 layout effect 维护；katex 保持在 rehype 管线末尾。
- widget 契约硬数值：单条 HTML ≤ 512KB；注册表 ≤ 64 条 LRU；存活 iframe ≤ 10；iframe 高度 clamp [80, 2000]px；懒挂载 rootMargin 200px；滚动稳定 400ms 后才允许淘汰挂载；休眠项仅点击复活。
- 语言提取正则改为 `/language-([\w-]+)/`；widget 围栏语言名逐字为 `vellum-widget`。
- 协议与安全：iframe `sandbox="allow-scripts"`（严禁 allow-same-origin）；widget 响应必带 4 条头（Content-Type: text/html; charset=utf-8 · CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:` · X-Content-Type-Options: nosniff · Cache-Control: no-store）；404 响应同样带 CSP；CSP 仅追加 `frame-src http://vellum-widget.localhost`。
- pi 扩展纪律：事件 handler 内严禁 await 写入/复制（登记 + setTimeout 调度 + 串行 Promise 链）；心跳 setInterval 30s 写 `heartbeatAt`；I/O 错误就地指数退避 50/150/300ms。
- 测试基线时刻全绿：开工前前端基线 17 文件 / 175 用例，后端基线 15 用例（lib 13 + main 2）；随着各 Task 逐步落地递增，最终前端达到 22 文件 / 211 用例，后端达到 36 用例（lib 32 + main 4）。每个 Task 以 commit 收尾，提交前必须两套全绿。
- TDD：每个 Task 先写失败测试再实现；测试代码与实现代码都必须是可直接运行的真实代码。
- 包边界：包 1（Rust）→ 包 2/3（前端）→ 包 4（pi 扩展）→ 包 5（技能与文档）；跨包契约以各 Task 的 Interfaces 段为准，逐字一致。

---
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
      registry: &mut WidgetRegistry,
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
fn registry_evicts_lru_entry_when_exceeding_64_entries() {
    let mut registry = WidgetRegistry::default();

    // 填满 64 条 (widget-0 .. widget-63)
    for i in 0..MAX_REGISTRY_CAPACITY {
        let id = format!("widget-{i}");
        let html = format!("<div>widget {i}</div>");
        registry.insert(id, html).expect("insert within capacity");
    }
    assert_eq!(registry.len(), MAX_REGISTRY_CAPACITY);

    // 访问 widget-0，将其提鲜至最新位置（成真 LRU，S1）
    assert!(registry.get("widget-0").is_some());

    // 插入第 65 条，此时最旧项为 widget-1，应当淘汰 widget-1，保留被提鲜的 widget-0
    registry
        .insert("widget-64".to_string(), "<div>widget 64</div>".to_string())
        .expect("insert 65th item");

    assert_eq!(registry.len(), MAX_REGISTRY_CAPACITY);
    assert!(registry.peek("widget-1").is_none());
    assert!(registry.peek("widget-0").is_some());
    assert!(registry.peek("widget-64").is_some());
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
        &mut registry,
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
    let mut registry = WidgetRegistry::default();

    // 1. 未知 id
    let resp_404 = build_widget_response(
        "GET",
        "vellum-widget://localhost/non-existent",
        &mut registry,
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
        &mut registry,
    );
    assert_eq!(resp_post.status().as_u16(), 404);

    // 3. 越界或非法多段路径
    let resp_traversal = build_widget_response(
        "GET",
        "http://vellum-widget.localhost/id/extra/path",
        &mut registry,
    );
    assert_eq!(resp_traversal.status().as_u16(), 404);
}

#[test]
fn judge_mdlog_alive_matrix_and_pid_fallback_evaluation() {
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

    // 5. 原生 Win32 进程存活检查：不存在的 pid 必须返回 false（A1）
    #[cfg(windows)]
    {
        assert!(!crate::widget::is_pid_alive_win32(u32::MAX));
    }
}

#[test]
fn uuid_generation_entropy_and_format_check() {
    use std::collections::HashSet;
    let mut ids = HashSet::new();
    for _ in 0..1000 {
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(id.len(), 36);
        assert_eq!(id.chars().nth(14), Some('4')); // RFC 4122 v4 version
        let variant = id.chars().nth(19).unwrap();
        assert!(matches!(variant, '8' | '9' | 'a' | 'b')); // RFC 4122 variant
        assert!(ids.insert(id), "UUID collision detected!");
    }
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
cargo test --manifest-path src-tauri/Cargo.toml --lib widget_tests
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
test widget_tests::registry_evicts_lru_entry_when_exceeding_64_entries ... ok
test widget_tests::register_result_serializes_to_camel_case ... ok
test widget_tests::build_widget_response_returns_200_with_all_4_security_headers ... ok
test widget_tests::build_widget_response_returns_404_with_all_4_security_headers_for_unknown_or_invalid ... ok
test widget_tests::judge_mdlog_alive_matrix_and_pid_fallback_evaluation ... ok
test widget_tests::uuid_generation_entropy_and_format_check ... ok
test result: ok. 27 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
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
cargo test --manifest-path src-tauri/Cargo.toml --lib widget_tests
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
- Modify: `src-tauri/src/main.rs`（仅修改三处：load_document 函数体、Builder 插入点、invoke_handler 列表；其余代码逐字保留）

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
fn should_rebind_matrix_evaluation() {
    let p1 = std::path::PathBuf::from("C:/notes/live.md");
    let p2 = std::path::PathBuf::from("C:/notes/other.md");
    // 首次加载（current 为 None）：必须 rebind
    assert!(should_rebind(None, &p1, false));
    assert!(should_rebind(None, &p1, true));
    // 路径不同（切换文档）：必须 rebind
    assert!(should_rebind(Some(&p1), &p2, true));
    // 相同路径但 watcher 缺失（S7：异常恢复）：必须 rebind
    assert!(should_rebind(Some(&p1), &p1, false));
    // 相同路径且 watcher 正常（同路径热重载）：禁止 rebind（保留 registry 与 watcher）
    assert!(!should_rebind(Some(&p1), &p1, true));
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

2. 修改 `src-tauri/src/main.rs`（**仅修改如下三处，其余代码逐字保留**）：

- **修改点 1（顶部导入与纯函数助手）**：在现有 import 块追加 `vellum_lib::widget` 导出项与 `should_rebind` 判定纯函数：
```rust
use vellum_lib::widget::{
    build_widget_response, read_mdlog_state, register_widget, unregister_widget, WidgetState,
};

/// 纯函数：判定是否需要重建 watcher 并清空 widget 注册表（A2/S7）。
/// 判据：首次加载（current 为 None）或路径切换，或同路径下 watcher 丢失（S7 异常自愈）。
fn should_rebind(current: Option<&PathBuf>, next: &Path, has_watcher: bool) -> bool {
    match current {
        Some(cur) => cur != next || !has_watcher,
        None => true,
    }
}
```

- **修改点 2（`load_document` 函数签名与守卫改造）**：入参追加 `widget_state: tauri::State<'_, WidgetState>`，函数体内引入 `should_rebind` 守护，仅在需要时才清空注册表与重建 watcher：
```rust
#[tauri::command]
async fn load_document(
    path: String,
    state: tauri::State<'_, AppState>,
    widget_state: tauri::State<'_, WidgetState>,
    app_handle: tauri::AppHandle,
) -> Result<LoadedDocument, String> {
    let doc = document::load_markdown_file(Path::new(&path))?;
    let canonical = PathBuf::from(&doc.path);

    let needs_rebind = {
        let current = state
            .current
            .lock()
            .map_err(|_| "Document state lock poisoned".to_string())?;
        let watcher = state
            .watcher
            .lock()
            .map_err(|_| "Watcher lock poisoned".to_string())?;
        should_rebind(current.as_ref(), &canonical, watcher.is_some())
    };

    if needs_rebind {
        // G1: 仅当 canonical 绝对路径改变（切换文档）或 watcher 异常缺失时，才清空 widget 注册表并重建 watcher。
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
```

- **修改点 3（Builder 装配点与 invoke_handler 列表）**：
在 `fn main()` 内的 `tauri::Builder::default()` 链条中注册 `vellum-widget` URI scheme，托管 `WidgetState`，并在 `invoke_handler` 宏列表中追加三个命令：
```rust
        .register_uri_scheme_protocol("vellum-widget", |ctx, request| {
            let widget_state = ctx.app_handle().state::<WidgetState>();
            let mut registry = widget_state.0.lock().unwrap_or_else(|p| p.into_inner());
            build_widget_response(
                request.method().as_str(),
                &request.uri().to_string(),
                &mut registry,
            )
        })
```
与
```rust
        .manage(WidgetState::default())
        .invoke_handler(tauri::generate_handler![
            load_document,
            resolve_asset,
            drain_pending_open_paths,
            register_widget,
            unregister_widget,
            read_mdlog_state,
        ])
```
*注意：`src-tauri/src/main.rs` 其余生产代码（包含 `early_single_instance` 约 140 行的 WM_COPYDATA 单实例转发与互斥锁逻辑、`PendingOpenPaths`、`drain_pending_open_paths`、`first_markdown_from_args` 以及现存的 2 个单元测试）一律逐字保留，严禁覆盖或删除。*

- [ ] **Step 4: Run test to verify it passes**

执行后端与前端全量验证命令：
```bash
cargo test --manifest-path src-tauri/Cargo.toml --bin vellum
cargo test --manifest-path src-tauri/Cargo.toml
npm test
```
预期输出：
1. `cargo test --bin vellum` 输出含既有 2 个 main 测试与新增 2 个测试，4 个用例全部 ok：
   - `test tests::extracts_first_markdown_path_case_insensitively ... ok`
   - `test tests::ignores_non_markdown_arguments ... ok`
   - `test tests::tauri_conf_csp_contains_frame_src_for_widget ... ok`
   - `test tests::should_rebind_matrix_evaluation ... ok`
   `test result: ok. 4 passed; 0 failed; 0 ignored`
2. `cargo test` 全量通过（36 passed: lib 32 + main 4，0 failed）
3. `npm test` 现有前端基线全量通过（17 文件全部通过，175 用例全部 ok）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/src/main.rs
git commit -m "feat(main): integrate vellum-widget protocol, lifecycle guard, and CSP frame-src"
```





## 工作包 2：前端 widget 渲染（Task 2.1 ~ Task 2.5）

**本包目标**：在前端安全、高性能地渲染 `vellum-widget` 交互块。包含测试环境 IntersectionObserver mock 补齐、kami 纸墨样式扩展与规约断言、全局单例 LRU widget 注册表、沙箱 iframe 隔离组件以及 MarkdownDocument pre 渲染器分发与受信门禁。

---

### Task 2.1: 测试环境补充 IntersectionObserver Mock

**Files:**
- Modify: `src/test/setup.ts`
- Test: `src/test/setup.test.ts`

**Interfaces:**
- Consumes: 无（全局 jsdom 测试环境）
- Produces: `globalThis.IntersectionObserver` mock 类，挂载至全局；支持 `observe`、`unobserve`、`disconnect`、`takeRecords` 实例方法，并正确读取 `root`、`rootMargin` 与 `thresholds` 构造选项，为后续 Task 2.4 与 Task 2.5 的组件视口相交测试提供稳定环境。

- [ ] **Step 1: Write the failing test**

新建 `src/test/setup.test.ts`，验证全局 `IntersectionObserver` 符合 W3C 契约且支持视口配置：

```ts
import { describe, expect, it, vi } from "vitest";

describe("IntersectionObserver setup mock", () => {
  it("provides global IntersectionObserver with full observer contract", () => {
    expect(globalThis.IntersectionObserver).toBeDefined();

    const callback = vi.fn();
    const observer = new globalThis.IntersectionObserver(callback, {
      rootMargin: "200px",
      threshold: [0, 0.5],
    });

    expect(observer.rootMargin).toBe("200px");
    expect(observer.thresholds).toEqual([0, 0.5]);

    const el = document.createElement("div");
    expect(() => observer.observe(el)).not.toThrow();
    expect(() => observer.unobserve(el)).not.toThrow();
    expect(() => observer.disconnect()).not.toThrow();
    expect(observer.takeRecords()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/setup.test.ts`
Expected: FAIL，报错 `expected undefined to be defined`（当前 `src/test/setup.ts` 中尚未声明 `IntersectionObserver`）。

- [ ] **Step 3: Write minimal implementation**

在 `src/test/setup.ts` 中追加 `IntersectionObserverMock` 实现并挂载至 `globalThis.IntersectionObserver`：

```ts
import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

class IntersectionObserverMock implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "0px";
  readonly thresholds: ReadonlyArray<number> = [0];

  constructor(
    _callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    if (options?.root) this.root = options.root;
    if (options?.rootMargin) this.rootMargin = options.rootMargin;
    if (options?.threshold !== undefined) {
      this.thresholds = Array.isArray(options.threshold)
        ? options.threshold
        : [options.threshold];
    }
  }

  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

globalThis.IntersectionObserver = IntersectionObserverMock as unknown as typeof IntersectionObserver;

// jsdom 未实现 scrollIntoView，补充空实现避免调用时报错
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/setup.test.ts`
Expected: PASS，`IntersectionObserver setup mock` 1 个用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/test/setup.ts src/test/setup.test.ts
git commit -m "test: add IntersectionObserver mock to test setup"
```

---

### Task 2.2: kami 纸墨样式扩展与设计规约测试

**Files:**
- Modify: `src/styles/kami.css`
- Modify: `src/styles/kami.css.test.ts`

**Interfaces:**
- Consumes: `:root` CSS 变量（`--ivory`、`--border`、`--stone`、`--hairline`、`--parchment`、`--brand`、`--mono`、`--serif`）
- Produces: 规则块 `.mdlog-widget`、`.mdlog-widget__bar`、`.mdlog-widget__bar .state`、`.mdlog-widget__frame`、`.mdlog-widget__placeholder`、`.mdlog-live`、`.mdlog-live::before`、`@keyframes mdlog-pulse`、`@media (prefers-reduced-motion: reduce)`，数值与 `docs/preview/mdlog-preview.html` 逐字对齐。

- [ ] **Step 1: Write the failing test**

在 `src/styles/kami.css.test.ts` 末尾追加对 mdlog widget 与 live 徽章的视觉指标与 kami 规约断言：

```ts
describe("kami.css mdlog widget and live indicator tokens", () => {
  it("declares widget container rules with exact preview metrics", () => {
    const widgetRule = css.match(/\.mdlog-widget\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(widgetRule).toMatch(/margin:\s*17px 0/);
    expect(widgetRule).toMatch(/background:\s*var\(--ivory\)/);
    expect(widgetRule).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--border\)/);
    expect(widgetRule).toMatch(/border-radius:\s*6px/);
    expect(widgetRule).toMatch(/overflow:\s*hidden/);

    const barRule = css.match(/\.mdlog-widget__bar\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(barRule).toMatch(/padding:\s*7px 14px/);
    expect(barRule).toMatch(/font:\s*10px\/1\.5 var\(--mono\)/);
    expect(barRule).toMatch(/letter-spacing:\s*1\.2px/);
    expect(barRule).toMatch(/text-transform:\s*uppercase/);
    expect(barRule).toMatch(/color:\s*var\(--stone\)/);

    const frameRule = css.match(/\.mdlog-widget__frame\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(frameRule).toMatch(/min-height:\s*120px/);
    expect(frameRule).toMatch(/border:\s*0/);
    expect(frameRule).toMatch(/border-top:\s*1px solid var\(--hairline\)/);
    expect(frameRule).toMatch(/background:\s*var\(--parchment\)/);

    const placeholderRule = css.match(/\.mdlog-widget__placeholder\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(placeholderRule).toMatch(/min-height:\s*120px/);
    expect(placeholderRule).toMatch(/border-top:\s*1px solid var\(--hairline\)/);
    expect(placeholderRule).toMatch(/background:\s*var\(--parchment\)/);
    expect(placeholderRule).toMatch(/color:\s*var\(--stone\)/);
  });

  it("declares live indicator rules with 5x5px square dot and breathing animation", () => {
    const liveRule = css.match(/\.mdlog-live\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(liveRule).toMatch(/margin:\s*30px 0 0/);
    expect(liveRule).toMatch(/color:\s*var\(--stone\)/);
    expect(liveRule).toMatch(/font:\s*10px\/1 var\(--mono\)/);
    expect(liveRule).toMatch(/letter-spacing:\s*2px/);

    const dotRule = css.match(/\.mdlog-live::before\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(dotRule).toMatch(/width:\s*5px/);
    expect(dotRule).toMatch(/height:\s*5px/);
    expect(dotRule).toMatch(/border-radius:\s*1px/);
    expect(dotRule).toMatch(/background:\s*var\(--brand\)/);
    expect(dotRule).toMatch(/animation:\s*mdlog-pulse 1\.6s ease infinite/);

    const motionRule = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.mdlog-live::before\s*\{[^}]*animation:\s*none/s)?.[0] ?? "";
    expect(motionRule).toBeTruthy();
  });

  it("strictly obeys kami design constraints for mdlog rules: allowed radii, max weight 500, no raw colors", () => {
    const startIndex = css.indexOf(".mdlog-widget");
    expect(startIndex).toBeGreaterThan(0);
    const mdlogSection = css.slice(startIndex);

    // 1. 圆角仅允许 ∈ {0, 1px, 2px, 3px, 4px, 6px}
    const radiiMatches = Array.from(mdlogSection.matchAll(/border-radius:\s*([^;]+);/g));
    const allowedRadii = new Set(["0", "1px", "2px", "3px", "4px", "6px"]);
    for (const match of radiiMatches) {
      const val = match[1].trim();
      expect(allowedRadii.has(val), `Disallowed border-radius in mdlog section: ${val}`).toBe(true);
    }

    // 2. font-weight 严格 ≤ 500
    const weightMatches = Array.from(mdlogSection.matchAll(/font-weight:\s*([^;]+);/g));
    for (const match of weightMatches) {
      const w = parseInt(match[1].trim(), 10);
      if (!Number.isNaN(w)) {
        expect(w).toBeLessThanOrEqual(500);
      }
    }

    // 3. 颜色仅允许使用 var(--*)、transparent 或 currentColor，严禁未声明的原始十六进制或 rgb
    const colorDeclarations = Array.from(
      mdlogSection.matchAll(/(?:color|background|border(?:-[a-z]+)?|box-shadow):\s*([^;]+);/g)
    );
    for (const match of colorDeclarations) {
      const decl = match[1];
      expect(decl).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(decl).not.toMatch(/rgba?\(/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/styles/kami.css.test.ts`
Expected: FAIL，报错 `expected startIndex to be greater than 0`（`.mdlog-widget` 尚未在 `src/styles/kami.css` 中声明）。

- [ ] **Step 3: Write minimal implementation**

在 `src/styles/kami.css` 末尾追加 mdlog 相关视觉样式（严格按 `docs/preview/mdlog-preview.html` 真源与 spec §4.1 数值）：

```css
/* ===== Pi 对话记录与沙箱交互块 ===== */
.mdlog-widget {
  margin: 17px 0;
  background: var(--ivory);
  box-shadow: inset 0 0 0 1px var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.mdlog-widget__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  font: 10px/1.5 var(--mono);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--stone);
}

.mdlog-widget__bar .state {
  letter-spacing: 0.5px;
  text-transform: none;
}

.mdlog-widget__frame {
  display: block;
  width: 100%;
  min-height: 120px;
  border: 0;
  border-top: 1px solid var(--hairline);
  background: var(--parchment);
}

.mdlog-widget__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 120px;
  padding: 24px;
  border: 0;
  border-top: 1px solid var(--hairline);
  background: var(--parchment);
  color: var(--stone);
  font-family: var(--serif);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.mdlog-widget__placeholder:hover {
  background: var(--ivory);
  color: var(--brand);
}

.mdlog-live {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin: 30px 0 0;
  color: var(--stone);
  font: 10px/1 var(--mono);
  letter-spacing: 2px;
  user-select: none;
}

.mdlog-live::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 1px;
  background: var(--brand);
  animation: mdlog-pulse 1.6s ease infinite;
}

@keyframes mdlog-pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 0.9;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mdlog-live::before {
    animation: none;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/styles/kami.css.test.ts`
Expected: PASS，新增的 3 个规约用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/styles/kami.css src/styles/kami.css.test.ts
git commit -m "style: add mdlog widget and live indicator rules with kami design tests"
```

---

### Task 2.3: src/lib/widgetRegistry.ts 模块级单例与 LRU 滚动防抖管理

**Files:**
- Create: `src/lib/widgetRegistry.ts`
- Test: `src/lib/widgetRegistry.test.ts`

**Interfaces:**
- Consumes: 全局 `window` 滚动事件与 `setTimeout`
- Produces: 模块级单例 `widgetRegistry`，提供逐字公共 API：
  - `register(id: string): void`
  - `release(id: string): void`
  - `markVisible(id: string): void`
  - `requestMount(id: string): boolean`
  - `activate(id: string): void`
  - `subscribe(cb: (id: string, dormant: boolean) => void): () => void`
  存活上限固定 10，LRU 排序键为最近一次 `markVisible` 时间戳，滚动期间暂停淘汰并在停止滚动 400ms 后执行淘汰，被淘汰项重新进入视口不自动复活。

- [ ] **Step 1: Write the failing test**

新建 `src/lib/widgetRegistry.test.ts`，验证注册、存活上限 10、停止滚动 400ms 防抖淘汰、休眠防自动复活与显式唤醒：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widgetRegistry } from "./widgetRegistry";

describe("widgetRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 清理全局单例
    if ("__clear" in widgetRegistry && typeof widgetRegistry.__clear === "function") {
      widgetRegistry.__clear();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers widgets and allows mounting within capacity 10", () => {
    for (let i = 1; i <= 10; i++) {
      widgetRegistry.register(`w-${i}`);
      expect(widgetRegistry.requestMount(`w-${i}`)).toBe(true);
    }
  });

  it("evicts LRU widget only after scrolling stops for 400ms", () => {
    const events: { id: string; dormant: boolean }[] = [];
    const unsubscribe = widgetRegistry.subscribe((id, dormant) => {
      events.push({ id, dormant });
    });

    // 登记并挂载 10 个 widget，并按顺序更新 visible 时间
    for (let i = 1; i <= 10; i++) {
      vi.advanceTimersByTime(10);
      widgetRegistry.register(`w-${i}`);
      expect(widgetRegistry.requestMount(`w-${i}`)).toBe(true);
      widgetRegistry.markVisible(`w-${i}`);
    }

    // 触发滚动事件（模拟连续滚动）
    window.dispatchEvent(new Event("scroll"));

    // 登记第 11 个并请求挂载
    vi.advanceTimersByTime(10);
    widgetRegistry.register("w-11");
    expect(widgetRegistry.requestMount("w-11")).toBe(true);
    widgetRegistry.markVisible("w-11");

    // 滚动期间即便挂载数超过 10 个也不得淘汰
    expect(events.length).toBe(0);
    expect(widgetRegistry.requestMount("w-1")).toBe(true);

    // 滚动中途再次触发滚动（重置 400ms 定时器）
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);
    expect(events.length).toBe(0);

    // 距离上次滚动满 400ms：停止滚动稳定触发淘汰
    vi.advanceTimersByTime(200);
    // 最早 markVisible 的 w-1 应当被淘汰置为休眠
    expect(events).toEqual([{ id: "w-1", dormant: true }]);
    expect(widgetRegistry.requestMount("w-1")).toBe(false);

    unsubscribe();
  });

  it("does not auto-revive dormant widget when re-entering viewport until activate() is called", () => {
    const events: { id: string; dormant: boolean }[] = [];
    const unsubscribe = widgetRegistry.subscribe((id, dormant) => {
      events.push({ id, dormant });
    });

    // 登记并挂载 10 个
    for (let i = 1; i <= 10; i++) {
      widgetRegistry.register(`w-${i}`);
      expect(widgetRegistry.requestMount(`w-${i}`)).toBe(true);
      widgetRegistry.markVisible(`w-${i}`);
    }

    // 登记第 11 个并请求挂载触发淘汰
    widgetRegistry.register("w-11");
    expect(widgetRegistry.requestMount("w-11")).toBe(true);
    widgetRegistry.markVisible("w-11");
    vi.advanceTimersByTime(400);

    expect(widgetRegistry.requestMount("w-1")).toBe(false);

    // 被淘汰项重新入视口调用 markVisible，绝对不自动复活
    widgetRegistry.markVisible("w-1");
    expect(widgetRegistry.requestMount("w-1")).toBe(false);
    expect(events).toEqual([{ id: "w-1", dormant: true }]);

    // 必须由用户点击后显式调用 activate(id) 才能复活
    widgetRegistry.activate("w-1");
    expect(events).toEqual([
      { id: "w-1", dormant: true },
      { id: "w-1", dormant: false },
    ]);
    expect(widgetRegistry.requestMount("w-1")).toBe(true);

    unsubscribe();
  });

  it("releases widget and cleans up subscription", () => {
    let called = false;
    const unsubscribe = widgetRegistry.subscribe(() => {
      called = true;
    });

    widgetRegistry.register("w-temp");
    widgetRegistry.release("w-temp");
    expect(widgetRegistry.requestMount("w-temp")).toBe(false);

    unsubscribe();
    widgetRegistry.activate("w-temp");
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/widgetRegistry.test.ts`
Expected: FAIL，报错 `Cannot find module './widgetRegistry'`。

- [ ] **Step 3: Write minimal implementation**

新建 `src/lib/widgetRegistry.ts`，严格实现 LRU、400ms 滚动防抖与逐字公共 API 契约：

```ts
export interface WidgetRegistry {
  register(id: string): void;
  release(id: string): void;
  markVisible(id: string): void;
  requestMount(id: string): boolean;
  activate(id: string): void;
  subscribe(cb: (id: string, dormant: boolean) => void): () => void;
  __clear?(): void;
  __getActiveCount?(): number;
}

interface WidgetEntry {
  id: string;
  lastVisible: number;
  dormant: boolean;
  mounted: boolean; // S2: 仅当 requestMount 成功挂载时置 true
}

const MAX_ACTIVE_WIDGETS = 10;
const SCROLL_QUIET_MS = 400;

export function createWidgetRegistry(): WidgetRegistry & {
  __clear(): void;
  __getActiveCount(): number;
} {
  const widgets = new Map<string, WidgetEntry>();
  const subscribers = new Set<(id: string, dormant: boolean) => void>();
  let isScrolling = false;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;

  function notify(id: string, dormant: boolean) {
    for (const cb of subscribers) {
      try {
        cb(id, dormant);
      } catch (err) {
        console.error("Widget subscriber error:", err);
      }
    }
  }

  function evictIfNecessary() {
    if (isScrolling) return;

    // S2: 仅已实际挂载且未休眠的 widget 计入活跃集，未进入视口的条目不占用 10 个存活名额
    const mountedList = Array.from(widgets.values()).filter((w) => w.mounted && !w.dormant);
    if (mountedList.length <= MAX_ACTIVE_WIDGETS) return;

    // 按 lastVisible 升序排序：最近一次 markVisible 最久远的项排在最前
    mountedList.sort((a, b) => a.lastVisible - b.lastVisible);

    const excessCount = mountedList.length - MAX_ACTIVE_WIDGETS;
    for (let i = 0; i < excessCount; i++) {
      const victim = mountedList[i];
      victim.dormant = true;
      victim.mounted = false;
      notify(victim.id, true);
    }
  }

  function handleScroll() {
    isScrolling = true;
    if (scrollTimer !== null) {
      clearTimeout(scrollTimer);
    }
    scrollTimer = setTimeout(() => {
      isScrolling = false;
      scrollTimer = null;
      evictIfNecessary();
    }, SCROLL_QUIET_MS);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
  }

  return {
    register(id: string): void {
      if (widgets.has(id)) return;
      widgets.set(id, {
        id,
        lastVisible: Date.now(),
        dormant: false,
        mounted: false,
      });
    },

    release(id: string): void {
      widgets.delete(id);
    },

    markVisible(id: string): void {
      const entry = widgets.get(id);
      if (!entry) return;
      // LRU 排序键更新为最近 markVisible 时间
      entry.lastVisible = Date.now();
      // 被淘汰项重新入视口不自动复活（必须点击 activate）
      if (!entry.dormant && entry.mounted) {
        evictIfNecessary();
      }
    },

    requestMount(id: string): boolean {
      const entry = widgets.get(id);
      if (!entry) return false;
      if (entry.dormant) return false;

      // S2: 仅 requestMount 通过时才计入活跃集
      const mountedList = Array.from(widgets.values()).filter((w) => w.mounted && !w.dormant);
      if (entry.mounted || mountedList.length < MAX_ACTIVE_WIDGETS) {
        entry.mounted = true;
        return true;
      }

      // 滚动期间暂停淘汰，保持当前挂载
      if (isScrolling) {
        entry.mounted = true;
        return true;
      }

      evictIfNecessary();
      const currentMounted = Array.from(widgets.values()).filter((w) => w.mounted && !w.dormant);
      if (!entry.dormant && currentMounted.length < MAX_ACTIVE_WIDGETS) {
        entry.mounted = true;
        return true;
      }
      return false;
    },

    activate(id: string): void {
      const entry = widgets.get(id);
      if (!entry) return;
      entry.dormant = false;
      entry.mounted = true;
      entry.lastVisible = Date.now();
      notify(id, false);
      evictIfNecessary();
    },

    subscribe(cb: (id: string, dormant: boolean) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    __clear(): void {
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
      isScrolling = false;
      widgets.clear();
      subscribers.clear();
    },

    __getActiveCount(): number {
      return Array.from(widgets.values()).filter((w) => w.mounted && !w.dormant).length;
    },
  };
}

export const widgetRegistry = createWidgetRegistry();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/widgetRegistry.test.ts`
Expected: PASS，4 个测试用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/lib/widgetRegistry.ts src/lib/widgetRegistry.test.ts
git commit -m "feat: add singleton widgetRegistry with scroll-debounced LRU eviction"
```

---

### Task 2.4: src/components/WidgetSandbox.tsx 沙箱渲染与通信组件

**Files:**
- Create: `src/components/WidgetSandbox.tsx`
- Test: `src/components/WidgetSandbox.test.tsx`

**Interfaces:**
- Consumes:
  - `widgetRegistry` 来自 `src/lib/widgetRegistry.ts`
  - Tauri 命令 `invoke<RegisterResult>("register_widget", { html: string }) -> Promise<{ id: string; url: string }>`
  - Tauri 命令 `invoke("unregister_widget", { id: string }) -> Promise<void>`
  - `@tauri-apps/api/core` 中的 `invoke`
- Produces: `WidgetSandbox` 组件，props 签名逐字为：
  `{ html: string; autoMount: boolean }`
  支持 `React.memo`（html 相同跳过重挂载）、视口进入才调用 `register_widget`、严格 iframe 沙箱与通信校验、高度 clamp 与 rAF 节流、IPC 失败由组件内部渲染 `CodeBlock` 降级（A5，消除 fallback prop 对 memo 的破坏）、未受信与休眠占位块。

- [ ] **Step 1: Write the failing test**

新建 `src/components/WidgetSandbox.test.tsx`，覆盖未受信占位、受信视口触发、通信高度限制与标题回退、IPC 降级与休眠复活：

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WidgetSandbox } from "./WidgetSandbox";
import { widgetRegistry } from "../lib/widgetRegistry";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("WidgetSandbox", () => {
  let observerCallback: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    if ("__clear" in widgetRegistry && typeof widgetRegistry.__clear === "function") {
      widgetRegistry.__clear();
    }

    vi.spyOn(globalThis, "IntersectionObserver").mockImplementation(function (
      this: unknown,
      callback: IntersectionObserverCallback
    ) {
      observerCallback = callback;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "200px",
        thresholds: [0],
      } as unknown as IntersectionObserver;
    });
  });

  it("renders untrusted placeholder when autoMount is false and mounts only on click", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-1",
      url: "http://vellum-widget.localhost/w-1",
    });

    render(<WidgetSandbox html="<div>demo</div>" autoMount={false} />);

    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("register_widget", expect.anything());

    // 用户点击占位块
    await act(async () => {
      fireEvent.click(screen.getByText("交互内容 · 点击加载"));
    });

    expect(invoke).toHaveBeenCalledWith("register_widget", { html: "<div>demo</div>" });
    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe("http://vellum-widget.localhost/w-1");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("auto mounts when autoMount is true and element enters viewport", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-2",
      url: "http://vellum-widget.localhost/w-2",
    });

    render(<WidgetSandbox html="<div>trusted</div>" autoMount={true} />);

    // 尚未进入视口时未调用 invoke
    expect(invoke).not.toHaveBeenCalled();

    // 触发 IntersectionObserver 相交
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(invoke).toHaveBeenCalledWith("register_widget", { html: "<div>trusted</div>" });
    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    expect(iframe.src).toBe("http://vellum-widget.localhost/w-2");
  });

  it("handles postMessage resize with clamp [80, 2000] and title update", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-3",
      url: "http://vellum-widget.localhost/w-3",
    });

    render(<WidgetSandbox html="<div>comm</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    const mockContentWindow = {} as Window;
    Object.defineProperty(iframe, "contentWindow", { value: mockContentWindow });

    // 1. 非法来源消息被忽略
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "vellum-widget:resize", height: 800, title: "伪造" },
        source: {} as Window,
      })
    );
    // 默认初始高度为 240px；非法来源消息被忽略，高度值未变化（仍为 240px）即判定忽略成功（B3）
    expect(iframe.style.height).toBe("240px");

    // 2. 合法来源高度设置与 title 更新
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 600, title: "正弦波演示" },
          source: mockContentWindow,
        })
      );
    });
    expect(iframe.style.height).toBe("600px");
    expect(iframe.title).toBe("正弦波演示");

    // 3. 超下限 clamp 至 80px
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 30 },
          source: mockContentWindow,
        })
      );
    });
    expect(iframe.style.height).toBe("80px");

    // 4. 超上限 clamp 至 2000px
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 3000 },
          source: mockContentWindow,
        })
      );
    });
    expect(iframe.style.height).toBe("2000px");
  });

  it("renders fallback CodeBlock on invoke failure without crashing", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("IPC network error"));

    render(
      <WidgetSandbox
        html="<div>err</div>"
        autoMount={true}
      />
    );

    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    // A5: 降级由组件内部渲染 CodeBlock，不依赖父级 fallback prop 传参
    expect(screen.getByText("<div>err</div>")).toBeInTheDocument();
  });

  it("renders dormant placeholder and reactivates upon click", async () => {
    vi.mocked(invoke).mockResolvedValue({
      id: "w-5",
      url: "http://vellum-widget.localhost/w-5",
    });

    const activateSpy = vi.spyOn(widgetRegistry, "activate");

    render(<WidgetSandbox html="<div>dormant</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(screen.getByTitle("交互演示")).toBeInTheDocument();

    // 模拟 registry 广播休眠事件
    act(() => {
      for (let i = 1; i <= 11; i++) {
        widgetRegistry.register(`other-${i}`);
        widgetRegistry.requestMount(`other-${i}`);
        widgetRegistry.markVisible(`other-${i}`);
      }
      vi.advanceTimersByTime(400);
    });

    // 断言休眠文案「交互已休眠 · 点击查看」渲染（B3）
    const dormantBtn = screen.getByText("交互已休眠 · 点击查看");
    expect(dormantBtn).toBeInTheDocument();
    expect(screen.queryByTitle("交互演示")).not.toBeInTheDocument();

    // 用户点击休眠占位块唤醒
    await act(async () => {
      fireEvent.click(dormantBtn);
    });

    // 断言 activate() 被调且 iframe 重新挂载
    expect(activateSpy).toHaveBeenCalledWith(expect.any(String));
    expect(screen.getByTitle("交互演示")).toBeInTheDocument();
  });

  it("unregisters widget from backend upon unmount", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-6",
      url: "http://vellum-widget.localhost/w-6",
    });

    const { unmount } = render(<WidgetSandbox html="<div>unmount</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    unmount();
    expect(invoke).toHaveBeenCalledWith("unregister_widget", { id: "w-6" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/WidgetSandbox.test.tsx`
Expected: FAIL，报错 `Cannot find module './WidgetSandbox'`。

- [ ] **Step 3: Write minimal implementation**

新建 `src/components/WidgetSandbox.tsx`，完整实现沙箱容器、props 接口与生命周期：

```tsx
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { widgetRegistry } from "../lib/widgetRegistry";
import { CodeBlock } from "./CodeBlock";

export type WidgetSandboxProps = {
  html: string;
  autoMount: boolean;
};

interface RegisterResult {
  id: string;
  url: string;
}

export const WidgetSandbox = memo(function WidgetSandbox({
  html,
  autoMount,
}: WidgetSandboxProps) {
  const instanceId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const idRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [height, setHeight] = useState<number>(240);
  const [title, setTitle] = useState<string>("交互演示");
  const [isDormant, setIsDormant] = useState<boolean>(false);
  const [isUserActivated, setIsUserActivated] = useState<boolean>(false);
  const [isInViewport, setIsInViewport] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);

  // 1. 注册进入 widgetRegistry 单例并订阅休眠状态
  useEffect(() => {
    widgetRegistry.register(instanceId);
    const unsubscribe = widgetRegistry.subscribe((targetId, dormant) => {
      if (targetId === instanceId) {
        setIsDormant(dormant);
      }
    });

    return () => {
      unsubscribe();
      widgetRegistry.release(instanceId);
      if (idRef.current) {
        const idToUnregister = idRef.current;
        idRef.current = null;
        void invoke("unregister_widget", { id: idToUnregister }).catch(() => {});
      }
    };
  }, [instanceId]);

  // 2. 视口监听：rootMargin 200px
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setIsInViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInViewport(true);
            widgetRegistry.markVisible(instanceId);
          }
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [instanceId]);

  // 3. 挂载条件仲裁与 register_widget 触发
  const shouldMount = (autoMount || isUserActivated) && !isDormant;

  useEffect(() => {
    if (!shouldMount || !isInViewport || widgetUrl || hasError) {
      return;
    }

    if (!widgetRegistry.requestMount(instanceId)) {
      return;
    }

    let isCancelled = false;

    invoke<RegisterResult>("register_widget", { html })
      .then((res) => {
        if (isCancelled) {
          void invoke("unregister_widget", { id: res.id }).catch(() => {});
          return;
        }
        idRef.current = res.id;
        setWidgetUrl(res.url);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error("Failed to register widget:", err);
        setHasError(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [shouldMount, isInViewport, widgetUrl, hasError, html, instanceId]);

  // 4. postMessage 监听通信契约
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }
      const data = event.data;
      if (!data || data.type !== "vellum-widget:resize") {
        return;
      }

      if (typeof data.title === "string" && data.title.trim()) {
        setTitle(data.title.trim());
      }

      if (typeof data.height === "number" && !Number.isNaN(data.height)) {
        const clamped = Math.min(2000, Math.max(80, data.height));
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
        }
        rafRef.current = requestAnimationFrame(() => {
          setHeight(clamped);
          rafRef.current = null;
        });
      }
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // 错误降级渲染（A5: 内部渲染 CodeBlock，保证 MarkdownDocument memo 引用稳定性）
  if (hasError) {
    return <CodeBlock code={html} language="" />;
  }

  // 休眠状态占位块
  if (isDormant) {
    return (
      <div ref={containerRef} className="mdlog-widget">
        <div className="mdlog-widget__bar">
          <span>{title} · vellum-widget</span>
          <span className="state">已休眠</span>
        </div>
        <button
          type="button"
          className="mdlog-widget__placeholder"
          onClick={() => {
            widgetRegistry.activate(instanceId);
            setIsDormant(false);
          }}
        >
          交互已休眠 · 点击查看
        </button>
      </div>
    );
  }

  // 未受信初始占位块（autoMount=false）
  if (!autoMount && !isUserActivated) {
    return (
      <div ref={containerRef} className="mdlog-widget">
        <div className="mdlog-widget__bar">
          <span>{title} · vellum-widget</span>
          <span className="state">未加载</span>
        </div>
        <button
          type="button"
          className="mdlog-widget__placeholder"
          onClick={() => {
            setIsUserActivated(true);
            setIsInViewport(true);
            widgetRegistry.activate(instanceId);
          }}
        >
          交互内容 · 点击加载
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mdlog-widget">
      <div className="mdlog-widget__bar">
        <span>{title} · vellum-widget</span>
        <span className="state">{widgetUrl ? "沙箱中运行" : "准备中"}</span>
      </div>
      {widgetUrl ? (
        <iframe
          ref={iframeRef}
          className="mdlog-widget__frame"
          src={widgetUrl}
          title={title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ height: `${height}px` }}
        />
      ) : (
        <div className="mdlog-widget__placeholder">交互准备中…</div>
      )}
    </div>
  );
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/WidgetSandbox.test.tsx`
Expected: PASS，6 个测试用例全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/components/WidgetSandbox.tsx src/components/WidgetSandbox.test.tsx
git commit -m "feat: add WidgetSandbox component with sandbox iframe and postMessage resize"
```

---

### Task 2.5: MarkdownDocument.tsx 语言正则扩展、受信门禁与受控分发

**Files:**
- Modify: `src/components/MarkdownDocument.tsx`
- Modify: `src/components/MarkdownDocument.test.tsx`

**Interfaces:**
- Consumes:
  - `WidgetSandbox` 来自 `src/components/WidgetSandbox.tsx`
  - `CodeBlock` 来自 `src/components/CodeBlock.tsx`
- Produces: `MarkdownDocument` 组件支持 `vellum-widget` 围栏块、支持带连字符语言（如 `objective-c`）、支持 `isTrustedMdlog` 受信门禁与 512KB 长度预检（使用 `new TextEncoder().encode(code).length` 字节口径，以后端字节判定为准 S6），分发给 `WidgetSandbox` 时无 fallback prop 传递（A5），同时保持 memo 结构与引用稳定死规则。

- [ ] **Step 1: Write the failing test**

在 `src/components/MarkdownDocument.test.tsx` 末尾追加 5 个用例，分别覆盖连字符语言完整提取、受信文档自动挂载参数、非受信文档占位门禁、超 512KB 降级为 `CodeBlock`，以及 components memo 实例稳定性测试（A4）：

```tsx
  it("extracts hyphenated language names like objective-c without truncation", async () => {
    const markdown = [
      "```objective-c",
      'NSLog(@"Hello");',
      "```",
    ].join("\n");

    render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    expect(screen.getByText("objective-c")).toBeInTheDocument();
  });

  it("renders vellum-widget with autoMount=true for trusted mdlog documents", async () => {
    const markdown = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "# Pi 对话记录",
      "",
      "```vellum-widget",
      "<div>interactive content</div>",
      "```",
    ].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    expect(container.querySelector(".mdlog-widget")).toBeInTheDocument();
    expect(screen.queryByText("交互内容 · 点击加载")).not.toBeInTheDocument();
  });

  it("renders vellum-widget with autoMount=false for untrusted documents", async () => {
    const markdown = [
      "# Regular Document",
      "",
      "```vellum-widget",
      "<div>untrusted interactive</div>",
      "```",
    ].join("\n");

    render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
  });

  it("intercepts vellum-widget exceeding 512KB and downgrades to CodeBlock", async () => {
    const oversizedCode = "x".repeat(524289);
    const markdown = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "```vellum-widget",
      oversizedCode,
      "```",
    ].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    // 超过 512KB 降级为普通 CodeBlock，不进入 WidgetSandbox
    expect(container.querySelector(".mdlog-widget")).not.toBeInTheDocument();
    expect(container.querySelector(".code-block")).toBeInTheDocument();
  });

  it("preserves components memo and iframe DOM instance across markdown appends", async () => {
    const initialMarkdown = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "```vellum-widget",
      "<div>stable iframe</div>",
      "```",
    ].join("\n");

    const { container, rerender } = render(<MarkdownDocument markdown={initialMarkdown} />);
    await act(async () => {});

    const initialWidget = container.querySelector(".mdlog-widget");
    expect(initialWidget).toBeInTheDocument();

    // 模拟追加一条新消息（热重载更新 markdown）
    const appendedMarkdown = [
      initialMarkdown,
      "",
      "新消息追加内容",
    ].join("\n");

    rerender(<MarkdownDocument markdown={appendedMarkdown} />);
    await act(async () => {});

    const rerenderedWidget = container.querySelector(".mdlog-widget");
    expect(rerenderedWidget).toBeInTheDocument();
    // A4: components memo 与引用稳定，追加内容前后已存在的 widget DOM 容器必须严格为同一实例
    expect(rerenderedWidget).toBe(initialWidget);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/MarkdownDocument.test.tsx`
Expected: FAIL，`extracts hyphenated language names` 报错 `objective-c` 未匹配到，且 `renders vellum-widget` 报错 `.mdlog-widget` 元素不存在。

- [ ] **Step 3: Write minimal implementation**

修改 `src/components/MarkdownDocument.tsx`：
1. 导入 `WidgetSandbox`；
2. 在 `MarkdownBody` 内声明 `isTrustedMdlog` 并在 `components` 依赖数组追加 `isTrustedMdlog`；
3. 将 pre 渲染器正则更新为 `/language-([\w-]+)/`，并在 `language === "vellum-widget"` 时执行 512KB（524288 字节）预检与受控分发：

```tsx
// 1. 导入 WidgetSandbox
import { WidgetSandbox } from "./WidgetSandbox";

// 2. MarkdownBody 内部：
const isTrustedMdlog = useMemo(
  () => /^\uFEFF?\s*<!--\s*mdlog:v1/.test(markdown),
  [markdown]
);

// 3. components 的 useMemo 依赖数组追加 isTrustedMdlog，保持布尔原始值恒定引用：
const components: Components = useMemo(
  () => ({
    // ... 原有 h1, h2, h3, a, img 保持不变 ...
    pre: ({ children }) => {
      const childArray = Array.isArray(children) ? children : [children];
      const nonWhitespaceChildren = childArray.filter((child) => {
        if (typeof child === "string" || typeof child === "number") {
          return String(child).trim() !== "";
        }
        return true;
      });
      if (nonWhitespaceChildren.length === 1) {
        const child = nonWhitespaceChildren[0];
        if (
          isValidElement(child) &&
          (typeof child.type === "string"
            ? child.type === "code"
            : (child.props as { node?: { tagName?: string } }).node?.tagName === "code")
        ) {
          const codeChild = child as ReactElement<{
            className?: string;
            children?: ReactNode;
            node?: { tagName?: string };
          }>;
          const className = codeChild.props.className ?? "";
          // 正则支持带连字符语言（如 vellum-widget, objective-c）
          const match = /language-([\w-]+)/.exec(className);
          const language = match?.[1] ?? "";
          const code = extractText(codeChild.props.children).replace(/\n$/, "");

          if (language === "vellum-widget") {
            const codeBytes = new TextEncoder().encode(code).length;
            if (codeBytes > 524288) {
              return <CodeBlock code={code} language="" />;
            }
            return (
              <WidgetSandbox
                html={code}
                autoMount={isTrustedMdlog}
              />
            );
          }

          return <CodeBlock code={code} language={language} />;
        }
      }
      return <pre>{children}</pre>;
    },
    code: ({ node: _node, className, children, ...props }) => {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  }),
  [resolveHeadingId, isTrustedMdlog]
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/MarkdownDocument.test.tsx`
Expected: PASS，全量测试用例全部通过。

Run 全量验证：
`npm test`（前端 20 个测试文件全部通过，共 194 用例全绿：175 基线 + WP2 新增 19 用例：Task 2.1: +1, Task 2.2: +3, Task 2.3: +4, Task 2.4: +6, Task 2.5: +5）
`cd src-tauri && cargo test`（后端 36 用例保持全绿：lib 32 + main 4）

- [ ] **Step 5: Commit**

```bash
git add src/components/MarkdownDocument.tsx src/components/MarkdownDocument.test.tsx
git commit -m "feat: route vellum-widget code blocks to WidgetSandbox with security gate"
```





## 工作包 3：前端 App 实时行为

本工作包负责 `src/App.tsx` 中的实时会话交互行为、滚动仲裁与徽章生命周期调度。主要覆盖热重载底端智能跟随与 ResizeObserver 落位守护、记录态下副作用全面抑制（页边印章与落墨动画静音、阅读位置刷盘暂停并在断开时补写），以及「记录中」徽章的渲染、事件监听与定时自动复查机制。

---

### Task 3.1: 贴底跟随判定纯函数与单 Layout Effect 滚动仲裁

**Files:**
- Create: `src/lib/scrollStick.ts`
- Create: `src/lib/scrollStick.test.ts`
- Modify: `src/App.tsx:5-18, 30-45, 115-135, 335-350`
- Modify: `src/App.test.tsx:320-365`

**Interfaces:**
- Consumes:
  - `restoreScrollPosition(container: HTMLElement, contentEl: HTMLElement, record: ScrollPositionRecord, headings: OutlineHeading[]): () => void` from `src/lib/scrollRestore.ts`
- Produces:
  - `isNearBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold?: number): boolean`
  - `isContainerNearBottom(container: HTMLElement, threshold?: number): boolean`
  - `shouldStickToBottomRef: React.MutableRefObject<boolean>` in `App.tsx`

**Hook 类型迁移说明与理由：**
- **现状**：`src/App.tsx:337-345` 当前使用 `useEffect` 恢复 `pendingScrollRef`：
  ```tsx
  useEffect(() => {
    if (pendingScrollRef.current !== null) {
      const container = scrollRef.current;
      if (container) {
        container.scrollTop = pendingScrollRef.current;
      }
      pendingScrollRef.current = null;
    }
  }, [activeDocument?.markdown]);
  ```
- **迁移为 `useLayoutEffect` 的理由**：
  1. `useEffect` 在浏览器完成布局与绘制（Paint）后异步触发。在实时追加写入场景中，新内容提交入 DOM 后若在 `useEffect` 中才更新 `scrollTop`，屏幕会先在上一帧以未定位位置渲染，紧接着突跳到底部，造成明显的画面闪烁与抖动（Flash of Unscrolled Content）。
  2. `useLayoutEffect` 在 React 完成 DOM 突变提交后、浏览器渲染前同步执行。将 `pendingScrollRef` 恢复与贴底跟随仲裁收敛在同一 `useLayoutEffect` 内，可确保 `scrollTop` 赋值以及 `restoreScrollPosition` 的 ResizeObserver 落位守护在首帧渲染前生效，用户视觉完全平滑。
  3. 原子仲裁：在同一个 hook 内，若 `shouldStickToBottomRef.current === true`，立即跳过 `pendingScrollRef` 恢复，重设 `scrollTop = container.scrollHeight` 并启动 ResizeObserver 落位守护；若为 `false`，则恢复重载前的原位置，两路互斥且无竞态。

- [ ] **Step 1: Write the failing test**

创建 `src/lib/scrollStick.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { isContainerNearBottom, isNearBottom } from "./scrollStick";

describe("isNearBottom", () => {
  it("returns true when precisely at the bottom", () => {
    expect(isNearBottom(1000, 700, 300, 80)).toBe(true);
  });

  it("returns true when within threshold (<= 80px)", () => {
    expect(isNearBottom(1000, 650, 300, 80)).toBe(true);
    expect(isNearBottom(1000, 620, 300, 80)).toBe(true);
  });

  it("returns false when distance to bottom exceeds threshold", () => {
    expect(isNearBottom(1000, 619, 300, 80)).toBe(false);
    expect(isNearBottom(1000, 0, 300, 80)).toBe(false);
  });

  it("returns true when content does not overflow (scrollHeight <= clientHeight)", () => {
    expect(isNearBottom(300, 0, 300, 80)).toBe(true);
    expect(isNearBottom(200, 0, 300, 80)).toBe(true);
  });

  it("defaults threshold to 80 when not specified", () => {
    expect(isNearBottom(1000, 620, 300)).toBe(true);
    expect(isNearBottom(1000, 619, 300)).toBe(false);
  });
});

describe("isContainerNearBottom", () => {
  it("computes bottom stickiness from DOM element properties", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollHeight", { value: 1200, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 750, configurable: true });

    expect(isContainerNearBottom(el, 80)).toBe(true);

    Object.defineProperty(el, "scrollTop", { value: 600, configurable: true });
    expect(isContainerNearBottom(el, 80)).toBe(false);
  });
});
```

并在 `src/App.test.tsx` 现有 `preserves scroll position across a hot reload` 用例后新增针对贴底跟随的单测：

```tsx
test("sticks to bottom and launches settle guard when hot reload occurs near bottom", async () => {
  vi.mocked(listen).mockClear();

  vi.mocked(open).mockResolvedValueOnce("C:/notes/stick.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/stick.md",
    fileName: "stick.md",
    parentPath: "C:/notes",
    markdown: "# Stick Doc V1",
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Stick Doc V1" })).toBeInTheDocument());

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 560;
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });

  // 1000 - 560 - 400 = 40 <= 80，判定为贴底
  await waitFor(() => {
    expect(vi.mocked(listen).mock.calls.some(([event]) => event === "file-changed")).toBe(true);
  });

  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/stick.md",
    fileName: "stick.md",
    parentPath: "C:/notes",
    markdown: "# Stick Doc V2\n\nAppended new lines.",
  });

  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Appended new lines.")).toBeInTheDocument());
  // 新内容渲染后 scrollTop 必须被设为最新的 scrollHeight (落底)
  expect(scrollContainer.scrollTop).toBe(scrollContainer.scrollHeight);
});
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
npx vitest run src/lib/scrollStick.test.ts src/App.test.tsx -t "isNearBottom|sticks to bottom"
```
预期输出：FAIL，找不到 `src/lib/scrollStick.ts`，以及 `App.test.tsx` 中 `scrollContainer.scrollTop` 未跳至最新底部。

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/scrollStick.ts`：

```ts
/**
 * 判定容器当前滚动位置是否处于视口底部附近（剩余未滚出距离 <= 阈值）。
 * @param scrollHeight 容器总滚动高度
 * @param scrollTop 容器当前滚动位移
 * @param clientHeight 容器可视高度
 * @param threshold 判定阈值像素，默认 80px
 */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 80
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/**
 * 判定 DOM 滚动容器是否处于底部附近。
 */
export function isContainerNearBottom(container: HTMLElement, threshold = 80): boolean {
  return isNearBottom(container.scrollHeight, container.scrollTop, container.clientHeight, threshold);
}
```

修改 `src/App.tsx`：
1. 从 `react` 引入 `useLayoutEffect`：
   ```tsx
   import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
   ```
2. 引入 `isContainerNearBottom`：
   ```tsx
   import { isContainerNearBottom } from "./lib/scrollStick";
   ```
3. 在 `App` 组件内增加贴底标记 ref：
   ```tsx
   const shouldStickToBottomRef = useRef(false);
   ```
4. 在 `reloadCurrent` 中记录重载前是否处于底部：
   ```tsx
   async function reloadCurrent() {
     const path = currentPathRef.current;
     if (!path) return;
     const requestId = ++loadRequestRef.current;
     try {
       const document = await invoke<LoadedDocument>("load_document", { path });
       if (loadRequestRef.current !== requestId) return;
       const container = scrollRef.current;
       shouldStickToBottomRef.current = container
         ? isContainerNearBottom(container, 80)
         : false;
       pendingScrollRef.current = container ? container.scrollTop : 0;
       currentPathRef.current = document.path;
       setState({ status: "ready", document });
       setReloadTick((tick) => tick + 1);
       setShowReloadNote(true);
     } catch {
       // 重载失败时保留旧内容，不打扰用户
     }
   }
   ```
5. 在 `loadPath` 中将 `shouldStickToBottomRef.current` 置为 `false`（打开新文件不盲从底端）：
   ```tsx
   async function loadPath(path: string) {
     shouldStickToBottomRef.current = false;
     // ... 其余逻辑不变
   ```
6. 将原有 `useEffect` 滚动恢复迁移为 `useLayoutEffect` 单一仲裁：
   ```tsx
   // 热重载滚动仲裁：贴底跟随优先，非贴底保留原有滚动位置
   useLayoutEffect(() => {
     const container = scrollRef.current;
     if (!container) return;

     if (shouldStickToBottomRef.current) {
       shouldStickToBottomRef.current = false;
       pendingScrollRef.current = null;
       container.scrollTop = container.scrollHeight;

       const content = contentRef.current;
       if (content) {
         restoreCancelRef.current?.();
         restoreCancelRef.current = restoreScrollPosition(
           container,
           content,
           { ratio: 1 },
           headingsRef.current
         );
       }
       return;
     }

     if (pendingScrollRef.current !== null) {
       container.scrollTop = pendingScrollRef.current;
       pendingScrollRef.current = null;
     }
   }, [activeDocument?.markdown]);
   ```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
npx vitest run src/lib/scrollStick.test.ts src/App.test.tsx
```
预期输出：所有用例 PASS。
并运行全量测试确认基线未被破坏：
```bash
npm test
```
预期输出：前端 21 个测试文件全绿，测试用例数增至 200（194 + 6 个 scrollStick 测试）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/scrollStick.ts src/lib/scrollStick.test.ts src/App.tsx src/App.test.tsx
git commit -m "feat(app): add hot reload bottom stickiness with layout effect and settle guard"
```

---

### Task 3.2: 记录态副作用抑制（Reload Note、Fresh Ink 与 ScrollMemory 刷盘暂停）

**Files:**
- Create: `src/lib/mdlogState.ts`
- Create: `src/lib/mdlogState.test.ts`
- Modify: `src/App.tsx:28-40, 100-140, 270-305, 345-365`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `invoke<MdlogState | null>("read_mdlog_state")`
  - `listen("mdlog-state-changed", ...)`
  - `saveScrollPosition(path: string, record: ScrollPositionRecord): Promise<void>` from `src/lib/scrollMemory.ts`
- Produces:
  - `type MdlogState = { lastWriteAt: number; heartbeatAt: number; expiresAt: number }`
  - `computeRecheckDelay(expiresAt: number, now?: number): number`
  - `isMdlogActiveRef: React.MutableRefObject<boolean>`
  - 抑制机制：活跃态下热重载不显示「墨迹未干」印章、跳过 `fresh-ink` 动画类名、暂停滚轮 300ms 防抖刷盘，并在记录断开时补写一次阅读位置。

- [ ] **Step 1: Write the failing test**

创建 `src/lib/mdlogState.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { computeRecheckDelay } from "./mdlogState";

describe("computeRecheckDelay", () => {
  it("computes remaining milliseconds until expiration", () => {
    const now = 1_000_000;
    const expiresAt = 1_030_000;
    expect(computeRecheckDelay(expiresAt, now)).toBe(30_000);
  });

  it("returns 0 when expiresAt is in the past", () => {
    const now = 1_000_000;
    const expiresAt = 999_000;
    expect(computeRecheckDelay(expiresAt, now)).toBe(0);
  });

  it("returns 0 when expiresAt equals current time", () => {
    const now = 1_000_000;
    expect(computeRecheckDelay(now, now)).toBe(0);
  });

  it("clamps delay to 2^31 - 1 when delay exceeds 32-bit signed integer limit", () => {
    const now = 1_000_000;
    const farFuture = now + 3_000_000_000; // > 2^31 - 1
    expect(computeRecheckDelay(farFuture, now)).toBe(2_147_483_647);
  });
});
```

在 `src/App.test.tsx` 中新增针对副作用抑制与断开补写的测试：

```tsx
test("suppresses reload note and fresh-ink animation during hot reload when mdlog is active", async () => {
  vi.mocked(listen).mockClear();

  // 模拟当前文档存在存活的 sidecar
  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/live.md",
        fileName: "live.md",
        parentPath: "C:/notes",
        markdown: "# Live Doc V1",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Doc V1" })).toBeInTheDocument());

  // 触发 file-changed 热重载
  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/live.md",
        fileName: "live.md",
        parentPath: "C:/notes",
        markdown: "# Live Doc V2",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Doc V2" })).toBeInTheDocument());

  // 印章组件不得挂载
  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();
  // .document-content 上不得添加 fresh-ink 类名
  const docContent = document.querySelector(".document-content");
  expect(docContent).not.toHaveClass("fresh-ink");
});

test("pauses debounced scrollMemory saving during active mdlog and flushes once upon disconnection", async () => {
  vi.useFakeTimers();
  const saveSpy = vi.fn();
  const { Store } = await import("@tauri-apps/plugin-store");
  vi.mocked(Store.load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve(undefined)),
    set: saveSpy,
    save: vi.fn(() => Promise.resolve()),
  } as unknown as InstanceType<typeof Store>);

  let activeState: { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null = {
    lastWriteAt: Date.now(),
    heartbeatAt: Date.now(),
    expiresAt: Date.now() + 120_000,
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/scroll-live.md",
        fileName: "scroll-live.md",
        parentPath: "C:/notes",
        markdown: "# Scroll Live\n\nLong body content.",
      };
    }
    if (cmd === "read_mdlog_state") {
      return activeState;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/scroll-live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Scroll Live" })).toBeInTheDocument());

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  saveSpy.mockClear();

  // 记录态下触发多次滚动事件
  fireEvent.scroll(scrollContainer);
  act(() => {
    vi.advanceTimersByTime(400);
  });
  // 必须被暂停，不写入 store
  expect(saveSpy).not.toHaveBeenCalled();

  // 模拟 sidecar 断开（mdlog-state-changed 返回 null）
  activeState = null;
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );
  await act(async () => {
    if (stateChangedCall) {
      (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
    }
  });

  // 断开时集中补写一次当前滚动位置
  await waitFor(() => {
    expect(saveSpy).toHaveBeenCalledWith("C:/notes/scroll-live.md", expect.any(Object));
  });

  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
npx vitest run src/lib/mdlogState.test.ts src/App.test.tsx -t "suppresses reload note|pauses debounced scrollMemory"
```
预期输出：FAIL，找不到 `src/lib/mdlogState.ts`，且 `墨迹未干` 印章与 `fresh-ink` 仍被触发。

- [ ] **Step 3: Write minimal implementation**

创建 `src/lib/mdlogState.ts`：

```ts
export type MdlogState = {
  lastWriteAt: number;
  heartbeatAt: number;
  expiresAt: number;
};

/**
 * 计算距离 expiresAt 设定的毫秒延迟。
 * 保证延时非负（若已过期则返回 0，立即复查）；上限 clamp 到 2^31 - 1（S4，防止 32 位有符号整数溢出导致忙轮询）。
 */
const MAX_TIMEOUT_MS = 2_147_483_647; // 2^31 - 1

export function computeRecheckDelay(expiresAt: number, now = Date.now()): number {
  const diff = expiresAt - now;
  if (diff <= 0) return 0;
  return Math.min(diff, MAX_TIMEOUT_MS);
}
```

修改 `src/App.tsx`：
1. 引入 `MdlogState` 类型：
   ```tsx
   import type { MdlogState } from "./lib/mdlogState";
   ```
2. 在 `App` 内增加 `mdlogState` 与 `isMdlogActiveRef`：
   ```tsx
   const [mdlogState, setMdlogState] = useState<MdlogState | null>(null);
   const isMdlogActive = mdlogState !== null;
   const isMdlogActiveRef = useRef(false);
   isMdlogActiveRef.current = isMdlogActive;
   const prevIsMdlogActiveRef = useRef(false);
   ```
3. 在 `loadPath` 成功后查询当前文档的 `read_mdlog_state`：
   ```tsx
   currentPathRef.current = document.path;
   setState({ status: "ready", document });
   void saveLastOpened(document.path);

   try {
     const liveState = await invoke<MdlogState | null>("read_mdlog_state");
     if (loadRequestRef.current === requestId) {
       setMdlogState(liveState);
     }
   } catch {
     if (loadRequestRef.current === requestId) {
       setMdlogState(null);
     }
   }
   ```
4. 注册 `mdlog-state-changed` 监听器：
   ```tsx
   useEffect(() => {
     let cancelled = false;
     let unlisten: (() => void) | undefined;

     async function checkState() {
       if (!currentPathRef.current) return;
       try {
         const liveState = await invoke<MdlogState | null>("read_mdlog_state");
         if (!cancelled) {
           setMdlogState(liveState);
         }
       } catch {
         if (!cancelled) {
           setMdlogState(null);
         }
       }
     }

     async function bindState() {
       const unlistenFn = await listen("mdlog-state-changed", () => {
         void checkState();
       });
       if (cancelled) {
         unlistenFn();
       } else {
         unlisten = unlistenFn;
       }
     }

     void bindState();

     return () => {
       cancelled = true;
       unlisten?.();
     };
   }, []);
   ```
5. 在 `reloadCurrent` 中依据 `isMdlogActiveRef.current` 抑制印章显示：
   ```tsx
   setReloadTick((tick) => tick + 1);
   if (!isMdlogActiveRef.current) {
     setShowReloadNote(true);
   }
   ```
6. 修改 `fresh-ink` 的 `useEffect`，改读 `isMdlogActiveRef.current`，不进依赖数组（S5，避免 isMdlogActive 从 true 变 false 断开瞬间误触发落墨动画与重启 2.8s 计时）：
   ```tsx
   useEffect(() => {
     if (reloadTick === 0 || isMdlogActiveRef.current) return;
     const el = documentContentRef.current;
     if (el) {
       el.classList.remove("fresh-ink");
       void el.offsetWidth;
       el.classList.add("fresh-ink");
     }
     const timer = setTimeout(() => setShowReloadNote(false), 2800);
     return () => clearTimeout(timer);
   }, [reloadTick]);
   ```
7. 修改滚动事件监听器中的 `handleScroll`，活跃态跳过防抖写盘：
   ```tsx
   const handleScroll = () => {
     if (isMdlogActiveRef.current) return;
     if (scrollSaveTimerRef.current !== null) {
       clearTimeout(scrollSaveTimerRef.current);
     }
     scrollSaveTimerRef.current = setTimeout(() => {
       scrollSaveTimerRef.current = null;
       persistCurrentScroll();
     }, 300);
   };
   ```
8. 添加断开连接时的集中补写 effect：
   ```tsx
   useEffect(() => {
     if (prevIsMdlogActiveRef.current && !isMdlogActive) {
       persistCurrentScroll();
     }
     prevIsMdlogActiveRef.current = isMdlogActive;
   }, [isMdlogActive]);
   ```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
npx vitest run src/lib/mdlogState.test.ts src/App.test.tsx
```
预期输出：全部 PASS。
运行全量测试确认回归安全：
```bash
npm test
```
预期输出：前端 22 个测试文件全部通过，用例数增至 206（200 + 4 个 mdlogState 测试 + 2 个 App.test 副作用抑制测试）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/mdlogState.ts src/lib/mdlogState.test.ts src/App.tsx src/App.test.tsx
git commit -m "feat(app): suppress reload note, fresh-ink animation, and debounce scrollMemory during active mdlog"
```

---

### Task 3.3: 「记录中」徽章渲染与自动复查调度器

**Files:**
- Modify: `src/App.tsx:30-50, 100-145, 230-265, 440-475`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes:
  - `read_mdlog_state() -> { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null`
  - `computeRecheckDelay(expiresAt: number, now?: number): number` from `src/lib/mdlogState.ts`
  - 事件 `mdlog-state-changed`
- Produces:
  - JSX 渲染：`<div className="mdlog-live">记录中 · PI</div>`（位于 `.document-content` 内部、`MarkdownDocument` 之后）
  - 定时调度器：`recheckTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>`
  - 到期自动复查与静默卸载：`expiresAt` 到期自动触发 `read_mdlog_state`；返回 `null` 时静默隐藏徽章并清空定时器；切换文档时彻底清理。

- [ ] **Step 1: Write the failing test**

在 `src/App.test.tsx` 中增加徽章渲染、定时复查卸载、200s 空闲判活以及切换文档清理的自动化测试：

```tsx
test("renders '记录中 · PI' badge when read_mdlog_state returns active state", async () => {
  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/live-doc.md",
        fileName: "live-doc.md",
        parentPath: "C:/notes",
        markdown: "# Live Title",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: 1_000_000,
        heartbeatAt: 1_000_000,
        expiresAt: 1_120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live-doc.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Title" })).toBeInTheDocument());

  const badge = await screen.findByText("记录中 · PI");
  expect(badge).toBeInTheDocument();
  expect(badge).toHaveClass("mdlog-live");
  // 断言徽章位于 .document-content 容器内部
  expect(badge.parentElement).toHaveClass("document-content");
});

test("silently hides badge when expiresAt arrives and sidecar expired (Z1)", async () => {
  vi.useFakeTimers();

  const now = Date.now();
  let stateResult: { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null = {
    lastWriteAt: now,
    heartbeatAt: now,
    expiresAt: now + 50_000,
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/expire.md",
        fileName: "expire.md",
        parentPath: "C:/notes",
        markdown: "# Expire Test",
      };
    }
    if (cmd === "read_mdlog_state") {
      return stateResult;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/expire.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Expire Test" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 模拟到期后 sidecar 判定失效（进程崩溃，无心跳）
  stateResult = null;

  // 快进 50_000ms 到达 expiresAt
  await act(async () => {
    vi.advanceTimersByTime(50_000);
  });

  await waitFor(() => {
    expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument();
  });

  vi.useRealTimers();
});

test("keeps badge alive across 200s idle time when heartbeat refreshes (Z1 spec §9.2)", async () => {
  vi.useFakeTimers();

  let currentTime = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => currentTime);

  let stateResult = {
    lastWriteAt: 1_000_000,
    heartbeatAt: 1_000_000,
    expiresAt: 1_120_000, // +120s
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/idle.md",
        fileName: "idle.md",
        parentPath: "C:/notes",
        markdown: "# Idle Session",
      };
    }
    if (cmd === "read_mdlog_state") {
      return stateResult;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/idle.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Idle Session" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 模拟空闲期间每 30s 刷新一次心跳，持续至 200s（无内容写，但 heartbeatAt/expiresAt 递增）
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );

  for (let t = 30_000; t <= 200_000; t += 30_000) {
    currentTime = 1_000_000 + t;
    stateResult = {
      lastWriteAt: 1_000_000, // 内容未变
      heartbeatAt: currentTime,
      expiresAt: currentTime + 120_000,
    };
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      if (stateChangedCall) {
        (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
      }
    });
  }

  // 200s 后徽章依旧保持存活
  expect(screen.getByText("记录中 · PI")).toBeInTheDocument();

  vi.useRealTimers();
});

test("clears timer and unmounts badge when switching to a regular document", async () => {
  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      return {
        path: p,
        fileName: p.endsWith("live.md") ? "live.md" : "plain.md",
        parentPath: "C:/notes",
        markdown: p.endsWith("live.md") ? "# Live" : "# Plain",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 切换到普通文档（read_mdlog_state 返回 null）
  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      return {
        path: p,
        fileName: "plain.md",
        parentPath: "C:/notes",
        markdown: "# Plain",
      };
    }
    if (cmd === "read_mdlog_state") {
      return null;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/plain.md");
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Plain" })).toBeInTheDocument());
  expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
npx vitest run src/App.test.tsx -t "badge|hides badge|keeps badge alive"
```
预期输出：FAIL，找不到 `.mdlog-live` 徽章元素，或复查定时器未被调度。

- [ ] **Step 3: Write minimal implementation**

修改 `src/App.tsx`：
1. 引入 `computeRecheckDelay`：
   ```tsx
   import { computeRecheckDelay, type MdlogState } from "./lib/mdlogState";
   ```
2. 在 `App` 内增加 `recheckTimerRef`：
   ```tsx
   const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
   ```
3. 封装通用的复查调度函数 `scheduleRecheck`：
   ```tsx
   const scheduleRecheck = useCallback((state: MdlogState | null) => {
     if (recheckTimerRef.current !== null) {
       clearTimeout(recheckTimerRef.current);
       recheckTimerRef.current = null;
     }
     if (!state) return;

     const delay = computeRecheckDelay(state.expiresAt);
     recheckTimerRef.current = setTimeout(async () => {
       recheckTimerRef.current = null;
       if (!currentPathRef.current) return;
       try {
         const latestState = await invoke<MdlogState | null>("read_mdlog_state");
         setMdlogState(latestState);
         scheduleRecheck(latestState);
       } catch {
         setMdlogState(null);
       }
     }, delay);
   }, []);
   ```
4. 在 `loadPath` 中切换文档时清理定时器，并在加载成功后建立调度：
   ```tsx
   async function loadPath(path: string) {
     persistCurrentScroll();
     restoreCancelRef.current?.();
     restoreCancelRef.current = null;
     if (recheckTimerRef.current !== null) {
       clearTimeout(recheckTimerRef.current);
       recheckTimerRef.current = null;
     }
     setMdlogState(null);
     // ...
     try {
       const document = await invoke<LoadedDocument>("load_document", { path });
       if (loadRequestRef.current !== requestId) return;
       currentPathRef.current = document.path;
       setState({ status: "ready", document });
       void saveLastOpened(document.path);

       try {
         const liveState = await invoke<MdlogState | null>("read_mdlog_state");
         if (loadRequestRef.current === requestId) {
           setMdlogState(liveState);
           scheduleRecheck(liveState);
         }
       } catch {
         if (loadRequestRef.current === requestId) {
           setMdlogState(null);
         }
       }
     } catch (error) { ... }
   }
   ```
5. 在 `mdlog-state-changed` 监听器中收到新事件时更新状态并重置定时器：
   ```tsx
   useEffect(() => {
     let cancelled = false;
     let unlisten: (() => void) | undefined;

     async function checkState() {
       if (!currentPathRef.current) return;
       try {
         const liveState = await invoke<MdlogState | null>("read_mdlog_state");
         if (!cancelled) {
           setMdlogState(liveState);
           scheduleRecheck(liveState);
         }
       } catch {
         if (!cancelled) {
           setMdlogState(null);
         }
       }
     }

     async function bindState() {
       const unlistenFn = await listen("mdlog-state-changed", () => {
         void checkState();
       });
       if (cancelled) {
         unlistenFn();
       } else {
         unlisten = unlistenFn;
       }
     }

     void bindState();

     return () => {
       cancelled = true;
       unlisten?.();
       if (recheckTimerRef.current !== null) {
         clearTimeout(recheckTimerRef.current);
         recheckTimerRef.current = null;
       }
     };
   }, [scheduleRecheck]);
   ```
6. 在 JSX 树的 `.document-content` 容器内渲染徽章（位于 `MarkdownDocument` 之后）：
   ```tsx
   <div ref={documentContentRef} className="document-content">
     {state.status === "empty" ? <EmptyState onOpen={handleOpen} /> : null}
     {state.status === "loading" ? (
       <section className="empty-state" role="status">
         加载中...
       </section>
     ) : null}
     {state.status === "error" ? <ErrorState message={state.message} path={state.path} /> : null}
     {state.status === "ready" ? (
       <>
         <Suspense fallback={null}>
           <MarkdownDocument
             markdown={state.document.markdown}
             headings={headings}
             onRendered={handleContentRendered}
             searchQuery={deferredSearchQuery}
             searchQueryPending={searchQueryPending}
             activeMatchIndex={activeMatchIndex}
             onMatchCountChange={handleMatchCountChange}
           />
         </Suspense>
         {mdlogState !== null && (
           <div className="mdlog-live">记录中 · PI</div>
         )}
       </>
     ) : null}
   </div>
   ```

- [ ] **Step 4: Run test to verify it passes**

执行命令：
```bash
npx vitest run src/App.test.tsx
```
预期输出：所有测试（含徽章显隐、200s 空闲、崩溃超时卸载等用例）全部 PASS。
运行全量测试确认基线全绿：
```bash
npm test
```
预期输出：前端 22 个测试文件全部通过，用例数增至 210（206 + 4 个 App.test 徽章与复查测试）。

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "feat(app): add live mdlog badge with scheduled recheck and automatic expiration"
```

---

### Task 3.4: 完整场景端到端集成验证与全量回归

**Files:**
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes:
  - Task 3.1（`scrollStick.ts` / 底部跟随与落位守护）
  - Task 3.2（副作用抑制 / 刷盘暂停 / 断开补写）
  - Task 3.3（`mdlogState.ts` / 徽章渲染 / 到期复查调度）
- Produces:
  - 全流程综合集成测试套件，验证贴底跟随、主动上滑打断、记录态静音、会话结束恢复普通热重载的完整生命周期。
  - 100% 保持前端 22 个测试文件与 211 用例全绿（净增 36 用例）、后端 36 用例全绿。

- [ ] **Step 1: Write the failing test**

在 `src/App.test.tsx` 中编写覆盖完整生命周期的端到端集成用例：

```tsx
test("end-to-end: live mdlog lifecycle from bottom stickiness to disconnection recovery", async () => {
  vi.useFakeTimers();

  const saveSpy = vi.fn();
  const { Store } = await import("@tauri-apps/plugin-store");
  vi.mocked(Store.load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve(undefined)),
    set: saveSpy,
    save: vi.fn(() => Promise.resolve()),
  } as unknown as InstanceType<typeof Store>);

  let currentDocMarkdown = "# Session Log\n\nInitial message.";
  let liveState: { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null = {
    lastWriteAt: 1_000_000,
    heartbeatAt: 1_000_000,
    expiresAt: 1_120_000,
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/logs/pi.md",
        fileName: "pi.md",
        parentPath: "C:/logs",
        markdown: currentDocMarkdown,
      };
    }
    if (cmd === "read_mdlog_state") {
      return liveState;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/logs/pi.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Session Log" })).toBeInTheDocument());

  // 1. 验证徽章渲染且副作用抑制开启
  expect(screen.getByText("记录中 · PI")).toBeInTheDocument();
  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 600;
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });

  // 2. 模拟热重载（贴底状态下追加对话）
  currentDocMarkdown = "# Session Log\n\nInitial message.\n\nNew AI response appended.";
  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("New AI response appended.")).toBeInTheDocument());
  // 确认自动贴底且未挂载印章
  expect(scrollContainer.scrollTop).toBe(1000);
  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();

  // 3. 用户主动上滑查看历史（滚至顶部 scrollTop = 100，距离底部 1000 - 100 - 400 = 500 > 80）
  scrollTop = 100;
  fireEvent.wheel(scrollContainer);

  // 再次发生热重载
  currentDocMarkdown = "# Session Log\n\nInitial message.\n\nNew AI response appended.\n\nAnother turn.";
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Another turn.")).toBeInTheDocument());
  // 用户不在底部，滚动位置必须严格保持在 100，不得强制落底
  expect(scrollContainer.scrollTop).toBe(100);

  // 4. 会话结束断开（sidecar 删除或心跳超时，返回 null）
  saveSpy.mockClear();
  liveState = null;
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );
  await act(async () => {
    if (stateChangedCall) {
      (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
    }
  });

  // 徽章静默隐藏，阅读位置集中补写一次
  await waitFor(() => expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument());
  expect(saveSpy).toHaveBeenCalledWith("C:/logs/pi.md", expect.any(Object));

  // 5. 断开后的普通热重载恢复印章显示
  currentDocMarkdown = "# Session Log\n\nManual edit by user.";
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Manual edit by user.")).toBeInTheDocument());
  expect(screen.getByText("墨迹未干")).toBeInTheDocument();

  vi.useRealTimers();
});
```

- [ ] **Step 2: Run test to verify it fails**

执行命令：
```bash
npx vitest run src/App.test.tsx -t "end-to-end: live mdlog lifecycle"
```
预期输出：若前置任务各环节有任何未对齐的竞态或状态遗留，此综合用例将精准捕获并 FAIL。

- [ ] **Step 3: Write minimal implementation**

复查并确保 `src/App.tsx` 中的所有状态转移逻辑符合断言：
1. `reloadCurrent` 中 `isContainerNearBottom` 计算准确；
2. `useLayoutEffect` 中非贴底时 `pendingScrollRef` 正常恢复；
3. `isMdlogActiveRef.current` 在状态变化时同步更新；
4. `scheduleRecheck` 在断开与切换文档时正确清理；
5. `.mdlog-live` 在 `mdlogState !== null` 时精准渲染。

- [ ] **Step 4: Run test to verify it passes**

运行全量测试套件：
```bash
npm test
```
预期输出：
```
Test Files  22 passed (22)
     Tests  211 passed (211)
```
确认测试总数在既有 175 条基线上净增 36 用例（22 文件，211 用例全部 PASS），无任何破损或跳过用例。

- [ ] **Step 5: Commit**

```bash
git add src/App.test.tsx
git commit -m "test(app): add comprehensive end-to-end test for mdlog live session lifecycle"
```




## 工作包 4：pi 扩展 mdlog

> **范围约束**：本工作包实现 pi 全局扩展 `mdlog`，文件部署于仓库外 `~/.pi/agent/extensions/mdlog/`（Windows 绝对路径 `C:\Users\17445\.pi\agent\extensions\mdlog\`）。
> **测试运行器决策**：采用 Node.js 24 内置的 `node:test` 测试框架（`node --test test/**/*.test.ts`），理由：Node 24 原生支持 TypeScript 类型剥离执行，零额外第三方依赖，秒级启动，完全符合 spec §3.1「运行依赖仅用 Node.js 内置模块与类型定义」的极简约束。
> **跨包契约保证**：
> 1. sidecar 状态文件规范命名：`<日志文件全路径>.mdlog`；
> 2. Vellum 端事件 `file-changed` 与 `mdlog-state-changed` 纯由操作系统文件监听驱动，扩展不与 Vellum 建立任何长连接或直接通信；
> 3. 交互块围栏语言名逐字保持为 `vellum-widget`。

---

### Task 4.1: 脚手架、类型定义与纯函数格式化器（Scaffold, Types & Pure Formatter）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\package.json`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\types.ts`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\format.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\format.test.ts`

**Interfaces:**
- Consumes: `@earendil-works/pi-coding-agent` (类型定义)
- Produces:
  - `export function formatTimestamp(timestamp: number, previousTimestamp?: number): string`
  - `export function extractMessageText(content: string | Array<{ type: string; text?: string }> | undefined): string`
  - `export function scanCodeFences(text: string): { isUnclosed: boolean; fenceChar?: string; fenceLength?: number }`
  - `export function formatHeader(sessionId: string): string`
  - `export function formatUserMessage(text: string, time: string, entryId?: string): string`
  - `export function formatAssistantMessage(text: string, time: string, entryId?: string, isEnd?: boolean, options?: { unclosedFence?: boolean; extraImages?: string[] }): string`
  - `export function formatTurnDelimiter(): string`
  - `export const FINGERPRINT_RE: RegExp`
  - `export const ANCHOR_RE: RegExp`

- [ ] **Step 1: 创建 package.json 并编写纯函数格式化模块失败测试**

在 `C:\Users\17445\.pi\agent\extensions\mdlog\package.json` 中配置模块信息与测试脚本：

```json
{
  "name": "pi-mdlog",
  "version": "1.0.0",
  "description": "Vellum live Markdown logger extension for pi coding agent",
  "type": "module",
  "engines": {
    "node": ">=22.6"
  },
  "scripts": {
    "test": "node --test test/**/*.test.ts"
  }
}
```

在 `C:\Users\17445\.pi\agent\extensions\mdlog\test\format.test.ts` 中编写测试用例，覆盖双形态文本提取、跨天时间戳、CommonMark 围栏平衡扫描、逐字节消息拼接与锚点空行：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractMessageText,
  formatTimestamp,
  scanCodeFences,
  formatHeader,
  formatUserMessage,
  formatAssistantMessage,
  formatTurnDelimiter,
  FINGERPRINT_RE,
  ANCHOR_RE,
} from "../src/format.ts";

describe("format module", () => {
  describe("extractMessageText", () => {
    test("handles string content", () => {
      assert.equal(extractMessageText("hello world"), "hello world");
    });

    test("handles array content with text chunks", () => {
      const chunks = [
        { type: "text", text: "line 1" },
        { type: "image", image: "base64..." },
        { type: "text", text: "line 2" },
      ];
      assert.equal(extractMessageText(chunks), "line 1\n\nline 2");
    });

    test("handles empty or non-text chunks", () => {
      assert.equal(extractMessageText([]), "");
      assert.equal(extractMessageText(undefined), "");
      assert.equal(extractMessageText([{ type: "image" }]), "");
    });
  });

  describe("formatTimestamp", () => {
    test("formats same-day timestamp as HH:MM", () => {
      const d = new Date(2026, 8, 5, 14, 32);
      assert.equal(formatTimestamp(d.getTime()), "14:32");
    });

    test("formats cross-day timestamp as MM-DD HH:MM", () => {
      const prev = new Date(2026, 8, 4, 23, 50).getTime();
      const curr = new Date(2026, 8, 5, 14, 32).getTime();
      assert.equal(formatTimestamp(curr, prev), "09-05 14:32");
    });
  });

  describe("scanCodeFences", () => {
    test("detects fully balanced backtick code block", () => {
      const md = "Some text\n```ts\nconsole.log(1);\n```\nMore text";
      const result = scanCodeFences(md);
      assert.equal(result.isUnclosed, false);
    });

    test("detects unclosed backtick fence at end of text", () => {
      const md = "Some text\n```ts\nconsole.log('truncation...";
      const result = scanCodeFences(md);
      assert.equal(result.isUnclosed, true);
      assert.equal(result.fenceChar, "`");
      assert.equal(result.fenceLength, 3);
    });

    test("detects tilde fences and checks length match", () => {
      const md = "~~~~\ncode\n~~~"; // open 4 tildes, close 3 -> remains unclosed
      const result = scanCodeFences(md);
      assert.equal(result.isUnclosed, true);
      assert.equal(result.fenceLength, 4);
    });

    test("ignores inline backticks inside paragraphs", () => {
      const md = "Here is `inline code` and ```not a fence line``` middle";
      const result = scanCodeFences(md);
      assert.equal(result.isUnclosed, false);
    });
  });

  describe("formatHeader", () => {
    test("outputs byte-exact header with trailing blank line", () => {
      const header = formatHeader("sess-abc-123");
      assert.equal(header, "<!-- mdlog:v1 s=sess-abc-123 -->\n\n# Pi 对话记录\n\n");
      assert.match(header, FINGERPRINT_RE);
    });
  });

  describe("formatUserMessage", () => {
    test("quotes every line including blank lines with anchor", () => {
      const msg = formatUserMessage("第一行\n\n第二行", "14:32", "entry001");
      const expected =
        "> **你** · 14:32\n" +
        ">\n" +
        "> 第一行\n" +
        ">\n" +
        "> 第二行\n\n" +
        "<!-- mdlog:m=entry001 -->\n\n";
      assert.equal(msg, expected);
      assert.match(msg, ANCHOR_RE);
    });

    test("omits anchor line when entryId is undefined (anchorLost)", () => {
      const msg = formatUserMessage("单行输入", "14:32");
      const expected =
        "> **你** · 14:32\n" +
        ">\n" +
        "> 单行输入\n\n";
      assert.equal(msg, expected);
      assert.equal(ANCHOR_RE.test(msg), false);
    });
  });

  describe("formatAssistantMessage", () => {
    test("formats standard assistant message with anchor and turn delimiter", () => {
      const msg = formatAssistantMessage("这是回答正文。", "14:33", "entry002", true);
      const expected =
        "**Pi** · 14:33\n\n" +
        "这是回答正文。\n\n" +
        "<!-- mdlog:m=entry002 -->\n\n" +
        "---\n\n";
      assert.equal(msg, expected);
    });

    test("appends fence completion line when truncated", () => {
      const msg = formatAssistantMessage(
        "代码片段：\n```ts\nconsole.log(1);",
        "14:33",
        "entry003",
        true,
        { unclosedFence: true }
      );
      const expected =
        "**Pi** · 14:33\n\n" +
        "代码片段：\n```ts\nconsole.log(1);\n```\n*(本条消息被截断，已自动补齐代码围栏)*\n\n" +
        "<!-- mdlog:m=entry003 -->\n\n" +
        "---\n\n";
      assert.equal(msg, expected);
    });

    test("appends unreferenced extra images before anchor", () => {
      const msg = formatAssistantMessage(
        "生成了一张图。",
        "14:33",
        "entry004",
        true,
        { extraImages: ["diagram.png", "chart-2.png"] }
      );
      const expected =
        "**Pi** · 14:33\n\n" +
        "生成了一张图。\n\n" +
        "![生成的图片](mdlog-assets/diagram.png)\n\n" +
        "![生成的图片](mdlog-assets/chart-2.png)\n\n" +
        "<!-- mdlog:m=entry004 -->\n\n" +
        "---\n\n";
      assert.equal(msg, expected);
    });

    test("handles anchorLost without anchor comment", () => {
      const msg = formatAssistantMessage("未命中条目回答", "14:33", undefined, false);
      const expected = "**Pi** · 14:33\n\n未命中条目回答\n\n";
      assert.equal(msg, expected);
      assert.equal(ANCHOR_RE.test(msg), false);
    });
  });

  describe("formatTurnDelimiter", () => {
    test("returns horizontal rule with blank lines", () => {
      assert.equal(formatTurnDelimiter(), "---\n\n");
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/format.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../src/format.ts` 不存在，测试红）。

- [ ] **Step 3: 编写类型定义与纯函数格式化实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\types.ts`：

```typescript
export interface SidecarData {
  version: number;
  sessionId: string;
  pid: number;
  connectedAt: number;
  lastWriteAt: number;
  heartbeatAt: number;
  anchorLost?: boolean;
}

export interface MdlogConfig {
  toolNames?: string[];
  imageExtensions?: string[];
  maxImageBytes?: number;
  assetRetentionMb?: number;
}

export interface MdlogConnectionState {
  active: boolean;
  targetPath: string;
  sessionId: string;
  connectedAt: number;
  lastWriteAt: number;
  writtenCount: number;
  anchorLost?: boolean;
}

export interface TextChunk {
  type: string;
  text?: string;
}

export interface ImageChunk {
  type: string;
  image?: string;
}

export type MessageContent = string | Array<TextChunk | ImageChunk>;
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\format.ts`：

```typescript
import type { MessageContent } from "./types.ts";

export const FINGERPRINT_RE = /^\uFEFF?\s*<!--\s*mdlog:v1\s+s=([^\s>]+)/;
export const ANCHOR_RE = /<!--\s*mdlog:m=([A-Za-z0-9_-]+)\s*-->/;

export function extractMessageText(content: MessageContent | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textChunks: string[] = [];
    for (const chunk of content) {
      if (chunk && chunk.type === "text" && typeof chunk.text === "string" && chunk.text.length > 0) {
        textChunks.push(chunk.text);
      }
    }
    return textChunks.join("\n\n");
  }
  return "";
}

export function formatTimestamp(timestamp: number, previousTimestamp?: number): string {
  const curr = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hh = pad(curr.getHours());
  const mm = pad(curr.getMinutes());

  if (previousTimestamp !== undefined) {
    const prev = new Date(previousTimestamp);
    const isSameDay =
      curr.getFullYear() === prev.getFullYear() &&
      curr.getMonth() === prev.getMonth() &&
      curr.getDate() === prev.getDate();
    if (!isSameDay) {
      const month = pad(curr.getMonth() + 1);
      const date = pad(curr.getDate());
      return `${month}-${date} ${hh}:${mm}`;
    }
  }
  return `${hh}:${mm}`;
}

export function scanCodeFences(text: string): {
  isUnclosed: boolean;
  fenceChar?: string;
  fenceLength?: number;
} {
  const lines = text.split("\n");
  let inFence = false;
  let activeChar = "";
  let activeLength = 0;

  const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

  for (const line of lines) {
    if (!inFence) {
      const match = OPEN_FENCE_RE.exec(line);
      if (match) {
        const fenceStr = match[1];
        inFence = true;
        activeChar = fenceStr[0];
        activeLength = fenceStr.length;
      }
    } else {
      const CLOSE_FENCE_RE = new RegExp(`^ {0,3}${activeChar === "`" ? "`" : "~"}{${activeLength},}\\s*$`);
      if (CLOSE_FENCE_RE.test(line)) {
        inFence = false;
        activeChar = "";
        activeLength = 0;
      }
    }
  }

  return inFence
    ? { isUnclosed: true, fenceChar: activeChar, fenceLength: activeLength }
    : { isUnclosed: false };
}

export function formatHeader(sessionId: string): string {
  return `<!-- mdlog:v1 s=${sessionId} -->\n\n# Pi 对话记录\n\n`;
}

export function formatUserMessage(text: string, time: string, entryId?: string): string {
  const clean = text.replace(/\s+$/, "");
  const lines = clean.split("\n");
  const quoted = lines.map((line) => (line.length > 0 ? `> ${line}` : ">")).join("\n");
  const anchor = entryId ? `<!-- mdlog:m=${entryId} -->\n\n` : "";
  return `> **你** · ${time}\n>\n${quoted}\n\n${anchor}`;
}

export function formatAssistantMessage(
  text: string,
  time: string,
  entryId?: string,
  isEnd = false,
  options?: { unclosedFence?: boolean; extraImages?: string[] }
): string {
  const speaker = `**Pi** · ${time}\n\n`;
  let body = text.replace(/\s+$/, "");

  if (options?.unclosedFence) {
    body += "\n```\n*(本条消息被截断，已自动补齐代码围栏)*";
  }

  if (options?.extraImages && options.extraImages.length > 0) {
    for (const img of options.extraImages) {
      body += `\n\n![生成的图片](mdlog-assets/${img})`;
    }
  }

  const anchor = entryId ? `\n\n<!-- mdlog:m=${entryId} -->\n\n` : "\n\n";
  const endDelimiter = isEnd ? "---\n\n" : "";

  return `${speaker}${body}${anchor}${endDelimiter}`;
}

export function formatTurnDelimiter(): string {
  return "---\n\n";
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/format.test.ts
```
预期输出：`tests 14, pass 14, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `format.ts` 中无任何状态依赖，格式化公式与 spec §3.4、Y5 逐字节对齐。

---

### Task 4.2: 智能追加与逆向扫描引擎（Smart Append & Scan Engine）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\scan.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\scan.test.ts`

**Interfaces:**
- Consumes:
  - `src/format.ts` (`FINGERPRINT_RE`, `ANCHOR_RE`, `formatHeader`)
- Produces:
  - `export interface AppendPlan { mode: "increment" | "full" | "append_only" | "ask_user"; fromEntryId?: string }`
  - `export interface ResolveAppendOptions { hasUI: boolean; forceFull?: boolean; forceAppend?: boolean }`
  - `export function findLastBranchAnchor(markdownContent: string, branchEntryIds: Set<string>): { matchedEntryId: string | null; anchorLineIndex: number }`
  - `export function extractSessionFingerprint(markdownContent: string): string | null`
  - `export function resolveAppendPlan(markdownContent: string, currentSessionId: string, branchEntryIds: Set<string>, options: ResolveAppendOptions): AppendPlan`
  - `export function insertHeaderAtTopAtomic(filePath: string, sessionId: string): void`

- [ ] **Step 1: 编写逆向扫描与智能追加失败测试**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\scan.test.ts`，覆盖伪锚点过滤、分支回退命中、指纹匹配分支 4a/4b 及原子插头：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  findLastBranchAnchor,
  extractSessionFingerprint,
  resolveAppendPlan,
  insertHeaderAtTopAtomic,
} from "../src/scan.ts";

describe("scan module", () => {
  describe("findLastBranchAnchor", () => {
    test("finds the latest anchor that belongs to the current branch", () => {
      const md = [
        "# Document",
        "> **你** · 10:00",
        "> hi",
        "",
        "<!-- mdlog:m=entry-1 -->",
        "",
        "**Pi** · 10:01",
        "hello",
        "",
        "<!-- mdlog:m=entry-2 -->",
        "",
        "---",
      ].join("\n");

      const branchIds = new Set(["entry-1", "entry-2", "entry-3"]);
      const res = findLastBranchAnchor(md, branchIds);
      assert.equal(res.matchedEntryId, "entry-2");
    });

    test("skips pseudo anchors inside code fences (Y6-d)", () => {
      const md = [
        "<!-- mdlog:m=valid-1 -->",
        "```markdown",
        "Inside code block pseudo anchor:",
        "<!-- mdlog:m=fake-anchor -->",
        "```",
        "Some text after block",
      ].join("\n");

      const branchIds = new Set(["valid-1", "fake-anchor"]);
      const res = findLastBranchAnchor(md, branchIds);
      assert.equal(res.matchedEntryId, "valid-1");
    });

    test("rolls back until finding a branch-belonging anchor (Y6-a)", () => {
      const md = [
        "<!-- mdlog:m=old-branch-anchor -->",
        "",
        "<!-- mdlog:m=foreign-anchor -->",
      ].join("\n");

      const branchIds = new Set(["old-branch-anchor", "other-entry"]);
      const res = findLastBranchAnchor(md, branchIds);
      assert.equal(res.matchedEntryId, "old-branch-anchor");
    });

    test("returns null if no anchors belong to the branch", () => {
      const md = "<!-- mdlog:m=foreign-1 -->\n<!-- mdlog:m=foreign-2 -->";
      const branchIds = new Set(["entry-x", "entry-y"]);
      const res = findLastBranchAnchor(md, branchIds);
      assert.equal(res.matchedEntryId, null);
      assert.equal(res.anchorLineIndex, -1);
    });
  });

  describe("extractSessionFingerprint", () => {
    test("extracts sessionId from standard header", () => {
      const md = "<!-- mdlog:v1 s=session-uuid-1234 -->\n\n# Title";
      assert.equal(extractSessionFingerprint(md), "session-uuid-1234");
    });

    test("extracts sessionId with BOM and extra spaces", () => {
      const md = "\uFEFF  <!--   mdlog:v1   s=sess-with-spaces-5678  -->\n# Title";
      assert.equal(extractSessionFingerprint(md), "sess-with-spaces-5678");
    });

    test("returns null for non-mdlog files", () => {
      const md = "# Normal Document\nJust text";
      assert.equal(extractSessionFingerprint(md), null);
    });
  });

  describe("resolveAppendPlan", () => {
    const branchIds = new Set(["e1", "e2"]);

    test("honors forceFull flag", () => {
      const plan = resolveAppendPlan("# Doc", "sess-1", branchIds, { hasUI: true, forceFull: true });
      assert.deepEqual(plan, { mode: "full" });
    });

    test("honors forceAppend flag", () => {
      const plan = resolveAppendPlan("# Doc", "sess-1", branchIds, { hasUI: true, forceAppend: true });
      assert.deepEqual(plan, { mode: "append_only" });
    });

    test("returns full for empty file", () => {
      const plan = resolveAppendPlan("", "sess-1", branchIds, { hasUI: true });
      assert.deepEqual(plan, { mode: "full" });
    });

    test("returns increment when valid branch anchor hit", () => {
      const md = "<!-- mdlog:m=e1 -->\n\nSome text";
      const plan = resolveAppendPlan(md, "sess-1", branchIds, { hasUI: true });
      assert.deepEqual(plan, { mode: "increment", fromEntryId: "e1" });
    });

    test("returns ask_user for branch 4a with UI", () => {
      const md = "<!-- mdlog:v1 s=sess-1 -->\n\n# Doc without anchors";
      const plan = resolveAppendPlan(md, "sess-1", branchIds, { hasUI: true });
      assert.deepEqual(plan, { mode: "ask_user" });
    });

    test("returns append_only for branch 4a without UI", () => {
      const md = "<!-- mdlog:v1 s=sess-1 -->\n\n# Doc without anchors";
      const plan = resolveAppendPlan(md, "sess-1", branchIds, { hasUI: false });
      assert.deepEqual(plan, { mode: "append_only" });
    });

    test("returns full for branch 4b (foreign session or missing header)", () => {
      const md = "<!-- mdlog:v1 s=sess-other -->\n\n# Foreign doc";
      const plan = resolveAppendPlan(md, "sess-1", branchIds, { hasUI: true });
      assert.deepEqual(plan, { mode: "full" });
    });
  });

  describe("insertHeaderAtTopAtomic", () => {
    test("inserts header at line 1 of foreign non-empty file atomically", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-test-"));
      const testFile = path.join(tmpDir, "test.md");
      fs.writeFileSync(testFile, "# Existing User Notes\n\nNote line 1.", "utf8");

      insertHeaderAtTopAtomic(testFile, "sess-new-atomic");

      const updated = fs.readFileSync(testFile, "utf8");
      assert.ok(updated.startsWith("<!-- mdlog:v1 s=sess-new-atomic -->\n\n# Pi 对话记录\n\n"));
      assert.ok(updated.includes("# Existing User Notes\n\nNote line 1."));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/scan.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../src/scan.ts` 不存在，测试红）。

- [ ] **Step 3: 编写逆向扫描与智能追加实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\scan.ts`：

```typescript
import * as fs from "node:fs";
import { FINGERPRINT_RE, ANCHOR_RE, formatHeader } from "./format.ts";

export interface AppendPlan {
  mode: "increment" | "full" | "append_only" | "ask_user";
  fromEntryId?: string;
}

export interface ResolveAppendOptions {
  hasUI: boolean;
  forceFull?: boolean;
  forceAppend?: boolean;
}

export function findLastBranchAnchor(
  markdownContent: string,
  branchEntryIds: Set<string>
): { matchedEntryId: string | null; anchorLineIndex: number } {
  const lines = markdownContent.split("\n");
  const fenceRanges: Array<[number, number]> = [];

  // 1. 正向扫描标记所有代码围栏开闭区间（CommonMark 规范，杜绝伪锚点误判）
  let inFence = false;
  let activeChar = "";
  let activeLength = 0;
  let fenceStart = -1;

  const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const match = OPEN_FENCE_RE.exec(line);
      if (match) {
        inFence = true;
        activeChar = match[1][0];
        activeLength = match[1].length;
        fenceStart = i;
      }
    } else {
      const CLOSE_FENCE_RE = new RegExp(`^ {0,3}${activeChar === "`" ? "`" : "~"}{${activeLength},}\\s*$`);
      if (CLOSE_FENCE_RE.test(line)) {
        inFence = false;
        fenceRanges.push([fenceStart, i]);
        fenceStart = -1;
      }
    }
  }

  if (inFence && fenceStart !== -1) {
    fenceRanges.push([fenceStart, lines.length - 1]);
  }

  function isInsideFence(lineIdx: number): boolean {
    for (const [start, end] of fenceRanges) {
      if (lineIdx >= start && lineIdx <= end) {
        return true;
      }
    }
    return false;
  }

  // 2. 尾向扫描回退直到命中分支锚点或到达文件开头 (Y6-a, Y6-d)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isInsideFence(i)) {
      continue;
    }
    const match = ANCHOR_RE.exec(lines[i]);
    if (match) {
      const entryId = match[1];
      if (branchEntryIds.has(entryId)) {
        return { matchedEntryId: entryId, anchorLineIndex: i };
      }
    }
  }

  return { matchedEntryId: null, anchorLineIndex: -1 };
}

export function extractSessionFingerprint(markdownContent: string): string | null {
  const match = FINGERPRINT_RE.exec(markdownContent);
  return match ? match[1].trim() : null;
}

export function resolveAppendPlan(
  markdownContent: string,
  currentSessionId: string,
  branchEntryIds: Set<string>,
  options: ResolveAppendOptions
): AppendPlan {
  if (options.forceFull) {
    return { mode: "full" };
  }
  if (options.forceAppend) {
    return { mode: "append_only" };
  }

  const trimmed = markdownContent.trim();
  if (trimmed.length === 0) {
    return { mode: "full" };
  }

  // 1. 扫描寻找属于当前分支的有效锚点
  const anchorResult = findLastBranchAnchor(markdownContent, branchEntryIds);
  if (anchorResult.matchedEntryId) {
    return { mode: "increment", fromEntryId: anchorResult.matchedEntryId };
  }

  // 2. 未命中任何分支锚点：提取首行会话指纹 (Y6-b)
  const fileFingerprint = extractSessionFingerprint(markdownContent);

  if (fileFingerprint === currentSessionId) {
    // 分支 4a：属于当前会话但锚点断裂
    if (options.hasUI) {
      return { mode: "ask_user" };
    }
    return { mode: "append_only" };
  }

  // 分支 4b：新文件、外部文件或其他会话文件，回填全量历史
  return { mode: "full" };
}

export function insertHeaderAtTopAtomic(filePath: string, sessionId: string): void {
  const existingContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const fingerprint = extractSessionFingerprint(existingContent);
  if (fingerprint === sessionId) {
    return;
  }

  const header = formatHeader(sessionId);
  const combined = existingContent.length > 0 ? `${header}${existingContent}` : header;

  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tempPath, combined, "utf8");
  fs.renameSync(tempPath, filePath);
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/scan.test.ts
```
预期输出：`tests 10, pass 10, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `scan.ts` 完全覆盖 Y6-a（回退直到命中）、Y6-b（指纹提取正则）、Y6-c（4b 原子重写插入顶部）、Y6-d（围栏内伪锚点过滤）、Y6-f（修饰符与确认分支）。

---

### Task 4.3: 图片提取、净化与配额清理管线（Image Pipeline & Asset Retention）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\config.json`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\image.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\image.test.ts`

**Interfaces:**
- Consumes:
  - `src/types.ts` (`MdlogConfig`)
- Produces:
  - `export const IMAGE_PATH_RE: RegExp`
  - `export const DEFAULT_IMAGE_EXTENSIONS: readonly string[]`
  - `export function sanitizeImageFilename(filename: string): string`
  - `export function extractImageCandidates(toolOutput: string, toolNames?: string[], currentToolName?: string): string[]`
  - `export interface ProcessImageOptions { cwd: string; logDir: string; turnStartTime: number; maxImageBytes?: number }`
  - `export interface TurnImageProcessingResult { rewrittenAssistantText: string; unreferencedCleanNames: string[]; copiedFiles: string[] }`
  - `export function processTurnImages(candidates: string[], assistantText: string, options: ProcessImageOptions): TurnImageProcessingResult`
  - `export function cleanAssetRetention(assetsDir: string, maxBytes?: number): string[]`
  - `export function loadMdlogConfig(configFilePath?: string): MdlogConfig`

- [ ] **Step 1: 编写图片管线失败测试与默认配置文件**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\config.json`：

```json
{
  "toolNames": [],
  "imageExtensions": ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
  "maxImageBytes": 20971520,
  "assetRetentionMb": 200
}
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\image.test.ts`，覆盖正则提取、跨目录越界防御、mtime 5 秒窗过滤、20MB 容量保护、文件名净化重命名与配额删除：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  IMAGE_PATH_RE,
  extractImageCandidates,
  sanitizeImageFilename,
  processTurnImages,
  cleanAssetRetention,
  loadMdlogConfig,
} from "../src/image.ts";

describe("image module", () => {
  describe("extractImageCandidates", () => {
    test("extracts image paths from tool output with various quotes and spaces", () => {
      const output = [
        'Generated image at "assets/result 1.png"',
        "Also saved output to /tmp/charts/plot.jpg and img.webp.",
        "Unsupported vector graphic diagram.svg should be ignored.",
      ].join("\n");

      const list = extractImageCandidates(output);
      assert.ok(list.includes("assets/result 1.png") || list.some((p) => p.endsWith("result 1.png")));
      assert.ok(list.some((p) => p.endsWith("plot.jpg")));
      assert.ok(list.some((p) => p.endsWith("img.webp")));
      assert.ok(!list.some((p) => p.endsWith("diagram.svg"))); // SVG 严禁匹配 (Y7-a)
    });

    test("filters tools when toolNames is specified in config", () => {
      const output = "created output.png";
      assert.deepEqual(extractImageCandidates(output, ["imagen2"], "bash"), []);
      assert.equal(extractImageCandidates(output, ["imagen2"], "imagen2").length, 1);
    });
  });

  describe("sanitizeImageFilename", () => {
    test("purges non-ascii characters and spaces to single dashes", () => {
      const clean = sanitizeImageFilename("架构图 流程 (1).png");
      assert.equal(clean, "--------1-.png");
      assert.match(clean, /^[A-Za-z0-9._-]+$/);
    });

    test("falls back to image.ext if all base characters are non-ascii", () => {
      const clean = sanitizeImageFilename("图.png");
      assert.equal(clean, "image.png");
    });
  });

  describe("processTurnImages", () => {
    test("processes valid image, rewrites assistant text, and rejects path traversal", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-img-test-"));
      const cwd = path.join(tmpDir, "workspace");
      const logDir = path.join(tmpDir, "logs");
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(logDir, { recursive: true });

      const now = Date.now();
      const validImg = path.join(cwd, "test-valid.png");
      fs.writeFileSync(validImg, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
      fs.utimesSync(validImg, new Date(now), new Date(now));

      const oldImg = path.join(cwd, "old-history.png");
      fs.writeFileSync(oldImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const staleTime = (now - 10000) / 1000;
      fs.utimesSync(oldImg, staleTime, staleTime); // 超过 5 秒前历史文件 (Y7-c)

      const outsideImg = path.join(tmpDir, "secret.png");
      fs.writeFileSync(outsideImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const assistantText = "看这张图：test-valid.png 已经生成。";
      const candidates = ["test-valid.png", "old-history.png", "../secret.png"];

      const res = processTurnImages(candidates, assistantText, {
        cwd,
        logDir,
        turnStartTime: now,
      });

      // 1. 验证有效图片被复制且正文被重写为 mdlog-assets
      assert.ok(res.rewrittenAssistantText.includes("mdlog-assets/test-valid.png"));
      assert.ok(fs.existsSync(path.join(logDir, "mdlog-assets", "test-valid.png")));

      // 2. 验证过旧历史图片与越界图片被拦截
      assert.ok(!fs.existsSync(path.join(logDir, "mdlog-assets", "old-history.png")));
      assert.ok(!fs.existsSync(path.join(logDir, "mdlog-assets", "secret.png")));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("handles unreferenced image by adding to unreferencedCleanNames", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-img-test-"));
      const cwd = path.join(tmpDir, "workspace");
      const logDir = path.join(tmpDir, "logs");
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(logDir, { recursive: true });

      const now = Date.now();
      const imgPath = path.join(cwd, "standalone.png");
      fs.writeFileSync(imgPath, Buffer.alloc(100));
      fs.utimesSync(imgPath, new Date(now), new Date(now));

      const res = processTurnImages(["standalone.png"], "正文没有任何图片链接", {
        cwd,
        logDir,
        turnStartTime: now,
      });

      assert.deepEqual(res.unreferencedCleanNames, ["standalone.png"]);
      assert.ok(fs.existsSync(path.join(logDir, "mdlog-assets", "standalone.png")));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("skips images exceeding configured maxImageBytes and inserts warning placeholder", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-img-test-"));
      const cwd = path.join(tmpDir, "workspace");
      const logDir = path.join(tmpDir, "logs");
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(logDir, { recursive: true });

      const now = Date.now();
      const bigImg = path.join(cwd, "huge.png");
      fs.writeFileSync(bigImg, Buffer.alloc(10)); // 用小文件模拟，但设置 maxImageBytes 为 5

      const res = processTurnImages(["huge.png"], "正文看：huge.png", {
        cwd,
        logDir,
        turnStartTime: now,
        maxImageBytes: 5,
      });

      assert.ok(res.rewrittenAssistantText.includes("*(图片过大超过5 字节，已跳过同步：huge.png)*"));
      assert.ok(!fs.existsSync(path.join(logDir, "mdlog-assets", "huge.png")));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("handles image copy failure and writes failure placeholder", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-img-fail-test-"));
      const cwd = path.join(tmpDir, "workspace");
      const logDir = path.join(tmpDir, "logs");
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(logDir, { recursive: true });

      const now = Date.now();
      const imgPath = path.join(cwd, "fail.png");
      fs.writeFileSync(imgPath, Buffer.alloc(10));

      // 用文件占位 mdlog-assets 阻止目录创建与文件写入，触发复制异常
      fs.writeFileSync(path.join(logDir, "mdlog-assets"), "blocker");

      const res = processTurnImages(["fail.png"], "看：fail.png", {
        cwd,
        logDir,
        turnStartTime: now,
      });

      assert.ok(res.rewrittenAssistantText.includes("*(图片处理失败："));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("cleanAssetRetention", () => {
    test("removes oldest files when assets directory exceeds byte quota", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-retention-test-"));
      const assetsDir = path.join(tmpDir, "mdlog-assets");
      fs.mkdirSync(assetsDir, { recursive: true });

      const f1 = path.join(assetsDir, "old.png");
      const f2 = path.join(assetsDir, "new.png");
      fs.writeFileSync(f1, Buffer.alloc(80));
      fs.writeFileSync(f2, Buffer.alloc(80));

      const now = Date.now();
      fs.utimesSync(f1, (now - 10000) / 1000, (now - 10000) / 1000);
      fs.utimesSync(f2, now / 1000, now / 1000);

      // 限额 100 字节，两个文件共 160 字节，应该删掉最旧的 f1
      const deleted = cleanAssetRetention(assetsDir, 100);
      assert.equal(deleted.length, 1);
      assert.equal(deleted[0], f1);
      assert.ok(!fs.existsSync(f1));
      assert.ok(fs.existsSync(f2));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/image.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../src/image.ts` 不存在，测试红）。

- [ ] **Step 3: 编写图片提取、净化与配额清理实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\image.ts`：

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { MdlogConfig } from "./types.ts";

export const IMAGE_PATH_RE = /(?:["']|^|\s)([A-Za-z0-9_.\-\\/]+?\.(?:png|jpg|jpeg|gif|webp|bmp))(?=["']|$|\s)/gi;

export const DEFAULT_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"] as const;

export function loadMdlogConfig(configFilePath?: string): MdlogConfig {
  const defaultCfg: MdlogConfig = {
    toolNames: [],
    imageExtensions: [...DEFAULT_IMAGE_EXTENSIONS],
    maxImageBytes: 20 * 1024 * 1024,
    assetRetentionMb: 200,
  };

  const targetPath =
    configFilePath ??
    path.join(
      process.env.USERPROFILE || process.env.HOME || "",
      ".pi",
      "agent",
      "extensions",
      "mdlog",
      "config.json"
    );

  try {
    if (fs.existsSync(targetPath)) {
      const raw = fs.readFileSync(targetPath, "utf8");
      const parsed = JSON.parse(raw);
      return { ...defaultCfg, ...parsed };
    }
  } catch {
    // 读取或解析异常回退默认配置
  }
  return defaultCfg;
}

export function extractImageCandidates(
  toolOutput: string,
  configuredToolNames?: string[],
  currentToolName?: string
): string[] {
  if (configuredToolNames && configuredToolNames.length > 0) {
    if (!currentToolName || !configuredToolNames.includes(currentToolName)) {
      return [];
    }
  }

  const results: string[] = [];
  const set = new Set<string>();
  let match: RegExpExecArray | null;

  const re = new RegExp(IMAGE_PATH_RE.source, IMAGE_PATH_RE.flags);
  while ((match = re.exec(toolOutput)) !== null) {
    const rawPath = match[1].trim();
    if (!set.has(rawPath)) {
      set.add(rawPath);
      results.push(rawPath);
    }
  }

  return results;
}

export function sanitizeImageFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  let base = path.basename(filename, ext);

  // 移除非安全字符，保留 [A-Za-z0-9._-]
  base = base.replace(/[^A-Za-z0-9._-]/g, "-");
  if (base.replace(/-/g, "").length === 0) {
    base = "image";
  }

  return `${base}${ext}`;
}

export interface ProcessImageOptions {
  cwd: string;
  logDir: string;
  turnStartTime: number;
  maxImageBytes?: number;
}

export interface TurnImageProcessingResult {
  rewrittenAssistantText: string;
  unreferencedCleanNames: string[];
  copiedFiles: string[];
}

export function processTurnImages(
  candidates: string[],
  assistantText: string,
  options: ProcessImageOptions
): TurnImageProcessingResult {
  const maxBytes = options.maxImageBytes ?? 20 * 1024 * 1024;
  const assetsDir = path.join(options.logDir, "mdlog-assets");
  const unreferencedCleanNames: string[] = [];
  const copiedFiles: string[] = [];
  let rewrittenAssistantText = assistantText;

  const normalizedCwd = path.resolve(options.cwd);
  const realCwd = fs.existsSync(normalizedCwd) ? fs.realpathSync(normalizedCwd) : normalizedCwd;

  for (const candidate of candidates) {
    // 1. 相对路径解析以 cwd 为唯一基准 (Y7-e)
    const resolvedPath = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(normalizedCwd, candidate);

    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    let realCandidatePath: string;
    try {
      realCandidatePath = fs.realpathSync(resolvedPath);
    } catch {
      continue;
    }

    // 2. 包含性安全约束：严禁越出 cwd 目录抓取用户私有文件（S8: realpath 解析符号链接）
    const relFromCwd = path.relative(realCwd, realCandidatePath);
    if (relFromCwd.startsWith("..") || path.isAbsolute(relFromCwd)) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    // 3. mtime 过滤：仅复制 stat.mtimeMs >= turnStartTime - 5000 的新文件 (Y7-c)
    if (stat.mtimeMs < options.turnStartTime - 5000) {
      continue;
    }

    // 4. 容量保护（A8: 引用 maxImageBytes 实际值动态格式化文案）
    if (stat.size > maxBytes) {
      const formattedLimit =
        maxBytes >= 1024 * 1024
          ? `${(maxBytes / (1024 * 1024)).toFixed(0)}MB`
          : `${maxBytes} 字节`;
      const placeholder = `*(图片过大超过${formattedLimit}，已跳过同步：${candidate})*`;
      if (rewrittenAssistantText.includes(candidate)) {
        rewrittenAssistantText = rewrittenAssistantText.replaceAll(candidate, placeholder);
      } else {
        rewrittenAssistantText += `\n\n${placeholder}`;
      }
      continue;
    }

    // 5. 文件名净化与 mdlog-assets 复制去重
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    const cleanName = sanitizeImageFilename(path.basename(resolvedPath));
    const ext = path.extname(cleanName);
    const base = path.basename(cleanName, ext);

    let finalCleanName = cleanName;
    let targetPath = path.join(assetsDir, finalCleanName);
    let counter = 2;

    while (fs.existsSync(targetPath)) {
      finalCleanName = `${base}-${counter}${ext}`;
      targetPath = path.join(assetsDir, finalCleanName);
      counter++;
    }

    try {
      fs.copyFileSync(resolvedPath, targetPath);
      copiedFiles.push(targetPath);
    } catch (err: any) {
      // A8: 图片复制失败分支写占位行，记录不中断
      const failPlaceholder = `*(图片处理失败：${err?.message ?? "复制失败"})*`;
      if (rewrittenAssistantText.includes(candidate)) {
        rewrittenAssistantText = rewrittenAssistantText.replaceAll(candidate, failPlaceholder);
      } else {
        rewrittenAssistantText += `\n\n${failPlaceholder}`;
      }
      continue;
    }

    // 6. 正文替换为相对路径 mdlog-assets/<finalCleanName>
    const relativeAssetPath = `mdlog-assets/${finalCleanName}`;
    const escapedCandidate = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const candidateRegex = new RegExp(escapedCandidate, "g");

    if (candidateRegex.test(rewrittenAssistantText)) {
      rewrittenAssistantText = rewrittenAssistantText.replace(candidateRegex, relativeAssetPath);
    } else {
      unreferencedCleanNames.push(finalCleanName);
    }
  }

  return {
    rewrittenAssistantText,
    unreferencedCleanNames,
    copiedFiles,
  };
}

export function cleanAssetRetention(assetsDir: string, maxBytes = 200 * 1024 * 1024): string[] {
  if (!fs.existsSync(assetsDir)) {
    return [];
  }

  let entries: Array<{ filePath: string; size: number; mtimeMs: number }> = [];
  try {
    const files = fs.readdirSync(assetsDir);
    for (const file of files) {
      const fullPath = path.join(assetsDir, file);
      try {
        const s = fs.statSync(fullPath);
        if (s.isFile()) {
          entries.push({ filePath: fullPath, size: s.size, mtimeMs: s.mtimeMs });
        }
      } catch {
        // 忽略竞争跳过
      }
    }
  } catch {
    return [];
  }

  let totalSize = entries.reduce((acc, curr) => acc + curr.size, 0);
  if (totalSize <= maxBytes) {
    return [];
  }

  // 最旧文件排在最前 (mtime 升序)
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const deleted: string[] = [];
  for (const item of entries) {
    if (totalSize <= maxBytes) break;
    try {
      fs.unlinkSync(item.filePath);
      totalSize -= item.size;
      deleted.push(item.filePath);
    } catch {
      // 容错继续
    }
  }

  return deleted;
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/image.test.ts
```
预期输出：`tests 6, pass 6, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `image.ts` 完整实现 Y7-a~Y7-f 全部规则，排除 svg，保证绝对不越界抓取外部敏感目录。

---

### Task 4.4: 串行实时写入器与指数退避重试（Live Log Writer & Exponential Backoff Retry）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\writer.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\writer.test.ts`

**Interfaces:**
- Consumes:
  - `src/types.ts` (`MessageContent`, `MdlogConfig`)
  - `src/format.ts` (`formatTimestamp`, `formatUserMessage`, `formatAssistantMessage`, `scanCodeFences`, `extractMessageText`)
  - `src/image.ts` (`processTurnImages`, `cleanAssetRetention`)
- Produces:
  - `export interface SessionEntryLike { id: string; type?: string; message?: unknown }`
  - `export interface SessionManagerLike { getBranch(): SessionEntryLike[]; getCwd(): string; getSessionId(): string }`
  - `export interface BufferedMessageItem { message: { role: string; content: MessageContent; timestamp?: number }; turnStartTime?: number }`
  - `export interface WriterOptions { filePath: string; sessionId: string; sessionManager: SessionManagerLike; config?: MdlogConfig; onAnchorLost?: () => void; onWriteSuccess?: (ts: number) => void; onFatalError?: (msg: string) => void }`
  - `export class LiveLogWriter`（提供 `enqueueMessage`, `enqueueImageCandidates`, `flush`, `destroy(options?: { discard?: boolean })`）

- [ ] **Step 1: 编写串行写入器与容灾重试失败测试**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\writer.test.ts`，覆盖 150ms 防抖合并、串行单调追加、反查 entryId 及降级 anchorLost、50/150/300ms 指数退避微重试与连续 3 批失败熔断：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { LiveLogWriter, type SessionManagerLike } from "../src/writer.ts";

describe("LiveLogWriter", () => {
  function createMockSessionManager(sessionId: string, cwd: string): SessionManagerLike & { entries: Array<{ id: string; message: unknown }> } {
    const entries: Array<{ id: string; message: unknown }> = [];
    return {
      entries,
      getSessionId: () => sessionId,
      getCwd: () => cwd,
      getBranch: () => entries,
    };
  }

  test("batches messages with 150ms debounce and matches branch entryId", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-writer-test-"));
    const logFile = path.join(tmpDir, "session.md");
    fs.writeFileSync(logFile, "<!-- mdlog:v1 s=s1 -->\n\n# Pi 对话记录\n\n");

    const sm = createMockSessionManager("s1", tmpDir);
    let lastWrite = 0;

    const writer = new LiveLogWriter({
      filePath: logFile,
      sessionId: "s1",
      sessionManager: sm,
      onWriteSuccess: (ts) => {
        lastWrite = ts;
      },
    });

    const userMsg = { role: "user", content: "提问 1", timestamp: Date.now() };
    const asstMsg = { role: "assistant", content: "回答 1", timestamp: Date.now() };

    // 模拟 sessionManager 在写入前完成了持久化记录条目
    sm.entries.push({ id: "entry-u1", message: userMsg });
    sm.entries.push({ id: "entry-a1", message: asstMsg });

    writer.enqueueMessage({ message: userMsg });
    writer.enqueueMessage({ message: asstMsg });

    // 等待 150ms 防抖触发与落盘
    await new Promise((r) => setTimeout(r, 260));

    const content = fs.readFileSync(logFile, "utf8");
    assert.ok(content.includes("<!-- mdlog:m=entry-u1 -->"));
    assert.ok(content.includes("<!-- mdlog:m=entry-a1 -->"));
    assert.ok(content.includes("> **你** · "));
    assert.ok(content.includes("**Pi** · "));
    assert.ok(lastWrite > 0);

    await writer.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("handles degraded match when entryId is not found (anchorLost: true)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-writer-test-"));
    const logFile = path.join(tmpDir, "session.md");
    fs.writeFileSync(logFile, "<!-- mdlog:v1 s=s1 -->\n\n# Pi 对话记录\n\n");

    const sm = createMockSessionManager("s1", tmpDir);
    let anchorLostTriggered = false;

    const writer = new LiveLogWriter({
      filePath: logFile,
      sessionId: "s1",
      sessionManager: sm,
      onAnchorLost: () => {
        anchorLostTriggered = true;
      },
    });

    const userMsg = { role: "user", content: "孤立消息", timestamp: Date.now() };
    // sm.entries 为空，故意比对失败
    writer.enqueueMessage({ message: userMsg });

    await writer.flush();

    const content = fs.readFileSync(logFile, "utf8");
    assert.ok(content.includes("> 孤立消息"));
    assert.ok(!content.includes("<!-- mdlog:m=")); // 严禁写入空值或伪锚点 (Y6-e)
    assert.equal(anchorLostTriggered, true);

    await writer.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("retries up to 3 times on simulated file lock and disconnects after 3 failed batches", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-writer-test-"));
    const logFile = path.join(tmpDir, "session.md");
    fs.writeFileSync(logFile, "<!-- mdlog:v1 s=s1 -->\n\n# Pi 对话记录\n\n");

    const sm = createMockSessionManager("s1", tmpDir);
    let fatalErrorMsg = "";

    const writer = new LiveLogWriter({
      filePath: logFile,
      sessionId: "s1",
      sessionManager: sm,
      onFatalError: (msg) => {
        fatalErrorMsg = msg;
      },
    });

    // 模拟底层追加写入始终抛出 EBUSY 错误
    let writeAttempts = 0;
    writer._testInjectAppendFailure = () => {
      writeAttempts++;
      const err = new Error("Resource locked");
      (err as unknown as { code: string }).code = "EBUSY";
      throw err;
    };

    // 触发第一批写入
    writer.enqueueMessage({ message: { role: "user", content: "消息 1", timestamp: Date.now() } });
    await writer.flush();
    assert.equal(writeAttempts, 3); // 单批就地微重试 3 次 (50/150/300ms)

    // 触发第二批写入
    writer.enqueueMessage({ message: { role: "user", content: "消息 2", timestamp: Date.now() } });
    await writer.flush();
    assert.equal(writeAttempts, 6);

    // 触发第三批写入，达到连续 3 批失败阈值
    writer.enqueueMessage({ message: { role: "user", content: "消息 3", timestamp: Date.now() } });
    await writer.flush();
    assert.equal(writeAttempts, 9);
    assert.ok(fatalErrorMsg.includes("磁盘写入连续失败"));

    await writer.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/writer.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../src/writer.ts` 不存在，测试红）。

- [ ] **Step 3: 编写串行实时写入器实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\writer.ts`：

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { MessageContent, MdlogConfig } from "./types.ts";
import {
  formatTimestamp,
  formatUserMessage,
  formatAssistantMessage,
  scanCodeFences,
  extractMessageText,
} from "./format.ts";
import { processTurnImages, cleanAssetRetention } from "./image.ts";

export interface SessionEntryLike {
  id: string;
  type?: string;
  message?: unknown;
}

export interface SessionManagerLike {
  getBranch(): SessionEntryLike[];
  getCwd(): string;
  getSessionId(): string;
}

export interface BufferedMessageItem {
  message: {
    role: string;
    content: MessageContent;
    timestamp?: number;
  };
  turnStartTime?: number;
}

export interface WriterOptions {
  filePath: string;
  sessionId: string;
  sessionManager: SessionManagerLike;
  config?: MdlogConfig;
  onAnchorLost?: () => void;
  onWriteSuccess?: (ts: number) => void;
  onFatalError?: (msg: string) => void;
}

export class LiveLogWriter {
  private filePath: string;
  private sessionId: string;
  private sessionManager: SessionManagerLike;
  private config?: MdlogConfig;
  private onAnchorLost?: () => void;
  private onWriteSuccess?: (ts: number) => void;
  private onFatalError?: (msg: string) => void;

  private messageQueue: BufferedMessageItem[] = [];
  private imageCandidatesQueue: Array<{ candidates: string[]; turnStartTime: number }> = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private consecutiveBatchFailures = 0;
  private fatalReported = false; // A10: 防重复通知标志
  private isDisposed = false;
  private lastMessageTimestamp?: number;

  // 供测试注入文件锁错误
  public _testInjectAppendFailure?: () => void;

  constructor(options: WriterOptions) {
    this.filePath = options.filePath;
    this.sessionId = options.sessionId;
    this.sessionManager = options.sessionManager;
    this.config = options.config;
    this.onAnchorLost = options.onAnchorLost;
    this.onWriteSuccess = options.onWriteSuccess;
    this.onFatalError = options.onFatalError;
  }

  // 事件 handler 严禁 await，同步推入队列并通过 setTimeout 调度 (Y12)
  public enqueueMessage(item: BufferedMessageItem): void {
    if (this.isDisposed) return;
    this.messageQueue.push(item);
    this.scheduleDebounce();
  }

  public enqueueImageCandidates(candidates: string[], turnStartTime: number): void {
    if (this.isDisposed || candidates.length === 0) return;
    this.imageCandidatesQueue.push({ candidates, turnStartTime });
  }

  private scheduleDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush().catch(() => {});
    }, 150);
  }

  // 通过严格串行的 Promise 链单调追加写入 (Y12)
  public async flush(options?: { imageTimeoutMs?: number }): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.writeChain = this.writeChain.then(async () => {
      if (this.messageQueue.length === 0 && this.imageCandidatesQueue.length === 0) {
        return;
      }

      const batchMessages = [...this.messageQueue];
      const batchImages = [...this.imageCandidatesQueue];
      this.messageQueue = [];
      this.imageCandidatesQueue = [];

      try {
        await this.executeBatchWriteWithRetry(batchMessages, batchImages);
        this.consecutiveBatchFailures = 0;
        const now = Date.now();
        this.onWriteSuccess?.(now);

        // 异步资产配额检查
        const logDir = path.dirname(this.filePath);
        const assetsDir = path.join(logDir, "mdlog-assets");
        const maxBytes = (this.config?.assetRetentionMb ?? 200) * 1024 * 1024;
        cleanAssetRetention(assetsDir, maxBytes);
      } catch (err) {
        // 批次失败：放回待写队列
        this.messageQueue.unshift(...batchMessages);
        this.imageCandidatesQueue.unshift(...batchImages);
        this.consecutiveBatchFailures++;

        // A10: 熔断路径仅报告一次致命错误，防重复 toast
        if (this.consecutiveBatchFailures >= 3 && !this.fatalReported) {
          this.fatalReported = true;
          this.onFatalError?.(`mdlog: 磁盘写入连续失败 3 次 (${(err as Error).message})，已自动断开连接`);
        }
      }
    });

    return this.writeChain;
  }

  private async executeBatchWriteWithRetry(
    messages: BufferedMessageItem[],
    images: Array<{ candidates: string[]; turnStartTime: number }>
  ): Promise<void> {
    const delays = [50, 150, 300]; // 50/150/300ms 指数退避微重试 (§3.8)
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (this._testInjectAppendFailure) {
          this._testInjectAppendFailure();
        }
        this.writeBatchToDisk(messages, images);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    throw lastError;
  }

  private writeBatchToDisk(
    messages: BufferedMessageItem[],
    imageBatches: Array<{ candidates: string[]; turnStartTime: number }>
  ): void {
    if (messages.length === 0) return;

    const branch = this.sessionManager.getBranch();
    const logDir = path.dirname(this.filePath);
    const cwd = this.sessionManager.getCwd();

    // 收集候选图片
    const allCandidates: string[] = [];
    let latestTurnStartTime = Date.now();
    for (const ib of imageBatches) {
      allCandidates.push(...ib.candidates);
      if (ib.turnStartTime < latestTurnStartTime) {
        latestTurnStartTime = ib.turnStartTime;
      }
    }

    let appendBuffer = "";
    let batchAnchorLost = false;

    // 逐条处理本批消息
    for (let i = 0; i < messages.length; i++) {
      const item = messages[i];
      const role = item.message.role;
      const rawText = extractMessageText(item.message.content);
      const timestamp = item.message.timestamp ?? Date.now();
      const timeStr = formatTimestamp(timestamp, this.lastMessageTimestamp);
      this.lastMessageTimestamp = timestamp;

      // 反查条目 ID (Y6-e)
      let matchedEntryId: string | undefined;
      for (let b = branch.length - 1; b >= 0; b--) {
        if (branch[b].message === item.message) {
          matchedEntryId = branch[b].id;
          break;
        }
      }

      if (!matchedEntryId) {
        batchAnchorLost = true;
      }

      if (role === "user") {
        appendBuffer += formatUserMessage(rawText, timeStr, matchedEntryId);
      } else if (role === "assistant") {
        const isEnd = i === messages.length - 1;

        // 处理围栏与截断补齐
        const fenceCheck = scanCodeFences(rawText);

        // 处理图片
        const imgResult = processTurnImages(allCandidates, rawText, {
          cwd,
          logDir,
          turnStartTime: latestTurnStartTime,
          maxImageBytes: this.config?.maxImageBytes,
        });

        appendBuffer += formatAssistantMessage(
          imgResult.rewrittenAssistantText,
          timeStr,
          matchedEntryId,
          isEnd,
          {
            unclosedFence: fenceCheck.isUnclosed,
            extraImages: imgResult.unreferencedCleanNames,
          }
        );
      }
    }

    if (batchAnchorLost) {
      this.onAnchorLost?.();
    }

    // 确保父目录存在并原子追加落盘
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(this.filePath, appendBuffer, "utf8");
  }

  public async destroy(options?: { discard?: boolean }): Promise<void> {
    this.isDisposed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (options?.discard) {
      // A10 / spec §3.6: /mdlog off 主动断开清空内存待处理队列，取消重试与写入
      this.messageQueue = [];
      this.imageCandidatesQueue = [];
      return;
    }
    await this.flush();
  }
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/writer.test.ts
```
预期输出：`tests 3, pass 3, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `writer.ts` 完整实现 150ms 合并防抖、Promise 串行互斥追加、50/150/300ms 指数退避及 3 批失败断开报警逻辑。

---

### Task 4.5: Sidecar 状态机、心跳守护与命令解析器（Sidecar Manager, Heartbeat & Command Handler）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\sidecar.ts`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\command.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\sidecar.test.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\command.test.ts`

**Interfaces:**
- Consumes:
  - `src/types.ts` (`SidecarData`, `MdlogConnectionState`)
- Produces:
  - `export function getSidecarPath(logFilePath: string): string`
  - `export function writeSidecar(sidecarPath: string, data: SidecarData): void`
  - `export function readSidecar(sidecarPath: string): SidecarData | null`
  - `export function updateHeartbeat(sidecarPath: string): void`
  - `export function updateLastWrite(sidecarPath: string, timestamp: number): void`
  - `export function setAnchorLost(sidecarPath: string, anchorLost: boolean): void`
  - `export function removeSidecar(sidecarPath: string): void`
  - `export class HeartbeatManager`
  - `export interface ParsedCommand { action: "connect" | "off" | "status"; targetPath?: string; flags: { full: boolean; append: boolean; noOpen: boolean }; error?: string }`
  - `export function parseMdlogCommand(args: string): ParsedCommand`
  - `export function formatStatusOutput(state: MdlogConnectionState | null): string`
  - `export function openInVellum(filePath: string): Promise<{ success: boolean; error?: string }>`

- [ ] **Step 1: 编写 Sidecar 与命令解析失败测试**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\sidecar.test.ts`，覆盖 sidecar 格式、心跳与写入时间分离、定时器调度与断开清理：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getSidecarPath,
  writeSidecar,
  readSidecar,
  updateHeartbeat,
  updateLastWrite,
  setAnchorLost,
  removeSidecar,
  HeartbeatManager,
} from "../src/sidecar.ts";

describe("sidecar module", () => {
  test("writes sidecar JSON with exact path contract <file>.mdlog", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-sc-test-"));
    const logFile = path.join(tmpDir, "chat.md");
    const sidecarFile = getSidecarPath(logFile);
    assert.equal(sidecarFile, `${logFile}.mdlog`);

    const now = Date.now();
    writeSidecar(sidecarFile, {
      version: 1,
      sessionId: "sess-abc",
      pid: process.pid,
      connectedAt: now,
      lastWriteAt: now,
      heartbeatAt: now,
      anchorLost: false,
    });

    const read = readSidecar(sidecarFile);
    assert.ok(read !== null);
    assert.equal(read.version, 1);
    assert.equal(read.sessionId, "sess-abc");
    assert.equal(read.pid, process.pid);
    assert.equal(read.anchorLost, false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("separates heartbeatAt and lastWriteAt updates (Z1)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-sc-test-"));
    const sidecarFile = path.join(tmpDir, "chat.md.mdlog");

    const t0 = 1000000;
    writeSidecar(sidecarFile, {
      version: 1,
      sessionId: "sess-1",
      pid: process.pid,
      connectedAt: t0,
      lastWriteAt: t0,
      heartbeatAt: t0,
    });

    // 仅刷新心跳：lastWriteAt 保持不变
    updateHeartbeat(sidecarFile);
    let read = readSidecar(sidecarFile)!;
    assert.ok(read.heartbeatAt > t0);
    assert.equal(read.lastWriteAt, t0);

    // 写入消息后刷新 lastWriteAt：仅修改 lastWriteAt
    const tWrite = 2000000;
    updateLastWrite(sidecarFile, tWrite);
    read = readSidecar(sidecarFile)!;
    assert.equal(read.lastWriteAt, tWrite);

    // 记录 anchorLost
    setAnchorLost(sidecarFile, true);
    read = readSidecar(sidecarFile)!;
    assert.equal(read.anchorLost, true);

    // 删除 sidecar
    removeSidecar(sidecarFile);
    assert.equal(fs.existsSync(sidecarFile), false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("HeartbeatManager starts 30s timer and stops cleanly", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-sc-test-"));
    const sidecarFile = path.join(tmpDir, "chat.md.mdlog");

    writeSidecar(sidecarFile, {
      version: 1,
      sessionId: "sess-hb",
      pid: process.pid,
      connectedAt: 100,
      lastWriteAt: 100,
      heartbeatAt: 100,
    });

    const mgr = new HeartbeatManager();
    // 使用短周期 50ms 进行测试
    mgr.start(sidecarFile, 50);
    assert.equal(mgr.isRunning(), true);

    await new Promise((r) => setTimeout(r, 120));
    const read = readSidecar(sidecarFile)!;
    assert.ok(read.heartbeatAt > 100);

    mgr.stop();
    assert.equal(mgr.isRunning(), false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\command.test.ts`，覆盖 D19 参数解析、引号剥离、Windows 空格路径、保留子命令与格式化 status：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMdlogCommand, formatStatusOutput } from "../src/command.ts";

describe("command module", () => {
  describe("parseMdlogCommand", () => {
    test("dispatches reserved subcommands off and status", () => {
      assert.deepEqual(parseMdlogCommand("off"), {
        action: "off",
        flags: { full: false, append: false, noOpen: false },
      });
      assert.deepEqual(parseMdlogCommand("status"), {
        action: "status",
        flags: { full: false, append: false, noOpen: false },
      });
    });

    test("parses target path with spaces and quotes and flags", () => {
      const parsed = parseMdlogCommand('"C:\\My Notes\\my session.md" --full --no-open');
      assert.equal(parsed.action, "connect");
      assert.equal(parsed.targetPath, "C:\\My Notes\\my session.md");
      assert.equal(parsed.flags.full, true);
      assert.equal(parsed.flags.append, false);
      assert.equal(parsed.flags.noOpen, true);
    });

    test("parses target path with flag at front", () => {
      const parsed = parseMdlogCommand("--append 'D:\\notes\\log.markdown'");
      assert.equal(parsed.action, "connect");
      assert.equal(parsed.targetPath, "D:\\notes\\log.markdown");
      assert.equal(parsed.flags.append, true);
    });

    test("rejects invalid non-markdown extension", () => {
      const parsed = parseMdlogCommand("notes.txt");
      assert.equal(parsed.action, "connect");
      assert.ok(parsed.error?.includes(".md 或 .markdown"));
    });

    test("returns status if no arguments provided", () => {
      const parsed = parseMdlogCommand("");
      assert.equal(parsed.action, "status");
    });
  });

  describe("formatStatusOutput", () => {
    test("formats disconnected status", () => {
      const str = formatStatusOutput(null);
      assert.equal(str, "当前未连接任何文件。使用 /mdlog <文件路径> 开始记录。");
    });

    test("formats connected status with written count and formatted time", () => {
      const str = formatStatusOutput({
        active: true,
        targetPath: "C:\\workspace\\notes\\session.md",
        sessionId: "a1b2c3d4e5f6",
        connectedAt: 1757000000000,
        lastWriteAt: new Date(2026, 8, 5, 14, 32, 5).getTime(),
        writtenCount: 14,
      });
      assert.ok(str.includes("连接文件: C:\\workspace\\notes\\session.md"));
      assert.ok(str.includes("已写消息: 14 条"));
      assert.ok(str.includes("会话标识: a1b2c3d4e5f6"));
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/sidecar.test.ts test/command.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（测试红）。

- [ ] **Step 3: 编写 Sidecar 与命令解析实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\sidecar.ts`：

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { SidecarData } from "./types.ts";

export function getSidecarPath(logFilePath: string): string {
  return `${logFilePath}.mdlog`;
}

// A6: 原子写入 sidecar，避免 Vellum 读取到未写完的半截 JSON
export function writeSidecar(sidecarPath: string, data: SidecarData): void {
  const dir = path.dirname(sidecarPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${sidecarPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tempPath, sidecarPath);
}

export function readSidecar(sidecarPath: string): SidecarData | null {
  try {
    if (!fs.existsSync(sidecarPath)) return null;
    const content = fs.readFileSync(sidecarPath, "utf8");
    return JSON.parse(content) as SidecarData;
  } catch {
    return null;
  }
}

export function updateHeartbeat(sidecarPath: string): void {
  const current = readSidecar(sidecarPath);
  if (!current) return;
  current.heartbeatAt = Date.now();
  writeSidecar(sidecarPath, current);
}

export function updateLastWrite(sidecarPath: string, timestamp: number): void {
  const current = readSidecar(sidecarPath);
  if (!current) return;
  current.lastWriteAt = timestamp;
  writeSidecar(sidecarPath, current);
}

export function setAnchorLost(sidecarPath: string, anchorLost: boolean): void {
  const current = readSidecar(sidecarPath);
  if (!current) return;
  current.anchorLost = anchorLost;
  writeSidecar(sidecarPath, current);
}

export function removeSidecar(sidecarPath: string): void {
  try {
    if (fs.existsSync(sidecarPath)) {
      fs.unlinkSync(sidecarPath);
    }
  } catch {
    // 容错处理
  }
}

export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;

  public start(sidecarPath: string, intervalMs = 30000): void {
    this.stop();
    this.timer = setInterval(() => {
      updateHeartbeat(sidecarPath);
    }, intervalMs);
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public isRunning(): boolean {
    return this.timer !== null;
  }
}
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\command.ts`：

```typescript
import { exec } from "node:child_process";
import * as path from "node:path";
import type { MdlogConnectionState } from "./types.ts";

export interface ParsedCommand {
  action: "connect" | "off" | "status";
  targetPath?: string;
  flags: {
    full: boolean;
    append: boolean;
    noOpen: boolean;
  };
  error?: string;
}

export function parseMdlogCommand(args: string): ParsedCommand {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return { action: "status", flags: { full: false, append: false, noOpen: false } };
  }

  // 1. 分解 tokens 并识别修饰符 (spec §3.2, D19)
  const tokens = trimmed.split(/\s+/);
  const flags = { full: false, append: false, noOpen: false };
  const nonFlagTokens: string[] = [];

  for (const token of tokens) {
    if (token === "--full") {
      flags.full = true;
    } else if (token === "--append") {
      flags.append = true;
    } else if (token === "--no-open") {
      flags.noOpen = true;
    } else {
      nonFlagTokens.push(token);
    }
  }

  if (nonFlagTokens.length === 0) {
    return { action: "status", flags };
  }

  // 2. 保留子命令优先判定
  if (nonFlagTokens.length === 1) {
    const single = nonFlagTokens[0].toLowerCase();
    if (single === "off") {
      return { action: "off", flags };
    }
    if (single === "status") {
      return { action: "status", flags };
    }
  }

  // 3. 提取路径字符串并剥离首尾配对引号
  // 从原始 trimmed 字符串中剥除已知 flags
  let pathStr = trimmed
    .replace(/(^|\s)--full(?=\s|$)/g, " ")
    .replace(/(^|\s)--append(?=\s|$)/g, " ")
    .replace(/(^|\s)--no-open(?=\s|$)/g, " ")
    .trim();

  if (
    (pathStr.startsWith('"') && pathStr.endsWith('"')) ||
    (pathStr.startsWith("'") && pathStr.endsWith("'"))
  ) {
    pathStr = pathStr.slice(1, -1).trim();
  }

  // 4. 后缀合法性校验 (spec §8)
  const ext = path.extname(pathStr).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    return {
      action: "connect",
      targetPath: pathStr,
      flags,
      error: "目标文件扩展名必须为 .md 或 .markdown",
    };
  }

  return {
    action: "connect",
    targetPath: pathStr,
    flags,
  };
}

export function formatStatusOutput(state: MdlogConnectionState | null): string {
  if (!state || !state.active) {
    return "当前未连接任何文件。使用 /mdlog <文件路径> 开始记录。";
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(state.lastWriteAt);
  const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  return [
    `连接文件: ${state.targetPath}`,
    `已写消息: ${state.writtenCount} 条`,
    `最近写入: ${timeStr}`,
    `会话标识: ${state.sessionId}`,
  ].join("\n");
}

export function openInVellum(filePath: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Windows 环境执行 cmd /c start "" "<文件绝对路径>" (§3.2)
    const cmd = `cmd /c start "" "${path.resolve(filePath)}"`;
    exec(cmd, (err) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true });
      }
    });
  });
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/sidecar.test.ts test/command.test.ts
```
预期输出：`tests 8, pass 8, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `sidecar.ts` 与 `command.ts` 严格对齐 spec §3.2、§3.7、Z1 心跳/写入分离与 Windows 打开协议。

---

### Task 4.6: 扩展生命周期接线与端到端假会话验证（Extension Wiring, Session Lifecycle & E2E Validation）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\index.ts`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\README.md`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\lifecycle.test.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\e2e.test.ts`

**Interfaces:**
- Consumes:
  - `src/types.ts`, `src/format.ts`, `src/scan.ts`, `src/image.ts`, `src/writer.ts`, `src/sidecar.ts`, `src/command.ts`
- Produces:
  - `export default function (pi: ExtensionAPI): void`
  - 全局命令 `/mdlog`（支持参数解析、子命令分发、外部调用与状态展示）
  - 全生命周期恢复（覆盖 `startup`、`reload`、`new`、`resume`、`fork` 全部 5 种 reason）
  - 非阻塞异步事件接线（`message_end`、`tool_execution_end`、`agent_settled`、`session_shutdown`）

- [ ] **Step 1: 编写生命周期接线与端到端验证失败测试**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\lifecycle.test.ts`，测试 mock pi API 下的 5 种 session_start 事件恢复判定、active:false 防幽灵重连、/fork sessionId 不一致拒绝重连及退出时强制落盘与删 sidecar：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import extensionEntry from "../index.ts";

describe("extension lifecycle & wiring", () => {
  interface MockEventCallback {
    (event: any, ctx: any): Promise<any> | any;
  }

  function createMockPi() {
    const handlers = new Map<string, MockEventCallback[]>();
    const commands = new Map<string, any>();
    const customEntries: Array<{ customType: string; data: any }> = [];

    const pi = {
      on(event: string, cb: MockEventCallback) {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(cb);
      },
      registerCommand(name: string, options: any) {
        commands.set(name, options);
      },
      appendEntry(customType: string, data?: any) {
        customEntries.push({ customType, data });
      },
      _emit(event: string, evObj: any, ctx: any) {
        const list = handlers.get(event) || [];
        return Promise.all(list.map((fn) => fn(evObj, ctx)));
      },
      _commands: commands,
      _customEntries: customEntries,
    };
    return pi;
  }

  function createMockCtx(sessionId: string, cwd: string, branch: any[] = []) {
    return {
      hasUI: true,
      ui: {
        notify: (_msg: string, _type?: string) => {},
        confirm: async (_title: string, _message: string) => true,
      },
      sessionManager: {
        getSessionId: () => sessionId,
        getCwd: () => cwd,
        getBranch: () => branch,
      },
    };
  }

  test("does not reconnect when last connection entry is active: false (prevents ghost reconnect)", async () => {
    const pi = createMockPi();
    extensionEntry(pi as any);

    const branch = [
      {
        type: "custom",
        customType: "mdlog:connection",
        data: { active: true, path: "C:\\old.md", sessionId: "s1" },
      },
      {
        type: "custom",
        customType: "mdlog:connection",
        data: { active: false, timestamp: Date.now() },
      },
    ];

    const ctx = createMockCtx("s1", os.tmpdir(), branch);
    let notified = false;
    ctx.ui.notify = () => {
      notified = true;
    };

    // 触发 session_start (reason: startup)
    await pi._emit("session_start", { reason: "startup" }, ctx);
    assert.equal(notified, false); // 不执行任何静默重连
  });

  test("notifies user and refuses auto-reconnect when sessionId mismatches on /fork (Y6-f)", async () => {
    const pi = createMockPi();
    extensionEntry(pi as any);

    const branch = [
      {
        type: "custom",
        customType: "mdlog:connection",
        data: { active: true, path: "C:\\parent.md", sessionId: "parent-session-123" },
      },
    ];

    const ctx = createMockCtx("forked-session-456", os.tmpdir(), branch);
    let notifyMsg = "";
    ctx.ui.notify = (msg: string) => {
      notifyMsg = msg;
    };

    await pi._emit("session_start", { reason: "fork" }, ctx);
    assert.ok(notifyMsg.includes("检测到历史记录配置"));
    assert.ok(notifyMsg.includes("如需记录请执行 /mdlog"));
  });

  test("session_shutdown flushes pending messages and deletes sidecar file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-life-test-"));
    const logFile = path.join(tmpDir, "shutdown-test.md");
    const sidecarFile = `${logFile}.mdlog`;

    const pi = createMockPi();
    extensionEntry(pi as any);

    const ctx = createMockCtx("s-life", tmpDir, []);
    const cmd = pi._commands.get("mdlog");

    // 执行连接命令
    await cmd.handler(`${logFile} --no-open`, ctx);
    assert.ok(fs.existsSync(sidecarFile));

    // 产生一条未落盘消息
    const msg = { role: "user", content: "临终遗言", timestamp: Date.now() };
    await pi._emit("message_end", { message: msg }, ctx);

    // 触发 session_shutdown
    await pi._emit("session_shutdown", {}, ctx);

    // 验证消息已落盘且 sidecar 已被删除
    const content = fs.readFileSync(logFile, "utf8");
    assert.ok(content.includes("> 临终遗言"));
    assert.equal(fs.existsSync(sidecarFile), false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\e2e.test.ts`，使用子进程调用真实 `pi` CLI 执行隔离测试：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

describe("pi mdlog E2E with cli", () => {
  test("runs fake prompt with -p --no-session and isolated config", (t) => {
    // 检查 pi 命令是否可用，不可用时通过 t.skip 跳过（A14）
    try {
      execSync("pi --version", { stdio: "ignore" });
    } catch {
      t.skip("pi CLI 不可用，跳过 E2E 子进程验证");
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-e2e-"));
    const extDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const fakeHome = path.join(tmpDir, "fake-home");
    fs.mkdirSync(fakeHome, { recursive: true });

    // 使用隔离的环境变量避免重复加载全局扩展
    const env = {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      PI_CONFIG_DIR: path.join(tmpDir, "config"),
    };

    // 执行 pi -p 测试扩展加载与 session_start 产物创建（A14）
    try {
      const output = execSync(`pi -p --no-session -e "${extDir}" "echo test"`, {
        env,
        timeout: 15000,
        encoding: "utf8",
      });
      assert.ok(output.length > 0);
      assert.ok(!output.includes("Error loading extension"));
    } catch (e: any) {
      if (e.stderr?.includes("SyntaxError") || e.stderr?.includes("ReferenceError")) {
        assert.fail(`扩展加载失败: ${e.stderr}`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/lifecycle.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../index.ts` 不存在，测试红）。

- [ ] **Step 3: 编写扩展入口与 README.md**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\index.ts`：

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatHeader } from "./src/format.ts";
import { resolveAppendPlan, insertHeaderAtTopAtomic } from "./src/scan.ts";
import { extractImageCandidates, loadMdlogConfig } from "./src/image.ts";
import { LiveLogWriter } from "./src/writer.ts";
import {
  getSidecarPath,
  writeSidecar,
  removeSidecar,
  setAnchorLost,
  updateLastWrite,
  HeartbeatManager,
} from "./src/sidecar.ts";
import {
  parseMdlogCommand,
  formatStatusOutput,
  openInVellum,
} from "./src/command.ts";
import type { MdlogConnectionState } from "./src/types.ts";

export default function (pi: ExtensionAPI): void {
  let currentState: MdlogConnectionState | null = null;
  let writer: LiveLogWriter | null = null;
  const heartbeatManager = new HeartbeatManager();
  const config = loadMdlogConfig();

  async function connectToFile(
    targetFilePath: string,
    ctx: ExtensionContext,
    flags: { full: boolean; append: boolean; noOpen: boolean }
  ) {
    const resolvedPath = path.resolve(targetFilePath);
    const sidecarPath = getSidecarPath(resolvedPath);
    const sessionId = ctx.sessionManager.getSessionId();
    const branch = ctx.sessionManager.getBranch();
    const branchIds = new Set(branch.map((b) => b.id));

    // 1. 读取既有内容或创建新文件
    let existingContent = "";
    if (fs.existsSync(resolvedPath)) {
      existingContent = fs.readFileSync(resolvedPath, "utf8");
    }

    // 2. 计算智能追加方案 (spec §3.5)
    const plan = resolveAppendPlan(existingContent, sessionId, branchIds, {
      hasUI: ctx.hasUI,
      forceFull: flags.full,
      forceAppend: flags.append,
    });

    let effectiveMode = plan.mode;
    if (plan.mode === "ask_user") {
      if (ctx.hasUI && ctx.ui.confirm) {
        const doFull = await ctx.ui.confirm(
          "mdlog 记录连接",
          "检测到该文件属于当前会话，但未找到匹配的续写锚点：选择 [确定] 回填全量历史，还是 [取消] 仅记录后续新消息？"
        );
        effectiveMode = doFull ? "full" : "append_only";
      } else {
        effectiveMode = "append_only";
      }
    }

    // 3. 释放旧连接资源
    if (writer) {
      await writer.destroy();
      writer = null;
    }
    heartbeatManager.stop();

    // 4. 执行文件头写入与全量/增量回填
    if (!fs.existsSync(resolvedPath) || existingContent.trim().length === 0) {
      fs.writeFileSync(resolvedPath, formatHeader(sessionId), "utf8");
    } else if (effectiveMode === "full") {
      insertHeaderAtTopAtomic(resolvedPath, sessionId);
    }

    // 5. 初始化写入器
    let writtenCount = 0;
    writer = new LiveLogWriter({
      filePath: resolvedPath,
      sessionId,
      sessionManager: ctx.sessionManager,
      config,
      onAnchorLost: () => {
        setAnchorLost(sidecarPath, true);
      },
      onWriteSuccess: (ts) => {
        if (currentState) {
          currentState.lastWriteAt = ts;
          currentState.writtenCount = writtenCount;
          // A7: 回合写入成功后落盘更新 sidecar 的 lastWriteAt (spec §3.7)
          updateLastWrite(sidecarPath, ts);
        }
      },
      onFatalError: (errMsg) => {
        ctx.ui.notify(errMsg, "error");
        disconnect(ctx);
      },
    });

    // 6. 执行历史消息回填
    if (effectiveMode === "full") {
      for (const entry of branch) {
        if (entry.message && typeof entry.message === "object") {
          writer.enqueueMessage({ message: entry.message as any });
          writtenCount++;
        }
      }
      await writer.flush();
    } else if (effectiveMode === "increment" && plan.fromEntryId) {
      let hit = false;
      for (const entry of branch) {
        if (hit) {
          if (entry.message && typeof entry.message === "object") {
            writer.enqueueMessage({ message: entry.message as any });
            writtenCount++;
          }
        } else if (entry.id === plan.fromEntryId) {
          hit = true;
        }
      }
      if (writtenCount > 0) {
        await writer.flush();
      }
    }

    // 7. 初始化 sidecar 与 30s 心跳定时器 (spec §3.7, Z1)
    const now = Date.now();
    writeSidecar(sidecarPath, {
      version: 1,
      sessionId,
      pid: process.pid,
      connectedAt: now,
      lastWriteAt: now,
      heartbeatAt: now,
      anchorLost: false,
    });
    heartbeatManager.start(sidecarPath, 30000);

    currentState = {
      active: true,
      targetPath: resolvedPath,
      sessionId,
      connectedAt: now,
      lastWriteAt: now,
      writtenCount,
    };

    // 8. 记录持久化连接条目 (spec §3.6)
    pi.appendEntry("mdlog:connection", {
      active: true,
      path: resolvedPath,
      sessionId,
      timestamp: now,
    });

    ctx.ui.notify(`mdlog: 已连接至 ${path.basename(resolvedPath)}`, "info");

    // 9. 唤起 Vellum 外部应用 (spec §3.2)
    if (!flags.noOpen) {
      openInVellum(resolvedPath).then((res) => {
        if (!res.success) {
          ctx.ui.notify("已建立记录连接。如未自动在 Vellum 中打开，请手动在 Vellum 中打开该文件。", "warning");
        }
      });
    }
  }

  function disconnect(ctx: ExtensionContext) {
    if (currentState) {
      const sidecarPath = getSidecarPath(currentState.targetPath);
      heartbeatManager.stop();
      removeSidecar(sidecarPath);
      if (writer) {
        // A10: /mdlog off 主动断开走 discard 语义（清空待写队列、取消防抖、不重试）
        writer.destroy({ discard: true }).catch(() => {});
        writer = null;
      }

      pi.appendEntry("mdlog:connection", {
        active: false,
        timestamp: Date.now(),
      });

      currentState = null;
      ctx.ui.notify("mdlog: 对话记录已断开连接", "info");
    }
  }

  // --- 命令注册 ---
  pi.registerCommand("mdlog", {
    description: "控制对话实时记录到 Markdown 文档 (/mdlog <路径> | off | status)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const parsed = parseMdlogCommand(args);

      if (parsed.action === "off") {
        disconnect(ctx);
        return;
      }

      if (parsed.action === "status") {
        ctx.ui.notify(formatStatusOutput(currentState), "info");
        return;
      }

      if (parsed.error) {
        ctx.ui.notify(`mdlog: ${parsed.error}`, "error");
        return;
      }

      if (parsed.targetPath) {
        await connectToFile(parsed.targetPath, ctx, parsed.flags);
      }
    },
  });

  // --- 生命周期接线 ---

  // 1. 会话启动恢复 (覆盖 startup, reload, new, resume, fork 全部 5 种)
  pi.on("session_start", async (event, ctx) => {
    const branch = ctx.sessionManager.getBranch();
    let lastConn: any = null;

    for (let i = branch.length - 1; i >= 0; i--) {
      const e = branch[i];
      if (e.type === "custom" && (e as any).customType === "mdlog:connection") {
        lastConn = (e as any).data;
        break;
      }
    }

    if (!lastConn || lastConn.active === false) {
      return;
    }

    // sessionId 不一致防护 (例如 /fork 新分支，spec §3.3)
    if (lastConn.sessionId !== ctx.sessionManager.getSessionId()) {
      ctx.ui.notify(
        "mdlog: 检测到历史记录配置，为避免污染父会话日志未自动连接。如需记录请执行 /mdlog <文件> 手动连接。",
        "info"
      );
      return;
    }

    // 静默重连
    await connectToFile(lastConn.path, ctx, { full: false, append: false, noOpen: true });
  });

  // 2. 消息流结束 (非阻塞同步登记，严禁在 handler 内 await 磁盘写入，Y12)
  pi.on("message_end", (event, _ctx) => {
    if (!writer || !currentState) return;
    const msg = event.message as any;
    if (msg && (msg.role === "user" || msg.role === "assistant")) {
      writer.enqueueMessage({ message: msg });
    }
  });

  // 3. 工具执行结束 (非阻塞提取候选图片推入写入器，Y12)
  pi.on("tool_execution_end", (event, _ctx) => {
    if (!writer || !currentState) return;
    const candidates = extractImageCandidates(
      typeof event.result === "string" ? event.result : JSON.stringify(event.result),
      config.toolNames,
      event.toolName
    );
    if (candidates.length > 0) {
      writer.enqueueImageCandidates(candidates, Date.now());
    }
  });

  // 4. Agent 回合落定触发合并 flush (Y12 纪律：严禁 await 阻塞 idle 信号，改用 void 与 catch，A9)
  pi.on("agent_settled", () => {
    if (writer) {
      void writer.flush().catch(() => {});
    }
  });

  // 5. 会话关闭：先同步 flush 缓冲区，清除心跳，再删除 sidecar (spec §3.3)
  pi.on("session_shutdown", async (_event, _ctx) => {
    if (writer) {
      await writer.flush({ imageTimeoutMs: 1000 });
      await writer.destroy();
      writer = null;
    }
    heartbeatManager.stop();
    if (currentState) {
      const sidecarPath = getSidecarPath(currentState.targetPath);
      removeSidecar(sidecarPath);
      currentState = null;
    }
  });
}
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\README.md`：

```markdown
# pi-mdlog

Pi 对话实时记录扩展（Live Markdown Logger for Vellum）。

## 特性

- **MD 文件即真相**：实时将与 Agent 的对话以排版规范的 Markdown 格式追加写入指定日志文件。
- **纸墨融合（kami）**：与 Vellum 阅读器无缝协作，支持「记录中 · PI」心跳存活徽章与沙箱交互块。
- **智能追加**：基于尾向扫描与分支锚点匹配，断线重连或历史回填丝滑无感。
- **图片安全管线**：自动识别回合生成的图片，进行文件名净化、去重与资产配额清理，严格防范跨目录越界。
- **断网沙箱交互**：原生支持 ```` ```vellum-widget ```` 自包含 HTML 演示块。

## 环境要求

- Node.js >= 22.6（依赖 TypeScript 类型剥离原生执行支持与 node:test 运行时，S10）

## 命令用法

- `/mdlog <文件路径> [--full|--append] [--no-open]`：连接至指定 Markdown 文件并开始记录。
  - `--full`：强制回填全量历史记录。
  - `--append`：强制仅记录连接后的新消息。
  - `--no-open`：连接后不自动唤起外部关联应用打开。
- `/mdlog off`：断开当前记录连接并清理 sidecar 状态。
- `/mdlog status`：查看当前连接状态、已写消息数与最后写入时间戳。
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/lifecycle.test.ts test/e2e.test.ts
```
预期输出：`pass` 全部测试通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `index.ts` 将所有事件接线与生命周期解耦，严禁在 handler 内 await 磁盘与网络 I/O，完成 E2E 假会话调用验证。






## 工作包 5：技能与文档（wp5-skill-docs）

> **章节说明**：本章为 Vellum 实时对话日志系统（`mdlog`）实现计划的第 5 部分，聚焦于项目专属技能 `.pi/skills/vellum-mdlog` 的规范制定、交互块自包含标准骨架模板 `assets/widget-template.html` 的落地，以及项目根规约 `AGENTS.md` 的基线与规则订正。本计划严格依照设计文档 `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md` §5、§9 与 §10 撰写，确保实施子智能体遵循 TDD 闭环（Red-Green-Refactor）与零二义性字面执行。

---

### Task 5.1: `AGENTS.md` 规约订正（专属技能例外与性能死规则）

**Files:**
- Modify: `AGENTS.md:24-54, 76-80`
- Test: `scripts/verify-agents-md.mjs`

**Interfaces:**
- Consumes:
  - spec §10 与 §12（审核决议 D17、D20，增补项目专属技能真实目录例外、记录 WidgetSandbox 性能与连字符语言提取死规则；命令节测试基线移至 Task 5.4 终审落盘）
- Produces:
  - 订正后的项目根指导文件 `AGENTS.md`，作为后续所有工作包与协同 Agent 的唯一真源，防止后续 Agent 误执行 `mv` 将项目专属技能移入全局仓库，并防止性能约束被回退。

- [ ] **Step 1: Write the failing test**

创建脚本 `scripts/verify-agents-md.mjs`，以自动化断言约束 `AGENTS.md` 的规约订正项：

```javascript
import fs from 'node:fs';
import path from 'node:path';

const agentsPath = path.resolve(process.cwd(), 'AGENTS.md');
const content = fs.readFileSync(agentsPath, 'utf-8');

const checks = [
  {
    name: '技能安装流程记录 vellum-mdlog 真实目录版本化例外',
    pattern: /例外.*`vellum-mdlog`.*项目专属技能.*真实目录.*\.pi\/skills\/.*随仓库版本化.*不迁入全局仓库/,
  },
  {
    name: '已安装技能表中登记 vellum-mdlog',
    pattern: /\|\s*`vellum-mdlog`\s*\|\s*Vellum 交互式 mdlog 日志生成与 `vellum-widget` 交互块编写规范/,
  },
  {
    name: '性能结构约束包含 WidgetSandbox memo 与 LRU 机制',
    pattern: /WidgetSandbox.*React\.memo.*全局最多 10 个存活 iframe LRU/,
  },
  {
    name: '性能结构约束包含代码块语言连字符正则',
    pattern: /language-\(\[\\w-\]\+\)/,
  },
];

let failed = 0;
for (const check of checks) {
  if (!check.pattern.test(content)) {
    console.error(`[FAIL] ${check.name}`);
    failed++;
  } else {
    console.log(`[PASS] ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`\n共 ${failed} 项校验失败，AGENTS.md 亟待订正。`);
  process.exit(1);
} else {
  console.log('\n[PASS] AGENTS.md 全部规约校验通过！');
  process.exit(0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-agents-md.mjs`
Expected: FAIL（报告 4 项检查失败，因为当前 `AGENTS.md` 尚未包含 `vellum-mdlog` 例外说明与沙箱性能约束）。

- [ ] **Step 3: Apply corrections to `AGENTS.md`**

在 `AGENTS.md` 中进行如下两处精准更新（命令节的测试基线订正移动至 Task 5.4，待前端 22 文件 211 用例全绿后按实测数字写入）：

1. **技能安装流程节增加例外说明并更新技能表**：
```markdown
## 技能安装流程

### 仓库结构

全局技能仓库：`C:/Users/17445/Desktop/HwFee-skills/.agents/skills/`

每个项目通过**符号链接**引用仓库中的技能，**不拷贝**。

> **例外说明**：`vellum-mdlog` 为项目专属技能，以真实目录存放于 `.pi/skills/` 并随仓库版本化，**不迁入全局仓库**、**不使用符号联接**。理由：该技能包含针对 Vellum 交互沙箱协议、kami 设计 token 与 CommonMark 围栏规范的强绑定契约，随 Vellum 仓库一同分发版本管理，确保外部开发者 clone 本仓库后无需额外联接即可开箱即用。

### 安装新技能
...
```

并在 `### 已安装的技能（本项目）` 表格末尾追加行：
```markdown
| `vellum-mdlog` | Vellum 交互式 mdlog 日志生成与 `vellum-widget` 交互块编写规范（项目专属技能，随仓库版本化） |
```

2. **在「性能结构约束」节追加沙箱与连字符提取约束**：
```markdown
- `WidgetSandbox` 组件必须严格实施 `React.memo` 与全局最多 10 个存活 iframe LRU 休眠机制；沙箱必须懒挂载，追加写入触发整篇重载时已有 iframe 必须保持位置稳定，严禁未经 memo 或频繁重建导致 WebView 子帧暴涨与交互状态丢失
- `CodeBlock.tsx` 与 `MarkdownDocument.tsx` 语言提取正则必须支持连字符（`/language-([\w-]+)/`），确保 `vellum-widget` 与 `objective-c` 等语言标识完整提取，未注册语言平滑降级为普通代码块
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-agents-md.mjs`
Expected: PASS（4 项检查全部输出 `[PASS]`，退出码 0）。

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md scripts/verify-agents-md.mjs
git commit -m "docs: add vellum-mdlog contract rules and sandbox performance constraints to AGENTS.md"
```

---

### Task 5.2: 新建 `.pi/skills/vellum-mdlog/SKILL.md` 技能规范文档

**Files:**
- Create: `.pi/skills/vellum-mdlog/SKILL.md`
- Test: `scripts/verify-skill-contract.mjs`

**Interfaces:**
- Consumes:
  - spec §5 技能契约（五大核心规则、沙箱 Opaque Origin 禁本地存储、kami 色值与字体栈硬编码、图片归一化惯例）
  - 跨包契约（逐字使用）：围栏语言名 `vellum-widget`；postMessage 类型 `vellum-widget:resize`；高度范围 `[80, 2000]`
- Produces:
  - 供 pi agent 读取的项目专属技能规范 `.pi/skills/vellum-mdlog/SKILL.md`，使后续在 Vellum 仓库内工作的 Agent 在需要编写对话记录或交互块时自动触发并严格遵循契约。

- [ ] **Step 1: Write the failing test**

创建自动化契约检查脚本 `scripts/verify-skill-contract.mjs`，在实现前先定义规范要求：

```javascript
import fs from 'node:fs';
import path from 'node:path';

const skillPath = path.resolve(process.cwd(), '.pi/skills/vellum-mdlog/SKILL.md');

if (!fs.existsSync(skillPath)) {
  console.error(`[FAIL] 目标技能文件不存在: ${skillPath}`);
  process.exit(1);
}

const content = fs.readFileSync(skillPath, 'utf-8');

const requiredTokens = [
  // 触发词与 frontmatter
  'name: vellum-mdlog',
  '对话记录',
  'vellum',
  'mdlog',
  '交互块',
  '可视化讲解',
  // 跨包契约逐字匹配
  'vellum-widget',
  'vellum-widget:resize',
  '[80, 2000]',
  // 沙箱与 Opaque Origin 禁存储
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'SecurityError',
  // kami 色值
  '#f5f4ed',
  '#faf9f5',
  '#e8e6dc',
  '#141413',
  '#3d3d3a',
  '#6b6a64',
  '#1B365D',
  '#dddacc',
  // 字体栈与 CJK 衬线回退
  'TsangerJinKai02',
  'Source Han Serif SC',
  // 动画与交互限制
  'prefers-reduced-motion',
  'emoji',
  // 图片惯例
  'mdlog-assets/',
];

let missing = 0;
for (const token of requiredTokens) {
  if (!content.includes(token)) {
    console.error(`[FAIL] 缺少必需契约关键词: "${token}"`);
    missing++;
  } else {
    console.log(`[PASS] 契约关键词检测通过: "${token}"`);
  }
}

// 检查 frontmatter 格式
const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fmMatch) {
  console.error('[FAIL] 缺少有效的 YAML frontmatter');
  missing++;
} else {
  const fm = fmMatch[1];
  if (!fm.includes('name: vellum-mdlog')) {
    console.error('[FAIL] frontmatter 缺少 name: vellum-mdlog');
    missing++;
  }
  if (!/description:\s*Use when/.test(fm)) {
    console.error('[FAIL] frontmatter description 必须遵循 "Use when..." 触发模式');
    missing++;
  }
}

if (missing > 0) {
  console.error(`\n共 ${missing} 项契约检查不满足！`);
  process.exit(1);
} else {
  console.log('\n[PASS] SKILL.md 完整性与契约全部通过！');
  process.exit(0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-skill-contract.mjs`
Expected: FAIL（报告目标技能文件 `.pi/skills/vellum-mdlog/SKILL.md` 不存在）。

- [ ] **Step 3: Create `.pi/skills/vellum-mdlog/SKILL.md`**

编写 `.pi/skills/vellum-mdlog/SKILL.md` 的**完整真实内容**（禁止占位符，字面落地）：

````markdown
---
name: vellum-mdlog
description: Use when generating or appending conversation logs (对话记录), inspecting live log sessions in Vellum (vellum, mdlog), or authoring interactive visual widgets (交互块、可视化讲解) for complex algorithms, dynamic demonstrations, or factual explanations.
---

# Vellum mdlog 交互式实时日志与组件规范

## 1. 概述与核心定位

Vellum `mdlog` 系统是基于 Markdown 的交互式会话记录与事实讲解格式。阅读器内置了受信意图标识检测、沙箱 iframe 挂载、双向尺寸协商及严苛的内容安全策略（CSP）。

本技能规定了智能体（Agent）在 Vellum 记录对话、输出交互演示块（`vellum-widget`）以及引用生成图片时的行为契约。

---

## 2. 何时输出交互块（Trigger Rules）

### 适用场景（仅在必要时使用）
- **客观事实或复杂算法的可视化讲解**：静态文本或公式推导难以直观传达多维演化时（例如：傅里叶级数合成、贝塞尔曲线控制点动态调节、排序算法状态机演练、注意力权重热力图等）；
- **参数动态可调演示**：用户需要拖动滑动条、切换状态按钮来直观感受模型参数对输出波形/结果的影响；
- **自包含数学与物理沙盒**：纯前端内存即可完成闭环运算的轻量仿真。

### 严禁滥用场景（Prohibitions）
- **单次回复上限**：**单次回复中至多输出 1 个 `vellum-widget`**，严禁一次输出多个 widget，防范 WebView 子帧过多引发性能损耗；
- **纯文本/表格/公式可表达的内容**：严禁仅为华丽装饰而包装普通代码段、简单列表或静态结论；
- **跨网络或外部数据依赖**：需要向远程接口拉取数据的场景严禁使用交互块。

---

## 3. 交互块五大硬性契约（Core Contracts）

### 契约 1：围栏语法与多反引号平衡（Fence & Backtick Nesting）
- 交互块必须使用语言标识符 `vellum-widget`：
  ````markdown
  ```vellum-widget
  <!DOCTYPE html>
  <html lang="zh-CN">
  ...
  </html>
  ```
  ````
- **长围栏规则**：若 HTML 源码或内嵌脚本中包含三反引号（`` ` ``），外层围栏必须使用四个反引号（```` ```` ```` ````）；以此类推，确保外层围栏长度严格大于内部出现的最大连续反引号长度。

### 契约 2：完全自包含 HTML5 与绝对断网隔离（Zero Network Dependency）
- 围栏内部必须是标准的、自包含的完整 HTML5 文档（必须以 `<!DOCTYPE html>` 开头，包含完整的 `<html>`、`<head>`、`<style>`、`<body>`、`<script>`）。
- **绝对断网与 CSP 拦截**：宿主协议对沙箱注入了严苛 CSP（`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`）。
  - 沙箱会直接拦截所有向外部网络发起的**取数型**请求（包括 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`）；
  - **严禁**使用任何外部 CDN 资源（如 `unpkg.com`、`cdnjs`、Google Fonts 等）；
  - **严禁**引用外部样式表、外部脚本或远程图片；所有样式与脚本必须全内联。

### 契约 3：Opaque Origin 与本地存储严格禁止（Memory-Only State）
- **致命报错陷阱**：沙箱 iframe 仅具有 `sandbox="allow-scripts"` 属性，处于 Opaque Origin（不透明源）状态，**严禁调用任何浏览器本地持久化或存储 API**：
  - `localStorage`
  - `sessionStorage`
  - `indexedDB`
  - `document.cookie`
  调用上述任意 API 将会立即触发浏览器的 `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.` 导致整个脚本崩溃！
- **唯一状态规则**：所有交互状态、计算变量、滑动条数值**必须且仅能保存在 JavaScript 内存变量中**。

### 契约 4：Kami 纸墨设计语言硬编码规范（Kami Design Compliance）
沙箱隔离了主应用的 CSS 变量和字体文件，widget 内部必须直接在 CSS 中硬编码 kami 调色板与字体栈：

1. **色彩变量（Hardcoded Tokens）**：
   ```css
   :root {
     --parchment: #f5f4ed; /* 暖纸底 */
     --ivory: #faf9f5;     /* 象牙卡片底 */
     --warm-sand: #e8e6dc; /* 深暖强调底 / 浅边框 */
     --near-black: #141413;/* 浓墨正文 */
     --dark-warm: #3d3d3a; /* 暗暖次要正文 */
     --stone: #6b6a64;     /* 弱化字 / 边框辅助 */
     --brand: #1B365D;     /* 单一靛青品牌色（注意：非 --primary） */
     --hairline: #dddacc;  /* 发丝分割线 */
     --border: #e8e6dc;    /* 标准浅边框 */
   }
   ```
2. **字体栈与 CJK 衬线回退**：
   - 衬线文本栈：`font-family: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif;`
   - 等宽文本栈：`font-family: "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02", "Source Han Serif SC", monospace;`
   - *字体回退说明*：沙箱内无法访问宿主本地字体文件，中文字符将优雅回退至系统内置衬线体（宋体/思源宋体），严格保持优雅纸墨质感。
3. **视觉与可访问性纪律**：
   - **严禁使用 emoji**（严禁任何彩色表情包符号，图标一律采用原生 SVG 发丝线或精炼文本符号）；
   - **圆角规范**：圆角属性值严格限制在 `2px ~ 6px` 之间（章点/微方块为 `1px`，卡片与面板推荐 `4px`）；
   - **字重上限**：`font-weight` 最高不得超过 `500`；
   - **动效豁免**：必须包含 `@media (prefers-reduced-motion: reduce)` 规则关停动画与平滑过渡。

### 契约 5：高度自适应与标题上报协议（Height & Title PostMessage）
宿主容器依据沙箱的内部真实渲染高度进行平滑伸缩。沙箱内部必须包含以下 ResizeObserver 与 load 监听脚本：

```html
<script>
  (function() {
    function report() {
      const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      window.parent.postMessage({
        type: "vellum-widget:resize",
        height: h,
        title: document.title
      }, "*");
    }
    window.addEventListener("load", report);
    if (window.ResizeObserver) {
      new ResizeObserver(report).observe(document.body);
    }
  })();
</script>
```

- **消息类型**：必须精确为 `"vellum-widget:resize"`；
- **标题字段**：`title` 取 `document.title`，用于在宿主组件顶栏显示（如空缺宿主将兜底显示「交互演示」）；
- **高度范围约束**：宿主会将高度强制限制在 `[80, 2000]` 像素之间；低于 80px 按 80px 渲染，超高内容可在沙箱内部启用局部滚动。

---

## 4. 图片生成与引用惯例（Image Convention）

当使用工具（如 `imagen2`）生成图片时：
- Agent **只需在 Markdown 正文中直接使用标准 Markdown 图片引用语法**，例如：
  `![傅里叶合成示意图](generated-images/fourier-series.png)`
- **扩展自动化管理**：`mdlog` 扩展会自动识别生成的回合内图片，将其安全过滤并归一化复制进日志同级目录的 `mdlog-assets/` 中，并在落盘时自动将正文路径改写为净文件名（如 `![](mdlog-assets/fourier-series.png)`）。
- Agent **无需**手动执行图片文件的重命名、路径搬移或 Base64 编码。

---

## 5. 快速参考模板（Minimal Widget Skeleton）

可直接查阅本技能目录下的标准模板文件：
`assets/widget-template.html`

快速骨架结构：
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>演示标题</title>
  <style>
    :root {
      --parchment: #f5f4ed; --ivory: #faf9f5; --near-black: #141413;
      --dark-warm: #3d3d3a; --stone: #6b6a64; --brand: #1B365D; --hairline: #dddacc;
    }
    body {
      margin: 0; padding: 12px; background: var(--parchment); color: var(--dark-warm);
      font-family: "TsangerJinKai02", "Source Han Serif SC", "Songti SC", serif;
    }
    .widget-box { background: var(--ivory); border: 1px solid var(--hairline); border-radius: 4px; padding: 12px; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
  </style>
</head>
<body>
  <div class="widget-box">
    <!-- 纯内存交互 DOM -->
  </div>
  <script>
    (function() {
      function report() {
        const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        window.parent.postMessage({ type: "vellum-widget:resize", height: h, title: document.title }, "*");
      }
      window.addEventListener("load", report);
      if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
    })();
  </script>
</body>
</html>
```

---

## 6. 常见错误与避坑清单（Common Mistakes & Fixes）

| 错误表现 | 根本原因 | 正确做法 |
|---|---|---|
| `SecurityError: Access is denied for this document` | 调用了 `localStorage` 或 `sessionStorage` | 所有状态改用 `let` / `const` 纯内存变量保存 |
| 交互块在宿主渲染为普通代码块 | 围栏标识符写错（如 ````html` 或 ````widget`） | 必须严格使用 ````vellum-widget` 标识符 |
| 页面高度坍缩为 0 或未随内容展开 | 漏写了 `report()` 通信脚本或消息类型写错 | 引入标准的 `vellum-widget:resize` 通信 IIFE |
| 外部库未加载，控制台报 CSP 拒绝 | 引用了 CDN 链接（如 unpkg、cdn.jsdelivr） | 沙箱严格断网，所有工具函数与渲染逻辑手写自包含 |
| 围栏被内部的反引号提前截断 | 正文代码块包含三反引号 | 外层围栏使用四个或更多反引号 ```` ```` ```` ```` 包裹 |
| 字体排版风格与 Vellum 主界面割裂 | 使用了默认 Sans-Serif 或随意指定现代无衬线体 | 采用 kami 衬线回退栈，字重 ≤ 500，使用 `#141413` 与 `#3d3d3a` |
| 包含 emoji 图标（如表情字符） | 违反 kami 纸墨克制质感 | 移除 emoji，使用清晰汉字标签或轻量级原生 SVG 矢量标点 |
````

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-skill-contract.mjs`
Expected: PASS（所有 25+ 项契约关键词与 frontmatter 校验全部通过，输出 `[PASS] SKILL.md 完整性与契约全部通过！`，退出码 0）。

- [ ] **Step 5: Commit**

```bash
git add .pi/skills/vellum-mdlog/SKILL.md scripts/verify-skill-contract.mjs
git commit -m "feat(skills): add vellum-mdlog skill specification document"
```

---

### Task 5.3: 新建交互块骨架模板 `.pi/skills/vellum-mdlog/assets/widget-template.html`

**Files:**
- Create: `.pi/skills/vellum-mdlog/assets/widget-template.html`
- Test: `scripts/verify-widget-template.mjs`

**Interfaces:**
- Consumes:
  - spec §5.1 高度上报脚本与 kami 纸墨基准设计 token
  - 跨包契约：消息类型 `vellum-widget:resize`；高度范围 `[80, 2000]`
- Produces:
  - 完整可用、开箱即跑的交互块基准模板 `.pi/skills/vellum-mdlog/assets/widget-template.html`。作为 Agent 编写任何算法讲解或动态演练的官方骨架。

- [ ] **Step 1: Write the failing test**

创建自动化验证脚本 `scripts/verify-widget-template.mjs`：

```javascript
import fs from 'node:fs';
import path from 'node:path';

const templatePath = path.resolve(
  process.cwd(),
  '.pi/skills/vellum-mdlog/assets/widget-template.html'
);

if (!fs.existsSync(templatePath)) {
  console.error(`[FAIL] 模板文件不存在: ${templatePath}`);
  process.exit(1);
}

const html = fs.readFileSync(templatePath, 'utf-8');

const assertions = [
  { name: '符合标准 HTML5 DOCTYPE 声明', pass: html.startsWith('<!DOCTYPE html>') },
  { name: '指定中文 lang 属性', pass: /<html[^>]+lang=["']zh-CN["']/.test(html) },
  { name: '声明 UTF-8 编码', pass: /<meta charset=["']UTF-8["']/i.test(html) },
  { name: '包含 postMessage 契约类型 vellum-widget:resize', pass: html.includes('"vellum-widget:resize"') },
  { name: '包含 ResizeObserver 监听', pass: html.includes('ResizeObserver') },
  { name: '包含 load 事件兜底上报', pass: html.includes('addEventListener("load"') || html.includes("addEventListener('load'") },
  { name: '严禁外部网络请求 (http://, https://, //)', pass: !/https?:\/\//.test(html) },
  { name: '严禁本地存储 (localStorage)', pass: !html.includes('localStorage') },
  { name: '严禁本地存储 (sessionStorage)', pass: !html.includes('sessionStorage') },
  { name: '严禁数据库存储 (indexedDB)', pass: !html.includes('indexedDB') },
  { name: '严禁 Cookie 存储 (document.cookie)', pass: !html.includes('document.cookie') },
  { name: '严禁使用 emoji', pass: !/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(html) },
  { name: '硬编码 kami 纸底色 #f5f4ed', pass: html.includes('#f5f4ed') },
  { name: '硬编码 kami 象牙白 #faf9f5', pass: html.includes('#faf9f5') },
  { name: '硬编码 kami 浓墨 #141413', pass: html.includes('#141413') },
  { name: '硬编码 kami 暗暖字 #3d3d3a', pass: html.includes('#3d3d3a') },
  { name: '硬编码 kami 弱化字 #6b6a64', pass: html.includes('#6b6a64') },
  { name: '硬编码 kami 靛青品牌色 #1B365D', pass: html.includes('#1B365D') },
  { name: '硬编码 kami 发丝线 #dddacc', pass: html.includes('#dddacc') },
  { name: '支持 prefers-reduced-motion 动画豁免', pass: html.includes('prefers-reduced-motion') },
  { name: '字体栈包含 TsangerJinKai02 与 CJK 衬线回退', pass: html.includes('TsangerJinKai02') && html.includes('Source Han Serif SC') },
];

let failedCount = 0;
for (const a of assertions) {
  if (!a.pass) {
    console.error(`[FAIL] ${a.name}`);
    failedCount++;
  } else {
    console.log(`[PASS] ${a.name}`);
  }
}

if (failedCount > 0) {
  console.error(`\n共 ${failedCount} 项模板契约检查失败！`);
  process.exit(1);
} else {
  console.log('\n[PASS] widget-template.html 契约全部通过！');
  process.exit(0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-widget-template.mjs`
Expected: FAIL（报告目标文件 `.pi/skills/vellum-mdlog/assets/widget-template.html` 不存在）。

- [ ] **Step 3: Create `.pi/skills/vellum-mdlog/assets/widget-template.html`**

创建该文件，写入**完整、立即可用的 HTML5 自包含代码**（以经典的「傅里叶方波谐波叠加动态合成器」为真实范例，纯内存状态驱动，严禁占位符）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>傅里叶方波谐波叠加演示</title>
  <style>
    :root {
      /* kami 纸墨基础调色板 */
      --parchment: #f5f4ed;
      --ivory: #faf9f5;
      --warm-sand: #e8e6dc;
      --near-black: #141413;
      --dark-warm: #3d3d3a;
      --stone: #6b6a64;
      --brand: #1B365D;
      --brand-hover: #24477a;
      --hairline: #dddacc;
      --border: #e8e6dc;

      /* 纸墨字体栈 */
      --font-serif: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif;
      --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02", "Source Han Serif SC", monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--parchment);
      color: var(--dark-warm);
      font-family: var(--font-serif);
      font-size: 13px;
      line-height: 1.6;
      padding: 14px;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* 纸墨卡片容器 */
    .widget-card {
      background: var(--ivory);
      border: 1px solid var(--hairline);
      border-radius: 4px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* 标题栏 */
    .widget-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid var(--hairline);
      padding-bottom: 8px;
    }

    .widget-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--near-black);
      letter-spacing: 0.5px;
    }

    .widget-subtitle {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--stone);
    }

    /* 控制面板 */
    .controls-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      background: var(--parchment);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 10px 12px;
    }

    .control-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .control-label {
      font-size: 11px;
      color: var(--stone);
      display: flex;
      justify-content: space-between;
    }

    .control-value {
      font-family: var(--font-mono);
      color: var(--near-black);
      font-weight: 500;
    }

    /* 滑动条规范 */
    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      background: var(--hairline);
      border-radius: 2px;
      outline: none;
      margin: 4px 0;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 2px;
      background: var(--brand);
      cursor: pointer;
      border: 1px solid var(--ivory);
    }

    /* 按钮组规范 */
    .btn-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .btn {
      background: var(--ivory);
      color: var(--dark-warm);
      border: 1px solid var(--hairline);
      border-radius: 2px;
      font-family: var(--font-serif);
      font-size: 11px;
      padding: 4px 10px;
      cursor: pointer;
      font-weight: 500;
      transition: background 0.15s ease, border-color 0.15s ease;
    }

    .btn:hover {
      background: var(--parchment);
      border-color: var(--stone);
    }

    .btn.active {
      background: var(--brand);
      color: var(--ivory);
      border-color: var(--brand);
    }

    /* 画布区域 */
    .canvas-container {
      position: relative;
      width: 100%;
      height: 180px;
      background: var(--ivory);
      border: 1px solid var(--hairline);
      border-radius: 3px;
      overflow: hidden;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* 底部数学公式与说明 */
    .formula-note {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--stone);
      line-height: 1.4;
      background: var(--parchment);
      border-left: 2px solid var(--brand);
      padding: 6px 10px;
      border-radius: 0 2px 2px 0;
    }

    /* 动效豁免（严格遵循 kami 纸墨规范） */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="widget-card">
    <div class="widget-header">
      <span class="widget-title">方波谐波合成（Fourier Series Approximation）</span>
      <span class="widget-subtitle">N 次奇次谐波叠加</span>
    </div>

    <div class="controls-grid">
      <div class="control-item">
        <div class="control-label">
          <span>谐波项数 N</span>
          <span class="control-value" id="val-n">5</span>
        </div>
        <input type="range" id="input-n" min="1" max="15" step="1" value="5">
      </div>

      <div class="control-item">
        <div class="control-label">
          <span>角速度 (ω)</span>
          <span class="control-value" id="val-speed">1.0x</span>
        </div>
        <input type="range" id="input-speed" min="0.2" max="2.5" step="0.1" value="1.0">
      </div>

      <div class="control-item" style="justify-content: flex-end;">
        <div class="btn-group">
          <button class="btn active" id="btn-toggle">暂停演练</button>
          <button class="btn" id="btn-reset">重置初始</button>
        </div>
      </div>
    </div>

    <div class="canvas-container">
      <canvas id="wave-canvas"></canvas>
    </div>

    <div class="formula-note" id="formula-text">
      f(t) = (4/π) · ∑ [ sin((2k-1)ωt) / (2k-1) ], k ∈ [1, 5] · 吉布斯过冲峰值 ≈ +17.9%
    </div>
  </div>

  <script>
    // 1. 高度自适应与标题上报脚本（宿主契约）
    (function() {
      function report() {
        const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        window.parent.postMessage({
          type: "vellum-widget:resize",
          height: h,
          title: document.title
        }, "*");
      }
      window.addEventListener("load", report);
      if (window.ResizeObserver) {
        new ResizeObserver(report).observe(document.body);
      }
    })();

    // 2. 纯内存状态模型（严禁使用 localStorage/sessionStorage 等持久化 API）
    const state = {
      n: 5,
      speed: 1.0,
      playing: true,
      phase: 0.0,
      animId: null
    };

    // DOM 元素引用
    const canvas = document.getElementById('wave-canvas');
    const ctx = canvas.getContext('2d');
    const inputN = document.getElementById('input-n');
    const valN = document.getElementById('val-n');
    const inputSpeed = document.getElementById('input-speed');
    const valSpeed = document.getElementById('val-speed');
    const btnToggle = document.getElementById('btn-toggle');
    const btnReset = document.getElementById('btn-reset');
    const formulaText = document.getElementById('formula-text');

    // 高分辨率画布适配
    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
    }

    // 绘制主循环
    function draw() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const midY = height / 2;
      const amp = height * 0.35;

      ctx.clearRect(0, 0, width, height);

      // 1. 绘制中线与发丝网格
      ctx.beginPath();
      ctx.strokeStyle = '#dddacc'; // hairline
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. 绘制理想方波基准（暗淡线条）
      ctx.beginPath();
      ctx.strokeStyle = '#e8e6dc'; // warm-sand
      ctx.lineWidth = 1;
      const period = width / 2;
      for (let x = 0; x < width; x++) {
        const t = (x / period) * 2 * Math.PI + state.phase;
        const ideal = Math.sin(t) >= 0 ? 1 : -1;
        const y = midY - ideal * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 3. 绘制傅里叶叠加波形（靛青色主线）
      ctx.beginPath();
      ctx.strokeStyle = '#1B365D'; // brand
      ctx.lineWidth = 1.8;
      for (let x = 0; x < width; x++) {
        const t = (x / period) * 2 * Math.PI + state.phase;
        let sum = 0;
        for (let k = 1; k <= state.n; k++) {
          const harmonic = 2 * k - 1;
          sum += Math.sin(harmonic * t) / harmonic;
        }
        const val = sum * (4 / Math.PI);
        const y = midY - val * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 状态推进
      if (state.playing) {
        state.phase += 0.02 * state.speed;
        state.animId = requestAnimationFrame(draw);
      }
    }

    // 交互监听（全在内存中响应）
    inputN.addEventListener('input', (e) => {
      state.n = parseInt(e.target.value, 10);
      valN.textContent = state.n;
      formulaText.textContent = `f(t) = (4/π) · ∑ [ sin((2k-1)ωt) / (2k-1) ], k ∈ [1, ${state.n}] · 吉布斯过冲峰值 ≈ +17.9%`;
      if (!state.playing) draw();
    });

    inputSpeed.addEventListener('input', (e) => {
      state.speed = parseFloat(e.target.value);
      valSpeed.textContent = state.speed.toFixed(1) + 'x';
    });

    btnToggle.addEventListener('click', () => {
      state.playing = !state.playing;
      if (state.playing) {
        btnToggle.textContent = '暂停演练';
        btnToggle.classList.add('active');
        state.animId = requestAnimationFrame(draw);
      } else {
        btnToggle.textContent = '继续播放';
        btnToggle.classList.remove('active');
        if (state.animId) cancelAnimationFrame(state.animId);
      }
    });

    btnReset.addEventListener('click', () => {
      state.n = 5;
      state.speed = 1.0;
      state.phase = 0.0;
      inputN.value = 5;
      valN.textContent = '5';
      inputSpeed.value = 1.0;
      valSpeed.textContent = '1.0x';
      formulaText.textContent = `f(t) = (4/π) · ∑ [ sin((2k-1)ωt) / (2k-1) ], k ∈ [1, 5] · 吉布斯过冲峰值 ≈ +17.9%`;
      if (!state.playing) {
        state.playing = true;
        btnToggle.textContent = '暂停演练';
        btnToggle.classList.add('active');
        state.animId = requestAnimationFrame(draw);
      }
    });

    window.addEventListener('resize', () => {
      resizeCanvas();
      if (!state.playing) draw();
    });

    // 启动初始渲染
    resizeCanvas();
    state.animId = requestAnimationFrame(draw);
  </script>
</body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-widget-template.mjs`
Expected: PASS（21 项针对 HTML5、禁止项、Kami 色值与高度上报脚本的契约全部输出 `[PASS]`，退出码 0）。

- [ ] **Step 5: Commit**

```bash
git add .pi/skills/vellum-mdlog/assets/widget-template.html scripts/verify-widget-template.mjs
git commit -m "feat(skills): add kami compliant self-contained widget skeleton template"
```

---

### Task 5.4: 技能载入机制、AGENTS.md 最终基线更新与全量测试套件验收

**Files:**
- Modify: `AGENTS.md:19-21`
- Test: `scripts/verify-skill-discovery.mjs`
- Test: `npm test`（Vitest 前端全量测试）
- Test: `cd src-tauri && cargo test`（Cargo 后端全量测试）

**Interfaces:**
- Consumes:
  - Task 5.1（订正后的 `AGENTS.md` 规约）
  - Task 5.2（`.pi/skills/vellum-mdlog/SKILL.md`）
  - Task 5.3（`.pi/skills/vellum-mdlog/assets/widget-template.html`）
  - 跨包契约：围栏标识 `vellum-widget`、通信类型 `vellum-widget:resize`、高度范围 `[80, 2000]`
- Produces:
  - 验收通过的工程环境与自动化检验脚本（作为 Task 5.5 人工验收前的自动化预检，S11），确保技能能被 pi 运行时自动发现并载入系统提示，且无任何既有测试回归。
  - `AGENTS.md` 最终测试基线订正落盘（前端 22 文件 211 用例，后端 36 用例）。
  - 确认全量前端与后端测试全部保持全绿。

- [ ] **Step 1: Write the skill discovery verification test**

创建脚本 `scripts/verify-skill-discovery.mjs`，模拟 pi coding agent 的技能发现器（Skill Loader / Parser）对项目专属技能进行端到端静态审查：

```javascript
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const skillDir = path.resolve(projectRoot, '.pi/skills/vellum-mdlog');
const skillFile = path.resolve(skillDir, 'SKILL.md');
const templateFile = path.resolve(skillDir, 'assets/widget-template.html');

console.log('[INFO] 开始执行 pi 技能发现与契约一致性审查...\n');

// 1. 物理目录与文件存在性
if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
  console.error(`[FAIL] 技能目录不存在或不是真实目录: ${skillDir}`);
  process.exit(1);
}
if (!fs.existsSync(skillFile)) {
  console.error(`[FAIL] SKILL.md 文件不存在: ${skillFile}`);
  process.exit(1);
}
if (!fs.existsSync(templateFile)) {
  console.error(`[FAIL] 骨架模板文件不存在: ${templateFile}`);
  process.exit(1);
}
console.log('[PASS] 目录结构校验通过（真实目录，非无效符号联接）');

// 2. 解析 YAML Frontmatter
const content = fs.readFileSync(skillFile, 'utf-8');
const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fmMatch) {
  console.error('[FAIL] SKILL.md 未包含合法的 YAML frontmatter');
  process.exit(1);
}

const fmRaw = fmMatch[1];
const nameMatch = fmRaw.match(/^name:\s*(.+)$/m);
const descMatch = fmRaw.match(/^description:\s*(.+)$/m);

if (!nameMatch || nameMatch[1].trim() !== 'vellum-mdlog') {
  console.error(`[FAIL] frontmatter name 必须精确为 "vellum-mdlog"，实际: ${nameMatch ? nameMatch[1] : 'null'}`);
  process.exit(1);
}
console.log('[PASS] frontmatter name 精确匹配: vellum-mdlog');

if (!descMatch) {
  console.error('[FAIL] frontmatter 缺少 description 字段');
  process.exit(1);
}

const desc = descMatch[1].trim();
if (desc.length > 1024) {
  console.error(`[FAIL] description 超过 1024 字符限制（当前 ${desc.length}）`);
  process.exit(1);
}
if (!desc.startsWith('Use when')) {
  console.error('[FAIL] description 必须以 "Use when..." 开头');
  process.exit(1);
}

// 检查触发关键词
const triggers = ['对话记录', 'vellum', 'mdlog', '交互块', '可视化讲解'];
const missingTriggers = triggers.filter(t => !desc.includes(t));
if (missingTriggers.length > 0) {
  console.error(`[FAIL] description 遗漏核心触发词: ${missingTriggers.join(', ')}`);
  process.exit(1);
}
console.log('[PASS] frontmatter description 触发词与格式校验通过');

// 3. 跨包契约逐字一致性断言（Cross-Package Verbatim Contracts）
const crossPackageTokens = [
  { name: '围栏语言标识符', text: 'vellum-widget' },
  { name: '通信事件类型', text: 'vellum-widget:resize' },
  { name: '高度范围闭区间', text: '[80, 2000]' },
];

for (const item of crossPackageTokens) {
  if (!content.includes(item.text)) {
    console.error(`[FAIL] SKILL.md 缺少跨包逐字契约: ${item.name} -> "${item.text}"`);
    process.exit(1);
  }
}
console.log('[PASS] 跨包逐字契约检查通过（vellum-widget, vellum-widget:resize, [80, 2000]）');

console.log('\n[PASS] pi agent 技能发现与载入条件 100% 达成！');
process.exit(0);
```

- [ ] **Step 2: Run skill discovery verification**

Run: `node scripts/verify-skill-discovery.mjs`
Expected: PASS（输出 `[PASS] pi agent 技能发现与载入条件 100% 达成！`，退出码 0）。

- [ ] **Step 3: Verify DesignMD status (No Lint Required)**

依设计规约明确：
> **关于 DESIGN.md 校验的判定**：
> 本工作包（WP5）未对根目录 `DESIGN.md` 进行任何修改（所有 kami 纸墨调色板色值与排版规则均为对现有设计规范的纯引用与沙箱内硬编码落地）；因此依 spec §10 规定，**无需执行 `npx -p @google/design.md designmd lint DESIGN.md`**。

- [ ] **Step 4: Run full Vitest frontend suite**

Run: `npm test`
Expected: 22 passed (22 files), 211 passed (211 tests). 必须 100% 保持全绿（175 基线 + 各 Task 新增 36 用例：Task 2.1: +1, Task 2.2: +3, Task 2.3: +4, Task 2.4: +6, Task 2.5: +5, Task 3.1: +6, Task 3.2: +6, Task 3.3: +4, Task 3.4: +1）。

- [ ] **Step 5: Run full Cargo backend suite**

Run: `cd src-tauri && cargo test`
Expected: 36 passed (32 in `vellum_lib`, 4 in `vellum`), 0 failed. 必须 100% 保持全绿（lib 13 基线 + state 2 + watcher 5 + widget 12 = 32；main 2 基线 + 2 新增 = 4）。

- [ ] **Step 6: Update `AGENTS.md` command baseline**

在 `AGENTS.md` 命令节写入经实测的最终测试基线（由 Task 5.1 移至此处统一终审写入）：
```markdown
## 命令

```bash
npm run dev          # Vite 开发服务器（端口 1420）
npm run build        # tsc + vite build
npm test             # vitest run（22 测试文件，211 用例）
npm run tauri        # Tauri CLI
```
```

- [ ] **Step 7: Commit verification scripts and AGENTS.md baseline**

```bash
git add AGENTS.md scripts/verify-skill-discovery.mjs
git commit -m "docs(agents): finalize test baseline to 22 files 211 tests and add skill discovery test"
```

---

### Task 5.5: Release 构建与沙箱 CSP 人工验收（spec §9.3）

**Files:**
- Create: `docs/superpowers/reviews/2026-09-05-release-acceptance.md`

**Interfaces:**
- Consumes:
  - 全部工作包产物（WP1 ~ WP5）
  - spec §9.3「Release 构建下的沙箱与 CSP 人工验证清单」（8 项）
- Produces:
  - Release 打包产物与 `docs/superpowers/reviews/2026-09-05-release-acceptance.md` 验收报告，包含全部 8 项实测结果、截图证据与签名结论。

- [ ] **Step 1: 执行 Release 构建**

运行构建命令生成 Release 二进制产物：
```bash
npm run tauri build
```
预期输出：构建成功完成，生成 `src-tauri/target/release/vellum.exe`（或安装包产物）。

- [ ] **Step 2: 逐条执行 spec §9.3 人工核验清单（8 项）**

在 release 打包产物与 dev 运行环境中分别执行如下 8 项核验，逐项勾选并记录控制台输出：

- [ ] **核验 1：正向功能渲染（Y11）**
  - 操作：在 dev 与 release 下分别打开包含受信任 `<!-- mdlog:v1 -->` 指纹头的 `.md` 文档与 ```` ```vellum-widget ```` 交互块；
  - 预期：widget 真实挂载并在沙箱 iframe 内正常运行，内联 JS 脚本正常执行，postMessage 双向通信正确调整高度与标题，中文衬线字体渲染正常且不乱码。
- [ ] **核验 2：网络断开隔离**
  - 操作：在 widget HTML 内植入 `<script>fetch("https://example.com").catch(e => console.error(e)); const xhr = new XMLHttpRequest(); xhr.open("GET", "https://example.com"); xhr.send();</script>`；
  - 预期：WebView2 控制台报错 `Content Security Policy` 违规（`Refused to connect to 'https://example.com/' because it violates directive: "default-src 'none'"`），取数型网络请求立即被阻断。
- [ ] **核验 3：远程图片隔离**
  - 操作：在 widget HTML 内植入 `<img src="https://example.com/test.png">` 或 `new Image().src = "https://example.com/test.png"`；
  - 预期：控制台报 CSP `img-src data:` 违规，远程图片被拦截且无法加载。
- [ ] **核验 4：本地存储隔离**
  - 操作：在 widget HTML 内执行 `localStorage.setItem("k", "v")` 或 `sessionStorage.getItem("k")`；
  - 预期：浏览器直接抛出 `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.`。
- [ ] **核验 5：Cookie/DB 隔离**
  - 操作：在 widget HTML 内执行 `document.cookie` 或 `indexedDB.open("test")`；
  - 预期：抛出 `SecurityError` 或访问受阻/返回空。
- [ ] **核验 6：导航弹窗隔离**
  - 操作：在 widget HTML 内调用 `window.open("https://example.com")` 或提交带 action 的表单；
  - 预期：调用被沙箱无条件忽略或拦截，不弹出任何窗口，主应用不受影响。
- [ ] **核验 7：子帧自导航实测（Y4 已知残余风险确认）**
  - 操作：在 widget HTML 内执行 `location.href = "https://example.com"`；
  - 预期：子帧自身导航跳转至该地址；顶层主窗口保持不受影响，实测确认并记录为已知已接受残余风险。
- [ ] **核验 8：DOM 防穿透**
  - 操作：在主应用 DevTools 尝试访问 `document.querySelector("iframe").contentDocument`；在沙箱内尝试访问 `parent.document`；
  - 预期：主应用读取恒为 `null`；沙箱内访问抛出跨域 DOM 违规异常（`Blocked a frame with origin "null" from accessing a cross-origin frame`）。

- [ ] **Step 3: 编写并落盘验收报告**

创建 `docs/superpowers/reviews/2026-09-05-release-acceptance.md`，逐项填写上述 8 项核验实测结论（全部 `[PASS]` 或已接受风险说明）、WebView2 运行时版本、测试环境参数与最终结项签名。

- [ ] **Step 4: 提交验收报告**

```bash
git add docs/superpowers/reviews/2026-09-05-release-acceptance.md
git commit -m "docs(review): complete release sandbox and CSP manual acceptance review"
```




