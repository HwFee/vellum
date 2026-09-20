import { describe, expect, it } from "vitest";
import { buildEditUnits, findUnitForRange } from "./editUnits";
import { collectTaskMarkers, toggleTaskMarkerInUnit } from "./taskList";

/// 与 useDocumentEditor 同一套查块方式（半开区间：end 取 itemStart + 1）
function unitAt(markdown: string, itemStart: number) {
  return findUnitForRange(buildEditUnits(markdown), itemStart, itemStart + 1);
}

function toggle(markdown: string, itemStart: number): string | null {
  const unit = unitAt(markdown, itemStart);
  if (!unit) throw new Error(`no unit at ${itemStart}`);
  return toggleTaskMarkerInUnit(markdown, unit.start, unit.end, itemStart);
}

describe("collectTaskMarkers", () => {
  it("识别 `- [ ]` / `- [x]` / `- [X]`，按源码顺序给出列表项起点与复选框偏移", () => {
    const markdown = "- [ ] a\n- [x] b\n- [X] c\n";

    expect(collectTaskMarkers(markdown)).toEqual([
      { itemStart: 0, offset: 3, checked: false },
      { itemStart: 8, offset: 11, checked: true },
      { itemStart: 16, offset: 19, checked: true },
    ]);
    expect(markdown[19]).toBe("X");
  });

  it("兼容 `*` / `+` / 有序列表标记与多空格、Tab 分隔", () => {
    const markdown = ["* [ ] a", "+ [X] b", "1. [x] c", "2) [ ] d", "-  [ ] e", "-\t[ ] f", ""].join("\n");

    expect(collectTaskMarkers(markdown).map((marker) => marker.checked)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    // 复选框字符的偏移必须落在真实字符上（不是按「起点 + 固定长度」猜的）
    for (const marker of collectTaskMarkers(markdown)) {
      expect(" xX".includes(markdown[marker.offset])).toBe(true);
      expect(markdown[marker.offset + 1]).toBe("]");
    }
  });

  it("嵌套列表按文档顺序：父项在前、子项紧随其后", () => {
    const markdown = "- [ ] a\n  - [x] b\n- [X] c\n";

    expect(collectTaskMarkers(markdown)).toEqual([
      { itemStart: 0, offset: 3, checked: false },
      { itemStart: 10, offset: 13, checked: true },
      { itemStart: 18, offset: 21, checked: true },
    ]);
  });

  it("代码块与原始 HTML 块里字面的 `- [ ]` 不是任务标记", () => {
    const markdown = [
      "```",
      "- [ ] 代码块里的字面量",
      "```",
      "",
      "<div>",
      "- [ ] HTML 块里的字面量",
      "</div>",
      "",
      "- [ ] 真任务",
      "",
    ].join("\n");

    const markers = collectTaskMarkers(markdown);
    expect(markers).toHaveLength(1);
    expect(markers[0].itemStart).toBe(markdown.indexOf("- [ ] 真任务"));
  });

  it("普通列表项与空内容的 `- [ ]`（mdast 不认作任务项）都不产出", () => {
    expect(collectTaskMarkers("- a\n- b\n")).toEqual([]);
    // 没有正文的 `- [ ]` 在渲染层也没有复选框（mdast-util-to-hast 只在 checked 为布尔时插入 input）
    expect(collectTaskMarkers("- [ ]\n- [x] \n")).toEqual([]);
    expect(collectTaskMarkers("")).toEqual([]);
  });
});

describe("toggleTaskMarkerInUnit", () => {
  it("顶层列表：每项自成一块，点哪项翻哪项", () => {
    const markdown = "- [ ] a\n- [x] b\n";
    const second = markdown.indexOf("- [x] b");

    expect(toggle(markdown, second)).toBe("- [ ] a\n- [ ] b\n");
    expect(toggle(markdown, 0)).toBe("- [x] a\n- [x] b\n");
  });

  it("嵌套列表：单元是外层列表项，按序号定位到被点的子项", () => {
    const markdown = "- [ ] a\n  - [x] b\n- [X] c\n";
    // 子项起点是它自己的 `-`（不是行首的两格缩进）
    const nested = markdown.indexOf("- [x] b");
    const outer = markdown.indexOf("- [ ] a");

    // 外层列表项是子项的所属单元：它含两个标记（自身 + 子项），序号 0 / 1 必须分清
    const unit = unitAt(markdown, nested);
    expect(unit?.start).toBe(0);
    expect(toggleTaskMarkerInUnit(markdown, unit!.start, unit!.end, nested)).toBe(
      "- [ ] a\n  - [ ] b\n- [X] c\n"
    );
    // 同一单元内点外层：翻的是第 0 个标记，子项不动。
    // 写入的字符沿用文档里已有的大写风格（文末那项是 `[X]`）
    expect(toggleTaskMarkerInUnit(markdown, unit!.start, unit!.end, outer)).toBe(
      "- [X] a\n  - [x] b\n- [X] c\n"
    );
  });

  it("引用里的列表：整个列表是一个单元，按出现顺序取第 N 个", () => {
    const markdown = "> - [ ] a\n> - [x] b\n";
    // 引用里的列表项起点是 `-` 自身：`>` 与空格是容器前缀，不属于列表项
    const second = markdown.indexOf("- [x] b");

    const unit = unitAt(markdown, second);
    expect(unit?.kind).toBe("blockquoteChild");
    expect(toggleTaskMarkerInUnit(markdown, unit!.start, unit!.end, second)).toBe(
      "> - [ ] a\n> - [ ] b\n"
    );
  });

  it("取消勾选写回空格；勾选沿用文档里已有的大写风格", () => {
    expect(toggle("- [X] a\n", 0)).toBe("- [ ] a\n");
    // 文档里出现过 `[X]` ⇒ 勾选也写大写，不把作者的风格悄悄改成小写
    const markdown = "- [X] a\n- [ ] b\n";
    expect(toggle(markdown, markdown.indexOf("- [ ] b"))).toBe("- [X] a\n- [X] b\n");
    // 没有任何大写先例时用 `[x]`
    expect(toggle("- [ ] a\n", 0)).toBe("- [x] a\n");
  });

  it("只改复选框那一个字符，其余字节逐字节保留（含 CRLF）", () => {
    const markdown = "- [ ] a\r\n- [x] b\r\n\r\n正文\r\n";
    const second = markdown.indexOf("- [x] b");
    const next = toggle(markdown, second);

    expect(next).toBe("- [ ] a\r\n- [ ] b\r\n\r\n正文\r\n");
    expect(next).toHaveLength(markdown.length);
    expect(next!.replace("- [ ] b", "- [x] b")).toBe(markdown);
  });

  it("翻转两次回到原文（`[x]` 文档往返稳定）", () => {
    const markdown = "- [ ] a\n- [x] b\n";
    const first = toggle(markdown, 0)!;
    const back = toggle(first, 0);
    expect(back).toBe(markdown);
  });

  it("定位不到就返回 null：非任务项、区间外、区间与 DOM 位置对不上", () => {
    const markdown = "- [ ] a\n- b\n";
    // 普通列表项（无复选框）
    expect(toggleTaskMarkerInUnit(markdown, 8, 11, 8)).toBeNull();
    // itemStart 不在区间内（只读块 / 位置漂移）
    expect(toggleTaskMarkerInUnit(markdown, 8, 11, 0)).toBeNull();
    // 区间不含该标记（截短的区间）
    expect(toggleTaskMarkerInUnit(markdown, 0, 1, 0)).toBeNull();
    // 代码块里的字面量
    const fenced = "```\n- [ ] a\n```\n";
    expect(toggleTaskMarkerInUnit(fenced, 0, fenced.length, fenced.indexOf("- [ ] a"))).toBeNull();
  });

  it("只读块（列表项里有块级 HTML）里的任务列表：定位得到单元但不可编辑", () => {
    const markdown = "- [ ] a\n  <div>x</div>\n";
    const unit = unitAt(markdown, 0);

    expect(unit?.editable).toBe(false);
    expect(unit?.reason).toBe("html");
    // 翻转本身是纯函数（门禁在 useDocumentEditor 一侧），这里只钉住「单元被正确判成只读」
    expect(toggleTaskMarkerInUnit(markdown, unit!.start, unit!.end, 0)).toBe(
      "- [x] a\n  <div>x</div>\n"
    );
  });
});
