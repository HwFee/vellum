import { useCallback } from "react";
import { isSamePath } from "../lib/path";
import { captureScrollPosition } from "../lib/scrollRestore";
import { saveScrollPosition, type ScrollPositionRecord } from "../lib/scrollMemory";
import type { AppRuntime } from "./useAppRuntime";

export type ScrollPosition = {
  /** 当前阅读位置的三级记录（无滚动容器时返回 null——此时没有位置可言） */
  currentScrollRecord: () => ScrollPositionRecord | null;
  /** 把当前滚动位置（锚点 + 偏移 + 比例兜底）写入持久化存储 */
  persistCurrentScroll: () => void;
};

/// 阅读位置的测量与落盘（原 App.tsx 的 currentScrollRecord / persistCurrentScroll）。
export function useScrollPosition(rt: AppRuntime): ScrollPosition {
  const { currentPathRef, headingsRef } = rt.doc;
  const { scrollRef, contentRef } = rt.dom;
  const { settingsScrollRecordRef, isSettingsOpenRef } = rt.views;

  /** 当前阅读位置的三级记录（无滚动容器时返回 null——此时没有位置可言）。
      设置视图期间正文不在 DOM 里、容器里滚的是设置内容，此刻量到的是设置页的偏移，
      故一律返回进入设置视图时取下的那一份（滚动保存 / 换文档 / 后退前进都用它）。 */
  const currentScrollRecord = useCallback((): ScrollPositionRecord | null => {
    const stashed = settingsScrollRecordRef.current;
    const currentPath = currentPathRef.current;
    if (stashed && currentPath !== null && isSamePath(stashed.path, currentPath)) {
      return stashed.record;
    }
    const container = scrollRef.current;
    if (!container) return null;
    return captureScrollPosition(container, headingsRef.current, contentRef.current ?? undefined);
  }, [settingsScrollRecordRef, currentPathRef, scrollRef, headingsRef, contentRef]);

  /** 把当前滚动位置（锚点 + 偏移 + 比例兜底）写入持久化存储 */
  const persistCurrentScroll = useCallback(() => {
    const path = currentPathRef.current;
    if (!path) return;
    // 设置视图期间正文不在 DOM 里、位置没有变化（进入时已落过一次盘）：
    // 容器里滚的是设置内容，此刻再写只是同一份记录反复落盘
    if (isSettingsOpenRef.current) return;
    const record = currentScrollRecord();
    if (!record) return;
    void saveScrollPosition(path, record);
  }, [currentPathRef, isSettingsOpenRef, currentScrollRecord]);

  return { currentScrollRecord, persistCurrentScroll };
}
