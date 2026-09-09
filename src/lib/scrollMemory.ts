import { Store } from "@tauri-apps/plugin-store";

const STORE_PATH = "scroll-positions.json";

/**
 * 阅读位置记录。
 * - ratio：滚动比例 0–1，窗口尺寸变化后的兜底（无标题文档、锚点丢失时用）
 * - anchorId / anchorIndex：视口顶部最近标题的 id 及其在大纲中的序号。
 *   恢复时优先按 id 找锚点；该标题被删/改名后按序号找文档顺序上最近幸存的标题，
 *   做到「位置被删了也能定位到附近」。
 * - offset：保存时「视口顶 − 锚点标题顶」的像素差（锚点在视口上方为正），
 *   恢复时让锚点回到同样的相对位置。
 * - blockIndex / blockOffset：视口顶部首个可见顶层块在 .markdown-body 中的序号
 *   及同样的相对偏移。mdlog 日志这类无标题文档里标题锚点缺失，纯比例兜底在
 *   末尾追加（流式记录写入）后必然错位——比例是相对「新总高」算的，旧位置对应
 *   的比例已被稀释；顶层块序号对末尾追加天然稳定（追加只增加尾部块，不动前面
 *   的序号），且落位守护以固定元素为目标，widget 异步撑高时目标不再随总高漂移。
 */
export type ScrollPositionRecord = {
  ratio: number;
  anchorId?: string;
  anchorIndex?: number;
  offset?: number;
  blockIndex?: number;
  blockOffset?: number;
};

let storePromise: Promise<Store> | null = null;

function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_PATH).catch((error) => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

function isValidRatio(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

/** 兼容旧格式（纯 number 比例）与新格式（对象记录） */
function normalizeRecord(value: unknown): ScrollPositionRecord | null {
  if (isValidRatio(value)) {
    return { ratio: value };
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (!isValidRatio(raw.ratio)) {
    return null;
  }
  const record: ScrollPositionRecord = { ratio: raw.ratio };
  if (typeof raw.anchorId === "string" && raw.anchorId) {
    record.anchorId = raw.anchorId;
  }
  if (typeof raw.anchorIndex === "number" && raw.anchorIndex >= 0) {
    record.anchorIndex = raw.anchorIndex;
  }
  if (typeof raw.offset === "number" && Number.isFinite(raw.offset)) {
    record.offset = raw.offset;
  }
  if (typeof raw.blockIndex === "number" && raw.blockIndex >= 0) {
    record.blockIndex = Math.round(raw.blockIndex);
  }
  if (typeof raw.blockOffset === "number" && Number.isFinite(raw.blockOffset)) {
    record.blockOffset = raw.blockOffset;
  }
  return record;
}

/** 保存文件的阅读位置（锚点 + 偏移 + 比例兜底），窗口尺寸变化后仍能大致还原 */
export async function saveScrollPosition(path: string, record: ScrollPositionRecord): Promise<void> {
  try {
    const store = await getStore();
    await store.set(path, record);
    await store.save();
  } catch {
    // 持久化失败不影响正常使用
  }
}

/** 读取文件的阅读位置，无记录时返回 null；旧版纯比例记录自动升级为 { ratio } */
export async function loadScrollPosition(path: string): Promise<ScrollPositionRecord | null> {
  try {
    const store = await getStore();
    return normalizeRecord(await store.get<unknown>(path));
  } catch {
    return null;
  }
}
