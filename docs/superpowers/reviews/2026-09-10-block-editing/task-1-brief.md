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

