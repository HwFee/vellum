# Task 5 审查报告 — Rust `save_document`（原子写 + EOL 保真 + 双闸门）

审查基线：`db001e0..8e83ca5`（diff 一次性读取）、简报 `task-5-brief.md`、裁定 `rulings.md`（F9b/F14/F25）、报告 `task-5-report.md`（视为未核实声明）。
只读审查：未修改任何文件；未重跑整套测试；仅跑一次聚焦用例 + 一次聚焦编译检查 + 只读 grep/read。

---

### Spec Compliance

- ✅ **接口契约逐字一致**：`src-tauri/src/main.rs:201-205`（`#[tauri::command] async fn save_document(path: String, content: String, state: State<'_, AppState>) -> Result<document::SaveOutcome, String>`）、`src-tauri/src/document.rs:20-25`（`SaveOutcome { path, bytes_written }` + `#[serde(rename_all = "camelCase")]` ⇒ 前端收到 `bytesWritten`）、`src-tauri/src/main.rs:462`（`invoke_handler` 注册在 `resolve_asset` 之后）。命令参数均为单词，无 snake/camel 转换风险。
- ✅ **四道闸门齐全，且全部先于写盘**：`main.rs:205`（canonicalize，闸门失败即 `Cannot open file:`）、`main.rs:230` → `document.rs:172-188`（闸门 ①`current == target`，闸门 ④`mdlog_active`）、`document.rs:199`（闸门 ②扩展名 `.md`/`.markdown`，大小写不敏感见 `document.rs:35-44`）、`document.rs:203`（闸门 ③`content.len() > MAX_FILE_SIZE_BYTES`，常量 `document.rs:6` 与 `load_markdown_file` 路径 `document.rs:67` **同一个常量实例**，非复写字面量）。写盘只在 `document.rs:221`，位于全部拒绝分支之后。
- ✅ **mdlog 闸门口径与 `read_mdlog_state` 完全同源**：`main.rs:216-226` 用 `SystemTime::now().duration_since(UNIX_EPOCH).as_millis() as u64`（`unwrap_or(0)`）—— 与 `src-tauri/src/widget.rs:335-338` 逐字相同；调用同一个纯函数 `widget::read_mdlog_state_from_path`（`widget.rs:265-290`）与同一个 `is_pid_alive_win32`（`widget.rs:210`），未自行重写存活判定。特别地，`save_document` **不**调用 `read_mdlog_state` 命令里的 `cleanup_stale_sidecar_if_dead`（`widget.rs:342-346`），因此不会对「非当前路径」产生删除副作用（方向安全）。
- ✅ **原子写**：同目录临时文件 `.{file_name}.vellum-tmp`（`document.rs:8`、`document.rs:219`）+ `fs::rename` 覆盖（`document.rs:227`）；`fs::write` 失败（`:221-224`）与 `rename` 失败（`:227-230`）各有 best-effort `remove_file` 清理。rename 在 Windows 上即 `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`，覆盖已存在目标是标准语义。
- ✅ **EOL 保真三条**：`document.rs:150-156`（`dominant_eol`：含 CRLF 即 CRLF）+ `document.rs:160-168`（`apply_eol`：先整体归一 LF 再套风格，因此 CRLF 输入不会变 `\r\r\n`）；被用例锁定：`document_tests.rs:226-235`（CRLF 文档 + 纯 LF 入参 ⇒ 磁盘 CRLF）、`:236-245`（LF 文档不被引入 CRLF）、`:246-255`（入参已是 CRLF 也不双写）。F9b「Rust 侧是唯一 CRLF 还原点」在 `document.rs:213` 兑现。
- ✅ **BOM 自然保留**：`document.rs:213` 只对 EOL 做替换，不改动其它字节，BOM 属内容随 payload 透传；用例 `document_tests.rs:257-265`（断言偏弱，见 Minor-3）。
- ✅ **不新增 Cargo 依赖 / 不改 `src/**` / 不改 `widget.rs`·`watcher.rs`**：diff 仅 3 个文件且全在 `src-tauri/src/`（`document.rs`/`document_tests.rs`/`main.rs`），`Cargo.toml` 未出现在 diff 中；用到的 `dunce`/`serde` 均为 `document.rs` 既有依赖。
- ✅ **F25（服务端兜底）落地**：闸门 ④ 在命令层生效，`check_save_gates` 的 mdlog 分支 `document.rs:183-185` 有真实 sidecar 用例（`document_tests.rs:325-350`）。
- ⚠️ **合理但未登记的偏差（我判定行为等价，不构成缺陷）**：报告 §3.1 已登记「闸门抽成纯函数 `document.rs:172-188`」与「mdlog 读取提前到闸门 ① 之前（`main.rs:223`）」。我复核：错误文案 `document.rs:178` / `:183` 与简报逐字一致；即便路径非当前文档也会先读一次 sidecar，属纯读、无副作用，且 `check_save_gates` 仍先判 current ⇒ 返回给前端的错误与简报一致。
- ⚠️ **无法仅凭 diff 验证**：(a) 真机上「目标文件被独占/只读」时 `rename` 的具体错误与前端 F24 回退观感；(b) 端到端 `invoke("save_document")`（本任务无集成测试，报告 §4.3 自认）；(c) BOM 最终是否被前端保留（T6 的切片/拼装决定，Rust 侧只保证不剥离不添加）；(d) `save → file-changed → 热重载` 对编辑会话的观感（见 Minor-6）。

### Strengths

- 闸门逻辑抽成无 Tauri 依赖的纯函数（`document.rs:172-188`），使两条安全判定第一次具备可测性，且**没有**为了可测而放松判定（判定本体与简报一致）。
- mdlog 闸门复用现成判定链而非另写一套（`main.rs:223-226` ↔ `widget.rs:265-290`），口径一致性由代码事实保证。
- 测试断言强度足够：不只 `is_ok/is_err`，还断言错误文案与磁盘内容（`document_tests.rs:267-276`、`:279-290`）、断言无临时残留（`:292-301`）；mdlog 用例先 `assert!` 前置条件再断言闸门（`:325-350`），不是恒绿用例。
- 我逐条比对了报告 §2.4 的变异红→绿声明与测试本体：例如 `document_tests.rs:303-313` 确实会在「闸门 1 放宽」时失败、`document_tests.rs:279-290` 确实会在「体积上限放宽」时失败 —— 断言与声明自洽（变异本身未由我复跑，因只读约束）。

### Issues

#### Critical (Must Fix)

无。绑定约束的四道闸门、原子写、EOL/BOM 保真、接口契约均由代码事实 + 我实际跑出的用例支撑，未发现可绕过的门禁或必现的数据损坏路径。

#### Important (Should Fix)

1. **读旧文件失败被静默降级为 LF（`document.rs:212`）** — `std::fs::read_to_string(&canonical).unwrap_or_default()` 把「读失败」与「空文件」混为一谈。触发面窄但真实：目标文件被另一进程以「拒绝读、允许删除共享」方式占用时，`read_to_string` 失败而 `rename`（需 DELETE 访问）成功 ⇒ CRLF 文档被**整篇**改写成 LF，且原子写已覆盖原文件、无备份、无日志，直接违反绑定约束「CRLF 文档不得被翻新」的意图。修：`map_err` 后返回错误（宁可让用户重试），或至少 `eprintln!` 保留痕迹；并加一条注释/用例说明「读不出旧内容时按 LF」是有意还是不得已。报告 §4.4 只论证了「非 UTF-8 不可达」，未覆盖瞬时 IO 失败这一支。
2. **并发调用共用同一临时路径（`document.rs:219-227`）** — `save_document`（`main.rs:202`）是 async 命令，Tauri 可并发轮询两次 invoke；两次调用都写 `.{name}.vellum-tmp`：各自 `File::create`+`write_all`（`:221`）可交错，最坏产出两份草稿混合的文件（原子 rename 保证的是「要么旧要么全量新」，此时「全量新」本身就是混合体）；后到者还可能因对方已 rename 而 `rename` 报 `Cannot replace document: ... (os error 2)` ⇒ **文件其实已被写入（对方内容）却向调用方返回 Err**，前端 F24 随即把内存 markdown 回退到旧内容，内存与磁盘分叉。复现步骤（真机 JS）：`await Promise.all([invoke("save_document",{path,content:bigA}), invoke("save_document",{path,content:bigB})])`，A/B 各 ~10MB。现状缓解：T6 的提交路径在 `await save` 之前同步 `closeActive()`（`src/hooks/useDocumentEditor.ts:98-110`），第二次 `commitActive` 命中 `if (!activeUnit) return`，故当前触发概率低 —— 但命令自身零保护，且修复成本极低（临时名加 pid+计数器/uuid，或在 `save_document` 内用一把 `Mutex` 串行化）。

#### Minor (Nice to Have)

3. **体积闸门按 content 判、CRLF 还原会让写入字节最多翻倍（`document.rs:203` vs `:213`）** — 旧文件含 CRLF、入参以 LF 为主的近上限内容（如 49MB 且新行极多）可写出 >50MB 文件，随后被 `load_markdown_file` 的 `check_file_size`（`document.rs:63-70`）拒绝加载 ⇒ 「写成功但打不开」。概率极低（需新行占比极高的大文档），且简报字面只要求「内容 ≤ 50MB」，故不阻断；建议对 `payload` 再校验一次（或显式登记接受该边界）。
4. **内容里孤立的 `\r` 被静默改写（`document.rs:161`）** — `apply_eol` 的 `.replace('\r', "\n")` 会把孤立的 CR 归一：LF 文档里 `\r → \n`，CRLF 文档里 `\r → \r\n`。不违反绑定约束（约束只谈 CRLF/LF 风格），但属「内容被静默改写且无测试/无注释」。混合 EOL 文档（含任意一处 CRLF）也会被整体收敛为 CRLF —— 代码注释（`document.rs:149-150`）已说明策略，建议补一条混合 EOL 用例与一条孤立 CR 用例把期望锁死。
5. **BOM 用例断言偏弱（`document_tests.rs:257-265`）** — 只断言 `starts_with('\u{FEFF}')`，双写 BOM 也会通过；入参与期望都是已知常量，改成 `assert_eq!(..., "\u{FEFF}改后\n")` 即可。
6. **`bytes_written` 与磁盘长度的不变量无人断言（`document_tests.rs:211-224`）** — 用例只在 payload == content 的 LF 路径比较 `"新内容\n".len()`。建议加 `assert_eq!(fs::metadata(&path).unwrap().len(), outcome.bytes_written as u64)`，最好落在 CRLF 用例（`:226-235`，那里 payload ≠ content 才是有效路径）。代码本身无误（`document.rs:235` 取 `payload.len()`，`:221` 写 `payload.as_bytes()`，构造上一致）。
7. **命令层接线零测试（`main.rs:211-232`）** — 「路径非当前文档拒绝」只在纯函数层被测（`document_tests.rs:303-323`），`main.rs` 的「取 `state.current` → 调闸门 → 才写盘」以及「拒绝时绝不触碰文件」没有用例（报告 §4.3 已自认）。属可接受缺口（Tauri `State` 难以构造），但应作为 **T8 真机手检项**登记：非当前文档路径 invoke 必须报错且文件不变。
8. **崩溃残留与持久性** — 若进程在 `document.rs:221` 与 `:227` 之间被杀，`.{name}.vellum-tmp` 永久留在用户目录（无启动清理；下次保存会 truncate 复用，影响小）。另：无 `fsync`，断电语义未保证（简报只要求 temp+rename，不阻断，仅登记）。
9. **交叉风险（T6）：保存必触发一次热重载** — 临时文件位于同目录、watcher 非递归监视该目录并按 target 匹配（`src-tauri/src/watcher.rs:68-75`、`:140-142`），rename 事件含目标路径 ⇒ 每次保存都会 `emit("file-changed")`（`watcher.rs:164-166`），App 会静默重载文档（`src/App.test.tsx:268`）。T6 必须保证「自己写入引发的重载」不打断编辑会话/滚动（T5 只需登记）。
10. **写盘方式的既有代价** — 每次保存整文件读一遍仅为嗅探 EOL（`document.rs:212`，50MB 文档多一次 50MB 分配）；rename 替换会一并替换文件的 ACL/属性/创建时间，并断开硬链接与备用数据流（Windows 语义）。均为登记项。
11. **闸门 ① 不是写权限边界（`main.rs:211-230`）** — 前端可先 `invoke("load_document", {path})` 任选一个 `.md`（`load_document` 不限路径，`main.rs:164-171`），再 `save_document` 覆盖它。这与需求字面（`path` 必须等于 `AppState.current`）一致，挡的是「误写未打开的文档」，但报告/设计文档不应把它描述为安全边界。

### Assessment

**Task quality:** Approved

**Reasoning:** 四道闸门（含与 `read_mdlog_state` 同口径的 mdlog 兜底）、同目录临时文件 + rename 原子写、CRLF/LF/BOM 保真与 `SaveOutcome` camelCase 契约全部按规格落地，我实跑 `cargo test --lib save_tests` 得 12 passed / 0 failed、`cargo check --bins` 编译通过，用例断言的是文件内容与错误文案而非恒绿占位；两条 Important（读旧文件失败静默降级 LF、并发共用同一临时名）是窄窗口的鲁棒性缺口而非绑定约束的字面违反，建议在本任务的修复轮一并处理（各一行改动），不阻断任务关口。

### Commands Run（真实输出摘要）

| 命令 | 输出摘要 |
|---|---|
| `cd src-tauri && cargo test --lib save_tests` | `running 12 tests` … 全部 `ok`；`test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s`（42 filtered out） |
| `cd src-tauri && cargo check --bins` | `Compiling vellum v1.5.0` / `Finished dev profile … in 8.17s`，`EXIT=0` —— 命令宏展开与 `invoke_handler` 注册在 bin 上下文编译通过 |
| 只读检查（read/grep） | `src-tauri/src/document.rs:1-251`；`src-tauri/src/main.rs:160-235,255-293,462`；`src-tauri/src/document_tests.rs:191-355`；`src-tauri/src/widget.rs:163-172,265-290,325-348`；`src-tauri/src/watcher.rs:12-19,68-75,130-174`；`src/hooks/useDocumentEditor.ts:60-120`；`grep -rn "file-changed" src/`（命中 `src/App.test.tsx:268` 等） |
| 未执行 | 整套 `cargo test`（按控制器指示不重跑）、`npm test`（前端零改动，diff 已证）、真机 rename 占用场景与 invoke 端到端 |
| 未复跑 | 报告 §2.4 的 5 条变异红→绿（需改实现后还原，违反只读约束；仅逐条核对断言与声明自洽） |
