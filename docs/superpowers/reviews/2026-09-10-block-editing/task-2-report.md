# Task 2 报告：rehype 块标记插件 + 点击解析（仅编辑视图启用）

- **状态**：DONE_WITH_CONCERNS（实现与测试全绿；存在 2 处与计划文本的自觉偏差、1 处待控制器确认的设计扩展，见第 4 节）
- **提交**：`3ad0f80` — `feat(edit): rehype 块标记插件与点击解析（仅编辑视图启用，阅读视图 DOM 不变）`（单次提交，4 个文件，+423/-12）
- **分支**：master
- **基线 → 现状**：`npm test` 27 文件 / 295 用例 → **28 文件 / 304 用例全绿**；`npx tsc --noEmit` 退出码 0

---

## 1. 改动文件清单

| 文件 | 类型 | 内容 |
|---|---|---|
| `src/lib/rehypeEditUnits.ts` | 新增 | `rehypeEditUnits({ units })` 选项式工厂（unified 惯用法，裁定 F3）；遍历 hast、按源码区间打 `data-vellum-unit` / `data-vellum-locked`；包含判定复用 `findUnitForRange`（裁定 F1）；`<pre>` 外包 `.vellum-unit-wrap` 容器承载标记 |
| `src/lib/rehypeEditUnits.test.ts` | 新增 | 5 个单测，直接构造 hast 节点字面量调用变压器（裁定 F3：不装 `rehype-stringify`） |
| `src/components/MarkdownDocument.tsx` | 修改 | 新增 3 个 props；`units`/插件选项的 `useMemo`；编辑视图把插件插入 sanitize 之后、搜索高亮之前；h1/h2/h3 交还块标记属性；article 加 `markdown-body--editing`（裁定 F2）与 `onClick` 解析块索引 + 光标比率 |
| `src/components/MarkdownDocument.test.tsx` | 修改 | 追加 4 个 `editable` 模式用例（下文逐条列出） |

**未改动**：`src/lib/editUnits.ts`（T1 交付，直接 import）；`sanitize` schema 的 `data*` 白名单（偏差 2，见下）；任何 Task 3+ 文件（`BlockEditor` / `useDocumentEditor` / Rust / App / 样式）。

### 1.1 交付接口（与简报一致）

```ts
export type RehypeEditUnitsOptions = { units: EditUnit[] };
export function rehypeEditUnits(options: RehypeEditUnitsOptions): (tree: unknown) => void;

type MarkdownDocumentProps = {
  editable?: boolean;
  onActivateUnit?: (index: number, caretOffset: number) => void;
  onLockedUnitClick?: (reason: "html" | "widget") => void;
};
```

DOM 契约（编辑视图）：`data-vellum-unit="<index>"`（可编辑与不可编辑块都有）；不可编辑块额外 `data-vellum-locked="html|widget"`；`<article>` 带 `markdown-body--editing`。

---

## 2. 验证命令与真实输出

| # | 命令 | 输出 / 结论 |
|---|---|---|
| 1 | `npx vitest run src/lib/rehypeEditUnits.test.ts`（实现前） | **FAIL（red）**：`Failed to resolve import "./rehypeEditUnits"`，`Tests no tests`，退出码 1 |
| 2 | `npx vitest run src/lib/rehypeEditUnits.test.ts`（实现后） | `Test Files 1 passed (1)` / `Tests 5 passed (5)` |
| 3 | `npx vitest run src/components/MarkdownDocument.test.tsx`（接线前） | **FAIL（red）**：新增 2 用例失败 —— `expected +0 to be 2`、`expected "vi.fn()" to be called with arguments: [ +0, Any<Number> ]`；`Tests 2 failed | 46 passed (48)` |
| 4 | `npx vitest run src/components/MarkdownDocument.test.tsx`（接线后，含追加的 2 用例） | `Test Files 1 passed (1)` / `Tests 50 passed (50)` |
| 5 | `npm test`（提交后，全新运行） | `Test Files 28 passed (28)` / `Tests 304 passed (304)`，`Duration 7.41s` |
| 6 | `npx tsc --noEmit` | 无输出，`TSC_EXIT=0` |
| 7 | `git status --short`（提交后） | 仅剩任务开始前就存在的 `.pi/agents/*` 变动（非本任务产物，未提交）；工作区无其他残留 |
| 8 | `ls outputs/__audit_scratch` | 探针跑完即删，空目录已 `rmdir`（不残留） |

### 2.1 新增用例（红→绿逐条）

`src/lib/rehypeEditUnits.test.ts`（直接调用插件变压器）：
1. 按源码区间给块元素打上与 `editUnits` 一致的索引（h1→0、p→1）
2. 不可编辑块额外打上 locked 标记（raw html → `"html"`；vellum-widget 围栏 → `"widget"`）
3. 块级公式的 `pre` / 代码块的 `pre` 由外层容器承载标记（容器 class + 索引 + 原 pre 仍是唯一子节点）
4. 跨多个块区间的容器不被打标（blockquote 情形），区间内的子块照常打标
5. `units` 为空（阅读视图等价情形）时整棵树不产生任何标记（含 `Object.keys(properties)` 为空）

`src/components/MarkdownDocument.test.tsx`（端到端 DOM）：

6. 编辑视图下块元素带 `data-vellum-unit`（数量 2，且 `[data-vellum-unit="0"]` 是 `H1`、`="1"` 是 `P`）且 `<article>` 带 `markdown-body--editing`；阅读视图下两者都不存在（裁定 F2 要求的双向断言）
7. 点击可编辑块回调索引（`onActivateUnit(0, expect.any(Number))`），点击只读 widget 块回调 `"widget"` 且不触发激活
8. 点击原始 HTML 只读块回调 `"html"`（locked reason 映射的默认分支）
9. 编辑视图下块级公式的标记落在 katex 替换后仍存活的外包容器上（`.katex-display` 存在 + `.vellum-unit-wrap[data-vellum-unit="0"]` 存在）

### 2.2 真机 DOM 结构抽查（一次性探针，已删除）

编辑视图实测 `innerHTML`（节选）：

- `$$ a = b $$` → `<div class="vellum-unit-wrap" data-vellum-unit="0"><span class="katex-display">…</span></div>`
- ```` ```vellum-widget … ``` ```` → `<p data-vellum-unit="0">正文</p><div class="vellum-unit-wrap" data-vellum-unit="1" data-vellum-locked="widget"><div class="mdlog-widget">…（占位块，未自动挂载）…</div></div>`
- ```` ```ts … ``` ```` → `<div class="vellum-unit-wrap" data-vellum-unit="0"><div class="code-block">…</div></div>`
- 阅读视图 `# 标题\n\n正文\n` → `<article class="markdown-body"><h1 id="标题">标题</h1><p>正文</p></article>`（无任何新增属性/类/包裹层）

---

## 3. 裁定遵循情况

| 裁定 | 落实情况 |
|---|---|
| **F1** 包含判定复用 `findUnitForRange` | ✅ `rehypeEditUnits.ts` 内 `import { findUnitForRange, type EditUnit } from "./editUnits"` 并调用；插件内无任何内联区间判定。索引反查（`units.find(u => u.index === index)`）是 O(1) 索引查找而非包含判定，未复用该函数 |
| **F2** `editable === true` 时给 `<article>` 加 `markdown-body--editing` | ✅ 与 `markdown-body--mdlog` 并列，由 `articleClassName` 数组拼接；用例 6 双向断言（编辑视图有、阅读视图无） |
| **F3** 不装 `rehype-stringify`，插件 API 改为 `rehypeEditUnits({ units })` | ✅ 未新增任何依赖（`package.json` 零改动）；单测直接构造 hast 字面量调用变压器；`MarkdownDocument` 内以 `[rehypeEditUnits, editUnitOptions]` 挂载 |
| 全局约束：阅读视图 DOM 逐字节一致 | ✅ 插件仅在 `editable` 为真时接入管线；h1/h2/h3 交还的属性在阅读视图为 `undefined`（React 不输出属性）；`onClick` 仅在 editable 时挂；46 个原有 `MarkdownDocument` 用例与 295 基线用例全绿 |
| 全局约束：`MarkdownBody` props 引用稳定 / 插件选项 `useMemo` | ✅ `units` ← `useMemo([editable, markdown])`；`editUnitOptions` ← `useMemo([units])`；`rehypePlugins` ← `useMemo([hasRawHtml, searchQuery, editable, editUnitOptions])`；`components` 的 memo 依赖未变；未触碰 `CodeBlock` 的 `PrismLight` |
| 性能红线（本任务相关部分） | ✅ 未触碰 `PrismAsyncLight`、未改搜索高亮/layout effect 逻辑、未改 `WidgetSandbox`；阅读视图不构建块单元（`editable ? buildEditUnits(markdown) : []`） |

---

## 4. 与计划文本的偏差（需控制器知悉 / 确认）

### 偏差 1（有意扩展，影响 DOM 契约的覆盖范围）：`<pre>` 一律外包 `.vellum-unit-wrap`

- **计划代码**：只为「会被 rehype-katex 整体替换」的节点外包容器。
- **实际**：`needsWrapper(element) = element.tagName === "pre"` —— 所有 `<pre>` 都外包，理由是计划漏掉的第二个替换点：`MarkdownDocument` 的 `components.pre` 覆盖渲染（`CodeBlock` / `WidgetSandbox`）**不透传 hast 属性**，若不外包，代码块与 widget 的 `data-vellum-unit` / `data-vellum-locked` 永远到不了 DOM，简报里自己写的用例（点击 `[data-vellum-locked="widget"]`）也无法成立。
- **同源第二处**：`components.h1/h2/h3` 同样接管渲染并丢弃属性，故新增 `unitMarkProps()` 只交还 `data-vellum-unit` / `data-vellum-locked` 两个属性（不透传 `node` 等内部 prop）。没有这处，简报中「编辑视图块元素带 `data-vellum-unit` 共 2 个」也会失败（只有 `<p>` 命中）。
- **代价**：编辑视图的 DOM 比计划多出若干 `.vellum-unit-wrap` 包裹（数学块原本就有）；由 T7 的 `.markdown-body--editing .vellum-unit-wrap { display: contents }` 退布局。阅读视图不受影响。
- **实测**：2.2 节结构抽查确认三种 `pre` 场景下标记均存活。

### 偏差 2（有意不执行）：`kamiSchema.attributes["*"]` **未**追加 `"data*"`

- **计划步骤 5.4** 要求追加；**未执行**，理由两条：
  1. **不必要**：插件插在 `[rehypeSanitize, kamiSchema]` **之后**，标记属性根本不经过 sanitize（用例 6/7/8/9 即端到端证据）。
  2. **有害**：schema 是阅读视图与编辑视图共用的模块常量，追加 `data*` 会放宽阅读视图的 sanitize 白名单，直接违反「阅读视图 DOM 逐字节一致」。探针实测：当前 `<div class="x" data-foo="1">hi</div>` 在阅读视图渲染为 `<div class="x">hi</div>`（`data-foo` 被剥离）；追加后该文档的阅读视图 DOM 会变化。
- **若审查坚持**：可改为「编辑视图专用的派生 schema」（`editable ? kamiEditingSchema : kamiSchema`）以同时满足计划步骤与逐字节约束；当前判为 YAGNI，未实现。

### 偏差 3（无关紧要）：`MarkdownDocument` 的 props 解构与 `article` 写法

计划步骤 5 只给片段；实际实现把 `MarkdownDocument` 的形参改为多行解构、`className` 改由数组拼接（避免 editable 与 mdlog 两个类的条件嵌套）、`onClick={editable ? handleClick : undefined}`（阅读视图不挂点击）。语义与计划一致。

### 未偏离但值得记录

- 索引反查用 `units.find`（简报原文），F1 针对的是「区间包含判定」，二者不冲突。
- 嵌套元素（如段落里的 `strong`、`table` 里的 `tr`）也会被同一个 unit 打标（简短 walk 的自然结果）；`closest()` 取最内层，索引仍正确，故保留计划的简洁实现。

---

## 5. 未解决项 / 留给后续任务

1. **T7 的 CSS 依赖**：`.vellum-unit-wrap` 目前无任何样式（编辑视图尚未接线到 App，无视觉影响）。若 T7 漏写 `display: contents`，数学块/代码块/widget 会多一层块级盒子 → 视觉回归。**F2 的类名已在 T2 落地**，CSS 仍待 T7。
2. **点空区域不激活**：块间空白与 `<blockquote>` 自身的 `>` 前缀不属于任何 unit，点击无回调（`closest` 返回 null），符合契约但为交互慢点，交 T3/T6 观察。
3. **不可编辑块的视觉提示**：`onLockedUnitClick` 的消费方（提示 UI）在 T3+，本任务只负责回调。
4. **`reason: "unmapped"`**：T1 类型里存在但当前不会产生；若将来出现，点击会按 `"html"` 分支回调（`unit.reason === "widget" ? "widget" : "html"`）。
5. 未跑 `cargo test`：本任务零 Rust 改动（`src-tauri` 未触碰）。
