/**
 * 命令解析、状态输出与唤起 Vellum（spec §3.2）。
 *
 * 安全纪律：路径是用户输入，一律走参数数组 spawn，绝不拼命令行字符串；
 * 含引号 / CR / LF 的路径直接拒（既有注入面，也是非法 Windows 文件名）。
 * 子进程 detached + unref：唤起外部程序不得影响宿主生命周期。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MdlogConfig, MdlogConnectionState } from "./types.ts";

export interface ParsedCommand {
  action: "connect" | "off" | "status";
  targetPath?: string;
  flags: {
    full: boolean;
    append: boolean;
    noOpen: boolean;
  };
  error?: string;
}

const DANGEROUS_PATH_RE = /["\r\n\0]/;

export function parseMdlogCommand(args: string): ParsedCommand {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return { action: "status", flags: { full: false, append: false, noOpen: false } };
  }

  const tokens = trimmed.split(/\s+/);
  const flags = { full: false, append: false, noOpen: false };
  const nonFlagTokens: string[] = [];

  for (const token of tokens) {
    if (token === "--full") flags.full = true;
    else if (token === "--append") flags.append = true;
    else if (token === "--no-open") flags.noOpen = true;
    else nonFlagTokens.push(token);
  }

  if (nonFlagTokens.length === 0) {
    return { action: "status", flags };
  }

  if (nonFlagTokens.length === 1) {
    const single = nonFlagTokens[0].toLowerCase();
    if (single === "off") return { action: "off", flags };
    if (single === "status") return { action: "status", flags };
  }

  let pathStr = trimmed
    .replace(/(^|\s)--full(?=\s|$)/g, " ")
    .replace(/(^|\s)--append(?=\s|$)/g, " ")
    .replace(/(^|\s)--no-open(?=\s|$)/g, " ")
    .trim();

  if (
    (pathStr.startsWith('"') && pathStr.endsWith('"')) ||
    (pathStr.startsWith("'") && pathStr.endsWith("'"))
  ) {
    pathStr = pathStr.slice(1, -1).trim();
  }

  if (DANGEROUS_PATH_RE.test(pathStr)) {
    return {
      action: "connect",
      targetPath: pathStr,
      flags,
      error: "目标路径包含非法字符（引号或换行），已拒绝",
    };
  }

  const ext = path.extname(pathStr).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    return {
      action: "connect",
      targetPath: pathStr,
      flags,
      error: "目标文件扩展名必须为 .md 或 .markdown",
    };
  }

  return { action: "connect", targetPath: pathStr, flags };
}

export function formatStatusOutput(state: MdlogConnectionState | null): string {
  if (!state || !state.active) {
    return "当前未连接任何文件。使用 /mdlog <文件路径> 开始记录。";
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(state.lastWriteAt);
  const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  return [
    `连接文件: ${state.targetPath}`,
    `已写消息: ${state.writtenCount} 条`,
    `最近写入: ${timeStr}`,
    `会话标识: ${state.sessionId}`,
  ].join("\n");
}

export interface VellumInvocation {
  command: string;
  args: string[];
  mode: "vellum" | "system";
}

export interface ResolveInvocationOptions {
  env?: NodeJS.ProcessEnv;
  existsSync?: (p: string) => boolean;
}

/**
 * 唤起候选优先级（spec §3.2）：
 *   config.vellumPath → MDLOG_VELLUM_PATH → %LOCALAPPDATA% 安装位 → 系统关联 cmd /c start 兜底。
 * 纯函数（文件存在性可注入），便于测试而不真的启动任何程序。
 */
export function resolveVellumInvocation(
  filePath: string,
  config?: MdlogConfig,
  options?: ResolveInvocationOptions
): VellumInvocation | { error: string } {
  const absPath = path.resolve(filePath);
  if (DANGEROUS_PATH_RE.test(filePath)) {
    return { error: "路径包含非法字符（引号或换行），已拒绝唤起" };
  }

  const env = options?.env ?? process.env;
  const exists = options?.existsSync ?? ((p: string) => fs.existsSync(p));

  const candidates: string[] = [];
  if (config?.vellumPath) candidates.push(config.vellumPath);
  if (env.MDLOG_VELLUM_PATH) candidates.push(env.MDLOG_VELLUM_PATH);
  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, "Programs", "Vellum", "Vellum.exe"));
    candidates.push(path.join(env.LOCALAPPDATA, "Vellum", "Vellum.exe"));
  }

  for (const candidate of candidates) {
    try {
      if (candidate && exists(candidate)) {
        return { command: candidate, args: [absPath], mode: "vellum" };
      }
    } catch {
      // 候选探测失败继续下一个
    }
  }

  return { command: "cmd", args: ["/c", "start", "", absPath], mode: "system" };
}

export function openInVellum(
  filePath: string,
  config?: MdlogConfig,
  options?: ResolveInvocationOptions
): Promise<{ success: boolean; error?: string; mode?: "vellum" | "system" }> {
  return new Promise((resolve) => {
    const invocation = resolveVellumInvocation(filePath, config, options);
    if ("error" in invocation) {
      resolve({ success: false, error: invocation.error });
      return;
    }

    try {
      const child = spawn(invocation.command, invocation.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.on("error", (err) => {
        resolve({ success: false, error: err.message });
      });
      child.unref();
      resolve({ success: true, mode: invocation.mode });
    } catch (err) {
      resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
