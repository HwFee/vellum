import type { Node, Parent, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";

/// 解析扩展必须与渲染管线（MarkdownDocument 的 REMARK_PLUGINS）一致：
/// 渲染挂了 remark-gfm 与 remark-math，切分若少挂一个，块区间就会与渲染树错位。
const PARSE_OPTIONS = {
  extensions: [gfm(), math()],
  mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
};

export type EditUnitKind =
  | "paragraph"
  | "heading"
  | "listItem"
  | "blockquoteChild"
  | "table"
  | "code"
  | "math"
  | "thematicBreak"
  | "html"
  | "widget"
  | "other";

export type EditUnit = {
  index: number;
  start: number;
  end: number;
  kind: EditUnitKind;
  editable: boolean;
  reason?: "html" | "widget" | "unmapped";
};

type Positioned = {
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};

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
    case "paragraph":
      return "paragraph";
    case "heading":
      return "heading";
    case "table":
      return "table";
    case "math":
      return "math";
    case "html":
      return "html";
    case "thematicBreak":
      return "thematicBreak";
    default:
      return "other";
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

/// 把 Markdown 源码切成块单元：每块带 [start, end) 源码区间与可编辑判定。
/// 区间之间的空白不属于任何块，编辑不触碰它们（保真）。
export function buildEditUnits(markdown: string): EditUnit[] {
  if (!markdown.trim()) return [];

  let root: Root;
  try {
    root = fromMarkdown(markdown, PARSE_OPTIONS) as Root;
  } catch {
    // 解析失败：不提供任何可编辑块（安全方向）
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

/// 找到包含给定源码区间的块（用于把 DOM 节点映射回块）。
export function findUnitForRange(
  units: EditUnit[],
  start: number,
  end: number
): EditUnit | undefined {
  return units.find((unit) => unit.start <= start && unit.end >= end);
}

/// 把某块替换成新文本，块外内容（含块间空白）逐字节保留。
export function spliceUnit(markdown: string, unit: EditUnit, text: string): string {
  return markdown.slice(0, unit.start) + text + markdown.slice(unit.end);
}

/// 点击点纵向比率 → 对应的源码行行首偏移（光标落点的行级近似）。
/// 尾随换行产生的末尾空行不计入行数，否则点块底部会落到空行上。
export function caretOffsetForRatio(text: string, ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();

  const targetLine = Math.min(lines.length - 1, Math.round(clamped * (lines.length - 1)));

  let offset = 0;
  for (let index = 0; index < targetLine; index += 1) {
    offset += lines[index].length + 1;
  }
  return offset;
}
