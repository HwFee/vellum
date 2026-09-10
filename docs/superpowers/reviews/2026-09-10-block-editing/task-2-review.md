# Task 2 审查报告 — rehype 块标记插件 + 点击解析（base 2e2c11c → head 3ad0f80）

审查者：独立复核（只读；未修改任何文件）。工作区在本审查期间被另一个会话并发改写，见「环境观察」。

---

## 规格符合结论

### Spec Compliance
- ✅ **F1（复用 `findUnitForRange`）**：`src/lib/rehypeEditUnits.ts:1` import、`:51` 调用，插件内无内联区间判定（`:51-64` 只有 `findUnitForRange` 与 `needsWrapper` 分支）。
- ✅ **F2（`markdown-body--editing`）**：`src/components/MarkdownDocument.tsx:638-644` 与 `markdown-body--mdlog` 并列拼接，`:647` 落到 `<article>`；双向断言在 `src/components/MarkdownDocument.test.tsx:1056`（有）与 `:1061`（无）。
- ✅ **F3（不新增依赖 + 选项式工厂）**：diff 未触碰 `package.json`（本次 diff 仅 4 个文件）；`rehypeEditUnits({ units })` 见 `src/lib/rehypeEditUnits.ts:77`；单测直接构造 hast 字面量（`src/lib/rehypeEditUnits.test.ts:1-45`），未引入 `rehype-stringify`。
- ✅ **DOM 契约**：`data-vellum-unit` 见 `rehypeEditUnits.ts:30`（并叠加 `:63` 内层 pre）、`data-vellum-locked` 见 `:31-33`；端到端实证 `MarkdownDocument.test.tsx:1052-1055`（h1/p）、`:1080`（widget 容器）、`:1097`（html）。
- ✅ **阅读视图零泄漏（四处逐个查过）**：①插件只在 editable 时进管线 `MarkdownDocument.tsx:353`（否则 `editPlugins = []`）；②`onClick` 条件挂载 `:647`；③`unitMarkProps()` 返回 `undefined` 见 `:226-236` → React 不输出 `undefined` 属性（阅读视图断言 `:1060-1061`）；④`<pre>` 外包只在插件内部发生，阅读视图无插件=无容器。四处均无漏项。
- ✅ **`useMemo` 依赖**：`units` `:613`（`[editable, markdown]`）、`editUnitOptions` `:348`（`[units]`）、`rehypePlugins` `:350,366`（`[hasRawHtml, searchQuery, editable, editUnitOptions]`）。无漏项、无多余项：`editable` 变才加插件，`editable` 不变时 `editUnitOptions` 引用不变 → 不会每次渲染重建数组触发整篇重解析。
- ✅ **性能红线**：diff 未触碰 `CodeBlock.tsx`、`PrismLight`、搜索高亮/layout effect、`WidgetSandbox`。
- ✅ **偏差 2（未执行计划步骤 5.4 的 `data*` 白名单）**：**裁决为正确做法**，但属计划文本偏差，须控制器登记。证据：`MarkdownDocument.tsx:201` 的 `"*"` 白名单无 `data*`；插件位于 `[rehypeSanitize, kamiSchema]` 之后（`:355-358`），标记不经 sanitize；若按计划追加 `data*`，任何含 `data-*` 的文档在**阅读视图**的渲染结果都会变化（如实测 `<div class="x" data-foo="1">` 现在被剥离），直接违反本任务首要不变量。报告第 4 节已声明该偏差，⚠️ 需控制器在 `rulings.md` 补登（否则后续任务可能按计划回填 `data*` 并引入阅读视图漂移）。
- ⚠️ **偏差 1（`<pre>` 一律外包 `.vellum-unit-wrap`）**：属「合理但未登记的超出计划」——范围放宽部分已登记（报告第 4 节），但**其与 T7 `display: contents` 的相互作用未登记，且对 caret 计算有实质影响**，见 Important-1。
- ⚠️ **计划 `MATH_CLASSES`/`isReplacedByKatex` 被替换为 `needsWrapper = tagName === "pre"`**：`rehypeEditUnits.ts:21-23`。功能上是原判定的超集，未违反简报 DOM 契约（简报未限制包裹层数量），但改变了编辑视图结构，须与 T7 的 CSS 契约同步（见 Important-1）。
- ⚠️ **跨任务状态**：本审查提交所依赖的 `src/lib/editUnits.ts` 在 head 3ad0f80 上仍是**未含 F7/F8/F9a/F10 的版本**（当时读到的 `reason` 联合仍含 `"unmapped"`、`collectUnits` 仍强制 `listItem`/`blockquoteChild`、无重叠归一、`start` 未对齐行首）。这会让 T2 的 `data-vellum-locked` 在**嵌套**（引用/列表内）HTML 与 widget 上不出现、点击时走 `onActivateUnit` 而非 `onLockedUnitClick`（`MarkdownDocument.tsx:625-629`）。审查期间该文件被另一会话改写（mtime 12:56:21），改写后 T2 的聚焦测试仍全绿（见下），但**该改写未提交且当前 tsc 不过**，属控制器需处理的集成状态。
- ⚠️ **无法仅凭 diff 验证项**：真机 WebView2 下 `display: contents` 包裹层的 `getBoundingClientRect()` 读数（见 Important-1）；编辑视图是否已在 App 层接线（本任务未做，符合范围）。

### Strengths
- 阅读视图不变量在四个泄漏点上都做了结构性防护（`:353`、`:647`、`:226-236`），并且有阅读侧反向断言（`MarkdownDocument.test.tsx:1060-1061`），不是只测「编辑视图有」。
- memo 契约落实到位：`units`/`editUnitOptions`/`rehypePlugins` 三层 memo 依赖精确（`:348`、`:350-366`、`:613`），插件数组不会因无关状态重建。
- 「不追加 `data*` 白名单」的取舍正确，且理由可复核（`:201` 白名单、`:355-358` 插件位序）——避免为了通过计划步骤而放宽阅读视图 sanitize，这是本任务最有价值的自我纠偏。
- `rehypeEditUnits.ts:79` 的 `units.length === 0` 早退，使「空单元⇒零标记」成为结构性保证而非约定；单测 `rehypeEditUnits.test.ts` 末例断言 `Object.keys(properties)` 为空，验证的是真实行为不是 mock。
- 新增的 5 个单测里有 2 个是**负向**用例（跨多单元容器不打标、空单元零标记），比计划给的三例更接近真实风险面。
- 端到端用例走真实 unified 管线（非 mock），且额外补了 raw html 与 katex 两条路径（`MarkdownDocument.test.tsx:1086-1109`）。

### Issues

#### Critical (Must Fix)
**C1. 裁定 F9b 未落地：caret 偏移按含 `\r` 的原文算，textarea 侧是 LF 归一 ⇒ CRLF 文档点击后光标偏。**
`src/components/MarkdownDocument.tsx:632-633`：`const source = markdown.slice(unit.start, unit.end); onActivateUnit?.(index, caretOffsetForRatio(source, ratio));` —— 未做 `.replace(/\r\n/g, "\n")`。`src/lib/editUnits.ts:154-155` 的 `caretOffsetForRatio` 以 `"\n"` 切行并把每行长度 `+1`，行尾残留的 `\r` 会被计入：`"行一\r\n行二"` → 返回 4，而 LF 归一文本里第二行行首是 3，**每多一行偏差 +1**。
为何要紧：F9b 明文规定「此裁定跨 T2/T4：**T2 的点击回调算 caret 前先归一**」；caret 偏移完全由 T2 产出，T4 只是消费，只在 T4 归一会让偏移与文本系统性错配。Windows 上 CRLF 是常态（Rust 侧 `dominant_eol` 还原 CRLF），属真机可见缺陷。且现有测试对这个值只用 `expect.any(Number)`（`MarkdownDocument.test.tsx:1078`），整条 caret 路径（含归一）**零覆盖**。
如何修：`:632` 改为 `markdown.slice(unit.start, unit.end).replace(/\r\n/g, "\n")`；补一条聚焦用例（多行块 + stub `getBoundingClientRect` + CRLF 文档，断言精确 offset）。

#### Important (Should Fix)
**I1. `<pre>` 包裹层 × T7 `display: contents` ⇒ 被包裹块的 caret 比率恒为 0（edit 视图）。**
`MarkdownDocument.tsx:630-633` 用 `target.getBoundingClientRect()` 算比率；而 `target = event.target.closest("[data-vellum-unit]")` 对被包裹的代码块/数学块/widget 只会命中包裹层——因为自定义 `pre` 组件丢弃 hast 属性（`:441` 起、fallback `:490`），DOM 里唯一带标记的节点是 `<div class="vellum-unit-wrap" data-vellum-unit>`。裁定 F2/T7 计划又给该包裹层 `display: contents`（`rulings.md` F2 引用的 T7 规则），而 `display: contents` 元素自身不生成布局盒，Chromium 历史上 `getBoundingClientRect()` 对其返回全 0 ⇒ `rect.height > 0` 为假 ⇒ ratio 恒 0 ⇒ 点代码块任意位置都落在块首行。
为何要紧：这正是 T2 自己引入的包裹策略与后续任务 CSS 的相互作用，报告第 5 节只登記了「若 T7 漏写 `display: contents` 会多一层盒子」，**没有登记反向风险**；我做过一次聚焦检查确认数据通路（见下命令 4），但 Chromium 对 `display:contents` 的 rect 行为需 WebView2 实测。
如何修（择一）：`target.firstElementChild ?? target`（或 `target.getClientRects()[0]` 兜底）作为度量盒；或 T7 改用一个不参与 `closest` 命中的度量源；并与 T3 约定一个集成断言。风险已点名、检查内容为「被包裹块的 rect 是否为 0」。

**I2. 阅读视图「逐字节一致」缺少针对 `<pre>` 覆盖路径的断言。**
新增的阅读视图断言用的文档是 `"# 标题\n\n正文\n"`（`src/components/MarkdownDocument.test.tsx:1059-1061`），**不含任何围栏**；而本任务风险最高的结构改动恰是「所有 `<pre>` 外包」（`src/lib/rehypeEditUnits.ts:21-23`、`:53-62`）。阅读视图无容器目前只靠「插件不入管线」推理成立，没有测试锁定。
如何修：补一条阅读视图用例（含 ``` 代码块 + ```vellum-widget 的文档），断言 `container.querySelector(".vellum-unit-wrap")` 为 `null`、`[data-vellum-unit]` 计数为 0；更硬的做法是对阅读视图 `article.innerHTML` 做快照。

**I3. caret 相关行为无任何断言（测试放水）。**
`MarkdownDocument.test.tsx:1078` 仅断言 `expect.any(Number)`；`rect.height === 0`/负比率（键盘触发点击时 `clientY === 0`）分支也没有用例。C1 正是被这个空隙放过的。
如何修：stub `Element.prototype.getBoundingClientRect`，对 2×2 场景（块首/块中、LF/CRLF）断言精确 offset；顺带覆盖 `clientY < rect.top` 的钳制。

**I4. 单测的区间期望来自被测对象自身，无法发现 hast 位置与单元区间的错配；真实管线的 raw HTML 用例只覆盖 offset 0 的场景。**
`src/lib/rehypeEditUnits.test.ts:41-45` 用 `buildEditUnits(markdown)` 的结果当 hast 字面量的 position，因而「区间与解析器位置一致」这一前提被假设而非验证；端到端的 raw HTML 用例（`MarkdownDocument.test.tsx:1090-1098`）文档恰好就是该 html 块（起点 0），**offset 0 时「相对/绝对」无法区分**。
我按「点名风险⇒一次聚焦检查」原则核实过：`hast-util-raw` 会把 raw 值写进 tokenizer 前先 `setPoint` 到该节点起点（`node_modules/hast-util-raw/lib/index.js:334`、`:467-482`），实测 `'第一段\n\n<div class="x">hi</div>\n\n末段\n'` 的位置为 `p 0-3 / div 5-28 / p 30-32`（全文 33 字符）⇒ **绝对偏移，无缺陷**。但这条保证目前没有测试锁定。
如何修：给 raw HTML 用例的文档加一个前置段落（如 `"前段\n\n<div>x</div>\n"`），断言第二个块的索引/锁定标记落在正确的 div 上。

#### Minor (Nice to Have)
**M1. 内层 `<pre>` 的标记是死负载，且嵌套元素也被打标。**
`rehypeEditUnits.ts:63` 给内层 `pre` 也写了 `data-vellum-unit`，但 DOM 由自定义 `pre` 渲染（`MarkdownDocument.tsx:441-490`，不透传属性）⇒ 该标记在最终 DOM 中不存在；真正承载契约的只有 `:62` 的包裹层。同理段落内的行内 `code`（自定义组件 `:492-496` 会 `{...props}` 透传）会带上块标记 ⇒ `querySelectorAll("[data-vellum-unit]").length` 一般**不等于**单元数，后续任务若用它数块会误判。建议：只对块级标签打标，或在文件头注释里显式声明「标记可能出现在任意嵌套元素上」。

**M2. DOM 契约知识被拆到两个文件。**
`unitMarkProps`（`MarkdownDocument.tsx:226`）与 `needsWrapper`（`rehypeEditUnits.ts:21`）是同一条事实（自定义 components 丢弃 hast 属性）的两半，分居组件与 lib。建议把 `unitMarkProps` 移到 `src/lib/rehypeEditUnits.ts` 旁边，避免将来只改一处。

**M3. 点击语义的两个可预期交互未登记。**
`MarkdownDocument.tsx:616` 的 `handleClick` 挂在 `<article>` 上：①编辑视图点链接会**同时**触发 `a` 的 `openUrl`（`:425-437`）与 `onActivateUnit`，编辑器会在系统浏览器打开的同时弹出；②可交互 widget 的 iframe 有 pointer-events，点击被跨源帧吸收，`onLockedUnitClick("widget")` 不会触发（静态 widget 因 `mdlog-widget__frame--static` 不受影响）。交 T3/T6 决策，但应现在就登记，否则会被当成实现 bug。

**M4. `Number(getAttribute())` 的 `NaN`/`null` 分支虽不可达，但无守卫也无注释。**
`MarkdownDocument.tsx:620`：`closest("[data-vellum-unit]")` 保证属性存在，`data*` 被 sanitize 剥离（`:201`），故取值恒为数字；`Number(null) === 0` 若成立会误激活 0 号块。当前不可达（安全性来自别处），建议加一行 `Number.isInteger` 守卫或注释说明不变量来源；`units.find(c => c.index === index)`（`:622`）同理可注释。

### 环境观察（非本任务缺陷，但影响关口结论）
- 审查期间工作区被并发改写：`src/lib/editUnits.ts` mtime `2026-09-10 12:56:21`（我 12:52 读到的还是未含 F7/F8/F9a/F10 的版本）。`git status --short`：` M src/lib/editUnits.ts`、` M src/lib/editUnits.test.ts`、` M docs/...plan.md`（未提交）。⇒ **本任务的 `npx tsc --noEmit` 关口无法在当前工作区独立复核**：我 12:56 跑出的 6 个错误全部在 `src/lib/editUnits.ts`（另一任务的半成品：`Parent` 未使用、`Node` 上无 `lang`/`children`），T2 的四个文件**零错误**。提交态 3ad0f80 本身的 tsc 洁净性我只能采信报告（其声称 exit 0）而未能复现，原因是该文件在我复核时被外部改动。

### 我实际跑过的命令与输出摘要
1. `npx vitest run src/lib/rehypeEditUnits.test.ts src/components/MarkdownDocument.test.tsx`（12:55:12，修改前状态）→ `Test Files 2 passed (2) / Tests 55 passed (55)`（5 单测 + 50 组件用例）；在并发改写 `editUnits.ts` 之后（12:56:53）重跑一次 → 同样 `2 passed / 55 passed` ⇒ **T2 的聚焦测试真实通过**，且对 T1 的 F7/F8/F9a/F10 改写不敏感。未重跑整套（遵守指令），故 `npm test` 的 28/304 全绿仍为报告声明。
2. `npx tsc --noEmit` → `TSC_EXIT=2`，6 条错误全在 `src/lib/editUnits.ts`（见「环境观察」）；T2 文件无错误。
3. `node --input-type=module` + `unified/remark-parse/remark-rehype/rehype-raw` 位置探针 → `p 0 3 / div 5 28 / p 30 32`，`len 33` ⇒ raw HTML 的 hast position 是绝对文档偏移（I4 的风险已排除，仅缺测试）。
4. `node --input-type=module` + `property-information`：`find(html,'data-vellum-unit')` → `{"attribute":"data-vellum-unit","property":"dataVellumUnit"}`（无 `space`）；`hast-util-to-jsx-runtime/lib/index.js:586-621` 的 `createProperty` 在无 `space` 时返回 `info.attribute` ⇒ 自定义组件收到的是短横线键 `"data-vellum-unit"`，`:226-236` 读短横线键**正确**，默认渲染的元素（p/div/h4+）也输出短横线属性 ⇒ `closest("[data-vellum-unit]")` 有效（第 1 项疑点据此排除）。
5. `grep -n "> pre|pre >|first-child|nth-child" src/styles/kami.css` → 无对 `article`/`.markdown-body` 直接子元素的 `pre` 结构性选择器（命中的只有 `.markdown-body pre`（`:985` 起，后代选择器）与 `.markdown-body--mdlog blockquote > p:first-child`（`:1245` 起））⇒ 新增包裹层**不破坏既有 CSS**，但见 I1 的 rect 问题。
6. `git status --short` / `ls -l --time-style=full-iso` → 见「环境观察」。

### Assessment
**Task quality:** Needs fixes
**Reasoning:** 结构与规约执行质量高（F1/F2/F3 全落实、阅读视图四处泄漏点均封住、memo 依赖精确、主动拒绝了会放宽 sanitize 的计划步骤），但**裁定 F9b 明确指派给 T2 的 `\r\n` 归一未实现**（`MarkdownDocument.tsx:632`）且 caret 数值零测试覆盖；此外 `<pre>` 一律外包与 T7 `display: contents` 的相互作用会让被包裹块的 caret 比率恒为 0（`MarkdownDocument.tsx:630-633`），而阅读视图「逐字节一致」对 `<pre>` 路径没有断言（`MarkdownDocument.test.tsx:1059-1061`）。三项均为小改动可修，修完即可通过。
