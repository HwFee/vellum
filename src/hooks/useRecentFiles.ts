import { useCallback, useState } from "react";
import { addRecent, clearRecentFiles, loadRecentFiles, removeRecent } from "../lib/recentFiles";

export type RecentFiles = {
  /// 最近打开列表（新→旧）：空态列表与「启动恢复上一篇」共用同一份状态
  recentFiles: string[];
  /// 「成功打开」的单一收口：最近打开列表在此置顶（列表状态与持久化同步更新）
  addRecentTop: (path: string) => void;
  /// 打不开的条目留在「最近打开」里没有意义：摘掉它，列表不残留死条目。
  /// removeRecent 对不在列表里的路径是 no-op（不落盘）
  removeRecentTop: (path: string) => void;
  /// 清空最近打开列表（设置页「关于与数据」）：显式落盘空数组，旧 key 迁移不会再播种
  clearRecent: () => void;
  /// 读盘并（非空时）写入列表状态，返回读到的那份（启动恢复用）
  loadRecent: () => Promise<string[]>;
};

/// 最近打开列表（原 App.tsx 里散落的 recentFiles 读写点收口）。
export function useRecentFiles(): RecentFiles {
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  const addRecentTop = useCallback((path: string) => {
    void addRecent(path).then(setRecentFiles);
  }, []);

  const removeRecentTop = useCallback((path: string) => {
    void removeRecent(path).then(setRecentFiles);
  }, []);

  const clearRecent = useCallback(() => {
    void clearRecentFiles().then(setRecentFiles);
  }, []);

  const loadRecent = useCallback(async () => {
    const recents = await loadRecentFiles();
    // 空列表不写 state——初值就是空数组，省掉一次无谓的重渲染
    if (recents.length > 0) {
      setRecentFiles(recents);
    }
    return recents;
  }, []);

  return { recentFiles, addRecentTop, removeRecentTop, clearRecent, loadRecent };
}
