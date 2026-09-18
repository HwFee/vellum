import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";
import { rehypeObsidian } from "./rehypeObsidian";

// 与 rehypeEditUnits.test.ts 同一套路：node_modules 里没有 hast 序列化工具（不新增依赖），
// 直接构造 hast 节点字面量驱动插件；端到端的 DOM 断言由 MarkdownDocument.test.tsx 承担。
type TestPosition = {
  start?: { line?: number; column?: number; offset?: number };
  end?: { line?: number; column?: number; offset?: number };
};

type TestText = { type: "text"; value: string };

type TestElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children?: TestNode[];
  position?: TestPosition;
};

type TestNode = TestText | TestElement | { type: string; children?: TestNode[]; position?: TestPosition };

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

/// 真实笔记形状的文首 YAML：标量 / 行内序列 / 块序列 / 未知键各一，
/// `sources` 里同时放 http 链接与 wikilink、再加一个非 http 协议项。
const SOURCE = [
  "---",
  "date: 2026-06-25",
  "tags: [concept, ai-agent]",
  'sources: ["https://example.com/a", "[[wiki/y]]", "javascript:alert(1)"]',
  "related:",
  '  - "[[wiki/x]]"',
  "weird-key.name: 值",
  "---",
  "",
  "## 标题",
  "",
  "正文。",
].join("\n");

const lineStart = (needle: string) => SOURCE.lastIndexOf("\n", SOURCE.indexOf(needle)) + 1;
const lineEnd = (needle: string) => SOURCE.indexOf("\n", SOURCE.indexOf(needle));

const FRONTMATTER = parseFrontmatter(SOURCE);
const RANGE = FRONTMATTER.range!;
const FENCE_START = SOURCE.lastIndexOf("---", RANGE.end - 1);

/// 与真实解析形态同形的四个前导节点：分隔线 + 段落（前几行 YAML）+ 列表（块序列项）
/// + setext 标题（末行 YAML 与闭合围栏）
function frontmatterNodes(): TestElement[] {
  return [
    el("hr", 0, 3, []),
    el("p", lineStart("date:"), lineEnd("related:"), [text("date: …")]),
    el("ul", lineStart('  - "[[wiki/x]]"'), lineEnd('  - "[[wiki/x]]"'), [
      el("li", lineStart('  - "[[wiki/x]]"'), lineEnd('  - "[[wiki/x]]"'), [text('"[[wiki/x]]"')]),
    ]),
    el("h2", lineStart("weird-key"), FENCE_START + 3, [text("weird-key.name: 值")]),
  ];
}

function bodyNodes(): TestElement[] {
  return [
    el("h2", lineStart("## 标题"), lineEnd("## 标题"), [text("标题")]),
    el("p", lineStart("正文。"), lineEnd("正文。"), [text("正文。")]),
  ];
}

/// 真实 hast 形态：块与块之间夹着**没有位置**的换行文本节点
/// （实测 hr 与 setext 标题之间就有这么一个 "\n"，插件必须连它一起吞掉）
function interleave(nodes: TestNode[]): TestNode[] {
  return nodes.flatMap((node) => [node, { type: "text", value: "\n" } as TestNode]);
}

const section = (nodes: TestNode[]) => interleave(nodes);

const run = (tree: unknown, frontmatter = FRONTMATTER) =>
  rehypeObsidian({ frontmatter })(tree);

const childrenOf = (node: TestNode): TestNode[] =>
  (node as { children?: TestNode[] }).children ?? [];

const elementChildren = (node: TestNode): TestElement[] =>
  childrenOf(node).filter((child): child is TestElement => child.type === "element");

const classesOf = (node: TestElement): string[] => (node.properties.className as string[]) ?? [];

function textOf(node: TestNode): string {
  if (node.type === "text") return (node as TestText).value;
  return childrenOf(node).map(textOf).join("");
}

/// 卡片按字段保序成行；行内是 [键 span, 值容器]
const rowsOf = (card: TestElement) => elementChildren(card);
const partsOf = (row: TestElement) => elementChildren(row);

const cardOf = (children: TestNode[]): TestElement => children[0] as TestElement;

describe("rehypeObsidian", () => {
  it("区间内的前导节点（含块间无位置的换行）整体换成一张属性卡，正文节点原样留在后面", () => {
    const body = bodyNodes();
    const children: TestNode[] = [...section(frontmatterNodes()), ...section(body)];

    run({ type: "root", children });

    // 四个前导节点 + 夹在其中的三个换行合成一个卡片节点
    expect(children).toHaveLength(5);
    expect(cardOf(children).tagName).toBe("div");
    expect(classesOf(cardOf(children))).toContain("md-props");
    // 正文节点必须是**原对象**、顺序不变（被删的只有区间内的四个块与三个换行）
    expect(children[1]).toBe(body[0]);
    expect(children[3]).toBe(body[1]);
    expect(children[2]).toEqual({ type: "text", value: "\n" });
    expect(children.map((child) => (child as TestElement).tagName)).toEqual([
      "div",
      "h2",
      undefined,
      "p",
      undefined,
    ]);
  });

  it("卡片的源码区间与被替换的 frontmatter 块逐字节相同（编辑视图靠它匹配只读单元）", () => {
    const children: TestNode[] = [...section(frontmatterNodes()), ...section(bodyNodes())];

    run({ type: "root", children });

    const card = cardOf(children);
    expect(card.position?.start?.offset).toBe(RANGE.start);
    expect(card.position?.end?.offset).toBe(RANGE.end);
    expect(card.position?.start?.line).toBe(1);
    expect(card.position?.start?.column).toBe(1);
    // 正文节点位置未被动过
    expect((children[1] as TestElement).position?.start?.offset).toBe(lineStart("## 标题"));
  });

  it("没有 frontmatter（range 为 null）时整棵树不动", () => {
    const plain = parseFrontmatter("# 标题\n\n正文。\n");
    const children: TestNode[] = [
      el("h1", 0, 4, [text("标题")]),
      el("p", 6, 10, [text("正文。")]),
    ];
    const snapshot = children.slice();

    run({ type: "root", children }, plain);

    expect(children).toEqual(snapshot);
    expect(children).toHaveLength(2);
  });

  it("围栏未闭合（malformed）时同样不动：文档照旧渲染成老样子", () => {
    const malformed = parseFrontmatter("---\ntype: log\ntags: [a, b]\n\n正文（没有闭合围栏）");
    expect(malformed.malformed).toBe(true);
    expect(malformed.range).toBeNull();

    const children: TestNode[] = [
      el("hr", 0, 3, []),
      el("p", 4, 40, [text("type: log\ntags: [a, b]")]),
    ];
    const snapshot = children.slice();

    run({ type: "root", children }, malformed);

    expect(children).toEqual(snapshot);
  });

  it("tags 出 chip、其他序列出条目、wikilink 项出锚点（不再去括号当纯文本）", () => {
    const children: TestNode[] = [...section(frontmatterNodes()), ...section(bodyNodes())];
    run({ type: "root", children });

    const rows = rowsOf(cardOf(children));
    // 字段保序：date / tags / sources / related / weird-key.name
    expect(rows.map((row) => textOf(partsOf(row)[0]))).toEqual([
      "date",
      "tags",
      "sources",
      "related",
      "weird-key.name",
    ]);

    const [, tags, sources, related] = rows;
    expect(classesOf(tags)).toEqual(["md-props__row", "md-props__row--tags"]);
    const tagList = partsOf(tags)[1];
    expect(classesOf(tagList)).toEqual(["md-props__list"]);
    const chips = elementChildren(tagList);
    expect(chips.map((chip) => [chip.tagName, classesOf(chip), textOf(chip)])).toEqual([
      ["span", ["md-props__chip"], "concept"],
      ["span", ["md-props__chip"], "ai-agent"],
    ]);

    // sources：http(s) 出锚点，wikilink 出库内锚点，其余留文本条目
    expect(classesOf(sources)).toEqual(["md-props__row", "md-props__row--sources"]);
    const sourceItems = elementChildren(partsOf(sources)[1]);
    expect(sourceItems.map((item) => item.tagName)).toEqual(["a", "a", "span"]);
    expect(sourceItems[0].properties.href).toBe("https://example.com/a");
    expect(classesOf(sourceItems[0])).toEqual(["md-props__link"]);
    expect(textOf(sourceItems[0])).toBe("https://example.com/a");
    // wikilink 项与正文里的同款锚点；非 http 协议的裸文本仍绝不变锚点
    expect(sourceItems[1].properties.href).toBe("wikilink:wiki/y");
    expect(sourceItems[1].properties.dataWikilink).toBe("wiki/y");
    expect(textOf(sourceItems[1])).toBe("wiki/y");
    expect(sourceItems[2].properties.href).toBeUndefined();
    expect(textOf(sourceItems[2])).toBe("javascript:alert(1)");

    // 块序列的 related 同样是条目（不是 chip）；wikilink 项同样出锚点
    expect(classesOf(related)).toEqual(["md-props__row", "md-props__row--related"]);
    const relatedItems = elementChildren(partsOf(related)[1]);
    expect(relatedItems.map((item) => [item.tagName, textOf(item)])).toEqual([["a", "wiki/x"]]);
    expect(relatedItems[0].properties.dataWikilink).toBe("wiki/x");
    expect(relatedItems[0].properties.href).toBe("wikilink:wiki/x");
  });

  it("标量与未知键照常展示，未知键不带修饰类", () => {
    const children: TestNode[] = [...section(frontmatterNodes()), ...section(bodyNodes())];
    run({ type: "root", children });

    const rows = rowsOf(cardOf(children));
    const [date, , , , weird] = rows;
    expect(classesOf(date)).toEqual(["md-props__row"]);
    expect(classesOf(partsOf(date)[0])).toEqual(["md-props__key"]);
    expect(classesOf(partsOf(date)[1])).toEqual(["md-props__value"]);
    expect(textOf(partsOf(date)[1])).toBe("2026-06-25");
    expect(textOf(partsOf(weird)[0])).toBe("weird-key.name");
    expect(textOf(partsOf(weird)[1])).toBe("值");
  });

  it("空 frontmatter（开合围栏相邻）整块丢掉，不留卡片、正文不动", () => {
    const empty = parseFrontmatter("---\n---\n正文。\n");
    expect(empty.range).toEqual({ start: 0, end: 8 });
    expect(empty.fields).toEqual([]);

    const paragraph = el("p", 8, 11, [text("正文。")]);
    const children: TestNode[] = [el("hr", 0, 3, []), el("hr", 4, 7, []), paragraph];

    run({ type: "root", children }, empty);

    expect(children).toHaveLength(1);
    expect(children[0]).toBe(paragraph);
    expect(children.some((child) => classesOf(child as TestElement).includes("md-props"))).toBe(false);
  });

  it("没有任何落在区间内的节点时不抛异常、整棵树不动", () => {
    const outside = el("p", RANGE.end + 2, RANGE.end + 6, [text("正文。")]);
    const noPosition: TestNode = { type: "element", tagName: "p", properties: {}, children: [text("无位置")] };
    const leadingBlank: TestNode = { type: "text", value: "\n" };

    const cases: unknown[] = [
      { type: "root", children: [outside] },
      { type: "root", children: [noPosition, outside] },
      { type: "root", children: [leadingBlank, outside] },
      { type: "root", children: [] },
      { type: "root" },
      null,
    ];

    for (const tree of cases) {
      expect(() => run(tree), JSON.stringify(tree)).not.toThrow();
    }

    // 认不出区间内节点 ⇒ 树保持原样（不插卡片，也不丢正文）
    const children: TestNode[] = [outside];
    run({ type: "root", children });
    expect(children).toEqual([outside]);
    // 区间内的节点一个都没收到之前，连空白文本节点也不吞（否则会凭空多出一张卡）
    const blankThenBody: TestNode[] = [leadingBlank, outside];
    run({ type: "root", children: blankThenBody });
    expect(blankThenBody).toEqual([leadingBlank, outside]);
  });
});

/// 无 frontmatter 的文档（range 为 null）：只有行内 wikilink 这一段在工作。
const PLAIN = parseFrontmatter("# 标题\n\n正文。\n");

function runPlain(children: TestNode[]) {
  const tree = { type: "root", children };
  rehypeObsidian({ frontmatter: PLAIN })(tree);
  return children;
}

/// 树里的 wikilink 锚点（按 dataWikilink 认，别的 <a> 是既有的外链/文档内锚点）
const anchorsIn = (nodes: TestNode[]): TestElement[] =>
  nodes.flatMap((node) => {
    if (node.type !== "element") return [];
    const element = node as TestElement;
    const self = element.tagName === "a" && element.properties.dataWikilink !== undefined ? [element] : [];
    return [...self, ...anchorsIn(childrenOf(element))];
  });

describe("rehypeObsidian · 行内 wikilink", () => {
  it("一行里的多个链接逐段切出：夹缝文本保留、方括号消失", () => {
    const paragraph = el("p", 0, 40, [text("见 [[wiki/a]] 与 [[wiki/b|B]]，还有 [[c#Day 10]]。")]);
    const children = runPlain([paragraph]);

    expect(paragraph.children).toHaveLength(7);
    expect(children[0]).toBe(paragraph);
    expect(paragraph.children!.map((child) => (child as TestElement).tagName ?? child.type)).toEqual([
      "text",
      "a",
      "text",
      "a",
      "text",
      "a",
      "text",
    ]);
    expect(textOf(paragraph)).toBe("见 wiki/a 与 B，还有 c。");
    expect(textOf(paragraph)).not.toContain("[[");
    expect(textOf(paragraph)).not.toContain("]]");
  });

  it("锚点形状：href=`wikilink:<目标>`、dataWikilink 记目标、title 记括号内原文，别名当标签", () => {
    const paragraph = el("p", 0, 40, [text("[[wiki/x|第十天]]")]);
    runPlain([paragraph]);

    const anchor = elementChildren(paragraph)[0];
    expect(anchor.tagName).toBe("a");
    expect(anchor.properties.href).toBe("wikilink:wiki/x");
    expect(anchor.properties.dataWikilink).toBe("wiki/x");
    expect(anchor.properties.title).toBe("wiki/x|第十天");
    expect(anchor.properties.dataWikilinkFragment).toBeUndefined();
    expect(textOf(anchor)).toBe("第十天");
    // 位置不参与下游判定（rehypeEditUnits 只看块级元素的区间），锚点因此可以没有位置
    expect(anchor.position).toBeUndefined();
  });

  it("片段单独携带（点击时交给 App，由它定位目标笔记里的标题）", () => {
    const paragraph = el("p", 0, 40, [text("[[wiki/x#常见错误（周复盘②追问实证）|复盘]]")]);
    runPlain([paragraph]);

    const anchor = elementChildren(paragraph)[0];
    expect(anchor.properties.dataWikilink).toBe("wiki/x");
    expect(anchor.properties.dataWikilinkFragment).toBe("常见错误（周复盘②追问实证）");
    expect(textOf(anchor)).toBe("复盘");
  });

  it("目标带 .md 时锚点里只留去扩展名的目标（解析与查表都用同一串）", () => {
    const paragraph = el("p", 0, 20, [text("[[wiki/x.md]]")]);
    runPlain([paragraph]);

    const anchor = elementChildren(paragraph)[0];
    expect(anchor.properties.dataWikilink).toBe("wiki/x");
    expect(anchor.properties.href).toBe("wikilink:wiki/x");
    expect(textOf(anchor)).toBe("wiki/x");
  });

  it("code / pre / 已有锚点子树的 `[[ ]]` 原样保留（示例代码不是链接）", () => {
    const pre = el("pre", 0, 20, [el("code", 0, 20, [text("[[fenced]]")], { className: ["language-md"] })]);
    const linked = el("p", 21, 40, [el("a", 21, 40, [text("[[in-anchor]]")], { href: "https://example.com" })]);
    const inlineCode = el("p", 41, 60, [el("code", 41, 60, [text("[[inline]]")])]);
    const paragraph = el("p", 61, 80, [text("[[real]]")]);
    const children = runPlain([pre, linked, inlineCode, paragraph]);

    const anchors = anchorsIn(children);
    // 只有正文段落那一个 `[[real]]` 变成锚点
    expect(anchors).toHaveLength(1);
    expect(anchors[0].properties.dataWikilink).toBe("real");
    expect(textOf(pre)).toBe("[[fenced]]");
    expect(textOf(linked)).toBe("[[in-anchor]]");
    expect(textOf(inlineCode)).toBe("[[inline]]");
  });

  it("未闭合、跨行、以及无目标的 `[[#片段]]` 都不产锚点", () => {
    const cases = ["未闭合 [[a", "跨行 [[a\nb]]", "片段链接 [[#标题]]", "空的 [[ ]]"];

    for (const value of cases) {
      const paragraph = el("p", 0, 40, [text(value)]);
      runPlain([paragraph]);

      expect(textOf(paragraph), value).toBe(value);
      expect(anchorsIn([paragraph]), value).toHaveLength(0);
    }
  });

  it("没有链接的文本节点保持原对象（无 wikilink 的文档在这段插件里逐字节不变）", () => {
    const paragraph = el("p", 0, 10, [text("普通正文。")]);
    const children = runPlain([paragraph]);

    expect(children[0]).toBe(paragraph);
    expect(paragraph.children![0]).toEqual(text("普通正文。"));

    const broken = el("p", 11, 20, [text("半截 [[")]);
    runPlain([broken]);
    expect((broken.children![0] as TestText).value).toBe("半截 [[");
  });

  it("属性卡里的值不再被行内扫描（卡片自产锚点，卡片内的字面 `[[` 不重复换树）", () => {
    const children: TestNode[] = [...section(frontmatterNodes()), ...section(bodyNodes())];
    const tree = { type: "root", children };

    run(tree);

    // 卡片内 related 的锚点只有一枚（重复扫描会把它拆坏或变成两枚）
    const card = cardOf(children);
    expect(anchorsIn([card])).toHaveLength(2); // sources 的 wikilink + related 的 wikilink
  });

  it("畸形树不抛异常：缺 children 的锚点、缺 properties 的元素、裸文本根都只当无事发生", () => {
    const bare = { type: "element", tagName: "a" } as TestNode;
    const bareProperties = { type: "element", tagName: "p", children: [text("[[x]]")] } as unknown as TestNode;
    const cases: TestNode[][] = [
      [bare],
      [bareProperties],
      [{ type: "text", value: "[[orphan]]" }],
      [el("p", 0, 10, [{ type: "text", value: "[[x]" }])],
      [el("a", 0, 10, [text("[[nested]]")])],
    ];

    for (const children of cases) {
      const tree = { type: "root", children };
      expect(() => rehypeObsidian({ frontmatter: PLAIN })(tree), JSON.stringify(tree)).not.toThrow();
    }
  });
});

/// Obsidian callout：`> [!tip] 标题` + 下一行正文。
/// 语料形状（8 篇 21 处实测）是「标记行与正文行之间没有空引用行」⇒ mdast 里它们是
/// **同一个段落、同一个文本节点里夹着一枚软换行**，不是「标题块 + 正文块」两块；
/// 夹具照这个真实形状造（含引用内首尾那两枚没有位置的换行文本节点，实测真实 hast 就有），
/// 端到端那半由 MarkdownDocument.test.tsx 承担。
function callout(type: string, options: { title?: string; body?: string; fold?: string } = {}) {
  const { title, body = "正文。", fold = "" } = options;
  const marker = `[!${type}]${fold}${title === undefined ? "" : ` ${title}`}`;
  const value = body === "" ? marker : `${marker}\n${body}`;

  const paragraph = el("p", 2, 2 + value.length, [text(value)]);
  const quote = el("blockquote", 0, 4 + value.length, [
    { type: "text", value: "\n" } as TestNode,
    paragraph,
    { type: "text", value: "\n" } as TestNode,
  ]);
  return { quote, paragraph };
}

/// 已知类型 → Obsidian 默认英文标签（与插件里的 CALLOUT_LABELS 逐项对齐）
const KNOWN_CALLOUTS: Array<[string, string]> = [
  ["note", "Note"],
  ["tip", "Tip"],
  ["info", "Info"],
  ["warning", "Warning"],
  ["important", "Important"],
  ["caution", "Caution"],
  ["danger", "Danger"],
  ["success", "Success"],
  ["question", "Question"],
  ["example", "Example"],
  ["quote", "Quote"],
];

const titleOf = (quote: TestElement): TestElement => elementChildren(quote)[0];

describe("rehypeObsidian · callout", () => {
  it.each(KNOWN_CALLOUTS)("类型 %s：装饰成 callout--%s 并带默认标签", (type, label) => {
    // 同时验大小写不敏感：标记写成大写词也该认
    for (const spelling of [type, type.toUpperCase()]) {
      const { quote, paragraph } = callout(spelling);
      // 标题留空 ⇒ 没有标题可剥离，正文（这里给了 body）必须在剥标记后照旧
      runPlain([quote]);

      expect(classesOf(quote), spelling).toEqual(["callout", `callout--${type}`]);
      expect(quote.properties.dataCallout, spelling).toBe(type);
      // 标题行是首个元素子节点，正文段落留在原位（第二个）
      expect(titleOf(quote).tagName, spelling).toBe("div");
      expect(classesOf(titleOf(quote)), spelling).toEqual(["callout__title"]);
      expect(textOf(titleOf(quote)), spelling).toBe(label);
      expect(elementChildren(quote)[1], spelling).toBe(paragraph);
      expect(textOf(paragraph), spelling).toBe("正文。");
    }
  });

  it("自定义标题取代默认标签，且 `[!tip]` 标记从正文里消失", () => {
    const { quote, paragraph } = callout("tip", { title: "今天没时间？", body: "启用保底模式。" });
    runPlain([quote]);

    expect(textOf(titleOf(quote))).toBe("今天没时间？");
    expect(textOf(quote)).not.toContain("[!");
    expect(textOf(quote)).not.toContain("Tip");
    expect(textOf(paragraph)).toBe("启用保底模式。");
    // 段落对象与位置都没换
    expect(elementChildren(quote)[1]).toBe(paragraph);
  });

  it("无标题标记（`> [!tip]`）用默认标签，段落被剥空但对象仍在", () => {
    const { quote, paragraph } = callout("tip", { body: "" });
    runPlain([quote]);

    expect(textOf(titleOf(quote))).toBe("Tip");
    expect(paragraph.children).toEqual([]);
    expect(elementChildren(quote)[1]).toBe(paragraph);
  });

  it("折叠符 `-` / `+` 被接受并剥掉（本切片不实现折叠）", () => {
    const folded = callout("tip", { fold: "-", title: "折叠标题", body: "正文。" });
    runPlain([folded.quote]);
    expect(textOf(titleOf(folded.quote))).toBe("折叠标题");
    expect(textOf(folded.paragraph)).toBe("正文。");
    expect(textOf(folded.quote)).not.toContain("-");

    const plus = callout("tip", { fold: "+", body: "正文。" });
    runPlain([plus.quote]);
    expect(textOf(titleOf(plus.quote))).toBe("Tip");
    expect(textOf(plus.paragraph)).toBe("正文。");
  });

  it("未知类型退化成 callout--generic，data-callout 与默认标签都保留原始写法", () => {
    const titled = callout("MyType", { title: "自定义", body: "正文。" });
    runPlain([titled.quote]);
    expect(classesOf(titled.quote)).toEqual(["callout", "callout--generic"]);
    expect(titled.quote.properties.dataCallout).toBe("MyType");
    expect(textOf(titleOf(titled.quote))).toBe("自定义");

    const bare = callout("Todo", { body: "正文。" });
    runPlain([bare.quote]);
    expect(bare.quote.properties.dataCallout).toBe("Todo");
    expect(textOf(titleOf(bare.quote))).toBe("Todo");
  });

  it("标记必须落在段落首行的行首：段落中间、行内代码、后续段落里的 `[!tip]` 一律不动", () => {
    const inMiddle = el("blockquote", 0, 20, [el("p", 2, 20, [text("文字 [!tip] 标题")])]);
    const inInlineCode = el("blockquote", 21, 41, [
      el("p", 23, 41, [el("code", 23, 41, [text("[!tip] 示例")])]),
    ]);
    // 标记在**第二**行（首行是别的正文）同样不算
    const onSecondLine = el("blockquote", 42, 62, [el("p", 44, 62, [text("正文。\n[!tip] 标题")])]);
    // 段落之前还有别的块（首个元素子节点不是段落）
    const afterCode = el("blockquote", 63, 83, [
      el("pre", 65, 75, [el("code", 65, 75, [text("[!tip] 示例")])]),
      el("p", 76, 83, [text("[!tip] 标题")]),
    ]);
    // 前导不是空白文本节点（裸文本引用）同样停手：跳过换行是唯一允许的宽容
    const leadingText = el("blockquote", 84, 100, [
      text("裸文本"),
      el("p", 90, 100, [text("[!tip] 标题")]),
    ]);

    for (const quote of [inMiddle, inInlineCode, onSecondLine, afterCode, leadingText]) {
      runPlain([quote]);
      expect(classesOf(quote), textOf(quote)).toEqual([]);
      expect(quote.properties.dataCallout, textOf(quote)).toBeUndefined();
    }

    expect(textOf(inMiddle)).toBe("文字 [!tip] 标题");
    expect(textOf(onSecondLine)).toBe("正文。\n[!tip] 标题");
    // 标题行与标记之间必须有空白：`[!tip]标题` 不是标记（避免把正文误吞成标题）
    const noSpace = el("blockquote", 101, 120, [el("p", 103, 120, [text("[!tip]标题\n正文。")])]);
    runPlain([noSpace]);
    expect(textOf(noSpace)).toBe("[!tip]标题\n正文。");
    expect(classesOf(noSpace)).toEqual([]);
  });

  it("正文段落的源码偏移逐字节不变（编辑视图的块单元按区间包含匹配，动了就落错块）", () => {
    const { quote, paragraph } = callout("tip", { title: "标题", body: "正文。" });
    const before = {
      paragraph: { ...paragraph.position },
      quote: { ...quote.position },
    };

    runPlain([quote]);

    expect(paragraph.position?.start?.offset).toBe(before.paragraph.start?.offset);
    expect(paragraph.position?.end?.offset).toBe(before.paragraph.end?.offset);
    expect(quote.position?.start?.offset).toBe(before.quote.start?.offset);
    expect(quote.position?.end?.offset).toBe(before.quote.end?.offset);
    // 段落仍是原有的那个元素对象（没有被换成新容器或新段落）
    expect(elementChildren(quote)[1]).toBe(paragraph);
  });

  it("正文里的行内内容（粗体、链接）照旧保留，只剥标记那一行", () => {
    const strong = el("strong", 20, 24, [text("粗体")]);
    const anchor = el("a", 24, 30, [text("链接")], { href: "https://example.com" });
    const paragraph = el("p", 2, 30, [text("[!info] 编号规则备忘\n"), strong, text("与"), anchor]);
    const quote = el("blockquote", 0, 30, [paragraph]);

    runPlain([quote]);

    expect(textOf(titleOf(quote))).toBe("编号规则备忘");
    expect(paragraph.children).toEqual([strong, text("与"), anchor]);
    // 行内元素是原对象（换树不重建既有子树）
    expect(paragraph.children?.[0]).toBe(strong);
    expect(paragraph.children?.[2]).toBe(anchor);
    expect(paragraph.position?.start?.offset).toBe(2);
  });

  it("提示块正文里的 `[[wikilink]]` 照样出锚点（两段互不依赖，顺序不影响结果）", () => {
    const { quote, paragraph } = callout("tip", { title: "标题", body: "见 [[wiki/x]]。" });
    runPlain([quote]);

    expect(classesOf(quote)).toEqual(["callout", "callout--tip"]);
    const anchor = elementChildren(paragraph).find((child) => child.tagName === "a");
    expect(anchor?.properties.dataWikilink).toBe("wiki/x");
    expect(textOf(anchor!)).toBe("wiki/x");
    expect(textOf(paragraph)).toBe("见 wiki/x。");

    // 反向：wikilink 先换过树的形态（锚点已在段落里）同样能被装饰。
    // 这两段都不看对方的产物，故调用顺序对结果没有影响。
    const preLinked = el("blockquote", 0, 30, [
      el("p", 2, 30, [
        text("[!tip] 标题\n见 "),
        el("a", 0, 0, [text("wiki/x")], { href: "wikilink:wiki/x", dataWikilink: "wiki/x" }),
        text("。"),
      ]),
    ]);
    runPlain([preLinked]);
    expect(classesOf(preLinked)).toEqual(["callout", "callout--tip"]);
    expect(textOf(titleOf(preLinked))).toBe("标题");
  });

  it("嵌套引用：内层同样按标记装饰，内层不是标记就照旧是普通引用", () => {
    const inner = el("blockquote", 20, 40, [el("p", 22, 40, [text("[!warning] 无证据 = 未完成\n正文。")])]);
    const outer = el("blockquote", 0, 40, [
      el("p", 2, 19, [text("[!tip] 外层标题\n外层正文。")]),
      inner,
    ]);

    runPlain([outer]);

    expect(classesOf(outer)).toEqual(["callout", "callout--tip"]);
    expect(classesOf(inner)).toEqual(["callout", "callout--warning"]);
    expect(textOf(titleOf(inner))).toBe("无证据 = 未完成");
    // 内层装饰不碰外层的标题行
    expect(textOf(titleOf(outer))).toBe("外层标题");

    const plainInner = el("blockquote", 41, 60, [el("p", 43, 60, [text("普通嵌套引用")])]);
    const outer2 = el("blockquote", 41, 60, [
      el("p", 43, 50, [text("[!note]\n正文。")]),
      plainInner,
    ]);
    runPlain([outer2]);
    expect(classesOf(outer2)).toEqual(["callout", "callout--note"]);
    expect(classesOf(plainInner)).toEqual([]);
  });

  it("幂等：跑第二遍不再插标题行、类名也不翻倍", () => {
    const { quote } = callout("tip", { title: "标题", body: "正文。" });
    const tree = { type: "root", children: [quote as TestNode] };

    runPlain([quote]);
    const afterFirst = JSON.parse(JSON.stringify(tree));

    runPlain([quote]);

    expect(JSON.parse(JSON.stringify(tree))).toEqual(afterFirst);
    expect(elementChildren(quote).filter((child) => classesOf(child).includes("callout__title"))).toHaveLength(1);
    expect(classesOf(quote)).toEqual(["callout", "callout--tip"]);
  });

  it("畸形树不抛异常：缺 children 的引用、缺 properties 的引用、无 value 的文本一律当无事发生", () => {
    const noChildren = { type: "element", tagName: "blockquote", properties: {} } as unknown as TestNode;
    const noProperties = {
      type: "element",
      tagName: "blockquote",
      children: [el("p", 0, 10, [text("[!tip] 标题")])],
    } as unknown as TestNode;
    const noParagraphChildren = {
      type: "element",
      tagName: "blockquote",
      properties: {},
      children: [{ type: "element", tagName: "p", properties: {} } as TestNode],
    } as TestNode;
    const noValue = {
      type: "element",
      tagName: "blockquote",
      properties: {},
      children: [
        { type: "element", tagName: "p", properties: {}, children: [{ type: "text" } as TestNode] } as TestNode,
      ],
    } as TestNode;
    // 首个元素子节点是段落，但段落的第一个子是裸文本节点之外的东西（缺 properties 的树形态）
    const textChild = el("blockquote", 0, 10, [text("[!tip] 标题")]);

    const trees: unknown[] = [
      { type: "root", children: [noChildren, noProperties, noParagraphChildren, noValue, textChild] },
      { type: "root", children: [] },
      { type: "root" },
      null,
      undefined,
    ];

    for (const tree of trees) {
      expect(() => rehypeObsidian({ frontmatter: PLAIN })(tree), JSON.stringify(tree)).not.toThrow();
    }

    // 认不出的形态保持原样（一个类名都不加、一个标题行都不插）
    for (const node of [noChildren, noProperties, noParagraphChildren, noValue, textChild]) {
      expect((node as TestElement).properties?.className, JSON.stringify(node)).toBeUndefined();
    }
    expect(textChild.children).toEqual([text("[!tip] 标题")]);
  });
});
