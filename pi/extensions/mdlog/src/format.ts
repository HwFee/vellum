/**
 * 纯函数格式化器：逐字节决定写入 Markdown 的形态。
 *
 * 版式为 v3.1「书札卷轴」：文件头只有隐形指纹（不写可见标题）、
 * 助手说话人标签带 mdlog-who 类名（宿主 CSS 按类名挂章点），
 * 用户消息仍走 blockquote 首段。
 */

import type { MessageContent } from "./types.ts";

/** 首行会话指纹（受信门禁的唯一判据） */
export const FINGERPRINT_RE = /^\uFEFF?\s*<!--\s*mdlog:v1\s+s=([^\s>]+)/;

/** 条目锚点：必须整行独占，行内提及的伪锚点不认（Item 16） */
export const ANCHOR_RE = /^\s*<!--\s*mdlog:m=([A-Za-z0-9_-]+)\s*-->\s*$/m;

export const TRUNCATION_NOTE = "*(本条消息被截断，已自动补齐代码围栏)*";

export const TURN_DELIMITER = "---\n\n";

export function extractMessageText(content: MessageContent | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textChunks: string[] = [];
    for (const chunk of content) {
      if (
        chunk &&
        chunk.type === "text" &&
        typeof (chunk as { text?: string }).text === "string" &&
        ((chunk as { text?: string }).text as string).length > 0
      ) {
        textChunks.push((chunk as { text: string }).text);
      }
    }
    return textChunks.join("\n\n");
  }
  return "";
}

/** 空文本消息（含纯空白）一律跳过，不产生空发言头或孤立空行（Item 13） */
export function isEmptyText(text: string): boolean {
  return text.trim().length === 0;
}

export function formatTimestamp(timestamp: number, previousTimestamp?: number): string {
  const curr = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hh = pad(curr.getHours());
  const mm = pad(curr.getMinutes());

  if (previousTimestamp !== undefined) {
    const prev = new Date(previousTimestamp);
    const isSameDay =
      curr.getFullYear() === prev.getFullYear() &&
      curr.getMonth() === prev.getMonth() &&
      curr.getDate() === prev.getDate();
    if (!isSameDay) {
      const month = pad(curr.getMonth() + 1);
      const date = pad(curr.getDate());
      return `${month}-${date} ${hh}:${mm}`;
    }
  }
  return `${hh}:${mm}`;
}

export interface FenceScanResult {
  isUnclosed: boolean;
  fenceChar?: string;
  fenceLength?: number;
}

/**
 * CommonMark 围栏平衡扫描（spec §3.4 规则 5）：
 * 开栏行首允许 0~3 空格 + ≥3 个同种字符（` 或 ~）；闭栏须同字符且长度 ≥ 开栏。
 * 返回值携带开栏字符与长度，供补齐行按原字符/长度闭合（Item 11）。
 */
export function scanCodeFences(text: string): FenceScanResult {
  const lines = text.split("\n");
  let inFence = false;
  let activeChar = "";
  let activeLength = 0;

  const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

  for (const line of lines) {
    if (!inFence) {
      const match = OPEN_FENCE_RE.exec(line);
      if (match) {
        inFence = true;
        activeChar = match[1][0];
        activeLength = match[1].length;
      }
    } else {
      const CLOSE_FENCE_RE = new RegExp(
        `^ {0,3}${activeChar === "`" ? "`" : "~"}{${activeLength},}\\s*$`
      );
      if (CLOSE_FENCE_RE.test(line)) {
        inFence = false;
        activeChar = "";
        activeLength = 0;
      }
    }
  }

  return inFence
    ? { isUnclosed: true, fenceChar: activeChar, fenceLength: activeLength }
    : { isUnclosed: false };
}

/** 文件头：只有隐形指纹 + 一个空行（v3.1 起不写可见标题） */
export function formatHeader(sessionId: string): string {
  return `<!-- mdlog:v1 s=${sessionId} -->\n\n`;
}

/** 用户说话人标签（blockquote 首段，宿主以 blockquote > p:first-child 挂朱红章点） */
export function userLabel(time: string): string {
  return `> **你** · ${time}\n>\n`;
}

/** 用户正文：每一行（含空行）前置引用符 */
export function userBody(text: string): string {
  const clean = text.replace(/\s+$/, "");
  const lines = clean.split("\n");
  return lines.map((line) => (line.length > 0 ? `> ${line}` : ">")).join("\n");
}

/** 助手说话人标签（v3.1：带 mdlog-who 类名供宿主书札版式渲染） */
export function assistantLabel(time: string): string {
  return `<p class="mdlog-who"><strong>Pi</strong> · ${time}</p>\n\n`;
}

/** 锚点注释块；无 entryId（整批锚点丢失）时不留伪锚点 */
export function anchorBlock(entryId?: string): string {
  return entryId ? `<!-- mdlog:m=${entryId} -->\n\n` : "";
}

export function formatUserMessage(text: string, time: string, entryId?: string): string {
  return `${userLabel(time)}${userBody(text)}\n\n${anchorBlock(entryId)}`;
}

export interface AssistantFormatOptions {
  unclosedFence?: boolean;
  fenceChar?: string;
  fenceLength?: number;
  /** 未在正文里引用的回合图片（净化后的文件名） */
  extraImages?: string[];
  /** 已渲染好的图围栏文本（投递了但正文漏放标记的图，回合末兜底补上） */
  extraFigures?: string[];
}

export function formatAssistantMessage(
  text: string,
  time: string,
  entryId?: string,
  isEnd = false,
  options?: AssistantFormatOptions
): string {
  let body = text.replace(/\s+$/, "");

  if (options?.unclosedFence) {
    const char = options.fenceChar && options.fenceChar.length > 0 ? options.fenceChar : "`";
    const len = Math.max(3, options.fenceLength ?? 3);
    body += `\n${char.repeat(len)}\n${TRUNCATION_NOTE}`;
  }

  if (options?.extraImages && options.extraImages.length > 0) {
    for (const img of options.extraImages) {
      body += `\n\n![生成的图片](mdlog-assets/${img})`;
    }
  }

  if (options?.extraFigures && options.extraFigures.length > 0) {
    for (const figure of options.extraFigures) {
      body += `\n\n${figure}`;
    }
  }

  const anchor = `\n\n${anchorBlock(entryId)}`;
  const endDelimiter = isEnd ? TURN_DELIMITER : "";

  return `${assistantLabel(time)}${body}${anchor}${endDelimiter}`;
}

export function formatTurnDelimiter(): string {
  return TURN_DELIMITER;
}

/**
 * 回合块：同角色连续消息合并后的写入单位（v3.1 碎片合并）。
 * 合并只发生在「同角色且紧邻」，块内正文以空行分隔，标签与回合分隔线各只出现一次。
 */
export interface TurnBlock {
  role: "user" | "assistant";
  time: string;
  texts: string[];
  images: string[];
  /** 未在正文里引用的图围栏（回合末兜底追加，见 figures.ts） */
  figures?: string[];
  entryId?: string;
}

export function renderTurnBlock(block: TurnBlock, isTurnEnd: boolean): string {
  if (block.role === "user") {
    const body = block.texts.map(userBody).join("\n>\n");
    return `${userLabel(block.time)}${body}\n\n${anchorBlock(block.entryId)}`;
  }

  const joined = block.texts.map((t) => t.replace(/\s+$/, "")).join("\n\n");
  const fence = scanCodeFences(joined);
  return formatAssistantMessage(joined, block.time, block.entryId, isTurnEnd, {
    unclosedFence: fence.isUnclosed,
    fenceChar: fence.fenceChar,
    fenceLength: fence.fenceLength,
    extraImages: block.images,
    extraFigures: block.figures,
  });
}
