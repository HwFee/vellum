import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";

/** wisdom 笔记库里最常见的 frontmatter 形态（键与值取自真实笔记的形状）。 */
const NOTE = [
  "---",
  "date: 2026-06-25",
  "updated: 2026-06-25",
  "type: concept",
  "tags: [concept, ai-agent, browser-automation]",
  'sources: ["https://github.com/browserbase/stagehand", "https://github.com/browser-use/browser-use"]',
  'related: ["[[wiki/projects/ponytail]]", "[[wiki/projects/kami]]"]',
  "ai-first: true",
  "---",
  "",
  "## For future Claude",
  "",
  "正文。",
].join("\n");

describe("parseFrontmatter", () => {
  it("解开真实笔记的 frontmatter：保序键值对，序列拆成数组", () => {
    const result = parseFrontmatter(NOTE);

    expect(result.malformed).toBe(false);
    expect(result.fields).toEqual([
      { key: "date", value: "2026-06-25" },
      { key: "updated", value: "2026-06-25" },
      { key: "type", value: "concept" },
      { key: "tags", value: ["concept", "ai-agent", "browser-automation"] },
      {
        key: "sources",
        value: ["https://github.com/browserbase/stagehand", "https://github.com/browser-use/browser-use"],
      },
      { key: "related", value: ["[[wiki/projects/ponytail]]", "[[wiki/projects/kami]]"] },
      { key: "ai-first", value: "true" },
    ]);
    expect(result.body.startsWith("\n## For future Claude")).toBe(true);
  });

  it("正文切片与 range 严格对齐（编辑视图按源码偏移定位该块）", () => {
    const result = parseFrontmatter(NOTE);

    expect(result.range).not.toBeNull();
    expect(result.body).toBe(NOTE.slice(result.range!.end));
    // 块首行起点为 0，剥掉后正文不再含任何围栏行
    expect(result.range!.start).toBe(0);
    expect(result.body.includes("---")).toBe(false);
  });

  it("块序列（related / sources 的多行写法）逐项收集，裸 URL 与引号项都还原", () => {
    const source = [
      "---",
      "type: log",
      "related:",
      '  - "[[wiki/concepts/causal-mask]]"',
      "  -  [[wiki/concepts/kv-cache-memory-and-prefill-decode]]",
      "sources:",
      "  - https://arxiv.org/abs/1706.03762",
      "  - https://zh.d2l.ai/chapter-attention-mechanisms/attention-scoring-functions.html",
      "---",
      "body",
    ].join("\n");

    const { fields } = parseFrontmatter(source);

    expect(fields).toEqual([
      { key: "type", value: "log" },
      { key: "related", value: ["[[wiki/concepts/causal-mask]]", "[[wiki/concepts/kv-cache-memory-and-prefill-decode]]"] },
      { key: "sources", value: ["https://arxiv.org/abs/1706.03762", "https://zh.d2l.ai/chapter-attention-mechanisms/attention-scoring-functions.html"] },
    ]);
  });

  it("空行分隔的块序列不丢项", () => {
    const { fields } = parseFrontmatter(["---", "related:", '  - "[[a]]"', "", '  - "[[b]]"', "---", "x"].join("\n"));

    expect(fields).toEqual([{ key: "related", value: ["[[a]]", "[[b]]"] }]);
  });

  it("空值键没有后续项时是空数组，不是空字符串", () => {
    const { fields } = parseFrontmatter(["---", "related:", "type: log", "---", "x"].join("\n"));

    expect(fields).toEqual([
      { key: "related", value: [] },
      { key: "type", value: "log" },
    ]);
  });

  it("未知键与中文键照常展示，不丢内容", () => {
    const { fields } = parseFrontmatter(["---", "weird-key.name: 值", "标题: 中文键", "---", "x"].join("\n"));

    expect(fields).toEqual([
      { key: "weird-key.name", value: "值" },
      { key: "标题", value: "中文键" },
    ]);
  });

  it("重复键保留首现顺序、取末值", () => {
    const { fields } = parseFrontmatter(["---", "type: a", "status: x", "type: b", "---", "x"].join("\n"));

    expect(fields).toEqual([
      { key: "type", value: "b" },
      { key: "status", value: "x" },
    ]);
  });

  it("注释行与块内空行不产生字段", () => {
    const { fields } = parseFrontmatter(["---", "# 说明", "", "type: log", "---", "x"].join("\n"));

    expect(fields).toEqual([{ key: "type", value: "log" }]);
  });

  it("引号内的逗号不切分（别把 URL / wikilink 的项拆坏）", () => {
    const { fields } = parseFrontmatter(['---', 'tags: ["a, b", c]', "---", "x"].join("\n"));

    expect(fields).toEqual([{ key: "tags", value: ["a, b", "c"] }]);
  });

  it("没有 frontmatter 的文档原样返回", () => {
    const source = "# 标题\n\n正文，含 --- 分隔线与 [[wikilink]]。\n";
    const result = parseFrontmatter(source);

    expect(result).toEqual({ fields: [], body: source, range: null, malformed: false });
  });

  it("正文中间的 --- 不被当成 frontmatter（只在文档首行生效）", () => {
    const source = "\n---\ntype: log\n---\n";
    const result = parseFrontmatter(source);

    expect(result.range).toBeNull();
    expect(result.body).toBe(source);
  });

  it("未闭合的围栏退化为老行为：正文与区间都不动，只标记 malformed", () => {
    const source = ["---", "type: log", "tags: [a, b]", "", "正文（没有闭合围栏）"].join("\n");
    const result = parseFrontmatter(source);

    expect(result.malformed).toBe(true);
    expect(result.range).toBeNull();
    expect(result.body).toBe(source);
    expect(result.fields).toEqual([]);
  });

  it("空 frontmatter（开合围栏相邻）剥掉后字段为空", () => {
    const result = parseFrontmatter("---\n---\n正文");

    expect(result).toEqual({ fields: [], body: "正文", range: { start: 0, end: 8 }, malformed: false });
  });

  it("CRLF 文档：块照常解析，正文保留 CRLF", () => {
    const source = "---\r\ntype: log\r\n---\r\n第一行\r\n第二行\r\n";
    const result = parseFrontmatter(source);

    expect(result.fields).toEqual([{ key: "type", value: "log" }]);
    expect(result.body).toBe("第一行\r\n第二行\r\n");
    expect(result.body).not.toContain("\r\n---");
  });

  it("带 BOM 的文件：BOM 随块一起剥掉，不落进正文", () => {
    const source = "\uFEFF---\ntype: log\n---\n正文";
    const result = parseFrontmatter(source);

    expect(result.fields).toEqual([{ key: "type", value: "log" }]);
    expect(result.body).toBe("正文");
    expect(result.range).toEqual({ start: 0, end: 19 });
  });

  it("各种畸形输入都不抛异常", () => {
    const sources = [
      "",
      "---",
      "---\n",
      "----\ntype: x\n----\n",
      "---\n[not a key\n---\n",
      "---\n  - orphan\n---\n",
      "---\nkey:\n\t- tabbed\n---\n",
      "---\nkey: [unclosed\n---\n",
      "---\nkey: \"unbalanced\n---\n",
      "---\n::: \n---\n",
    ];

    for (const source of sources) {
      expect(() => parseFrontmatter(source), JSON.stringify(source)).not.toThrow();
    }
  });
});
