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
    const units = buildEditUnits('<!-- mdlog:v1 -->\n\n<div class="x">hi</div>\n\n正文。\n');
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
