import type { Code, Node, Parent, Root } from "mdast";
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
  /// 不可编辑的原因（可编辑块为 undefined）。裁定 F10：不再声明永不产出的 "unmapped"。
  reason?: "html" | "widget";
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

/// mdast 的 Node 是非联合接口（`type: string`），TS 不会按 type 自动窄化，
/// 因此显式给出代码节点 / 块级容器的类型守卫（取代原先的 `as { lang?: string }` 裸断言）。
function isCode(node: Node): node is Code {
  return node.type === "code";
}

const BLOCK_CONTAINERS = new Set(["list", "listItem", "blockquote"]);

/// 块级容器：children 一定是块级节点，可以安全下钻。
function isBlockContainer(node: Node): node is Parent {
  return BLOCK_CONTAINERS.has(node.type);
}

/// 结构性只读判定（裁定 F8）：节点自身或其**块级子树**里有块级 HTML / vellum-widget 围栏。
/// 只在 list / listItem / blockquote 这些块级容器里下钻：
/// paragraph / heading / tableCell 里的 html 是行内 HTML（不改变块级结构），
/// 若也当锁定会把「带 <span> 的段落」误判为只读。
function lockedKindOf(node: Node): "html" | "widget" | null {
  if (node.type === "html") return "html";
  if (isCode(node) && node.lang === "vellum-widget") return "widget";
  if (isBlockContainer(node)) {
    for (const child of node.children) {
      const locked = lockedKindOf(child);
      if (locked) return locked;
    }
  }
  return null;
}

function kindOf(node: Node): EditUnitKind {
  if (isCode(node)) {
    return node.lang === "vellum-widget" ? "widget" : "code";
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
/// 下钻时不能无条件用容器类型当 kind：子节点自身（或其块级子树）若是 HTML / widget，
/// 必须沿用其锁定类型，否则「结构性只读」在引用/列表内会被绕过（裁定 F8）。
function collectUnits(root: Root): Array<{ node: Node; kind: EditUnitKind }> {
  const collected: Array<{ node: Node; kind: EditUnitKind }> = [];

  for (const node of root.children as Node[]) {
    if (node.type === "list" || node.type === "blockquote") {
      const container = node as Parent;
      const fallbackKind: EditUnitKind = node.type === "list" ? "listItem" : "blockquoteChild";
      for (const child of container.children) {
        collected.push({ node: child, kind: lockedKindOf(child) ?? fallbackKind });
      }
      continue;
    }
    collected.push({ node, kind: kindOf(node) });
  }

  return collected;
}

/// 偏移所在行的行首（裁定 F9a）：块区间从行首起算，
/// 多行引用等块因此含首行 `> ` 标记，切片自包含、整段重打不会逃出引用/列表。
function lineStartOf(markdown: string, offset: number): number {
  return markdown.lastIndexOf("\n", offset - 1) + 1;
}

/// 不小于 offset 的最近行首（用于把夹紧后的 start 重新对齐到行首）。
function lineStartOnOrAfter(markdown: string, offset: number): number {
  if (offset <= 0) return 0;
  if (markdown[offset - 1] === "\n") return offset;
  const nextNewline = markdown.indexOf("\n", offset);
  return nextNewline === -1 ? markdown.length : nextNewline + 1;
}

/// 归一化重叠区间（裁定 F7）：解析器偶尔给出互相重叠的区间
/// （definition 与 setext heading 同起点；闭合围栏同行的尾随文字）。
/// 保留靠前的单元；后续单元把 start 推到前一单元 end 之后的最近行首
/// （保持 F9a 的「切片以行首起算」语义），推完为空则丢弃 —— 宁可少一个编辑入口，也不跨块写字节。
function normalizeOverlaps(markdown: string, sorted: EditUnit[]): EditUnit[] {
  const kept: EditUnit[] = [];
  for (const unit of sorted) {
    const previous = kept[kept.length - 1];
    if (!previous || unit.start >= previous.end) {
      kept.push(unit);
      continue;
    }
    const start = Math.max(previous.end, lineStartOnOrAfter(markdown, previous.end));
    if (start >= unit.end) continue;
    kept.push({ ...unit, start });
  }
  return kept;
}

/// 把 Markdown 源码切成块单元：每块带 [start, end) 源码区间与可编辑判定。
/// 区间之间的空白不属于任何块，编辑不触碰它们（保真）。
/// 返回的区间保证有序、互不重叠、并集 ⊆ [0, len)。
export function buildEditUnits(markdown: string): EditUnit[] {
  if (!markdown.trim()) return [];

  let root: Root;
  try {
    root = fromMarkdown(markdown, PARSE_OPTIONS) as Root;
  } catch {
    // 防御性代码（裁定 F10）：fromMarkdown 对任意字符串都能产出树、实际不抛，
    // 这里只兜住将来解析器行为变化；该分支不可达、不写测试。
    return [];
  }

  const units: EditUnit[] = [];
  for (const { node, kind } of collectUnits(root)) {
    const range = rangeOf(node);
    if (!range) continue;

    const locked = kind === "html" || kind === "widget";
    units.push({
      index: units.length,
      start: lineStartOf(markdown, range.start),
      end: range.end,
      kind,
      editable: !locked,
      reason: locked ? (kind === "widget" ? "widget" : "html") : undefined,
    });
  }

  units.sort((a, b) => a.start - b.start || a.end - b.end);
  return normalizeOverlaps(markdown, units).map((unit, index) => ({ ...unit, index }));
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
