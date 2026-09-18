import type { Code, Node, Parent, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import { parseFrontmatter } from "./frontmatter";

/// 解析扩展必须与渲染管线（MarkdownDocument 的 REMARK_PLUGINS）一致：
/// 渲染挂了 remark-gfm 与 remark-math，切分若少挂一个，块区间就会与渲染树错位。
/// 文首 frontmatter **不在这里加解析扩展**（不引 remark-frontmatter）：属性卡由
/// 渲染侧的 rehypeObsidian 换树实现，两边都按 `parseFrontmatter` 的同一区间对齐，
/// 这里只把区间合并成一块只读单元（见 buildEditUnits 尾部），解析行为保持不变。
const PARSE_OPTIONS = {
  extensions: [gfm(), math()],
  mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
};

export type EditUnitKind =
  | "paragraph"
  | "heading"
  | "listItem"
  | "blockquoteChild"
  | "footnoteChild"
  | "table"
  | "code"
  | "math"
  | "thematicBreak"
  | "html"
  | "widget"
  /// 文首 YAML frontmatter（渲染成属性卡）：整块合一个只读单元，见 buildEditUnits 尾部
  | "frontmatter"
  | "other";

export type EditUnit = {
  index: number;
  start: number;
  end: number;
  kind: EditUnitKind;
  editable: boolean;
  /// 不可编辑的原因（可编辑块为 undefined）。裁定 F10：不再声明永不产出的 "unmapped"。
  reason?: "html" | "widget" | "frontmatter";
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

/// 块级容器（终审 C1 / 裁定 F37）：children 一定是块级节点，可以安全下钻。
/// footnoteDefinition 与 blockquote 同列 —— 脚注正文**也是块级内容**，不下钻就会把整个脚注
/// （含其中的块级 HTML / widget 围栏源码）当成一个可编辑块，使「结构性只读」被绕过。
const BLOCK_CONTAINERS = new Set(["list", "listItem", "blockquote", "footnoteDefinition"]);

/// 块级容器类型守卫（下钻安全性由上方 `BLOCK_CONTAINERS` 的清单保证）
function isBlockContainer(node: Node): node is Parent {
  return BLOCK_CONTAINERS.has(node.type);
}

/// 结构性只读判定（裁定 F8）：节点自身或其**块级子树**里有块级 HTML / vellum-widget 围栏。
/// 只在块级容器（list / listItem / blockquote / footnoteDefinition）里下钻：
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
/// blockquote / footnoteDefinition 下钻到直接子块（不再深钻）。
/// 下钻时不能无条件用容器类型当 kind：子节点自身（或其块级子树）若是 HTML / widget，
/// 必须沿用其锁定类型，否则「结构性只读」在引用/列表/脚注内会被绕过（裁定 F8/F37）。
function collectUnits(root: Root): Array<{ node: Node; kind: EditUnitKind }> {
  const collected: Array<{ node: Node; kind: EditUnitKind }> = [];

  /// 把容器的直接块级子节点各自收成一块。子节点若是脚注定义（嵌套在引用/列表里的情形），
  /// 同样继续下钻 —— 否则「脚注定义不可绕过」只对顶层成例成立，
  /// 遍历式断言（裁定 F37）会红。
  const drill = (container: Parent, fallbackKind: EditUnitKind) => {
    for (const child of container.children as Node[]) {
      if (child.type === "footnoteDefinition") {
        drill(child as Parent, "footnoteChild");
        continue;
      }
      collected.push({ node: child, kind: lockedKindOf(child) ?? fallbackKind });
    }
  };

  for (const node of root.children as Node[]) {
    if (node.type === "list") {
      drill(node as Parent, "listItem");
      continue;
    }
    if (node.type === "blockquote") {
      drill(node as Parent, "blockquoteChild");
      continue;
    }
    if (node.type === "footnoteDefinition") {
      drill(node as Parent, "footnoteChild");
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
  const normalized = normalizeOverlaps(markdown, units);

  return mergeFrontmatter(markdown, normalized).map((unit, index) => ({ ...unit, index }));
}

/// 文首 frontmatter 合并成一块只读单元（属性卡）。
///
/// 为什么必须合并：文首 YAML 在 Markdown 眼里只是「分隔线 + setext 标题 + 列表」，
/// 逐块可编辑意味着用户能把 `date: …` 当正文改写，而渲染层给出的是属性卡——
/// 两边说的不是一回事。合并后整块只读，区间与卡片 hast 位置逐字节相同，
/// `rehypeEditUnits` 的包含判定因此能命中它（编辑视图页边灰 ×）。
/// 只做「删除 + 插入」，一律不动文本，其余单元的绝对偏移与改动前逐字节一致。
function mergeFrontmatter(markdown: string, sorted: EditUnit[]): EditUnit[] {
  const range = parseFrontmatter(markdown).range;
  if (!range) return sorted;

  const card: EditUnit = {
    index: 0,
    start: range.start,
    end: range.end,
    kind: "frontmatter",
    editable: false,
    reason: "frontmatter",
  };

  // 与区间有**任何**重叠的单元都去掉（不只是完全落在区间内的）：留下半个跨界的单元
  // 会破坏「有序、互不重叠」的区间不变量，而该不变量是整条编辑链路的立足点。
  const kept = sorted.filter((unit) => unit.end <= range.start || unit.start >= range.end);
  return [card, ...kept].sort((a, b) => a.start - b.start || a.end - b.end);
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
