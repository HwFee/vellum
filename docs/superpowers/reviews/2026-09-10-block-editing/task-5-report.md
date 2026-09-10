# Task 5 报告：Rust 侧 `save_document`（原子写 + EOL 保真 + 双闸门）

- 提交：`8e83ca5aa2423080f04dff682287db960174b0d6`（父提交 `db001e0`，master）
- 提交信息：`feat(edit): save_document 命令（原子写 + EOL/BOM 保真 + 当前文档与 mdlog 双闸门）`
- 提交范围：仅 3 个文件（`git show --stat HEAD` ⇒ `3 files changed, 305 insertions(+), 1 deletion(-)`），工作区里已有的 `.pi/agents/*`、`docs/superpowers/plans/*` 改动未被裹入提交

## 1. 改动文件清单

| 文件 | 改动 |
|---|---|
| `src-tauri/src/document.rs` | 新增 `SaveOutcome`（camelCase）、`dominant_eol`、`apply_eol`、`check_save_gates`、`save_markdown_file`、`SAVE_TEMP_SUFFIX`；`MAX_FILE_SIZE_BYTES` 由 `const` 改为 `pub(crate) const`（仅供同 crate 内测试引用上限，无外部可见性变化） |
| `src-tauri/src/document_tests.rs` | 追加 `mod save_tests`（12 个用例：写入/字节数、CRLF 保真、LF 不引 CRLF、CRLF 内容不双写、BOM 保真、非 Markdown 扩展名拒绝、超限拒绝、无临时残留、当前文档闸门 ×2、mdlog 存活闸门 ×1、双闸门放行） |
| `src-tauri/src/main.rs` | 新增 `#[tauri::command] async fn save_document(path, content, state)`；`invoke_handler!` 中 `resolve_asset,` 之后注册 `save_document,` |

未改：`src/**`（前端零改动，`git status --porcelain src/` 为空）、`widget.rs`、`watcher.rs`、`Cargo.toml`（无新依赖）。

## 2. 逐条红 → 绿证据

### 2.1 初始红（测试先写，函数不存在）

```bash
$ cd src-tauri && cargo test
error[E0432]: unresolved imports `crate::document::check_save_gates`, `crate::document::save_markdown_file`
   --> src\document_tests.rs:193:27
error[E0603]: constant `MAX_FILE_SIZE_BYTES` is private
error: could not compile `vellum` (lib test) due to 2 previous errors
```

### 2.2 首轮实现后的真红（发现的测试夹具缺陷，非实现缺陷）

第一次实现完成后跑 `cargo test`：`53 passed; 1 failed`，失败项 `gate_rejects_while_a_live_mdlog_sidecar_exists`，panic 在「前置条件：存活 sidecar 必须判定为记录中」。根因是我在测试里用 `serde_json::json!({"last_write_at": ...})` 写了 snake_case 键，而 `MdlogSidecarData` 是 `rename_all = "camelCase"`，反序列化失败 ⇒ `read_mdlog_state_from_path` 返回 `None`。**修夹具**（改为 `r#"{"pid": 4321, "lastWriteAt": 1000000, "heartbeatAt": 1000000}"#`，与 `widget_tests.rs` 既有写法一致），未改断言、未改实现。

### 2.3 全量绿（提交前最新一次运行）

```bash
$ cd src-tauri && cargo test        # lib(54) + bin(7) + doc(0)
test result: ok. 54 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

`document_tests.rs` 原 13 个顶层用例 + 新 12 个（`grep -c "    #\[test\]"` = 12）= HEAD 前 lib 42 个 → 现 54 个，原有用例全部保留且通过。

新用例清单（`cargo test --lib save_tests` 输出，`12 passed; 0 failed; 42 filtered out`）：

```
save_tests::writes_content_and_reports_size ... ok
save_tests::preserves_crlf_line_endings ... ok
save_tests::does_not_introduce_crlf_into_lf_files ... ok
save_tests::does_not_double_convert_crlf_content ... ok
save_tests::preserves_utf8_bom ... ok
save_tests::rejects_non_markdown_extension ... ok
save_tests::rejects_oversized_content_without_touching_the_file ... ok
save_tests::leaves_no_temp_file_behind ... ok
save_tests::gate_rejects_path_that_is_not_the_current_document ... ok
save_tests::gate_rejects_when_no_document_is_loaded ... ok
save_tests::gate_rejects_while_a_live_mdlog_sidecar_exists ... ok
save_tests::gate_allows_current_document_without_mdlog_record ... ok
```

### 2.4 逐断言红→绿（变异测试，证明测试真的在断言该行为）

为避免「测试恒绿」的假覆盖，逐条把实现的关键行临时改坏、跑测试确认对应用例变红，再还原。还原以 `diff` 核对（输出 `RESTORED-IDENTICAL`），备份放在仓库外（系统临时目录），仓库无残留，还原后全量测试再次全绿。

| # | 变异 | 命令 | 红输出（真实） |
|---|---|---|---|
| A | `dominant_eol` 的 `if existing.contains("\r\n")` → `if false` | `cargo test --lib save_tests` | `FAILED. 10 passed; 2 failed`；`preserves_crlf_line_endings`：`left: "甲\n乙\n"  right: "甲\r\n乙\r\n"`；`does_not_double_convert_crlf_content` 同因失败 |
| B | `check_save_gates` 的 `if mdlog_active` → `if false && mdlog_active` | 同上 | `FAILED. 11 passed; 1 failed`；`gate_rejects_while_a_live_mdlog_sidecar_exists`：`called Result::unwrap_err() on an Ok value: ()` |
| C | 闸门 1 的 `Some(expected) if expected == target` → `Some(_expected)` | 同上 | `FAILED. 11 passed; 1 failed`；`gate_rejects_path_that_is_not_the_current_document`：`called Result::unwrap_err() on an Ok value: ()` |
| D | 体积上限判定 `> MAX_FILE_SIZE_BYTES` → `> MAX_FILE_SIZE_BYTES * 2` | 同上 | `FAILED. 11 passed; 1 failed`；`rejects_oversized_content_without_touching_the_file`：`called Result::unwrap_err() on an Ok value: SaveOutcome { path: "...\\vellum_save_oversize\\h.md", bytes_written: 52428801 }` |
| E | 扩展名判定 `if !is_markdown_extension(..)` → `if false && !is_markdown_extension(..)` | 同上 | `FAILED. 11 passed; 1 failed`；`rejects_non_markdown_extension`：`called Result::unwrap_err() on an Ok value: SaveOutcome { path: "...\\vellum_save_ext\\e.txt", bytes_written: 2 }` |

B 覆盖控制器裁定 **F25**（mdlog 存活 ⇒ 服务端拒绝写入），A 覆盖 **F9b/F14**（Rust 侧是唯一 CRLF 还原点）。B 的用例是整条判定链的真实证据：临时目录内写真实 `l.md.mdlog` sidecar（camelCase JSON、心跳未超时）→ 用与 `read_mdlog_state` 命令相同的 `read_mdlog_state_from_path` 求出 `mdlog_active == true`（用例内 `assert!` 前置条件）→ `check_save_gates` 必须 `Err("mdlog 记录中：断开连接后才能修改")`。

### 2.5 其他验证命令

```bash
$ cd src-tauri && cargo build
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 15.69s      # 二进制（非 test cfg）编译通过，命令宏展开无误

$ npx tsc --noEmit
TSC-EXIT=0

$ npm test
 Test Files  31 passed (31)
      Tests  373 passed (373)      # 前端未误改
```

## 3. 与 spec / 简报 / 裁定的偏差

1. **闸门逻辑抽成纯函数 `document::check_save_gates(current, target, mdlog_active)`**（简报把两段闸门内联在命令体里）。
   - 原因：控制器要求 §5 提供「路径非当前文档拒绝」「mdlog 存活拒绝」的测试证据，而内联在 `#[tauri::command]` 体里的判定无法构造 `tauri::State` 来单测（Tauri 运行时依赖）。抽出后可在 `document_tests.rs` 用现成 `TestDir` 做真实 sidecar 的端到端判定。
   - 行为等价：命令体的检查顺序与报错文案与简报逐字一致（闸门 1 `Only the currently loaded document can be saved`、闸门 2 `mdlog 记录中：断开连接后才能修改`）；唯一差别是 `read_mdlog_state_from_path` 在闸门 1 之前调用（多一次 sidecar 读，错误返回不变）。
   - 命令签名、`SaveOutcome { path, bytes_written }`（camelCase）、`save_markdown_file` 的公开性均与简报接口契约逐字一致。
2. **多加了 1 个 EOL 用例**：`does_not_double_convert_crlf_content`（文档本身 CRLF、入参也含 CRLF ⇒ 不得写出 `\r\r\n`）。它覆盖 `apply_eol` 的归一分支，是该分支唯一的测试入口；变异 A 证明它确实在断言该行为。
3. **`save_markdown_file` 的两个失败分支各加一行防御性 best-effort 清理**（写临时文件失败 ⇒ 删掉半截临时文件；rename 失败 ⇒ 删临时文件，后者与简报一致）。对应控制器要求 §5「失败路径无临时文件残留」。**未覆盖**：这两条清理分支无法在无 OS 级故障注入的前提下稳定复现（写失败需磁盘满/只读目录，rename 失败需目标被独占），已在 §4 登记。测试实际覆盖的「无残留」路径是：超限提前返回（不创建临时文件）与成功路径（临时文件被 rename 消费）⇒ `leaves_no_temp_file_behind` / `rejects_oversized_content_without_touching_the_file`。
4. **`MAX_FILE_SIZE_BYTES` 改为 `pub(crate)`**：让同 crate 的测试引用真实上限而不是复写字面量 50MB。无 crate 外可见性变化（lib 无 `pub use` 该常量）。
5. **BOM 保真无专门实现**：BOM 由前端把整篇 markdown 原样交回（`\u{FEFF}` 属于内容），Rust 侧只做 EOL 归一 + 原子写，天然透传；用例断言的正是这条透传路径（PASS）。简报提到的「BOM 保真」因此是「不引入额外剥离/添加」的守住型约束，未新增代码。

未偏离：不新增依赖、不改前端 / `widget.rs` / `watcher.rs`、测试目录一律走 `TestDir`（系统临时目录，Drop 清理；跑完 `ls $TEMP | grep vellum_save` 为空）、单次提交。

## 4. 未解决项 / 关注点

1. **两条防御性清理分支无单测**（见 §3.3）：需要 OS 级故障注入才能复现，登记为已知缺口；行为上「最坏情况也只是多一个 `.xxx.md.vellum-tmp` 残留」，不影响原文件。
2. **临时文件名与目标文件同目录**：`.{文件名}.vellum-tmp`。Windows 下 `fs::rename`（`MOVEFILE_REPLACE_EXISTING`）可覆盖已存在的目标；若目标文件被其他进程以「禁止删除共享」方式独占，rename 会失败并返回 `Cannot replace document: ...`（此时原文件保持旧内容，前端会走 F24 的回退分支）。**真机上未被验证**（也无法在 CI 里稳定复现），建议 T8 手检项包含「编辑器占用/只读文件下提交 ⇒ 报错且原文不坏」。
3. **`save_document` 的端到端（通过 Tauri invoke 的真实调用）本轮未验**：本轮只有命令体以外的纯函数级测试 + `cargo build` 证明宏展开与注册无误；真正的 invoke 走通要看 T6 接线后的真机/集成验证。
4. **非 UTF-8 旧文件**：`read_to_string` 失败时按 LF 处理（`unwrap_or_default`），即可能把非 UTF-8 旧文件的换行统一为 LF —— 但该文件本来就无法被 `load_document` 加载（`load_markdown_file` 会报 `Cannot read UTF-8 Markdown`），因此这条路径实际不可达；保留为防御性降级。
5. **jsdom / 前端契约**：`invoke("save_document", { path, content })` 的入参名与返回 `SaveOutcome` 已按简报冻结，T6 接线时不得再要求 Rust 侧改名（若要改名需回到本任务改命令签名）。
