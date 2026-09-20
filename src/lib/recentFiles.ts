import { isSamePath } from "./path";
import { getSettingsStore } from "./settings";

const STORE_KEY = "recentFiles";

/// 迁移用的旧 key：1.8.1 及更早只存「最近一次打开」的单条记录
const LEGACY_KEY = "lastOpenedPath";

export const RECENT_FILES_LIMIT = 8;

/**
 * 归一化：只留非空字符串，按 isSamePath 去重（忽略大小写与分隔符差异，与「同路径重开」同款判据），
 * 超过上限即截断。列表里出现过的任何写法都收敛成一份，后续读写都以此为准。
 */
function normalize(entries: unknown): string[] {
  if (!Array.isArray(entries)) return [];
  const result: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const path = entry.trim();
    if (path === "") continue;
    if (result.some((kept) => isSamePath(kept, path))) continue;
    result.push(path);
    if (result.length >= RECENT_FILES_LIMIT) break;
  }
  return result;
}

async function persist(paths: string[]): Promise<void> {
  try {
    const store = await getSettingsStore();
    await store.set(STORE_KEY, paths);
    await store.save();
  } catch {
    // 持久化失败不影响正常使用
  }
}

/**
 * 读取最近打开列表（新打开的在前）。
 *
 * 旧 key 迁移：`recentFiles` **键不存在**而 `lastOpenedPath` 有值时，以那一条为种子
 * （升级到本版后的首次启动因此仍能恢复上次文档），随后把旧 key 删掉——迁移只做一次。
 *
 * 「键不存在」与「键存在但是空数组」必须分开看：`removeRecent` 把最后一条摘掉时会显式落盘
 * `[]`，若把空数组也当作「没有记录」而再去读旧 key，那条刚被摘掉的死路径就会原地复活
 * （启动恢复也会永远重试它），用户再也回不到空态。
 */
export async function loadRecentFiles(): Promise<string[]> {
  try {
    const store = await getSettingsStore();
    const raw = await store.get<unknown>(STORE_KEY);
    if (raw !== undefined && raw !== null) return normalize(raw);

    const seeded = normalize([await store.get<unknown>(LEGACY_KEY)]);
    if (seeded.length === 0) return [];
    try {
      await store.delete(LEGACY_KEY);
      await store.save();
    } catch {
      // 删不掉不影响本次读取：种子已经算好，且 recentFiles 一旦落盘（哪怕落的是 []）
      // 迁移分支就不会再进——上面的 absent/empty 之分已经堵住了复活
    }
    return seeded;
  } catch {
    return [];
  }
}

/** 成功打开一篇文档后置顶（去重、上限 8），返回新列表 */
export async function addRecent(path: string): Promise<string[]> {
  const next = normalize([path, ...(await loadRecentFiles())]);
  await persist(next);
  return next;
}

/** 从列表里摘掉一条（打开失败时调用），返回新列表；不在列表里则原样返回且不落盘 */
export async function removeRecent(path: string): Promise<string[]> {
  const current = await loadRecentFiles();
  const next = current.filter((entry) => !isSamePath(entry, path));
  if (next.length === current.length) return current;
  await persist(next);
  return next;
}
