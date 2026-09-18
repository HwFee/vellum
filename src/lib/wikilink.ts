/**
 * Obsidian `[[wikilink]]` 的解析与抽取（纯函数，无依赖）。
 *
 * 实测（wisdom 笔记库 179 篇 / 858 处链接）的形态：`[[目标]]` 为主，另有
 * `[[目标|别名]]` 13 处、`[[目标#人读标题]]` 10 处、`[[目标.md]]` 6 处；
 * 目标可含 `/`、空格与 CJK，片段是**标题原文**（`#Day 10`）而不是 slug。
 *
 * 两条分工：
 * - `parseWikilink` / `wikilinkLabel` 只做文本切分，不碰文件系统；
 * - 解析（目标 → 磁盘上的笔记）在 Rust 侧 `resolve_wikilinks`，本模块不猜路径。
 *
 * `[[]]` 之外的方括号、未闭合的 `[[`、片段链接（`[[#标题]]` 无目标）一律按纯文本留下，
 * 绝不产出一个「假链接」把读者带去错误的地方。
 */
export interface Wikilink {
  /** 目标（已 trim、已去尾部 `.md`/`.markdown`）；可能含 `/`、空格与 CJK。 */
  target: string;
  /** `#` 之后的人读标题文本（App 点击时据此在目标笔记里定位标题）。 */
  fragment?: string;
  /** `|` 之后的显示别名。 */
  alias?: string;
}

/** 行内 wikilink 的全局匹配（不含换行：跨行的 `[[` 不构成链接）。 */
export const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g;

/** 整个字符串就是一个 wikilink（frontmatter 序列项用）。 */
export const WIKILINK_ITEM_RE = /^\[\[([^[\]\n]+)\]\]$/;

/** 目标里可省略的扩展名（Obsidian 两种都认）。 */
const MARKDOWN_EXT = /\.(?:md|markdown)$/i;

/** wikilink 锚点的 href 方案：既非 `http(s)`（不会被当成外链交给系统 opener），
 *  也不是 `#`（不会被 App 的文档内锚点接管），urlTransform 里有一处显式放行。 */
export const WIKILINK_SCHEME = "wikilink:";

export function wikilinkHref(target: string): string {
  return `${WIKILINK_SCHEME}${target}`;
}

/**
 * 切分 `[[…]]` 内部的原文。
 *
 * 顺序：先在**第一个** `|` 处切出别名，再在剩下的头段里按**第一个** `#` 切出片段
 * （Obsidian 的书写顺序是 `[[目标#片段|别名]]`，片段随别名之前）。目标去尾部扩展名，
 * 三部分都 trim；空片段/空别名归一为 `undefined`。
 */
export function parseWikilink(raw: string): Wikilink {
  let inner = raw.trim();
  if (inner.startsWith("[[")) inner = inner.slice(2);
  if (inner.endsWith("]]")) inner = inner.slice(0, -2);

  const pipe = inner.indexOf("|");
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : "";
  const head = pipe >= 0 ? inner.slice(0, pipe) : inner;

  const hash = head.indexOf("#");
  const fragment = hash >= 0 ? head.slice(hash + 1).trim() : "";
  const target = (hash >= 0 ? head.slice(0, hash) : head).trim().replace(MARKDOWN_EXT, "");

  return {
    target,
    fragment: fragment || undefined,
    alias: alias || undefined,
  };
}

/** 显示文本：有别名用别名，否则用目标原文（已去扩展名）；片段不进标签。 */
export function wikilinkLabel(link: Wikilink): string {
  return link.alias ?? link.target;
}

export type WikilinkSegment =
  | { type: "text"; value: string }
  | { type: "wikilink"; raw: string; link: Wikilink };

/**
 * 把一段纯文本按 wikilink 切成「文本 / 链接」片段（rehype 插件用它换树）。
 *
 * 无目标的片段链接（`[[#标题]]`）与未闭合的 `[[` 原样留作文本：它们没有可解析的目标，
 * 变成锚点只会得到死链。`raw` 是被匹配到的括号内原文，供 `title` 提示使用。
 */
export function splitWikilinks(value: string): WikilinkSegment[] {
  const re = new RegExp(WIKILINK_RE.source, "g");
  const segments: WikilinkSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(re)) {
    const start = match.index ?? 0;
    const link = parseWikilink(match[1]);
    if (!link.target) continue;

    if (start > cursor) segments.push({ type: "text", value: value.slice(cursor, start) });
    segments.push({ type: "wikilink", raw: match[1].trim(), link });
    cursor = start + match[0].length;
  }

  if (cursor < value.length) segments.push({ type: "text", value: value.slice(cursor) });
  return segments;
}

/**
 * 文档里出现过的全部目标（按首次出现顺序去重）。
 *
 * 交给 Rust 一次性解析的就是这份清单——key 必须与 `parseWikilink` 给出的目标逐字节相同，
 * 否则渲染层按 `data-wikilink` 查表会全部落空。跳过围栏代码块与行内代码里的 `[[`，
 * 免得把示例代码里的假目标也送去解析。
 */
export function extractWikilinkTargets(markdown: string): string[] {
  const re = new RegExp(WIKILINK_RE.source, "g");
  const seen = new Set<string>();
  const targets: string[] = [];

  for (const match of maskCode(markdown).matchAll(re)) {
    const { target } = parseWikilink(match[1]);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }

  return targets;
}

/// 把代码（围栏块整行、行内代码整段）替换成等长空白：保持偏移不错位，
/// 同时让 `[[` 不再被匹配到。未闭合的围栏/反引号按「到文末/到行末」处理。
function maskCode(markdown: string): string {
  const lines = markdown.split("\n");
  let fence: string | null = null;

  const masked = lines.map((line) => {
    const opening = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (opening) {
      const marker = opening[1][0];
      if (fence === null) {
        fence = marker;
      } else if (marker === fence) {
        fence = null;
      }
      return "";
    }
    if (fence !== null) return "";
    return maskInlineCode(line);
  });

  return masked.join("\n");
}

function maskInlineCode(line: string): string {
  let out = "";
  let index = 0;

  while (index < line.length) {
    if (line[index] !== "`") {
      out += line[index];
      index += 1;
      continue;
    }

    let run = 0;
    while (line[index + run] === "`") run += 1;
    const close = line.indexOf("`".repeat(run), index + run);
    if (close === -1) {
      out += line.slice(index);
      break;
    }
    out += " ".repeat(close + run - index);
    index = close + run;
  }

  return out;
}
