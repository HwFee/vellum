import type { Frontmatter, FrontmatterField } from "./frontmatter";
import {
  WIKILINK_ITEM_RE,
  parseWikilink,
  splitWikilinks,
  wikilinkHref,
  wikilinkLabel,
  type Wikilink,
} from "./wikilink";

type HastPosition = {
  start?: { line?: number; column?: number; offset?: number };
  end?: { line?: number; column?: number; offset?: number };
};

type HastElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children?: HastNode[];
  position?: HastPosition;
};

type HastText = { type: "text"; value: string; position?: HastPosition };

type HastNode =
  | HastElement
  | HastText
  | { type: string; children?: HastNode[]; position?: HastPosition };

export type ObsidianOptions = { frontmatter: Frontmatter };

/// 只有 http(s) 能变成 <a>：javascript:/data: 一律留作文本，不给锚点。
const HTTP_URL = /^https?:\/\//;

/// 行内 wikilink 换树时**不进入**的子树：代码（围栏与行内都是 code/pre，`[[` 只是示例文本）、
/// 已有锚点（链接里套链接是非法 HTML）、脚本与样式。数学公式此刻仍是 `<code class="math-*">`
/// （katex 在管线末尾才跑），因此公式里的 `[[` 同样不会被当成链接。
const WIKILINK_SKIP_TAGS = new Set(["code", "pre", "a", "script", "style"]);

/// 带修饰类的键（列表项形态不同：tags 是 chip，sources/related 是普通条目）
const MODIFIER_KEYS = new Set(["tags", "sources", "related"]);

/// Obsidian callout 的 11 个已知类型 → 默认标题（沿用 Obsidian 自己的英文标签，
/// 与库里笔记写英文类型词的写法对齐）。索引即小写类型词。
const CALLOUT_LABELS: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  info: "Info",
  warning: "Warning",
  important: "Important",
  caution: "Caution",
  danger: "Danger",
  success: "Success",
  question: "Question",
  example: "Example",
  quote: "Quote",
};

/// 标记行（段落首行）：`[!type]` + 可选折叠符 + 可选标题。
/// 三条严格性：类型只认 ASCII 词（`[!提示]` 不是标记）；标题必须以空白引入
///（`[!tip]标题` 判为普通引用——Obsidian 同样要求分隔，宁可漏装饰也不误吞正文）；
/// 折叠符 `-`/`+` 之后同样如此。本切片**不实现折叠**，折叠符只是被剥掉。
const CALLOUT_MARKER_RE = /^\[!([A-Za-z][A-Za-z0-9_-]*)\]([-+]?)(?:[ \t]+(.*))?$/;

/// Obsidian（frontmatter 属性卡 + 行内 wikilink + callout 提示块）→ 渲染树。
///
/// **为什么是在 rehype 层换树，而不是先把 frontmatter 从源码里剥掉**：编辑管线的块单元
/// （`editUnits` 算区间、`rehypeEditUnits` 按 hast 节点偏移匹配、`spliceUnit` 回写）
/// 全部按**绝对源码偏移**工作。交给 react-markdown 的字符串一旦被切短，正文每个块的
/// 偏移都会整体平移，块标记会落到相邻块上、回写会写坏文件。这里只替换**树节点**：
/// 卡片的位置写成被替换节点的原始区间 `[range.start, range.end)`，于是
/// `rehypeEditUnits` 随后按区间包含判定就能把它认成「frontmatter 只读块」，
/// 编辑视图的 `data-vellum-unit` / `data-vellum-locked` 与页边 × 免费拿到。
///
/// 位置（调用方负责）：必须挂在 rehype-sanitize **之后**——卡片、wikilink 锚点与 callout
/// 标题行都是插件自产的 hast，不经白名单；又在 rehypeEditUnits **之前**——卡片要先存在，
/// 才谈得上打标。
///
/// 兜底：`range` 为 null（没有 frontmatter，或首行像围栏但块未闭合的 malformed）时
/// 属性卡部分空操作；三段各自捕获异常（卡片 / 行内链接 / 提示块互不牵连），
/// 认不出的树形态一律退化成「那一部分不动」，绝不把整篇渲染打挂。
/// 三段之间**互不依赖**（callout 段不认字面 `[[`，wikilink 段不认 `[!…]`，
/// 正文里带锚点的提示块照样能被装饰），故调用顺序不影响结果。
export function rehypeObsidian({ frontmatter }: ObsidianOptions) {
  return (tree: unknown): void => {
    try {
      replaceFrontmatter(tree, frontmatter);
    } catch {
      // 防御性兜底（与 editUnits 的解析兜底同款）：正常输入不可达，
      // 只保证畸形树不会因本插件把整篇文档渲染打断。
    }
    try {
      linkifyWikilinks(tree);
    } catch {
      // 同上：换树失败时读者看到 `[[目标]]` 字面量，而不是一片空白
    }
    try {
      decorateCallouts(tree);
    } catch {
      // 同上：认不出的树形态退化成「引用照旧渲染」，而不是整篇空白
    }
  };
}

function replaceFrontmatter(tree: unknown, frontmatter: Frontmatter): void {
  const range = frontmatter?.range;
  if (!range || range.end <= range.start) return;

  const parent = tree as { children?: HastNode[] } | null;
  const children = parent?.children;
  if (!Array.isArray(children)) return;

  // 只收「完全落在区间内」的**前导**节点，遇到第一个不满足的就停：区间外的节点
  //（正文）一个都不碰。块与块之间的换行文本节点**没有位置**（真实管线实测：hr 与
  // setext 标题之间就夹着一个 "\n"），它们是空白、只能靠前后节点判断归属，故照收；
  // 其余无位置的形态认不出就停（停下来比猜错安全）。
  let count = 0;
  for (const child of children) {
    const nodeRange = offsetRange(child);
    if (!nodeRange) {
      // 只在已经收下区间内节点之后才吞空白：区间外的正文节点一个都不碰
      if (count > 0 && isBlankText(child)) {
        count += 1;
        continue;
      }
      break;
    }
    if (nodeRange.start < range.start || nodeRange.end > range.end) break;
    count += 1;
  }
  if (count === 0) return;

  // 空块（`---\n---\n`）没有字段可展示：整块丢掉，只留正文。
  const replacement = frontmatter.fields.length
    ? [buildCard(frontmatter.fields, cardPosition(range, children.slice(0, count)))]
    : [];

  children.splice(0, count, ...replacement);
}

function isBlankText(node: HastNode): boolean {
  const value = (node as { value?: unknown }).value;
  return node.type === "text" && typeof value === "string" && value.trim() === "";
}

function offsetRange(node: HastNode): { start: number; end: number } | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start, end };
}

/// 卡片的源码区间：两个 offset 必须**逐字节**等于 frontmatter 块，编辑视图的
/// 只读单元就靠它匹配；行/列没有消费方（下游只看 offset），沿用被替换节点的
/// 末位信息只为让 position 保持完整形态。
function cardPosition(
  range: { start: number; end: number },
  replaced: HastNode[]
): HastPosition {
  const last = replaced[replaced.length - 1]?.position?.end;
  return {
    start: { offset: range.start, line: 1, column: 1 },
    end: {
      offset: range.end,
      line: typeof last?.line === "number" ? last.line : 1,
      column: typeof last?.column === "number" ? last.column : range.end + 1,
    },
  };
}

function element(
  tagName: string,
  properties: Record<string, unknown>,
  children: HastNode[]
): HastElement {
  return { type: "element", tagName, properties, children };
}

function text(value: string): HastText {
  return { type: "text", value };
}

/// div.md-props → 每个字段一行 div.md-props__row（键 + 值）。
function buildCard(fields: FrontmatterField[], position: HastPosition): HastElement {
  const rows = fields.map((field) => {
    const className = ["md-props__row"];
    // 修饰类只在契约里那三个键上出现（键名可能含点号/中文，不能无脑拼进类名）
    if (MODIFIER_KEYS.has(field.key)) className.push(`md-props__row--${field.key}`);
    return element("div", { className }, [
      element("span", { className: ["md-props__key"] }, [text(field.key)]),
      ...valueNodes(field),
    ]);
  });

  // 位置必须落在节点自身（不是 properties 里）：rehypeEditUnits 按它做区间包含判定
  return { type: "element", tagName: "div", properties: { className: ["md-props"] }, children: rows, position };
}

function valueNodes(field: FrontmatterField): HastNode[] {
  if (!Array.isArray(field.value)) {
    return [element("span", { className: ["md-props__value"] }, [text(field.value)])];
  }

  const itemClass = field.key === "tags" ? "md-props__chip" : "md-props__item";
  const items = field.value.map((item) => {
    if (HTTP_URL.test(item)) {
      // className 只是 hast 契约：components.a 覆盖渲染不透传属性，
      // 真机 DOM 里的样式由 .md-props__list > a 结构性选择器承担
      return element("a", { href: item, className: ["md-props__link"] }, [text(item)]);
    }
    // `related` / `sources` 里的 wikilink 与正文里的同款：同一枚锚点、同一套解析结果
    const wikilink = WIKILINK_ITEM_RE.exec(item.trim());
    if (wikilink) return wikilinkAnchor(parseWikilink(wikilink[1]), wikilink[1].trim());
    return element("span", { className: [itemClass] }, [text(item)]);
  });

  return [element("span", { className: ["md-props__list"] }, items)];
}

/// wikilink 锚点。属性名用 camelCase（`dataWikilink`）：hast-util-to-jsx-runtime 经
/// property-information 把它落成 DOM 的 `data-wikilink`，`components.a` 读到的 props 键
/// 也正是带连字符的那个名字——两条都由 MarkdownDocument.test.tsx 的 DOM 断言锁定。
/// `title` 存括号内原文（读者 hover 时看到自己写的那串，而不是被拆过的三段）。
/// 解析不到的 href 方案见 `wikilinkHref`（`wikilink:` 不在 components.a 的外链判定里，
/// 但必须在 urlTransform 里放行，否则会被 defaultUrlTransform 清成空串）。
function wikilinkAnchor(link: Wikilink, raw: string): HastElement {
  const properties: Record<string, unknown> = {
    href: wikilinkHref(link.target),
    dataWikilink: link.target,
    title: raw,
  };
  // 片段（人读标题原文）单独携带：点击时随回调交给 App，由它在目标笔记的大纲里定位
  if (link.fragment) properties.dataWikilinkFragment = link.fragment;
  return element("a", properties, [text(wikilinkLabel(link))]);
}

/// 行内 `[[目标]]` 换树：把含 wikilink 的文本节点切成「文本 + 锚点」。
///
/// 跳过 `WIKILINK_SKIP_TAGS` 子树与属性卡（卡片的值是我们自己按结构化字段造的，
/// 里面的锚点已经就位，再扫一遍只会把卡片里的字面 `[[` 当成链接）。
/// 未匹配到任何链接的节点**原样保留**（同一个对象），因此没有 wikilink 的文档
/// 在这段插件里逐字节不变。
function linkifyWikilinks(tree: unknown): void {
  const root = tree as { children?: HastNode[] } | null;
  if (!root || !Array.isArray(root.children)) return;
  linkifyChildren(root);
}

function linkifyChildren(parent: { children?: HastNode[] }): void {
  const children = parent.children;
  if (!children) return;

  const next: HastNode[] = [];
  let changed = false;

  for (const child of children) {
    if (child.type === "text") {
      const value = (child as HastText).value;
      const segments = value.includes("[[") ? splitWikilinks(value) : [];
      if (segments.some((segment) => segment.type === "wikilink")) {
        for (const segment of segments) {
          next.push(
            segment.type === "wikilink"
              ? wikilinkAnchor(segment.link, segment.raw)
              : text(segment.value)
          );
        }
        changed = true;
        continue;
      }
    } else if (child.type === "element") {
      const element = child as HastElement;
      if (!WIKILINK_SKIP_TAGS.has(element.tagName) && !isPropsCard(element)) {
        linkifyChildren(element);
      }
    } else {
      linkifyChildren(child as { children?: HastNode[] });
    }
    next.push(child);
  }

  // 就地替换数组内容（不是换一个新数组）：调用方持有同一个引用，
  // 换引用会让 rehypeEditUnits 之外的下游与测试断言读到旧树
  if (changed) children.splice(0, children.length, ...next);
}

function isPropsCard(element: HastElement): boolean {
  // properties 在真实 hast 里恒有，但树来自外部解析器：缺字段时按「不是卡片」处理
  const className = (element as { properties?: { className?: unknown } }).properties?.className;
  return Array.isArray(className) && className.includes("md-props");
}

/// Obsidian callout（`> [!tip] 标题`）→ 就地把 blockquote **换形**，不换成新容器。
///
/// **为什么能不换元素**：编辑视图的块嵌套深度与块单元都由 `editUnits` 在**原始 Markdown**
/// 上算出（blockquote 的直接子块各成一块），若这里插一层新容器，页边 `¶`/`×` 的落位与
/// `BlockEditor` 的 `[data-vellum-unit]` 查找就会对着另一套结构；而 `components` 里也
/// **不能**多出 blockquote 覆盖渲染——它必须是 memo 结果，多一条就多一次整篇重解析。
/// 于是装饰全部落在既有节点上：blockquote 自己多两个类与一个 data 属性，正文段落
/// **原对象、原位、原 position**，只把标记行的字从它的首个文本节点里剥掉。
///
/// 语料形状（8 篇 21 处实测）：标记行与正文行之间没有空引用行，mdast 里是**同一个段落**、
/// 同一个文本节点里夹着一枚软换行，而不是「标题块 + 正文块」两块。
///
/// 折叠（`-`/`+`）**本切片不实现**：折叠符被接受并剥掉，头一行照常当标题渲染。
///
/// 兜底：任何认不出的树形态（首个非空白子节点不是段落、段落首个子节点不是文本、
/// 缺 properties …）一律退化成「引用不动」，绝不猜、绝不抛。
function decorateCallouts(tree: unknown): void {
  const root = tree as { children?: HastNode[] } | null;
  if (!root || !Array.isArray(root.children)) return;
  decorateCalloutChildren(root);
}

/// 递归整棵树：嵌套引用（`> > [!tip]`）同样装饰，内层不是标记就照旧是普通引用。
function decorateCalloutChildren(parent: { children?: HastNode[] }): void {
  const children = parent.children;
  if (!children) return;

  for (const child of children) {
    if (child.type !== "element") continue;
    const element = child as HastElement;
    if (element.tagName === "blockquote") decorateCallout(element);
    decorateCalloutChildren(element);
  }
}

function decorateCallout(quote: HastElement): void {
  // 幂等：已经有 callout 类（本插件跑过第二遍）就不再插第二个标题行
  if (hasClass(quote, "callout")) return;
  // properties 缺字段的树认不出（真实 hast 恒有，这里只是不猜）
  if (!quote.properties || typeof quote.properties !== "object") return;

  const children = quote.children;
  if (!Array.isArray(children)) return;

  // 跳过前导空白文本节点再取段落：真实 hast 在引用的首尾各夹着一枚**没有位置**的 "\n"
  //（与属性卡那段的实测形态同源）。但**只**跳过空白——遇到别的形态（非空文本、别的元素）
  // 就停手：说明这不是语料里那种规整引用，宁可不动也不去猜哪一块才是标记行
  let index = 0;
  while (index < children.length && isBlankText(children[index])) index += 1;

  const paragraph = children[index];
  if (!paragraph || paragraph.type !== "element" || (paragraph as HastElement).tagName !== "p") return;

  const paragraphChildren = (paragraph as HastElement).children;
  if (!Array.isArray(paragraphChildren)) return;

  const leading = paragraphChildren[0];
  if (!leading || leading.type !== "text") return;

  const marker = parseMarkerLine((leading as HastText).value);
  if (!marker) return;

  const type = marker.type.toLowerCase();
  const known = Object.prototype.hasOwnProperty.call(CALLOUT_LABELS, type);
  const className = ["callout", known ? `callout--${type}` : "callout--generic"];
  const dataCallout = known ? type : marker.type;

  // 类名合并而不是覆盖：引用上若已有别的类（如原始 HTML 带来的）不该被抹掉
  const existing = quote.properties.className;
  quote.properties.className = Array.isArray(existing) ? [...existing, ...className] : className;
  // 属性名写 camelCase：property-information 落成 DOM 的 data-callout（与 dataWikilink 同款）
  quote.properties.dataCallout = dataCallout;

  // 标题行：自定义标题优先，没有才用类型默认标签（与 Obsidian 一致——自定义标题**取代**
  // 类型名，类型区分改由类名/属性 + 左侧规则线与底色承担）。
  // 插在段落**之前**（而不是 unshift 到最前）：前导空白文本节点留在原位，
  // 标题行在 DOM 里因此仍是引用的首个元素子节点。
  children.splice(
    index,
    0,
    element("div", { className: ["callout__title"] }, [text(marker.title || labelOf(type, marker.type))])
  );

  // 剥标记：正文段落**本身**不动（position 也不动，它是钻取出来的块单元，靠区间包含匹配），
  // 只把标记行从首个文本节点里切掉。切完为空则连这个文本节点一起收掉，
  // 段落对象仍在（空段落在 HTML 里不占高，删掉它反而会少一个块单元）。
  if (marker.rest === "") paragraphChildren.shift();
  else paragraphChildren[0] = text(marker.rest);
}

function labelOf(type: string, raw: string): string {
  return CALLOUT_LABELS[type] ?? raw;
}

function hasClass(element: HastElement, name: string): boolean {
  const className = (element as { properties?: { className?: unknown } }).properties?.className;
  return Array.isArray(className) && className.includes(name);
}

/// 取段落首行当标记行：返回剥掉标记后剩下的正文与标题（标题无则空串）。
/// 首行末的 `\r`（CRLF 文档）先去掉——`.` 不匹配 `\r`，留着会让整条标记识别落空；
/// 剩下那半截正文里也把它丢掉，与编辑面拿到的是 LF 归一文本保持一致。
function parseMarkerLine(value: string): { type: string; title: string; rest: string } | null {
  // 缺 value 的文本节点（畸形树）按「认不出」处理，别让 `.indexOf` 抛出去
  if (typeof value !== "string" || value === "") return null;

  const newline = value.indexOf("\n");
  const head = (newline === -1 ? value : value.slice(0, newline)).replace(/\r$/, "");
  const match = CALLOUT_MARKER_RE.exec(head);
  if (!match) return null;

  return {
    type: match[1],
    title: (match[3] ?? "").trim(),
    rest: newline === -1 ? "" : value.slice(newline + 1).replace(/^\r/, ""),
  };
}
