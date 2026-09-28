import { useCallback, useState } from "react";
import {
  addRecentLibrary,
  loadRecentLibraries,
  removeRecentLibrary,
  type RecentLibrary,
} from "../lib/recentLibraries";

export type RecentLibraries = {
  /// 最近打开的库（新→旧）：只驱动开始页的「最近库」分组
  recentLibraries: RecentLibrary[];
  /// 打开管线在 ready 提交后调用：库根置顶（文件路径进的是 recentFiles，这里只收库）
  addRecentLibraryTop: (entry: RecentLibrary) => void;
  /// 库根被搬走/打不开时摘掉条目（remove 对不在列表里的路径是 no-op，不落盘）
  removeRecentLibraryTop: (path: string) => void;
  /// 读盘并写入列表状态（启动时与「打开库」后共用）
  loadLibraries: () => Promise<RecentLibrary[]>;
};

/// 最近库列表（与 useRecentFiles 同一套收口：state 是渲染源，Store 是持久层）。
export function useRecentLibraries(): RecentLibraries {
  const [recentLibraries, setRecentLibraries] = useState<RecentLibrary[]>([]);

  const addRecentLibraryTop = useCallback((entry: RecentLibrary) => {
    void addRecentLibrary(entry).then(setRecentLibraries);
  }, []);

  const removeRecentLibraryTop = useCallback((path: string) => {
    void removeRecentLibrary(path).then(setRecentLibraries);
  }, []);

  const loadLibraries = useCallback(async () => {
    const libraries = await loadRecentLibraries();
    if (libraries.length > 0) {
      setRecentLibraries(libraries);
    }
    return libraries;
  }, []);

  return { recentLibraries, addRecentLibraryTop, removeRecentLibraryTop, loadLibraries };
}
