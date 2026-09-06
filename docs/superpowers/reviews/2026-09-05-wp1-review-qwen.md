# WP1 代码审核报告（reviewer-qwen）

**审核日期**：2026-09-05　**审核者**：reviewer-qwen　**模式**：只读审核（唯一写入 = 本报告）

结论：**通过**

无阻断项。3 项「应当修复」（W1 状态变更非原子、W2 新增文件未过 rustfmt、W3 原生进程存活检查缺正例覆盖）+ 9 项「建议」。三项均可在 WP2 开工前的单个小 commit 内消化，不影响 WP1 结项与包边界推进；安全模型（spec §7.1）与协议契约（spec §4.3/§4.4）逐条落实，无绕过路径。

---

## 0. 审核范围与方法

- 审核对象：`git diff 4a32de0..HEAD`（5 commit：`8c760fe` / `1f4aff6` / `9e77538` / `d950658` / `14acbd3`；11 文件，+948 −60，全部位于 `src-tauri/`）。前端零改动（`git diff --name-only` 无 `src/**`）。
- 对照依据：spec `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md` §4.3 / §4.4 / §7.1 / §9.1 / §9.2；plan Task 1.1–1.5（plan:38–1537）与 Global Constraints（plan:15–31）；实施日志 `outputs/mdlog/wp1-impl-log.md`（仅作对照，不作证据）。
- 手段：全量静态逐行阅读 + 逐输入推演（`extract_widget_id` 的 8 种 URI 形态、双路防抖的进队/到期时序、Win32 句柄的所有出口路径）+ 亲自执行 `cargo test`、`cargo test -- --test-threads=1`（复跑验稳定性）、`npm test`、`cargo clippy --all-targets`、`cargo fmt --check`、`diff <(旧 HEAD 单实例段) <(新 HEAD 单实例段)`。
- 未做的事（诚实边界）：未做运行时/Release 验证（iframe 实际渲染、WebView2 `ICoreWebView2_22` 拦截、CSP 是否真的阻断 fetch）——这属 spec §9.3 人工清单，见 §4。

---

## 1. 逐要点核查（证据：文件:行号）

### 1.1 协议安全：`vellum-widget` handler —— ✅ 通过

**（a）路径提取只接受单段 id。** `src-tauri/src/widget.rs:103-118` `extract_widget_id`，逐输入推演：

| 请求 URI（handler 视角） | 推演 | 结果 |
|---|---|---|
| `http://vellum-widget.localhost/<uuid>` | authority 截断 → `/​<uuid>` → trim → 无 `/` | 命中 id ✓ |
| `vellum-widget://localhost/<uuid>` | 同上（`find("://")` 取首个） | 命中 id ✓ |
| `http://vellum-widget.localhost/a/b/c`（多段） | `widget.rs:114` `trimmed.contains('/')` → `None` | 404 ✓ |
| `http://vellum-widget.localhost/`（仅根） | `widget.rs:113-115` `trimmed.is_empty()` → `None` | 404 ✓ |
| `http://vellum-widget.localhost`（无路径） | `widget.rs:107` `after_scheme.find('/')?` → `None` | 404 ✓ |
| `http://vellum-widget.localhost/../../Windows/win.ini` | 含 `/` → `None` | 404 ✓ |
| `http://vellum-widget.localhost/%2e%2e%2f%2e%2e%2fwindows` | 单段但**不解码**，仅当 HashMap 键使用 | 键不匹配 → 404 ✓ |
| `http://vellum-widget.evil/xxx`（wry 前缀匹配误入） | 截出 `xxx`，注册表必然无此 128-bit 随机键 | 404 ✓ |

关键结构性质：`id` **只作为内存 HashMap 的键**（`widget.rs:150`），从不参与任何文件系统路径拼接，因此「遍历/越界」在本协议面上不存在落点；`should_rebind` 用的路径来自 `AppState.current`，与该输入无关。这点是本次安全审核最关心的面，实现与 spec §4.3「handler 截取末尾路径段作为 id」+「未知请求一律 404」一致。

**（b）200 与 404 都带 4 条安全头。** `widget.rs:121-133` `apply_security_headers` 是唯一注头入口，三条 return 路径全部经过它：非 GET（`widget.rs:140-142`）、200（`widget.rs:151`）、404（`widget.rs:154`）。头值与 spec §4.3 逐字一致：
- `Content-Type: text/html; charset=utf-8`（`header::CONTENT_TYPE`）
- `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`
- `X-Content-Type-Options: nosniff`
- `Cache-Control: no-store`（`header::CACHE_CONTROL`）

结构性保证优于测试保证：不存在「某分支漏挂头」的代码路径（builder 只有这一条封装）。200 分支的 4 头有测试锁死（`widget_tests.rs:57-91`，逐头断言 + body 断言）；404 分支只断言了 2/4 头 → 见 **S3**。

**（c）非 GET 方法。** `widget.rs:139-142`：`method != "GET"` 直接 404（不查表、不 `get`、不动 LRU 顺序）→ 与 spec §4.3「仅接受 GET 请求」一致。HEAD 也落到该分支返回 404；iframe 导航只发 GET，无功能影响。

**（d）registry 未命中行为。** `widget.rs:148-155`：`maybe_id.and_then(|id| registry.get(id))` → `None` 即 404，body 固定 `Not Found`（不含任何反射，`text/html` + `nosniff` + `default-src 'none'`，无反射型 XSS 面）。空注册表（未 `manage` 之外的正常态）同样一律 404。

**（e）残余风险确认（不判违规）**：widget 文档与 404 文档同为 `http://vellum-widget.localhost` 源，且 CSP 允许 `script-src 'unsafe-inline'`。跨 widget 互读需 `fetch`，被 `default-src 'none'`（覆盖 connect-src）阻断；iframe `sandbox` 无 `allow-same-origin`（spec §7.1，属 WP2）另成一层。id 为 UUIDv4（`widget.rs:267`），`widget_tests.rs:159-171` 以 1000 次生成断言格式（v4 版本位、variant nibble）与无碰撞。判定：spec §7.1/§7.2 已明确记录并接受该残余风险，实现未额外扩大攻击面。

### 1.2 注册表：64 条 LRU（get 提鲜）+ 512KB 上限 + 清空守卫 —— ✅ 通过（含 S2、S6）

- **常量**：`widget.rs:10-12`（512*1024 / 64 / 120_000）与 spec §4.3、plan:27 硬数值逐一对齐。
- **LRU 正确性（代码推演，非仅信测试）**：`insert`（`widget.rs:23-40`）与 `get`（`widget.rs:42-49`）、`remove`（`widget.rs:55-60`）、`clear`（`widget.rs:62-65`）四mutator 均同步维护 `entries`/`order` 两个容器，故不变量 `entries.len() == order.len()` 且 `order` 无重复恒成立；在此不变量下：
  - 已满 64 + **新** id → 走 `else if` 分支 `pop_front` + `entries.remove` → 容量锁死 64 ✓；
  - 已满 64 + **已存在** id → 走第一分支（从 order 中摘旧位），**不**进入淘汰分支 → 不误杀任何条目 ✓（这是 LRU 实现最常见的错误点，此处正确）；
  - `pop_front` 弹出的 id 必在 `entries` 中（不变量），故淘汰不会留下孤儿 HTML → **无内存滞留** ✓；
  - `get` 提鲜（移到队尾）使淘汰序按「最近访问」而非「最近插入」→ 真 LRU，满足 spec §4.3「按 LRU 顺序淘汰」+ S1 要求。
  - `peek`（`widget.rs:51-53`）只读不动序，正是 `widget_tests.rs:22-48` 能区分「提鲜生效」的前提。
- **512KB 门禁**：`widget.rs:24`（registry 内）+ `widget.rs:264`（命令层前置）。用 `String::len()`（**字节数**）而非字符数——对 UTF-8 中文正文比 spec 字面的「字符长度上限」更严，方向安全；前后端（spec §8「pre 渲染器预检」）双层拦截，超限时命令返回 `Err(字符串)`，符合 spec §4.3「直接拒绝注册并返回错误」。
- **路径切换清空守卫的生产接线（本轮重点核查项）**：确实接入生产路径，非「测试里有、代码里没有」。
  - 谓词：`main.rs:252-257` `should_rebind(current, next, has_watcher)`：`None → true`；`Some(cur) → cur != next || !has_watcher`。
  - 调用点：`main.rs:179-189`（`load_document` 内，先算 `needs_rebind`）→ `main.rs:191-217`（仅 `true` 时执行 `registry.clear()`（`main.rs:199`）+ drop/rebuild watcher + 写 `current`）。
  - 语义结果：**同文档热重载（`reloadCurrent` → 同一 canonical 路径 + watcher 存活）不 rebind → 不清注册表、不 drop watcher**，满足 spec §4.3「热重载绝不清空」与 §4.7 G1（不杀 `sidecar_deadline`、不产生目录句柄震荡）；`widget.rs` 内**没有**任何 `clear()` 调用，清空职责单一归属 `load_document` ✓。
  - 与 spec 的唯一差异：额外把「同路径但 watcher 丢失」也判为需 rebind（会清空注册表）。这是 S7 异常自愈，plan:1400-1404 明文要求，且该态下本来就没有 watcher，属可接受的窄例外。→ 记录为已授权偏差，不判违规。
  - `canonical` 来源为 `dunce::canonicalize`（`document.rs:64-65`），`main.rs:176` 直接取 `doc.path`，故 `state.current` 与比较基准同为磁盘真实大小写的绝对路径，与 spec §4.3「canonical 绝对路径」一致。
- **Mutex 中毒处理**：见 **S2**（策略不一致，属健壮性而非正确性）。

### 1.3 进程存活判定 —— ✅ 通过（含 W3）

**`judge_mdlog_alive`（`widget.rs:160-169`）**：`!pid_alive(pid) → false`；否则 `now.saturating_sub(heartbeat_at) <= 120_000`。与 spec §4.3 判据「pid 存活 **AND** now-heartbeatAt ≤120s」逐字一致；纯函数 + `&dyn Fn(u32)->bool` 注入，满足 spec §9.2「抽离纯函数，注入 pid_alive 函数指针测试」。矩阵覆盖见 `widget_tests.rs:137-157`（活+心跳正常→true / 活+心跳超时 120_001→false / 死+心跳正常→false / 死+超时→false），边界 120_000 vs 120_001 有真实区分度（非恒真）。
- `saturating_sub` 的副作用：系统时钟被向前/向后大幅调整时，回拨会让 `now < heartbeatAt` → saturating 得 0 → 判活。此为 spec 公式的字面实现后果，见 **S7**。

**`is_pid_alive_win32`（`widget.rs:176-209`）句柄生命周期审计**：
- `pid == 0` 早返回（`widget.rs:184-186`），不触碰 API ✓。
- 唯一获取句柄处 = `OpenProcess`（`widget.rs:189`）。成功分支内：`GetExitCodeProcess`（`widget.rs:193`）→ **`CloseHandle(handle)`（`widget.rs:194`）先于两个 `return`（`widget.rs:195-199`）执行** → 「`success != 0`」与「`success == 0`」两条出口均已释放 ✓。
- `handle.is_null()` 为真时不进入释放分支（无句柄可泄）✓。`GetLastError`（`widget.rs:201`）在无句柄分支读取，语义正确（Rust 侧无 intervening API 调用污染 last error——`is_null()` 为纯 Rust 判空，不调用 Win32）✓。
- 分支语义：`ACCESS_DENIED || SHARING_VIOLATION → true`（降级为「仅心跳判定」，因 `judge_mdlog_alive` 的 AND 结构，返回 true 后由心跳决定 → 与 spec §4.3「若仍失败，降级为仅依据心跳时间判定（防止权限降权导致误判为死）」一致）；其他错误码（含 `ERROR_INVALID_PARAMETER`/`ERROR_FILE_NOT_FOUND`）→ `false`（A1：不存在即死）✓。`GetExitCodeProcess` 返回 0 时保守 `true`（降级心跳）✓。
- `STILL_ACTIVE`：`exit_code == STILL_ACTIVE as u32`（`widget.rs:196`）——运行中判活正确；固有假阳性（真实退出码恰为 259 的已退进程、以及 pid 复用）为 Win32 语义天花板，spec 未要求处理，判为已接受。
- **与 spec 字面的一处不可字面实现差异（不判违规，建议记录）**：spec §4.3 写「若 `OpenProcess` **失败**，调用 `GetExitCodeProcess` 二次复核」——无句柄无法调用该 API。实现把它移到「成功」分支做二次复核（`widget.rs:189-199`），失败分支直接按错误码降级，这是该句的唯一合理解读，且 plan:965-995 已按此固化。判定：意图落实 ✓。
- `#[cfg(not(windows))]` 桩恒返回 `true`（`widget.rs:211-214`）：plan 原文即如此；与 plan:17「不得引入 macOS/Linux 分支逻辑」有形式张力，但本项目仅 Windows 出包、该桩不参与实际判定，不判违规（仅记录）。

**`read_mdlog_state_from_path`（`widget.rs:231-256`）**：`current_path?` → `sidecar_path_for` → `is_file()` 否则 None → `read_to_string` 失败静默 None → `serde_json` 解析失败 None → `judge_mdlog_alive` 否则 None → `expires_at = heartbeat_at + 120_000`（`saturating_add`）✓ 与 spec §4.3 返回契约一致；**不删除磁盘文件**（无 `remove_file` 调用）✓ 符合 spec §3.7「残留 sidecar 由后端存活仲裁，不主动清理」。`MdlogSidecarData`（`widget.rs:76-93`）字段与 spec §3.7 的 camelCase JSON 一一对应，`pid`/`lastWriteAt`/`heartbeatAt` 必填、其余 `#[serde(default)]`，未知字段被 serde 默认忽略 → 对扩展侧未来加字段是宽容的（正确方向）。

**`read_mdlog_state` 命令（`widget.rs:296-312`）**：**零前端入参**，锚点唯一来源 `AppState.current`（`widget.rs:297-302` 克隆后立刻释放锁，避免持锁做 I/O ✓）→ 满足 spec §7.1「禁止前端自由传递路径参数，防范任意文件探测」。`now` 用 `SystemTime` 毫秒（`widget.rs:304-307`），与扩展侧 `Date.now()` 同基准 ✓。

### 1.4 watcher 双路防抖 —— ✅ 通过

**「互不顶槽」的代码级证明（不只看测试）**：顶槽的前提是「两路共用一个 deadline 槽位」。本实现里两路是**两个独立字段**：`DoubleDebounceTracker.log_deadline` / `sidecar_deadline`（`watcher.rs:35-36`），且：
- 进队：`handle_event_paths`（`watcher.rs:53-60`）两个 `if` 互不 `else`，一次事件同时命中两个路径也能双双刷新；
- 等待：`compute_timeout`（`watcher.rs:63-88`）对四态组合取**较早者**（`ld.min(sd)`），已过期则 `Duration::ZERO`（不返回负值 panic）；
- 出队：`poll_expired`（`watcher.rs:92-113`）逐路独立判 `<= now`、**只清自己那一路的槽**、返回 `DebounceEmits` 双 bool（`watcher.rs:22-26`）；
- 事件循环（`watcher.rs:130-155`）把两个 bool 分别 `emit("file-changed")` / `emit("mdlog-state-changed")`，无 `else`、无合并、无「一个触发就重置另一个」。
→ 结构上不存在互相顶替的可能路径。逐拍推演（t=0 收到 sidecar 事件，t=150 收到 log 事件）：t=0 后 `sd=400`、`ld=None` → timeout=400；t=150 被 `recv_timeout` 提前唤醒 → `ld=550`；`poll_expired(150)` 两路均未到期 → 无 emit；下一轮 `compute_timeout(150)` = min(400,550)-150 = **250**（log 事件**没有**推迟 sidecar 的 400ms 到期）→ t=400 超时唤醒 → 只发 `mdlog-state-changed`，`ld` 原样保留 550 → t=550 发 `file-changed`。两路 400ms 静默期各自独立成立 ✓。
- 一个边界：`Ok(Err(_)) => continue`（`watcher.rs:143`）跳过本轮 `poll_expired`。已核：`continue` 回到循环顶重新 `compute_timeout`，过期槽返回 `ZERO`，`recv_timeout(0)` 立即返回 `Timeout` → 下一拍即补发，**最多延后一拍，不丢事件** ✓（可留注释说明，见 S5 附带）。
- 事件名逐字为 `file-changed` / `mdlog-state-changed`（`watcher.rs:150,153`），与 spec §4.7、WP3 前端监听约定一致 ✓。
- sidecar 被删除（扩展 `session_shutdown` / `/mdlog off`）时目录事件命中 `sidecar_target` → 触发 `mdlog-state-changed` → 前端复查读到文件不存在 → `Ok(None)` → 徽章隐藏，符合 spec §8 表第 3/4 行的期望链路 ✓。
- 线程回收：`mpsc::Sender` 随 `RecommendedWatcher` drop 而断开 → `recv_timeout` 返回 `Disconnected` → `break`（`watcher.rs:145`）→ 无僵尸线程；同文档热重载不重建 watcher（§1.2）故无重复线程 ✓。

**`sidecar_path_for`（`watcher.rs:12-19`）Windows 扩展名语义**：`file_name() + OsString::push(".mdlog")` → `session.md` ⇒ `session.md.mdlog`、`README.MARKDOWN` ⇒ `README.MARKDOWN.mdlog`（`watcher_tests.rs:7-16` 两例锁死），与 spec §3.7「路径：`<对话>.md.mdlog`（同目录同基名）」**逐字一致**；不替换原扩展名（正确——若用 `set_extension("mdlog")` 就错了，此处没犯）。大小写语义：仅追加后缀、不改写基名，与 `dunce::canonicalize` 的真实大小写路径同源；`read_mdlog_state` 侧与 watcher 侧共用同一函数（`widget.rs:235` 调 `watcher::sidecar_path_for`）→ 两条管线不可能算出不同 sidecar 名，**无锚点分裂** ✓。残留：`PathBuf` 相等比较在 Windows 上区分大小写，见 **S5**。

### 1.5 main.rs 集成 —— ✅ 通过（含 S1）

- **单实例 WM_COPYDATA 逐字保留（实测验证）**：`git diff 4a32de0..HEAD -- src-tauri/src/main.rs` 只含 6 个 hunk（导入块、`AppState` 删除 + `load_document`、`mod tests` 追加、Builder 插入 `register_uri_scheme_protocol`、`.manage`、`invoke_handler`）。另做机械核验：取两版本 `#[cfg(windows)]` 起前 150 行做 `diff` → **输出为空**（`early_single_instance` 全模块逐字未动）。`PendingOpenPaths`（`main.rs:146-158`）、`drain_pending_open_paths`（`main.rs:161-166`）、`first_markdown_from_args`（`main.rs:241-248`）、`first_markdown_arg`、`resolve_asset`（`main.rs:220-236`，锚点仍 `AppState.current` 的 parent，未动）、`setup` 兜底显示窗口、既有 2 个 main 测试 → 全部零改动 ✓（`use notify::RecommendedWatcher;` 因 `AppState` 迁出而删除，属必要清理）。
- **协议闭包取 state 方式**：`main.rs:329` `ctx.app_handle().state::<WidgetState>()` —— 与 spec §4.3「协议 handler 经 `ctx.app_handle().state::<WidgetState>()` 访问」逐字一致，非 `static`/`thread_local` 变通；`.manage(WidgetState::default())`（`main.rs:357`）确在 `.run()` 前完成托管（编译与 closure 生命周期为证，`Context::app_handle()` 返回 `&AppHandle`，无临时值借用问题）。`register_uri_scheme_protocol`（`main.rs:328`）插在 `.plugin(tauri_plugin_single_instance::...)`（`main.rs:338`）之前——该调用不属 plugin 链，三个 `.plugin(...)` 相对顺序未变，「单实例插件必须最先注册（在插件中）」的约束未被破坏 ✓。
- **CSP 其余部分逐字未动**：`git diff` 显示 `tauri.conf.json` 仅 1 行变更，`security.csp` 追加 `; frame-src http://vellum-widget.localhost`，`default-src`/`script-src`/`style-src`/`img-src`/`font-src` 五段字符串未改一字 ✓；与 spec §4.4 期望串**整串相等**，并被 `main.rs:263-276` 的 `assert_eq!(csp, expected_csp)` 永久锁死（任何后续改动 CSP 都会红）。
- **capabilities**：`src-tauri/capabilities/default.json` 未改动（diff 无该文件）✓ 符合 spec §4.4「无需新增权限配置」（Tauri 2 的自定义命令不走 ACL 门禁，仅插件命令需要）。
- **命令注册**：`register_widget` / `unregister_widget` / `read_mdlog_state` 已入 `generate_handler!`（`main.rs:359-365`），命令名与返回契约与 plan:1072-1075 一致：`register_widget → {id,url}`、`unregister_widget → ()`、`read_mdlog_state → {lastWriteAt,heartbeatAt,expiresAt} | null`（serde `rename_all="camelCase"`，`widget.rs:69-72`、`widget.rs:221-227`）✓ 跨包契约可被 WP2/WP3 直接消费。
- **偏差 1 处（已申报）**：导入块多带 6 个 tauri 宏生成物符号 → 见 **S1**。
- 一处**真实健壮性缺陷**（非偏差，plan 原样照抄所致）：`load_document` 判定与写入非原子 → 见 **W1**。

### 1.6 测试真实性与 TDD 痕迹 —— ✅ 通过

新增 22 个用例（`git show <c> | grep -cE '^\+\s*#\[test\]'` 逐 commit 实测：**2 / 5 / 7 / 6 / 2**，合计 22，与 impl log 叙述一致）：

| 用例 | 位置 | 断言的是真行为？ |
|---|---|---|
| `app_state_implements_send_and_sync` | `state_tests.rs:6-8` | 是（`assert_send_sync::<AppState>()` 编译期即门禁，`RecommendedWatcher` 不 Send 就红）|
| `app_state_initializes_empty_and_allows_interior_mutability` | `state_tests.rs:10-30` | 是（默认 None + 写读往返）|
| `derives_correct_sidecar_path` | `watcher_tests.rs:7-16` | 是（含 `.MARKDOWN` 不改扩展名）|
| `log_event_does_not_affect_sidecar_deadline` | `watcher_tests.rs:18-29` | 是（一槽 Some、另一槽必须 None）|
| `sidecar_event_does_not_affect_log_deadline` | `watcher_tests.rs:31-42` | 是（反向对称）|
| `independent_deadlines_take_minimum_timeout` | `watcher_tests.rs:44-63` | 是（300ms 精确值，能捕获「取 max / 共槽」）|
| `poll_expired_emits_each_event_independently` | `watcher_tests.rs:65-98` | 是（400ms 只出 file_changed、600ms 只出 mdlog_state_changed，并断言槽位清理态）|
| `registry_rejects_html_exceeding_512kb` | `widget_tests.rs:10-22` | 是（含错误文案 + `len()==0` 副作用门禁）|
| `registry_evicts_lru_entry_when_exceeding_64_entries` | `widget_tests.rs:24-48` | 是（**get 提鲜后淘汰的是 widget-1 而非 widget-0**，正是能区分 FIFO/LRU 的关键断言）|
| `register_result_serializes_to_camel_case` | `widget_tests.rs:50-59` | 是（JSON 字面串）|
| `build_widget_response_returns_200_with_all_4_security_headers` | `widget_tests.rs:61-91` | 是（4 头逐值 + body）|
| `build_widget_response_returns_404_..._for_unknown_or_invalid` | `widget_tests.rs:93-135` | 是，但**404 只断言 2/4 头** → S3 |
| `judge_mdlog_alive_matrix_and_pid_fallback_evaluation` | `widget_tests.rs:137-157` | 是（4 象限 + 120_001 边界 + Win32 负例）|
| `uuid_generation_entropy_and_format_check` | `widget_tests.rs:159-171` | 是（1000 次、v4 版本位/variant nibble/HashSet 无碰撞）|
| `read_mdlog_state_returns_none_when_current_doc_is_none` | `widget_tests.rs:173-177` | 是（锚点缺失即 None，安全侧）|
| `..._when_sidecar_file_does_not_exist` | `widget_tests.rs:179-184` | 是 |
| `..._for_corrupted_json` | `widget_tests.rs:186-196` | 是（含真实临时文件 + 清理）|
| `..._reads_valid_sidecar_and_computes_expires_at` | `widget_tests.rs:198-227` | 是（整结构体相等，含 `expires_at=180_000`）|
| `..._returns_none_when_heartbeat_expired_or_pid_dead` | `widget_tests.rs:229-253` | 是（双路径，120_001 边界）|
| `widget_state_registers_and_unregisters` | `widget_tests.rs:255-268` | 是（`WidgetState(Mutex<..>)` 往返；即 37-vs-36 多出的那条，见 1.7）|
| `should_rebind_matrix_evaluation` | `main.rs:278-290` | 是（5 态全覆盖，含「同路径 + watcher 在 → 必须不 rebind」这条负向断言，正是防热重载误清空的核心）|
| `tauri_conf_csp_contains_frame_src_for_widget` | `main.rs:262-276` | 是（整串相等，锁死 CSP）|

无恒真断言、无 `assert!(true)`、无「只调用不判断言」的装饰用例。临时文件类用例均有 `fs::remove_file` 清理；实测跑完 `%TEMP%` 无残留（已 `ls` 核验）；`--test-threads=1` 复跑同绿，用例间无共享态竞争（各用例用不同基名）。

**TDD 痕迹**：5 个 commit 的测试与实现严格同 commit（`git show --stat` 逐个核验：`1f4aff6` 含 `watcher.rs`+`watcher_tests.rs`；`9e77538` 含 `widget.rs`+`widget_tests.rs`+`Cargo.toml/lock`；`d950658` 含 `widget.rs`+`widget_tests.rs`；`14acbd3` 含 `main.rs`(测试+集成)+`tauri.conf.json`）；每 commit 的文件集恰为该 Task 声明的改动文件，无夹带（plan:25 工作树纪律）✓。commit 内先后顺序无法事后复核（squash 到单 commit 是 plan Step 5 的规定动作），impl log 申报的 Step 2 失败均为 `E0432 unresolved import`，与「新符号未实现」自洽，无反证。

**唯一测试覆盖缺口（W3）**：`is_pid_alive_win32` 只有负例（`u32::MAX`，`widget_tests.rs:152-156`），**没有「必然为 true 的正例」**。而该函数是徽章唯一的真值来源：若 `PROCESS_QUERY_LIMITED_INFORMATION` 常量、`OpenProcess` 第三参或 `STILL_ACTIVE` 比较任一处写错，全部 37 个用例仍绿（`judge_mdlog_alive` 走的是注入函数），徽章会永久不显示且静默无报错。这是本包最值钱的 5 分钟补测。

### 1.7 「实测 37 vs 计划 36」的核查 —— 多出的 1 个用例 = `widget_state_registers_and_unregisters`，合理，非实现越界

- 用例数分解：基线 15（`document_tests` 13 + main 2）+ 新增 22 = **37**（lib 33 + main 4），实测输出见 §3。
- 计划为什么写 36：plan:79 与 plan:1524 写「后端 36（lib 32 = 13 + state 2 + watcher 5 + **widget 12**）」；但 plan 在 **Task 1.4 Step 1（plan:1167-1180）自己明文给出了 `widget_state_registers_and_unregisters` 的完整测试代码**，即 Task 1.4 实为 6 个用例（5 个 `read_mdlog_state_*` + 这 1 个），Task 1.3 为 7 个 → widget 合计 **13**，plan 的 Step 4 期望串（plan:1322「32 passed」）与全局基线句同源自一处算术少计 1。
- 结论：**多出的 1 个用例是 plan 自身规定的代码，实现按 plan 逐字落地**（实现代码与 plan:1268-1280 的 6 个用例文本一致），既非越界加测也非重复计数；该用例断言 `WidgetState` 的 Mutex 内部可变往返（insert/get/remove/len），真实、不冗余、不掩盖行为。
- 偏差申报是否诚实：impl log 在 Task 1.4「偏差说明与裁决」中如实写了「计划写 32，实际 33，用例数完全吻合且全部通过」，方向正确但**未点明根因是 plan 少计**，且「最终测试状态」小节直接写 37 而未对账 plan:79 的 36 → 主 Agent 若按 plan 数值做验收会误判为「实现者超范围」。→ 记 **S8**（文档层，建议 plan 勘误为 37 / lib 33，而非回退实现）。

### 1.8 spec §9.1 基线保持 —— ✅ 通过

- 原 15 个后端用例名称与断言**一个未删、一个未改**（对照 `cargo test` 列表与 `4a32de0` 的 `document_tests.rs` / main `mod tests`）；`AppState` 迁移未削弱任何断言。
- 前端基线 17 文件 / 175 用例全绿（本包未碰前端）✓。

### 1.9 规约符合（AGENTS.md / DESIGN.md）—— ✅ 通过

- 性能结构约束与死规则：`CodeBlock.tsx` / `MarkdownDocument.tsx` / `components useMemo` / `search-match--current` / katex 管线位置 / 侧栏布局 / `scrollMemory` 结构 —— 全未被触碰（diff 无 `src/**`），无任何「顺手改前端」越界 ✓。
- watcher 相关：AGENTS.md 未约束事件名，spec §4.7 约束已逐字落实（见 1.4）。
- DESIGN.md（色板/字重/圆角/无 emoji）：本包无 UI 产出，色板/字重/圆角三项 **N/A**；「无 emoji」实测：对 10 个受影响文件做 U+1F000–1FAFF / U+2600–27BF / U+2B00–2BFF / U+FE0F 扫描 → **0 命中** ✓（中文注释不属 emoji 且为项目既有风格）。
- 依赖增量：`uuid` **早已在依赖图中**（`Cargo.lock` 仅 +1 行，把 `uuid` 挂到 `vellum` 的 deps；`Cargo.lock:4201` 的 `uuid 1.23.4` 条目为既有），即**零新增传递依赖** ✓ 与 AGENTS.md/bundle-size 规约无冲突。

---

## 2. 问题清单

### 阻断
无。

### 应当修复

**W1 · `src-tauri/src/main.rs:179-217` —— `load_document` 的「判定 → 清注册表 → 换 watcher → 写 current」跨 4 段临界区非原子（TOCTOU），可致后端锚点与 watcher/前端三者错配**
判定段（`main.rs:179-189`）在取得 `current`、`watcher` 两把锁后于 `should_rebind` 求值完毕即**全部释放**，真正的写入发生在 `main.rs:191-217`，且 `current` 的写入（`main.rs:212-216`）是第三次独立加锁。`load_document` 是 `async fn`（`main.rs:169`），Tauri 2 把 async 命令放到线程池并行执行，故两次不同路径的调用可任意交错；前端确有并发入口：`src/App.tsx:118`（`loadPath`，来自 `drain_pending_open_paths` / `handleOpen`）与 `src/App.tsx:135`（`reloadCurrent`，来自 `file-changed`）互不串行（`App.tsx:174-187` 只对 drain 做了链式串行）。
可达交错：A(读 path1) 求值得 `needs=true` → B(读 path2) 求值亦 `needs=true`（A 尚未写 current）→ B 建 watcher2 并写 `current=path2` → A 建 watcher1（**把 watcher2 顶掉 drop**）→ 最终 `current=path1` 而 watcher 监听 path2（或反向，取决于最后写者）。
后果不是崩溃而是**静默错配**：可见文档的热重载永久失效（watcher 在盯另一篇）、`read_mdlog_state` 与 `resolve_asset` 双双错锚（徽章把上一篇文档的存活状态显示在当前文档上、相对图片从另一目录解析），直到用户手动切文档才自愈。窗口极窄（两段之间无 I/O），但 spec §4.7/§4.3 的全部价值都建立在「`state.current` 与真实可见文档严格同步」这一不变量上，mdlog 场景又把 `file-changed`→`load_document` 的频率放大若干倍，值得封死。
建议修法（任一）：①在同一作用域内**同时持有** `current` 与 `watcher` 两把锁完成清空/重建/写入（锁序统一 current→watcher，`read_mdlog_state`/`resolve_asset` 只取 current，无死锁环）；②加一条 `Mutex<()>` 串行化 `load_document` 的状态变更段；③让前端把 `requestId` 传给命令，Rust 侧只接受「最大 requestId」的写入（顺带修掉「前端显示 B 而 Rust current=A」这一**基线既有**的错配）。
（此段代码与 plan:1420-1467 逐字相同 → 属 plan 遗留缺陷，不是实现者写歪；修的时候请同步勘误 plan。）

**W2 · `state.rs:1-3`、`state_tests.rs:1-2`、`watcher_tests.rs:14`、`widget.rs:1-8`、`widget.rs:279-282`、`widget_tests.rs:1-6/82-85/258-262`、`main.rs:9-16/165-168/264-266` —— 新增/改动代码未通过 `cargo fmt --check`（13 处）**
实测 `cd src-tauri && cargo fmt --check` → 退出码 1，13 个 Diff，**全部落在本包新增或改动的 6 个文件内**（`document.rs`/`association.rs` 等基线文件 0 命中 → 基线本是 fmt-clean 的，是本包打破了仓库既有格式化基线）。类别：`use` 分组/排序（`crate::*` 应排在 `std::*` 前）、超 100 列单行（`main.rs:13-14`、`widget_tests.rs`）、可折叠签名（`widget.rs:281`）、多余空行（`main.rs:166`，删 `AppState` 后遗留双空行）。
理由：AGENTS.md 未写「必须 rustfmt」，但一个基线 fmt-clean 的 Rust crate 在提交里留下未格式化代码，会让后续任何真格式化 commit 的 diff 噪声污染 review（正是本审核被要求「逐字保留」核查时最忌讳的东西）。`cargo fmt` 一条命令即可，成本近零。附带修掉即可同时消掉 `main.rs:166` 的双空行。

**W3 · `src-tauri/src/widget.rs:176-209` —— `is_pid_alive_win32` 缺「存活进程必为 true」的正例覆盖（安全关键判定的唯一真值来源无测试）**
现有覆盖只有一条负例（`widget_tests.rs:152-156`，`u32::MAX → false`）。`judge_mdlog_alive` 与 `read_mdlog_state_from_path` 的全部测试都走**注入的** `pid_alive` 闭包，因此真实 Win32 路径的「返回 true」分支（`widget.rs:196` 的 `exit_code == STILL_ACTIVE as u32`、`widget.rs:189` 的 `PROCESS_QUERY_LIMITED_INFORMATION` 与 `bInheritHandle=0` 实参）在 37 个用例中**从未被执行并断言过真值**。任一处写错（例如误写 `!= STILL_ACTIVE`、误传 `PROCESS_TERMINATE` 权限），全部测试仍绿、Release 下表现为「记录中徽章永远不出现」的静默功能失效，而这正是 spec §4.7 的核心用户反馈。
建议补一条（约 4 行，Windows-only `#[cfg(windows)]`，无需 mock）：`assert!(is_pid_alive_win32(std::process::id()))`，可再加 `assert!(is_pid_alive_win32(4))` 之类系统进程的负例/正例对照需谨慎（会随环境漂移），故只加自身 pid 这一条稳定断言即可。
（plan:709-741 的测试矩阵只要求注入函数指针版，spec §9.2 同——即该缺口是 plan/spec 层面的覆盖遗漏，需同步在 §9.2 追加一行要求。）

### 建议

**S1 · `src-tauri/src/main.rs:11-16` —— 导入 6 个 tauri 代码生成物内部符号（`__cmd__*`、`__tauri_command_name_*`），耦合宏实现细节**
plan:1397-1399 只要求导入 5 个公开符号。impl log Task 1.5「偏差说明」的理由是「完全杜绝未使用导入编译器警告」，该理由不成立：不导入这些符号即可，不存在未使用告警。风险是 tauri 2 小版本改动宏生成物命名（这些符号从来不是公共 API 契约）就直接编译失败。优先尝试 `generate_handler![vellum_lib::widget::register_widget, ...]`（Tauri 2 的 `generate_handler!` 按**完整路径**拼接 `__cmd__` 兄弟符号，通常因此无需手动导入；若本版本不接受全路径，则保留现状并在导入块上方加一行注释标注「耦合 tauri 宏生成物名，升级 tauri 时优先复核此处」并同步 plan 勘误——两种处理都比现在沉默好）。

**S2 · `main.rs:196-199` / `widget.rs:269-272` / `widget.rs:287-290` vs `main.rs:330` —— Mutex 中毒策略不一致，且命令侧的「毒」会让切换文档永久失败**
协议闭包用 `unwrap_or_else(|p| p.into_inner())` 自愈（`main.rs:330`，合理：`WidgetRegistry` 只含两个集合，即便不一致最坏是多/少一条 404，且紧接着的 `clear()` 就能归零），但 `load_document` 与两个注册命令一律 `map_err → Err(String)` → 一旦中毒，`load_document` 每次返回 Err，前端进入 `App.tsx:126` 的 error 态、**永久无法再切换文档**（协议侧反而还能正常出图，形成「有图无交互、点不开新文档」的怪态）。建议统一为 `into_inner()` 恢复（或抽一个 `fn registry_of(&WidgetState) -> MutexGuard<'_, WidgetRegistry>` helper 收敛策略），并在注释里写明「为何内存表可安全 into_inner」。这不是可达 bug（当前无持锁 panic），而是一致性与最坏情况体验。

**S3 · `src-tauri/src/widget_tests.rs:93-135` —— 404/非 GET 分支只断言了 4 条安全头中的 2 条**
spec §7.1「错误响应（404/403）强制注入**相同** CSP 与 Content-Type」被断言了 CSP 与 Content-Type，`nosniff` 与 `no-store` 未断言；非 GET 与多段路径两个子例只断言 status。当前代码结构（共用 `apply_security_headers`）保证了它们存在，但测试无法防住未来有人「为 404 单独造一个 builder」而只挂 2 条头。建议抽 `fn assert_all_security_headers(&Response<Vec<u8>>)` 并在 200 / 未知 id 404 / 非 GET 404 / 多段路径 404 四处各调一次（顺带把「非 GET 与多段路径也带全 4 头」变成显式契约）。

**S4 · 缺 `extract_widget_id` 的边界锁定用例**（`widget.rs:103-118` 为私有，故通过 `build_widget_response` 断言）：至少补三条 404 —— `http://vellum-widget.localhost`（无路径）、`http://vellum-widget.localhost/`（仅根）、`http://vellum-widget.localhost/%2e%2e%2f%2e%2e%2fWindows`（编码遍历）。我的推演认为当前实现全部返回 404（见 1.1 表），但它们**未被测试锁死**，重构时极易被「顺手放宽」。

**S5 · `src-tauri/src/watcher.rs:54,58` —— Windows 路径比较区分大小写，sidecar 事件存在静默丢失面**
`p == &self.target` 用 `PathBuf: PartialEq`（Windows 上大小写敏感、且不解析 8.3 短名/ Junction）。target 来自 `dunce::canonicalize`（磁盘真实大小写），notify 上报的也是磁盘真实大小写名 → 常规情况一致。但 sidecar 由扩展进程 `writeFile('<log>.md.mdlog')` 创建，若磁盘上先存在一个**大小写不同**的历史 sidecar（如日志文件曾被重命名改大小写），Windows 会复用旧名，notify 上报旧名 → 与 `sidecar_target` 不相等 → `sidecar_deadline` 永不刷新 → 徽章不更新（且无任何报错）。这是 target 侧**基线既有**模式在新一路上的放大。建议：Windows 下比较前统一 `to_ascii_lowercase()`（或引入 `Path::eq_ignore_case` 小助手），并让 `derive_correct_sidecar_path` 旁边多一条大小写用例。

**S6 · spec §9.2「路径切换时清空注册表 vs 同路径热重载保留注册表」目前只有谓词级覆盖**
`main.rs:278-290` 测的是 `should_rebind` 真值表，`registry.clear()` 的实际调用（`main.rs:199`）无测试（需 Tauri 运行时，`load_document` 不可直接调用）。plan 本身就是这样设计的（plan:1406-1413），故不判违规；但按 spec §9.2 的字面要求，这属于「效果级」覆盖缺失。建议把 rebind 动作抽成纯函数 `fn apply_rebind(registry: &mut WidgetRegistry, current: &mut Option<PathBuf>, next: &Path) -> bool`（或对 registry 段做等价抽离），对「清空前 len>0 → 清空后 len==0」与「同路径调用 → len 不变」两条直接断言。这条同时是 W1 的天然修复载体。

**S7 · `widget.rs:160-169` 判据顺序与时钟语义**（微）：①`pid_alive` 在前，心跳在后 → 心跳已超时（徽章复查/`read_mdlog_state` 的常见退出态）时白做一次 `OpenProcess`；调换两条件结果等价（AND 可交换）但能省一次 syscall，对 spec §6 的「热重载高频」取向更友好。②`saturating_sub`（`widget.rs:168`）使「系统时钟回拨」时 `now < heartbeatAt` 恒判活（最坏 = 一个陈旧 sidecar 在下次心跳之前都显示「记录中」）。可考虑 `heartbeat_at <= now && now - heartbeat_at <= 120_000` 或改用 `connectedAt` 做合理性下限。二者均非 spec 偏差，属加固。

**S8 · `outputs/mdlog/wp1-impl-log.md:63-65 / :10` —— 37-vs-36 差异的根因记录不完整**
见 1.7：应明写「plan:79/1322 的 widget 12 / 32 passed 系 plan 少计 1 个用例（该用例为 plan:1167 自己列出），实现按 plan 代码落地为 13 / 33；建议 plan 勘误为 lib 33、总 37」，并把这条同时列入「变更文件清单/验证结果摘要」的对账栏，避免主 Agent 按 plan 数值验收时误判实现者越界加测。

**S9 · 工作树纪律（非本包代码问题）**：仓库根存在未跟踪的一次性脚本 `temp-clean.js`（改 plan 文档里的 emoji 文案用，2026-09-05 17:19），以及未跟踪的 `outputs/`、`.pi/skills/`、`.pi/tasks/`、`docs/superpowers/reviews/*gemini*.md`。5 个 WP1 commit 自身文件集完全干净（见 1.6），但 plan:25 要求「提交前 `git status --porcelain` 只含本 Task 文件」——`temp-clean.js` 属应删产物，建议清理或纳入 `.gitignore`（`outputs/` 若为约定留痕目录则显式 ignore，别让后续 review 反复确认）。

---

## 3. 测试实测输出

### 3.1 `cd src-tauri && cargo test`（本审核亲跑，非引用 impl log）

```
Finished `test` profile [unoptimized + debuginfo] target(s) in 0.49s
     Running unittests src\lib.rs (target\debug\deps\vellum_lib-dbaf9a1ac8449447.exe)

running 33 tests
test document_tests::resolve_asset_to_data_url_keeps_data_urls_unchanged ... ok
test document_tests::resolve_asset_to_data_url_keeps_remote_urls_unchanged ... ok
test document_tests::resolve_asset_to_data_url_returns_base64_for_local_image ... ok
test document_tests::resolve_local_asset_path_keeps_remote_urls_unchanged ... ok
test document_tests::resolve_local_asset_path_rejects_absolute_outside_directory ... ok
test document_tests::resolve_local_asset_path_rejects_percent_encoded_traversal ... ok
test document_tests::resolve_local_asset_path_rejects_traversal ... ok
test document_tests::resolve_local_asset_path_uses_anchor_directory ... ok
test document_tests::load_markdown_file_rejects_missing_file ... ok
test document_tests::load_markdown_file_rejects_non_utf8_content ... ok
test document_tests::load_markdown_file_rejects_non_markdown_files ... ok
test document_tests::load_markdown_file_accepts_uppercase_extension ... ok
test document_tests::load_markdown_file_reads_utf8_content ... ok
test state_tests::app_state_implements_send_and_sync ... ok
test state_tests::app_state_initializes_empty_and_allows_interior_mutability ... ok
test watcher_tests::derives_correct_sidecar_path ... ok
test watcher_tests::independent_deadlines_take_minimum_timeout ... ok
test watcher_tests::log_event_does_not_affect_sidecar_deadline ... ok
test watcher_tests::poll_expired_emits_each_event_independently ... ok
test watcher_tests::sidecar_event_does_not_affect_log_deadline ... ok
test widget_tests::build_widget_response_returns_200_with_all_4_security_headers ... ok
test widget_tests::build_widget_response_returns_404_with_all_4_security_headers_for_unknown_or_invalid ... ok
test widget_tests::judge_mdlog_alive_matrix_and_pid_fallback_evaluation ... ok
test widget_tests::read_mdlog_state_returns_none_when_current_doc_is_none ... ok
test widget_tests::read_mdlog_state_returns_none_when_sidecar_file_does_not_exist ... ok
test widget_tests::read_mdlog_state_returns_none_for_corrupted_json ... ok
test widget_tests::read_mdlog_state_reads_valid_sidecar_and_computes_expires_at ... ok
test widget_tests::read_mdlog_state_returns_none_when_heartbeat_expired_or_pid_dead ... ok
test widget_tests::registry_evicts_lru_entry_when_exceeding_64_entries ... ok
test widget_tests::registry_rejects_html_exceeding_512kb ... ok
test widget_tests::register_result_serializes_to_camel_case ... ok
test widget_tests::uuid_generation_entropy_and_format_check ... ok
test widget_tests::widget_state_registers_and_unregisters ... ok

test result: ok. 33 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running unittests src\main.rs (target\debug\deps\vellum-934219304313b152.exe)

running 4 tests
test tests::extracts_first_markdown_path_case_insensitively ... ok
test tests::ignores_non_markdown_arguments ... ok
test tests::should_rebind_matrix_evaluation ... ok
test tests::tauri_conf_csp_contains_frame_src_for_widget ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests vellum_lib
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

EXIT=0
```
合计 **37 passed / 0 failed**（lib 33 + main 4）。稳定性：`cargo test -- --test-threads=1` 复跑同为 `33 passed` / `4 passed` / 0 failed；跑完 `%TEMP%` 无测试残留文件（已 `ls` 核验，用例自带 `remove_file` 清理）。基线 15 条（document 13 + main 2）全部原样在册，无删除/无 skip。

### 3.2 `npm test`（根目录）

```
> vellum@1.4.0 test
> vitest run

 RUN  v4.1.9 C:/Users/17445/Desktop/Vellum

 Test Files  17 passed (17)
      Tests  175 passed (175)
   Start at  18:44:31
   Duration  4.65s (transform 2.53s, setup 3.25s, import 7.04s, tests 4.18s, environment 26.18s)
```
前端基线 17 文件 / 175 用例全绿，符合 spec §9.1 与 plan:1525（本包未触前端）。

### 3.3 `cargo clippy --all-targets`

3 条告警，无 error：
1. `src/watcher_tests.rs:24` `clippy::cloned_ref_to_slice_refs`（**新增**，plan 原样代码带来）。
2. `src/main.rs:260` `clippy::items_after_test_module`（**基线既有**：`mod tests` 在 `fn main` 前，本包只是往既有 `mod tests` 里加了 2 个用例，未新增此形态）。
3. `src/main.rs:124` `clippy::unnecessary_cast`（**基线既有**，`early_single_instance` 内，本包逐字未动）。
→ 只有第 1 条属本包，随 W2 的 `cargo fmt` 一并处理即可（该写法可保留，改为 `std::slice::from_ref(&target)` 消警）。

### 3.4 `cargo fmt --check`

退出码 **1**，13 处 Diff，全在本包新增/改动的 6 个文件内（`state.rs` / `state_tests.rs` / `watcher_tests.rs` / `widget.rs` / `widget_tests.rs` / `main.rs`）→ **W2**。

---

## 4. 遗留未验证事项（交主 Agent / WP5）

1. **协议在真实 WebView2 下的行为**（spec §9.3）：handler 收到的 `request.uri()` 究竟是哪一形态（`http://vellum-widget.localhost/<id>` 还是 `vellum-widget://localhost/<id>`）——实现对两种都兼容，但「iframe 真的能拿到 200 且中文不乱码」必须 Release 实测（dev 的 CSP 由 Vite 提供、`tauri.conf.json` 的 CSP 不注入，spec §9.3 已自述）。
2. **Tauri/wry 是否会给自定义协议响应附加额外头**（尤其 CORS/`Access-Control-*`）。建议把「从另一 widget 内 `fetch('http://vellum-widget.localhost/<另一个 id>')` 必须失败」加进 spec §9.3 清单（预期因 `default-src 'none'` 而被阻断，但值得一次实测）。
3. **逐个 commit 的独立可编译性**：仅验证了 HEAD 全绿；未回退编译各中间 commit（只读审核，未动工作树）。`8c760fe`…`d950658` 四个 commit 不触 main.rs 集成（`register_widget` 等命令在 `14acbd3` 前未被引用），从 diff 结构判断各自可编译，但非实测断言。
4. **WP2/WP3 消费面**：`register_widget` 的 64 条后端上限远大于前端存活 10 的约束（plan:27），且前端设计上会在卸载/休眠时 `unregister_widget`（plan:2516、2562）→ 后端淘汰在正常链路中不可达；请 WP2 审核时确认「休眠后再激活必定重新 register」这条链路存在，否则一次后端 LRU 淘汰会表现为休眠占位块复活后的空白 404。

---

### 复核结论对照表（本审核 vs 审核清单）

| 清单项 | 判定 |
|---|---|
| 1 规格符合（spec §4.3/§4.4/§7.1/§9.2；plan Task 1.1–1.5） | 通过（偏差 2 处均已在 impl log 申报或 plan 内授权：`should_rebind` 的 watcher-丢失分支、`__cmd__` 符号导入；另 1 处 spec 字面不可实现项见 1.3） |
| 2 规约符合（AGENTS.md 性能死规则 / DESIGN.md 设计语言） | 通过（前端零改动；无 emoji；色板字重圆角 N/A；`uuid` 零新增传递依赖） |
| 3 安全模型（spec §7 逐条 + 找绕过） | 通过（单段 id + 精确 map 键匹配 + 4 头全覆盖 + 无路径拼接 + 无前端可控入参 + 128-bit id；未找到绕过路径；加固建议 S3/S4） |
| 4 测试（亲自跑两套 + 新增逻辑是否有对应测试） | 通过（37 / 175 全绿，复跑稳定；缺口 1 项 = W3，覆盖强度建议 = S3/S4/S6） |
| 5 代码质量（边界/错误处理/竞态/泄漏） | 通过（句柄无泄漏、线程可回收、LRU 不变量成立；1 项竞态 = W1；1 项策略不一致 = S2） |
