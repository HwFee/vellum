import { describe, expect, it } from "vitest";
import { buildEditUnits } from "./editUnits";
import { rehypeEditUnits } from "./rehypeEditUnits";

// node_modules 内没有 rehype-stringify / hast-util-to-html（裁定 F3：不新增依赖），
// 因此这里直接构造 hast 节点字面量调用插件变压器；端到端的 DOM 断言由
// components/MarkdownDocument.test.tsx 的 editable 用例承担。
type HastPosition = { start: { offset: number }; end: { offset: number } };

type TestText = { type: "text"; value: string };

type TestElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children?: TestNode[];
  position?: HastPosition;
};

type TestNode = TestText | TestElement | { type: string; children?: TestNode[] };

function el(
  tagName: string,
  start: number,
  end: number,
  children: TestNode[] = [],
  properties: Record<string, unknown> = {}
): TestElement {
  return {
    type: "element",
    tagName,
    properties,
    children,
    position: { start: { offset: start }, end: { offset: end } },
  };
}

function text(value: string): TestText {
  return { type: "text", value };
}

/// 用与渲染管线同源的 buildEditUnits 求区间，再驱动插件（含包含判定的复用）
function runPlugin(markdown: string, children: TestNode[]): void {
  rehypeEditUnits({ units: buildEditUnits(markdown) })({ type: "root", children });
}

const unitOf = (node: TestElement) => node.properties.dataVellumUnit;
const lockedOf = (node: TestElement) => node.properties.dataVellumLocked;

describe("rehypeEditUnits", () => {
  it("按源码区间给块元素打上与 editUnits 一致的索引", () => {
    const markdown = "# 标题\n\n正文\n";
    const units = buildEditUnits(markdown);
    expect(units.map((unit) => unit.kind)).toEqual(["heading", "paragraph"]);

    const children: TestElement[] = [
      el("h1", units[0].start, units[0].end, [text("标题")]),
      el("p", units[1].start, units[1].end, [text("正文")]),
    ];
    runPlugin(markdown, children);

    expect(unitOf(children[0])).toBe(0);
    expect(unitOf(children[1])).toBe(1);
    expect(lockedOf(children[0])).toBeUndefined();
    expect(lockedOf(children[1])).toBeUndefined();
  });

  it("不可编辑块额外打上 locked 标记（html 与 widget 各自的原因）", () => {
    const htmlMarkdown = '<div class="x">hi</div>\n';
    const htmlUnits = buildEditUnits(htmlMarkdown);
    expect(htmlUnits[0].kind).toBe("html");
    const htmlChildren: TestElement[] = [
      el("div", htmlUnits[0].start, htmlUnits[0].end, [text("hi")], { className: ["x"] }),
    ];
    runPlugin(htmlMarkdown, htmlChildren);
    expect(unitOf(htmlChildren[0])).toBe(0);
    expect(lockedOf(htmlChildren[0])).toBe("html");

    const widgetMarkdown = "```vellum-widget\n<div>x</div>\n```\n";
    const widgetUnits = buildEditUnits(widgetMarkdown);
    expect(widgetUnits[0].kind).toBe("widget");
    const widgetChildren: TestElement[] = [
      el("pre", widgetUnits[0].start, widgetUnits[0].end, [
        el(
          "code",
          widgetUnits[0].start,
          widgetUnits[0].end,
          [text("<div>x</div>")],
          { className: ["language-vellum-widget"] }
        ),
      ]),
    ];
    runPlugin(widgetMarkdown, widgetChildren);
    expect(unitOf(widgetChildren[0])).toBe(0);
    expect(lockedOf(widgetChildren[0])).toBe("widget");
  });

  it("块级公式的 pre / 代码块的 pre 由外层容器承载标记", () => {
    // 两种 pre 都必须外包容器：
    // 1. rehype-katex 会把块级公式的 pre 连同属性整体替换成自己的 div；
    // 2. MarkdownDocument 的 components.pre（CodeBlock / WidgetSandbox）不透传 hast 属性。
    for (const markdown of ["$$\na = b\n$$\n", "```ts\nconst a = 1;\n```\n"]) {
      const units = buildEditUnits(markdown);
      expect(units).toHaveLength(1);

      const pre = el("pre", units[0].start, units[0].end, [
        el("code", units[0].start, units[0].end, [text("a = b")], {
          className: [markdown.startsWith("$$") ? "language-math" : "language-ts"],
        }),
      ]);
      const children: TestNode[] = [pre];
      runPlugin(markdown, children);

      const wrapper = children[0] as TestElement;
      expect(wrapper.tagName).toBe("div");
      expect(wrapper.properties.className).toContain("vellum-unit-wrap");
      expect(unitOf(wrapper)).toBe(0);
      expect(lockedOf(wrapper)).toBeUndefined();
      // 原 pre 仍是容器的唯一子节点，且同样带上索引（下游替换节点时属性不丢）
      expect(wrapper.children?.[0]).toBe(pre);
      expect(unitOf(pre)).toBe(0);
    }
  });

  it("跨多个块区间的容器不被打标，其内部的子块照常打标", () => {
    // blockquote 自身跨越多个块区间（包含判定不成立），只有区间内的段落被打标。
    // 裁定 F9a 后 blockquoteChild 的区间从行首起算，故夹具必须含两个子块：
    // 单子块引用的容器区间与子块区间恰好重合，会（正确地）一起被打标。
    const markdown = "> 引用一\n>\n> 引用二\n";
    const units = buildEditUnits(markdown);
    expect(units.map((unit) => unit.kind)).toEqual(["blockquoteChild", "blockquoteChild"]);
    const first = el("p", units[0].start, units[0].end, [text("引用一")]);
    const second = el("p", units[1].start, units[1].end, [text("引用二")]);
    const quote = el("blockquote", 0, markdown.trimEnd().length, [first, second]);
    const children: TestNode[] = [quote];
    runPlugin(markdown, children);

    expect(unitOf(quote)).toBeUndefined();
    expect(unitOf(first)).toBe(0);
    expect(unitOf(second)).toBe(1);
  });

  it("units 为空（阅读视图等价情形）时整棵树不产生任何标记", () => {
    const children: TestElement[] = [
      el("h1", 0, 4, [text("标题")]),
      el("pre", 6, 20, [el("code", 6, 20, [text("x")], { className: ["language-math"] })]),
    ];
    runPlugin("", children);

    expect(unitOf(children[0])).toBeUndefined();
    expect(lockedOf(children[0])).toBeUndefined();
    expect(children[1].tagName).toBe("pre");
    expect(unitOf(children[1])).toBeUndefined();
    expect(Object.keys(children[0].properties)).toHaveLength(0);
  });
});
