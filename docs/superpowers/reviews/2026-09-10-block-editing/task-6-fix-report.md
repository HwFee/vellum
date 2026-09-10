# Task 6 修复轮 1 报告 — `App` 接线（C1 / I1 / I2 / I3 + Minor 1/2/3/5）

- **状态**：完成（审查 5 条 + Minor 4 条全部落实；红→绿与变异体证据见 §2/§6）
- **提交**：`46ed156` — `fix(edit): 关窗失败不关窗与回声判据改为内存比对（审查轮 1）`（**单次提交**，父提交 `b700a86`）
- **测试结论**：`npm test` → **31 文件 / 394 用例全绿**（本轮基线 384，净增 10 = App 5 + hook 5）；`npx tsc --noEmit` → 无输出（exit 0）；`npm run build` → 成功（2.14s）
- **未涉及 Rust**：`git show --stat HEAD` 的 4 个文件全在 `src/`（`src-tauri/` 零改动），故未跑 `cargo test`
- **临时文件**：未创建任何探针文件（`outputs/__audit_scratch/` 不存在）；变异实验全部用就地改 + 立刻还原，终态 `grep -rn MUTATION src/` 无命中

---

## 1. 改动文件清单

| 文件 | +/− | 内容 |
|---|---|---|
| `src/App.tsx` | +41 / −20 | 删 `lastSavedMarkdownRef`、加 `currentMarkdownRef`；回声判据改内存比对（F30）；中断提示加活动块门禁（F32）；关窗处理器改为「提交后按结果拦截、成功路径不自行 `close()`」（F33）；mdlog 边沿 effect 去重（Minor 3） |
| `src/hooks/useDocumentEditor.ts` | +52 / −9 | `toast` 2.4s 自动消失 + `dismissToast()`（F31）；`commitActive` 先短路无活动块（Minor 2）并返回「会话是否已收起」（F33）；`toggleView` 在 `units.length === 0` 时不进编辑视图（Minor 1） |
| `src/App.test.tsx` | +240 / −57 | window mock 按真机语义重写（`close()` 回放 `closeRequested`、未拦截则 destroy、递归可断言）；关窗两条用例重写/新增；F30/F32/Minor 1/Minor 2 各新用例；Minor 5 恒真断言改真断言；F32 相关既有用例补「编辑进行中」会话；P5 步骤按 F30 调整内容差异 |
| `src/hooks/useDocumentEditor.test.ts` | +88 / −0 | 5 条新用例：toast 自动消失、计时重置、`dismissToast`、记录中无活动块提交静默、无块单元不进编辑视图 |

未改动：`src-tauri/**`、`src/styles/kami.css`（T7）、`src/lib/editUnits.ts`、`src/components/MarkdownDocument.tsx`、`src/lib/rehypeEditUnits.ts`、`src/components/TopBar.tsx`。无新增依赖。

---

## 2. 逐条：审查缺陷 → 修法 → 红/绿证据

### C1 + I4（Critical + Important）→ 裁定 F33：关窗失败不得关窗、成功路径不自行 `close()`

**修法**（`src/App.tsx:382-400`）：

```tsx
const closeUnlisten = await getCurrentWindow().onCloseRequested(async (event) => {
  const current = editorRef.current;
  if (!current?.activeUnit) return;
  const cleared = await current.commitActive();   // 提交结果即「活动块是否真的清掉」
  if (!cleared) {
    event.preventDefault();                       // 落盘失败：保持窗口打开，草稿留在框里
  }
});
```

- 删掉了「先 `preventDefault()` → `commitActive()` → 自行 `close()`」的全部三段：成功路径**不拦也不 close**，窗口销毁交给 JS 包装层（`onCloseRequested` 会 `await handler(evt)`，然后 `if (!evt.isPreventDefault()) await this.destroy()`，见 `node_modules/@tauri-apps/api/window.js:1632-1641`）——因为包装层是 await 处理器后才判定的，**晚到的 `preventDefault()` 依然生效**，所以「按提交结果再决定拦不拦」是可行且无循环的。
- 读者对照：`@tauri-apps/api/window.d.ts:745`（`close()` 会发出可拦截的 `closeRequested`）、`:756`（`destroy()` 不发事件）；`close()` 在真机会重入同一处理器 —— 这就是 C1 循环的机制。
- **偏差（见 §4-D13）**：判定条件用 `commitActive()` 的**返回值**而不是 `editorRef.current?.activeUnit`。原因有实测证据（见下「预期形态的实测反向结果」）：App 侧 `editorRef` 是**上一轮渲染的快照**，在 `await` 之后可能尚未跟进，两个方向都会错。

**子问题 I4（草稿静默丢失）**：同一条修法覆盖 —— `cleared === false` ⇒ 拦下关闭，草稿与失败提示都留在窗内。

**测试替身补全（Minor 4）**：`src/App.test.tsx:26-115` 的 window mock 按真机语义重写：

```tsx
async replay() {                        // 处理器全部 resolve 后，无人 preventDefault ⇒ destroy
  mock.replays += 1;
  if (mock.replays > 4) { mock.recursion = true; return; }   // 把死循环变成可断言的失败
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  for (const handler of [...mock.closeHandlers]) await handler(event);
  if (!prevented) mock.destroyed += 1;
}
```
`getCurrentWindow().close` = `vi.fn(() => windowMock.requestClose())`（回放处理器）、`destroy` 计数、`instances` 供断言「App 自己从不 close()」。

**红 → 绿证据（三条链，全部真实输出）**

| # | mock 语义 | 实现 | 命令 | 结果 |
|---|---|---|---|---|
| ① 逃逸 | 旧（`close: vi.fn()`，3f0b74a 原样） | 旧（`preventDefault → commit → close()`） | `npx vitest run src/App.test.tsx -t "落盘失败"` | **`Tests 1 passed \| 51 skipped (52)`** —— C1 用例在旧 mock 下**绿**（缺陷不可见，正是它逃逸的原因） |
| ② 红 | 真机语义（本次新增） | 旧 | `npx vitest run src/App.test.tsx -t "关窗"` | **`Tests 2 failed \| 50 skipped`**；「关窗请求…」`expected 5 to be 2`（`replays` 触到递归上限 5）、「落盘失败…」`expected 2 to be 1`（同一 `closeRequested` 被二次进入） |
| ③ 绿 | 真机语义 | 修复后 | 同上 | **`Tests 2 passed \| 50 skipped (52)`** |

**预期形态（读 `editorRef.current?.activeUnit`）的实测反向结果**：在 ② 的同一套真机语义 mock 下，用「`await commitActive(); if (editorRef.current?.activeUnit) preventDefault()`」实现时两个用例都红、且**方向相反**：
- 「关窗请求…」`expected 1 to be 2`（`destroyed`）—— 成功路径读到**未跟进的旧值**（仍非 null）⇒ 误拦 ⇒ 窗口永不销毁；
- 「落盘失败…」`expected 1 to be 0`（`destroyed`）—— 失败路径读到**未跟进的旧值**（null）⇒ 未拦 ⇒ 窗口照样关、草稿丢失。

这正是改用 `commitActive(): Promise<boolean>` 的依据：判定必须来自状态机自身，而不是消费者侧的渲染快照。新增用例 `关窗请求…` / `关窗时落盘失败…` 同时对**新旧两种错误形态**发红（旧形态见 §6 变异体 M-close-1/2）。

### I1 → 裁定 F32：只在确有编辑会话被中断时提示

**修法**（`src/App.tsx:458-466`）：

```tsx
if (editorRef.current?.activeUnit) {
  editorRef.current.notifyInterrupted("文件已被外部修改 · 编辑已取消");
}
await reloadCurrent(latest);
```

**红**（实现前）：`npx vitest run src/App.test.tsx` → `× mdlog 记录中外部追加：静默热重载，不弹「文件已被外部修改」（裁定 F32）`，输出 `expected <div class="editor-toast" …>记录已开始/文件已被外部修改 · 编辑已取消</div> to be null`。
**绿**：修复后该用例通过（mdlog 常态追加路径只热重载、无 toast）。
**反证（变异体）**：把门禁改回无条件调用 ⇒ 该用例 `1 failed`（`AssertionError: expected <div class="editor-toast" …(1)></div> to be null`）。

### I2 → 裁定 F31：`toast` 自动消失 + `dismissToast()`

**修法**（`src/hooks/useDocumentEditor.ts:21、55-83`）：`TOAST_DURATION_MS = 2400`；`showToast` 每次先 `clearToastTimer()` 再起新计时器（新增提示重置计时）；新增 `dismissToast()`；卸载时清计时器。App 渲染不变（仍 `key={editor.toast.id}`）。

**红**：`npx vitest run src/hooks/useDocumentEditor.test.ts` → `Tests 5 failed | 13 passed (18)`，其中
- `× 提示条 2.4 秒后自动消失`：`expected { id: 1, message: 'HTML 区块为只读' } to be null`（推 2400ms 后仍非 null）
- `× 新提示重置计时：每条提示都看满 2.4 秒`：`expected { id: 2, message: '交互块只读，点击可交互' } to be null`
- `× dismissToast 立即清掉提示`：`TypeError: result.current.dismissToast is not a function`

**绿**：修复后 18/18 通过（两条假定时器用例分别覆盖「正常消失」与「重置计时」）。

### I3 → 裁定 F30：删 `lastSavedMarkdownRef`，判据改为「磁盘 vs 当前内存 markdown」

**修法**：删除 `lastSavedMarkdownRef`（`grep -n lastSavedMarkdownRef src/App.tsx` 现已零命中）；新增 `currentMarkdownRef`（每次渲染写入最新 `activeDocument.markdown`，`src/App.tsx:492`）；`reloadIfExternal` 改为

```tsx
const normalized = latest.markdown.replace(/\r\n/g, "\n");
if (normalized === currentMarkdownRef.current.replace(/\r\n/g, "\n")) {
  return;   // 磁盘与内存一致：无变更可热重载，整体忽略
}
```
判据不依赖任何赋值时机、无需要失效的快照（子问题 a 的「外部改成 E 再改回 W 被吞」与子问题 b 的「提交在途竞态」一并消失）；`saveMarkdown` 相应瘦身（只落盘、不记快照）。

**红**（实现前，用旧固定快照实现的 `-t "外部改动回退"` 用例）：`TestingLibraryElementError: Unable to find an element with the text: Body text edited.`（视图永久停在 `elsewhere`）。
**绿**：新用例 `外部改动回退：不再因旧落盘快照被当回声吞掉（裁定 F30）` 通过 —— ① 外部改成 E ⇒ 热重载到 E；② 外部改回 W（= 我方上次写入）⇒ 认出「内存 E ≠ 磁盘 W」为外部变更，照常热重载回 W，且 `queryByText("Body text from elsewhere.")` 为 null。
**回归**：既有「自己的写入回声不触发印章」仍绿（提交后内存 == 磁盘 ⇒ 忽略）。

### Minor 1：空态/加载态 `Ctrl+E` 不进编辑视图

**修法**：`toggleView` 在 `units.length === 0` 时 `return`（`src/hooks/useDocumentEditor.ts:195`）。
**红**：`× 无块单元时不进入编辑视图` → `expected 'editing' to be 'reading'`；App 侧 `× 空态按 Ctrl+E 不进入编辑视图（顶栏不呈按下态）` → `expected <div class="document-scroll__content document-scroll__content--editing"> to be null`。
**绿**：两条均通过（顶栏 `aria-pressed="false"`、无 `--editing` 类）。

### Minor 2：mdlog 记录中无活动块时 `Ctrl+S` 不弹提示

**修法**：`commitActive` 的 `if (!activeUnit) return true;` 提到 mdlog 门禁之前（`src/hooks/useDocumentEditor.ts:128`）。
**红**：hook 侧 `× 记录中且无活动块时提交是 no-op，不弹提示` → `expected { id: 1, message: '记录已开始，编辑已取消' } to be null`；App 侧 `× mdlog 记录中无活动块时 Ctrl+S 不弹「记录已开始」` → `expected <div class="editor-toast" …>记录已开始，编辑已取消</div> to be null`。
**绿**：两条均通过（`preventDefault` 仍生效：`fireEvent.keyDown(...) === false`；`save_document` 零调用；`.editor-toast` 为 null）。
**不回归**：F25 的「记录建立后提交被拦截」用例仍绿（有活动块时门禁照旧弹提示并清场）。

### Minor 3：mdlog 变活跃边沿只保留一条提示

**修法**（`src/App.tsx:753-768`）：编辑视图下 `toggleView()` 的提交口门禁（F25）已负责「写剪贴板 + 清场 + 提示」，故该分支不再预先 `notifyInterrupted`；不在编辑视图但确有活动块时才提示；两者都没有则静默（与 F32 同口径）。

```tsx
if (current.viewMode === "editing") { void current.toggleView(); return; }
if (current.activeUnit) { current.notifyInterrupted("记录已开始 · 编辑已取消"); }
```

**验证方式与局限（诚实登记）**：jsdom **观测不到**「同一批次两次 `setToast`」——React 批处理下只提交最终状态，且最终文案本就是 hook 版（`记录已开始，编辑已取消`），DOM 上无差别。故用两条可观测证据替代：
1. `grep` 结构性证据：mdlog 边沿路径上每个分支现在**只有一个** `notifyInterrupted` 调用点（旧实现是 App + hook 各一条）；
2. 变异体 M-M3（把 effect 恢复成旧的无条件提示形态）⇒ 新用例 `mdlog 记录中外部追加…（裁定 F32）` `1 failed`（`expected <div class="editor-toast" …> to be null`），即「边沿不得在无编辑会话时弹提示」已被锁住；
3. 既有用例 `编辑中 mdlog 变活跃：草稿尽力写入剪贴板、中断编辑并退回阅读视图` 仍绿（`writeText` 被调用、`/编辑已取消/` 可见、覆盖层与 `--editing` 类均清场）。

### Minor 5：`App.test.tsx:1669-1670` 恒真断言

**修法**：改为先断言块标记未挂载，再做点击：

```tsx
expect(document.querySelector("[data-vellum-unit]")).toBeNull();
fireEvent.click(screen.getByText("Body text."));
expect(document.querySelector("textarea.block-editor__input")).toBeNull();
```

**为什么原断言恒真**：mdlog 门禁生效时 `MarkdownDocument` 的 `editable === false` ⇒ `units = []`（`MarkdownDocument.tsx:613`）且 rehype 编辑单元插件整段不入管线（`:353`）⇒ 正文**根本没有** `data-vellum-unit`，点击本来就走不到激活路径，故「覆盖层仍为 null」无论实现是否正确都成立。新断言直接测「块标记未挂载」这一真正由门禁造成的事实。

### Minor 4：测试替身保真度（已并入 C1，见上）

`close()` 回放 `closeRequested`、未拦截则 `destroy()` 计数；新增 `selfCloseCalls()` 断言 App **从不**自行 `close()`（F33.2），并新增「落盘失败 ⇒ 窗口不关」用例。

---

## 3. 验证命令与真实输出摘要

```
# 收尾聚焦（实现后）
$ npx vitest run src/App.test.tsx src/hooks/useDocumentEditor.test.ts
 Test Files  2 passed (2)
      Tests  70 passed (70)

# 全量
$ npm test
 Test Files  31 passed (31)
      Tests  394 passed (394)

$ npx tsc --noEmit
（无输出，exit=0）

$ npm run build
dist/assets/index--4e89vTl.js                         158.08 kB │ gzip: 45.05 kB
dist/assets/syntax-highlighter-CUlFCbOG.js            117.47 kB │ gzip: 38.59 kB
dist/assets/MarkdownDocument-BP6iT9Um.js              262.93 kB │ gzip: 82.06 kB
✓ built in 2.14s      # PrismLight 红线未破：无 270+ 语言 chunk
```

实现前（红）的关键输出：

```
$ npx vitest run src/hooks/useDocumentEditor.test.ts
 ❯ (18 tests | 5 failed)
     × 提示条 2.4 秒后自动消失
     × 新提示重置计时：每条提示都看满 2.4 秒
     × dismissToast 立即清掉提示
     × 记录中且无活动块时提交是 no-op，不弹提示
     × 无块单元时不进入编辑视图
 Tests  5 failed | 13 passed (18)

$ npx vitest run src/App.test.tsx
 ❯ (52 tests | 6 failed)
   × mdlog 记录中无活动块时 Ctrl+S 不弹「记录已开始」
   × 空态按 Ctrl+E 不进入编辑视图（顶栏不呈按下态）
   × mdlog 记录中外部追加：静默热重载，不弹「文件已被外部修改」（裁定 F32）
   × 外部改动回退：不再因旧落盘快照被当回声吞掉（裁定 F30）
   × 关窗请求：有未提交草稿时先落盘，提交完成后由包装层销毁窗口   (expected 5 to be 2)
   × 关窗时落盘失败：窗口保持打开且不重试关闭（审查 C1）          (expected 2 to be 1)
 Tests  6 failed | 46 passed (52)
```

---

## 4. 与简报 / 计划 / 裁定的偏差

### D13（实现细节 + F33 落实方式）：`commitActive` 返回 `Promise<boolean>`，关窗按返回值拦截

- 简报/裁定给的是 `await current.commitActive(); if (!editorRef.current?.activeUnit) void getCurrentWindow().close();` 或「按活动块是否真的清掉决定拦不拦」。
- 实测（§2-C1「预期形态的实测反向结果」）：读 `editorRef.current?.activeUnit` 的两个方向都会错（成功路径误拦 ⇒ 窗口永不销毁；失败路径漏拦 ⇒ 草稿丢失），因为它读的是**上一轮渲染的快照**，在 `await` 之后可能尚未跟进。
- 故把「活动块是否真的清掉」实现为状态机自己的返回值：`true` = 会话已收起（无块 / 无改动 / 已落盘 / 被 mdlog 门禁中断），`false` = 落盘失败、草稿仍在框里。App 侧 `if (!cleared) event.preventDefault();`。**不自行 `close()`**（裁定 F33.2）保持为硬约束，并有 `selfCloseCalls() === 0` 断言锁定。
- 接口登记给 T7/T8：`useDocumentEditor().commitActive(): Promise<boolean>`（原 `Promise<void>`；`Promise<boolean>` 对 `void x?.commitActive()` 之类的调用点仍然兼容）。

### D14（测试适配，F30 的连带影响）：P5 步骤与「unchanged markdown + reloadTick」用例的前提变化

- F30 之后「磁盘内容 == 内存内容」的 `file-changed` 被整体忽略、**不产生 `reloadTick`**。因此：
  1. `end-to-end: live mdlog lifecycle…` 的 P5 步骤（原依赖「内容未变也产生 reloadTick」）现在让磁盘内容真的追加一段（等价于 mdlog 重连后的首次追加），断言（印章在 mdlog 活跃时被立即隐藏）不变；生产侧 P5 守卫未改，仍由「同路径重开（`loadPath → reloadCurrent`）期间 mdlog 活跃」等真实路径覆盖。
  2. 既有用例 `layout effect arbitrates scroll on hot reload even when markdown content is unchanged (via reloadTick)` 现在**平凡通过**（其 `file-changed` 内容与内存一致 ⇒ 被 F30 短路，`scrollTop` 自然保持 250）。未改该用例（不在本轮清单），登记为待复核项 §5-U3。

### D15（Minor 3 的可观测性局限）：见 §2-Minor 3 的三条替代证据；未新增「同批双写」用例（jsdom 不可观测，不为测试而改实现）。

---

## 5. 未解决项 / 待观察

| 编号 | 项 | 现状与建议 |
|---|---|---|
| U1 | **React 重复 key 警告（既有缺陷，本轮未修）** | `.app-shell__body` 下 `reload-note` 的 `key={reloadTick}` 与 `editor-toast` 的 `key={toast.id}` 是兄弟节点，同为 `1` 时 React 报 `Encountered two children with the same key, '1'`（新用例 `外部改动回退…` 的 stderr 可见）。该形态自 `3f0b74a` 就已存在（既有用例 `外部变更不误判为回声…` 同样触发），不属本轮审查清单，按范围纪律未修。建议后续轮次把 key 改成 `reload-${reloadTick}` / `toast-${toast.id}`（保留「key 变化重播动画」语义） |
| U2 | **`editorRef.current = editor` 在渲染期赋值（审查 Minor 6）** | 未在本轮清单内，未改。注意：A 侧关窗判定已不再依赖它（D13），剩余读点都在事件/effect 内 |
| U3 | **「markdown 未变 + reloadTick」路径的覆盖** | F30 后该组合只能由同路径重开（`loadPath` → `reloadCurrent`）触发；该既有用例已退化为平凡通过（D14.2）。建议 T8 复核布局 effect 的 reloadTick 守卫是否仍需要独立用例 |
| U4 | **F15 交叉点（编辑视图点链接 / 交互 widget 吞点击）** | 与上一版相同：v1 按裁定保持现状，需真机手检（T8） |
| U5 | **mdlog 边沿在「编辑视图但无活动块」时** | 走 `toggleView → commitActive` 门禁 ⇒ `notifyInterrupted` 只弹提示（无剪贴板写入，因 `activeUnitIndex === null`）。与上一版一致，登记 |
| U6 | **上一版报告的 U2/U3/U5–U9** | 均未被本轮改动触及（样式待 T7、入口 chunk 增量、搜索结果/大纲跳转的隐式提交、落盘失败后切文档的残余风险、关窗监听注册失败、heavyDoc 无消费点）—— 除 U9（D7 重复提示）本轮已修（Minor 3）外，其余保持登记 |
| U7 | **Minor 3 无 jsdom 用例** | 见 D15；已用结构性 + 变异体 + 既有边沿用例三重证据替代，若审查要求更强证据，只能上真机或把 effect 拆成可注入 `notify` 的单元（会改动生产结构，本轮不做） |

---

## 6. 变异体（证明用例真能杀掉实现，全部就地改 + 立刻还原）

| # | 变异 | 命令 / 结果 |
|---|---|---|
| M-close-1 | 旧实现（`preventDefault → commit → close()`）+ **旧 mock**（`close: vi.fn()`，不重发事件） | `-t "落盘失败"` → **`Tests 1 passed \| 51 skipped (52)`** ⇒ C1 用例在旧 mock 下绿（缺陷逃逸，即 Mock 保真度问题的直接证据） |
| M-close-2 | 旧实现 + **真机语义 mock** | `-t "关窗"` → **`Tests 2 failed \| 50 skipped`**：「关窗请求…」`expected 5 to be 2`（`replays` 触到递归上限）、「落盘失败…」`expected 2 to be 1`（同一 closeRequested 被二次进入） |
| M-F32 | `reloadIfExternal` 的提示门禁改回无条件 | `-t "静默热重载"` → `1 failed`：`expected <div class="editor-toast" …> to be null` |
| M-M3 | mdlog 边沿 effect 恢复旧的无条件提示 + `toggleView` | 同上 → `1 failed`（无编辑会话时不得弹提示） |

（所有变异均已还原：`grep -rn "MUTATION" src/` 无命中；`git status` 终态只剩派发前既有的无关改动。）

---

## 7. 交付接口变化（登记给 T7/T8）

```ts
// src/hooks/useDocumentEditor.ts
commitActive(): Promise<boolean>   // 由 Promise<void> 变更：true = 会话已收起，false = 落盘失败、草稿仍在框里
dismissToast(): void               // 新增：与 2.4s 自动消失同一清理路径
// 其余导出与语义不变（viewMode / toggleView / units / activeUnit / draft / initialCaret /
// heavyDoc / toast / activateUnit / updateDraft / notifyLocked / notifyInterrupted）
```

DOM 契约不变：`.document-scroll__content--editing`、`.block-editor__input`、`.editor-toast`、`.markdown-body--editing`、顶栏 `.open-button.edit-toggle`。
