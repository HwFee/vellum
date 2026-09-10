# 预检裁定 — plan: docs/superpowers/plans/2026-09-10-vellum-block-editing.md

控制器（主对话）在派发前扫描出的跨任务/自一致冲突与裁定。**实施者与审查者都必须读本文件**：
它是计划文本的补充权威；与本文件冲突的计划代码段以本文件为准。

---

## F1（T2 × T1）：包含判定被重复实现

- **冲突**：T1 已产出 `findUnitForRange(units, start, end)`；T2 的计划代码里又内联写了一遍
  `units.find((c) => c.start <= start && c.end >= end)` —— 同一逻辑的第二份实现，审查模板会判为缺陷。
- **裁定**：T2 必须 `import { findUnitForRange } from "./editUnits"` 并调用它，**不得**内联该判定。

## F2（T2 × T7）：`.markdown-body--editing` 无人添加

- **冲突**：T7 的样式写 `.markdown-body--editing .vellum-unit-wrap { display: contents }`，
  但没有任何任务把 `markdown-body--editing` 挂到 `<article>` 上。类名缺失 ⇒ 数学块外包的 `<div>`
  会退化成块级盒子，产生视觉回归。
- **裁定**：T2 在 `MarkdownDocument` 里，`editable === true` 时给 `<article>` 追加
  `markdown-body--editing` 类（与既有 `markdown-body--mdlog` 并列）。T2 的测试必须断言该类存在，
  且阅读视图下不存在。

## F3（T2 × 依赖）：`rehype-stringify` 未安装

- **冲突**：T2 计划里的插件单测用 `unified().use(remarkParse).use(remarkRehype).use(rehypeStringify)`，
  实测 `node_modules` 内 **没有 `rehype-stringify`**（也没有 `hast-util-to-html`）。
- **裁定**：**不新增依赖**。T2 的插件单测改为**直接构造 hast 节点字面量**并调用插件函数
  （见下方代码），DOM 层的断言仍由 `MarkdownDocument.test.tsx` 承担。
  插件 API 同时简化为 unified 惯用的「选项式工厂」：`rehypeEditUnits({ units })` 返回变压器，
  计划里的 `createRehypeEditUnits(units)` 作废。

## F4（T3 × T7）：覆盖层定位基准与 offsetParent 不一致

- **冲突**：计划的 `computeOverlayBox(targetRect, containerRect, containerScrollTop)` 以
  `.document-scroll` 为基准再加 `scrollTop`；但覆盖层（`.block-editor__input`）是
  `.document-scroll__content` 的绝对定位子元素，其 containing block 是该元素的 padding box。
  两者相差该容器的 padding/边框，会产生固定偏移。
- **裁定**：改为**同容器矩形相减**，签名去掉 `containerScrollTop`：

```ts
export type DOMRectLike = { top: number; left: number; width: number; height: number };
export type OverlayBox = { top: number; left: number; width: number; minHeight: number };

/// 覆盖层是 .document-scroll__content 的绝对定位子元素，故基准必须是该容器自身：
/// 两个矩形都随滚动一起移动，相减即得稳定的相对坐标，无需再加 scrollTop。
export function computeOverlayBox(targetRect: DOMRectLike, hostRect: DOMRectLike): OverlayBox {
  return {
    top: targetRect.top - hostRect.top,
    left: targetRect.left - hostRect.left,
    width: targetRect.width,
    minHeight: Math.max(1, targetRect.height),
  };
}
```

对应单测：

```ts
it("按宿主容器换算相对坐标", () => {
  const box = computeOverlayBox(rect(300, 40, 700, 120), rect(100, 30, 720, 600));
  expect(box).toEqual({ top: 200, left: 10, width: 700, minHeight: 120 });
});

it("高度为 0 时给出 1 像素下限", () => {
  const box = computeOverlayBox(rect(300, 40, 700, 0), rect(100, 30, 720, 600));
  expect(box.minHeight).toBe(1);
});
```

`BlockEditor` 里宿主容器取 `target.closest(".document-scroll__content")`（**不要用
`offsetParent`** —— jsdom 下恒为 null，测试无法覆盖）。

## F5（T3 自身）：jsdom 下 `scrollHeight` 为 0 + 挂载期失焦守卫会吞掉测试

- **冲突 a**：`target.style.height = textarea.scrollHeight + "px"` 在 jsdom 读数为 0，
  计划测试断言 `"80px"` 必然失败。
- **裁定 a**：T3 测试的 `beforeEach` 里补 mock：

```ts
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get: () => 80,
});
```

- **冲突 b**：计划的 `settlingRef`（挂载后 `setTimeout(0)` 内忽略失焦）会让
  「Ctrl+S 与失焦都提交」用例在快速触发时被吞掉。
- **裁定 b**：**删掉 `settlingRef` 与那段守卫**。焦点在 layout effect 里设置，不会产生多余 blur；
  真机若出现挂载期假失焦，再单独处理（记为待观察项，不进本任务范围）。

## F6（T6 自身）：全局 `Ctrl+S` 未兜底

- **冲突**：只有编辑框聚焦时 `Ctrl+S` 才被 `preventDefault`；阅读视图下按 `Ctrl+S` 会触发
  WebView 自带的「保存网页」对话框，与「Ctrl+S = 提交当前块」的语义冲突。
- **裁定**：T6 在既有全局 `keydown` 监听里加一条：`(ctrl|meta)+s` ⇒ `preventDefault()`，
  再调用 `editor.commitActive()`（无活动块时是 no-op）。

---

## 裁定登记（ledger 同步）

| 编号 | 裁定 | 若判错的代价 |
|---|---|---|
| F1 | T2 复用 `findUnitForRange` | 低：仅是多一份实现，删掉即可 |
| F2 | T2 补 `markdown-body--editing` 类 | 中：类名缺失会让数学块外包容器变块级盒子，需改回来 |
| F3 | 不装 `rehype-stringify`，插件测试直接调函数 | 低：单测更贴近单元，代价是少了端到端串联覆盖（由 DOM 测试补） |
| F4 | 覆盖层以 `.document-scroll__content` 为基准 | 中：若真机发现偏移，需回到 offsetParent 方案 |
| F5 | 删挂载期失焦守卫 + mock scrollHeight | 低：真机若出现假失焦，补一个更精确的守卫 |
| F6 | 全局 `Ctrl+S` 兜底 | 低：最多是多拦截一次浏览器默认行为 |

---

## T1 补审追加的裁定（审查报告：`task-1-review.md`）

### F7（Critical-1）：区间重叠必须归一化

- **问题**：合法 Markdown 就能破不变量 —— `"[ref]: http://x\n正文段落。\n---"`（definition + setext heading 同起点）产出两个重叠单元；畸形围栏（关闭行尾随文字）产出 2 字节重叠。`spliceUnit` 因此可能跨块写字节。
- **裁定**：`buildEditUnits` 排序后**必须归一化**：保留靠前的单元，后续单元若与前者重叠则丢弃（或把 `start` 夹紧到前一个单元的 `end`；夹紧后若 `end <= start` 则丢弃）。
  补两条回归用例（上面两个输入）+ 对**所有**用例统一断言 `units[i].start >= units[i-1].end`。
- 若判错：过度丢弃会让某些块失去编辑入口（安全方向，可逆）。

### F8（Important-2）：嵌套的 HTML / widget 必须仍结构性只读

- **问题**：`collectUnits` 下钻时**强制** `kind = listItem / blockquoteChild`，导致 `locked = kind === "html" || "widget"` 对嵌套子节点永远为 false。实测三条绕过：`> <div class="x">hi</div>`、`> ```vellum-widget …`、`- 项` 内嵌 widget 围栏 / 原始 HTML，全部 `editable=true`。
- **裁定**：下钻时用**子节点自身的锁定类型**覆盖 kind —— 子节点 `type === "html"` ⇒ `"html"`；子节点是 `lang === "vellum-widget"` 的 `code` ⇒ `"widget"`；否则才用容器类型（`listItem` / `blockquoteChild`）。
  补三条嵌套用例（引用内 HTML、引用内 widget、列表项内 HTML 或 widget）。
- 若判错：嵌套 HTML 会被开放编辑（违背计划 Goal），可逆但属于安全回归。

### F9（Important-3 + Minor-7）：单元区间从行首起算，且草稿/光标统一按 LF 归一

- **问题 a**：`blockquoteChild` 的 mdast 区间不含首行 `> `、却含后续行 `> `（实测 `"> 行一\n> 行二\n"` → slice `"行一\n> 行二"`）。用户整段重打会静默改变结构。
- **裁定 a**：所有单元的 `start` **向前扩到所在行的行首**（引用块因此含首行 `> `，`listItem` 行为不变）。
  补多行引用的回归用例：`"> 行一\n> 行二\n"` 的切片必须是 `"> 行一\n> 行二"`。
- **问题 b**：切片含 `\r\n` 时，textarea 会把 value 归一成 LF，而 caret 偏移是按含 `\r` 的原始文本算的 ⇒ 多行 CRLF 块的光标会偏。
- **裁定 b**：**草稿与光标必须基于同一份 LF 归一文本**：`markdown.slice(...).replace(/\r\n/g, "\n")`。落盘时由 Rust 侧 `dominant_eol` 还原 CRLF（Task 5），因此归一安全。
  此裁定**跨 T2/T4**：T2 的点击回调算 caret 前先归一，T4 的 `activateUnit` 取切片时同样归一 —— 两处必须一致。
- 若判错：a 会让某些块多含一行前导空白；b 会让光标落点偏（非数据问题）。

### F10（Minor-4/5）：去掉死值与死分支噪音

- **裁定**：从 `EditUnit["reason"]` 联合中**删掉 `"unmapped"`**（无产出点）；`try/catch` 保留但注释为**防御性代码**（`fromMarkdown` 实际不抛），不为其补测试。
- 若判错：无实质影响。

### F11（Minor-9）：入口 chunk 体积守门
- **问题**：`remark-math` 目前只在 lazy chunk；`useDocumentEditor`（App 侧）import `buildEditUnits` 会把 math 解析器带进入口 chunk。
- **裁定**：接受该增量（micromark math 扩展为个位数 KB），但 **Task 8 必须实测入口 chunk 增量并记录**；若增量 > 20KB 则改为把单元计算留在 `MarkdownDocument`（lazy 侧）并用 props 上传。
- 若判错：需要一次小重构（把 hook 的 units 改成由 MarkdownDocument 上报）。

---

## T2 交付后的裁定（审查报告：`task-2-review.md`；实施报告：`task-2-report.md`）

### F12：`<pre>` 一律外包容器 + h1/h2/h3 交还标记属性

- **背景**：计划的包裹规则只覆盖「会被 katex 替换的节点」，实测漏了第二类：`components.pre` 与 `components.h1/h2/h3` 是 React 覆盖渲染，**不透传 hast 属性**，导致代码块/widget/标题的标记到不了 DOM。
- **裁定**：接受实施者的扩展（所有 `<pre>` 外包 `.vellum-unit-wrap`，标题交还两个 data 属性），并把计划步骤 5.4 同步改写（已执行）。T7 必须提供 `display: contents` 退布局。
- 若判错：编辑视图多出几层包裹（视觉由 T7 的 CSS 兑底）；可逆。

### F13：**不**给 `kamiSchema` 追加 `data*`

- **背景**：计划步骤 5.4 要求追加 `data*`；实施者未执行，理由是「插件在 sanitize 之后运行，标记不经 sanitize；而追加会放宽**阅读视图**的白名单（探针实测 `data-foo` 当前会被剥离）」——这比计划文本更符合绑定约束「阅读视图 DOM 逐字节一致」。
- **裁定**：计划该步骤**作废**，不得追加 `data*`，不得新建派生 schema（YAGNI）。计划文本已同步改写。
- 若判错：需要回到「编辑视图专用派生 schema」方案（多一个模块常量 + 一条测试）。

### F14：`\r\n` 切片的 caret 偏移归 T2 修复轮处理

- **背景**：T2 的 `handleClick` 用含 `\r` 的原始切片算 caret；而 textarea 会把 value 归一为 LF，多行 CRLF 块的落点会偏。
- **裁定**：属 T2 的职责面（裁定 F9b），不推给下游；待 T2 审查回来后作为修复轮的一项（与审查发现一起修，避免多轮）。

---

## T2 审查后的裁定（审查报告：`task-2-review.md`）

### F15（M3，登记不修）：点击语义的两个交叉点归 T3/T6 决策

- **背景 a**：`handleClick` 挂在 `<article>` 上，编辑视图点链接会**同时**触发 `a` 的 `openUrl` 与 `onActivateUnit`（系统浏览器打开 + 编辑框弹出）。
- **背景 b**：可交互 widget 的 iframe 会吸收点击（`pointer-events`），`onLockedUnitClick("widget")` 不会触发；静态 widget（`mdlog-widget__frame--static`）不受影响。
- **裁定**：v1 **不改**（属既有交互的交叉点，不是回归）；在 T6 接线时若真机观感差，再让编辑视图下的 `a` 点击只激活不打开（一行条件），不提前做。
- 若判错：真机上点链接会多弹一次编辑器（可逆）。

### F16（M1）：块标记的取样口径

- **背景**：内层 `<pre>` 与行内 `<code>` 等嵌套元素也会带上 `data-vellum-unit`，故 `querySelectorAll("[data-vellum-unit]").length` **不等于**单元数。
- **裁定**：不改变打标策略（`closest()` 取最内层仍然正确）；T2 修复轮加一行注释声明该事实，且后续任务**不得**用该选择器数块数（改用 `buildEditUnits(markdown).length`）。

### F17（T1 重审残留，建议级）：畸形围栏下保留下来的单元 `end` 仍伸进被丢弃项

- **背景**：`"- a\n\n  ```\n  x\n  ```- b\n- c\n"` 归一化后保留 `[0,26)`、丢弃 `[24,27)`；前者的 `end` 仍跨过 `- c` 的 `- `，因此 `spliceUnit(md, units[0], "NEW")` → `"NEWc\n"`（丢掉下一项的列表标记）。
- **裁定**：**登记为已知取舍，不修**。理由：仅触发于畸形输入（关闭围栏行带尾随文字）；若改为「夹紧前一块的 end」则需重新评估是否会截断前块自身的围栏闭合，且要另跑一轮 fuzz —— 收益与风险不成比例。124 份真实文档 + 2951 份 fuzz 下 `dropped=0`（仅 3 份畸形样例丢块）。
- 若判错：真机上遇到这类畸形文档时，一次提交会把后续列表项降级为段落（可用 git 回退；不丢文件）。

### F18（T3 × T2/T7）：包裹层 `display: contents` ⇒ 必须操作首个有布局盒的子元素

- **背景**：Task 2 把代码块/数学块/widget 一律外包 `.vellum-unit-wrap`，T7 会给它 `display: contents`。**`display: contents` 元素不生成布局盒**：对它设 `height`/`visibility` 无效、测量返回 0 ⇒ T3 的「隐藏原块 + 锁高 + 自增高推流」会全部失效（内容被覆盖而不下推）。
- **裁定**：T3 必须先解析**操作目标**：标记元素 rect 高度为 0 时回退到 `firstElementChild`，隐藏/锁高/自增高/测量均作用在该元素上；内联样式还原也只管它。
- 若判错：代码块/widget/数学块的就地编辑会出现「覆盖不下推」的视觉差（可逆，改回 `target.firstElementChild ?? target` 即可）。

---

## T3 审查后的裁定（审查报告：`task-3-review.md`）

### F19（Critical-1）：自增高必须由组件显式写高，不得依赖 textarea 自身盒高变化

- **问题**：`ResizeObserver` 只盯 textarea 的 border box，而打字只改 `scrollHeight`、不改盒高（inline `minHeight` 固定为原块高）⇒ 真机上回调永不触发，「推流」失效、超出部分被 `overflow:hidden` 裁掉。测试用手工回调掩盖了这条路径。
- **裁定**：选组件侧方案（可测、不依赖 CSS）：**在 `onChange` 与 RO 回调里都显式写** `textarea.style.height = textarea.scrollHeight + "px"`，再把同一值写回目标元素高度；测量时机搬到 `box` 应用之后（第二个 layout effect）。T7 可选加 `field-sizing: content` 作为兼底，但**不得**成为唯一机制。T8 必加真机手检项（jsdom 永远看不见这条）。
- 若判错：真机上长段落编辑时下方内容不下推（T8 手检能当场拦住）。

### F20（Important-5）：包裹层判定以 class 为首选，高 0 为兜底

- **裁定**：`resolveTarget` 先看 `marked.classList.contains("vellum-unit-wrap")`（jsdom 可测，且正是 F18 所指对象），未命中才用 `rect.height === 0` 兜底。避免把「零高真实块」（未加载图片的段落、空行内元素的标题）误判成包裹层。
- 若判错：零高块会拿子元素（行内元素）做锁高/测量，得到错的 left/width。

### F21（Important-4/2/6）：覆盖层盒重算与降级分支

- **裁定**：① 除 textarea 外，再用一个 RO 观察**宿主容器**（`.document-scroll__content`）并重算盒（覆盖上方懒加载图片/iframe 上报高度导致的位移）；② `host` 缺失时**早退且不隐藏原块**（宁可不进编辑，也不把用户丢在「块消失 + 编辑器在别处」的状态）；③ 解析失败（`resolveTarget` 返回 null，如热重载后标记丢失）时 `setBox(null)`，不得沿用上一个块的盒。
- 若判错：上方内容变化时编辑器会漂在旧位置（可逆）。

### F22（Important-3）：提交一次性闸门在组件侧

- **裁定**：`BlockEditor` 内部加 `committedRef` 一次性闸门（Esc/Ctrl+S/失焦/父级强制提交共用），保证同一激活周期内 `onCommit` 最多发一次；补一条「Ctrl+S 后失焦不再重复提交」的用例。
- 若判错：一次编辑可能触发两次 `save_document`（幂等写入，代价低）。

### F23（T7 交叉风险）：覆盖层选择器特异度

- **背景**：`kami.css:883` 的 `.markdown-body textarea`（0,1,1）会压过 `.block-editor__input`（0,1,0）。当前 T6 是**并列渲染**（覆盖层不在 `.markdown-body` 内）故安全。
- **裁定**：T7 必须把覆盖层选择器写成 `.document-scroll__content--editing > .block-editor__input`（或等价特异度），并在 `kami.css.test.ts` 锁一条「覆盖层不是 `.markdown-body` 后代」的断言，防未来接线漂移。

---

## T4 审查后的裁定（审查报告：`task-4-review.md`）

### F24（Critical-1）：保存失败必须把内存 markdown 回退，草稿才留在框里重试

- **问题**：`commitActive` 用 `flushSync` 强制父级吸收新 markdown ⇒ `units` 重推、`activeUnit` 指向新文本的同名索引；失败分支又写回「旧索引语义的 activeUnit + 旧草稿」⇒ 三者不自洽：结构变化时重复落盘、同内容时静默永不落盘（审查者用真实探针证实）。
- **裁定**：失败路径**先回退父级状态**（`onMarkdownChange(原 markdown)`），使内存与磁盘重新一致，然后重新激活同一块并保留草稿与 `initialCaret`（M8 一并解决）。即以「内存不长期领先磁盘」为状态机不变量：提交即落盘、落盘失败即回退。
- 若判错：失败时用户看到文本回回改前（草稿仍在框里），需重新确认；代价可感知但可逆。

### F25（Important-2）：`commitActive` 必须有 mdlog 门禁

- **背景**：门禁只在入口（`activateUnit`/`toggleView`）拦，提交口可绕过（激活块 → 记录建立 → Ctrl+S/失焦 ⇒ 照常落盘）。
- **裁定**：`commitActive` 开头加 `if (mdlogActive) { notifyInterrupted("记录已开始，编辑已取消"); return; }`，并补一条用例（激活后把 `mdlogActive` 翻 true 再提交 ⇒ `save` 零调用、`activeUnit` 被清）。T5 的 Rust 侧闸门作为兼底。
- 若判错：记录中可能写入文件（正是用户明令禁止的事）。

### F26（M7）：`heavyDoc` 粘性保持

- **裁定**：有意为之 —— 它是文档规模的属性（不是瞬时值），本会话内不回退；在 hook 注释与 T8 验收里写明。
- 若判错：文档变小后仍显示较重的提示（纯文案）。

### F27（F20 细化，已登记）：高 0 兜底收窄为「高 0 **且**子节点自身有布局盒」

- **背景**：T3 修复轮发现裁定 F20 的字面实现与裁定自身的用例互斥 —— 零高 `<p>`（仅含未加载 `<img>`）若按字面下钻，就会把隐藏/锁高作用到行内子元素上。
- **裁定**：接受细化版：`classList.contains("vellum-unit-wrap")` 为首选，高 0 **且**子节点自身有布局盒才下钻；零高真实块仍作用在自身。
- 若判错：包裹层在某些浏览器上拿不到 class 时会退到自身（可逆）。

---

## T5 审查后的裁定（审查报告：`task-5-review.md`，Task quality: Approved）

### F28（Important-1）：读旧文件失败不得静默降级为 LF

- **背景**：`document.rs:212` 用 `read_to_string(&canonical).unwrap_or_default()`，把「读失败」与「空文件」混为一谈；而 `rename` 只需 DELETE 访问就可能成功 ⇒ CRLF 文档被整篇改写成 LF，无备份无日志。
- **裁定**：改为 `map_err` 返回可读错误（宁可让用户重试，也不静默翻新换行符），并补一条用例（构造不可读文件或直接测辅助函数）。
- 若判错：极端文件锁场景下保存会被拒（用户重试即可，可逆）。

### F29（Important-2）：临时文件名必须唯一

- **背景**：`.{name}.vellum-tmp` 固定名，同一文档并发保存（或多实例）会互踩。
- **裁定**：临时名加入唯一后缀（`uuid` 已在 Cargo.toml 依赖中，直接用 `Uuid::new_v4()` 的短片段），失败清理逻辑不变。
- 若判错：极端并发下仍可能冲突（概率降低但仍非零；已有 rename 原子性兑底）。

---

## T6 审查后的裁定（审查报告：`task-6-review.md`）

### F30（Important-3）：回声判据改为「与内存 markdown 比对」，删掉 `lastSavedMarkdownRef`

- **背景**：固定快照会误吞真实外部变更（外部改成 E 再改回 W ⇒ 视图停在 E 与磁盘永久不一致；快照不含 path；且在 `await save` 之后才赋值 ⇒ 提交在途竞态）。
- **裁定**：采纳审查者给的简化替代 —— 判据改成**与当前内存 `state.document.markdown`（同样 LF 归一）比对**：
  - 磁盘内容 == 内存内容 ⇒ 无外部变更（可能是我方回声）⇒ 忽略；
  - 否则 ⇒ 外部变更（或我方写入尚未生效）⇒ 走外部分支。
  删除 `lastSavedMarkdownRef`。此判据不需要赋值时机/清零点，两个子问题一并消失（F24 已保证「内存不长期领先磁盘」）。
- 若判错：异步窗口内可能误判为外部变更（最多多一次热重载，无数据损失）。

### F31（Important-2）：`toast` 必须有自动消失路径

- **裁定**：hook 内给 `toast` 加 2.4s 定时器（与 spec §9 一致），新增 `toast` 时重置；提供 `dismissToast()` 供测试与手动关闭。T7 的 CSS 可加淡入淡出，但**不得**以 CSS 为消失机制。
- 若判错：提示条逗留时间变短（无数据影响）。

### F32（Important-1）：仅在确有编辑会话被中断时提示

- **背景**：mdlog 记录中每次追加都触发 `file-changed`，而无活动块时 `notifyInterrupted` 仍弹「文件已被外部修改 · 编辑已取消」⇒ 常态路径上刷提示。
- **裁定**：`reloadIfExternal` 只在 `editorRef.current?.activeUnit` 存在时调 `notifyInterrupted`，否则静默热重载（与「记录中禁编」的既定行为一致）；补一条用例断言该路径**不出提示**。
- 若判错：真被中断时少一次提示（可逆）。

### F33（Critical-1 + Important-4）：关窗失败不得关窗，成功路径不自行 `close()`
- **裁定**：
  1. 处理器改为「提交后看活动块是否真的清掉」，失败就保持窗口打开（草稿仍在框里，用户可处理）；
  2. **成功路径不调 `close()`** —— 不 `preventDefault` 时 JS 包装层会自行 `destroy()`。
  3. 测试替身必须**模拟真机语义**：`close()` 会回放 `closeHandlers`（否则 C1 类缺陷永远逃逸），并补一条「落盘失败 → 窗口不关」用例。
- 若判错：失败时窗口不自动关（用户多点一次）、或成功时多一次 IPC（可忽略）。

---

## T6 重审与 T7 交付后的裁定

### F34（T6 重审 U3）：退化为恒真的既有用例必须在 T8 修回判别力

- **背景**：F30 删掉 `lastSavedMarkdownRef` 后，一条既有的 `reloadTick` 滚动仲裁用例失去了可区分的测试路径（覆盖真空，重审判为「应当修复但不阻断」）。
- **裁定**：归入 T8（质量收口任务）修回判别力，**不得删除了事**；若确无同名真实路径，则改用等价路径并在报告里说明。
- 若判错：该路径后续回归靠真机发现（回归成本上升）。

### F35（T8 边界）：真机 GUI 手检不由子智能体伪造

- **裁定**：T8 只交付「未执行」的真机手检清单（步骤 + 预期）；任何手检结论必须由用户在装有 WebView2 的真机上亲自完成。子智能体不得声称已手检。
- 若判错：无（只是验收报告里会留一段未勾选项）。

### F36（T7 两条 Important）：并入终审修复波

- **背景**：T7 审查 **Approved**，但两条 Important：① `kami.css` 用 `>` 直接子元素选择器，而**没有任何 DOM 层测试**守住覆盖层的位置（App 测试用位置无关的 `querySelector`）⇒ 接线漂移时样式整体失效且测试全绿；② 非段落块（标题/列表项/引用）的度量差异未登记。
- **裁定**：不单独开 T7 修复轮，**并入终审修复波**（与终审发现一起一次修完）；但终审必须先看到这两条（已写入终审派发）。
- 若判错：接线漂移类回归要到真机才被发现（代价=一次返工）。

---

## 全分支终审后的裁定（审查报告：`final-branch-review.md`）

### F37（C1）：结构性只读必须封死脚注定义，并用遍历式断言守住

- **问题**：`BLOCK_CONTAINERS` 不含 `footnoteDefinition`，顶层脚注定义整体作为一个 `other` 单元且 `editable=true` ⇒ 其中的块级 HTML / `vellum-widget` 可被编辑（三个反例实测）。
- **裁定**：把 `footnoteDefinition` 当作**可下钻容器**（与 `blockquote` 同列），使脚注正文仍可逐块编辑、锁定子块各自只读；并把回归断言改为**遍历式**（对全部容器类型清单化地验证嵌套 HTML/widget 均 `editable=false`），不再只补例子。
- 若判错：粒度偏差（整块脚注不可编）—— 可逆。

### F38（C2）：`Ctrl+S` 双通道提交必须去重（A+B 都做）

- **问题**：编辑框 `onKeyDown` 只 `preventDefault` 不 `stopPropagation`；App 全局分支无条件再调 `commitActive`。而 `flushSync` 同步换掉了 `editorRef.current`，第二次调用用新 markdown 的同索引单元当原文 ⇒ 草稿改变块结构时**重复拼入并二次落盘**（实测 `新段。` 出现两次）。
- **裁定**：做两处防护 —— **A** App 全局处理器开头 `if (event.defaultPrevented) return;`；**B** 把 F22 的一次性闸门下沉到 hook（`committingRef`），使「同一会话已有提交在途」时 `commitActive` 直接返回。回归用例必须把 `Ctrl+S` **打在编辑框上**（而非 window），草稿用**结构变化**文本，断言 `save_document` **恰好一次**且载荷无重复段。
- 若判错：极端交错下仍可能多一次 IPC（写入幂等，代价低）。

### F39（I1）：切换文档必须清空编辑会话

- **裁定**：`loadPath` 判定要切换文档时，先重置编辑会话（清 `activeUnitIndex`/`draft`/`initialCaret`），否则上一份文档的草稿会被写进新文档（F24 的失败重激活路径）。hook 暴露 `resetSession()`；`App.loadPath` 在已确认为切换时调用。
- 若判错：切换瞬间丢失未提交草稿（与「已主动切文档」意图一致）。

### F40（I3 / T8 审查）：`heavyDoc` 必须接到界面上

- **问题**：spec D5 承诺「提交耗时 > 800ms 挂自适应软提示」，但 `heavyDoc` 只有状态层、**无任何 UI 消费者**，CHANGELOG 却对用户宣告了它。
- **裁定**：接到界面上（编辑视图内一条常驻轻提示，文案与 T7 视觉语言一致；`heavyDoc` 为 true 才渲染），并补用例；不得用「改文案抹掉承诺」处置。
- 若判错：额外占一行界面空间。

### F41（T7-I1）：补一条 DOM 层位置守卫

- **裁定**：补用例断言覆盖层的**直接父元素**是 `.document-scroll__content--editing`（而非任何位置无关的 `querySelector`），使 F23 的选择器接线不再只靠源码字符串锚定。

### F42（I2）：进/出编辑视图重建全部 iframe —— **登记不改**

- **问题**：`.vellum-unit-wrap` 只在 `editable` 时插入 ⇒ React 元素层级变化 ⇒ 每次 `Ctrl+E` 全篇 widget iframe 销毁重建（重新加载 + `--ready` 淡入闪烁）。
- **裁定**：**本次不改，记入验收报告已知限制与下一版待办**。理由：审查者给的修法（把标记属性像 h1/h2/h3 那样交给 `components.pre` 并只对数学块保留包裹）要动**承担载荷的渲染管线与 T2/T3/T7 三方契约**，而终审后只剩一轮夹缝重审，风险大于它消除的闪烁；已记明判错代价。
- 若判错：mdlog 大日志每次切视图有可见重建（已知、可见、不影响正确性）。

### F43（T7-I2）：非段落块度量差异 —— 登记

- **裁定**：记入验收报告已知限制（行级近似本就已登记，非段落块因字号/行高不同，落点近似精度更低）。
