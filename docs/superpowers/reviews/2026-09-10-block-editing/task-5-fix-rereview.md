# Task 5 修复轮 1 — 限定范围重审

范围：仅判定上一轮 2 条 Important（F28 / F29）是否修复 + 修复 diff（`review-3f0b74a..b700a86.diff`，`git show --stat b700a86` 确认仅 `src-tauri/src/document.rs`(25) + `src-tauri/src/document_tests.rs`(39)）是否引入新破坏。未重审已通过代码，未改动任何文件，未派发子智能体。

工作区状态（`git log --oneline -6` / `git status --short`）：HEAD = `b700a86`，即为被审 diff 的 head；工作区对 `src-tauri/**` 零改动（脏文件仅 `.pi/agents/*`、`docs/.../plan` 等与本次无关项），故我读到的源码即被审代码。

---

## 逐条判定

### F28 — ADDRESSED

证据：

- 实现：`src-tauri/src/document.rs:226-227` 已是 `std::fs::read_to_string(&canonical).map_err(|error| format!("Cannot read existing document: {error}"))?`，`unwrap_or_default()` 已被彻底删除（`grep -rn "unwrap_or_default" src-tauri/src/document.rs` 无命中）。
- 错误方向与裁定一致：读失败即 `?` 提前返回，位于 `let temp_path = save_temp_path(...)`（`document.rs:230`）与 `fs::write`（`:232`）**之前**，故「拒绝保存」路径不产生任何临时文件。
- 错误可读：`Cannot read existing document: <io::Error Display>`；grep 全仓确认无任何前端/后端按固定文案匹配该错误（`src/` 中零命中），前端按 F24 走 `showToast("保存失败：" + String(error))`（`src/hooks/useDocumentEditor.ts:115-117`），新文案对用户可读。
- 新增用例 `document_tests.rs:305-319` 是**真断言**、非占位：
  - `:314` `unwrap_err()` —— 旧实现（`unwrap_or_default`）会返回 `Ok(SaveOutcome{bytes_written:10})`，该断言在旧代码上必然 panic（与报告的红证据形态一致，我按实现逐字推演确认，未做变异改文件）；
  - `:316` 断言错误文案含 `Cannot read existing document`；
  - `:317` 用 `fs::read`（而非 `read_to_string`，避免断言自身先抛错）逐字节断言原文件未被改写；
  - `:318` 断言目录无 `*vellum-tmp*` 残留。
- 「Windows 无法稳定构造不可读文件」的替代测法**真的走了被测分支**，不是绕道：用例写入非 UTF-8 字节后直接调用被测函数 `save_markdown_file`（`document_tests.rs:313`），命中 `document.rs:226` 的 `read_to_string` 错误分支（`InvalidData`）并对整个函数的返回/副作用做断言。它不是把逻辑降级成「只测辅助函数」。唯一未覆盖的是错误**种类**（`PermissionDenied` vs `InvalidData`），但映射点是同一个泛化 `map_err`，无按错误种类分支的代码，故不构成覆盖缺口。

### F29 — ADDRESSED

证据：

- 临时名唯一：`document.rs:192-200` 抽出 `pub(crate) fn save_temp_path`，`:197` `uuid::Uuid::new_v4().simple()`，`:199` 组名 `".{file_name}.{8hex}.vellum-tmp"`（`&unique[..8]`；`simple()` 恒为 32 位 ASCII hex，切片不会 panic）。
- 调用点唯一：`document.rs:230` `let temp_path = save_temp_path(&canonical)?;`（`grep -rn "save_temp_path" src-tauri/src/` 仅 `document.rs:192/230` + 测试 `document_tests.rs:194/328`），旧的固定名构造已不存在。
- 「同一 canonical 不会共用同一路径」由用例 `document_tests.rs:322-338` 断言：256 次取路径写进 `HashSet`，`:335` `assert!(seen.insert(temp), "临时路径重复…")` —— 若退回固定名，第一次之后 insert 即返回 false、断言失败（与报告的红-2 形态一致）。同时断言同父目录（`temp.parent() == canonical.parent()`，rename 仍同卷原子）、不等于目标、命名形如 `.u.md.<8hex>.vellum-tmp`。
- 「写完不残留 `*vellum-tmp*`」断言仍在且仍有效：`document_tests.rs:294-302`（`leaves_no_temp_file_behind`）+ 残留探测器 `:200-210` 用 `contains("vellum-tmp")`（`:208`），对新命名 `.<name>.<hex>.vellum-tmp` 同样命中；本轮新增的 F28 用例再补一次同款断言（`:318`）。我实跑确认该用例通过（见下）。
- 依赖/契约：`uuid = { version = "1", features = ["v4"] }` 为**既有**依赖（`src-tauri/Cargo.toml:27`，且不在本次 diff 内）。裁定 F29 明示「uuid 已在 Cargo.toml 依赖中，直接用」，与实现一致。

---

### 新破坏

未发现阻断或应当修复级别的新破坏。逐项排查：

1. **失败清理与 rename 路径仍正确**（`document.rs:232-243`）：写临时文件失败（`:232-236`）与 rename 失败（`:238-242`）都只 `remove_file(&temp_path)` —— 现在是各自专属路径，**不可能**误删另一并发调用的临时文件（原先固定名时代这里才是错的）。目标文件在两条失败路径上均未被触碰。「目录只剩临时文件」的最坏情形：两路并发各自 rename 后，目录里只有目标文件 + 对方在途临时文件；失败方只清自己的，不影响目标。
2. **首次保存/空文件不会被误拒**：`save_markdown_file` 在 `document.rs:208` 先要求 `canonical.is_file()`，能走到 `:226` 读取的目标必然存在；存在的 **0 字节空文件** `read_to_string` 返回 `Ok("")`（`std::fs::read_to_string` 对空文件恒为 `Ok`），`dominant_eol("")` = LF（`document.rs:150-156`），正常保存，**不会**被新 `map_err` 拒绝。
   「新文件路径 `read_to_string` 报 NotFound」的判断：**属于「必须拒绝」，且在本应用中不可达**。理由：`save_document` 的闸门 ① 要求 `target == AppState.current`（`main.rs:210-220` + `document.rs:168-176`），而 `AppState.current` 只由 `load_document` 写入（`main.rs:164-198`），`load_document` 内部 `load_markdown_file` 先 `canonicalize`（`document.rs:73`）、`is_file`（`:77`）、扩展名与体积校验后才返回，所以「当前文档」必然是已存在的 `.md`。全仓无「新建文件/Untitled」流程（`grep -rn "新建\|Untitled\|create.*file" docs/.../plan` 零命中；`src/` 亦无）。唯一可达 NotFound 的是 TOCTOU：目标在 `:208` 与 `:226` 之间被外部删除 —— 此时**拒绝比旧行为更安全**（旧行为会 `unwrap_or_default` → 空串 → LF → rename 把被删文件「复活」成 LF 版；新行为报错，前端 F24 保留草稿可重试）。
3. **零新依赖、零公开签名变化**：diff 仅 2 文件（`git show --stat b700a86`），`Cargo.toml`/`main.rs` 未出现；`SaveOutcome`（`document.rs:19-25`，含 `rename_all = "camelCase"`）与命令签名 `save_document(path: String, content: String, state)`（`main.rs:201-205`）逐字未变；`save_temp_path` 为 `pub(crate)` 新增内部函数，不影响外部调用方。
4. EOL/BOM/闸门/原子性等既有行为：diff 未触及 `dominant_eol`/`apply_eol`/`check_save_gates`/闸门顺序；我实跑的 14 条 `save_tests` 全绿，覆盖 CRLF 保真、LF 不引入 CRLF、CRLF 不双写、BOM、扩展名拒绝、体积拒绝、无残留、两道闸门。

低概率副作用（登记，非阻断，见「范围外观察」3）：临时名后缀由 11 字符增至 20 字符，紧贴 Windows `MAX_PATH` 的极长文件名场景下写临时文件的成功率窗口略有收窄（`dunce::canonicalize` 已剥 `\\?\` 前缀）；崩溃残留不再被下次保存 truncate 复用，而是累积（修复报告「未解决项 3」已登记）。

---

### 范围外观察

1. **设计文档漂移**：`docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md:164` 与 `docs/superpowers/plans/...:1336` 仍写固定名 `.<name>.vellum-tmp`，与实现（唯一后缀）不符。建议后续随 spec 同步一句即可（修复报告已登记实现侧，文档侧未提）。
2. **并发语义残余**（裁定已明示接受）：唯一后缀只消除「互踩临时文件」，两次真正并发保存仍可按 rename 顺序互相覆盖（后到者胜），调用方 `bytes_written` 与最终磁盘内容可能不一致。前端 T6 在 `await save` 前同步 `closeActive()` 串行化（`src/hooks/useDocumentEditor.ts:98-110`），命令层无 Mutex；裁定 F29 接受「由 rename 原子性兑底」，本轮不判缺陷。
3. **临时名长度**：`.{name}.{8hex}.vellum-tmp` 比原 `.{name}.vellum-tmp` 长 9 字符；对接近 260 字符的 `.md` 路径，写临时文件可能新出现 `os error 206`（路径过长）而旧实现可成功。极端窄窗口，建议记入 T8 手检（或后续改短后缀），不阻断。
4. **`*vellum-tmp` 残留累积**：崩溃于写与 rename 之间时新名残留无法被复用（旧固定名会被下次保存 truncate），残留数量随崩溃次数增长且无启动清理，与修复报告「未解决项 3」一致。
5. 上一轮 Minor-3～Minor-11 全部未处理，属控制器允许的 YAGNI 范围外，本轮不重审。

---

### 结论

**All findings addressed:** Yes

**Reasoning:** F28 已改为 `map_err` 返回可读错误并删净 `unwrap_or_default`，新用例直接在被测函数上断言「报错 + 原文件逐字节未变 + 无临时残留」，在旧实现上必然红；F29 已用 uuid v4 短后缀使临时路径唯一，256 次互异断言 + 既有 `vellum-tmp` 残留断言同时保留，依赖与 `SaveOutcome`/命令签名均未变；我实跑 `cargo test --lib save_tests` 得 14 passed / 0 failed，新增两用例在列，diff 未引入阻断级新破坏（空文件不会被误拒；NotFound 场景在应用内不可达、拒绝方向更安全）。

### 我实际跑过的命令与输出摘要

| 命令 | 输出摘要 |
|---|---|
| `cd src-tauri && cargo test --lib save_tests` | `running 14 tests` … 全部 `ok`（含 `rejects_save_when_existing_content_cannot_be_read`、`temp_path_is_unique_per_call_and_stays_next_to_the_target`、`leaves_no_temp_file_behind`）；`test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 42 filtered out; finished in 0.01s` |
| `git log --oneline -6` / `git status --short` / `git diff --stat HEAD` / `git show --stat b700a86` | HEAD=`b700a86`（`fix(edit): 拒绝静默降级 LF 与临时文件名唯一（审查轮 1）`）；改动仅 `src-tauri/src/document.rs`(25) + `document_tests.rs`(39)；`src-tauri/**` 工作区干净 |
| `grep -rn "uuid" src-tauri/Cargo.toml src-tauri/Cargo.lock` | `Cargo.toml:27: uuid = { version = "1", features = ["v4"] }`（既有依赖） |
| `grep -rn "save_temp_path\|read_to_string(&canonical)\|unwrap_or_default" src-tauri/src/` | `save_temp_path` 仅 `document.rs:192/230` + 测试引用；读旧文件为 `:226-227` `.map_err(...)`；`unwrap_or_default` 在 `document.rs` 零命中 |
| `grep -rn "vellum-tmp" --include=*.rs --include=*.ts --include=*.tsx --include=*.md .`（排除 node_modules/.superpowers） | 代码侧仅 `document.rs:8/189`、`document_tests.rs:208/334`；文档侧 `design.md:164`、`plan:1267/1336` 仍为旧固定名（观察 1） |
| `grep -rn "save_document" src/` + 读 `src/hooks/useDocumentEditor.ts:60-130` | 前端调用点 `src/App.tsx:491`，失败走 F24 `showToast("保存失败：…")` 回退内存；无「新建文件」流程 |
| 只读阅读 | `document.rs:1-251`、`main.rs:155-260`、`document_tests.rs:185-360`、`rulings.md` F28/F29、`task-5-brief.md`、`task-5-review.md`、`task-5-fix-report.md`、`review-3f0b74a..b700a86.diff` |
| 未执行 | 整套 `cargo test` / `npm test` / `tsc`（按控制器指示不重跑，本轮前端零改动）；未做变异复跑（只读约束）；未复现真机并发 invoke 与 Windows 独占锁场景 |
