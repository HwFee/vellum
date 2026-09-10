# Task 4 修复轮 1 重审 — `useDocumentEditor`（限定范围）

- 被审 diff：`review-0ab2e1c..db001e0.diff`（base `0ab2e1c` → head `db001e0`），**仅 2 文件**：`src/hooks/useDocumentEditor.ts`、`src/hooks/useDocumentEditor.test.ts`（`git diff --stat 0ab2e1c..db001e0` = 2 files changed, 182 insertions(+), 17 deletions(-)，与 diff 包头部一致）。
- 工作树 == 待审 head：`git diff db001e0 -- <这两文件>` 输出为空；`git log --oneline -3` 显示 HEAD = `db001e0`。
- 只读：未修改任何文件、未派发子智能体；未跑整套测试（按控制器指示），仅跑聚焦文件 + `tsc`。

---

## 逐条判定

### 1. C1 / F24（失败即回退内存）— **ADDRESSED**

- **先回退再重激活**：`src/hooks/useDocumentEditor.ts:124` `flushSync(() => onMarkdownChange(markdown))`，随后 `:125` `setActiveUnitIndex(unitIndex)`、`:126` `setDraft(draft)`、`:127` `setInitialCaret(caret)`。回退值是**本次提交前**的快照：`unitIndex`/`caret` 在提交前冻结（`:105-106`），`markdown`/`draft` 是该次 `commitActive` 闭包中的 prop/state（`:90` 起的 `useCallback`）。
- **三项断言全在**（`src/hooks/useDocumentEditor.test.ts`）：
  1. 两次调用 + 顺序：`:172` `expect(onChange.mock.calls.map((c) => c[0])).toEqual([changed, markdown])` —— `toEqual` 对数组同时锁长度，故「先 next 再原 markdown、恰好两次」都被断言；
  2. `draft` 保留用户文本：`:177` `draft === "改过的第一段。"`（非原文「第一段。」），`:176` `activeUnit?.index === 1`；
  3. 重试只多一次 `save`：`:198`（首次 = 1 次）→ `:204`（重试后 = 2 次），`:205` `save.mock.calls[1][0]).toBe(firstCommit)` 精确等值、`:206` 不含 `"新段。\n\n新段。"`（不重复落盘）。
- **我自己的「块结构变化（删除空行 / 合并段落）」失败推演**（按 `src/lib/editUnits.ts:182-206` 的区间语义手推，markdown = `"# 标题\n\n第一段。\n\n第二段。\n"`，units = 0[0,4) / 1[6,10) / 2[12,16)）：
  - 合并型：激活 index 1，草稿 `"第一段。\n第二段。"` ⇒ 首次 `next = slice(0,12) + 草稿 + slice(16)`，`save` 拒绝 ⇒ `:124` 回退到**逐字节相同**的原 markdown ⇒ `units` 重推（`:42-44` `useMemo(..., [markdown])`，纯函数）后 index 1 仍 = [6,10)=`"第一段。"` ⇒ 重试 `original="第一段。"` ≠ `draft` ⇒ 再次 `spliceUnit(原 markdown, unit1, draft)` 得到与首次**完全相同**的 `next` ⇒ 只落盘一次、无重复。**不会重复落盘。**
  - 删空行至块数变少（极端）：清空**最后一块**的草稿会让 `next` 只剩 2 块（index 2 不存在）。修复前 `:125` 的索引会在新 units 上解析为 `null` ⇒ 卡在 `:97 if (!activeUnit) return;` **静默永不落盘**；修复后因父级被回退，index 2 在原 units 中重新存在 ⇒ 重试可落盘。**不会永不落盘。**
  - 唯一前提：消费者的 `onMarkdownChange` 必须真的把回退值写回、喂回 hook 的 `markdown`（T6 契约）。测试 harness `useControlledEditor`（`:12-35`）正是该语义（`setMarkdownText(next)`），这也是上一轮「9 绿却有 Critical」的原因。
- 与 spec/简报接口面：本 diff **未改**导出类型与返回对象字段（仅注释 + 内部逻辑），无规格偏离。

### 2. I2 / F25（提交口 mdlog 门禁）— **ADDRESSED**

- 门禁是 `commitActive` 的**第一段**逻辑：`src/hooks/useDocumentEditor.ts:93-96`，先于 `:107 spliceUnit`、`:111 flushSync(onMarkdownChange)`、`:119 await save(next)`，也先于 `:97 if (!activeUnit) return;`（因此无活动块时也不会漏门禁）。字面即裁定 F25 的写法 `if (mdlogActive) { notifyInterrupted("记录已开始，编辑已取消"); return; }`。
- 用例 `src/hooks/useDocumentEditor.test.ts:238-261`（激活块 → `setMdlogActive(true)` → 提交）：`:257 save 零调用`、`:258 onChange 零调用`（顺带证明没有走到 `spliceUnit/flushSync`）、`:259 activeUnit 为 null`、`:260 toast 含「记录已开始」`。

### 3. M8（失败后 `initialCaret` 回到原点击位置）— **ADDRESSED**

- `src/hooks/useDocumentEditor.ts:106` 提交前冻结 `const caret = initialCaret;`，`:127` 失败分支 `setInitialCaret(caret)`（且在 `closeActive()` 清零之后写回，顺序正确）。
- 用例 `src/hooks/useDocumentEditor.test.ts:162` `activateUnit(1, 5)` → `:178` `expect(initialCaret).toBe(5)`。

### 4. M7 / F26（`heavyDoc` 粘性，不加复位）— **ADDRESSED**

- **没有**任何复位逻辑：`grep -n "heavyDoc\|setHeavyDoc" src/hooks/useDocumentEditor.ts` → `40:` 声明、`113-114:` 注释、`115: if (renderMs > heavyCommitMs) setHeavyDoc(true);`、`175:` 返回字段 —— 只有一处写、无第二处 set/reset。
- 粘性理由已写进注释：`:113-114`「heavyDoc 有意保持粘性（裁定 F26）：它是『文档规模』属性而非瞬时值，本会话内不回退 —— 观测到超阈值提交一次后即不再反复探测。」
- 未加复位 ⇒ 与裁定一致，未偏离。

---

## 新破坏（仅限本修复 diff）

**N1（建议，需并发/重入才触发）— 回退写入无「版本校验」，可覆盖比本次提交更新的内存态**
`:124 flushSync(() => onMarkdownChange(markdown))` 无条件把闭包旧快照写回父级。若父级 `markdown` 在「`:111` 已 flush → `save` 失败」窗口内被改写（同 tick 的外部变更 / 长 `save` 期间热重载），更新的内容会被旧快照覆盖；叠加**未修的 M10**（同批两次 `commitActive`，第二次仅多一次 `save`）时，第二次失败会把**第一次已成功提交**的内存态一并回退（磁盘上第一次已落盘 ⇒ 内存落后于磁盘，用户重试会以旧文本为基础再写一次）。
硬化建议（一行级）：回退前用 ref 记录 `next`，仅当 `markdownRef.current === next` 时才 `onMarkdownChange(markdown)`；或把回退配对成「只撤本次的那次写入」。注：成功路径 `:111` 本来就无条件写 `next`，同类风险先前已存在，故本轮列**建议**而非驳回理由。

**N2（建议）— 失败路径整篇重解析翻倍**
`:111` 与 `:124` 两次 `flushSync` 各触发一次整篇重解析；重文档（正是 `heavyDoc` 存在的理由）下失败时卡顿翻倍。属裁定 F24 设计内代价，建议 T8 手检一次。

**其余三项新破坏嫌疑，排查后不成立（给出依据）**：
- **「回退会不会把用户其他已成功的提交一并回退」**：单飞路径**不会**。回退值 `markdown` 是这次 `commitActive` 闭包中的 prop；上一次成功提交后父级重渲染、闭包重建、`markdown` 已含上次结果（`src/hooks/useDocumentEditor.ts:136` 依赖含 `markdown`）。`test.ts:172` 的第二次写入恰为原 markdown（而非更早的初值）亦一致。**但该性质目前无用例锁定**（见「建议 T-1」），过退回仅在 N1 的条件下出现。
- **「回退后重新激活的 index 是否仍指向同一个块」**：是。回退值与原 markdown 逐字节相同，`buildEditUnits` 是纯函数且索引按排序后位置重排（`src/lib/editUnits.ts:205-206`），故 index→区间映射逐字重建；`test.ts:205 save.mock.calls[1][0]).toBe(firstCommit)` 是间接实证（若区间漂移，拼接串必然不同）。`:125` 虽绕过 `activateUnit` 的 `editable` 守卫，但回退后该块就是提交前那个本来可编辑的块，无实际风险。
- **「门禁分支清空活动块 ⇒ 草稿被静默丢弃」**：与裁定 F25 的**字面与意图一致**（裁定原文即要求调用 `notifyInterrupted("记录已开始，编辑已取消")`），不是偏离；且不是「静默」——`:83-85` 尽力写剪贴板 + toast 明说「编辑已取消」。但兜底强度存疑：jsdom 下 `navigator.clipboard === undefined`（用例走可选链短路，**未断言**剪贴板被调用），WebView2 下 `writeText` 也可能因权限/焦点/安全上下文静默 reject（`.catch(() => {})` 吞掉）⇒ 记录建立瞬间用户正在打字的文本**可能实际丢失**。列**建议**（T8 手检；或把文案改为「草稿已复制到剪贴板（如可用）」），不作偏离判定。

---

## 范围外观察（不在本轮范围，仅登记）

- **I3 / I4 / I5 / I6 / M9–M13** 均未动：`toggleView` 在失败后仍 `setViewMode("reading")`（`:151-152`，`commitActive` 吞异常）；其余覆盖缺口、`flushSync` 语境依赖、`toDraftText` 双份实现照旧。实施者报告 §4.5/§5 已自行登记。
- **F26 的第二半要求**「在 T8 验收里写明」在本 diff 不可见（grep 计划/T8 文本未见 `heavyDoc` 粘性条目，仅 `rulings.md:244` 有裁定文本）—— 属 T8 职责，非本轮阻断项。
- 报告的 `npm test` 31 文件 / 373 用例、`tsc` exit 0 中，我只独立复核了 `tsc`；整套测试按控制器指示未复跑。
- 红证据可复核性：`git show e82ba24:src/hooks/useDocumentEditor.ts` 显示旧实现确无门禁、失败分支为 `setDraft(draft); setActiveUnitIndex(activeUnit.index)`（无回退），与报告引用的四条红断言（缺第二次 onChange / 出现 `新段。\n\n新段。` / `save` 只调 1 次 / `save` 被调 1 次）逻辑一致 —— 红不是伪造。

### 建议（不阻断）

- **T-1**：补一条「先成功提交 A → 再编辑 B 失败 ⇒ 断言回退值是 A 而非初始 markdown」的用例，把 N1 的单飞不变量锁进测试。
- **T-2**：`test.ts:206 not.toContain("新段。\n\n新段。")` 与 `:205 toBe(firstCommit)` 冗余（后者已精确），可留作可读性。

---

## 命令与真实输出摘要

| 命令 | 输出摘要 |
|---|---|
| `git log --oneline -3` | `db001e0 fix(edit): 保存失败回退内存与提交口 mdlog 门禁（审查轮 1）` / `0ab2e1c` / `e82ba24` |
| `git diff db001e0 -- src/hooks/useDocumentEditor.{ts,test.ts}` | 无输出（工作树与待审 head 一致） |
| `git diff --stat 0ab2e1c..db001e0` | `2 files changed, 182 insertions(+), 17 deletions(-)`（仅两个 hook 文件） |
| `grep -n "heavyDoc\|setHeavyDoc" src/hooks/useDocumentEditor.ts` | `40` / `113,114`(注释) / `115`(唯一写入) / `175` ⇒ 无复位路径 |
| `grep -n "" src/hooks/useDocumentEditor.ts \| sed -n '78,140p'` | 行号证据：门禁 `93-96`、冻结 `105-106`、`spliceUnit 107`、`flushSync 111`、`save 119`、回退 `124`、重激活 `125-127` |
| `grep -n 'it("' src/hooks/useDocumentEditor.test.ts` | 13 条用例，新增 4 条在 `154 / 182 / 211 / 238` |
| `npx vitest run src/hooks/useDocumentEditor.test.ts` | `Test Files 1 passed (1)` / `Tests 13 passed (13)` / Duration 1.34s，**无 console/React 告警**（`flushSync` 在 await 后续接中的调用未触发告警） |
| `npx tsc --noEmit` | 无输出，`tsc exit=0`（新 harness 类型合格） |
| `npm test`（整套） | **未执行**（按控制器指示不重跑整套） |
| `cargo test` | 未执行（本 diff 零 Rust 改动） |

---

## 结论

**通过** —— C1/F24、I2/F25、M8、M7/F26 四条全部 ADDRESSED，且 F24 的修复对「合并段落 / 删空行」两类结构变化失败场景均成立（不重复落盘、不静默永不落盘，已手推 + 用例实证）；新增 4 条用例真断言、红证据可由 `e82ba24` 旧实现复核；`tsc` 干净、聚焦用例 13/13 绿、无 React 告警。新破坏仅剩两条建议级（回退缺版本校验的并发窗口 N1、失败路径双整篇重解析 N2），均不构成本轮驳回理由。

**All findings addressed:** Yes
**Reasoning:** 四条待判定缺陷逐条落实且各有真断言锁定（含重试后只多一次 `save`、门禁零落盘、caret/草稿保留、heavyDoc 无复位 + 粘性注释）；新增风险仅为条件性并发回退覆盖与性能代价，属建议级登记。
