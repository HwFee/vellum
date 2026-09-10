import { findUnitForRange, type EditUnit } from "./editUnits";

type HastPosition = { start?: { offset?: number }; end?: { offset?: number } };

type HastElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children?: HastNode[];
  position?: HastPosition;
};

type HastNode = HastElement | { type: string; children?: HastNode[]; position?: HastPosition };

export type RehypeEditUnitsOptions = { units: EditUnit[] };

/// pre 必须外包一层容器（class 为 vellum-unit-wrap）来承载块标记，原因有二：
/// 1. MarkdownDocument 的 components.pre 覆盖渲染（CodeBlock / WidgetSandbox）不透传 hast 属性；
/// 2. rehype-katex 会把块级公式的 <pre> 连同属性整体替换成自己的 <div>。
/// 容器在编辑视图里由 .markdown-body--editing .vellum-unit-wrap { display: contents } 退出布局。
function needsWrapper(element: HastElement): boolean {
  return element.tagName === "pre";
}

function isElement(node: HastNode): node is HastElement {
  return node.type === "element";
}

/// 注意：walk 会给区间内的**任意嵌套元素**打标（段落里的行内 <code>、表格里的 <tr> …），
/// 因此 querySelectorAll("[data-vellum-unit]").length 一般**不等于**单元数，按块计数会误判；
/// 取块索引必须用 closest()（命中最近的外层块元素）。
/// 外层 <pre> 的标记是死负载（components.pre 不透传属性、DOM 里不存在），
/// 真正承载契约的是其外包容器；内层标记只在 katex 替换前作为属性沿用的保障。
function tag(element: HastElement, unit: EditUnit): void {
  element.properties.dataVellumUnit = unit.index;
  if (!unit.editable && unit.reason) {
    element.properties.dataVellumLocked = unit.reason;
  }
}

function walk(parent: { children?: HastNode[] }, units: EditUnit[]): void {
  const children = parent.children;
  if (!children) return;

  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (!isElement(node)) {
      walk(node, units);
      continue;
    }

    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (typeof start === "number" && typeof end === "number") {
      // 包含判定复用 editUnits 的单一实现（裁定 F1），本插件不得内联区间判定
      const unit = findUnitForRange(units, start, end);
      if (unit) {
        if (needsWrapper(node)) {
          const wrapper: HastElement = {
            type: "element",
            tagName: "div",
            properties: { className: ["vellum-unit-wrap"] },
            children: [node],
            position: node.position,
          };
          tag(wrapper, unit);
          tag(node, unit);
          children[index] = wrapper;
        } else {
          tag(node, unit);
        }
      }
    }

    walk(node, units);
  }
}

/// 给块元素打上 data-vellum-unit（不可编辑块另带 data-vellum-locked）。
/// 只在编辑视图挂载（阅读视图不加入管线 ⇒ DOM 与改动前逐字节一致）；
/// 位于 rehype-sanitize 之后，标记不经 sanitize，无需放宽 sanitize 白名单。
export function rehypeEditUnits({ units }: RehypeEditUnitsOptions) {
  return (tree: unknown): void => {
    if (units.length === 0) return;
    walk(tree as { children?: HastNode[] }, units);
  };
}
