# 工作包 1：Rust 后端（Task 1.1 - 1.5）实施完成日志

- **开始时间**: 2026-09-05
- **项目根目录**: `C:\Users\17445\Desktop\Vellum`
- **实施工作包**: Task 1.1 至 Task 1.5（工作包 1：Rust 后端）
- **基线验证**:
  - 前端基线: `npm test` 17 文件 / 175 用例全部通过（0 失败）
  - 后端初始基线: `cargo test` 15 用例通过（lib 13 + main 2）
- **最终测试状态**:
  - `cargo test`: 37 用例全绿（lib 33 + main 4，0 失败）
  - `npm test`: 17 文件 / 175 用例全绿（0 失败，前端代码未变动）

---

## 逐 Task 执行记录

### Task 1.1: 抽取 `AppState` 到 `vellum_lib::state`
- **目标**: 将 `AppState` 从 `main.rs` 抽离至 `vellum_lib::state`，解除生命周期耦合并供后续模块复用。
- **改动文件**:
  - 新增: `src-tauri/src/state.rs`
  - 新增: `src-tauri/src/state_tests.rs`
  - 修改: `src-tauri/src/lib.rs`
  - 修改: `src-tauri/src/main.rs`
- **TDD 执行**:
  - Step 1 写失败测试: `state_tests::app_state_implements_send_and_sync`, `state_tests::app_state_initializes_empty_and_allows_interior_mutability`
  - Step 2 跑挂确认: `error[E0432]: unresolved import crate::state`
  - Step 3 最小实现: 实现 `AppState { current, watcher }`，在 `lib.rs` 暴露，在 `main.rs` 替换原定义并清理未使用导入
  - Step 4 跑绿验证: 17 passed (lib 15 + main 2)
  - Step 5 Commit: `8c760fe` (`refactor(backend): extract AppState into vellum_lib::state`)
- **偏差说明**: 无。

---

### Task 1.2: `watcher.rs` 双路独立防抖改造
- **目标**: 实现日志正文（`*.md`）与状态伴随文件（`*.md.mdlog`）互不影响的双路 400ms 独立防抖状态机 `DoubleDebounceTracker` 与 `sidecar_path_for` 辅助函数。
- **改动文件**:
  - 修改: `src-tauri/src/watcher.rs`
  - 新增: `src-tauri/src/watcher_tests.rs`
  - 修改: `src-tauri/src/lib.rs`
- **TDD 执行**:
  - Step 1 写失败测试: 覆盖命名规则、正文变动不影响 sidecar、sidecar 变动不影响正文、最小超时选择、独立分批触发 5 个用例
  - Step 2 跑挂确认: `error[E0432]: unresolved imports crate::watcher::{sidecar_path_for, DebounceEmits, DoubleDebounceTracker}`
  - Step 3 最小实现: 实现 `sidecar_path_for`、`DebounceEmits`、`DoubleDebounceTracker` 并在 `watch_file` 中派发 `file-changed` 与 `mdlog-state-changed` 双路事件
  - Step 4 跑绿验证: 22 passed (lib 20 + main 2)
  - Step 5 Commit: `1f4aff6` (`feat(watcher): support independent double-deadline debounce for log and sidecar`)
- **偏差说明**: 无。

---

### Task 1.3: `widget.rs` 核心数据结构与纯函数（注册表 LRU、协议响应构造与存活仲裁）
- **目标**: 实现容量 64 条 / 单条 512KB 的 LRU widget 注册表、附带 4 条严格安全头的 URI 协议响应构建器、进程存活及 120s 心跳仲裁纯函数与 Win32 原生进程存活检查。
- **改动文件**:
  - 修改: `src-tauri/Cargo.toml`（引入 `uuid = { version = "1", features = ["v4"] }`）
  - 修改: `src-tauri/Cargo.lock`
  - 新增: `src-tauri/src/widget.rs`
  - 新增: `src-tauri/src/widget_tests.rs`
  - 修改: `src-tauri/src/lib.rs`
- **TDD 执行**:
  - Step 1 写失败测试: 7 个用例（512KB 门禁、64 条 LRU 淘汰与 get 提鲜、RegisterResult 驼峰序列化、200/404 安全头注入、存活仲裁矩阵与 Win32 进程无效 pid 检查、UUID v4 格式与随机性）
  - Step 2 跑挂确认: `error[E0432]: unresolved import crate::widget`
  - Step 3 最小实现: 实现 `WidgetRegistry`、`RegisterResult`、`MdlogSidecarData`、`build_widget_response`、`judge_mdlog_alive`、`is_pid_alive_win32`
  - Step 4 跑绿验证: 29 passed (lib 27 + main 2)
  - Step 5 Commit: `9e77538` (`feat(widget): implement widget registry LRU, secure response builder, and alive judge`)
- **偏差说明**: 无。

---

### Task 1.4: `widget.rs` Tauri 命令实现（`register_widget`、`unregister_widget`、`read_mdlog_state`）
- **目标**: 导出 Tauri 命令 `register_widget`、`unregister_widget`、`read_mdlog_state`，定义 `WidgetState` 容器与脱离 Tauri 上下文的高可靠纯测试函数 `read_mdlog_state_from_path`。
- **改动文件**:
  - 修改: `src-tauri/src/widget.rs`
  - 修改: `src-tauri/src/widget_tests.rs`
- **TDD 执行**:
  - Step 1 写失败测试: 6 个用例（无文档路径返回 None、无 sidecar 返回 None、损坏 JSON 返回 None、有效 sidecar 读取与 expiresAt 计算、心跳超时或 pid 死亡判定、WidgetState 读写）
  - Step 2 跑挂确认: `error[E0432]: unresolved imports crate::widget::{read_mdlog_state_from_path, MdlogStateResponse, WidgetState}`
  - Step 3 最小实现: 实现 `WidgetState`、`MdlogStateResponse`、`read_mdlog_state_from_path` 及三个 Tauri 命令
  - Step 4 跑绿验证: 35 passed (lib 33 + main 2)
  - Step 5 Commit: `d950658` (`feat(widget): implement register_widget, unregister_widget, and read_mdlog_state commands`)
- **偏差说明与裁决**:
  - 计划 Step 4 描述中写有 `32 passed`（针对 lib），但实际基线 13 + Task 1.1 (2) + Task 1.2 (5) + Task 1.3 (7) = 27，本任务新增 6 个测试，27 + 6 = 33 个 lib 测试，用例数完全吻合且全部通过。

---

### Task 1.5: `main.rs` 与 `tauri.conf.json` 全局集成
- **目标**: 配置 CSP `frame-src http://vellum-widget.localhost`，注册自定义 URI 协议 `vellum-widget`，改造 `load_document` 引入 `should_rebind` 路径守卫避免同文档热重载误杀注册表与 watcher，全局分发三个 widget 命令。
- **改动文件**:
  - 修改: `src-tauri/tauri.conf.json`
  - 修改: `src-tauri/src/main.rs`
- **TDD 执行**:
  - Step 1 写失败测试: 在 `main.rs` 的 `mod tests` 编写 CSP 配置检查与 `should_rebind` 状态转移矩阵测试
  - Step 2 跑挂确认: `tests::tauri_conf_csp_contains_frame_src_for_widget` 断言失败（缺少 `frame-src http://vellum-widget.localhost`）
  - Step 3 最小实现:
    1. 在 `tauri.conf.json` security.csp 追加 `frame-src http://vellum-widget.localhost`
    2. 在 `main.rs` 引入 `vellum-widget` 协议拦截器、`should_rebind` 守卫改造、`WidgetState` 托管与 `tauri::generate_handler!` 注册命令
  - Step 4 跑绿验证:
    - `cargo test --bin vellum`: 4 passed
    - `cargo test`: 37 passed (lib 33 + main 4)
    - `npm test`: 17 passed (175 passed)
  - Step 5 Commit: `14acbd3` (`feat(main): integrate vellum-widget protocol, lifecycle guard, and CSP frame-src`)
- **偏差说明与裁决**:
  - 在 Tauri 2 架构下，命令函数在子 crate `vellum_lib::widget` 中定义，`tauri::generate_handler!` 宏依赖同作用域的 `__cmd__<name>` 与 `__tauri_command_name_<name>` 伴随宏。通过在 `main.rs` 显式引入对应函数及宏符号，使 `generate_handler![register_widget, unregister_widget, read_mdlog_state]` 照字面保持简洁，同时完全杜绝未使用导入编译器警告。

---

## 变更文件清单

```text
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/tauri.conf.json
src-tauri/src/lib.rs
src-tauri/src/main.rs
src-tauri/src/state.rs
src-tauri/src/state_tests.rs
src-tauri/src/watcher.rs
src-tauri/src/watcher_tests.rs
src-tauri/src/widget.rs
src-tauri/src/widget_tests.rs
```

---

## Git 提交记录

- `8c760fe` - `refactor(backend): extract AppState into vellum_lib::state`
- `1f4aff6` - `feat(watcher): support independent double-deadline debounce for log and sidecar`
- `9e77538` - `feat(widget): implement widget registry LRU, secure response builder, and alive judge`
- `d950658` - `feat(widget): implement register_widget, unregister_widget, and read_mdlog_state commands`
- `14acbd3` - `feat(main): integrate vellum-widget protocol, lifecycle guard, and CSP frame-src`

---

## 验证结果摘要

- `cargo test --manifest-path src-tauri/Cargo.toml`:
  - `vellum_lib` 单元测试: 33 个全绿（0 失败）
  - `vellum` 二进制测试: 4 个全绿（0 失败）
  - Doc 测试: 0 个
  - 总计: 37 passed, 0 failed
- `npm test`:
  - 测试文件: 17 passed (17)
  - 测试用例: 175 passed (175)
  - 耗时: ~4.3s
