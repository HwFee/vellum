# Task 4 报告 — 编辑会话状态机 `useDocumentEditor`

- 分支：`master`，工作目录 `C:\Users\17445\Desktop\Vellum`
- 提交：`e82ba24` — `feat(edit): 编辑会话状态机（提交即落盘、自适应重文档提示、中断与失败路径）`（单次提交）
- 状态：完成；`npm test` 31 文件 / 362 用例全绿，`npx tsc --noEmit` 干净
- 应用技能：`executing-plans`（按 bite-sized 步骤执行）+ `verification-before-completion`（每条结论均附本轮新鲜输出）。`superpowers` 目录内**没有** `test-driven-development` 技能（实际目录列表：brainstorming / dispatching-parallel-agents / executing-plans / finishing-a-development-branch / receiving-code-review / requesting-code-review / subagent-driven-development / systematic-debugging / using-git-worktrees / using-superpowers / verification-before-completion / writing-plans / writing-skills），故 TDD 按任务书自带的红→绿流程执行。

---

## 1. 改动文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/hooks/useDocumentEditor.test.ts` | 新增（147 行） | 简报 8 条用例逐字采用 + 1 条自加跨任务一致性用例（CRLF） |
| `src/hooks/useDocumentEditor.ts` | 新增（156 行） | 编辑会话状态机；导出面与简报 `Interfaces` 完全一致 |
| `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md` | 修改（+2 行） | Step 5 要求：§6.4 追加一行修订标记（二选一横幅简化为 `notifyInterrupted` 中断路径） |

未触碰（按全局约束）：`src/lib/editUnits.ts`、`src/components/BlockEditor.tsx`、`src/components/MarkdownDocument.tsx`、`src/lib/rehypeEditUnits.ts`、`src/App.tsx`、Rust、样式。未新增依赖（`flushSync` 来自既有 `react-dom`）。

---

## 2. 逐条红→绿证据

### 2.1 Step 2 的红（整体）

命令：`npx vitest run src/hooks/useDocumentEditor.test.ts`（此时实现文件尚不存在）

```
 FAIL  src/hooks/useDocumentEditor.test.ts [ src/hooks/useDocumentEditor.test.ts ]
Error: Failed to resolve import "./useDocumentEditor" from "src/hooks/useDocumentEditor.test.ts". Does the file exist?
  Plugin: vite:import-analysis
 Test Files  1 failed (1)
      Tests  no tests
```

失败原因是模块不存在 ⇒ 整文件红，无法区分单条用例。为避免「整文件红」这一弱证据，**补做了逐条变异红证据**（下表）：对实现做定点变异，要求对应用例恰好变红。全部 10 个变异体均被杀死（0 生存），证明每条断言都真实约束了对应行为。

### 2.2 逐条变异红 → 绿

变异脚本：`outputs/__audit_scratch/mutation_evidence.mjs`（Node，逐次写坏 → 跑单条用例 → 从内存原文还原；跑完已删除）。真实日志：

```
=== 基线（未变异）===
Tests: Tests  9 passed (9)

[M1] RED 如期 | units 恒为空 | 从 markdown 切出块单元 | Tests  1 failed | 8 skipped (9)
[M2] RED 如期 | toggleView 去掉 mdlog 门禁 | mdlog 记录中拒绝进入编辑视图并提示 | Tests  1 failed | 8 skipped (9)
[M3] RED 如期 | 提交不落盘（删掉 await save） | 激活块后草稿是该块源码，提交时拼回全文并落盘 | Tests  1 failed | 8 skipped (9)
[M4] RED 如期 | 无改动也提交 | 草稿与原文相同时不提交、不落盘 | Tests  1 failed | 8 skipped (9)
[M5] RED 如期 | 重文档阈值判定失效 | 提交耗时超过阈值时挂出「文档较重」标记 | Tests  1 failed | 8 skipped (9)
[M6] RED 如期 | 只读原因文案互换 | 只读块点击给出原因文案 | Tests  1 failed | 8 skipped (9)
[M7] RED 如期 | 中断时不取消编辑 | 编辑中被外部改写：取消编辑并提示 | Tests  1 failed | 8 skipped (9)
[M8] RED 如期 | 保存失败不还原草稿 | 保存失败时把草稿留在框里并提示 | Tests  1 failed | 8 skipped (9)
[M9] RED 如期 | activateUnit 草稿未做 LF 归一 | CRLF 文档的草稿按 LF 归一，且未改动时不误提交 | Tests  1 failed | 8 skipped (9)
[M10] RED 如期 | commitActive 原文未做 LF 归一 | CRLF 文档的草稿按 LF 归一，且未改动时不误提交 | Tests  1 failed | 8 skipped (9)

=== 还原校验 ===
implementation restored OK
变异总数 10，生存（=用例无效）0
还原后基线: Tests  9 passed (9)
```

`-t` 逐条过滤时其余 8 条为 skipped，即「只有目标用例变红」；M9/M10 共同约束自加的第 9 条用例的两半（草稿归一 + 原文比较口径一致）。

### 2.3 绿（本轮新鲜输出）

```
$ npx vitest run src/hooks/useDocumentEditor.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)

$ npm test
 Test Files  31 passed (31)
      Tests  362 passed (362)

$ npx tsc --noEmit
(无输出，退出码 0)
```

基线 30 文件 / 353 用例 → 31 文件 / 362 用例，增量恰为本任务 1 文件 / 9 用例，无既有用例回归。

---

## 3. 与需求 / 裁定的偏差

1. **遵守 F9b/F14（LF 归一），并外扩到 `commitActive` 的比较口径**（唯一实质增量）。
   简报的 `activateUnit` 原文是 `setDraft(markdown.slice(unit.start, unit.end))`；按裁定改为
   ```ts
   setDraft(toDraftText(markdown.slice(unit.start, unit.end)));   // toDraftText = .replace(/\r\n/g, "\n")
   ```
   同时 `commitActive` 里的 `original` 也走同一归一：
   ```ts
   const original = toDraftText(markdown.slice(activeUnit.start, activeUnit.end));
   if (draft === original) { closeActive(); return; }
   ```
   **理由（必须修，否则是 bug）**：`draft` 已归一而 `original` 未归一，CRLF 文档里「点开块、不打字、直接 Esc/失焦」会被判为有改动 ⇒ 触发一次无谓的 `onMarkdownChange` + `save`，且把该块 EOL 静默改成 LF。归一后该路径正确 no-op；用户真改了内容时照常提交（落盘 EOL 由 Task 5 的 `dominant_eol` 还原）。TS 侧**未**做任何 CRLF 还原（按裁定）。

2. **新增一条跨任务一致性用例**（任务书 §5 要求，简报未含）：`CRLF 文档的草稿按 LF 归一，且未改动时不误提交`
   —— 断言 `activateUnit(1, 4)` 后 `draft === "第一段。\n第二行。"`、`draft` 不含 `\r`，且未改动时 `onMarkdownChange` / `save` 均未调用。与上游 `caretOffsetForRatio` 的 LF 口径锁死。

3. **`useMemo<EditUnit[]>(...)` 显式类型参数**（简报为 `useMemo(() => ...)`）。
   仅因 `tsconfig` 开了 `noUnusedLocals`：简报实现里 `import { ..., type EditUnit }` 无显式使用点，`tsc --noEmit` 会报未使用导入。加类型参数是最小改法，不新增导出、不改行为。

4. **提交内容含 spec 的 §6.4 修订**（计划 Step 6 的 `git add` 只列了两个源文件）。
   理由：Step 5 明确要求本任务在 spec §6.4 加修订标记，若不入库会留下未提交的文件变更，与「单次提交」相冲突。`git show --stat e82ba24` 三文件：
   `.../2026-09-10-vellum-block-editing-design.md | 2 +`、`src/hooks/useDocumentEditor.test.ts | 147 +`、`src/hooks/useDocumentEditor.ts | 156 +`。

5. **`useDocumentEditor.ts` 完全实现简报 Step 3 的代码语义**（含 `flushSync` 量提交耗时、`heavyCommitMs` 默认 800 可注入、失败时 `setDraft(draft)` + `setActiveUnitIndex(activeUnit.index)` 保留草稿、`notifyInterrupted` 尽力写剪贴板后 `closeActive`、`notifyLocked` 文案），未做简报之外的扩展（YAGNI）。

6. **无接口偏差**：返回对象字段与简报 `Interfaces` 逐一对应（`viewMode / toggleView / units / activeUnit / draft / initialCaret / heavyDoc / toast / activateUnit / updateDraft / commitActive / notifyLocked / notifyInterrupted`）。

7. **F11（入口 chunk）**：本任务未把单元计算搬进 `MarkdownDocument`；但 `App.tsx` 尚未接线（Task 6 才 import 本 hook），故**本 commit 尚未实际把 `buildEditUnits` 带进入口 chunk**，增量要到 Task 6 才可观测——登记给 Task 8 实测时注意该时序。

---

## 4. 未解决项 / 关注点

1. **`heavyCommitMs: 0` 用例对时钟分辨率敏感**（简报给定写法，未改）：判定是 `performance.now()` 差值 `> 0`。Node/jsdom 下 `performance.now()` 为微秒级，本机 9/9 稳定通过；若将来在低分辨率时钟环境出现偶发绿→红，属测试写法问题而非实现问题（实现按阈值语义正确）。
2. **`notifyInterrupted` 的剪贴板写入无测试覆盖**：jsdom 无 `navigator.clipboard`，走可选链短路；Clipboard 存在时的实际行为只有 Task 6 接线后的真机可见（登记为真机观察项）。
3. **`toast` 无自动消失机制**（简报接口无 TTL 字段）：消费者（Task 6）只按 `id` 变化重放提示；若需要消退动画，属后续任务的展示层职责，本任务不扩范围。
4. **未跑 Rust 侧测试**：本任务零 Rust 改动（`cargo test` 不适用）。
5. **F15（点击语义交叉点）**、**F17（畸形围栏取舍）** 与本任务无关，均未被触碰。

---

## 5. 验证命令与输出摘要

| 命令 | 输出摘要 |
|---|---|
| `npx vitest run src/hooks/useDocumentEditor.test.ts`（Step 2，红） | `Failed to resolve import "./useDocumentEditor"` / `Test Files 1 failed (1)` / `Tests no tests` |
| `node outputs/__audit_scratch/mutation_evidence.mjs` | 10 变异体全部 RED 如期，生存 0；`implementation restored OK` |
| `npx vitest run src/hooks/useDocumentEditor.test.ts`（绿） | `Test Files 1 passed (1)` / `Tests 9 passed (9)` |
| `npm test` | `Test Files 31 passed (31)` / `Tests 362 passed (362)` |
| `npx tsc --noEmit` | 无输出，退出码 0 |
| `git show --stat e82ba24` | 3 files changed, 305 insertions(+) |

临时文件：`outputs/__audit_scratch/mutation_evidence.mjs`、`.log`、`_pristine.ts` 已按规约删除；`git status` 中无 `outputs/**` 残留。工作树仅剩控制器派发前既有的未提交变更（`.pi/agents/*`、`docs/superpowers/plans/2026-09-10-vellum-block-editing.md`），本次未触碰。
