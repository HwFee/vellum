# WP1 代码审核报告（reviewer-gemini）

结论：通过

## 逐要点核查（证据：文件:行号）

### 1. 协议安全
- **路径提取单段 id 校验**：通过 (`src-tauri/src/widget.rs:98-112`)
  - `extract_widget_id(uri: &str)` 先通过 `"://"` 剥离协议头，再依据第一个 `'/'` 剥离域名/主机部分，取得资源路径。
  - 使用 `path.trim_matches('/')` 剥离首尾斜杠后，严格断言 `trimmed.is_empty() || trimmed.contains('/')`，若存在多段路径（例如路径穿越 `/id/extra/path`）或空路径则坚决返回 `None`。
  - 单测 `src-tauri/src/widget_tests.rs:118-124` 覆盖了多段路径请求返回 404 的行为。
- **200/404 响应 4 条安全标头覆盖**：通过 (`src-tauri/src/widget.rs:115-146`)
  - `apply_security_headers` 统一注入 4 条安全标头：
    1. `Content-Type: text/html; charset=utf-8`
    2. `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`
    3. `X-Content-Type-Options: nosniff`
    4. `Cache-Control: no-store`
  - 在 `build_widget_response` 中，无论是有效 ID 命中的 200 响应，还是未知 ID、多段越界路径或非 GET 请求引起的 404 响应，均无条件经由 `apply_security_headers` 构建，杜绝了错误回退页面丢失 CSP 保护导致的潜在注入漏洞。
  - 单测 `src-tauri/src/widget_tests.rs:50-124` 分别对 200 分支与全部 404 分支的 4 条标头进行了全量断言。
- **非 GET 请求处理**：通过 (`src-tauri/src/widget.rs:132-136`)
  - 进入函数首要门禁：`if method != "GET"` 立即返回附带完整 4 条安全标头的 404 Not Found 响应，不查询注册表，防止非幂等探测。
- **wry 0.55.1 URI 还原兼容性**：通过 (`src-tauri/src/widget.rs:98-106`, `src-tauri/src/widget_tests.rs:56, 92`)
  - Windows WebView2 环境下，子帧发送的 `http://vellum-widget.localhost/<id>` 在经由 wry 自定义协议拦截时可能保持原样，或被还原为 `vellum-widget://localhost/<id>`。
  - `extract_widget_id` 通过查找 `"://"` 切分，并在后续字符串中取首个 `'/'` 之后的路径切片，天然兼容 `http://` 与 `vellum-widget://` 两种前缀，并成功剥除 `vellum-widget.localhost` 与 `localhost` 域名差异。单测中已同时针对这两种前缀通过验证。

---

### 2. 注册表与守卫
- **LRU get 提鲜与容量淘汰（64 限制）**：通过 (`src-tauri/src/widget.rs:17-68`, `src-tauri/src/widget_tests.rs:24-46`)
  - 注册表容量硬限为 `MAX_REGISTRY_CAPACITY = 64`，单条 HTML 大小硬限为 `MAX_WIDGET_HTML_BYTES = 524,288`（512KB）。
  - `WidgetRegistry::get` 方法在命中 `id` 时，利用 `VecDeque` 将元素移动至队尾（`order.remove(pos)` 后 `order.push_back(item)`），完成了真实的 LRU 提鲜（成真 LRU）。
  - `insert` 超限淘汰逻辑：当注册表已满 64 条且插入新条目时，弹出队首最旧条目（`order.pop_front()` 并从 `entries` 移除）。
  - 单测 `registry_evicts_lru_entry_when_exceeding_64_entries` 验证了：填满 64 条后，提鲜 0 号元素，再插入第 65 条，被淘汰的是 1 号元素，0 号与 64 号元素均得到保留。
- **should_rebind 守卫在 load_document 的接线**：通过 (`src-tauri/src/main.rs:180-216, 251-256`)
  - 纯函数 `should_rebind(current: Option<&PathBuf>, next: &Path, has_watcher: bool) -> bool` 准确定义了状态转移逻辑：当且仅当 `current` 为空、目标路径不一致、或当前 watcher 丢失（异常自愈）时才返回 `true`。
  - 在 `load_document` 中，先持有 `state.current` 与 `state.watcher` 短暂计算 `needs_rebind` 并立即释放锁，避免长范围锁持有。
- **同路径热重载（不清注册表、不重建 watcher）**：通过 (`src-tauri/src/main.rs:180-216`, `src-tauri/src/main.rs:288-289`)
  - 当热重载同路径 Markdown 时，`canonical == current` 且 `watcher.is_some()`，`should_rebind` 返回 `false`。
  - `if needs_rebind` 分支被完全跳过：既不调用 `widget_state.0.lock().clear()`，也不 drop/重建 watcher。
  - 这保障了已渲染 iframe 的 URL 映射不失效，且 watcher 内部正在倒计时的 `sidecar_deadline` 不会被中断扼杀。
- **watcher 缺失自愈**：通过 (`src-tauri/src/main.rs:253`, `src-tauri/src/main.rs:286-287`)
  - 若此前文档加载由于系统资源不足等原因导致 `watcher` 为 `None`，后续即使请求相同文档，`!has_watcher` 也会促使 `should_rebind` 判定为 `true`，重新尝试调用 `watcher::watch_file` 绑定监听器，实现异常自愈。

---

### 3. 进程判定与句柄
- **OpenProcess 失败分支的错误码覆盖**：通过 (`src-tauri/src/widget.rs:167-200`)
  - Win32 原生调用 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)`。
  - 若调用失败（返回 NULL 句柄），调用 `GetLastError()` 获取真实系统错误码：
    - 仅当错误码为 `ERROR_ACCESS_DENIED` 或 `ERROR_SHARING_VIOLATION` 时降级判定为 `true`，防止权限不足将存活的特权进程误判为死亡（交由 120s 心跳超时兜底防线判活）；
    - 遇到其他明确失败错误码（如 `ERROR_INVALID_PARAMETER`、`ERROR_FILE_NOT_FOUND` 等进程不存在情况），坚决返回 `false`。
  - 单测 `src-tauri/src/widget_tests.rs:158-161` 验证了 `u32::MAX` 进程号在 Win32 原生调用下稳定返回 `false`。
- **句柄在所有成功分支下的 CloseHandle 释放**：通过 (`src-tauri/src/widget.rs:178-187`)
  - 当 `handle` 非空时，调用 `GetExitCodeProcess(handle, &mut exit_code)` 获取退出码。
  - `CloseHandle(handle)` 紧随其后无条件执行，早于任何返回值计算与 `return` 分支。
  - 彻底杜绝了 Windows 内核对象泄露（满足 spec §4.3 G2 要求）。
- **judge_mdlog_alive 的 120s 窗口与 expiresAt 计算**：通过 (`src-tauri/src/widget.rs:151-160, 237-243`)
  - 纯函数抽象 `judge_mdlog_alive(state, now, pid_alive)`：
    - 首要断言 `if !pid_alive(state.pid) { return false; }`；
    - 心跳容差使用防溢出减法 `now.saturating_sub(state.heartbeat_at) <= HEARTBEAT_TIMEOUT_MS`（120,000ms）。
  - `read_mdlog_state_from_path` 纯函数计算 `expires_at = data.heartbeat_at.saturating_add(HEARTBEAT_TIMEOUT_MS)`。
  - 当 sidecar 不存在、JSON 损坏、心跳超时或 pid 死亡时，统一返回 `None` 且不误删磁盘文件。单测完整覆盖上述全部矩阵分支。

---

### 4. Watcher 双路防抖
- **两个 deadline 的独立推演推导**：通过 (`src-tauri/src/watcher.rs:32-113`)
  - 结构体 `DoubleDebounceTracker` 显式隔离存储 `log_deadline: Option<Instant>` 与 `sidecar_deadline: Option<Instant>`。
  - `handle_event_paths` 中：
    - 仅当事件路径包含 `target`（`*.md`）时刷新 `log_deadline = Some(now + DEBOUNCE)`；
    - 仅当事件路径包含 `sidecar_target`（`*.md.mdlog`）时刷新 `sidecar_deadline = Some(now + DEBOUNCE)`。
    - 一方的事件绝对不会设置或清空另一方的 deadline。
  - `poll_expired(now)` 中：
    - `log_deadline` 到期则置 `file_changed = true` 并重置为 `None`；
    - `sidecar_deadline` 到期则置 `mdlog_state_changed = true` 并重置为 `None`；
    - 一方到期被消费时，另一方未到期的 deadline 完全保持不变。
- **recv_timeout 取 min 逻辑与时间片计算**：通过 (`src-tauri/src/watcher.rs:62-89`)
  - `compute_timeout` 对两路 deadline 模式匹配：
    - 双路均有时取 `earliest = ld.min(sd)`，若 `earliest <= now` 则返回 `Duration::ZERO` 立即唤醒消费，否则等待 `earliest - now`；
    - 单路激活时仅取该路的剩余时间；
    - 双路均无活动时挂起在 `idle_wait`（3600 秒）。
  - 这一机制确保了后台线程在较早 deadline 到达时精准唤醒，发出第一个事件；接着在下一个循环中等待剩余差值，发出第二个事件，两路防抖完全解耦。单测 `watcher_tests.rs:56-114` 严密验证了该时序。

---

### 5. main.rs 完整性与配置
- **单实例 / WM_COPYDATA / 参数解析代码逐字保留**：通过 (`src-tauri/src/main.rs:18-166, 222-249`)
  - `git diff 4a32de0..HEAD src-tauri/src/main.rs` 审查证实：
    - `early_single_instance` 模块内部命名互斥锁创建、`WM_COPYDATA` 参数序列化发送与进程转发代码未修改任何字符；
    - 官方单实例插件 `tauri_plugin_single_instance::init` 仍然处于插件链最顶端；
    - `first_markdown_from_args`、`drain_pending_open_paths`、`resolve_asset` 逻辑完全保留原样。
- **invoke_handler 注册完整性**：通过 (`src-tauri/src/main.rs:358-365`)
  - `tauri::generate_handler!` 宏中包含全部 6 个命令：
    - 原有命令：`load_document`、`resolve_asset`、`drain_pending_open_paths`
    - 新增命令：`register_widget`、`unregister_widget`、`read_mdlog_state`
  - 并在 Tauri 容器中同时 `.manage(AppState::default())` 与 `.manage(WidgetState::default())`。
- **tauri.conf.json 变更范围**：通过 (`src-tauri/tauri.conf.json:26`)
  - `git diff 4a32de0..HEAD src-tauri/tauri.conf.json` 证实仅修改 `security.csp`，在其末尾追加 `; frame-src http://vellum-widget.localhost`，未触动任何其他字段配置。单测 `tauri_conf_csp_contains_frame_src_for_widget` 持续对配置文件内容做硬编码防漂移断言。

---

### 6. 测试质量与用例边界
- **无恒真断言**：通过
  - 全量检查 `src-tauri/src/*_tests.rs` 与 `src-tauri/src/main.rs` 中的断言语句，不存在 `assert!(true)` 或与常量自我比对的空伪测试，所有断言均有独立的状态输入与预期输出比对。
- **UUID / 碰撞 / 损坏 JSON / PID 矩阵覆盖**：通过
  - `uuid_generation_entropy_and_format_check` 循环生成 1000 个 UUID，断言格式版本 4、RFC 4122 variant，并用 `HashSet` 验证 1000 次生成 0 碰撞；
  - `read_mdlog_state_returns_none_for_corrupted_json` 在临时目录下写入畸变 JSON 文本，断言解析优雅回退为 `None` 不崩溃；
  - `judge_mdlog_alive_matrix_and_pid_fallback_evaluation` 穷尽测试了 `(pid存活, 心跳正常)`、`(pid存活, 心跳超时)`、`(pid死亡, 心跳正常)`、`(pid死亡, 心跳超时)` 全部四象限矩阵；
  - `read_mdlog_state_reads_valid_sidecar_and_computes_expires_at` 验证了 camelCase 字段反序列化与 `expiresAt` 计算正确性。
- **37 vs 36 测试用例差异核查**：通过
  - 核查发现：初始基线为 15 个用例（`document_tests` 13 个 + `main.rs` 2 个）。
  - WP1 实际实施过程中：
    - Task 1.1 新增 2 个（`state_tests`，累计 lib=15）；
    - Task 1.2 新增 5 个（`watcher_tests`，累计 lib=20）；
    - Task 1.3 新增 7 个（`widget_tests`，累计 lib=27）；
    - Task 1.4 新增 6 个（`widget_tests`，累计 lib=33）；
    - Task 1.5 新增 2 个（`main.rs`，累计 bin=4）。
    - 合计：33 + 4 = 37 个用例。
  - 计划文档 `docs/superpowers/plans/2026-09-05-pi-mdlog-live-log.md` line 1322（Task 1.4 Step 4）中预期输出写为 `32 passed`，系因计划编写时的算术加法笔误（27 + 6 误写为 32），并非遗漏或意外多出用例。全部 37 个用例均为有效用例，全绿通过。

---

## 问题清单

### 阻断 (Blocker)
无。

### 应当修复 (Should Fix)
无。

### 建议 (Suggestion)
1. `src-tauri/src/watcher_tests.rs:24`:
   - **内容**：`tracker.handle_event_paths(&[target.clone()], now);`
   - **理由**：Clippy 提示此处在测试用例构造切片时可直接写为 `std::slice::from_ref(&target)` 避免一次不必要的 clone。当前为测试代码且运行开销微乎其微，不影响功能，建议后续清理代码异味时顺手规整。
2. `src-tauri/src/widget.rs:98-112`:
   - **内容**：`extract_widget_id` 从 URI 提取 ID 逻辑：
     ```rust
     let trimmed = path.trim_matches('/');
     if trimmed.is_empty() || trimmed.contains('/') { None } else { Some(trimmed) }
     ```
   - **理由**：若外部请求意外附带 URL 查询参数（如 `http://vellum-widget.localhost/<id>?query=1`），`trimmed` 会取得包含 `?` 的整串字符串，随后在 `registry.get()` 查不到并安全返回 404。此行为符合预期（严格拒绝任何未授权的查询变种），建议在后续维护注释中补充说明该设计故意不剥离 `?` 查询串的原因，增强接口自解释性。

---

## 测试实测输出

### 1. `cargo test --manifest-path src-tauri/Cargo.toml`
```text
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.44s
     Running unittests src\lib.rs (src-tauri\target\debug\deps\vellum_lib-dbaf9a1ac8449447.exe)

running 33 tests
test document_tests::resolve_asset_to_data_url_keeps_remote_urls_unchanged ... ok
test document_tests::resolve_asset_to_data_url_keeps_data_urls_unchanged ... ok
test document_tests::resolve_local_asset_path_keeps_remote_urls_unchanged ... ok
test state_tests::app_state_initializes_empty_and_allows_interior_mutability ... ok
test state_tests::app_state_implements_send_and_sync ... ok
test watcher_tests::derives_correct_sidecar_path ... ok
test watcher_tests::independent_deadlines_take_minimum_timeout ... ok
test watcher_tests::log_event_does_not_affect_sidecar_deadline ... ok
test watcher_tests::poll_expired_emits_each_event_independently ... ok
test watcher_tests::sidecar_event_does_not_affect_log_deadline ... ok
test widget_tests::judge_mdlog_alive_matrix_and_pid_fallback_evaluation ... ok
test widget_tests::build_widget_response_returns_200_with_all_4_security_headers ... ok
test widget_tests::build_widget_response_returns_404_with_all_4_security_headers_for_unknown_or_invalid ... ok
test widget_tests::read_mdlog_state_returns_none_when_current_doc_is_none ... ok
test widget_tests::register_result_serializes_to_camel_case ... ok
test widget_tests::read_mdlog_state_returns_none_when_sidecar_file_does_not_exist ... ok
test widget_tests::registry_evicts_lru_entry_when_exceeding_64_entries ... ok
test widget_tests::registry_rejects_html_exceeding_512kb ... ok
test widget_tests::widget_state_registers_and_unregisters ... ok
test document_tests::load_markdown_file_rejects_missing_file ... ok
test document_tests::load_markdown_file_rejects_non_markdown_files ... ok
test document_tests::load_markdown_file_rejects_non_utf8_content ... ok
test document_tests::load_markdown_file_reads_utf8_content ... ok
test document_tests::load_markdown_file_accepts_uppercase_extension ... ok
test widget_tests::read_mdlog_state_returns_none_for_corrupted_json ... ok
test widget_tests::read_mdlog_state_reads_valid_sidecar_and_computes_expires_at ... ok
test document_tests::resolve_local_asset_path_uses_anchor_directory ... ok
test widget_tests::read_mdlog_state_returns_none_when_heartbeat_expired_or_pid_dead ... ok
test document_tests::resolve_asset_to_data_url_returns_base64_for_local_image ... ok
test document_tests::resolve_local_asset_path_rejects_percent_encoded_traversal ... ok
test widget_tests::uuid_generation_entropy_and_format_check ... ok
test document_tests::resolve_local_asset_path_rejects_traversal ... ok
test document_tests::resolve_local_asset_path_rejects_absolute_outside_directory ... ok

test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src\main.rs (src-tauri\target\debug\deps\vellum-934219304313b152.exe)

running 4 tests
test tests::extracts_first_markdown_path_case_insensitively ... ok
test tests::ignores_non_markdown_arguments ... ok
test tests::should_rebind_matrix_evaluation ... ok
test tests::tauri_conf_csp_contains_frame_src_for_widget ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests vellum_lib

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### 2. `npm test`
```text
> vellum@1.4.0 test
> vitest run

 RUN  v4.1.9 C:/Users/17445/Desktop/Vellum

 Test Files  17 passed (17)
      Tests  175 passed (175)
   Start at  18:41:47
   Duration  5.78s (transform 2.04s, setup 3.11s, import 7.28s, tests 4.46s, environment 39.06s)
```

### 3. `cargo check --manifest-path src-tauri/Cargo.toml`
```text
Finished `dev` profile [unoptimized + debuginfo] target(s) in 19.25s
（编译完全无 warning，退出码 0）
```

### 4. `npm run build`
```text
> vellum@1.4.0 build
> tsc && vite build

vite v8.1.3 building client environment for production...
✓ 976 modules transformed.
rendering chunks...
computing gzip size...
✓ built in 2.31s
```
