# Task 4 审查报告 — 编辑会话状态机 `useDocumentEditor`

审查基线：`784fdf9..e82ba24`（diff 一次性读取）、简报 `task-4-brief.md`、裁定 `rulings.md`（F9b/F11/F14 优先）。
只读审查：未修改任何文件；未重跑整套测试（按控制器指示），仅跑聚焦用例 + 只读探针（探针脚本写在系统临时目录、用完即删，未触碰仓库）。

---

### Spec Compliance

**逐条对照结果**

- ✅ **文件与导出面完全一致**：`src/hooks/useDocumentEditor.ts:5-27`（`EditorViewMode` / `EditorToast` / `UseDocumentEditorOptions`）、`:141-156` 返回对象 13 个字段与简报 `Interfaces` 逐一对应，无缺项、无多余导出。
- ✅ **提交即落盘且相同则 no-op**：`src/hooks/useDocumentEditor.ts:79-82`（`draft === original` ⇒ `closeActive()` 直接返回，不调 `onMarkdownChange`/`save`）；用例 `src/hooks/useDocumentEditor.test.ts:58-68` 断言两个 spy 均未被调用。
- ✅ **LF 归一（F9b/F14）**：`src/hooks/useDocumentEditor.ts:34-36` 定义 `toDraftText = .replace(/\r\n/g, "\n")`，`:70`（草稿切片）与 `:78`（比较原文）均已归一 —— 与上游同源表达式 `src/components/MarkdownDocument.tsx:644` 逐字一致；上游 caret 用例 `src/components/MarkdownDocument.test.tsx:1173-1175`（CRLF 三档）与本任务 `:127-146` 用例互锁。
- ✅ **跨任务一致性用例真断言了「不含 `\r`」**：`src/hooks/useDocumentEditor.test.ts:141-142`（`expect(draft).toBe("第一段。\n第二行。")` + `expect(draft).not.toContain("\r")`），并要求未改动时两个 spy 未调用（`:145-146`）——不是断言 `\r\n` 的弱写法。
- ✅ **`save` 由调用方注入、未直接落盘**：全文无 `invoke`（`grep -Fn invoke src/hooks/useDocumentEditor.ts` → 无输出）；无 Tauri import。
- ✅ **`heavyCommitMs` 默认 800 且可注入**：`src/hooks/useDocumentEditor.ts:26`、`:36`（解构默认值）。
- ✅ **不新增依赖、不动 App / MarkdownDocument / Rust / 样式**：diff 仅 3 文件（spec + 2 新文件）；`flushSync` 来源 `react-dom`，`package.json:25` 已是既有依赖 `19.2.7`。
- ✅ **Step 5 的 spec §6.4 修订已入库**：`docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md` 新增修订块（diff 中 `修订（2026-09-10，Task 4）` 一行）。报告第 4 条已登记「git add 多带了 spec 文件」，理由成立。
- ✅ **8 条简报用例逐字采用**：`src/hooks/useDocumentEditor.test.ts:17,23,32,58,70,84,92,104` 与简报代码块逐行一致；新增第 9 条（`:127`）是裁定 F9b 要求的跨任务一致性用例，属合理增量。
- ✅ **报告的「无 test-driven-development 技能」声明为真**：`ls .pi/skills/superpowers/` 实际 13 项（brainstorming / dispatching-parallel-agents / executing-plans / finishing-a-development-branch / receiving-code-review / requesting-code-review / subagent-driven-development / systematic-debugging / using-git-worktrees / using-superpowers / verification-before-completion / writing-plans / writing-skills），确无该技能。
- ✅ **报告「清理 scratch 文件」为真**：`ls outputs` 无 `__audit_scratch` 残留。
- ❌ **「保存失败可重试」这一自述意图未实现**：`src/hooks/useDocumentEditor.ts:96` 注释写「让用户可重试」，但重试路径实测会（a）重复拼接内容落盘，或（b）静默永不落盘 —— 见 Critical-1。
- ⚠️ **F11（入口 chunk）时点声明正确但未验证**：本 commit 未 import 进 `App.tsx`，增量确为 0（可凭 diff 判定）；真机增量只能到 Task 6 之后测，本任务不构成偏差。
- ⚠️ **未复跑整套**：`npm test` 31 文件 / 362 用例为实施者自述，我按控制器指示未复跑（我只复跑了本任务聚焦文件）。

---

### Strengths

1. `toDraftText` 同时用在**草稿生成**与**原文比较**两处（`:70` 与 `:78`），没有犯「只归一草稿、比较还用原始文本」的经典错误 —— CRLF 文档下「点开块不打字直接提交」因此正确 no-op，而不是把整块 EOL 静默改成 LF。这是对裁定 F9b 的**必要外扩**，报告已登记。
2. 用户可见文案都带上下文（`记录中 · 编辑已禁用` / `记录中 · 断开连接后才能修改` / `HTML 区块为只读`），且 `toast` 用单调自增 `id`（`:50-53`），消费者可据 id 变化重放，接口干净。
3. 失败路径在编排顺序上是对的（先 `closeActive` 再 patch 回草稿状态，`:92-99`），不存在「先恢复再清空」的顺序错。
4. 单元边界清晰：hook 只做状态与编排，切片/拼接全在 `src/lib/editUnits.ts`（复用 `buildEditUnits`/`spliceUnit`，无第二份实现），符合 F1 的「不重复实现包含判定」精神。

---

### Issues

#### Critical (Must Fix)

**C1 — 保存失败后的重试路径状态不自洽：会重复落盘内容，或永远不再落盘**（`src/hooks/useDocumentEditor.ts:92-100`，配合 `:45-48`、`:76-84`）
- 机理：`commitActive` 先用 `flushSync(() => onMarkdownChange(next))`（`:88`）**强制父级同步吸收新 markdown**（这正是本 hook 的写法），于是 `markdown` prop 变成 `next` ⇒ `units` 由 `:44` 重新推导 ⇒ `activeUnit`（`:45-48`）指向**新文本里的同一个 index**。失败分支却把 `activeUnit.index`（旧语义索引）与旧草稿一起写回（`:97-98`），此后三者不再自洽：
  - (a) 用户这次编辑改变了块结构（草稿里多了一个空行/新段落）时，`activeUnit` 只覆盖新文本的**首段**，但 textarea 里是整段草稿；再次提交会把整段草稿拼到首段区间 ⇒ **内容重复写入并落盘**。
  - (b) 草稿不改变结构时，重新推导的 `original` 已经等于草稿 ⇒ `:79` 提前返回，`save` **永远不会被再次调用**，磁盘停留在旧版本，且无任何错误提示（用户以为已保存）。
- 复现（真实输出，纯函数探针；探针脚本置于系统临时目录、已删除）：
  ```
  $ node <tmp>/probe.ts   # import buildEditUnits/spliceUnit from src/lib/editUnits.ts
  units: 0[0,4)="# 标题" | 1[6,10)="第一段。" | 2[12,16)="第二段。"
  commit ->  "# 标题\n\n改过的第一段。\n\n新段。\n\n第二段。\n"
  hook re-activates index 1 => source slice: "改过的第一段。"
  retry splice(next, back[1], draft) => "# 标题\n\n改过的第一段。\n\n新段。\n\n新段。\n\n第二段。\n"      <-- (a) 重复
  caseA: next = "# 标题\n\n改过的第一段。\n\n第二段。\n"
  caseA: re-derived original = "改过的第一段。" | draft = "改过的第一段。" | draft===original => true
         (=> commitActive early-returns, save never called)                                        <-- (b) 静默不落盘
  ```
  （(a)(b) 的前置条件「父级 markdown 已前进」在真机接线 T6 时必然成立，因为 `:88` 的 `flushSync` 就是为同步吸收而写。）
- 修法方向（定一即可）：失败时把**区间冻结**（在 commit 起始处保存 `{index,start,end}` 并作为失败分支的重激活依据，或让 hook 以 `pendingUnitRange` 状态驱动草稿/`original`，而不是重新从 `units` 找 index）；并让「同一份草稿的重试」可强制落盘（例如记住 `unsavedText`，命中时跳过 `:79` 的 no-op 直接 `save`）。补两条用例：结构变化草稿的失败重试（断言 `next2` 无重复）、同内容失败重试（断言 `save` 第二次被调用）。

#### Important (Should Fix)

**I2 — `commitActive` 缺 `mdlogActive` 门禁：记录中仍可提交并落盘**（`:76-101` 无检查，对比 `:63`、`:109` 都有）
- 复现：激活块 → mdlog 连接建立（`mdlogActive` 由 false 变 true）→ 触发提交（Ctrl+S / 失焦 / `toggleView`）⇒ `spliceUnit` + `onMarkdownChange` + `save` 照常执行，记录中的「禁止修改」被绕过。门禁只在**入口**（`activateUnit`/`toggleView`）拦，**提交口**没有 —— 结构性保证没落在状态机自己身上，而依赖 T6 记得调用 `notifyInterrupted`（本任务的接口没有任何机制保证这一点）。修法：`commitActive` 开头 `if (mdlogActive) { notifyInterrupted("记录已开始，编辑已取消"); return; }`（一行），或在 hook 内用 effect 监听 `mdlogActive` 边沿。

**I3 — 保存失败后 `toggleView` 仍切回阅读视图，草稿「留在框里」名不副实**（`:103-108`、`:92-99`）
- `commitActive` 吞掉异常（catch 后正常 resolve），`toggleView` 无法感知失败，继续 `setViewMode("reading")`（`:106`）⇒ 覆盖层消失，用户看不到失败后恢复的草稿；状态变成「`activeUnitIndex != null` 但 `viewMode === "reading"`」。虽然再按一次 Ctrl+E 能重新看到草稿（因为 index 还在），但 UI 与状态不一致，且 `initialCaret` 已被 `closeActive` 清零未恢复（`:55-59` vs `:97-98`）。修法：失败分支返回布尔（或抛错）让 `toggleView` 保持 `editing`；同时恢复 `initialCaret`。

**I4 — `flushSync` 的调用语境依赖消费者，测得的时长可能为 0 且无信号**（`:86-90`）
- (i) 从**事件回调**调用是 React 支持的用法（本任务测试即从 test body 调用，未覆盖 effect 语境）；但 spec §6.3 把「切换文档 / 窗口关闭 / 外部变更」也列为提交触发点，这些在 T6 里极可能落在 `useEffect` 内，而在 render/commit 阶段调用 `flushSync` 是 React 文档明确的非支持用法（会告警或退化为不同步 flush）。建议 hook 侧用「测量与调用语境解耦」的方式（例如测量用 `performance.now()` 包住 `onMarkdownChange`，并接受非同步消费者不许诺 heavyDoc），或在文档注释里把这层契约写给 T6。
- (ii) 测量窗口**只覆盖 `onMarkdownChange` 同步触发的渲染**：若 T6 的 `onMarkdownChange` 不把值写回传给本 hook 的 `markdown` prop（走 ref / 防抖 / 延迟），则 `renderMs ≈ 0`、`heavyDoc` 永远不置位，且不会有任何提示（静默降级）。这两点都无法仅凭本 diff 验证，列 ⚠️。

**I5 — 测试缺口（新增逻辑中多条分支无覆盖）**
- `toggleView` 的 **editing → commit → reading** 分支（`:104-107`）零覆盖：现有用例（`test.ts:32-40`）只走了 reading → editing。
- `activateUnit` 的两个早退分支（`mdlogActive` 提示 `:63-66`、只读块静默返回 `:68`）零覆盖；`notifyLocked("widget")` 文案分支（`:132` 右支）零覆盖；`notifyInterrupted` 的 `activeUnitIndex === null` 分支（`:119-122`，只弹 toast、不碰剪贴板）零覆盖。
- 「重文档」用例只有**正向**（`:70-82`，`heavyCommitMs: 0`）没有**负向**（给一个大阈值断言 `heavyDoc` 仍为 false），因此 `>` 比较、默认值 800、以及「只有真正超阈值才置位」的语义都未被测试约束；且 `heavyCommitMs: 0` 这条的通过条件实际是「`performance.now()` 差值 > 0」——实测本机 `node -e` 两次相邻 `performance.now()` 差值 0.003ms（非 0），即**任何非零耗时都会绿**。它确实能杀掉「阈值判定失效」的变异（报告 M5），但并不能证明量到的是整篇重解析。建议补：大阈值负向用例 + 断言 `heavyDoc` 在提交后仍为 false。
- C1 的重试路径无用例（`:104-124` 只断言首次失败）。

**I6 — 跨任务 LF 归一为两处独立实现，无共享来源**（`src/hooks/useDocumentEditor.ts:34-36` vs `src/components/MarkdownDocument.tsx:644`）
- 裁定 F9b 明确要求「两处必须一致」，但目前是两份手写的 `replace(/\r\n/g, "\n")`，没有共享导出。F1 已就「包含判定重复实现」下过同类裁定。建议把 `toLf(text)` 从 `src/lib/editUnits.ts` 导出，两侧共用（一行改动，不新增文件）。列为 Important 而非 Minor 的唯一理由：漂移表现为**系统性光标偏移**（不是崩溃、难发现）。

#### Minor (Nice to Have)

- **M7 `heavyDoc` 一旦置位永不复位**（`:90`）：只有 set 没有 reset 路径，简报未规定复位条件，但「自适应」语义通常应可降回。需确认是否有意为之（若要复位，建议在成功提交且 `renderMs` 显著低于阈值时清位）。
- **M8 失败分支不恢复 `initialCaret`**（`:55-59` 清零，`:97-98` 未写回）：重试时焦点回到块首而非用户原点击位置。
- **M9 `activateUnit` 早退不清理旧状态**（`:63-68`）：记录中/只读块点击时保留上一个块的 `activeUnitIndex`/`draft`，且 `initialCaret` 不会更新 —— 语义上「点击失败」与「保持原状」混同。当前无害，但与 I3 组合会放大 UI 与状态不一致。
- **M10 `commitActive` 可重入**（`:76-101`）：`closeActive()` 的效果要等渲染才反映到 `activeUnit`，同一 tick 内连续两次提交（快速连击 / Ctrl+S 与失焦同帧）会各自算出 `next` 并各发一次 `save`。T5 幂等写入使其代价低，但 T3 已经用 `committedRef` 一次性闸门处理了同类问题（裁定 F22），这里没有对应防护。另外 `setDraft(draft)`/`spliceUnit(..., draft)` 用的是闭包中的 `draft`（`:97`），若同一 tick 先 `updateDraft` 再 `commitActive` 会丢掉最后一次输入。
- **M11 `notifyInterrupted` 回调标识不稳定**（`:117-128`）：deps 含 `draft`/`activeUnitIndex`，每次键入都换新引用；若 T6 把它放进 effect deps 会造成反复订阅/触发。建议内部用 `draftRef` 读取，或让消费者知道该约定。
- **M12 剪贴板写入虽安全但零覆盖**（`:123`）：`navigator.clipboard?.writeText(draft).catch(() => {})` 的可选链会短路整条链，clipboard 缺失时不会抛 `TypeError`（jsdom 下 `navigator.clipboard === undefined`，实测该用例通过即证明该路径不炸）；但「成功调用 `writeText(draft)`」从未被断言（无 mock），真机行为只能等 T6。另注意 `writeText` 若同步抛出（非 Promise 返回的 mock）会逃逸，属边缘。
- **M13 变异证据不可复核**：报告的 10 个变异体证据来自已删除的临时脚本（`outputs/__audit_scratch/` 确无残留，符合规约），仓库内不留可复现痕迹。这是流程性取舍，不构成缺陷，但审查者无法独立复算该表。

---

### Assessment

**Task quality:** Needs fixes

**Reasoning:** 规格面基本达标（接口逐字一致、LF 归一在草稿与比较两侧都做了、无 invoke、无新依赖、8 条用例逐字采用并有真实断言），但**保存失败后的重试路径状态不自洽**（Critical-1：结构变化时重复落盘、同内容时静默永不落盘。已用真实探针输出证实），且 `commitActive` 缺 mdlog 门禁、重试相关分支零测试覆盖 —— 属数据正确性缺陷，必须先修再进 T6 接线。

---

### Commands Run（真实输出摘要）

| 命令 | 输出摘要 |
|---|---|
| `npx vitest run src/hooks/useDocumentEditor.test.ts` | `Test Files 1 passed (1)` / `Tests 9 passed (9)`（Duration 1.48s）—— 与报告一致，本任务测试真实可绿 |
| `ls .pi/skills/superpowers/` | 13 个目录，**确无** `test-driven-development`（报告声明属实） |
| `node -e "const a=performance.now();const b=performance.now();console.log(b-a, b-a!==0)"` | `0.0030000000000001137 differs: true` —— 佐证 `heavyCommitMs: 0` 用例的通过条件是「任意非零耗时」 |
| `node <tmp>/probe.ts`（导入 `src/lib/editUnits.ts`，探针在系统临时目录、已 `rm -rf`） | 输出见 Critical-1：失败重试 ⇒ `"…\n\n新段。\n\n新段。\n\n第二段。\n"`（重复） / caseA `draft===original => true`（`save` 永不再调用） |
| `grep -n "it(\"" src/hooks/useDocumentEditor.test.ts` + `wc -l` | 9 条用例（17/23/32/58/70/84/92/104/127），文件 147/156 行，与 diff 的 305 insertions 吻合 |
| `grep -Fn 'invoke' src/hooks/useDocumentEditor.ts` | 无输出（未直接落盘，约束满足） |
| `grep -n '"react-dom"' package.json` | `25: "react-dom": "19.2.7"`（`flushSync` 非新依赖） |
| `grep -Fcn 'CRLF' src/components/MarkdownDocument.test.tsx src/lib/editUnits.test.ts src/hooks/useDocumentEditor.test.ts` | 5 / 2 / 2 —— 上游 caret 侧（`MarkdownDocument.test.tsx:1173-1175`）与消费侧（`useDocumentEditor.test.ts:127`）都有 CRLF 用例，口径互锁 |
| `ls outputs` | 无 `__audit_scratch` 残留（报告清理声明属实） |
| `npm test`（整套） | **未执行**（按控制器指示不重跑整套）；因此报告里 31 文件 / 362 用例一行为自述、未经我复核 |
