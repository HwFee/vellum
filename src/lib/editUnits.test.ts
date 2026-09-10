import { describe, expect, it } from "vitest";
import { buildEditUnits, caretOffsetForRatio, findUnitForRange, spliceUnit } from "./editUnits";

const kinds = (markdown: string) => buildEditUnits(markdown).map((u) => u.kind);

/// 全部用例文档：区间不变量（有序、互不重叠、非空、在文档界内）对每一份都必须成立。
/// 裁定 F7 的两条反例（同起点重叠 / 围栏尾随文字重叠）也在其中。
const MARKDOWN_CORPUS: Array<[string, string]> = [
  ["标题与段落", "# 标题\n\n第一段。\n\n第二段。\n"],
  ["列表", "- 一\n- 二\n- 三\n"],
  ["引用多块", "> 第一段\n>\n> 第二段\n"],
  ["引用内列表", "> - 一\n> - 二\n"],
  ["HTML 与注释", '<!-- mdlog:v1 -->\n\n<div class="x">hi</div>\n\n正文。\n'],
  ["widget 围栏", "```vellum-widget\n<div>x</div>\n```\n"],
  ["代码围栏", "```ts\nconst a = 1;\n```\n"],
  ["行内 HTML 段落", "带 <span>行内</span> 标签的段落。\n"],
  ["公式块", "$$\na = b\n$$\n"],
  ["CRLF", "# 标题\r\n\r\n正文\r\n"],
  ["多行引用", "> 行一\n> 行二\n"],
  ["表格", "| a | b |\n| - | - |\n| 1 | 2 |\n"],
  ["分隔线", "---\n"],
  ["链接定义", "[ref]: http://x\n"],
  ["脚注定义", "[^1]: 脚注\n"],
  ["列表内引用", "- 项\n\n  > 引用\n"],
  ["引用内引用", "> > 深一层引用\n"],
  ["引用内 HTML", '> <div class="x">hi</div>\n'],
  ["脚注定义内 HTML", '正文[^1]\n\n[^1]:\n    <div class="x">hi</div>\n'],
  ["脚注定义内 widget 围栏", '正文[^1]\n\n[^1]:\n    ```vellum-widget\n    <div class="w">w</div>\n    ```\n'],
  ["脚注定义内引用", '正文[^1]\n\n[^1]:\n    > 引用\n'],
  ["引用内脚注定义", '> 正文[^1]\n>\n> [^1]:\n>     脚注正文\n'],
  ["引用内 widget 围栏", "> ```vellum-widget\n> <div>x</div>\n> ```\n"],
  ["列表项内 HTML", "- [ ] 待办\n\n  <div>raw</div>\n"],
  ["列表项内 widget 围栏", "- 项\n\n  ```vellum-widget\n  <div>y</div>\n  ```\n"],
  ["定义 + setext 标题（同起点重叠）", "[ref]: http://x\n正文段落。\n---"],
  ["闭合围栏同行尾随文字（重叠）", "- a\n\n  ```\n  x\n  ```- b\n- c\n"],
  ["闭合围栏同行尾随文字（最小例）", "- a\n  ```\n  b\n  ```c\n- d\n"],
];

describe("区间不变量（多文档集合）", () => {
  it.each(MARKDOWN_CORPUS)("%s：有序、互不重叠、非空且都在文档界内", (_name, markdown) => {
    const units = buildEditUnits(markdown);
    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i];
      expect(unit.start).toBeGreaterThanOrEqual(0);
      expect(unit.end).toBeGreaterThan(unit.start);
      expect(unit.end).toBeLessThanOrEqual(markdown.length);
      if (i > 0) expect(unit.start).toBeGreaterThanOrEqual(units[i - 1].end);
    }
  });
});

/// 确定性伪随机拼接（固定种子，无 Math.random）：审查用 fuzz 找到过区间重叠，
/// 归一化必须对任意拼接都成立，故把 fuzz 固化成回归门禁。
const FRAGMENTS = [
  "# 标题\n",
  "正文。\n",
  "- a\n",
  "- b\n",
  "  ```\n  x\n  ```\n",
  "  ```\n  y\n  ```tail\n",
  "> 引用\n",
  "> - 一\n> - 二\n",
  "```vellum-widget\n<div>x</div>\n```\n",
  '<div class="x">hi</div>\n',
  "[ref]: http://x\n",
  "---\n",
  "| a | b |\n| - | - |\n| 1 | 2 |\n",
  "$$\na = b\n$$\n",
  "\n",
  "\n\n",
];

function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe("区间不变量（确定性 fuzz）", () => {
  it("任意片段拼接下都无重叠/越界/空区间，且原样回填幂等", () => {
    const random = pseudoRandom(20260910);
    for (let iteration = 0; iteration < 300; iteration += 1) {
      const parts: string[] = [];
      const count = 1 + Math.floor(random() * 6);
      for (let i = 0; i < count; i += 1) {
        parts.push(FRAGMENTS[Math.floor(random() * FRAGMENTS.length)]);
      }
      const markdown = parts.join("");
      const units = buildEditUnits(markdown);
      for (let i = 0; i < units.length; i += 1) {
        const unit = units[i];
        expect(unit.end).toBeGreaterThan(unit.start);
        expect(unit.end).toBeLessThanOrEqual(markdown.length);
        if (i > 0) expect(unit.start).toBeGreaterThanOrEqual(units[i - 1].end);
        expect(spliceUnit(markdown, unit, markdown.slice(unit.start, unit.end))).toBe(markdown);
      }
    }
  });
});

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

  // —— 裁定 F8：下钻不得用容器类型覆盖子节点自身的锁定类型 ——

  it("引用内的块级 HTML 仍结构性只读", () => {
    const units = buildEditUnits('> <div class="x">hi</div>\n');
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("html");
    expect(units[0].editable).toBe(false);
    expect(units[0].reason).toBe("html");
  });

  it("引用内的 vellum-widget 围栏仍结构性只读", () => {
    const units = buildEditUnits("> ```vellum-widget\n> <div>x</div>\n> ```\n");
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("widget");
    expect(units[0].editable).toBe(false);
    expect(units[0].reason).toBe("widget");
  });

  it("列表项内的原始 HTML 与 widget 围栏仍结构性只读", () => {
    const html = buildEditUnits("- [ ] 待办\n\n  <div>raw</div>\n");
    expect(html).toHaveLength(1);
    expect(html[0].kind).toBe("html");
    expect(html[0].editable).toBe(false);
    expect(html[0].reason).toBe("html");

    const widget = buildEditUnits("- 项\n\n  ```vellum-widget\n  <div>y</div>\n  ```\n");
    expect(widget).toHaveLength(1);
    expect(widget[0].kind).toBe("widget");
    expect(widget[0].editable).toBe(false);
    expect(widget[0].reason).toBe("widget");
  });

  it("列表项内只有普通块时仍按 listItem 可编辑", () => {
    const units = buildEditUnits("- 项\n\n  > 引用\n");
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("listItem");
    expect(units[0].editable).toBe(true);
  });

  // —— 裁定 F37（终审 C1）：脚注定义是可下钻容器，正文逐块可编辑、锁定子块各自只读 ——

  it("脚注定义的正文按块下钻（与引用同列）且可编辑", () => {
    const markdown = "正文[^1]\n\n[^1]:\n    first para\n\n    second para\n";
    const units = buildEditUnits(markdown);
    expect(units.map((u) => u.kind)).toEqual(["paragraph", "footnoteChild", "footnoteChild"]);
    expect(units.every((u) => u.editable)).toBe(true);
    // 切片自包含（含行首 4 空格缩进），整块重打不会逃出脚注
    expect(markdown.slice(units[1].start, units[1].end)).toBe("    first para");
    expect(markdown.slice(units[2].start, units[2].end)).toBe("    second para");
    for (let i = 1; i < units.length; i += 1) {
      expect(units[i].start).toBeGreaterThanOrEqual(units[i - 1].end);
    }
  });

  // 遍历式守卫（裁定 F37）：不再逐容器补例子，而是对「容器类型 × 锁定块」的
  // 交叉清单逐一验证 —— 覆盖某锁定块的**每一个**单元都必须不可编辑且 reason 正确。
  // 断言按源码片段定位（不写死偏移）：新增容器类型漏进白名单时必红（C1 的脚注即此类）。
  const LOCKED_INNER_BLOCKS = [
    {
      name: "块级 HTML",
      /// 在 markdown 中的定位片段（跨行容器会给每行加前缀，故取单行片段）
      locator: '<div class="x">hi</div>',
      block: '<div class="x">hi</div>',
      reason: "html" as const,
    },
    {
      name: "vellum-widget 围栏",
      locator: '<div class="w">w</div>',
      block: '```vellum-widget\n<div class="w">w</div>\n```',
      reason: "widget" as const,
    },
  ];

  const innerIndent = (block: string, prefix: string) =>
    block
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");

  const INNER_CONTAINERS: Array<{ name: string; embed: (block: string) => string }> = [
    { name: "顶层", embed: (block) => `${block}\n` },
    { name: "引用内", embed: (block) => `${innerIndent(block, "> ")}\n` },
    { name: "列表项内", embed: (block) => `- 项\n\n${innerIndent(block, "  ")}\n` },
    { name: "脚注定义内", embed: (block) => `正文[^1]\n\n[^1]:\n${innerIndent(block, "    ")}\n` },
    { name: "脚注定义内引用内", embed: (block) => `正文[^1]\n\n[^1]:\n${innerIndent(block, "    > ")}\n` },
    { name: "引用内脚注定义内", embed: (block) => `> 正文[^1]\n>\n> [^1]:\n${innerIndent(block, ">     ")}\n` },
    { name: "列表项内脚注定义内", embed: (block) => `- 项[^1]\n\n  [^1]:\n${innerIndent(block, "      ")}\n` },
  ];

  /// 覆盖给定源码片段的全部单元（片段必须完整落在单元区间内）
  function unitsCovering(markdown: string, locator: string) {
    const start = markdown.indexOf(locator);
    expect(start, `定位片段必须出现在用例 markdown 中：${locator}`).toBeGreaterThanOrEqual(0);
    const end = start + locator.length;
    return buildEditUnits(markdown).filter((unit) => unit.start <= start && unit.end >= end);
  }

  for (const container of INNER_CONTAINERS) {
    for (const locked of LOCKED_INNER_BLOCKS) {
      it(`${container.name}的${locked.name}结构性只读`, () => {
        const markdown = container.embed(locked.block);
        const covering = unitsCovering(markdown, locked.locator);
        // 至少要有一个单元覆盖它（否则断言会退化成恒真）
        expect(covering.length).toBeGreaterThan(0);
        for (const unit of covering) {
          expect(unit.editable).toBe(false);
          expect(unit.reason).toBe(locked.reason);
        }
      });
    }
  }

  // —— 裁定 F9a：单元区间从所在行行首起算 ——

  it("多行引用单元的切片从行首起算，自包含（含首行 > 标记）", () => {
    const markdown = "> 行一\n> 行二\n";
    const units = buildEditUnits(markdown);
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("blockquoteChild");
    expect(markdown.slice(units[0].start, units[0].end)).toBe("> 行一\n> 行二");
  });

  it("引用内引用的单元同样从行首起算", () => {
    const markdown = "> > 深一层引用\n";
    const units = buildEditUnits(markdown);
    expect(units.map((u) => u.kind)).toEqual(["blockquoteChild"]);
    expect(units[0].start).toBe(0);
    expect(markdown.slice(units[0].start, units[0].end)).toBe("> > 深一层引用");
  });

  // —— 裁定 F7：重叠区间归一化 ——

  it("定义与 setext 标题同起点时归一化：保留靠前单元，后一单元夹紧到行首", () => {
    const markdown = "[ref]: http://x\n正文段落。\n---";
    const units = buildEditUnits(markdown);
    expect(units.map((u) => u.kind)).toEqual(["other", "heading"]);
    expect(markdown.slice(units[0].start, units[0].end)).toBe("[ref]: http://x");
    expect(markdown.slice(units[1].start, units[1].end)).toBe("正文段落。\n---");
    for (let i = 1; i < units.length; i += 1) {
      expect(units[i].start).toBeGreaterThanOrEqual(units[i - 1].end);
    }
  });

  it("闭合围栏同行尾随文字：夹紧后落在行中的尾随单元被丢弃，不留重叠", () => {
    const markdown = "- a\n\n  ```\n  x\n  ```- b\n- c\n";
    const units = buildEditUnits(markdown);
    expect(units.map((u) => [u.start, u.end])).toEqual([[0, 26]]);
  });

  // —— Minor-10：kind 覆盖缺口 ——

  it("表格 / 分隔线 / 定义各自成块且可编辑", () => {
    const table = buildEditUnits("| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(table).toHaveLength(1);
    expect(table[0].kind).toBe("table");
    expect(table[0].editable).toBe(true);

    const rule = buildEditUnits("---\n");
    expect(rule).toHaveLength(1);
    expect(rule[0].kind).toBe("thematicBreak");
    expect(rule[0].editable).toBe(true);

    const definition = buildEditUnits("[ref]: http://x\n");
    expect(definition).toHaveLength(1);
    expect(definition[0].kind).toBe("other");
    expect(definition[0].editable).toBe(true);

    // 裁定 F37 后脚注定义下钻：单段落脚注的单元是它的段落子块
    const footnote = buildEditUnits("[^1]: 脚注\n");
    expect(footnote).toHaveLength(1);
    expect(footnote[0].kind).toBe("footnoteChild");
    expect(footnote[0].editable).toBe(true);
    expect("[^1]: 脚注\n".slice(footnote[0].start, footnote[0].end)).toBe("[^1]: 脚注");
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

  it("归一化后的单元原样回填仍逐字节等于原文", () => {
    for (const [, markdown] of MARKDOWN_CORPUS) {
      for (const unit of buildEditUnits(markdown)) {
        expect(spliceUnit(markdown, unit, markdown.slice(unit.start, unit.end))).toBe(markdown);
      }
    }
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

  it("越界比率被夹紧到首/末行，空文本与单行文本都返回 0", () => {
    expect(caretOffsetForRatio(text, -1)).toBe(0);
    expect(caretOffsetForRatio(text, 2)).toBe(8);
    expect(caretOffsetForRatio("", 0.5)).toBe(0);
    expect(caretOffsetForRatio("单行", 1)).toBe(0);
  });
});

describe("findUnitForRange", () => {
  it("命中包含该区间的块，区间外返回 undefined", () => {
    const markdown = "# 标题\n\n正文\n";
    const units = buildEditUnits(markdown);
    expect(findUnitForRange(units, units[1].start, units[1].end)?.index).toBe(units[1].index);
    expect(findUnitForRange(units, markdown.length, markdown.length)).toBeUndefined();
  });

  it("部分重叠与跨界区间都不算命中", () => {
    const markdown = "# 标题\n\n正文\n";
    const units = buildEditUnits(markdown);
    const [heading, paragraph] = units;
    // 部分重叠：起点在块内、终点越过块尾
    expect(findUnitForRange(units, heading.start + 1, heading.end + 1)).toBeUndefined();
    // 跨界：横跨两个块
    expect(findUnitForRange(units, heading.start, paragraph.end)).toBeUndefined();
    // 完全包含：跨度恰为块区间
    expect(findUnitForRange(units, heading.start, heading.end)?.index).toBe(0);
  });
});
