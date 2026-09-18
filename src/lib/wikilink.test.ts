import { describe, expect, it } from "vitest";
import {
  extractWikilinkTargets,
  parseWikilink,
  splitWikilinks,
  wikilinkHref,
  wikilinkLabel,
} from "./wikilink";

/// 真实库（wisdom）实测的三种形态：裸名、库内路径（含 CJK 与空格）、片段是标题原文。
describe("parseWikilink", () => {
  it("裸目标", () => {
    expect(parseWikilink("firecrawl")).toEqual({ target: "firecrawl" });
    expect(parseWikilink("  firecrawl  ")).toEqual({ target: "firecrawl" });
  });

  it("带库内路径与 CJK/空格的目标：整串保留，只 trim 首尾", () => {
    expect(parseWikilink("wiki/courses/电磁场与电磁波-第1章-矢量分析")).toEqual({
      target: "wiki/courses/电磁场与电磁波-第1章-矢量分析",
    });
    expect(parseWikilink("wiki/concepts/kv cache 与 prefill")).toEqual({
      target: "wiki/concepts/kv cache 与 prefill",
    });
  });

  it("别名：第一个竖线切分，取竖线之后的整段", () => {
    expect(parseWikilink("wiki/x|别 名")).toEqual({ target: "wiki/x", alias: "别 名" });
    // 别名里再出现竖线属于书写错误，不猜：整段留在别名里
    expect(parseWikilink("wiki/x|a|b")).toEqual({ target: "wiki/x", alias: "a|b" });
  });

  it("片段（人读标题原文，不是 slug）：`#` 之后到竖线之前", () => {
    expect(parseWikilink("wiki/x#Day 10")).toEqual({ target: "wiki/x", fragment: "Day 10" });
    expect(parseWikilink("wiki/x#常见错误（周复盘②追问实证）")).toEqual({
      target: "wiki/x",
      fragment: "常见错误（周复盘②追问实证）",
    });
  });

  it("片段 + 别名同时存在时两者都拿到", () => {
    expect(parseWikilink("wiki/x#Day 10|第十天")).toEqual({
      target: "wiki/x",
      fragment: "Day 10",
      alias: "第十天",
    });
  });

  it("目标尾部省略的 .md / .markdown 一律去掉", () => {
    expect(parseWikilink("wiki/x.md")).toEqual({ target: "wiki/x" });
    expect(parseWikilink("wiki/x.markdown")).toEqual({ target: "wiki/x" });
    expect(parseWikilink("wiki/x.MD")).toEqual({ target: "wiki/x" });
    // 只去尾部；名字中间的同名子串不动
    expect(parseWikilink("wiki/md/x")).toEqual({ target: "wiki/md/x" });
  });

  it("容忍带方括号的原文，只剥一层；空片段/空别名归一为 undefined", () => {
    expect(parseWikilink("[[wiki/x|别名]]")).toEqual({ target: "wiki/x", alias: "别名" });
    expect(parseWikilink("wiki/x#")).toEqual({ target: "wiki/x" });
    expect(parseWikilink("wiki/x|")).toEqual({ target: "wiki/x" });
  });

  it("片段在前、目标为空（同篇内跳转）时目标为空串，由调用方决定降级", () => {
    expect(parseWikilink("#常见错误")).toEqual({ target: "", fragment: "常见错误" });
  });
});

describe("wikilinkLabel", () => {
  it("有别名用别名，否则用去掉扩展名的目标原文；片段不进标签", () => {
    expect(wikilinkLabel(parseWikilink("wiki/x|第十天"))).toBe("第十天");
    expect(wikilinkLabel(parseWikilink("wiki/x.md"))).toBe("wiki/x");
    expect(wikilinkLabel(parseWikilink("wiki/x#Day 10"))).toBe("wiki/x");
    expect(wikilinkLabel(parseWikilink("firecrawl"))).toBe("firecrawl");
  });
});

describe("wikilinkHref", () => {
  it("用独立方案，既不落入外链判定（`^[a-zA-Z]…:` 之外的 http(s) 分支）也是 # 之外的东西", () => {
    expect(wikilinkHref("wiki/x")).toBe("wikilink:wiki/x");
    expect(wikilinkHref("wiki/x")).not.toMatch(/^#/);
  });
});

describe("splitWikilinks", () => {
  it("一段文本里的多个链接与夹缝文本逐段切出", () => {
    const segments = splitWikilinks("见 [[wiki/x]] 与 [[y|别名]]，还有 [[z#Day 10]]。");

    expect(segments).toEqual([
      { type: "text", value: "见 " },
      { type: "wikilink", raw: "wiki/x", link: { target: "wiki/x" } },
      { type: "text", value: " 与 " },
      { type: "wikilink", raw: "y|别名", link: { target: "y", alias: "别名" } },
      { type: "text", value: "，还有 " },
      { type: "wikilink", raw: "z#Day 10", link: { target: "z", fragment: "Day 10" } },
      { type: "text", value: "。" },
    ]);
  });

  it("没有链接时原样返回一个文本片段", () => {
    expect(splitWikilinks("普通文本 [[ 未闭合")).toEqual([
      { type: "text", value: "普通文本 [[ 未闭合" },
    ]);
  });

  it("未闭合与跨行的 `[[` 不是链接；`[[#片段]]` 无目标也留作文本", () => {
    expect(splitWikilinks("[[a")).toEqual([{ type: "text", value: "[[a" }]);
    expect(splitWikilinks("[[a\nb]]")).toEqual([{ type: "text", value: "[[a\nb]]" }]);
    expect(splitWikilinks("[[#标题]]")).toEqual([{ type: "text", value: "[[#标题]]" }]);
  });

  it("连续两次调用互不影响（正则不共享 lastIndex）", () => {
    const text = "[[a]] 与 [[b]]";
    expect(splitWikilinks(text)).toEqual(splitWikilinks(text));
    expect(splitWikilinks(text)).toHaveLength(3);
  });
});

describe("extractWikilinkTargets", () => {
  it("按首次出现顺序去重，返回解析后的目标（已去扩展名）", () => {
    const markdown = "[[wiki/b]] [[wiki/a|别名]] [[wiki/b]] [[c#片段]] [[d.md]]";

    expect(extractWikilinkTargets(markdown)).toEqual(["wiki/b", "wiki/a", "c", "d"]);
  });

  it("跳过围栏代码块里的 `[[`", () => {
    const markdown = [
      "正文 [[real]]",
      "",
      "```md",
      "示例 [[fake-fenced]]",
      "```",
      "",
      "~~~",
      "示例 [[fake-tilde]]",
      "~~~",
      "",
      "结尾 [[real2]]",
    ].join("\n");

    expect(extractWikilinkTargets(markdown)).toEqual(["real", "real2"]);
  });

  it("跳过行内代码与多反引号行内代码", () => {
    const markdown = "文字 `[[inline-fake]]` 与 ``[[double-fake]]`` 以及 [[real]]";

    expect(extractWikilinkTargets(markdown)).toEqual(["real"]);
  });

  it("frontmatter 里的 wikilink 照收（属性卡的 related/sources 也要解析成链接）", () => {
    const markdown = ["---", 'related: ["[[wiki/x]]"]', "---", "", "正文 [[wiki/y]]"].join("\n");

    expect(extractWikilinkTargets(markdown)).toEqual(["wiki/x", "wiki/y"]);
  });

  it("未闭合的围栏吃掉到文末（不把围栏里的示例目标送去解析）", () => {
    const markdown = ["[[before]]", "", "```", "[[inside]]"].join("\n");

    expect(extractWikilinkTargets(markdown)).toEqual(["before"]);
  });

  it("没有 wikilink 时返回空数组", () => {
    expect(extractWikilinkTargets("# 标题\n\n普通正文。")).toEqual([]);
  });
});
