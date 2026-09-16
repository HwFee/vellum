/**
 * 图投递（vellum_figure 工具）——让 HTML 源码不进对话记录。
 *
 * 病灶：图示原先由 Agent 直接写在回复正文里（```` ```vellum-widget ```` 围栏 + 几 KB
 * HTML），mdlog 逐字落盘，pi 的对话记录也逐字渲染——正文里挂一条几 KB 的源码长龙。
 *
 * 契约：Agent 用工具把 HTML 投递到扩展（通常给草稿文件路径，不走对话），扩展回一个
 * 短标记 `<!-- mdlog-fig:ID -->`；Agent 把标记单独成行放在图该出现的位置，写入器在
 * 落盘前把它展开回 ```` ```vellum-widget ```` 围栏。**日志文件与今天逐字节同形**
 * （Vellum 侧零改动），只是源码不再经过对话记录。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** 围栏字符（单独提出：正则字面量里出现它会让 Node 的类型剥离解析器丢同步） */
const BACKTICK = "`";

/** 与 Vellum `widget.rs` 的 MAX_WIDGET_HTML_BYTES 同值：超过它 Vellum 会退化成代码块 */
export const MAX_FIGURE_BYTES = 512 * 1024;

/** 围栏语言名（跨包契约 3：逐字不得改） */
export const FIGURE_FENCE_LANG = "vellum-widget";

/** 正文里的图标记：整枚标记（含注释外壳）被换成围栏 */
export const FIGURE_MARKER_RE = /<!--\s*mdlog-fig:([A-Za-z0-9_-]{1,32})\s*-->/g;

/** 标记形状（供工具回执与提示文本共用，改一处即可） */
export function figureMarker(id: string): string {
  return `<!-- mdlog-fig:${id} -->`;
}

export interface FigureRecord {
  /** 短 id（base36，正文标记用它） */
  id: string;
  /** 完整 HTML5 文档源码 */
  html: string;
  /** 可选短标题，只用于工具回显与对话记录里的折叠标签 */
  title?: string;
  createdAt: number;
}

/** 图 id：4 位 base36（随机源可注入，测试用） */
export function makeFigureId(rand: () => number = Math.random, taken?: Set<string>): string {
  for (let attempt = 0; attempt < 64; attempt++) {
    let id = "";
    for (let i = 0; i < 4; i++) id += Math.floor(rand() * 36).toString(36);
    if (!taken || !taken.has(id)) return id;
  }
  // 极端碰撞（注入的固定随机源）下退回时间戳基
  return Date.now().toString(36).slice(-6);
}

export interface FigureFenceOptions {
  /** 内部已有更长反引号串时外层围栏必须加长（CommonMark 围栏规则） */
  minLength?: number;
}

/** 内部最长连续反引号串 */
export function longestBacktickRun(html: string): number {
  // 不用正则：正则字面量里带反引号会让 Node 的类型剥离解析器丢同步（ERR_INVALID_TYPESCRIPT_SYNTAX）
  let longest = 0;
  let current = 0;
  for (const char of html) {
    if (char === BACKTICK) {
      current++;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

/** 把 HTML 包成 ```` ```vellum-widget ```` 围栏（内部反引号更长时自动加长外层） */
export function figureFence(html: string, options?: FigureFenceOptions): string {
  const run = longestBacktickRun(html);
  const fenceLength = Math.max(3, options?.minLength ?? 3, run + 1);
  const fence = BACKTICK.repeat(fenceLength);
  const body = html.replace(/\s+$/, "");
  return `${fence}${FIGURE_FENCE_LANG}\n${body}\n${fence}`;
}

export interface FigureLookup {
  (id: string): FigureRecord | undefined;
}

export interface ExpandResult {
  text: string;
  /** 本次真正展开过的 id（按出现顺序，已去重） */
  usedIds: string[];
  /** 命中不了记录的标记（静默移除，不把标记留给读者） */
  droppedIds: string[];
}

/**
 * 标记能否原地展开：独占一行，且行首缩进 ≤ 3 空格（再多一行就会被当成缩进代码块）。
 */
function standsAloneOnLine(text: string, offset: number, length: number): boolean {
  const before = text.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  const indent = before.slice(lineStart);
  if (indent.length > 3 || /[^ \t]/.test(indent)) return false;
  return /^[ \t]*(?:\n|$)/.test(text.slice(offset + length));
}

/**
 * 展开正文里的图标记：
 * - 同一 id 只展开首次，重复出现的位置丢弃（防同图复制两份）；
 * - 命中不了记录的标记整枚移除——它是给写入器看的隐形注释，不是给人看的；
 * - 标记独占一行时原地展开（标记所在行的空行已由正文提供，逐字节最干净）。
 */
export function expandFigureMarkers(text: string, lookup: FigureLookup): ExpandResult {
  const usedIds: string[] = [];
  const droppedIds: string[] = [];
  const seen = new Set<string>();

  const out = text.replace(FIGURE_MARKER_RE, (whole: string, id: string, offset: number) => {
    if (seen.has(id)) return "";
    seen.add(id);
    const record = lookup(id);
    if (!record) {
      droppedIds.push(id);
      return "";
    }
    usedIds.push(id);
    const fence = figureFence(record.html);
    // 围栏必须整行起（行首最多 3 空格）。标记若夹在句子中间，先补出行边界——
    // 否则 Markdown 把 ``` 当行内代码，HTML 源码会整段漏成正文文字。
    return standsAloneOnLine(text, offset, whole.length) ? fence : `\n\n${fence}\n\n`;
  });

  return { text: out, usedIds, droppedIds };
}

/**
 * 从本批快照里挑出仍然挂起的图（回合末兜底的可写集合）。
 *
 * 只看快照、不看实时队列：`prepareBatch` 里做图片复制会 await 上百毫秒，期间新到的图
 * 属于下一回合（它的标记还没写进正文）——提前补会既放错位置、又把它标成已消费，
 * 等真标记到达时反被静默丢弃。
 */
export function pendingFromSnapshot(
  snapshot: FigureRecord[],
  queued: FigureRecord[]
): FigureRecord[] {
  const queuedIds = new Set(queued.map((figure) => figure.id));
  return snapshot.filter((figure) => queuedIds.has(figure.id));
}

/** 正文里出现过的图标记 id（判定「已引用」，用于回合末兜底） */
export function referencedFigureIds(text: string): string[] {
  const ids: string[] = [];
  const re = new RegExp(FIGURE_MARKER_RE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (!ids.includes(match[1])) ids.push(match[1]);
  }
  return ids;
}

export type FigureValidation = { ok: true } | { ok: false; error: string };

/** HTML 校验：必须是自包含 HTML5 文档（Vellum 把它塞进 iframe，别的形态渲染不出来） */
export function validateFigureHtml(html: string): FigureValidation {
  const trimmed = html.trim();
  if (trimmed.length === 0) return { ok: false, error: "HTML 为空" };
  const bytes = Buffer.byteLength(trimmed, "utf8");
  if (bytes > MAX_FIGURE_BYTES) {
    return {
      ok: false,
      error: `HTML 体积 ${Math.round(bytes / 1024)} KB 超过上限 ${MAX_FIGURE_BYTES / 1024} KB（Vellum 会退化成代码块，先拆分或压缩）`,
    };
  }
  if (!/<!DOCTYPE\s+html/i.test(trimmed) && !/<html[\s>]/i.test(trimmed)) {
    return { ok: false, error: "需要一个完整 HTML5 文档（含 <!DOCTYPE html> 或 <html>）" };
  }
  return { ok: true };
}

const DANGEROUS_PATH_RE = /["\r\n\0]/;

/** 引号包裹（含反引号）——Agent 常从 shell 习惯带过来 */
const WRAPPING_QUOTES = "\"'`";

function stripWrappingQuotes(value: string): string {
  let out = value;
  if (out.length > 0 && WRAPPING_QUOTES.includes(out[0])) out = out.slice(1);
  if (out.length > 0 && WRAPPING_QUOTES.includes(out[out.length - 1])) out = out.slice(0, -1);
  return out.trim();
}

/** 草稿文件扩展名白名单 */
const DRAFT_EXTENSIONS = new Set([".html", ".htm"]);

export interface ResolveDraftResult {
  /** 解析出的绝对路径（文件不存在时也返回，供调用方报错引用） */
  resolved: string;
  exists: boolean;
  error?: string;
}

/**
 * 草稿路径解析。
 *
 * 三条现实约束：
 * 1. `/tmp/x.html` 是 Git Bash 的叫法，Windows 的 Node 会把它解析到盘根 —— 失配时回退到 os.tmpdir()；
 * 2. 路径可能带引号（Agent 从 shell 习惯带过来），剥掉；
 * 3. 引号/换行一律拒（与 command.ts 的注入面同一道闸）。
 */
export function resolveDraftPath(raw: string, cwd: string, exists: (p: string) => boolean = fs.existsSync): ResolveDraftResult {
  const cleaned = stripWrappingQuotes(raw.trim());
  if (cleaned.length === 0) return { resolved: "", exists: false, error: "草稿路径为空" };
  if (DANGEROUS_PATH_RE.test(cleaned)) {
    return { resolved: cleaned, exists: false, error: "草稿路径包含非法字符（引号或换行）" };
  }

  const ext = path.extname(cleaned).toLowerCase();
  if (!DRAFT_EXTENSIONS.has(ext)) {
    return { resolved: cleaned, exists: false, error: "草稿文件扩展名必须是 .html 或 .htm" };
  }

  const direct = path.isAbsolute(cleaned) ? cleaned : path.resolve(cwd, cleaned);
  if (exists(direct)) return { resolved: direct, exists: true };

  const posixTemp = /^\/(?:tmp|var\/tmp)\/(.+)$/.exec(cleaned);
  if (posixTemp) {
    const mapped = path.join(os.tmpdir(), posixTemp[1]);
    if (exists(mapped)) return { resolved: mapped, exists: true };
  }

  return { resolved: direct, exists: false };
}

/** 单行描述（工具回执、对话记录折叠标签、状态输出共用） */
export function describeFigure(record: FigureRecord): string {
  const kb = Math.max(1, Math.round(Buffer.byteLength(record.html, "utf8") / 1024));
  return record.title ? `${record.title} · ${kb} KB` : `${kb} KB`;
}

/**
 * 对话记录（pi 交互式 transcript）里的标记改写。
 *
 * 只作用于 TUI 渲染，不碰落盘的任何路径 —— 标记在日志里由写入器展开成真围栏，
 * 在 transcript 里换成一行可读的折叠标签，屏幕上不留注释壳。
 */
export function replaceFigureMarkersForTranscript(
  markdown: string,
  lookup: FigureLookup
): string {
  return markdown.replace(FIGURE_MARKER_RE, (_whole, id: string) => {
    const record = lookup(id);
    const label = record ? describeFigure(record) : "（已投递）";
    return `▤ **图** · ${label}`;
  });
}
