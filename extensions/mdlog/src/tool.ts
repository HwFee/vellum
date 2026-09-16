/**
 * vellum_figure 工具：图示 HTML 的投递口（注册面）。
 *
 * 为什么要有它：Agent 原先把 ```` ```vellum-widget ```` 围栏连同几 KB HTML 直接写进
 * 回复正文，对话记录与日志正文里就挂出一条源码长龙。改成工具投递后，正文里只留一枚
 * 短标记（`<!-- mdlog-fig:ID -->`），写入器在落盘前把它展开回围栏——**日志文件与
 * 手写围栏逐字节同形**，只是源码不再经过对话。
 *
 * 纯逻辑在 figures.ts；这里只做参数校验、登记与两处压缩显示（工具行与结果行）。
 */

import * as fs from "node:fs";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { AgentToolResult, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  describeFigure,
  figureMarker,
  makeFigureId,
  resolveDraftPath,
  validateFigureHtml,
} from "./figures.ts";
import type { FigureRecord } from "./figures.ts";

export const FIGURE_TOOL_NAME = "vellum_figure";
export const FIGURE_TOOL_LABEL = "投递图示";

export interface FigureToolDeps {
  /** 记录连接是否有效（未连接时工具不该被激活；被调用则报错） */
  isConnected: () => boolean;
  /** 登记图（写入器消费 + 落 appendEntry 持久化） */
  register: (record: FigureRecord) => void;
  /** 已占用的 id（去重用） */
  takenIds: () => Set<string>;
  /** 可注入的读取面（测试用） */
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
}

export interface FigureToolDetails {
  id?: string;
  title?: string;
  bytes?: number;
  source?: "path" | "html";
  error?: string;
}

const FigureParams = Type.Object(
  {
    path: Type.Optional(
      Type.String({
        description:
          "草稿 HTML 的文件路径（推荐用法）：cwd 相对或绝对。Git Bash 风格的 /tmp/x.html 会被映射到系统临时目录。传路径时源码不进对话。",
      })
    ),
    html: Type.Optional(
      Type.String({
        description:
          "完整 HTML5 文档源码。只适合小图；几 KB 的图请先写入草稿文件再传 path，避免源码进对话记录。",
      })
    ),
    title: Type.Optional(
      Type.String({
        description: "图的短标题（如「傅里叶级数逐阶合成」），用于工具回显与对话记录里的折叠标签。",
      })
    ),
  },
  { additionalProperties: false }
);

function result(
  text: string,
  details: FigureToolDetails
): AgentToolResult<FigureToolDetails> {
  return { content: [{ type: "text", text }], details };
}

function failure(message: string): AgentToolResult<FigureToolDetails> {
  return result(`投递失败：${message}`, { error: message });
}

/** 工具回执：把「标记怎么写、写在哪」讲清楚，模型照抄即可 */
function successText(record: FigureRecord, source: "path" | "html"): string {
  const where = source === "path" ? "草稿文件已读取" : "内联源码已接收";
  return [
    `已投递图示 ${record.id}（${describeFigure(record)}，${where}）。`,
    "",
    "把它单独成行放在正文里图应出现的位置（图前引子之后、图注之前）：",
    "",
    figureMarker(record.id),
    "",
    "这一行会在写入日志时展开成 vellum-widget 围栏并渲染成图。正文里不要再写 HTML 源码；",
    "漏放标记时图会在本回合末尾自动补上。",
  ].join("\n");
}

export function createFigureTool(deps: FigureToolDeps) {
  const readFile = deps.readFile ?? ((path: string) => fs.readFileSync(path, "utf8"));
  const exists = deps.exists ?? ((path: string) => fs.existsSync(path));

  return {
    name: FIGURE_TOOL_NAME,
    label: FIGURE_TOOL_LABEL,
    description:
      "把一张图的完整 HTML5 文档投递进 Vellum 实时日志（等价于手写一个 vellum-widget 围栏），" +
      "但源码不经过对话记录——返回一枚短标记，把它单独成行放在图该出现的位置即可。",
    promptSnippet:
      "Deliver a figure into the Vellum live log without putting its HTML in the reply text",
    promptGuidelines: [
      "mdlog 记录期间：图一律用 vellum_figure 投递（传已 lint 过的草稿文件路径），不要在回复正文里手写 ```vellum-widget 围栏——围栏带着几 KB 源码进对话记录，看着很脏。",
      "vellum_figure 返回的 `<!-- mdlog-fig:ID -->` 标记要**整枚照抄**并单独成行，放在图该出现的位置；漏放时图会在本回合末尾自动补上，但位置就不受你控制了。",
    ],
    parameters: FigureParams,
    executionMode: "sequential" as const,

    async execute(
      _toolCallId: string,
      params: { path?: string; html?: string; title?: string },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext
    ): Promise<AgentToolResult<FigureToolDetails>> {
      if (!deps.isConnected()) {
        return failure(
          "当前没有 mdlog 记录连接。非记录态的文档请按技能把 vellum-widget 围栏直接写进正文。"
        );
      }

      const title = typeof params.title === "string" && params.title.trim().length > 0
        ? params.title.trim()
        : undefined;

      let html: string | undefined;
      let source: "path" | "html" = "path";

      const rawPath = typeof params.path === "string" ? params.path.trim() : "";
      if (rawPath.length > 0) {
        const cwd = typeof ctx?.cwd === "string" && ctx.cwd.length > 0 ? ctx.cwd : process.cwd();
        const resolved = resolveDraftPath(rawPath, cwd, exists);
        if (resolved.error) return failure(resolved.error);
        if (!resolved.exists) return failure(`草稿文件不存在：${resolved.resolved}`);
        try {
          html = readFile(resolved.resolved);
        } catch (err) {
          return failure(
            `草稿文件读取失败：${resolved.resolved}（${err instanceof Error ? err.message : String(err)}）`
          );
        }
      } else if (typeof params.html === "string" && params.html.trim().length > 0) {
        html = params.html;
        source = "html";
      } else {
        return failure("需要 path（草稿文件路径）或 html（完整源码）其中之一。");
      }

      const validation = validateFigureHtml(html);
      if (!validation.ok) return failure(validation.error);

      const record: FigureRecord = {
        id: makeFigureId(Math.random, deps.takenIds()),
        html,
        title,
        createdAt: Date.now(),
      };
      deps.register(record);

      return result(successText(record, source), {
        id: record.id,
        title,
        bytes: Buffer.byteLength(html, "utf8"),
        source,
      });
    },

    /** 工具行压成一行：绝不回显源码 */
    renderCall(
      args: { path?: string; html?: string; title?: string },
      theme: Theme
    ): Text {
      const label = args.title?.trim()
        ? args.title.trim()
        : args.path?.trim()
          ? args.path.trim().replace(/\\/g, "/").split("/").pop() || "html"
          : "内联源码";
      return new Text(
        theme.fg("toolTitle", theme.bold("vellum_figure ")) + theme.fg("accent", label),
        0,
        0
      );
    },

    /** 结果行压成一行 */
    renderResult(
      result: AgentToolResult<FigureToolDetails>,
      _options: unknown,
      theme: Theme
    ): Text {
      const details = result.details;
      if (details?.error) {
        return new Text(theme.fg("error", `✗ ${details.error}`), 0, 0);
      }
      const size = details?.bytes ? ` · ${Math.max(1, Math.round(details.bytes / 1024))} KB` : "";
      const label = details?.title ? ` · ${details.title}` : "";
      return new Text(
        theme.fg("success", "▤ 已投递 ") +
          theme.fg("accent", details?.id ?? "") +
          theme.fg("muted", `${label}${size}`),
        0,
        0
      );
    },
  };
}
