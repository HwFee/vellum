/**
 * YAML frontmatter 解析（Obsidian 笔记库格式）。
 *
 * 为什么自己写一个小解析器而不引依赖：wisdom 笔记库 168 篇笔记的 frontmatter
 * 实测只有三种值形态——`key: 标量`、`key: [a, b]`（行内序列）、`key:` 后跟
 * `  - 项`（块序列），键名共 9 个。引一个完整 YAML 解析器（含锚点/多行标量/
 * 类型推断/日期对象）只会带来体积与行为分歧，而这里的调用点只需要「保序的
 * 键值对 + 正文切片」。
 *
 * 两条硬约束：
 * 1. **绝不抛异常**。解析失败一律退化成 `range: null` + 原样正文（即老行为），
 *    一篇畸形笔记不能把整篇渲染打挂；`malformed` 只作标记，供调用方记日志。
 * 2. **切片边界精确到字符**。编辑视图的块单元（`editUnits`）按源码偏移工作，
 *    若正文切片不带偏移信息，frontmatter 这段的「锁定只读单元」就对不上号。
 */
export type FrontmatterValue = string | string[];

export interface FrontmatterField {
  key: string;
  value: FrontmatterValue;
}

/** 被剥掉的 frontmatter 块在源码中的字符区间（含开合围栏行与其行尾）。 */
export interface FrontmatterRange {
  start: number;
  end: number;
}

export interface Frontmatter {
  /** 保序键值对；无 frontmatter 或块内无有效行时为空数组。 */
  fields: FrontmatterField[];
  /** 正文：剥掉 frontmatter 块后的源码切片（行尾保持原样）。 */
  body: string;
  /** 剥掉的区间；未识别到 frontmatter 时为 null。 */
  range: FrontmatterRange | null;
  /** 首行像围栏但块未闭合时为 true（此时正文与区间都不动，走老行为）。 */
  malformed: boolean;
}

const FENCE = /^---[ \t]*$/;

/**
 * 解析文档开头的 frontmatter。
 *
 * 标量一律按字符串返回（不猜 `true` / 日期 / 数字的类型）：这里只用于展示，
 * 类型推断只会在渲染层制造与源码不一致的假象。
 */
export function parseFrontmatter(source: string): Frontmatter {
  const unchanged: Frontmatter = { fields: [], body: source, range: null, malformed: false };
  const first = readLine(source, source.charCodeAt(0) === 0xfeff ? 1 : 0);
  if (!first || !FENCE.test(first.text)) return unchanged;

  const lines: string[] = [];
  let cursor = first.end;
  let close: number | null = null;
  while (cursor < source.length) {
    const line = readLine(source, cursor);
    if (!line) break;
    if (FENCE.test(line.text)) {
      close = line.end;
      break;
    }
    lines.push(line.text);
    cursor = line.end;
  }
  if (close === null) return { ...unchanged, malformed: true };

  return {
    fields: parseFields(lines),
    body: source.slice(close),
    // start 恒为 0：BOM（若在）与整块一起剥掉，否则 BOM 会以原文形式漏进正文
    range: { start: 0, end: close },
    malformed: false,
  };
}

function parseFields(lines: string[]): FrontmatterField[] {
  const fields: FrontmatterField[] = [];
  const positions = new Map<string, number>();

  const upsert = (key: string, value: FrontmatterValue) => {
    const existing = positions.get(key);
    if (existing === undefined) {
      positions.set(key, fields.length);
      fields.push({ key, value });
    } else {
      fields[existing] = { key, value };
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const pair = /^([^\s:#-][^:]*)[ \t]*:(.*)$/.exec(line);
    if (pair) {
      const key = pair[1].trim();
      const raw = pair[2].trim();
      if (raw === "") {
        // 空值 → 块序列（可能一行都没有，退化成空数组）
        const items: string[] = [];
        while (i + 1 < lines.length) {
          const item = blockItem(lines[i + 1]);
          if (item === null) break;
          items.push(item);
          i++;
        }
        upsert(key, items);
      } else if (raw.startsWith("[")) {
        upsert(key, parseFlowSequence(raw));
      } else {
        upsert(key, unquote(raw));
      }
      continue;
    }

    // 认不出的行：只在天时地利（上一项确实是序列）时补进序列，其余静默忽略。
    // 空行分隔的块序列、缩进深浅不一都要能收住，不能因为一行形态奇怪就丢内容。
    const item = blockItem(line);
    const last = fields[fields.length - 1];
    if (item !== null && last && Array.isArray(last.value)) last.value.push(item);
  }

  return fields;
}

/** 块序列项（`- 项`，允许任意缩进）；不是序列项时返回 null。 */
function blockItem(line: string): string | null {
  const match = /^[ \t]+-[ \t]*(.*)$/.exec(line);
  if (!match) return null;
  const value = match[1].trim();
  return value === "" ? null : unquote(value);
}

/**
 * 行内序列 `[a, b, "c, d"]`。
 *
 * 引号内不切分：真实库里 `sources` / `related` 的项是 URL 与 `[[wikilink]]`，
 * 后者含逗号也不该被拆开。
 */
function parseFlowSequence(raw: string): string[] {
  const end = raw.lastIndexOf("]");
  const inner = raw.slice(1, end > 0 ? end : undefined);
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (quote) {
      if (char === "\\" && i + 1 < inner.length) {
        current += inner[++i];
        continue;
      }
      if (char === quote) quote = null;
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current);

  return items.map((item) => unquote(item.trim())).filter((item) => item !== "");
}

/** 去掉成对外层引号；不做转义还原（真实库里没有转义写法）。 */
function unquote(raw: string): string {
  const text = raw.trim();
  if (text.length >= 2) {
    const first = text[0];
    if ((first === '"' || first === "'") && text.endsWith(first)) return text.slice(1, -1);
  }
  return text;
}

/** 读一行，返回行文本（不含行尾）与下一行起点；支持 LF / CRLF / 单独 CR。 */
function readLine(source: string, from: number): { text: string; end: number } | null {
  if (from >= source.length) return null;
  let index = from;
  while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index++;
  const text = source.slice(from, index);
  if (index >= source.length) return { text, end: source.length };
  if (source[index] === "\r" && source[index + 1] === "\n") return { text, end: index + 2 };
  return { text, end: index + 1 };
}
