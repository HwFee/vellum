/**
 * mdlog 共享类型定义（纯类型，无运行时代码）。
 *
 * 运行期只依赖 Node.js 内置模块；pi 的类型声明仅作类型用途，
 * 由 tsconfig.json 的 paths 映射到宿主安装位。
 */

export interface SidecarData {
  version: number;
  sessionId: string;
  pid: number;
  connectedAt: number;
  lastWriteAt: number;
  heartbeatAt: number;
  anchorLost?: boolean;
}

export interface MdlogConfig {
  /** 若给出，仅当 tool_execution_end 的工具名在此白名单内才提取图片 */
  toolNames?: string[];
  /** 允许同步的图片扩展名（svg 始终被剔除） */
  imageExtensions?: string[];
  /** 单张图片字节上限 */
  maxImageBytes?: number;
  /** mdlog-assets 目录配额（MB） */
  assetRetentionMb?: number;
  /** 单张图片复制超时（毫秒），默认 5000；关档时压到 1000 */
  imageCopyTimeoutMs?: number;
  /** 唤起 Vellum 的显式可执行文件路径（最高优先级） */
  vellumPath?: string;
}

export interface MdlogConnectionState {
  active: boolean;
  targetPath: string;
  sessionId: string;
  connectedAt: number;
  lastWriteAt: number;
  writtenCount: number;
  anchorLost?: boolean;
}

export interface TextChunk {
  type: string;
  text?: string;
}

export interface ImageChunk {
  type: string;
  image?: string;
}

export type MessageContent = string | Array<TextChunk | ImageChunk>;

export type MessageRole = "user" | "assistant";

export interface BufferedMessageItem {
  message: {
    role: string;
    content: MessageContent;
    timestamp?: number;
  };
  turnStartTime?: number;
}

export interface SessionEntryLike {
  id: string;
  type?: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
}

export interface SessionManagerLike {
  getBranch(): SessionEntryLike[];
  getCwd(): string;
  getSessionId(): string;
}

/** 同回合多助手消息共享的图片去重状态（realpath 去重 + 已分配文件名） */
export interface ImageCopyState {
  realPathMap: Map<string, string>;
  allocatedNames: Set<string>;
}

export function createImageCopyState(): ImageCopyState {
  return { realPathMap: new Map(), allocatedNames: new Set() };
}
