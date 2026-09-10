# Vellum 块级就地编辑 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **本项目约定：不派子智能体**，一律走 `superpowers:executing-plans` 的 inline execution。

**Goal:** 给 Vellum 加「默认渲染、点击块就地改源码、点走即落盘」的编辑视图，HTML 与交互块结构性只读。

**Architecture:** 编辑面沿用现有渲染管线与滚动容器，不引入编辑器内核（无 CodeMirror）。块单元由 mdast 位置切分（纯函数），rehype 插件按源码区间给块元素打 `data-vellum-unit` 标记，点击时把该块就地换成绝对定位的 textarea，提交时整篇重解析一次并原子写盘。

**Tech Stack:** React 19 + TypeScript + Vite 8 / Vitest + jsdom / Tauri 2 + Rust（`notify` 监听、`std::fs` 原子写）。

**Spec:** `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md`

## Global Constraints

- **不新增任何运行时依赖库**；`mdast-util-from-markdown` + `micromark-extension-gfm` 已在入口 chunk，直接复用。
  **唯一例外**：把 `mdast-util-math` + `micromark-extension-math`（`remark-math` 已有的传递依赖，`3.0.0` / `3.1.0`，已装在 node_modules）提升为**直接依赖** —— 单元切分的解析配置必须与渲染管线一致（渲染挂了 `remark-math`），否则 `$$…$$` 的区间会与渲染树漂移。**不增安装、不增体积**。
- **禁止**把 `CodeBlock.tsx` 的 `PrismLight` 切回 `PrismAsyncLight`
- `MarkdownDocument.tsx` 的 `MarkdownBody` 已 memo 化：传给它的所有 props 必须引用稳定（回调 `useCallback`、对象 `useMemo`）
- `src/styles/kami.css` 新增规则**必须位于首个 `.mdlog-widget` 之前**，且区段内不得出现 `.mdlog-widget` 字样（`kami.css.test.ts` 从首个出现处扫到文件尾）
- 阅读视图（`editable === false`）的 DOM 必须与改动前**逐字节一致**：标记插件与数学块包裹只在编辑视图启用
- 提交**不递增 `reloadTick`**、不播放「墨迹未干」印章
- mdlog 记录中一律禁止进入编辑视图（前端门禁 + Rust 侧 `save_document` 二次闸门）
- 测试命令：`npm test`（全量，基线 26 文件 / 280 用例）、`npx vitest run <file>`（单文件）、`cd src-tauri && cargo test`
- 提交信息风格：`feat(scope): 中文描述` / `test(...)` / `fix(...)`，一次任务一次提交
- 每个任务结束时必须 `npm test` 全绿 + `npx tsc --noEmit` 通过

---

### Task 1: 块单元纯函数 `editUnits`

**Files:**
- Create: `src/lib/editUnits.ts`
- Test: `src/lib/editUnits.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  ```ts
  export type EditUnitKind =
    | "paragraph" | "heading" | "listItem" | "blockquoteChild"
    | "table" | "code" | "math" | "thematicBreak" | "html" | "widget" | "other";
  export type EditUnit = {
    index: number; start: number; end: number; kind: EditUnitKind;
    editable: boolean; reason?: "html" | "widget" | "unmapped";
  };
  export function buildEditUnits(markdown: string): EditUnit[];
  export function findUnitForRange(units: EditUnit[], start: number, end: number): EditUnit | undefined;
  export function spliceUnit(markdown: string, unit: EditUnit, text: string): string;
  export function caretOffsetForRatio(text: string, ratio: number): number;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/editUnits.test.ts
import { describe, expect, it } from "vitest";
import { buildEditUnits, caretOffsetForRatio, findUnitForRange, spliceUnit } from "./editUnits";

const kinds = (markdown: string) => buildEditUnits(markdown).map((u) => u.kind);

describe("buildEditUnits", () => {
  it("把顶层节点各切一块，区间排序且互不重叠", () => {
    const markdown = "# 标题\n\n第一段。\n\n第二段。\n";
    const units = buildEditUnits(markdown);
    expect(units.map((u) => u.kind)).toEqual(["heading", "paragraph", "paragraph"]);
    for (let i = 1; i < units.length; i += 1) {
      expect(units[i].start).toBeGreaterThanOrEqual(units[i - 1].end);
    }
    expect(units.every((u) => u.start >= 0 && u.end <= markdown.length)).toBe(true);
    expect(units.every((u) => u.end > u.start)).toBe(true);
  });

  it("list 下钻到每个 listItem", () => {
    expect(kinds("- 一\n- 二\n- 三\n")).toEqual(["listItem", "listItem", "listItem"]);
  });

  it("blockquote 下钻到直接子块，且不再继续深钻", () => {
    expect(kinds("> 第一段\n>\n> 第二段\n")).toEqual(["blockquoteChild", "blockquoteChild"]);
    // 引用里的列表整体作为一块，不再下钻到 listItem
    expect(kinds("> - 一\n> - 二\n")).toEqual(["blockquoteChild"]);
  });

  it("块级 HTML 与 mdlog 头注释不可编辑", () => {
    const units = buildEditUnits("<!-- mdlog:v1 -->\n\n<div class=\"x\">hi</div>\n\n正文。\n");
    expect(units[0].editable).toBe(false);
    expect(units[0].reason).toBe("html");
    expect(units[1].editable).toBe(false);
    expect(units[2].editable).toBe(true);
  });

  it("vellum-widget 围栏不可编辑", () => {
    const units = buildEditUnits("```vellum-widget\n<div>x</div>\n```\n");
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("widget");
    expect(units[0].editable).toBe(false);
    expect(units[0].reason).toBe("widget");
  });

  it("普通代码围栏可编辑", () => {
    const units = buildEditUnits("```ts\nconst a = 1;\n```\n");
    expect(units[0].kind).toBe("code");
    expect(units[0].editable).toBe(true);
  });

  it("行内 HTML 归属所在段落，段落整体可编辑", () => {
    const units = buildEditUnits("带 <span>行内</span> 标签的段落。\n");
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("paragraph");
    expect(units[0].editable).toBe(true);
  });

  it("$$ 公式块可编辑", () => {
    const units = buildEditUnits("$$\na = b\n$$\n");
    expect(units[0].kind).toBe("math");
    expect(units[0].editable).toBe(true);
  });

  it("CRLF 文档的区间按原文偏移计算", () => {
    const markdown = "# 标题\r\n\r\n正文\r\n";
    const units = buildEditUnits(markdown);
    expect(units).toHaveLength(2);
    expect(markdown.slice(units[1].start, units[1].end)).toBe("正文");
  });

  it("空文档返回空数组", () => {
    expect(buildEditUnits("")).toEqual([]);
    expect(buildEditUnits("\n\n  \n")).toEqual([]);
  });
});

describe("spliceUnit", () => {
  it("替换块内容且不触碰块外空白", () => {
    const markdown = "# 标题\n\n第一段。\n\n第二段。\n";
    const units = buildEditUnits(markdown);
    const next = spliceUnit(markdown, units[1], "改过的第一段。");
    expect(next).toBe("# 标题\n\n改过的第一段。\n\n第二段。\n");
  });

  it("同文本替换是幂等的", () => {
    const markdown = "正文。\n";
    const unit = buildEditUnits(markdown)[0];
    expect(spliceUnit(markdown, unit, "正文。")).toBe(markdown);
  });
});

describe("caretOffsetForRatio", () => {
  const text = "第一行\n第二行\n第三行\n";

  it("比率 0 落在首行行首，比率 1 落在末个可见行行首（尾随空行不计）", () => {
    expect(caretOffsetForRatio(text, 0)).toBe(0);
    expect(caretOffsetForRatio(text, 1)).toBe(8);
  });

  it("中间比率落在对应行行首", () => {
    expect(caretOffsetForRatio(text, 0.5)).toBe(4);
  });
});

describe("findUnitForRange", () => {
  it("命中包含该区间的块，区间外返回 undefined", () => {
    const markdown = "# 标题\n\n正文\n";
    const units = buildEditUnits(markdown);
    expect(findUnitForRange(units, units[1].start, units[1].end)?.index).toBe(units[1].index);
    expect(findUnitForRange(units, markdown.length, markdown.length)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/editUnits.test.ts`
Expected: FAIL —— `Failed to resolve import "./editUnits"`

- [ ] **Step 3: 实现**

```ts
// src/lib/editUnits.ts
import type { Node, Parent, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";

/// 解析扩展必须与渲染管线（MarkdownDocument 的 REMARK_PLUGINS）一致：
/// 渲染挂了 remark-gfm 与 remark-math，切分若少挂一个，区间就会与渲染树错位。
const PARSE_OPTIONS = {
  extensions: [gfm(), math()],
  mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
} as const;

export type EditUnitKind =
  | "paragraph" | "heading" | "listItem" | "blockquoteChild"
  | "table" | "code" | "math" | "thematicBreak" | "html" | "widget" | "other";

export type EditUnit = {
  index: number;
  start: number;
  end: number;
  kind: EditUnitKind;
  editable: boolean;
  reason?: "html" | "widget" | "unmapped";
};

type Positioned = { position?: { start?: { offset?: number }; end?: { offset?: number } } };

function rangeOf(node: Node): { start: number; end: number } | null {
  const positioned = node as Node & Positioned;
  const start = positioned.position?.start?.offset;
  const end = positioned.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number" || end <= start) return null;
  return { start, end };
}

function kindOf(node: Node): EditUnitKind {
  if (node.type === "code") {
    return (node as { lang?: string }).lang === "vellum-widget" ? "widget" : "code";
  }
  switch (node.type) {
    case "paragraph": return "paragraph";
    case "heading": return "heading";
    case "table": return "table";
    case "math": return "math";
    case "html": return "html";
    case "thematicBreak": return "thematicBreak";
    default: return "other";
  }
}

/// 收集参与切分的节点：顶层节点各成一块；list 下钻到 listItem；
/// blockquote 下钻到直接子块（不再深钻）。
function collectUnits(root: Root): Array<{ node: Node; kind: EditUnitKind }> {
  const collected: Array<{ node: Node; kind: EditUnitKind }> = [];
  for (const node of root.children as Node[]) {
    if (node.type === "list") {
      for (const item of (node as Parent).children) {
        collected.push({ node: item, kind: "listItem" });
      }
      continue;
    }
    if (node.type === "blockquote") {
      for (const child of (node as Parent).children) {
        collected.push({ node: child, kind: "blockquoteChild" });
      }
      continue;
    }
    collected.push({ node, kind: kindOf(node) });
  }
  return collected;
}

export function buildEditUnits(markdown: string): EditUnit[] {
  if (!markdown.trim()) return [];

  let root: Root;
  try {
    root = fromMarkdown(markdown, PARSE_OPTIONS) as Root;
  } catch {
    return [];
  }

  const units: EditUnit[] = [];
  for (const { node, kind } of collectUnits(root)) {
    const range = rangeOf(node);
    if (!range) continue;

    const locked = kind === "html" || kind === "widget";
    units.push({
      index: units.length,
      start: range.start,
      end: range.end,
      kind,
      editable: !locked,
      reason: locked ? (kind === "widget" ? "widget" : "html") : undefined,
    });
  }

  units.sort((a, b) => a.start - b.start);
  return units.map((unit, index) => ({ ...unit, index }));
}

export function findUnitForRange(units: EditUnit[], start: number, end: number): EditUnit | undefined {
  return units.find((unit) => unit.start <= start && unit.end >= end);
}

export function spliceUnit(markdown: string, unit: EditUnit, text: string): string {
  return markdown.slice(0, unit.start) + text + markdown.slice(unit.end);
}

/// 点击点纵向比率 → 最近的源码行行首偏移（光标落点的「行级近似」）；
/// 尾随换行产生的末尾空行不计入行数，否则点块底部会落到空行上。
export function caretOffsetForRatio(text: string, ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const targetLine = Math.min(lines.length - 1, Math.round(clamped * (lines.length - 1)));

  let offset = 0;
  for (let i = 0; i < targetLine; i += 1) offset += lines[i].length + 1;
  return offset;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/editUnits.test.ts`
Expected: PASS（17 用例）

- [ ] **Step 5: 全量回归 + 提交**

```bash
npm test && npx tsc --noEmit
git add src/lib/editUnits.ts src/lib/editUnits.test.ts
git commit -m "feat(edit): 块单元切分纯函数（顶层 + list/blockquote 一次下钻、HTML/widget 结构性只读）"
```

---

### Task 2: rehype 标记插件 + 点击解析（仅编辑视图启用）

**Files:**
- Create: `src/lib/rehypeEditUnits.ts`
- Create: `src/lib/rehypeEditUnits.test.ts`
- Modify: `src/components/MarkdownDocument.tsx`（新增 props、插件接线、`sanitize` schema 加 `data*`、article 上的点击解析）
- Modify: `src/components/MarkdownDocument.test.tsx`（追加 `editable` 模式用例）

**Interfaces:**
- Consumes: `buildEditUnits` / `EditUnit` / `findUnitForRange`（Task 1）
- Produces:
  ```ts
  // src/lib/rehypeEditUnits.ts
  export function createRehypeEditUnits(units: EditUnit[]): () => (tree: unknown) => void;
  // MarkdownDocument 新增 props（全部可选，缺省＝阅读视图）
  type EditProps = {
    editable?: boolean;
    onActivateUnit?: (index: number, caretOffset: number) => void;
    onLockedUnitClick?: (reason: "html" | "widget") => void;
  };
  ```
- DOM 契约：`data-vellum-unit="<index>"`（可编辑与不可编辑块都有）；不可编辑块额外 `data-vellum-locked="html|widget"`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/rehypeEditUnits.test.ts
import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { buildEditUnits } from "./editUnits";
import { createRehypeEditUnits } from "./rehypeEditUnits";

async function render(markdown: string, editable = true) {
  const processor = unified().use(remarkParse).use(remarkRehype);
  if (editable) processor.use(createRehypeEditUnits(buildEditUnits(markdown)));
  processor.use(rehypeStringify);
  return String(await processor.process(markdown));
}

describe("createRehypeEditUnits", () => {
  it("给每个块打上与 editUnits 一致的索引", async () => {
    const html = await render("# 标题\n\n正文\n");
    expect(html).toContain('data-vellum-unit="0"');
    expect(html).toContain('data-vellum-unit="1"');
  });

  it("不可编辑块额外带 locked 标记", async () => {
    const html = await render('<div class="x">hi</div>\n');
    expect(html).toContain('data-vellum-unit="0"');
    expect(html).toContain('data-vellum-locked="html"');
  });

  it("编辑视图关闭时不产生任何标记", async () => {
    const html = await render("# 标题\n", false);
    expect(html).not.toContain("data-vellum-unit");
  });
});
```

追加到 `src/components/MarkdownDocument.test.tsx`：

```tsx
it("编辑视图下块元素带 data-vellum-unit，阅读视图下没有", () => {
  const markdown = "# 标题\n\n正文\n";
  const { container, unmount } = render(<MarkdownDocument markdown={markdown} editable />);
  expect(container.querySelectorAll("[data-vellum-unit]").length).toBe(2);
  unmount();

  const reading = render(<MarkdownDocument markdown={markdown} />);
  expect(reading.container.querySelectorAll("[data-vellum-unit]").length).toBe(0);
});

it("点击可编辑块回调索引，点击只读块回调原因", () => {
  const onActivateUnit = vi.fn();
  const onLockedUnitClick = vi.fn();
  const markdown = '正文\n\n```vellum-widget\n<div>x</div>\n```\n';
  render(
    <MarkdownDocument
      markdown={markdown}
      editable
      onActivateUnit={onActivateUnit}
      onLockedUnitClick={onLockedUnitClick}
    />
  );

  fireEvent.click(screen.getByText("正文"));
  expect(onActivateUnit).toHaveBeenCalledWith(0, expect.any(Number));

  fireEvent.click(document.querySelector('[data-vellum-locked="widget"]') as Element);
  expect(onLockedUnitClick).toHaveBeenCalledWith("widget");
  expect(onActivateUnit).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/rehypeEditUnits.test.ts src/components/MarkdownDocument.test.tsx`
Expected: FAIL —— `Failed to resolve import "./rehypeEditUnits"`

- [ ] **Step 3: 实现插件**

```ts
// src/lib/rehypeEditUnits.ts
import type { EditUnit } from "./editUnits";

type HastElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children?: HastNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};
type HastNode = HastElement | { type: string; children?: HastNode[]; position?: HastElement["position"] };

const MATH_CLASSES = new Set(["math-display", "math-inline", "language-math"]);

function classesOf(element: HastElement): string[] {
  const value = element.properties.className;
  return Array.isArray(value) ? value.map(String) : [];
}

/// rehype-katex 会整体替换命中这些类的节点（连同属性），
/// 因此这类元素必须外包一层容器来承载标记（容器用 display:contents 不参与布局）。
function isReplacedByKatex(element: HastElement): boolean {
  const classes = classesOf(element);
  if (classes.some((name) => MATH_CLASSES.has(name))) return true;
  if (element.tagName !== "pre") return false;
  return (element.children ?? []).some(
    (child) =>
      child.type === "element" &&
      (child as HastElement).tagName === "code" &&
      classesOf(child as HastElement).includes("language-math")
  );
}

export function createRehypeEditUnits(units: EditUnit[]) {
  return function rehypeEditUnits() {
    function walk(parent: { children?: HastNode[] }) {
      const children = parent.children;
      if (!children) return;

      for (let i = 0; i < children.length; i += 1) {
        const node = children[i];
        if (node.type !== "element") {
          walk(node as { children?: HastNode[] });
          continue;
        }

        const element = node as HastElement;
        const start = element.position?.start?.offset;
        const end = element.position?.end?.offset;

        if (typeof start === "number" && typeof end === "number") {
          const unit = units.find((candidate) => candidate.start <= start && candidate.end >= end);
          if (unit) {
            const tag = (target: HastElement) => {
              target.properties.dataVellumUnit = unit.index;
              if (!unit.editable && unit.reason) target.properties.dataVellumLocked = unit.reason;
            };

            if (isReplacedByKatex(element)) {
              const wrapper: HastElement = {
                type: "element",
                tagName: "div",
                properties: { className: ["vellum-unit-wrap"] },
                children: [element as unknown as HastNode],
                position: element.position,
              };
              tag(wrapper);
              tag(element);
              children[i] = wrapper;
            } else {
              tag(element);
            }
          }
        }

        walk(element as { children?: HastNode[] });
      }
    }

    return (tree: unknown) => walk(tree as { children?: HastNode[] });
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/rehypeEditUnits.test.ts`
Expected: PASS（3 用例）

- [ ] **Step 5: 接线 `MarkdownDocument`**

改动点（保持 memo 契约）：

1. props 增加 `editable`、`onActivateUnit`、`onLockedUnitClick`
2. `MarkdownDocument` 内 `const units = useMemo(() => (editable ? buildEditUnits(markdown) : []), [editable, markdown])`
3. `MarkdownBody` 的 `rehypePlugins` 里，在 `[rehypeSanitize, kamiSchema]` 之后、搜索高亮之前插入 `...(editable ? [createRehypeEditUnits(units)] : [])`（`createRehypeEditUnits` 的结果需 `useMemo`，依赖 `[editable, units]`）
4. `kamiSchema.attributes["*"]` 追加 `"data*"`
5. article 上加 `onClick`：

```tsx
const handleClick = useCallback(
  (event: React.MouseEvent<HTMLElement>) => {
    if (!editable) return;
    const target = (event.target as Element | null)?.closest("[data-vellum-unit]");
    if (!target) return;
    const index = Number(target.getAttribute("data-vellum-unit"));
    const unit = units.find((candidate) => candidate.index === index);
    if (!unit) return;

    if (!unit.editable) {
      onLockedUnitClick?.(unit.reason === "widget" ? "widget" : "html");
      return;
    }

    const rect = target.getBoundingClientRect();
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
    const source = markdown.slice(unit.start, unit.end);
    onActivateUnit?.(index, caretOffsetForRatio(source, ratio));
  },
  [editable, markdown, onActivateUnit, onLockedUnitClick, units]
);
```

- [ ] **Step 6: 回归 + 提交**

```bash
npx vitest run src/components/MarkdownDocument.test.tsx && npm test && npx tsc --noEmit
git add src/lib/rehypeEditUnits.ts src/lib/rehypeEditUnits.test.ts src/components/MarkdownDocument.tsx src/components/MarkdownDocument.test.tsx
git commit -m "feat(edit): rehype 块标记插件与点击解析（仅编辑视图启用，阅读视图 DOM 不变）"
```

---

### Task 3: 就地编辑面 `BlockEditor`

**Files:**
- Create: `src/lib/editorGeometry.ts`
- Create: `src/lib/editorGeometry.test.ts`
- Create: `src/components/BlockEditor.tsx`
- Create: `src/components/BlockEditor.test.tsx`

**Interfaces:**
- Consumes: 无（只操作已渲染的 DOM）
- Produces:
  ```ts
  // src/lib/editorGeometry.ts
  export type OverlayBox = { top: number; left: number; width: number; minHeight: number };
  export function computeOverlayBox(
    targetRect: DOMRectLike, containerRect: DOMRectLike, containerScrollTop: number
  ): OverlayBox;
  // src/components/BlockEditor.tsx
  export type BlockEditorProps = {
    unitIndex: number;
    value: string;                 // 受控草稿（由 useDocumentEditor 拥有，便于切视图/跳转时强制提交）
    initialCaret: number;
    onChange: (text: string) => void;
    onCommit: () => void;
    onCancel: () => void;
  };
  ```
- DOM 契约：容器 `.markdown-body` 上加 `markdown-body--editing` 类（提供 `position: relative`）；原块元素被指向后写入内联样式 `visibility:hidden; overflow:hidden; height:<px>`，卸载时**逐项还原**

- [ ] **Step 1: 写失败测试（几何纯函数）**

```ts
// src/lib/editorGeometry.test.ts
import { describe, expect, it } from "vitest";
import { computeOverlayBox } from "./editorGeometry";

const rect = (top: number, left: number, width: number, height: number) =>
  ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRect;

describe("computeOverlayBox", () => {
  it("按容器滚动量换算相对坐标", () => {
    const box = computeOverlayBox(
      rect(300, 40, 700, 120),
      rect(100, 40, 700, 600),
      200
    );
    expect(box).toEqual({ top: 400, left: 0, width: 700, minHeight: 120 });
  });

  it("高度为 0 时给出 1 像素下限", () => {
    const box = computeOverlayBox(rect(300, 40, 700, 0), rect(100, 40, 700, 600), 0);
    expect(box.minHeight).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/editorGeometry.test.ts`
Expected: FAIL —— `Failed to resolve import "./editorGeometry"`

- [ ] **Step 3: 实现几何函数**

```ts
// src/lib/editorGeometry.ts
export type DOMRectLike = { top: number; left: number; width: number; height: number };
export type OverlayBox = { top: number; left: number; width: number; minHeight: number };

/// 把目标块相对视口的矩形换算为「相对滚动容器内容原点」的覆盖层盒。
/// 覆盖层的 offsetParent 是 .markdown-body（编辑视图下 position: relative），
/// 因此 left 取目标相对容器左缘的距离，top 需加上容器已滚动的距离。
export function computeOverlayBox(
  targetRect: DOMRectLike,
  containerRect: DOMRectLike,
  containerScrollTop: number
): OverlayBox {
  return {
    top: targetRect.top - containerRect.top + containerScrollTop,
    left: targetRect.left - containerRect.left,
    width: targetRect.width,
    minHeight: Math.max(1, targetRect.height),
  };
}
```

- [ ] **Step 4: 实现 `BlockEditor`**

```tsx
// src/components/BlockEditor.tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { computeOverlayBox, type OverlayBox } from "../lib/editorGeometry";

export type BlockEditorProps = {
  unitIndex: number;
  value: string;
  initialCaret: number;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

const MANAGED_STYLES = ["visibility", "overflow", "height"] as const;

/// 受控 textarea：草稿由上层（useDocumentEditor）持有，因此上层可随时
/// 「先提交再切视图/跳搜索」，不需要向子组件反向注册提交函数。
export function BlockEditor({ unitIndex, value, initialCaret, onChange, onCommit }: BlockEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [box, setBox] = useState<OverlayBox | null>(null);
  const settlingRef = useRef(false);

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-vellum-unit="${unitIndex}"]`);
    const container = document.querySelector<HTMLElement>(".document-scroll");
    const textarea = textareaRef.current;
    if (!target || !container || !textarea) return;

    const previous = MANAGED_STYLES.map((name) => [name, target.style[name]] as const);
    const targetRect = target.getBoundingClientRect();
    target.style.visibility = "hidden";
    target.style.overflow = "hidden";
    target.style.height = `${targetRect.height}px`;

    setBox(computeOverlayBox(targetRect, container.getBoundingClientRect(), container.scrollTop));
    target.style.height = `${textarea.scrollHeight}px`;

    // 自增高：textarea 涨高时把原块也撑高，后续内容被推下去（不是被盖住）
    const observer = new ResizeObserver(() => {
      target.style.height = `${textarea.scrollHeight}px`;
    });
    observer.observe(textarea);

    return () => {
      observer.disconnect();
      for (const [name, previousValue] of previous) target.style[name] = previousValue;
    };
  }, [unitIndex]);

  // 挂载时定位光标（不在每次 value 变化时重定位，否则打字会跳光标）
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    settlingRef.current = true;
    textarea.focus();
    const caret = Math.max(0, Math.min(initialCaret, textarea.value.length));
    textarea.setSelectionRange(caret, caret);
    const timer = setTimeout(() => {
      settlingRef.current = false;
    }, 0);
    return () => clearTimeout(timer);
  }, [unitIndex, initialCaret]);

  function requestCommit() {
    onCommit();
  }

  return (
    <textarea
      ref={textareaRef}
      className="block-editor__input"
      data-block-editor-for={unitIndex}
      value={value}
      spellCheck={false}
      style={box ? { top: box.top, left: box.left, width: box.width, minHeight: box.minHeight } : undefined}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          requestCommit();
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          requestCommit();
        }
      }}
      onBlur={() => {
        // 挂载后首次定位光标可能触发一次失焦，忽略该次
        if (settlingRef.current) return;
        requestCommit();
      }}
    />
  );
}
```

- [ ] **Step 5: 写组件测试**

```tsx
// src/components/BlockEditor.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockEditor } from "./BlockEditor";

function mountFixture(source = "正文") {
  document.body.innerHTML = `
    <div class="document-scroll">
      <div class="markdown-body"><p data-vellum-unit="0">${source}</p></div>
    </div>`;
  return document.querySelector<HTMLElement>('[data-vellum-unit="0"]')!;
}

/// 受控宿主：把草稿状态放在测试里，与 useDocumentEditor 的接法一致
function Harness({ initial = "正文", onCommit }: { initial?: string; onCommit: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <BlockEditor
      unitIndex={0}
      value={value}
      initialCaret={0}
      onChange={setValue}
      onCommit={onCommit}
      onCancel={vi.fn()}
    />
  );
}

describe("BlockEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100, left: 20, width: 600, height: 80, bottom: 180, right: 620, x: 20, y: 100, toJSON: () => ({}),
    } as DOMRect);
  });

  it("隐藏原块并锁高，卸载时还原内联样式", () => {
    const target = mountFixture();
    const { unmount } = render(<Harness onCommit={vi.fn()} />);

    expect(target.style.visibility).toBe("hidden");
    expect(target.style.overflow).toBe("hidden");
    expect(target.style.height).toBe("80px");

    unmount();
    expect(target.style.visibility).toBe("");
    expect(target.style.height).toBe("");
  });

  it("Esc 提交当前草稿（草稿由上层持有，提交只发信号）", () => {
    mountFixture();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "改过的正文" } });
    expect(screen.getByRole("textbox")).toHaveValue("改过的正文");

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+S 与失焦都走同一条提交信号，且失焦不乱触发", async () => {
    mountFixture();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);

    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 6: 回归 + 提交**

```bash
npx vitest run src/lib/editorGeometry.test.ts src/components/BlockEditor.test.tsx && npm test && npx tsc --noEmit
git add src/lib/editorGeometry.ts src/lib/editorGeometry.test.ts src/components/BlockEditor.tsx src/components/BlockEditor.test.tsx
git commit -m "feat(edit): 就地编辑面 BlockEditor（隐藏原块锁高、自增高推流、Esc/失焦提交）"
```

---

### Task 4: 编辑会话状态机 `useDocumentEditor`

**Files:**
- Create: `src/hooks/useDocumentEditor.ts`
- Create: `src/hooks/useDocumentEditor.test.ts`

**Interfaces:**
- Consumes: `buildEditUnits` / `spliceUnit` / `EditUnit`（Task 1）
- Produces:
  ```ts
  export type EditorViewMode = "reading" | "editing";
  export type EditorToast = { id: number; message: string };
  export type UseDocumentEditorOptions = {
    markdown: string;
    mdlogActive: boolean;
    onMarkdownChange: (next: string) => void;
    save: (next: string) => Promise<void>;
    heavyCommitMs?: number;          // 默认 800，测试/真机可调
  };
  export function useDocumentEditor(options: UseDocumentEditorOptions): {
    viewMode: EditorViewMode;
    toggleView: () => Promise<void>;
    units: EditUnit[];
    activeUnit: EditUnit | null;
    draft: string;
    initialCaret: number;
    heavyDoc: boolean;
    toast: EditorToast | null;
    activateUnit: (index: number, caretOffset: number) => void;
    updateDraft: (text: string) => void;
    commitActive: () => Promise<void>;
    notifyLocked: (reason: "html" | "widget") => void;
    notifyInterrupted: (message: string) => void;
  };
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/hooks/useDocumentEditor.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDocumentEditor } from "./useDocumentEditor";

const markdown = "# 标题\n\n第一段。\n\n第二段。\n";

function setup(overrides: Partial<Parameters<typeof useDocumentEditor>[0]> = {}) {
  const onMarkdownChange = vi.fn();
  const save = vi.fn(() => Promise.resolve());
  const view = renderHook(() =>
    useDocumentEditor({ markdown, mdlogActive: false, onMarkdownChange, save, ...overrides })
  );
  return { ...view, onMarkdownChange, save };
}

describe("useDocumentEditor", () => {
  it("从 markdown 切出块单元", () => {
    const { result } = setup();
    expect(result.current.units).toHaveLength(3);
    expect(result.current.viewMode).toBe("reading");
  });

  it("mdlog 记录中拒绝进入编辑视图并提示", async () => {
    const { result } = setup({ mdlogActive: true });
    await act(async () => {
      await result.current.toggleView();
    });
    expect(result.current.viewMode).toBe("reading");
    expect(result.current.toast?.message).toContain("记录中");
  });

  it("激活块后草稿是该块源码，提交时拼回全文并落盘", async () => {
    const { result, onMarkdownChange, save } = setup();
    act(() => {
      result.current.toggleView();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.activateUnit(1, 0);
    });
    expect(result.current.draft).toBe("第一段。");

    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.commitActive();
    });

    expect(onMarkdownChange).toHaveBeenCalledWith("# 标题\n\n改过的第一段。\n\n第二段。\n");
    expect(save).toHaveBeenCalledWith("# 标题\n\n改过的第一段。\n\n第二段。\n");
    expect(result.current.activeUnit).toBeNull();
  });

  it("草稿与原文相同时不提交、不落盘", async () => {
    const { result, onMarkdownChange, save } = setup();
    act(() => {
      result.current.activateUnit(1, 0);
    });
    await act(async () => {
      await result.current.commitActive();
    });
    expect(onMarkdownChange).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("提交耗时超过阈值时挂出「文档较重」标记", async () => {
    const { result } = setup({ heavyCommitMs: 0 });
    act(() => {
      result.current.activateUnit(1, 0);
    });
    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.commitActive();
    });
    expect(result.current.heavyDoc).toBe(true);
  });

  it("只读块点击给出原因文案", () => {
    const { result } = setup();
    act(() => {
      result.current.notifyLocked("html");
    });
    expect(result.current.toast?.message).toContain("HTML");
  });

  it("编辑中被外部改写：取消编辑并提示", async () => {
    const { result } = setup();
    act(() => {
      result.current.activateUnit(1, 0);
    });
    act(() => {
      result.current.notifyInterrupted("文件已被外部修改 · 编辑已取消");
    });
    expect(result.current.activeUnit).toBeNull();
    expect(result.current.toast?.message).toContain("外部修改");
  });

  it("保存失败时把草稿留在框里并提示", async () => {
    const save = vi.fn(() => Promise.reject(new Error("拒绝写入")));
    const onMarkdownChange = vi.fn();
    const { result } = renderHook(() =>
      useDocumentEditor({ markdown, mdlogActive: false, onMarkdownChange, save })
    );

    act(() => {
      result.current.activateUnit(1, 0);
    });
    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.commitActive();
    });

    expect(result.current.toast?.message).toContain("保存失败");
    expect(result.current.draft).toBe("改过的第一段。");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useDocumentEditor.test.ts`
Expected: FAIL —— `Failed to resolve import "./useDocumentEditor"`

- [ ] **Step 3: 实现**

```ts
// src/hooks/useDocumentEditor.ts
import { useCallback, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { buildEditUnits, spliceUnit, type EditUnit } from "../lib/editUnits";

export type EditorViewMode = "reading" | "editing";
export type EditorToast = { id: number; message: string };

export type UseDocumentEditorOptions = {
  markdown: string;
  mdlogActive: boolean;
  onMarkdownChange: (next: string) => void;
  save: (next: string) => Promise<void>;
  heavyCommitMs?: number;
};

const DEFAULT_HEAVY_COMMIT_MS = 800;

export function useDocumentEditor({
  markdown,
  mdlogActive,
  onMarkdownChange,
  save,
  heavyCommitMs = DEFAULT_HEAVY_COMMIT_MS,
}: UseDocumentEditorOptions) {
  const [viewMode, setViewMode] = useState<EditorViewMode>("reading");
  const [activeUnitIndex, setActiveUnitIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [initialCaret, setInitialCaret] = useState(0);
  const [heavyDoc, setHeavyDoc] = useState(false);
  const [toast, setToast] = useState<EditorToast | null>(null);
  const toastIdRef = useRef(0);

  const units = useMemo(() => buildEditUnits(markdown), [markdown]);
  const activeUnit = activeUnitIndex === null ? null : (units.find((unit) => unit.index === activeUnitIndex) ?? null);

  const showToast = useCallback((message: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, message });
  }, []);

  const closeActive = useCallback(() => {
    setActiveUnitIndex(null);
    setDraft("");
    setInitialCaret(0);
  }, []);

  const activateUnit = useCallback(
    (index: number, caretOffset: number) => {
      if (mdlogActive) {
        showToast("记录中 · 编辑已禁用");
        return;
      }
      const unit = units.find((candidate) => candidate.index === index);
      if (!unit?.editable) return;
      setActiveUnitIndex(index);
      setDraft(markdown.slice(unit.start, unit.end));
      setInitialCaret(caretOffset);
    },
    [markdown, mdlogActive, showToast, units]
  );

  const commitActive = useCallback(async () => {
    if (!activeUnit) return;
    const original = markdown.slice(activeUnit.start, activeUnit.end);
    if (draft === original) {
      closeActive();
      return;
    }

    const next = spliceUnit(markdown, activeUnit, draft);

    // flushSync 让整篇重解析同步完成，才能量到真实的提交耗时
    const startedAt = performance.now();
    flushSync(() => onMarkdownChange(next));
    const renderMs = performance.now() - startedAt;
    if (renderMs > heavyCommitMs) setHeavyDoc(true);

    closeActive();
    try {
      await save(next);
    } catch (error) {
      // 保存失败：草稿留在框里（重新激活同一块并保留草稿），让用户可重试
      setDraft(draft);
      setActiveUnitIndex(activeUnit.index);
      showToast(`保存失败：${String(error)}`);
    }
  }, [activeUnit, closeActive, draft, heavyCommitMs, markdown, onMarkdownChange, save, showToast]);

  const toggleView = useCallback(async () => {
    if (viewMode === "editing") {
      await commitActive();
      setViewMode("reading");
      return;
    }
    if (mdlogActive) {
      showToast("记录中 · 断开连接后才能修改");
      return;
    }
    setViewMode("editing");
  }, [commitActive, mdlogActive, showToast, viewMode]);

  /// 中断路径共用：尽力把草稿写进剪贴板，然后取消编辑
  const notifyInterrupted = useCallback(
    (message: string) => {
      if (activeUnitIndex === null) {
        showToast(message);
        return;
      }
      void navigator.clipboard?.writeText(draft).catch(() => {});
      closeActive();
      showToast(message);
    },
    [activeUnitIndex, closeActive, draft, showToast]
  );

  const notifyLocked = useCallback(
    (reason: "html" | "widget") => {
      showToast(reason === "html" ? "HTML 区块为只读" : "交互块只读，点击可交互");
    },
    [showToast]
  );

  const updateDraft = useCallback((text: string) => {
    setDraft(text);
  }, []);

  return {
    viewMode,
    toggleView,
    units,
    activeUnit,
    draft,
    initialCaret,
    heavyDoc,
    toast,
    activateUnit,
    updateDraft,
    commitActive,
    notifyLocked,
    notifyInterrupted,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useDocumentEditor.test.ts`
Expected: PASS（8 用例）

- [ ] **Step 5: 与 spec 的差异登记**

spec §6.4 原写「外部变更且有改动 ⇒ 保留草稿 + 二选一横幅」。本计划**简化为**与「mdlog 中途开始」完全相同的路径：`notifyInterrupted`（尽力写剪贴板 + 取消 + 提示），不实现二选一横幅。理由：提交即落盘使草稿存活窗口极短，而二选一横幅需额外状态机与 UI。执行时同步在 spec 的 §6.4 加一行修订标记。

- [ ] **Step 6: 回归 + 提交**

```bash
npx vitest run src/hooks/useDocumentEditor.test.ts && npm test && npx tsc --noEmit
git add src/hooks/useDocumentEditor.ts src/hooks/useDocumentEditor.test.ts
git commit -m "feat(edit): 编辑会话状态机（提交即落盘、自适应重文档提示、中断与失败路径）"
```

---

### Task 5: Rust `save_document`（原子写 + EOL 保真 + 双闸门）

**Files:**
- Modify: `src-tauri/src/document.rs`
- Modify: `src-tauri/src/document_tests.rs`
- Modify: `src-tauri/src/main.rs`（命令 + `invoke_handler` 注册）

**Interfaces:**
- Consumes: `read_mdlog_state_from_path` / `is_pid_alive_win32`（`widget.rs` 现成纯函数）
- Produces:
  ```rust
  #[derive(Debug, Clone, serde::Serialize)]
  #[serde(rename_all = "camelCase")]
  pub struct SaveOutcome { pub path: String, pub bytes_written: usize }
  pub fn save_markdown_file(path: &Path, content: &str) -> Result<SaveOutcome, String>;
  // Tauri 命令
  // save_document(path: String, content: String) -> Result<SaveOutcome, String>
  ```

- [ ] **Step 1: 写失败测试**

```rust
// 追加到 src-tauri/src/document_tests.rs
mod save_tests {
    use super::*;
    use crate::document::save_markdown_file;

    fn write_markdown(dir: &TestDir, name: &str, body: &str) -> PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, body).unwrap();
        path
    }

    #[test]
    fn writes_content_and_reports_size() {
        let dir = TestDir::new("vellum_save_write");
        let path = write_markdown(&dir, "a.md", "旧内容\n");

        let outcome = save_markdown_file(&path, "新内容\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "新内容\n");
        assert_eq!(outcome.bytes_written, "新内容\n".len());
    }

    #[test]
    fn preserves_crlf_line_endings() {
        let dir = TestDir::new("vellum_save_crlf");
        let path = write_markdown(&dir, "b.md", "第一行\r\n第二行\r\n");

        save_markdown_file(&path, "甲\n乙\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "甲\r\n乙\r\n");
    }

    #[test]
    fn does_not_introduce_crlf_into_lf_files() {
        let dir = TestDir::new("vellum_save_lf");
        let path = write_markdown(&dir, "c.md", "一行\n二行\n");

        save_markdown_file(&path, "甲\n乙\n").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "甲\n乙\n");
    }

    #[test]
    fn preserves_utf8_bom() {
        let dir = TestDir::new("vellum_save_bom");
        let path = write_markdown(&dir, "d.md", "\u{FEFF}原文\n");

        save_markdown_file(&path, "\u{FEFF}改后\n").unwrap();

        assert!(fs::read_to_string(&path).unwrap().starts_with('\u{FEFF}'));
    }

    #[test]
    fn rejects_non_markdown_extension() {
        let dir = TestDir::new("vellum_save_ext");
        let path = write_markdown(&dir, "e.txt", "x\n");

        assert!(save_markdown_file(&path, "y\n").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "x\n");
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = TestDir::new("vellum_save_temp");
        let path = write_markdown(&dir, "f.md", "x\n");

        save_markdown_file(&path, "y\n").unwrap();

        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.contains("vellum-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "残留临时文件: {leftovers:?}");
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test save_tests`
Expected: FAIL —— `cannot find function save_markdown_file`

- [ ] **Step 3: 实现写入函数**

```rust
// 追加到 src-tauri/src/document.rs

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub path: String,
    pub bytes_written: usize,
}

/// 原文件的主导换行风格：出现 CRLF 即按 CRLF 处理，否则 LF。
fn dominant_eol(existing: &str) -> &'static str {
    if existing.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// 把入参统一成 LF 再套用目标换行风格 —— textarea 会把 CRLF 归一成 LF，
/// 若不还原，一次提交就把整篇文档的换行符翻新。
fn apply_eol(content: &str, eol: &str) -> String {
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    if eol == "\r\n" {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    }
}

pub fn save_markdown_file(path: &Path, content: &str) -> Result<SaveOutcome, String> {
    let canonical =
        dunce::canonicalize(path).map_err(|error| format!("Cannot open file: {error}"))?;

    if !canonical.is_file() {
        return Err(format!("Path is not a file: {}", canonical.display()));
    }
    if !is_markdown_extension(&canonical) {
        return Err(format!("Not a Markdown file: {}", canonical.display()));
    }
    if content.len() as u64 > MAX_FILE_SIZE_BYTES {
        return Err(format!(
            "content too large: {} bytes (max {} bytes)",
            content.len(),
            MAX_FILE_SIZE_BYTES
        ));
    }

    let existing = std::fs::read_to_string(&canonical).unwrap_or_default();
    let payload = apply_eol(content, dominant_eol(&existing));

    let file_name = canonical
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Cannot resolve file name".to_string())?;
    let temp_path = canonical.with_file_name(format!(".{file_name}.vellum-tmp"));

    std::fs::write(&temp_path, payload.as_bytes())
        .map_err(|error| format!("Cannot write temporary file: {error}"))?;

    if let Err(error) = std::fs::rename(&temp_path, &canonical) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Cannot replace document: {error}"));
    }

    Ok(SaveOutcome {
        path: canonical.to_string_lossy().to_string(),
        bytes_written: payload.len(),
    })
}
```

- [ ] **Step 4: 加命令与双闸门**

```rust
// 追加到 src-tauri/src/main.rs
#[tauri::command]
async fn save_document(
    path: String,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<document::SaveOutcome, String> {
    let canonical = dunce::canonicalize(Path::new(&path))
        .map_err(|error| format!("Cannot open file: {error}"))?;

    // 闸门 1：只允许写当前已加载的文档
    let current = state
        .current
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    match current {
        Some(expected) if expected == canonical => {}
        _ => return Err("Only the currently loaded document can be saved".to_string()),
    }

    // 闸门 2：mdlog 记录中拒绝写入（前端门禁之外的服务端兜底）
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    if vellum_lib::widget::read_mdlog_state_from_path(
        Some(&canonical),
        &vellum_lib::widget::is_pid_alive_win32,
        now,
    )
    .is_some()
    {
        return Err("mdlog 记录中：断开连接后才能修改".to_string());
    }

    document::save_markdown_file(&canonical, &content)
}
```

并在 `invoke_handler` 列表里 `resolve_asset,` 之后加一行 `save_document,`。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd src-tauri && cargo test`
Expected: PASS（含新增 6 用例，原有全绿）

- [ ] **Step 6: 提交**

```bash
cd src-tauri && cargo test && cd .. && npx tsc --noEmit
git add src-tauri/src/document.rs src-tauri/src/document_tests.rs src-tauri/src/main.rs
git commit -m "feat(edit): save_document 命令（原子写 + EOL/BOM 保真 + 当前文档与 mdlog 双闸门）"
```

---

### Task 6: `App` 接线（门禁、提交落盘、回声抑制、外部变更分流）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TopBar.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/TopBar.test.tsx`

**Interfaces:**
- Consumes: `useDocumentEditor`（Task 4）、`MarkdownDocument` 的 `editable`/`onActivateUnit`/`onLockedUnitClick`（Task 2）、`BlockEditor`（Task 3）、`save_document`（Task 5）
- Produces: 新增 props `isEditing`/`onToggleEdit` 到 `TopBar`；App 内部 `applyMarkdown` 与 `reloadIfExternal`

- [ ] **Step 1: 写失败测试（App 集成）**

```tsx
// 追加到 src/App.test.tsx
it("Ctrl+E 进入编辑视图，点击块激活就地编辑，提交后落盘", async () => {
  await loadDocument();
  fireEvent.keyDown(window, { key: "e", ctrlKey: true });

  await waitFor(() => expect(document.querySelector("[data-vellum-unit]")).not.toBeNull());
  fireEvent.click(screen.getByText("Body text."));

  const textarea = await screen.findByRole("textbox");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });
  fireEvent.keyDown(textarea, { key: "Escape" });

  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("save_document", {
      path: loadedDoc.path,
      content: expect.stringContaining("Body text edited."),
    })
  );
});

it("mdlog 记录中不得进入编辑视图", async () => {
  await loadDocument();
  backendInvoke.mockImplementation((command: string) => {
    if (command === "read_mdlog_state") {
      return Promise.resolve({ lastWriteAt: 1, heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000 });
    }
    return Promise.resolve(loadedDoc);
  });

  await waitFor(() => expect(screen.getByText("记录中 · PI")).toBeInTheDocument());
  fireEvent.keyDown(window, { key: "e", ctrlKey: true });

  expect(document.querySelector("textarea.block-editor__input")).toBeNull();
});

it("自己的写入回声不触发「墨迹未干」印章", async () => {
  await loadDocument();
  let reloadListener: (() => void) | undefined;
  vi.mocked(listen).mockImplementation(async (event: string, handler: () => void) => {
    if (event === "file-changed") reloadListener = handler;
    return () => {};
  });

  fireEvent.keyDown(window, { key: "e", ctrlKey: true });
  fireEvent.click(await screen.findByText("Body text."));
  const textarea = await screen.findByRole("textbox");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });
  fireEvent.keyDown(textarea, { key: "Escape" });

  // 模拟我方写入引发的 watcher 回声：磁盘内容与草稿一致
  backendInvoke.mockImplementation((command: string) =>
    command === "load_document"
      ? Promise.resolve({ ...loadedDoc, markdown: "# Intro\n\n## Section\n\nBody text edited." })
      : Promise.resolve(undefined)
  );
  await act(async () => {
    reloadListener?.();
  });

  expect(screen.queryByText("墨迹未干")).toBeNull();
});
```

并把 App.test.tsx 的 window mock 补全（缺 `onCloseRequested` 会让新代码抛错）：

```tsx
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    show: vi.fn(() => Promise.resolve()),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  })),
}));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL —— 找不到 `[data-vellum-unit]`（编辑视图未接线）

- [ ] **Step 3: 接线 App**

改动点（全部保持既有引用稳定性约束）：

1. 引入 `useDocumentEditor`、`BlockEditor`；`const [lastSavedMarkdown, setLastSavedMarkdown] = useState<string | null>(null)` 改为 `useRef<string | null>(null)`（只给回调读，不参与渲染）
2. 文档 markdown 更新器：

```tsx
const applyMarkdown = useCallback((next: string) => {
  setState((previous) =>
    previous.status === "ready"
      ? { ...previous, document: { ...previous.document, markdown: next } }
      : previous
  );
}, []);

const saveMarkdown = useCallback(async (next: string) => {
  const path = currentPathRef.current;
  if (!path) throw new Error("No document is loaded");
  await invoke("save_document", { path, content: next });
  lastSavedMarkdownRef.current = next;
}, []);

const editor = useDocumentEditor({
  markdown: activeDocument?.markdown ?? "",
  mdlogActive: isMdlogActive,
  onMarkdownChange: applyMarkdown,
  save: saveMarkdown,
});
```

3. `Ctrl+E`：在既有 `handleSearchShortcut` 里加分支

```tsx
if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
  event.preventDefault();
  void editor.toggleView();
  return;
}
```

4. 点击回调（引用稳定）：

```tsx
const handleActivateUnit = useCallback(
  (index: number, caretOffset: number) => editor.activateUnit(index, caretOffset),
  [editor.activateUnit]
);
const handleLockedUnitClick = useCallback(
  (reason: "html" | "widget") => editor.notifyLocked(reason),
  [editor.notifyLocked]
);
```

5. 渲染：`.document-scroll__content` 在编辑视图加 `document-scroll__content--editing` 类；`MarkdownDocument` 传 `editable={editor.viewMode === "editing"}`；其后并列渲染

```tsx
{editor.activeUnit ? (
  <BlockEditor
    unitIndex={editor.activeUnit.index}
    value={editor.draft}
    initialCaret={editor.initialCaret}
    onChange={editor.updateDraft}
    onCommit={() => void editor.commitActive()}
    onCancel={() => void editor.commitActive()}
  />
) : null}
```

6. 回声抑制（改「监听 file-changed」的 effect）：

```tsx
async function reloadIfExternal() {
  const path = currentPathRef.current;
  if (!path) return;
  try {
    const latest = await invoke<LoadedDocument>("load_document", { path });
    const normalized = latest.markdown.replace(/\r\n/g, "\n");
    if (lastSavedMarkdownRef.current !== null && normalized === lastSavedMarkdownRef.current) {
      return; // 自己的写入回声：整体忽略（不更新状态、不递增 reloadTick、不闪印章）
    }
    editor.notifyInterrupted("文件已被外部修改 · 编辑已取消");
    await reloadCurrent(); // 外部变更继续走既有热重载路径
  } catch {
    // 读失败：保留旧内容
  }
}
```

7. mdlog 变活跃时清场：新增 effect

```tsx
useEffect(() => {
  if (isMdlogActive) {
    editor.notifyInterrupted("记录已开始 · 编辑已取消");
    if (editor.viewMode === "editing") {
      void editor.toggleView();
    }
  }
}, [isMdlogActive]);
```

8. 关窗前提交：在启动 effect 里加

```tsx
const unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
  if (editorRef.current?.activeUnit) {
    event.preventDefault();
    await editorRef.current.commitActive();
    void getCurrentWindow().close();
  }
});
```

（`editorRef` 每次渲染赋值为最新 `editor`，避免闭包过期；卸载时调用 `unlistenClose`。）

9. 提示条渲染（App 层，`editor.toast` 非空时）：

```tsx
{editor.toast ? (
  <div key={editor.toast.id} className="editor-toast" role="status">
    {editor.toast.message}
  </div>
) : null}
```

10. `TopBar` 新增 props `isEditing` / `onToggleEdit` / `canEdit`，左侧动作区加按钮（`aria-label="切换编辑视图"`，`canEdit` 为 false 时禁用并带 title「记录中 · 断开连接后才能修改」）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/App.test.tsx src/components/TopBar.test.tsx`
Expected: PASS

- [ ] **Step 5: 全量回归 + 提交**

```bash
npm test && npx tsc --noEmit
git add src/App.tsx src/App.test.tsx src/components/TopBar.tsx src/components/TopBar.test.tsx
git commit -m "feat(edit): App 接线（Ctrl+E 门禁、提交落盘、回声抑制、外部变更与 mdlog 分流）"
```

---

### Task 7: 编辑态样式与设计语言

**Files:**
- Modify: `src/styles/kami.css`（新增大区段，插在 `/* ===== Pi 对话记录与沙箱交互块 ===== */` 之前）
- Modify: `src/styles/kami.css.test.ts`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: Task 3/6 的类名契约：`.document-scroll__content--editing`、`.block-editor__input`、`.editor-toast`、`.markdown-body--editing`、`.vellum-unit-wrap`
- Produces: 无新增导出

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 src/styles/kami.css.test.ts
it("编辑态区段位于首个 .mdlog-widget 之前，且自身不含该字样", () => {
  const editorSection = css.indexOf(".block-editor__input");
  const mdlogSection = css.indexOf(".mdlog-widget");

  expect(editorSection).toBeGreaterThan(-1);
  expect(editorSection).toBeLessThan(mdlogSection);

  const editorBlock = css.slice(css.indexOf("/* ===== 编辑视图"), mdlogSection);
  expect(editorBlock).not.toContain(".mdlog-widget");
});

it("编辑态宿主提供定位上下文", () => {
  expect(css).toMatch(/\.document-scroll__content--editing\s*\{[^}]*position:\s*relative/);
  expect(css).toMatch(/\.block-editor__input\s*\{[^}]*position:\s*absolute/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/styles/kami.css.test.ts`
Expected: FAIL —— `editorSection` 为 -1

- [ ] **Step 3: 加样式**

```css
/* ===== 编辑视图（块级就地编辑） ===== */
.document-scroll__content--editing {
  position: relative;
}

.block-editor__input {
  position: absolute;
  z-index: 30;
  margin: 0;
  padding: 0 2px;
  border: 0;
  border-left: 2px solid var(--accent, #4a5b8c);
  background: transparent;
  color: var(--ink, #2f2f2c);
  font: inherit;
  font-family: var(--mono);
  font-size: 0.95rem;
  line-height: 1.7;
  resize: none;
  overflow: hidden;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
}

.markdown-body--editing .vellum-unit-wrap {
  display: contents;
}

.editor-toast {
  position: fixed;
  left: 50%;
  bottom: 18%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 3px;
  background: var(--tag-bg, rgba(74, 91, 140, 0.08));
  color: var(--ink, #2f2f2c);
  font: 500 10px/1 var(--mono);
  letter-spacing: 0.04em;
  pointer-events: none;
  z-index: 40;
}
```

要点：`font-family: var(--mono)` 与 `line-height: 1.7` 必须与渲染态正文一致（否则覆盖层与下方内容错位）；`.vellum-unit-wrap` 用 `display: contents` 保证数学块外层容器不参与布局。

- [ ] **Step 4: 同步 `DESIGN.md`**

在 token 表补三项（若已存在同名语义 token 则复用，不重复定义）：编辑面左边轨色 `--accent`、提示条底色 `--tag-bg`、等宽字体 `--mono`（后两者现有文件已定义，核对后仅补文档描述）。

- [ ] **Step 5: 校验 + 回归 + 提交**

```bash
npx -p @google/design.md designmd lint DESIGN.md
npx vitest run src/styles/kami.css.test.ts && npm test
git add src/styles/kami.css src/styles/kami.css.test.ts DESIGN.md
git commit -m "feat(edit): 编辑视图样式与设计语言同步（区段置于 mdlog 之前、display:contents 数学块容器）"
```

---

### Task 8: 全量回归、文档与真机复核

**Files:**
- Modify: `CHANGELOG.md`（新增 `### 新增` 条目）
- Modify: `AGENTS.md`（「性能结构约束」补两条：编辑视图不新增滚动系统、提交不闪印章）
- Modify: `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md`（登记 §6.4 简化修订）

- [ ] **Step 1: 全量回归**

```bash
npm test && npx tsc --noEmit && npm run build
cd src-tauri && cargo test && cd ..
```

Expected：`npm test` 全绿（基线 280 用例 + 本功能新增用例）；`vite build` 成功且入口 chunk 无显著增长（`mdast` 已在入口 chunk，仅新增约 6KB 源码）。

- [ ] **Step 2: 打包真机验证（`npm run tauri build`）**

逐项复核并记录到 `docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md`：

- [ ] 阅读视图与改动前完全一致（点击只选字，无标记属性）
- [ ] `Ctrl+E` 进编辑视图；点击块出现 textarea，下方内容被推下去而非被盖住
- [ ] 长段落编辑时视口不跳动（原生 scroll anchoring 生效）
- [ ] 点击 HTML 块 / 交互块只出提示，不出现编辑框；widget 点击仍能与其交互
- [ ] 提交后落盘内容正确；CRLF 文档换行符未被翻新（用 `git diff --stat` 或二进制比对确认）
- [ ] 提交后其下方未改动块的 widget iframe 未重建（iframe `src` 不变）
- [ ] 记录中的文档无法进入编辑视图（顶栏按钮禁用 + 提示）
- [ ] mdlog 追加触发的热重载不闪「墨迹未干」于我方提交之后（回声抑制生效）
- [ ] 提交耗时实测记录（用于校准 800ms 阈值）

- [ ] **Step 3: 文档与提交**

```bash
git add CHANGELOG.md AGENTS.md docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md
git commit -m "docs(edit): 块级就地编辑收口（更新日志、性能约束补记、spec 修订登记、验收报告）"
```

---

## 计划自查（写入后一次）

- **spec 覆盖**：§3 决策 D1–D8 → Task 1/2/4/6；§5 单元与标记 → Task 1/2；§6 激活与提交 → Task 3/4/6；§7 落盘与一致性 → Task 5/6；§8 与既有机制 → Task 6 的 6/7/8 条；§9 样式 → Task 7；§10 测试与验收 → 各 Task 的测试步骤 + Task 8；§11 风险 → Task 8 复核项。**已登记一处偏离**：§6.4 外部变更二选一横幅简化为中断路径（Task 4 Step 5）。
- **占位符**：无 TBD/TODO；每个代码步骤都有可执行内容。
- **类型一致性**：`EditUnit`/`buildEditUnits`/`spliceUnit`/`caretOffsetForRatio`/`computeOverlayBox`/`BlockEditorProps`（受控 `value`+`onChange`）/`SaveOutcome`/`UseDocumentEditorOptions` 在各任务间签名一致；`BlockEditor` 在 Task 3 与 Task 6 的调用点形状一致。
