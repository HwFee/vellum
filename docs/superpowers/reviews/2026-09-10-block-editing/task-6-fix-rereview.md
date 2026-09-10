# Task 6 修复轮 1 复审报告 — 限定范围重审（`b700a86..46ed156`）

- 对象：修复提交 `46ed156`（diff 文件 `review-b700a86..46ed156.diff`，4 文件 / +443 −64）
- 方式：只读。**未修改任何文件**（`git status` 仅剩派发前既有改动：`kami.css`、`plans/*.md`、`.pi/agents/*`）
- 独立跑了：聚焦测试（2 文件 70 用例）、`grep`/`sed` 源码核对、`node -e` 复刻关窗递归语义（不落盘、纯内存）
- 未重跑整套（按派发约束），未跑 `cargo test`（本轮 `src-tauri/` 零改动，`git diff --stat` 可证）

---

## 逐条判定

### 1. C1 + I4 / F33 — **ADDRESSED**

**处理器与「不自行 close」**：`src/App.tsx:391-401` 只在 `current?.activeUnit` 存在时提交，`const cleared = await current.commitActive(); if (!cleared) event.preventDefault();`。全文再无 `close()`/`destroy()` 调用点：`grep -n "\.close()\|destroy()" src/App.tsx src/hooks/useDocumentEditor.ts` → **零命中**（exit=1）。F33.2 成立。

**「提交后看活动块是否真的清掉」的实现形态**：用 `commitActive(): Promise<boolean>` 的返回值（`src/hooks/useDocumentEditor.ts:125-134、170-186`），而非读 `editorRef.current?.activeUnit`。这是登记过的偏差 **D13**（`task-6-fix-report.md` §4-D13），方向正确：返回值由状态机自己在 `await` 之后给出（`return true` / 失败路径 `return false`），不依赖消费者侧渲染快照的跟进时机；且 `:128`（无块）、`:131-133`（mdlog 门禁）、无改动分支、落盘成功分支全部 `return true`，**只有落盘失败返回 false** ⇒ 不会多拦。我未能在不改文件的前提下实测「读 ref 的两向都错」，但该形态不依赖时序，属严格更安全的一侧，偏差可接受。

**测试替身真的回放 `closeRequested`**：`src/App.test.tsx:106` `close: vi.fn(() => windowMock.requestClose())`；`:54-65` `replay()` 等待全部处理器 resolve，`if (!prevented) mock.destroyed += 1`；`:75-79` `requestClose` 把递归关窗链入 `chain`，`:81-88` `settle()` 等到静止；`:37/56-58` 把死循环变成可断言的 `recursion`。与真机包装层一致（`node_modules/@tauri-apps/api/window.js:1632-1641`：`await handler(evt)` 之后才 `if (!evt.isPreventDefault()) await this.destroy()`）⇒ **晚到的 `preventDefault()` 生效**，`src/App.tsx:391-401` 的写法在真机可行。

**「落盘失败 ⇒ 不关窗」用例**：`src/App.test.tsx:2059-2083`。断言 `replays===1`、`recursion===false`、`destroyed===0`、`selfCloseCalls()===0`、`保存失败：磁盘只读` 可见、`blockEditorInput()?.value === "Body text edited."`（草稿仍在框里 = I4 覆盖）。

**旧实现下会红（无法重跑旧代码，故给出可复现的推理链 + 纯内存模拟）**：
- 推理链：新 mock 的 `close()` 会回放处理器，而旧实现（`git show 3f0b74a:src/App.tsx`）是「`preventDefault()` → `await commitActive()` → `void close()`」，落盘失败时 F24 重新激活同一块 ⇒ 下一次回放又看到活动块 ⇒ 再次拦截并 `close()` ⇒ 直到 `replays > MAX_REPLAYS` 判 `recursion`。
- 模拟（`node -e`，复刻 `App.test.tsx:54-88` 的 replay 语义 + 两种处理器，内存态 `activeUnit`）：

```
旧实现+落盘失败: {"replays":5,"destroyed":0,"recursion":true} | 新用例断言 replays=1 recursion=false
旧实现+成功保存: {"replays":2,"destroyed":1,...}（单次请求；新用例两次请求断言 replays=2 destroyed=2 ⇒ 旧实现为 3）
新实现+落盘失败: {"replays":1,"destroyed":0,"recursion":false}
```
⇒ 该用例对旧形态必然红，且新用例的断言与实现一致（我实跑聚焦测试亦全绿，见文末）。修复报告 §6 的 M-close-2 与我的模拟结论一致。

**成功路径用例**：`src/App.test.tsx:2027-2057`（无活动块 ⇒ 不拦截、包装层 destroy；有草稿 ⇒ 先落盘、`replays/destroyed` 各 2、`selfCloseCalls()===0`）。

### 2. I1 / F32 — **ADDRESSED**

`src/App.tsx:461-465`：`if (editorRef.current?.activeUnit) editorRef.current.notifyInterrupted("文件已被外部修改 · 编辑已取消");` —— 无活动块时静默热重载。新用例 `src/App.test.tsx:1845-1877`「mdlog 记录中外部追加：静默热重载，不弹「文件已被外部修改」」断言 `queryByText(...)` 为 null 且 `.editor-toast` 为 null，同时 `追加段。` 确实渲染（证明不是「什么都没发生」的空断言）。既有 `外部变更不误判为回声`（`:1924-1960`）被补上「重新激活一块并改草稿」的会话前提，避免该用例退化为恒真——这一点做得好。

### 3. I2 / F31 — **ADDRESSED**

- 2.4s 自动消失：`src/hooks/useDocumentEditor.ts:21` `TOAST_DURATION_MS = 2400`（与 spec §9「2.4s 自动消失」一致）；`:70-79` `showToast` 每次先 `clearToastTimer()` 再起新计时器（新增提示重置计时）。
- `dismissToast()`：`:63-66`，已从返回对象导出（`:224`），与自动消失共用清理路径。App 层未消费（T7/T8 接口登记项，非缺陷）。
- 用例用**假定时器真推进时间**：`src/hooks/useDocumentEditor.test.ts:265-286`（2399ms 仍在 / 2400ms 消失）、`:288-...`（新提示重置计时，2000+2000ms 后仍在、+400ms 消失）、`dismissToast` 用例（旧实现下 `TypeError: result.current.dismissToast is not a function`，具区分度）。
- **泄漏检查（我独立读码）**：`:83` `useEffect(() => clearToastTimer, [clearToastTimer])`（`clearToastTimer` 为 `useCallback([])`，引用稳定）⇒ 卸载时清掉未到期计时器，不存在 unmounted setState。多次 toast 由 `:73` 的 `clearToastTimer()` 清旧计时器，不累积。**注意**：该卸载路径**无用例锁定**（见「建议-3」）。

### 4. I3 / F30 — **ADDRESSED**

- `lastSavedMarkdownRef` **彻底删除**：`grep -rn "lastSavedMarkdownRef" src/` 仅命中 `src/App.test.tsx:1908` 的一句注释（说明旧实现为何会红），生产代码零残留；`saveMarkdown`（`src/App.tsx:502-507`）不再记录任何快照 ⇒ 无双判据。
- 回声判据改为磁盘（LF 归一）vs 内存（LF 归一）：`src/App.tsx:457-459`，两侧同表达式 `replace(/\r\n/g, "\n")`。
- 读内存走 ref 避免闭包过期：声明 `src/App.tsx:57`，渲染期写入 `:492`，读取 `:458`（监听 effect 只注册一次，`deps: []`，故必须经 ref）⇒ 读到的是最近一次已提交渲染的 markdown，且比对发生在 `await load_document` 之后，取到的是最新值。
- 推演「外部改成 E → 再改回 W」：① 磁盘 E ≠ 内存 W ⇒ 走外部分支 ⇒ `reloadCurrent` ⇒ 内存 = E；② 磁盘 W ≠ 内存 E ⇒ 走外部分支 ⇒ 内存 = W ⇒ 视图回到 W，与磁盘一致。旧固定快照（W）会在 ② 误判为回声而永久停在 E。该场景有专门用例：`src/App.test.tsx:1879-1926`，且末尾用 `queryByText("Body text from elsewhere.")` 为 null 做反向断言。**区分度核实**：`spliceUnit`（`src/lib/editUnits.ts:201-203`）纯切片拼接，`loadedDoc.markdown = "# Intro\n\n## Section\n\nBody text."` + 草稿 `Body text edited.` ⇒ 保存内容恰为 `"# Intro\n\n## Section\n\nBody text edited."`，与用例 ② 的 mock 磁盘内容逐字符相同 ⇒ 旧快照实现必然吞掉 ②、用例必红（与修复报告的红跑输出一致）。

### 5. Minor 1 / 2 / 3 / 5 — **全部 ADDRESSED**

- **Minor 1**：`src/hooks/useDocumentEditor.ts:195` `if (units.length === 0) return;`（在 mdlog 门禁之后、`setViewMode("editing")` 之前）。用例：hook `无块单元时不进入编辑视图`（旧实现红 `expected 'editing' to be 'reading'`）+ App `src/App.test.tsx:1784-1792`（无 `--editing` 类 + `aria-pressed="false"`）。
- **Minor 2**：`src/hooks/useDocumentEditor.ts:128` `if (!activeUnit) return true;` 提到 mdlog 门禁之前。用例：hook `记录中且无活动块时提交是 no-op，不弹提示` + App `src/App.test.tsx:1763-1781`（`fireEvent.keyDown(...) === false` 仍吞默认、无 toast、`save_document` 零调用）。**不回归**：有活动块时 F25 门禁照旧弹提示（`src/hooks/useDocumentEditor.ts:131-133`），既有 `记录建立后提交被拦截` 用例仍绿。
- **Minor 3**：`src/App.tsx:758-769`，编辑视图分支只 `toggleView()` 后 `return`；非编辑视图**且确有活动块**才提示；两者皆无则静默。结构性证据：该 effect 内 `notifyInterrupted` 调用点从旧实现的「无条件 1 处」变为「条件 1 处」，编辑视图路径的提示由 hook 的提交口门禁（`useDocumentEditor.ts:131-133`）唯一提供 ⇒ 同批双写消失。（jsdom 观测不到批处理内的中间态，属实现局限；修复报告 D15 已诚实登记。）
- **Minor 5**：`src/App.test.tsx:1758` 改为 `expect(document.querySelector("[data-vellum-unit]")).toBeNull();` 再做点击断言。这确实可区分：`:1686` 的正向用例证明非记录态下 `[data-vellum-unit]` 会挂载，故「未挂载」是门禁造成的事实，而非恒真。

### 6. 新破坏检查（仅限本 diff）

- **删快照后「首次打开就提交」是否误判回声**：误判只可能发生在「磁盘内容 == 内存内容」。此时磁盘与所显示的文档逐字节相同（LF 归一口径下亦无 EOL/BOM 语义差异；后续落盘的 EOL 由 Rust 侧 `dominant_eol` 重新检测，`docs/.../design.md:157-160`），故**不可能把有观察效果的变更吞掉**，最坏是跳过一次无效果的热重载。**未发现误吞真实变更的路径。**
- **`toggleView` 加「有单元才进编辑」后空文档无法新建内容**：确认无回归。`buildEditUnits("") === []`（hook 用例断言 `units` 长度 0；`src/lib/editUnits.test.ts` 有「空文档返回空数组」），旧实现虽能进入 `editing` 视图，但 `units = []` ⇒ 正文不挂 `data-vellum-unit`、无块可点 ⇒ **同样无法新建任何内容**，只是白挂 `--editing` 类与顶栏按下态。且全仓无「新建/Untitled」流程（`task-5-fix-rereview.md:43` 的检索结论 + 本任务 brief 无新建步骤），本产品定位是「轻量修补既有块」（`design.md:19-27`：非目标含结构重排）。⇒ **本项属预期，非破坏**。
- **`toast` 定时器与 `flushSync` 交互是否引入 React 警告**：`npx vitest run src/App.test.tsx src/hooks/useDocumentEditor.test.ts 2>&1 | grep -in "warn|error|act(|not wrapped|same key"` → **零输出**（含落盘失败路径 `flushSync` 回退 + `showToast`，`src/App.test.tsx:2059-2083` 实跑通过）。计时器清理见 `useDocumentEditor.ts:83`；不存在 setState on unmounted。`src/App.tsx:861/868` 的兄弟 `key={reloadTick}` / `key={toast.id}` 重复 key 警告在本轮跑中未再出现，且与本 diff 无关（未改这些行）。

---

## 新破坏

1. **【应当修复 · 测试有效性】既有用例 `layout effect arbitrates scroll on hot reload even when markdown content is unchanged (via reloadTick)`（`src/App.test.tsx:1257-1290`）在 F30 之后退化为恒真通过。** 该用例靠 `file-changed` 触发 `reloadTick` 来验证布局 effect 的滚动仲裁；F30 后 `src/App.tsx:457-459` 对「磁盘 == 内存」整体早退，状态零变化 ⇒ effect 根本不运行 ⇒ 即使删掉仲裁逻辑该用例依然绿（`scrollTop` 自然保持 250）。这不是「为变绿而放水」，但是本 diff 的行为变更造成的**覆盖真空**（修复报告 D14.2 / U3 已登记）。修复与该用例同名的真实路径只剩「同路径重开」（`src/App.tsx:223` → `reloadCurrent`），而既有同路径重开用例（`src/App.test.tsx:1625-1668`）只断言 iframe 不重建，不涉及滚动仲裁 ⇒ 该守卫目前**无有效用例**。
   建议：把用例改为经 `file-changed` 注入真实内容差异（或经同路径重开）来产生 `reloadTick`，并断言仲裁效果。
2. **【建议】F30 在途窗口的极窄残余**：`commitActive` 在 `await save` 期间内存已领先磁盘（`src/hooks/useDocumentEditor.ts:170-172`，`flushSync` 早于 `await save`），若此刻恰有无关的 `file-changed` 到达，`src/App.tsx:454-466` 会读到旧盘内容 ≠ 新内存 ⇒ `reloadCurrent` 把内存回退为旧内容（此时 `activeUnit` 已清、不弹提示）；随后我方写入的 watcher 回声（磁盘新 / 内存旧）会自愈。真正有损失需要用户在这个几毫秒的窗口内再提交另一块（以旧内存为基底拼接）。F30 裁定已明示接受此代价（「最多多一次热重载，无数据损失」），故不阻断；登记给 T8 手检即可。
3. **【建议】关窗处理器的异常分支**：`src/App.tsx:396` 若 `commitActive()` 抛出（例如 `spliceUnit`/`onMarkdownChange` 意外抛错），`await handler(evt)` 会 reject，包装层（`node_modules/@tauri-apps/api/window.js:1634-1640`）的 `destroy()` 被跳过 ⇒ 窗口**不关也不拦**（安全方向）但用户此后无法用关闭按钮退出，且产生未处理 rejection。可达性极低（`save` 的异常已在 hook 内 catch），可加 `try { ... } catch { event.preventDefault(); }` 作防御。
4. **【建议】`selfCloseCalls()` 的语义与注释不完全一致**（`src/App.test.tsx:1698-1704`）：它累加**所有** `getCurrentWindow()` 实例的 `close` 调用，而 mock 每次调用都新建实例（`:105-118`），TopBar 的 ✕（`src/components/TopBar.tsx:127-134`）也在其中。当前两条关窗用例不经 UI 按钮，故 `=== 0` 成立；但若日后有用例点击 ✕ 并沿用该助手，会得到「App 自己 close 了」的假阳性。建议改名（如 `windowCloseCalls()`）或只统计 App 触达的实例。
5. **【建议】`editor-toast` 的 2.4s 自动消失与「断言 toast 存在」的真实计时器用例之间存在轻微 flake 风险**（如 `src/App.test.tsx:1960`、`:2081`）：waitFor 等文档渲染若在极慢环境下超过 2.4s，提示已自动消失会导致假红。可在这些用例内用假定时器或把断言前置。

## 范围外观察（不在本轮清单，按范围纪律未计入判定）

- `editorRef.current = editor` 仍在渲染期赋值（`src/App.tsx:508` 附近，上一轮 Minor 6，本轮未改）；`currentMarkdownRef.current = ...`（`:492`）沿用同一形态。两者的读点都在 effect/事件之后，实际影响低，但并发渲染下「被丢弃的渲染留下未提交值」这一形态仍存在。D13 已让 A 侧关窗判定不再依赖它。
- mdlog 变活跃边沿在「编辑视图但无活动块」时：`src/App.tsx:762-765` → `toggleView` → `commitActive`（`useDocumentEditor.ts:128` 无块短路）⇒ 静默退出编辑视图，**一条提示也没有**。口径上与 F32/新 Minor 3 一致（无编辑会话不提示），但用户是被动退出编辑态，提示缺失见 Minor 3 的取舍；建议 T8 真机看观感。
- `src/App.tsx:861/868` 的兄弟 key（`reloadTick` 与 `toast.id` 同为 `1`）在 `3f0b74a` 即存在，非本轮引入；本轮跑未观测到 React 重复 key 警告。
- 未复核整套 31 文件 / 394 用例与 `npm run build`（按派发约束只跑聚焦）；本 diff 不涉 `src-tauri/`、`kami.css`、`MarkdownDocument.tsx`、`rehypeEditUnits.ts`，故 DESIGN.md（色板/字重/圆角/无 emoji）与 AGENTS.md 性能结构约束（`MarkdownBody` props 稳定、`search-match--current`、PrismLight、katex 管线、`components` `useMemo`）均未被本 diff 触碰，抽查 `src/App.tsx` 新增代码无 emoji、无新色值、无 CSS 改动，符合。

---

## 结论

**All findings addressed:** Yes

**Reasoning:** C1/I4/F33（关窗失败不关窗、成功路径不自 close、mock 回放 `closeRequested` + 失败用例）、I1/F32、I2/F31、I3/F30 与 Minor 1/2/3/5 均已按裁定落实并有可区分的新用例（我用 `node -e` 复刻新 mock 的 replay 语义，确认旧实现在「落盘失败」用例下 `replays=5 / recursion=true`，必然红）；F30 唯一的连带代价是既有 `reloadTick` 滚动仲裁用例退化为恒真（已登记 U3，列为应当修复的测试覆盖真空，不阻断），另 4 条建议均为稳健性/命名/潜在 flake 层面，无数据损失或门禁绕过。

---

## 我实际跑过的命令与输出摘要

| 命令 | 输出 |
|---|---|
| `npx vitest run src/App.test.tsx src/hooks/useDocumentEditor.test.ts` | `Test Files 2 passed (2)` / `Tests 70 passed (70)` / `Duration 5.24s` |
| 同上 `2>&1 \| grep -in "warn\|error\|act(\|not wrapped\|same key"` | **无输出**（无 React 警告 / act 警告 / 重复 key 警告） |
| `node -e '<复刻 App.test.tsx:54-88 的 replay + 新旧处理器>'` | `旧实现+落盘失败: {"replays":5,"destroyed":0,"recursion":true}`；`新实现+落盘失败: {"replays":1,"destroyed":0,"recursion":false}` |
| `grep -n "\.close()\|destroy()" src/App.tsx src/hooks/useDocumentEditor.ts` | 零命中（exit=1）⇒ 生产代码不自行 close/destroy |
| `grep -rn "lastSavedMarkdownRef" src/` | 仅 `src/App.test.tsx:1908` 注释 |
| `sed -n '1616,1641p' node_modules/@tauri-apps/api/window.js` | `onCloseRequested` 包装层：`await handler(evt)` → `if (!evt.isPreventDefault()) await this.destroy()` ⇒ 晚到 `preventDefault` 生效 |
| `git diff --stat b700a86 46ed156` | 4 files changed（`src/App.tsx`、`src/App.test.tsx`、`src/hooks/useDocumentEditor.ts(+test)`）⇒ 无 Rust / CSS 改动 |
| `git status --porcelain` | 仅派发前既有改动（`kami.css`、`plans/*.md`、`.pi/agents/*`），无本任务残留 |
| `grep`/`awk` 定点读 `src/App.tsx:391-401/457-465/492/758-769`、`src/hooks/useDocumentEditor.ts:21/55-83/125-195`、`src/App.test.tsx:36-118/1257-1290/1698-1704/1758/1763-1792/1845-1926/2027-2083` | 逐条证据见上文 |
