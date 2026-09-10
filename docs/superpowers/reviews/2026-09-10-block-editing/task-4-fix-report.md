# Task 4 修复轮 1/5 报告 — `useDocumentEditor` 状态机

- 分支：`master`，工作目录 `C:\Users\17445\Desktop\Vellum`
- 提交：**`db001e0`** — `fix(edit): 保存失败回退内存与提交口 mdlog 门禁（审查轮 1）`（单次提交，2 文件 / +182 −17）
- 修复范围：**C1（→裁定 F24）/ I2（→裁定 F25）/ M7（→裁定 F26）/ M8**；其余审查项（I3 / I4 / I5 / I6 / M9–M13）未动（不在本轮工作清单）。
- 应用技能：`executing-plans`（逐条 bite-sized 落实）+ `verification-before-completion`（每条结论附本轮新鲜输出）。`superpowers` 目录内确无 `test-driven-development` 技能（上轮已核），故按任务书自带红→绿流程执行。

---

## 1. 改动文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/hooks/useDocumentEditor.test.ts` | 修改（+138） | 新增可控父级 harness `useControlledEditor` + 4 条用例（失败回退顺序 / 重试不重复落盘 / 同内容重试仍落盘 / 提交口 mdlog 门禁） |
| `src/hooks/useDocumentEditor.ts` | 修改（+61 −17） | 失败路径先回退父级 markdown 再保留草稿+caret；`commitActive` 顶部 mdlog 门禁；`notifyInterrupted` 上移；`heavyDoc` 粘性注释 |

未触碰（按约束）：`src/lib/editUnits.ts`、`src/components/BlockEditor.tsx`、`src/components/MarkdownDocument.tsx`、`src/lib/rehypeEditUnits.ts`、`src/App.tsx`、Rust、样式。未直接 `invoke("save_document")`（`save` 仍由调用方注入）。无新依赖。

---

## 2. 逐条：审查缺陷 → 修法 → 红/绿证据

### C1（Critical）→ 裁定 F24：失败路径先回退内存

**缺陷**：`flushSync(() => onMarkdownChange(next))` 让父级同步吸收新 markdown ⇒ `units` 重推、`activeUnit` 指向**新文本的同名索引**；失败分支却按「旧索引语义 + 旧草稿」写回，三者不自洽 —— 结构变化时重复落盘，同内容时静默永不落盘。

**修法**（`src/hooks/useDocumentEditor.ts`，失败分支）：
```ts
const unitIndex = activeUnit.index;   // 提交前冻结
const caret = initialCaret;           // 顺带解 M8
...
} catch (error) {
  flushSync(() => onMarkdownChange(markdown));  // 先回退父级内存（内存不长期领先磁盘）
  setActiveUnitIndex(unitIndex);                // 再重激活同一块
  setDraft(draft);                              // 保留用户的修改文本
  setInitialCaret(caret);                       // 保留原点击 caret
  showToast(`保存失败：${String(error)}`);
}
```
不变量：**提交即落盘、落盘失败即回退**；重试时 `original` 与 `draft` 重新回到「同一份 markdown 的同一区间」比较，拼接口径自洽。

**红证据（改实现前，新增用例的失败原文）**：
```
× 保存失败：先把父级 markdown 回退，再保留草稿与 caret
  AssertionError: expected [ '# 标题\n\n改过的第一段。\n\n第二段。\n' ]
               to deeply equal [ '# 标题\n\n改过的第一段。\n\n第二段。\n', …(1) ]
  → onChange 只被调 1 次（缺「失败即回退」），父级 markdown 停留在 next
× 保存失败后再次提交：只落盘一次且内容不重复
  AssertionError: expected '# 标题\n\n改过的第一段。\n\n新段。\n\n新段。\n\n第二段。…'
               to be '# 标题\n\n改过的第一段。\n\n新段。\n\n第二段。\n'
  → 内容重复落盘（审查 C1(a)，探针结论在真实 harness 下复现）
× 保存失败后同内容重试仍会重新落盘，不静默吞掉
  AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times
  → 审查 C1(b)：永不落盘、无提示
Test Files 1 failed (1) | Tests 4 failed | 9 passed (13)
```
> 关键：新 harness `useControlledEditor` 让 `onMarkdownChange` **真的改写喂回 hook 的 markdown**（即真机 T6 接线语义）。固定 prop 的旧 harness 看不见 C1 —— 这正是上轮「9 用例全绿却有 Critical」的根因。

**绿证据**：`Tests 13 passed (13)`（详见 §3）。

**必须新增的三点断言**（均已成文于 `useDocumentEditor.test.ts`）：
1. `onChange.mock.calls.map(c => c[0]) === [next, 原 markdown]` —— 调用**两次且顺序为先 next 再原 markdown**；
2. `activeUnit?.index === 1` 且 `draft === "改过的第一段。"`（是用户修改文本，不是原文）；
3. 再次 `commitActive` 成功后 `save` 恰好被调 **2** 次（首次失败 1 次 + 重试 1 次），且 `calls[1][0] === calls[0][0]`、不含 `"新段。\n\n新段。"` —— 不重复落盘。

**M8 顺带解决**：`initialCaret` 在失败后被恢复（用例断言 `initialCaret === 5`；修复前 `closeActive()` 会清零且失败分支不写回）。

### I2（Important）→ 裁定 F25：提交口 mdlog 门禁

**缺陷**：门禁只在 `activateUnit` / `toggleView` 入口；「激活块 → 记录建立 → Ctrl+S / 失焦 / `toggleView`」会绕过并照常落盘。

**修法**（`commitActive` 开头，字面落实裁定）：
```ts
if (mdlogActive) {
  notifyInterrupted("记录已开始，编辑已取消");
  return;
}
```
同时把 `notifyInterrupted` 的 `useCallback` 定义**上移**到 `commitActive` 之前（消除 TDZ 依赖，纯顺序调整、无行为变化），并把 `mdlogActive` / `notifyInterrupted` 加入 `commitActive` 依赖数组。

**红证据**：
```
× 记录建立后提交被拦截：不落盘并取消编辑
  AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
    Array [ "# 标题\n\n改过的第一段。\n\n第二段。\n" ]
```
**绿证据**：该用例现绿 —— `save` 零调用、`onMarkdownChange` 零调用、`activeUnit` 为 `null`、toast 含「记录已开始」。

### M7 → 裁定 F26：`heavyDoc` 粘性（登记，不加复位逻辑）

按要求**只加注释、不加任何复位路径**：
```ts
// heavyDoc 有意保持粘性（裁定 F26）：它是「文档规模」属性而非瞬时值，
// 本会话内不回退 —— 观测到超阈值提交一次后即不再反复探测。
if (renderMs > heavyCommitMs) setHeavyDoc(true);
```
（无行为变更，故无独立红/绿；由既有用例「提交耗时超过阈值时挂出『文档较重』标记」继续锁住置位方向。）

### M8 已在 C1 内一并修复

见上：`const caret = initialCaret;`（提交前冻结）+ 失败分支 `setInitialCaret(caret)`。

---

## 3. 验证命令与真实输出（本轮新鲜执行）

| 命令 | 输出摘要 |
|---|---|
| `npx vitest run src/hooks/useDocumentEditor.test.ts`（**红**，改实现前） | `Test Files 1 failed (1)` / `Tests 4 failed \| 9 passed (13)`；四条失败断言原文见 §2 |
| `npx vitest run src/hooks/useDocumentEditor.test.ts`（**绿**，改实现后 + 提交后复跑） | `Test Files 1 passed (1)` / `Tests 13 passed (13)`（Duration 1.31s） |
| `npm test` | `Test Files 31 passed (31)` / `Tests 373 passed (373)`（8.41s） |
| `npx tsc --noEmit` | 无输出，`tsc exit=0` |
| `git show --stat HEAD` | `db001e0`，`src/hooks/useDocumentEditor.test.ts \| 138 +`、`src/hooks/useDocumentEditor.ts \| 61 ++--`，2 files changed, 182 insertions(+), 17 deletions(-) |
| `git status --porcelain` | 仅控制器派发前既有的无关变更（`.pi/agents/*`、`docs/superpowers/plans/...`）；`outputs/` 无 scratch 残留 |

基线 31 文件 / 369 用例 → **31 文件 / 373 用例**，增量恰为本轮 4 条新用例，无既有用例回归。测试文件用例数 9 → 13。

---

## 4. 与 spec / 计划 / 裁定的偏差说明

1. **新增测试 harness `useControlledEditor`（必要偏差）**：任务书要求「失败后 `onMarkdownChange` 被调两次…」等断言，而 C1 的两个故障分支**只在父级 markdown 真的前进时出现**。旧 harness（固定 prop + `vi.fn()` 不收值）无法暴露 C1，故新增一个局部 harness，把 `onMarkdownChange` 接成 `useState` setter 并喂回 hook —— 与 T6 真机接线语义一致。未改动任何生产代码接口。
2. **mdlog 门禁放在 `commitActive` 最顶部（字面执行裁定 F25）**：副作用是「阅读视图 + 记录中」按 Ctrl+S 也会弹一次「记录已开始，编辑已取消」（此时无活动块，`notifyInterrupted` 只弹 toast、不碰剪贴板/状态）。为不偏离裁定，本轮未加条件；建议 T6 在全局 Ctrl+S 处理器里加 `if (!editor.activeUnit) return;` 再调 `commitActive()`（登记为 T6 项，见 §5）。
3. **`notifyInterrupted` 定义上移**：仅为让 `commitActive` 引用它时无块级作用域前向引用，逻辑逐字不变（`git diff` 中表现为同一段代码的位置平移）。
4. **未改 `toDraftText` / 不引入共享 `toLf`**：审查 I6 建议从 `editUnits.ts` 导出共享归一函数，但该建议不在本轮工作清单（C1/I2/M7/M8），按「不扩大范围、YAGNI」不动。
5. **未动 I3（失败后 `toggleView` 仍切回 reading）**：同样不在本轮清单；本轮修复后失败态是「`viewMode` 可能为 reading + `activeUnit` 已重激活 + 草稿保留」，再按 Ctrl+E / 重新点击可继续重试，无数据风险。

---

## 5. 未解决项 / 关注点

1. **T6 需注意 mdlog 门禁的 toast 语义**（§4.2）：建议全局 Ctrl+S 先判 `activeUnit` 再调 `commitActive`，避免阅读视图下记录中按 Ctrl+S 出现无对象的「编辑已取消」。
2. **I3 仍未修**（`commitActive` 吞异常 ⇒ `toggleView` 失败后照样 `setViewMode("reading")`）：不在本轮范围。失败后草稿与 `initialCaret` 现在都保住了，UI 一致性问题（覆盖层消失但状态仍在编辑）留待后续轮次或 T6 决策。
3. **I4（`flushSync` 语境依赖消费者）/ I5（其余分支覆盖缺口，如 editing→reading、`notifyLocked("widget")`、`notifyInterrupted` 无活动块分支）**：均未动，属后续轮次范围。
4. **失败回退的代价**：裁定 F24 已登记「失败时用户会看到文本回退回改前（草稿仍在框里）」，真机可见性由 T8 手检确认。
5. **未跑 Rust 测试**：本轮零 Rust 改动（`cargo test` 不适用）。
6. **`heavyCommitMs: 0` 用例的时钟敏感性**（上轮已登记）仍未处理，本轮未扩范围。
