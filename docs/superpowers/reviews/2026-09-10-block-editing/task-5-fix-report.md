# Task 5 修复轮 1/5 — 报告

- 任务：Rust `save_document`（Task 5）审查后修复（Important-1 → F28、Important-2 → F29）
- 基线：`8e83ca5`（T5 原始实现）→ 本轮提交位于当前 master 顶端
- **提交 hash：`b700a86a31f86c9ed8bf0ff63a601250db92ef42`**（`fix(edit): 拒绝静默降级 LF 与临时文件名唯一（审查轮 1）`，单次提交）
- 提交内容：`src-tauri/src/document.rs`（+18/-7）、`src-tauri/src/document_tests.rs`（+38/-1）
- 未触碰：前端任何文件、`main.rs`、`widget.rs`、`watcher.rs`、`Cargo.toml`（`uuid = { version = "1", features = ["v4"] }` 为既有依赖，直接使用）

---

## Important-1 → 裁定 F28：读旧文件失败不得静默降级为 LF

**审查缺陷**：`document.rs` 原第 212 行 `std::fs::read_to_string(&canonical).unwrap_or_default()` 把「读失败」与「空文件」混为一谈。目标文件被另一进程以「拒绝读、允许删除共享」占用时，读失败而 `rename`（只需 DELETE 访问）可能成功 ⇒ CRLF 文档被整篇改写成 LF，且原子写已覆盖原文件、无备份无日志。

**修法**（`src-tauri/src/document.rs`）：

```rust
// 读不出旧内容时**拒绝保存**，不得降级为 LF：把「读失败」与「空文件」混为一谈，
// 一次保存就把 CRLF 文档整篇翻新（且 rename 只需 DELETE 权限，读失败时仍可能成功）。
let existing = std::fs::read_to_string(&canonical)
    .map_err(|error| format!("Cannot read existing document: {error}"))?;
```

- 方向按裁定取「宁可拒绝保存，也不静默翻新换行符」，错误经 `String` 直接回传前端（前端 T4 已有 F24 回退路径，会保留草稿让用户重试）。
- 「为何不降级」写成上面两行注释（一行结论 + 一行理由）。

**不可读文件的构造方式（真实而非伪造）**：Windows 上「独占锁定、允许删除、拒绝读」需要 `CreateFileW`，其 API 位于 `windows-sys` 的 `Win32_Storage_FileSystem` feature，本仓库未启用，而任务明令不得新增 Cargo 依赖/feature。因此改测**真机上该分支唯一可达的构造**：文档加载后文件被外部进程改写为非 UTF-8 字节 ⇒ `read_to_string` 失败（InvalidData），而 `rename` 只需 DELETE 权限仍可能成功。这不是替代性「测辅助函数」，而是对 `save_markdown_file` **被测函数本身**的行为断言。

**红→绿证据**：

红（仅加入 F28 用例，实现保持原样）：

```
$ cd src-tauri && cargo test --lib save_tests
test document_tests::save_tests::rejects_save_when_existing_content_cannot_be_read ... FAILED
---- document_tests::save_tests::rejects_save_when_existing_content_cannot_be_read stdout ----
thread 'document_tests::save_tests::rejects_save_when_existing_content_cannot_be_read' panicked at src\document_tests.rs:312:59:
called `Result::unwrap_err()` on an `Ok` value: SaveOutcome { path: "C:\\Users\\17445\\AppData\\Local\\Temp\\vellum_save_unreadable\\n.md", bytes_written: 10 }
test result: FAILED. 12 passed; 1 failed; 0 ignored; 0 measured; 42 filtered out
```

→ 旧实现的失败形态被如实捕获：读失败被当作空文件，返回 `Ok` 并把不可读的文件覆盖成 LF payload（`bytes_written: 10` = `"新内容\n"`）。

绿（改实现后，同一条用例）：

```
test document_tests::save_tests::rejects_save_when_existing_content_cannot_be_read ... ok
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 42 filtered out
```

用例断言三条，非恒绿：错误文案含 `Cannot read existing document`、磁盘字节**逐字节等于**改写后的非 UTF-8 原字节（`fs::read` 而非 `read_to_string`，避免断言本身抛错）、目录无 `*vellum-tmp*` 残留。

---

## Important-2 → 裁定 F29：临时文件名必须唯一

**审查缺陷**：固定 `.{name}.vellum-tmp`。`save_document` 是 async 命令，Tauri 可并发轮询两次 invoke ⇒ 两次调用交错写同一临时文件（产出两份草稿混合的「全量新」文件），或后到者 rename 报 `os error 2`（文件其实已被对方写入）而返回 Err，前端 F24 随即回退内存 ⇒ 内存与磁盘分叉。

**修法**（`src-tauri/src/document.rs`）：抽出纯函数，临时名带 uuid v4 前 8 位短后缀：

```rust
/// 纯函数：同目录临时文件路径（`.<name>.<uuid 前 8 位>.vellum-tmp`）。
/// 唯一后缀是必需的：`save_document` 是 async 命令，Tauri 可并发轮询两次 invoke，
/// 固定临时名会让两次保存交错写同一文件（产出混合内容），或让后到者 rename 时找不到源文件。
pub(crate) fn save_temp_path(canonical: &Path) -> Result<PathBuf, String> {
    let file_name = canonical.file_name().and_then(|name| name.to_str())
        .ok_or_else(|| "Cannot resolve file name".to_string())?;
    let unique = uuid::Uuid::new_v4().simple().to_string();
    Ok(canonical.with_file_name(format!(".{file_name}.{}{SAVE_TEMP_SUFFIX}", &unique[..8])))
}
```

`save_markdown_file` 改为 `let temp_path = save_temp_path(&canonical)?;`；写临时文件失败与 rename 失败两处 best-effort `remove_file(&temp_path)` 清理逻辑**未改**（仍是各自专属路径，不再可能误删别路的临时文件）。仍与目标同目录 ⇒ rename 仍为同卷原子替换。

**红→绿证据**（两段）：

红-1（编译红，缺失契约）：

```
$ cd src-tauri && cargo test --lib save_tests
error[E0432]: unresolved import `crate::document::save_temp_path`
   --> src\document_tests.rs:193:65
error: could not compile `vellum` (lib test) due to 1 previous error
```

红-2（断言红：把 `save_temp_path` 临时变异回固定名以证明用例真的能抓住这个缺陷）：

```
$ cargo test --lib save_tests      # 仅把 save_temp_path 改回 ".<name>.vellum-tmp"
test document_tests::save_tests::temp_path_is_unique_per_call_and_stays_next_to_the_target ... FAILED
thread '...' panicked at src\document_tests.rs:333:13:
临时路径重复（并发保存会互踩）: .u.md.vellum-tmp
test result: FAILED. 13 passed; 1 failed; 0 ignored; 0 measured; 42 filtered out
```

（变异已立即还原：`cp /tmp/doc_backup.rs src-tauri/src/document.rs`；最终提交的实现含唯一后缀。）

绿：

```
test document_tests::save_tests::temp_path_is_unique_per_call_and_stays_next_to_the_target ... ok
test document_tests::save_tests::leaves_no_temp_file_behind ... ok
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 42 filtered out
```

用例内容：同一 canonical 连续取 256 次临时路径，逐条断言 ① 与目标同父目录、② 不等于目标本身、③ 形如 `.u.md.<8hex>.vellum-tmp`、④ 256 条路径两两互不重复（`HashSet::insert` 失败即报「临时路径重复（并发保存会互踩）」）。「写完目录里不残留任何 `*vellum-tmp*`」由既有 `leaves_no_temp_file_behind` + `temp_leftovers()`（`contains("vellum-tmp")`，对新的 `*.{hex}.vellum-tmp` 同样命中）继续锁定，并在本轮 F28 用例中追加一次同款无残留断言。

---

## 完整验证（真实输出）

| 命令 | 输出摘要 |
|---|---|
| `cd src-tauri && cargo test` | `test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`（lib，42→含新增 2 条 save 用例，共 14 条；原有 12 条全绿）／`Running unittests src\main.rs` → `test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`／`Doc-tests vellum_lib: 0 passed`。无 `error`。 |
| `npx tsc --noEmit` | 无输出，`TSC_EXIT=0` |
| `npm test` | `Test Files  31 passed (31)` / `Tests  384 passed (384)` / `Duration 8.53s` |
| `cd src-tauri && cargo fmt --check` | 仅剩 1 处 diff，**为既有存量**（`document_tests.rs` 的 `mdlog_active` 块，`git show HEAD:...` 用 rustfmt 校验同样报 1 处 diff；非本轮引入）。本轮新增的 import 行已按 rustfmt 折行，本轮新增代码零 fmt 噪音。 |

锁定的结构性约束未受影响：四道闸门、原子写、`SaveOutcome` camelCase 契约、EOL/BOM 保真用例全部保持绿；`CodeBlock.tsx`/`MarkdownDocument.tsx`/widget 三条性能红线本轮未触碰任何前端或 widget 文件。

## 与计划/规格的偏差

1. **测试手段**：F28 未用「不可读文件」工厂（Windows 需新增 `windows-sys` feature，违反「不新增 Cargo 依赖」），改用「加载后被外部改写为非 UTF-8」这一真机可达构造，断言直接作用于 `save_markdown_file` 本身（非降级为纯辅助函数测试）。已在上面写明理由与实际断言强度。
2. **新增一个 `pub(crate) fn save_temp_path`**：为让「临时路径唯一」成为可单测的契约。此前该逻辑内联在 `save_markdown_file` 中、唯一性在任何事后断言里都不可观测（临时文件已被 rename 掉）。这是本任务允许的「辅助函数化」，不改变 `save_markdown_file` 对外签名与调用方。
3. **收尾额外跑了 `cargo fmt --check`**（任务只要求 `cargo test` / `npm test` / `tsc`），用于确认未引入格式噪音。

## 未解决项（登记，不属本轮范围）

1. **F29 残余概率**：短后缀仅取 uuid v4 前 8 位（32 bit），理论碰撞概率约 2.3e-10/对；裁定 F29 明确接受「概率降低但仍非零，由 rename 原子性兑底」。若未来要求严格无碰撞，可改用 12–16 位或 `NamedTempFile`（需新增 crate，本轮禁止）。
2. **并发路径无命令层集成测试**：`main.rs` 的 `save_document`（Tauri `State`）仍无测试脚手架，本轮唯一性只在 `save_temp_path` 层用「256 次互异 + 变异红」锁定，未构造两次真实并发 invoke。与审查 Minor-7 / 报告 §4.3 同源，登记为 T8 真机手检项。
3. **崩溃残留**：进程若在 `fs::write` 与 `fs::rename` 之间被杀，会留下 `.<name>.<8hex>.vellum-tmp`。唯一后缀使残留文件名不再可被下次保存复用（原先固定名会被下次保存 truncate 覆盖），残留概率与数量略升；仍无启动清理（审查 Minor-8 原文）。
4. **审查 Minor-3～Minor-11 全部未处理**（体积闸门按 content 判而 CRLF 还原可致写入字节最多翻倍、孤立 `\r` 静默归一、BOM 断言偏弱、`bytes_written` 与磁盘长度不变量未断言、命令层零测试、无 `fsync`、保存必触发一次热重载、rename 替换 ACL/ADS、闸门 ① 非安全边界等）——均为审查者判定的 Nice to Have，本轮严格按 F28/F29 两项范围执行，未扩大（YAGNI）。
5. **保存后的热重载观感**（审查 Minor-9，T6 交叉风险）不属本任务，未复核。
