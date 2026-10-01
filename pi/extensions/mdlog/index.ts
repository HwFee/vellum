/**
 * pi 扩展 mdlog：MD 文件即真相。
 *
 * 扩展只做一件事——让目标 Markdown 文件与会话保持一致：
 * 同步入队（严禁在事件 handler 内 await 磁盘，Y12）、150ms 合并防抖、
 * 串行写链落盘；Vellum 侧靠文件监听 + sidecar 心跳感知实时性。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractMessageText, formatHeader, isEmptyText } from "./src/format.ts";
import { insertHeaderAtTopAtomic, resolveAppendPlan } from "./src/scan.ts";
import { extractImageCandidates, loadMdlogConfig } from "./src/image.ts";
import { LiveLogWriter } from "./src/writer.ts";
import {
  HeartbeatManager,
  getSidecarPath,
  readSidecar,
  removeSidecar,
  setAnchorLost,
  updateLastWrite,
  writeSidecar,
} from "./src/sidecar.ts";
import { formatStatusOutput, openInVellum, parseMdlogCommand } from "./src/command.ts";
import { replaceFigureMarkersForTranscript } from "./src/figures.ts";
import type { FigureRecord } from "./src/figures.ts";
import { createFigureTool, FIGURE_TOOL_NAME } from "./src/tool.ts";
import type { MdlogConnectionState, MessageContent, SessionEntryLike } from "./src/types.ts";

interface ConnectionFlags {
  full: boolean;
  append: boolean;
  noOpen: boolean;
}

function isMarkdownPath(targetPath: string): boolean {
  const ext = path.extname(targetPath).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

interface RawMessage {
  role?: string;
  content?: MessageContent;
  timestamp?: number;
}

/** 入队消息形状（与 writer 的 BufferedMessageItem.message 结构一致） */
type QueueMessage = { role: string; content: MessageContent; timestamp?: number };

/** 回填与实时写入共用：仅 user / assistant 且文本非空（Item 6 / Item 13） */
function isValidMessage(message: unknown): message is QueueMessage {
  if (!message || typeof message !== "object") return false;
  const raw = message as RawMessage;
  if (raw.role !== "user" && raw.role !== "assistant") return false;
  return !isEmptyText(extractMessageText(raw.content));
}

/** 图条目类型（会话持久化用，回填时从 branch 还原 id→HTML） */
const FIGURE_ENTRY_TYPE = "mdlog:figure";

/** 从会话分支还原历史图条目（`--full` 回填时标记仍能展开） */
function collectFiguresFromBranch(branch: SessionEntryLike[]): Map<string, FigureRecord> {
  const figures = new Map<string, FigureRecord>();
  for (const entry of branch) {
    if (entry.type !== "custom" || entry.customType !== FIGURE_ENTRY_TYPE) continue;
    const record = entry.data as FigureRecord | undefined;
    if (!record || typeof record.id !== "string" || typeof record.html !== "string") continue;
    figures.set(record.id, record);
  }
  return figures;
}

export default function (pi: ExtensionAPI): void {
  let currentState: MdlogConnectionState | null = null;
  let writer: LiveLogWriter | null = null;
  const heartbeatManager = new HeartbeatManager();
  const config = loadMdlogConfig();

  /** 本进程投递过的图（活的真相）；回填另从 branch 还原 */
  const figures = new Map<string, FigureRecord>();
  const figureLookup = (id: string) => figures.get(id);

  function registerFigure(record: FigureRecord): void {
    figures.set(record.id, record);
    writer?.enqueueFigure(record);
    try {
      pi.appendEntry(FIGURE_ENTRY_TYPE, record);
    } catch {
      // 条目写入失败不回滚本次投递：本回合写入仍可用内存登记表
    }
  }

  /**
   * 工具激活门禁：mdlog 是全局扩展，工具不该出现在无关项目的工具表里。
   * 只在记录连接期间激活（pi 对工具表的改动下一回合生效）。
   */
  function setFigureToolActive(active: boolean): void {
    try {
      const current = pi.getActiveTools();
      const has = current.includes(FIGURE_TOOL_NAME);
      if (active && !has) pi.setActiveTools([...current, FIGURE_TOOL_NAME]);
      else if (!active && has) pi.setActiveTools(current.filter((name) => name !== FIGURE_TOOL_NAME));
    } catch {
      // 工具表操作失败不影响记录
    }
  }

  async function connectToFile(
    targetFilePath: string,
    ctx: ExtensionContext,
    flags: ConnectionFlags
  ): Promise<void> {
    const resolvedPath = path.resolve(targetFilePath);

    // v3.1：手动与自动重连同一道扩展名闸（杜绝指纹头写进 .txt/.bat）
    if (!isMarkdownPath(resolvedPath)) {
      ctx.ui.notify("mdlog: 目标文件扩展名必须为 .md 或 .markdown", "error");
      return;
    }

    const sidecarPath = getSidecarPath(resolvedPath);
    const sessionId = ctx.sessionManager.getSessionId();
    const branch = ctx.sessionManager.getBranch() as unknown as SessionEntryLike[];
    const branchIds = new Set(branch.map((entry) => entry.id));

    // 父目录不存在时自动递归创建（Item 7）
    try {
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    } catch (err) {
      ctx.ui.notify(`mdlog: 无法创建目标目录 (${(err as Error).message})`, "error");
      return;
    }

    const existingContent = fs.existsSync(resolvedPath)
      ? fs.readFileSync(resolvedPath, "utf8")
      : "";

    // sidecar 里的 anchorLost 读回驱动 4a（Item 14）
    const isAnchorLost = readSidecar(sidecarPath)?.anchorLost === true;

    const plan = resolveAppendPlan(existingContent, sessionId, branchIds, {
      hasUI: ctx.hasUI,
      forceFull: flags.full,
      forceAppend: flags.append,
      anchorLost: isAnchorLost,
    });

    let effectiveMode = plan.mode;
    if (plan.mode === "ask_user") {
      let doFull = false;
      if (ctx.hasUI && ctx.ui.confirm) {
        doFull = await ctx.ui.confirm(
          "mdlog 记录连接",
          "检测到该文件属于当前会话，但未找到匹配的续写锚点：选择 [确定] 回填全量历史，还是 [取消] 仅记录后续新消息？"
        );
      }
      effectiveMode = doFull ? "full" : "append_only";
    }

    // 释放旧连接（优雅 flush），并停掉旧心跳
    if (writer) {
      const previous = writer;
      writer = null;
      await previous.destroy();
    }
    heartbeatManager.stop();

    if (!fs.existsSync(resolvedPath) || existingContent.trim().length === 0) {
      fs.writeFileSync(resolvedPath, formatHeader(sessionId), "utf8");
    } else if (effectiveMode === "full") {
      insertHeaderAtTopAtomic(resolvedPath, sessionId);
    }

    // 历史图条目回灌（会话内先连过别的文档也照收）：`--full` 回填时标记照旧能展开
    for (const [id, record] of collectFiguresFromBranch(branch)) {
      if (!figures.has(id)) figures.set(id, record);
    }

    const newWriter = new LiveLogWriter({
      filePath: resolvedPath,
      sessionId,
      sessionManager: ctx.sessionManager,
      config,
      figureLookup,
      onAnchorLost: () => {
        setAnchorLost(sidecarPath, true);
      },
      onWriteSuccess: (ts, writtenCount) => {
        updateLastWrite(sidecarPath, ts);
        if (currentState) {
          currentState.lastWriteAt = ts;
          currentState.writtenCount = writtenCount;
        }
      },
      onFatalError: (errMsg) => {
        ctx.ui.notify(errMsg, "error");
        void disconnect(ctx);
      },
    });
    writer = newWriter;

    // 历史回填（full / increment 都只喂合法会话消息）
    if (effectiveMode === "full") {
      for (const entry of branch) {
        if (isValidMessage(entry.message)) {
          newWriter.enqueueMessage({ message: entry.message });
        }
      }
      await newWriter.flush();
    } else if (effectiveMode === "increment" && plan.fromEntryId) {
      let hit = false;
      for (const entry of branch) {
        if (hit) {
          if (isValidMessage(entry.message)) {
            newWriter.enqueueMessage({ message: entry.message });
          }
        } else if (entry.id === plan.fromEntryId) {
          hit = true;
        }
      }
      await newWriter.flush();
    }

    const now = Date.now();
    currentState = {
      active: true,
      targetPath: resolvedPath,
      sessionId,
      connectedAt: now,
      lastWriteAt: now,
      writtenCount: newWriter.getWrittenCount(),
      anchorLost: false,
    };

    // sidecar 必须在 currentState 就位后写：宿主靠它显示「记录中 · PI」徽章
    writeSidecar(sidecarPath, {
      version: 1,
      sessionId,
      pid: process.pid,
      connectedAt: now,
      lastWriteAt: now,
      heartbeatAt: now,
      anchorLost: isAnchorLost,
    });
    heartbeatManager.start(sidecarPath, 30_000);

    try {
      pi.appendEntry("mdlog:connection", {
        active: true,
        path: resolvedPath,
        sessionId,
        timestamp: now,
      });
    } catch {
      // 条目写入失败不影响本次记录连接
    }

    setFigureToolActive(true);
    ctx.ui.notify(`mdlog: 已连接至 ${path.basename(resolvedPath)}`, "info");

    if (!flags.noOpen) {
      void openInVellum(resolvedPath, config).then((res) => {
        if (!res.success) {
          ctx.ui.notify(
            "已建立记录连接。如未自动在 Vellum 中打开，请手动在 Vellum 中打开该文件。",
            "warning"
          );
        }
      });
    }
  }

  async function disconnect(ctx: ExtensionContext): Promise<void> {
    if (!currentState) {
      ctx.ui.notify("mdlog: 当前未连接任何文件。使用 /mdlog <文件路径> 开始记录。", "info");
      return;
    }

    const sidecarPath = getSidecarPath(currentState.targetPath);
    heartbeatManager.stop();
    removeSidecar(sidecarPath);

    const previous = writer;
    writer = null;
    currentState = null;
    setFigureToolActive(false);

    try {
      pi.appendEntry("mdlog:connection", { active: false, timestamp: Date.now() });
    } catch {
      // 断开条目写入失败不阻塞断开
    }

    ctx.ui.notify("mdlog: 对话记录已断开连接", "info");

    if (previous) {
      // 丢弃语义由 isDisposed 门禁保证；await 保证断开返回后在途写盘已 settle
      await previous.destroyDiscard().catch(() => {});
    }
  }

  // --- 工具与显示（图示 HTML 不进对话记录的投递口） ---

  pi.registerTool(
    createFigureTool({
      isConnected: () => currentState !== null && currentState.active,
      register: registerFigure,
      takenIds: () => new Set(figures.keys()),
    })
  );

  // 标记在交互式记录里换成一行可读标签（只作用于 TUI 渲染，不碰落盘路径）
  pi.registerMarkdownTransformer((markdown, context) => {
    if (context?.messageType !== "assistant") return markdown;
    if (!markdown.includes("mdlog-fig:")) return markdown;
    return replaceFigureMarkersForTranscript(markdown, figureLookup);
  });

  // --- 命令注册 ---

  pi.registerCommand("mdlog", {
    description: "控制对话实时记录到 Markdown 文档 (/mdlog <路径> | off | status)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const parsed = parseMdlogCommand(args);

      if (parsed.action === "off") {
        await disconnect(ctx);
        return;
      }

      if (parsed.action === "status") {
        ctx.ui.notify(formatStatusOutput(currentState), "info");
        return;
      }

      if (parsed.error) {
        ctx.ui.notify(`mdlog: ${parsed.error}`, "error");
        return;
      }

      if (parsed.targetPath) {
        await connectToFile(parsed.targetPath, ctx, parsed.flags);
      }
    },
  });

  // --- 生命周期接线 ---

  // 1. 会话启动恢复（startup / reload / new / resume / fork）
  pi.on("session_start", async (_event, ctx) => {
    try {
      const branch = ctx.sessionManager.getBranch() as unknown as SessionEntryLike[];
      let lastConn: { active?: boolean; path?: string; sessionId?: string } | null = null;

      for (let i = branch.length - 1; i >= 0; i--) {
        const entry = branch[i];
        if (entry.type === "custom" && entry.customType === "mdlog:connection") {
          lastConn = (entry.data ?? null) as { active?: boolean; path?: string; sessionId?: string };
          break;
        }
      }

      if (!lastConn || lastConn.active === false) return;
      if (typeof lastConn.path !== "string" || lastConn.path.length === 0) return;

      if (lastConn.sessionId !== ctx.sessionManager.getSessionId()) {
        ctx.ui.notify(
          "mdlog: 检测到历史记录配置，为避免污染父会话日志未自动连接。如需记录请执行 /mdlog <文件> 手动连接。",
          "info"
        );
        return;
      }

      await connectToFile(lastConn.path, ctx, { full: false, append: false, noOpen: true });
    } catch {
      // 自动重连异常不得冒泡杀死启动流程
    } finally {
      // 未连上时把工具摘出工具表：mdlog 是全局扩展，不该在无关项目里多出一个工具。
      // 必须放 finally——上面几条提前 return（无历史连接、sessionId 不匹配）也会走到这里。
      setFigureToolActive(writer !== null);
    }
  });

  // 2. 消息落定：仅同步登记，严禁 await 磁盘（Y12）
  pi.on("message_end", (event, _ctx) => {
    if (!writer || !currentState) return;
    if (!isValidMessage(event.message)) return;
    // 必须原对象入队：flush 时靠引用全等比对本条目的 entryId（spec §3.5）
    writer.enqueueMessage({ message: event.message });
  });

  // 3. 工具执行结束：非阻塞登记候选图片（Y12）
  pi.on("tool_execution_end", (event, _ctx) => {
    if (!writer || !currentState) return;
    let serialized: string;
    try {
      serialized = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
    } catch {
      return;
    }
    const candidates = extractImageCandidates(
      serialized,
      config.toolNames,
      event.toolName,
      config.imageExtensions
    );
    if (candidates.length > 0) {
      writer.enqueueImageCandidates(candidates, Date.now());
    }
  });

  // 4. 回合落定：触发合并 flush，并做「未引用图」的兜底落位
  pi.on("agent_settled", async () => {
    if (writer) await writer.flush({ turnEnd: true });
  });

  // 5. 会话关闭：先刷盘，再停心跳、删 sidecar（spec §3.3）
  pi.on("session_shutdown", async () => {
    const activeWriter = writer;
    writer = null;
    if (activeWriter) {
      try {
        await activeWriter.flush({ imageTimeoutMs: 1000, turnEnd: true });
      } catch {
        // 关档刷盘失败不阻塞退出
      }
      await activeWriter.destroy().catch(() => {});
    }
    heartbeatManager.stop();
    if (currentState) {
      removeSidecar(getSidecarPath(currentState.targetPath));
      currentState = null;
    }
  });
}
