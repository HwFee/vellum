# Task 3 审查报告 — `BlockEditor` + `computeOverlayBox`（review 1b64c53..784fdf9）

只读审查。未修改任何文件；仅跑了 2 次全量测试 + 1 次聚焦测试 + 1 次 `tsc --noEmit`，以及若干只读 grep/sed。

## 我实际跑过的命令与真实输出

```
$ npx vitest run src/components/BlockEditor.test.tsx src/lib/editorGeometry.test.ts
 Test Files  2 passed (2)
      Tests  8 passed (8)
   Duration  1.23s

$ npm test        # 第 1 次
 Test Files  1 failed | 30 passed (31)
      Tests  5 failed | 357 passed (362)
（失败文件为 src/hooks/useDocumentEditor.test.ts，与本次 diff 无关；
  同一次运行里 tsc 报 src/hooks/useDocumentEditor.ts(3,10) TS6133 —— 该文件不在 784fdf9 的 diff 内，
  是审查期间工作树里并行的 T4 未完成改动。）

$ npm test        # 第 2 次（同一工作树稍后）
 Test Files  31 passed (31)
      Tests  362 passed (362)

$ npx tsc --noEmit
TSC_EXIT=0
```

结论：`npm test` / `tsc` 在**本任务交付物**上是绿的；第 1 次的红/报错来自同工作树里 T4 的半成品，不是 T3 的回归。基线（1b64c53）为 28 文件 / 345 用例，本任务 +2 文件 / +8 用例，与实施报告一致。

---

### Spec Compliance

- ✅ F4（两参 `computeOverlayBox` + 宿主取 `.document-scroll__content`，不用 `offsetParent`、不加 `scrollTop`）：`src/lib/editorGeometry.ts:8-14`、`src/components/BlockEditor.tsx:53`；接线用例断言 `top/left/width/minHeight` = `200/10/700/120`（`src/components/BlockEditor.test.tsx:144-160`）。基点正确性经实证：`.document-scroll__content` 已有 `position: relative`（`src/styles/kami.css:711`），且无 border，padding box 顶边 = border box 顶边，矩形相减无 padding 误差。
- ✅ F5a（`scrollHeight` mock）：`src/components/BlockEditor.test.tsx:95-98`。
- ✅ F5b（删除 `settlingRef` 守卫、不留挂载期失焦吞并）：`src/components/BlockEditor.tsx:78-84`（无 setTimeout/守卫）、`:107`（无条件 `onCommit`）。
- ✅ F18（rect 高 0 ⇒ 回退 `firstElementChild`；隐藏/锁高/自增高/测量/还原同一元素）：`src/components/BlockEditor.tsx:22-29`、`:46-72`；用例锁定 `pre` 收到样式 + 包裹层无内联属性（`src/components/BlockEditor.test.tsx:162-188`，尤其 `:183`）。
- ✅ 内联样式逐项还原：`MANAGED_STYLES` 声明于 `src/components/BlockEditor.tsx:17`，快照于 `:54`，还原于 `:69-72`（赋回原字符串，空串即移除属性，能覆盖「原本就带内联 height」的块）。
- ✅ 受控契约与 brief 逐字一致、`onCommit` 不带参：`src/components/BlockEditor.tsx:4-14`。
- ✅ 不新增依赖 / 不新增 CSS 文件：diff 仅 4 文件（2 组件 + 2 lib/test），`package.json`、`src/styles/kami.css` 未触碰。
- ✅ 只用约定类名 `.block-editor__input`：`src/components/BlockEditor.tsx:89`。
- ⚠️ 多余项（未登记）：`data-block-editor-for={unitIndex}`（`src/components/BlockEditor.tsx:90`）不在 brief/计划的 DOM 契约里，也不被任何代码消费（T6 brief 用 `textarea.block-editor__input`）。
- ⚠️ `onCancel` 全程未被调用（`src/components/BlockEditor.tsx:13` 仅声明 + 注释）。与计划代码一致（计划里 Esc 也走 `requestCommit`），但属于「接口留而不用」，T6 brief 里 `onCancel` 已被接成 `commitActive()`，语义与 Esc 相同 ⇒ 该 prop 在 v1 是死参数。
- ⚠️ 无法仅凭 diff 判定、依赖下游接线才成立的前提：覆盖层必须被渲染成 `.document-scroll__content` 的子元素。T6 brief Step 5（`BlockEditor` 与 `MarkdownDocument` 并列渲染）与 T7 brief Step 3（`.document-scroll__content--editing { position: relative }`）与该前提一致；但 T3 brief 的 DOM 契约写的是 `.markdown-body` 提供 `position: relative`（F2 由 T2 挂类），两处表述不一致，最终以 F4/T6/T7 为准。
- ⚠️ 目标解析链（审查要求逐条判定）：`marked` 为 null ⇒ `src/components/BlockEditor.tsx:24` 返回 null，effect `:49` 早退（不打样式、不设 box）⇒ **确定但静默**；`firstElementChild` 非 HTMLElement ⇒ `:26` 回退 `marked` 本身 ⇒ 确定；包裹层高 0 且多子节点 ⇒ **当前管线不可能出现**（`needsWrapper` 仅 `<pre>`，`children: [node]` 恒单子节点，katex 替换的是内层节点，见 `src/lib/rehypeEditUnits.ts:18-20,60-68`），故 `firstElementChild` 唯一 ⇒ 确定。内联 `<code>` **不会**被当成目标：`document.querySelector` 按文档序取**最外层**标记元素，而 `walk` 自顶向下先给块元素打标（`src/lib/rehypeEditUnits.ts:58-69`），段落的 `<p>` 必然先于其内联 `<code>` 被匹配到；与 T2 点击侧用 `closest()` 取最内层（`src/components/MarkdownDocument.tsx:619`）方向相反但各自正确。

### Strengths

- F18 被收敛成一个 `resolveTarget`，隐藏 / 锁高 / 自增高 / 测量 / 还原**同源**，不存在「一半作用于包裹层」的漏网路径（`src/components/BlockEditor.tsx:22-29,46-72`）。
- 还原写在同一个 effect 的 cleanup 内（`:69-72`），`unitIndex` 变化时先 cleanup 再重新快照，不存在把「已隐藏状态」当原状记下的问题（快照于 `:54`，早于 `:57-61` 的写入）。
- 测试比简报**真的多驱动了两条关键路径**：F4 宿主基准接线（`src/components/BlockEditor.test.tsx:144-160`）与 ResizeObserver 回调（`:190-207`，用 `CaptureResizeObserver` + 实例级 `scrollHeight=240` 真调回调），而不是简报里那种空 mock。
- 测试卫生到位：`Object.defineProperty` 打在 prototype 上的东西在 `afterEach` 显式 `delete` 并恢复全局 `ResizeObserver`（`src/components/BlockEditor.test.tsx:101-105`）——这点 `vi.restoreAllMocks()` 覆盖不到，作者处理了。
- 注释把「为什么 deps 只放 `unitIndex`」和「为什么删 settlingRef」写清楚了（`src/components/BlockEditor.tsx:43-45,75-77`），未来改动者能理解约束来源。

### Issues

#### Critical (Must Fix)

1. **自增高在真机上没有触发源，测试用手工回调掩盖了这一点。** `src/components/BlockEditor.tsx:63-67` 只观察 `textarea`，回调体读 `textarea.scrollHeight`（`:65`）；但 textarea 的**布局盒**在打字时不变——inline `minHeight` 固定为**原块高**（`:94`），T7 brief 的 `.block-editor__input` 没有 `height`/`field-sizing`，`src/styles/kami.css` 全局也没有 textarea 自增高规则（`:70-74` 只有 `font: inherit`；`:883` 的 `.markdown-body textarea` 不适用于 `.markdown-body` 的兄弟节点）。ResizeObserver 只在 border box 尺寸变化时回调 ⇒ 草稿变长不会触发 ⇒ 原块高度不会被写大 ⇒ 「推流」失效；而 textarea 自身盒高被封在 `min-height`，超出部分被 T7 的 `overflow: hidden` 裁掉（用户看到下半段文字消失 + 正文里长出一条空白）。
   真机复现步骤：`npm run tauri dev` → Ctrl+E → 点一个普通段落 → 持续输入直到草稿超过原块高度 → 输入框自己不长高、下方内容不下推、超出部分不可见。
   验证/修法二选一：(a) 组件侧在 RO 回调与 `onChange` 里同时写 `textarea.style.height = textarea.scrollHeight + "px"`（一行，且让 RO 真正被驱动）；(b) T7 给 `.block-editor__input` 加 `field-sizing: content`（WebView2/Chromium 支持）并在 `kami.css.test.ts` 里锁死。无论选哪条，都必须在 T8 加一条真机手检项——jsdom 永远看不见这条路径。

#### Important (Should Fix)

2. **`host` 缺失时静默降级：原块被隐藏且锁高，覆盖层却没有定位盒。** `src/components/BlockEditor.tsx:53,60`：`host` 为 null 时不 `setBox` ⇒ `box` 保持 null ⇒ `:93-95` 渲染 `style={undefined}`，textarea 落回普通流（T6 里会出现在 `.document-scroll__content` 内容末尾），而原块已经 `visibility: hidden` + 锁高。用户看到的是「块消失 + 编辑器跑到别处」。修法：`!host` 时直接早退（不隐藏原块）或回退 `.document-scroll`。注意现有用例 `src/components/BlockEditor.test.tsx:107-118` 与 `:190-207` 用的正是**没有** `.document-scroll__content` 的 `mountFixture`，即这两条用例**正跑在这个分支里却不作任何断言**（掩盖了该路径）。
3. **重复提交没有闸门，且提交是异步的。** `src/components/BlockEditor.tsx:97-107`：Esc/Ctrl+S 只发信号不落地，组件在上层提交完成前仍挂载，随后任意失焦会**再发一次** `onCommit`。作者自己的用例把这个事实写进了断言：`src/components/BlockEditor.test.tsx:137-141`（Ctrl+S 后 1 次，接着 blur 变 2 次）。T4 的 `commitActive` 虽在提交后清 `activeUnit`，但它是 `async`（T4 brief:31），若第二次调用落在第一次 await 未决期间，就可能出现两次 `save_document`。修法：组件内加 `committedRef` 一次性闸门，或由 T4/T6 显式给出幂等保证并各补一条测试。另：`onCancel` 从未被调用，`Esc` 与「失焦」语义完全相同，用户没有「放弃改动」的路径（这一点 brief 未要求，登记为待定而非缺陷）。
4. **覆盖层盒只算一次，正文上方内容变高后会错位。** `src/components/BlockEditor.tsx:59-60` 在 effect 里算完就不再生效；`:63-66` 的 RO 只盯 textarea 的**尺寸**，不盯目标的**位置**。编辑期间若上方有懒加载图片完成、上方 widget iframe 上报新高度，目标块下移而覆盖层留在原地 ⇒ 编辑器漂浮在旧位置。修法是记录「上方内容变化」并重算（例：RO 观察 `.document-scroll__content` 或给 host 加 resize/scroll 监听后重算 box），或明确登记为已知取舍。注：这继承自计划代码，不是实施者的私自改动，但按审查规则不能因「计划如此」放过。
5. **`resolveTarget` 用「rect 高 0」推断「无布局盒」，会把正常块误判成包裹层。** `src/components/BlockEditor.tsx:25-26`：任何**零高的真实块**只要有一个元素子节点就会被换成该子节点，之后隐藏/锁高/测量全落到（很可能是行内）子元素上。具体触发：标记块是「只含一张尚未加载/加载失败的图片的段落」或 `<h1>` 内只剩空行内元素——此时 `getBoundingClientRect().height === 0`，`firstElementChild` 是 `<img>/<em>`，锁高对行内元素无效、`computeOverlayBox` 用子元素 rect 得到错误 `left/width`。建议在高度判定之外再要求 `marked.classList.contains("vellum-unit-wrap")`（jsdom 可测，且正是 F18 所指对象），或把 `display: contents` 作为首选判据、高 0 作为兜底。
6. **解析失败时 `box` 不重置，会沿用上一个块的盒。** `src/components/BlockEditor.tsx:41,47-49`：`unitIndex` 切到新块、若 `resolveTarget` 返回 null（热重载后标记丢失等），旧 `box` 仍生效，覆盖层停在旧位置而背景里没有任何被隐藏的块，用户无从判断。应在早退分支 `setBox(null)`。

#### Minor (Nice to Have)

7. 覆盖缺口：无「目标原本就带内联 `height`，卸载后还原成原值」的用例（机制正确，见 `src/components/BlockEditor.tsx:54,69-72`）；无「`unitIndex` 变化 ⇒ 上一轮样式已还原、新一轮重新隐藏」的用例；无「包裹层有真实布局盒（T7 CSS 未落地/未生效）时作用于包裹层自身」的用例——只有高 0 分支被覆盖。
8. 锁高断言退化：`src/components/BlockEditor.test.tsx:92-98` 让 `rect.height` 与 `scrollHeight` 同为 80，因此 `:113` 的 `"80px"` 无法区分「锁原高」与「自增高写回」；`BlockEditor.tsx:59-61` 那次「锁原高」写入在任何用例里都不可独立观测（实施报告 §4.7 已承认）。
9. 挂载瞬间 `scrollHeight` 在 textarea 仍处普通流（未应用绝对定位与最终宽度）时读取（`src/components/BlockEditor.tsx:60`），得到的换行宽度与最终不一致；只有 RO 首次回调能纠正——而 RO 路径本身有 Critical-1 的问题。建议把测量放到 `box` 应用之后（按布局阶段顺序或第二个 layout effect）。
10. `CaptureResizeObserver.disconnect()` 直接清空共享的 `resizeCallbacks`（`src/components/BlockEditor.test.tsx:79-81`），`:207` 的 `toHaveLength(0)` 同时依赖「组件调了 disconnect」和「替身自己清空」两件事，判别力脆弱（能发现漏调，但语义被混淆）。改为在替身里记录 `disconnectCalled` 更直白。
11. `data-block-editor-for`（`src/components/BlockEditor.tsx:90`）无消费者，属未登记的多余属性：要么登记给 T6/T7 用，要么删掉。
12. `textarea.focus()` 放在 `useEffect`（`src/components/BlockEditor.tsx:78-84`）而非 layout effect，激活会有一帧无焦点；与计划一致，仅记录。
13. T7 交叉风险登记：若 T6 把覆盖层渲染进 `.markdown-body` 内部，`src/styles/kami.css:883` 的 `.markdown-body textarea`（特异度 0,1,1）会压过 T7 的 `.block-editor__input`（0,1,0），`padding/border/min-height: 32px` 全部生效，覆盖层会变形。T6 brief 是并列渲染（不在 `.markdown-body` 内），当前安全；建议在 T7 的 css 测试里锁一条「覆盖层不是 `.markdown-body` 后代」或把选择器写成 `.document-scroll__content--editing > .block-editor__input`。

### Assessment

**Task quality:** Needs fixes

**Reasoning:** 契约、F4/F5/F18 三项裁定与内联样式还原机制都逐字落实且有针对性的用例，仓库级 `npm test`/`tsc` 在当前工作树为绿；但「自增高」在真机上缺少触发源（textarea 自身盒高不会随内容变化，测试用手工回调掩盖了该路径，Critical-1），`host` 缺失与解析失败两个降级分支会把用户丢在原块被隐藏、覆盖层无定位的状态里（Important-2/6），加上失焦可能二次提交（Important-3）——都是小改动可修，但必须先修/先验证再进入 T6/T7 接线。
