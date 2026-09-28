import { isSamePath } from "./path";
import { getSettingsStore } from "./settings";

const STORE_KEY = "recentLibraries";

export const RECENT_LIBRARIES_LIMIT = 8;

/**
 * 最近打开的库条目：`path` 是库根（显式打开的文件夹或命中标记的祖先），
 * `name` 供开始页直接显示（库根目录名；存下来免得空态为了标题再 IPC 一次）。
 */
export type RecentLibrary = {
  path: string;
  name: string;
};

/**
 * 归一化：只留「path 为非空字符串」的条目，按 isSamePath 去重
 * （与 recentFiles 同款判据——`D:\lib` 与 `d:/lib/` 是同一条），超过上限即截断。
 * 老版本/损坏数据的 `name` 缺省为 path 末段，读取不炸。
 */
function normalize(entries: unknown): RecentLibrary[] {
  if (!Array.isArray(entries)) return [];
  const result: RecentLibrary[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path !== "string" || path.trim() === "") continue;
    if (result.some((kept) => isSamePath(kept.path, path))) continue;
    const name = (entry as { name?: unknown }).name;
    const fallback = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? path;
    result.push({
      path,
      name: typeof name === "string" && name.trim() !== "" ? name : fallback,
    });
    if (result.length >= RECENT_LIBRARIES_LIMIT) break;
  }
  return result;
}

async function persist(entries: RecentLibrary[]): Promise<void> {
  try {
    const store = await getSettingsStore();
    await store.set(STORE_KEY, entries);
    await store.save();
  } catch {
    // 持久化失败不影响正常使用
  }
}

/** 读取最近库列表（新打开的在前）。读失败回空表——开始页的「最近库」分组直接不渲染。 */
export async function loadRecentLibraries(): Promise<RecentLibrary[]> {
  try {
    const store = await getSettingsStore();
    const raw = await store.get<unknown>(STORE_KEY);
    return normalize(raw);
  } catch {
    return [];
  }
}

/** 成功打开一个库后置顶（按 path 去重、上限 8），返回新列表 */
export async function addRecentLibrary(entry: RecentLibrary): Promise<RecentLibrary[]> {
  const next = normalize([entry, ...(await loadRecentLibraries())]);
  await persist(next);
  return next;
}

/** 从列表里摘掉一条（库根被搬走/打开失败时调用），返回新列表 */
export async function removeRecentLibrary(path: string): Promise<RecentLibrary[]> {
  const current = await loadRecentLibraries();
  const next = current.filter((entry) => !isSamePath(entry.path, path));
  if (next.length === current.length) return current;
  await persist(next);
  return next;
}
