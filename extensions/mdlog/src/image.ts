/**
 * 图片提取、净化与配额清理管线（spec §4.5 / Y7）。
 *
 * 安全与健壮性约定：
 * - 候选路径一律以 session cwd 为唯一基准，realpath 后做包含性判定（Y7-e）；
 * - 同一物理文件（realpath 相同）只复制一次，不同候选串共用同一份资产（Item 10）；
 * - 正文重写单趟化：先打占位 token 再统一替换，杜绝 mdlog-assets/mdlog-assets 双前缀；
 * - 复制异步 + 超时（定时器 clear + unref，不得钉住事件循环，Item 15 / 应当修复-4）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createImageCopyState } from "./types.ts";
import type { ImageCopyState, MdlogConfig } from "./types.ts";

export const DEFAULT_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"] as const;

export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_ASSET_RETENTION_MB = 200;
export const DEFAULT_IMAGE_TIMEOUT_MS = 5000;

/**
 * 由配置扩展名构建候选路径正则；svg 始终剔除（Y7-a / Item 15）。
 * 两条分支：带引号（容许路径含空格）优先，否则裸路径。
 */
export function buildImagePathRegex(extensions: string[]): RegExp {
  const safe = Array.from(
    new Set(
      extensions
        .map((e) => String(e).toLowerCase().replace(/^\./, ""))
        .filter((e) => e.length > 0 && e !== "svg" && /^[a-z0-9]+$/.test(e))
    )
  );
  const exts = safe.length > 0 ? safe : [...DEFAULT_IMAGE_EXTENSIONS];
  const extGroup = `(?:${exts.join("|")})`;
  return new RegExp(
    `(?:["']([^"'\\r\\n]+?\\.${extGroup})["'])|(?:(?:^|\\s)([A-Za-z0-9_.\\-\\\\/]+?\\.${extGroup})(?=["']|$|\\s))`,
    "gi"
  );
}

export const IMAGE_PATH_RE = buildImagePathRegex([...DEFAULT_IMAGE_EXTENSIONS]);

function clampNumber(value: unknown, fallback: number, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(min, value);
}

export function loadMdlogConfig(configFilePath?: string): MdlogConfig {
  const defaults: MdlogConfig = {
    toolNames: [],
    imageExtensions: [...DEFAULT_IMAGE_EXTENSIONS],
    maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
    assetRetentionMb: DEFAULT_ASSET_RETENTION_MB,
    imageCopyTimeoutMs: DEFAULT_IMAGE_TIMEOUT_MS,
  };

  const targetPath =
    configFilePath ??
    path.join(
      process.env.USERPROFILE || process.env.HOME || "",
      ".pi",
      "agent",
      "extensions",
      "mdlog",
      "config.json"
    );

  let parsed: Record<string, unknown> | null = null;
  try {
    if (fs.existsSync(targetPath)) {
      parsed = JSON.parse(fs.readFileSync(targetPath, "utf8")) as Record<string, unknown>;
    }
  } catch {
    parsed = null;
  }
  if (!parsed) return defaults;

  const normalizedExts = Array.isArray(parsed.imageExtensions)
    ? Array.from(
        new Set(
          (parsed.imageExtensions as unknown[])
            .map((e) => String(e).toLowerCase().replace(/^\./, ""))
            .filter((e) => e.length > 0 && e !== "svg" && /^[a-z0-9]+$/.test(e))
        )
      )
    : null;

  return {
    toolNames: Array.isArray(parsed.toolNames) ? (parsed.toolNames as string[]) : defaults.toolNames,
    imageExtensions:
      normalizedExts && normalizedExts.length > 0 ? normalizedExts : defaults.imageExtensions,
    maxImageBytes: clampNumber(parsed.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES, 1024),
    assetRetentionMb: clampNumber(parsed.assetRetentionMb, DEFAULT_ASSET_RETENTION_MB, 1),
    imageCopyTimeoutMs: clampNumber(parsed.imageCopyTimeoutMs, DEFAULT_IMAGE_TIMEOUT_MS, 100),
    vellumPath: typeof parsed.vellumPath === "string" ? parsed.vellumPath : undefined,
  };
}

export function extractImageCandidates(
  toolOutput: string,
  configuredToolNames?: string[],
  currentToolName?: string,
  imageExtensions?: string[]
): string[] {
  if (configuredToolNames && configuredToolNames.length > 0) {
    if (!currentToolName || !configuredToolNames.includes(currentToolName)) {
      return [];
    }
  }

  const re = buildImagePathRegex(imageExtensions ?? [...DEFAULT_IMAGE_EXTENSIONS]);
  const results: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(toolOutput)) !== null) {
    const rawPath = (match[1] ?? match[2] ?? "").trim();
    if (rawPath.length === 0) continue;
    if (!seen.has(rawPath)) {
      seen.add(rawPath);
      results.push(rawPath);
    }
  }
  return results;
}

export function sanitizeImageFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  let base = path.basename(filename, ext);
  base = base.replace(/[^A-Za-z0-9._-]/g, "-");
  if (base.replace(/[-_.]/g, "").length === 0) {
    base = "image";
  }
  return `${base}${ext}`;
}

export interface ProcessImageOptions {
  cwd: string;
  logDir: string;
  turnStartTime: number;
  maxImageBytes?: number;
  timeoutMs?: number;
  imageExtensions?: string[];
  /** 同批次共享（多助手消息不得重复复制同一张图，Item 8） */
  sharedState?: ImageCopyState;
}

export interface TurnImageProcessingResult {
  rewrittenAssistantText: string;
  unreferencedCleanNames: string[];
  copiedFiles: string[];
}

async function copyWithTimeout(src: string, dest: string, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      fs.promises.copyFile(src, dest),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("image copy timeout")), timeoutMs);
        timer.unref();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * 单趟化重写：最长候选优先打 token，再统一还原，避免互为子串的候选互相污染。
 */
function rewriteSinglePass(input: string, pending: Array<{ candidate: string; replacement: string }>): string {
  const ordered = [...pending].sort((a, b) => b.candidate.length - a.candidate.length);
  let out = input;
  const tokens: Array<[string, string]> = [];

  ordered.forEach((item, idx) => {
    if (!out.includes(item.candidate)) return;
    const token = `\u0000MDLOG_TOKEN_${idx}\u0000`;
    out = out.split(item.candidate).join(token);
    tokens.push([token, item.replacement]);
  });

  for (const [token, replacement] of tokens) {
    out = out.split(token).join(replacement);
  }
  return out;
}

export async function processTurnImages(
  candidates: string[],
  assistantText: string,
  options: ProcessImageOptions
): Promise<TurnImageProcessingResult> {
  const maxBytes = clampNumber(options.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES, 1024);
  const timeoutMs = clampNumber(options.timeoutMs, DEFAULT_IMAGE_TIMEOUT_MS, 100);
  const assetsDir = path.join(options.logDir, "mdlog-assets");
  const sharedState = options.sharedState ?? createImageCopyState();
  const unreferencedCleanNames: string[] = [];
  const copiedFiles: string[] = [];
  const pending: Array<{ candidate: string; replacement: string }> = [];
  const skipped = new Set<string>();

  let realCwd: string;
  try {
    realCwd = fs.realpathSync(path.resolve(options.cwd));
  } catch {
    realCwd = path.resolve(options.cwd);
  }

  const oversizePlaceholder = (candidate: string) =>
    `*(图片超过体积上限，未同步：${candidate})*`;
  const failurePlaceholder = (candidate: string) => `*(图片同步失败：${candidate})*`;

  for (const candidate of candidates) {
    if (skipped.has(candidate)) continue;
    skipped.add(candidate);

    const resolvedPath = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(realCwd, candidate);

    let realCandidate: string;
    try {
      realCandidate = fs.realpathSync(resolvedPath);
    } catch {
      continue;
    }

    const relFromCwd = path.relative(realCwd, realCandidate);
    if (relFromCwd === ".." || relFromCwd.startsWith(`..${path.sep}`) || path.isAbsolute(relFromCwd)) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(realCandidate);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;

    // mtime 过滤：仅同步本回合（含 5s 宽限）产生的文件（Y7-c）
    if (stat.mtimeMs < options.turnStartTime - 5000) continue;

    if (stat.size > maxBytes) {
      pending.push({ candidate, replacement: oversizePlaceholder(candidate) });
      continue;
    }

    // realpath 去重：同一物理文件只复制一次（Item 10）
    const existing = sharedState.realPathMap.get(realCandidate);
    if (existing) {
      pending.push({ candidate, replacement: `mdlog-assets/${existing}` });
      continue;
    }

    if (!fs.existsSync(assetsDir)) {
      try {
        fs.mkdirSync(assetsDir, { recursive: true });
      } catch {
        continue;
      }
    }

    const cleanName = sanitizeImageFilename(path.basename(realCandidate));
    const ext = path.extname(cleanName);
    const base = path.basename(cleanName, ext);

    let finalCleanName = cleanName;
    let counter = 2;
    while (sharedState.allocatedNames.has(finalCleanName) || fs.existsSync(path.join(assetsDir, finalCleanName))) {
      finalCleanName = `${base}-${counter}${ext}`;
      counter++;
    }

    const targetPath = path.join(assetsDir, finalCleanName);
    const ok = await copyWithTimeout(realCandidate, targetPath, timeoutMs);
    if (!ok) {
      pending.push({ candidate, replacement: failurePlaceholder(candidate) });
      continue;
    }

    sharedState.allocatedNames.add(finalCleanName);
    sharedState.realPathMap.set(realCandidate, finalCleanName);
    copiedFiles.push(targetPath);
    pending.push({ candidate, replacement: `mdlog-assets/${finalCleanName}` });
  }

  const rewrittenAssistantText = rewriteSinglePass(assistantText, pending);

  for (const item of pending) {
    if (!item.replacement.startsWith("mdlog-assets/")) continue;
    const base = item.replacement.slice("mdlog-assets/".length);
    // 去重后同一资产可能由多个候选串指向：只要正文里出现过该资产即算已引用
    if (rewrittenAssistantText.includes(`mdlog-assets/${base}`)) continue;
    if (!unreferencedCleanNames.includes(base)) unreferencedCleanNames.push(base);
  }

  return { rewrittenAssistantText, unreferencedCleanNames, copiedFiles };
}

/** 配额清理：最旧优先删除，上限有下限保护（配置被写成 0/负数时不得清空资产） */
export function cleanAssetRetention(assetsDir: string, maxBytes = DEFAULT_ASSET_RETENTION_MB * 1024 * 1024): string[] {
  if (!fs.existsSync(assetsDir)) return [];

  const safeMaxBytes = Math.max(1024 * 1024, maxBytes);
  const entries: Array<{ filePath: string; size: number; mtimeMs: number }> = [];
  try {
    for (const file of fs.readdirSync(assetsDir)) {
      const fullPath = path.join(assetsDir, file);
      try {
        const s = fs.statSync(fullPath);
        if (s.isFile()) entries.push({ filePath: fullPath, size: s.size, mtimeMs: s.mtimeMs });
      } catch {
        // 竞争跳过
      }
    }
  } catch {
    return [];
  }

  let totalSize = entries.reduce((acc, curr) => acc + curr.size, 0);
  if (totalSize <= safeMaxBytes) return [];

  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const deleted: string[] = [];
  for (const item of entries) {
    if (totalSize <= safeMaxBytes) break;
    try {
      fs.unlinkSync(item.filePath);
      totalSize -= item.size;
      deleted.push(item.filePath);
    } catch {
      // 容错继续
    }
  }
  return deleted;
}
