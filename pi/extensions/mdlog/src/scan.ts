/**
 * 智能追加与逆向扫描引擎（spec §3.5）。
 *
 * 三条纪律：
 * 1. 尾向扫描必须回退到「属于当前分支」的锚点，不是首个正则命中（Y6-a）；
 * 2. 围栏内的锚点行一律不算（Y6-d）；行内伪锚点也不算（Item 16，由 ANCHOR_RE 保证）；
 * 3. 4b 前置文件头必须原子（tmp + rename），旧内容尾部先归一到恰好一个空行（Item 3）。
 */

import * as fs from "node:fs";
import { FINGERPRINT_RE, ANCHOR_RE, formatHeader } from "./format.ts";

export interface AppendPlan {
  mode: "increment" | "full" | "append_only" | "ask_user";
  fromEntryId?: string;
}

export interface ResolveAppendOptions {
  hasUI: boolean;
  forceFull?: boolean;
  forceAppend?: boolean;
  /** sidecar 记录的本会话锚点已丢失：跳过锚点扫描直接退化 4a（Item 14） */
  anchorLost?: boolean;
}

/** 归一尾部换行：空内容不动，≥2 个 \n 不动，1 个补 1，其余补 2（幂等） */
export function normalizeTrailingNewlines(content: string): string {
  if (content.length === 0) return content;
  if (content.endsWith("\n\n")) return content;
  if (content.endsWith("\n")) return `${content}\n`;
  return `${content}\n\n`;
}

/** 计算代码围栏区间（CommonMark：开栏 ≥3 同种字符，闭栏同字符且长度 ≥ 开栏） */
function computeFenceRanges(lines: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let inFence = false;
  let activeChar = "";
  let activeLength = 0;
  let fenceStart = -1;

  const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const match = OPEN_FENCE_RE.exec(line);
      if (match) {
        inFence = true;
        activeChar = match[1][0];
        activeLength = match[1].length;
        fenceStart = i;
      }
    } else {
      const CLOSE_FENCE_RE = new RegExp(
        `^ {0,3}${activeChar === "`" ? "`" : "~"}{${activeLength},}\\s*$`
      );
      if (CLOSE_FENCE_RE.test(line)) {
        inFence = false;
        ranges.push([fenceStart, i]);
        fenceStart = -1;
      }
    }
  }

  if (inFence && fenceStart !== -1) {
    ranges.push([fenceStart, lines.length - 1]);
  }
  return ranges;
}

export function findLastBranchAnchor(
  markdownContent: string,
  branchEntryIds: Set<string>
): { matchedEntryId: string | null; anchorLineIndex: number } {
  const lines = markdownContent.split("\n");
  const fenceRanges = computeFenceRanges(lines);

  const isInsideFence = (lineIdx: number): boolean =>
    fenceRanges.some(([start, end]) => lineIdx >= start && lineIdx <= end);

  for (let i = lines.length - 1; i >= 0; i--) {
    if (isInsideFence(i)) continue;
    const match = ANCHOR_RE.exec(lines[i]);
    if (match && branchEntryIds.has(match[1])) {
      return { matchedEntryId: match[1], anchorLineIndex: i };
    }
  }

  return { matchedEntryId: null, anchorLineIndex: -1 };
}

export function extractSessionFingerprint(markdownContent: string): string | null {
  const match = FINGERPRINT_RE.exec(markdownContent);
  return match ? match[1].trim() : null;
}

export function resolveAppendPlan(
  markdownContent: string,
  currentSessionId: string,
  branchEntryIds: Set<string>,
  options: ResolveAppendOptions
): AppendPlan {
  if (options.forceFull) {
    return { mode: "full" };
  }
  if (options.forceAppend) {
    return { mode: "append_only" };
  }

  if (markdownContent.trim().length === 0) {
    return { mode: "full" };
  }

  // 1. 锚点扫描（anchorLost 已置位时跳过，直接进会话指纹判定）
  if (!options.anchorLost) {
    const anchorResult = findLastBranchAnchor(markdownContent, branchEntryIds);
    if (anchorResult.matchedEntryId) {
      return { mode: "increment", fromEntryId: anchorResult.matchedEntryId };
    }
  }

  // 2. 未命中分支锚点：按首行指纹分流（Y6-b / Item 14）
  const fileFingerprint = extractSessionFingerprint(markdownContent);

  if (fileFingerprint === currentSessionId) {
    // 分支 4a：属于当前会话但锚点断裂
    return options.hasUI ? { mode: "ask_user" } : { mode: "append_only" };
  }

  // 分支 4b：新文件、外部文件或其他会话文件，回填全量历史
  return { mode: "full" };
}

/**
 * 4b：把文件头原子插入到文件最顶部（第 1 行），旧内容完整保留在其下。
 * 旧内容尾部先归一到 `\n\n`，杜绝与后续块黏连（Item 3）。
 * 写临时文件后 rename；失败清理 tmp 并抛出。
 */
export function insertHeaderAtTopAtomic(filePath: string, sessionId: string): void {
  const existingContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  if (extractSessionFingerprint(existingContent) === sessionId) {
    return;
  }

  const header = formatHeader(sessionId);
  const combined =
    existingContent.length > 0 ? `${header}${normalizeTrailingNewlines(existingContent)}` : header;

  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    fs.writeFileSync(tempPath, combined, "utf8");
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // 清理失败不掩盖原始异常
    }
    throw err;
  }
}
