/**
 * 串行实时写入器（spec §3.5 / §3.6 / §3.8）。
 *
 * 硬约束：
 * - 事件 handler 只做同步入队 + 单定时器调度，严禁 await 磁盘（Y12）；
 * - 所有落盘走严格串行的 Promise 链，文件追加顺序单调；
 * - 相同角色连续消息合并为一个回合块；跨批次合并需文件尾 `endsWith` 校验，
 *   校验失败（外部编辑）降级为独立追加；合并重写走 tmp + rename 原子替换；
 * - 断开（discard）后不得有迟到写盘：链回调、退避窗后、rename 前均有 isDisposed 闸。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  extractMessageText,
  formatHeader,
  formatTimestamp,
  isEmptyText,
  renderTurnBlock,
} from "./format.ts";
import type { TurnBlock } from "./format.ts";
import {
  expandFigureMarkers,
  figureFence,
  pendingFromSnapshot,
  referencedFigureIds,
} from "./figures.ts";
import type { FigureLookup, FigureRecord } from "./figures.ts";
import { cleanAssetRetention, processTurnImages } from "./image.ts";
import { normalizeTrailingNewlines } from "./scan.ts";
import { createImageCopyState } from "./types.ts";
import type {
  BufferedMessageItem,
  ImageCopyState,
  MdlogConfig,
  MessageRole,
  SessionManagerLike,
} from "./types.ts";

export interface WriterOptions {
  filePath: string;
  sessionId: string;
  sessionManager: SessionManagerLike;
  config?: MdlogConfig;
  cwd?: string;
  /** 图标记的解析口（内存登记表 + 会话条目还原） */
  figureLookup?: FigureLookup;
  onAnchorLost?: () => void;
  onWriteSuccess?: (ts: number, writtenCount: number) => void;
  onFatalError?: (msg: string) => void;
}

interface ImageBatch {
  candidates: string[];
  turnStartTime: number;
}

interface PreparedBlock {
  role: MessageRole;
  time: string;
  texts: string[];
  images: string[];
  /** 未在正文里引用的图围栏（回合末兜底） */
  figures?: string[];
  entryId?: string;
  isTurnEnd: boolean;
}

interface PreparedBatch {
  blocks: PreparedBlock[];
  writtenMessages: number;
  anchorLost: boolean;
  /** 本批已真正落进文档的图 id（提交成功后才从队列移除） */
  attachedFigureIds: string[];
}

interface PrepareBatchOptions {
  imageTimeoutMs?: number;
  /** 回合末快照：未在正文引用的图兜底追加到本回合末尾 */
  leftoverFigures?: FigureRecord[];
}

export interface FlushOptions {
  imageTimeoutMs?: number;
  /**
   * 回合末（agent_settled / 断开 / 关档）。只有回合末才做「未引用图」兜底——
   * 中途的防抖 flush 里标记可能还没随下一条消息到达，提前补会把图放到引子之前。
   */
  turnEnd?: boolean;
}

const RETRY_DELAYS_MS = [50, 150, 300] as const;
const ASSET_CLEAN_THROTTLE_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

/** 同步小睡（原子替换的 EPERM 微重试用，不阻塞到肉眼可感） */
function sleepSync(ms: number): void {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

export class LiveLogWriter {
  private filePath: string;
  private sessionId: string;
  private sessionManager: SessionManagerLike;
  private config?: MdlogConfig;
  private fixedCwd?: string;
  private figureLookup?: FigureLookup;
  private onAnchorLost?: () => void;
  private onWriteSuccess?: (ts: number, writtenCount: number) => void;
  private onFatalError?: (msg: string) => void;

  private messageQueue: BufferedMessageItem[] = [];
  private imageCandidatesQueue: ImageBatch[] = [];
  private figureQueue: FigureRecord[] = [];
  /** 已落进文档的图 id：后来的同 id 标记不再展开（防同图复制两份） */
  private consumedFigureIds = new Set<string>();
  private debounceTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private consecutiveBatchFailures = 0;
  private closing = false;
  private isDisposed = false;
  private lastMessageTimestamp?: number;
  private lastBlock: PreparedBlock | null = null;
  private lastBlockBytes: string | null = null;
  private writtenCount = 0;
  private lastAssetCleanTime = 0;

  /** 供测试注入文件锁错误 */
  public _testInjectAppendFailure?: () => void;

  constructor(options: WriterOptions) {
    this.filePath = options.filePath;
    this.sessionId = options.sessionId;
    this.sessionManager = options.sessionManager;
    this.config = options.config;
    this.fixedCwd = options.cwd;
    this.figureLookup = options.figureLookup;
    this.onAnchorLost = options.onAnchorLost;
    this.onWriteSuccess = options.onWriteSuccess;
    this.onFatalError = options.onFatalError;
  }

  public getWrittenCount(): number {
    return this.writtenCount;
  }

  public getLastBlockBytes(): string | null {
    return this.lastBlockBytes;
  }

  // --- 入队（同步、非阻塞） ---

  public enqueueMessage(item: BufferedMessageItem): void {
    if (this.closing || this.isDisposed) return;
    const role = item.message?.role;
    if (role !== "user" && role !== "assistant") return;
    if (isEmptyText(extractMessageText(item.message.content))) return;
    this.messageQueue.push(item);
    this.scheduleDebounce();
  }

  public enqueueImageCandidates(candidates: string[], turnStartTime: number): void {
    if (this.closing || this.isDisposed || candidates.length === 0) return;
    this.imageCandidatesQueue.push({ candidates, turnStartTime });
  }

  /**
   * 登记一张待落位的图（vellum_figure 工具）。同步入队、不 await 磁盘。
   * 图有两种归宿：正文里的标记展开（Agent 指定位置），或回合末兜底追加。
   */
  public enqueueFigure(record: FigureRecord): void {
    if (this.closing || this.isDisposed) return;
    if (this.consumedFigureIds.has(record.id)) return;
    if (this.figureQueue.some((f) => f.id === record.id)) return;
    this.figureQueue.push(record);
  }

  private scheduleDebounce(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, 150);
    this.debounceTimer.unref();
  }

  // --- 落盘 ---

  public async flush(options?: FlushOptions): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.writeChain = this.writeChain.then(async () => {
      // 图队列与消息队列同时快照：中途新到的消息/图不得混进本批（否则兜底时机错位）
      const batchFigures = options?.turnEnd ? [...this.figureQueue] : [];

      if (this.messageQueue.length === 0 && this.imageCandidatesQueue.length === 0) {
        // 队列空但可能有已投递却未落位的图：回合末补写文件尾
        if (options?.turnEnd) {
          const pendingBefore = this.figureQueue.length;
          this.flushLeftoverFigures(batchFigures);
          if (this.figureQueue.length < pendingBefore) {
            // 补写也是一次真实落盘：更新 sidecar 的「最近写入」，别让状态显示落后
            try {
              this.onWriteSuccess?.(Date.now(), this.writtenCount);
            } catch {
              // 侧车更新失败不得回灌队列
            }
          }
        }
        return;
      }

      const batchMessages = [...this.messageQueue];
      const batchImages = [...this.imageCandidatesQueue];
      this.messageQueue = [];
      this.imageCandidatesQueue = [];

      let prepared: PreparedBatch;
      try {
        // 图片处理在重试圈外做一次：重试不得重复复制同一张图（Item 8 的幂等前提）
        prepared = await this.prepareBatch(batchMessages, batchImages, {
          imageTimeoutMs: options?.imageTimeoutMs,
          leftoverFigures: batchFigures,
        });
      } catch (err) {
        this.requeue(batchMessages, batchImages);
        this.handleBatchFailure(err);
        return;
      }

      if (this.isDisposed) return;

      try {
        await this.commitBatch(prepared);
      } catch (err) {
        this.requeue(batchMessages, batchImages);
        this.handleBatchFailure(err);
        return;
      }

      // 只有提交成功才从队列移除：写盘失败重试时图还在队列里，不会丢
      for (const id of prepared.attachedFigureIds) {
        this.consumedFigureIds.add(id);
        const index = this.figureQueue.findIndex((f) => f.id === id);
        if (index >= 0) this.figureQueue.splice(index, 1);
      }

      this.consecutiveBatchFailures = 0;
      this.writtenCount += prepared.writtenMessages;
      const now = Date.now();

      // 本批没有助手块可挂（如纯用户批）时，剩余图仍走文件尾补写
      if (options?.turnEnd) this.flushLeftoverFigures(batchFigures);

      // sidecar 与资产清理的异常与正文落盘解耦（Item 2）
      try {
        this.onWriteSuccess?.(now, this.writtenCount);
      } catch {
        // 侧车更新失败不得回灌队列、不得计熔断
      }
      this.maybeCleanAssets();
    });

    await this.writeChain.catch(() => {});
  }

  private requeue(messages: BufferedMessageItem[], images: ImageBatch[]): void {
    this.messageQueue.unshift(...messages);
    this.imageCandidatesQueue.unshift(...images);
  }

  private handleBatchFailure(err: unknown): void {
    this.consecutiveBatchFailures++;
    if (this.consecutiveBatchFailures >= 3) {
      const message = err instanceof Error ? err.message : String(err);
      this.onFatalError?.(`mdlog: 磁盘写入连续失败 3 次 (${message})，已自动断开连接`);
    }
  }

  private maybeCleanAssets(): void {
    const now = Date.now();
    if (now - this.lastAssetCleanTime < ASSET_CLEAN_THROTTLE_MS) return;
    this.lastAssetCleanTime = now;
    try {
      const assetsDir = path.join(path.dirname(this.filePath), "mdlog-assets");
      const maxBytes = (this.config?.assetRetentionMb ?? 200) * 1024 * 1024;
      cleanAssetRetention(assetsDir, maxBytes);
    } catch {
      // 清理失败不影响写入
    }
  }

  /** 测试接口：把上次清理时间设到过去，验证节流窗口 */
  public _testSetLastAssetCleanTime(ts: number): void {
    this.lastAssetCleanTime = ts;
  }

  // --- 批次准备：分块、合并、图片、锚点 ---

  private async prepareBatch(
    messages: BufferedMessageItem[],
    imageBatches: ImageBatch[],
    options?: PrepareBatchOptions
  ): Promise<PreparedBatch> {
    const imageTimeoutMs = options?.imageTimeoutMs;
    const branch = this.sessionManager.getBranch();
    const cwd = this.fixedCwd ?? this.sessionManager.getCwd();

    const allCandidates: string[] = [];
    let latestTurnStartTime = Date.now();
    for (const ib of imageBatches) {
      allCandidates.push(...ib.candidates);
      if (ib.turnStartTime < latestTurnStartTime) latestTurnStartTime = ib.turnStartTime;
    }

    let writtenMessages = 0;
    let matchedCount = 0;
    const blocks: PreparedBlock[] = [];

    for (const item of messages) {
      const role = item.message.role;
      if (role !== "user" && role !== "assistant") continue;
      const rawText = extractMessageText(item.message.content);
      if (isEmptyText(rawText)) continue;

      const timestamp = item.message.timestamp ?? Date.now();
      const timeStr = formatTimestamp(timestamp, this.lastMessageTimestamp);
      this.lastMessageTimestamp = timestamp;

      let matchedEntryId: string | undefined;
      for (let b = branch.length - 1; b >= 0; b--) {
        if (branch[b].message === item.message) {
          matchedEntryId = branch[b].id;
          break;
        }
      }
      if (matchedEntryId) matchedCount++;
      writtenMessages++;

      const last = blocks.length > 0 ? blocks[blocks.length - 1] : null;
      if (last && last.role === role) {
        // 同角色连续消息：并入同一回合块（批内碎片合并）
        last.texts.push(rawText);
        if (matchedEntryId) last.entryId = matchedEntryId;
      } else {
        blocks.push({
          role: role as MessageRole,
          time: timeStr,
          texts: [rawText],
          images: [],
          figures: [],
          entryId: matchedEntryId,
          isTurnEnd: false,
        });
      }
    }

    if (writtenMessages === 0) {
      // 图片-only 批次：候选放回队列，等下一次助手消息消费（Item 9）
      if (imageBatches.length > 0 && !this.isDisposed) {
        this.imageCandidatesQueue.unshift(...imageBatches);
      }
      return { blocks: [], writtenMessages: 0, anchorLost: false, attachedFigureIds: [] };
    }

    // 助手块：合并正文后统一做图片管线（realpath 去重状态跨块共享）
    const sharedState: ImageCopyState = createImageCopyState();
    const lastAssistantIdx = blocks.reduce((acc, b, i) => (b.role === "assistant" ? i : acc), -1);
    const referencedIds = new Set<string>();
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.role !== "assistant") continue;
      const joined = block.texts.join("\n\n");
      // 引用判定必须在展开之前：展开会把标记换掉，之后再无从得知 Agent 指定过哪些图
      for (const id of referencedFigureIds(joined)) referencedIds.add(id);
      const result = await processTurnImages(allCandidates, joined, {
        cwd,
        logDir: path.dirname(this.filePath),
        turnStartTime: latestTurnStartTime,
        maxImageBytes: this.config?.maxImageBytes,
        timeoutMs: imageTimeoutMs ?? this.config?.imageCopyTimeoutMs,
        imageExtensions: this.config?.imageExtensions,
        sharedState,
      });
      // 图展开放在图片管线之后：图片管线扫的是模型正文，不该看见 widget 源码
      block.texts = [this.expandFigureMarkers(result.rewrittenAssistantText)];
      if (i === lastAssistantIdx) block.images = result.unreferencedCleanNames;
    }

    // 回合末兜底：投递了却没在正文里放标记的图，追加到本回合最后一个助手块末尾
    const attachedFigureIds: string[] = [];
    for (const figure of options?.leftoverFigures ?? []) {
      if (referencedIds.has(figure.id)) {
        attachedFigureIds.push(figure.id);
        continue;
      }
      const target = lastAssistantIdx >= 0 ? blocks[lastAssistantIdx] : null;
      if (!target) break;
      target.figures = [...(target.figures ?? []), figureFence(figure.html)];
      attachedFigureIds.push(figure.id);
    }

    if (blocks.length > 0) blocks[blocks.length - 1].isTurnEnd = true;

    // 锚点丢失判据：整批无一条按引用命中（Item 14 收窄）
    const anchorLost = matchedCount === 0;
    if (anchorLost) this.onAnchorLost?.();

    return { blocks, writtenMessages, anchorLost, attachedFigureIds };
  }

  /** 把正文里的 `<!-- mdlog-fig:ID -->` 展开回 vellum-widget 围栏（已落位的 id 不再展开） */
  private expandFigureMarkers(text: string): string {
    if (!this.figureLookup) return text;
    const lookup = this.figureLookup;
    const consumed = this.consumedFigureIds;
    const { text: expanded } = expandFigureMarkers(text, (id) =>
      consumed.has(id) ? undefined : lookup(id)
    );
    return expanded;
  }

  /**
   * 回合末把仍未落位的图补写到文件尾最后一块。两条路径：
   * - 本批有助手块：prepareBatch 已把它们挂进块里（队列同时清空，这里直接返回）；
   * - 本批没有助手块（队列空、或纯用户批）：在已有文件尾上重写最后一块补上。
   *
   * `snapshot` 是本批开始时的图队列快照，**只补写快照里的图**：prepareBatch 里做图片复制
   * 会 await 上百毫秒，期间新到的图属于下一回合（它的标记还没写进正文），
   * 在这里补会既放错位置、又把它标成已消费，等真标记到达时反被丢弃。
   *
   * 文件尾被外部改写（endsWith 校验失败）时保持挂起，等下一个回合末再试——宁晚不丢。
   */
  private flushLeftoverFigures(snapshot: FigureRecord[]): void {
    if (this.isDisposed) return;
    const pending = pendingFromSnapshot(snapshot, this.figureQueue);
    if (pending.length === 0) return;
    if (!this.lastBlock || this.lastBlock.role !== "assistant" || this.lastBlockBytes === null) return;
    if (!fs.existsSync(this.filePath)) return;

    let fileContent: string;
    try {
      fileContent = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    if (!fileContent.endsWith(this.lastBlockBytes)) return;

    const merged: PreparedBlock = {
      ...this.lastBlock,
      texts: [...this.lastBlock.texts],
      figures: [...(this.lastBlock.figures ?? []), ...pending.map((f) => figureFence(f.html))],
      isTurnEnd: true,
    };
    const mergedBytes = renderTurnBlock(merged, merged.isTurnEnd);
    const base = fileContent.slice(0, fileContent.length - this.lastBlockBytes.length);

    try {
      this.atomicReplace(normalizeMergePreamble(base) + mergedBytes);
    } catch {
      return; // 重写失败保持挂起
    }

    for (const figure of pending) {
      this.consumedFigureIds.add(figure.id);
      const index = this.figureQueue.findIndex((queued) => queued.id === figure.id);
      if (index >= 0) this.figureQueue.splice(index, 1);
    }
    this.lastBlock = { ...merged, texts: [...merged.texts] };
    this.lastBlockBytes = mergedBytes;
  }

  // --- 提交：串行重试 + 落盘 ---

  private async commitBatch(prepared: PreparedBatch): Promise<void> {
    if (prepared.blocks.length === 0) return;

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.isDisposed) return; // 断开后的迟到批次一律不写
      try {
        if (this._testInjectAppendFailure) this._testInjectAppendFailure();
        this.writePreparedToDisk(prepared);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          if (this.isDisposed) return; // 退避窗后第二道闸
        }
      }
    }
    throw lastError;
  }

  private writePreparedToDisk(prepared: PreparedBatch): void {
    if (this.isDisposed) return;

    const logDir = path.dirname(this.filePath);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    let fileContent = "";
    if (fs.existsSync(this.filePath)) {
      fileContent = fs.readFileSync(this.filePath, "utf8");
    } else {
      fileContent = "";
    }

    if (fileContent.length === 0) {
      // 连接时已写头；此处兜底（文件被外部删除/清空）
      fileContent = formatHeader(this.sessionId);
      fs.writeFileSync(this.filePath, fileContent, "utf8");
    }

    const first = prepared.blocks[0];
    const tailBlocks = prepared.blocks.slice(1);

    let tailBytes = "";
    for (const block of tailBlocks) {
      tailBytes += renderTurnBlock(block, block.isTurnEnd);
    }
    const lastTail = tailBlocks.length > 0 ? tailBlocks[tailBlocks.length - 1] : null;

    const mergeable =
      this.lastBlock !== null &&
      this.lastBlockBytes !== null &&
      this.lastBlock.role === first.role &&
      fileContent.endsWith(this.lastBlockBytes);

    if (mergeable && this.lastBlock && this.lastBlockBytes !== null) {
      // 跨批次碎片合并：把文件尾的旧块换成合并后的新块，原子替换（tmp + rename + EPERM 微重试）
      const merged: PreparedBlock = {
        role: this.lastBlock.role,
        time: this.lastBlock.time,
        texts: [...this.lastBlock.texts, ...first.texts],
        images: Array.from(new Set([...this.lastBlock.images, ...first.images])),
        figures: [...(this.lastBlock.figures ?? []), ...(first.figures ?? [])],
        entryId: first.entryId ?? this.lastBlock.entryId,
        isTurnEnd: first.isTurnEnd,
      };
      const mergedBytes = renderTurnBlock(merged, merged.isTurnEnd);
      const base = fileContent.slice(0, fileContent.length - this.lastBlockBytes.length);
      this.atomicReplace(normalizeMergePreamble(base) + mergedBytes + tailBytes);

      const lastBlock = lastTail ?? merged;
      this.lastBlock = { ...lastBlock, texts: [...lastBlock.texts] };
      this.lastBlockBytes = lastTail ? renderTurnBlock(lastBlock, lastBlock.isTurnEnd) : mergedBytes;
      return;
    }

    // 独立追加（外部编辑导致 endsWith 校验失败时也走这里）
    const firstBytes = renderTurnBlock(first, first.isTurnEnd);
    this.ensureTrailingNewlinesOnFile();
    fs.appendFileSync(this.filePath, firstBytes + tailBytes, "utf8");

    const lastBlock = lastTail ?? first;
    this.lastBlock = { ...lastBlock, texts: [...lastBlock.texts] };
    this.lastBlockBytes = lastTail ? renderTurnBlock(lastBlock, lastBlock.isTurnEnd) : firstBytes;
  }

  /** 合并重写时，被替换段之前的内容若以单个换行结尾，补足空行（4b/接缝同源要求） */
  private atomicReplace(content: string): void {
    const tempPath = `${this.filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tempPath, content, "utf8");

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.isDisposed) {
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // 清理失败不覆盖断开语义
        }
        return;
      }
      try {
        fs.renameSync(tempPath, this.filePath);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < 2) sleepSync(20);
      }
    }
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // 忽略
    }
    throw lastError;
  }

  /** 追加前读取尾部若干字节，确保文件以恰好一个空行结尾（O(1)，不整文件读取） */
  public ensureTrailingNewlinesOnFile(): void {
    if (!fs.existsSync(this.filePath)) return;
    const fd = fs.openSync(this.filePath, "r");
    let tail = "";
    try {
      const size = fs.fstatSync(fd).size;
      if (size === 0) return;
      const n = Math.min(2, size);
      const buf = Buffer.alloc(n);
      fs.readSync(fd, buf, 0, n, size - n);
      tail = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    if (tail.endsWith("\n\n")) return;
    fs.appendFileSync(this.filePath, tail.endsWith("\n") ? "\n" : "\n\n", "utf8");
  }

  // --- 生命周期 ---

  /** 优雅关闭：停止接收新消息，把在途与队列内容刷盘 */
  public async destroy(): Promise<void> {
    if (!this.isDisposed && !this.closing) {
      this.closing = true;
      // 断开等同回合末：已投递未落位的图在这里补上，别留给下一次连接
      await this.flush({ turnEnd: true });
      this.isDisposed = true;
      return;
    }
    this.isDisposed = true;
  }

  /** 丢弃关闭：清空队列、取消重试，并等待在途链真正 settle（spec §3.6 / A10） */
  public async destroyDiscard(): Promise<void> {
    this.isDisposed = true;
    this.messageQueue = [];
    this.imageCandidatesQueue = [];
    this.figureQueue = [];
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.writeChain.catch(() => {});
    this.closing = true;
  }

  public get isClosed(): boolean {
    return this.isDisposed || this.closing;
  }
}

function normalizeMergePreamble(preamble: string): string {
  return normalizeTrailingNewlines(preamble);
}
