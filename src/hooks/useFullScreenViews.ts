import { useCallback, useState } from "react";
import { buildExportDocument, type ExportDocument } from "../lib/exportDocument";
import { saveScrollPosition, type ScrollPositionRecord } from "../lib/scrollMemory";
import type { SettingsSectionId } from "../components/SettingsView";
import type { AppRuntime } from "./useAppRuntime";

export type FullScreenViews = {
  isSettingsOpen: boolean;
  settingsSectionId: SettingsSectionId;
  setSettingsSectionId: (id: SettingsSectionId) => void;
  exportDoc: ExportDocument | null;
  isExportOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  handleToggleSettings: () => void;
  openExport: () => void;
  closeExport: () => void;
  toggleExport: () => void;
};

/**
 * 整页视图（设置 / 导出为 PDF）开合与阅读位置交接
 * （原 App.tsx「===== 设置视图 =====」「===== 导出为 PDF =====」两节）。
 * 两视图同一动线：正文区整块替换、进入时暂存阅读位置、Esc / 「‹ 返回阅读」退出。
 */
export function useFullScreenViews(
  rt: AppRuntime,
  deps: { getScrollRecord: () => ScrollPositionRecord | null }
): FullScreenViews {
  const { currentPathRef } = rt.doc;
  const { scrollRef, documentContentRef } = rt.dom;
  const { pendingRestoreRef, lastRestoredPathRef } = rt.scroll;
  const { isSettingsOpenRef, isExportOpenRef, settingsScrollRecordRef } = rt.views;

  // 设置视图（2026-09-20：弹层退役，正文区整块换成设置页）。顶栏与侧栏容器都不变——
  // 同一枚侧栏内容随视图换，开合状态与阅读视图共享同一份
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  isSettingsOpenRef.current = isSettingsOpen;
  // 侧栏设置导航的激活分节（点条目即切激活态并缓动滚过去）
  const [settingsSectionId, setSettingsSectionId] = useState<SettingsSectionId>("reading");

  // 导出为 PDF 视图（2026-09-21：Ctrl+P 改绑到这里，系统打印对话框退役）。
  // 与设置视图同一动线：正文区整块替换、进入时暂存阅读位置、Esc / 「‹ 返回阅读」退出。
  // 底稿（消毒后的正文 HTML）在进入时从阅读 DOM 取定，预览 / 测量 / 打印共用同一份
  const [exportDoc, setExportDoc] = useState<ExportDocument | null>(null);
  const isExportOpen = exportDoc !== null;
  isExportOpenRef.current = isExportOpen;

  const { getScrollRecord } = deps;

  // ===== 设置视图（正文区整块替换） =====
  // 进入：正文（含 widget iframe）整块退出 DOM，先把阅读位置取下来——退出时按既有落位
  // 管线放回去。getScrollRecord 只读 ref，故空依赖捕获与最新一份等价
  /** 进入整页视图（设置 / 导出）前的同一套暂存：取下阅读位置、落盘、共用容器归零 */
  const stashReadingPosition = useCallback(() => {
    const path = currentPathRef.current;
    const record = getScrollRecord();
    if (path && record) {
      settingsScrollRecordRef.current = { path, record };
      // 与「后退/前进」同一条落位管线：正文回来时由 handleContentRendered 消费这份记录
      pendingRestoreRef.current = { path, record };
      // 位置即刻落盘：进入设置视图后容器里滚的是设置内容，正文位置不会再被保存
      void saveScrollPosition(path, record);
    }
    // 正文即将退出 DOM：复位「已恢复」标记，回来时 handleContentRendered 才会走恢复
    lastRestoredPathRef.current = null;
    // 共用滚动容器归零（必须在上面取位置**之后**）：容器里的内容要换成设置页，
    // 不归零的话浏览器会把旧 scrollTop 钳到设置页的最大值——从长文档中部进来就会落在
    // 设置页的中段/底部，而不是顶部那一节。用直接赋值而非缓动：内容整块换了，
    // 缓动看起来只会像设置页自己滑一段。退出时的回位走 pendingRestoreRef 那条管线，
    // 与本行无关（handleContentRendered 会先归零再按记录落位）
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    // 注意：不在这里 setIsSettingsOpen——stash 是「进入设置 / 导出」两条动线的共用
    // 前半程，开哪个视图由各自动线自己决定（导出视图不复用设置的分节导航）
  }, [currentPathRef, getScrollRecord, settingsScrollRecordRef, pendingRestoreRef, lastRestoredPathRef, scrollRef]);

  const openSettings = useCallback(() => {
    stashReadingPosition();
    setSettingsSectionId("reading");
    setIsSettingsOpen(true);
  }, [stashReadingPosition]);

  const closeSettings = useCallback(() => {
    settingsScrollRecordRef.current = null;
    setIsSettingsOpen(false);
  }, [settingsScrollRecordRef]);

  const handleToggleSettings = useCallback(() => {
    if (isSettingsOpenRef.current) {
      closeSettings();
      return;
    }
    // 两个整页视图互斥：导出视图开着时不进设置（先「‹ 返回阅读」退回导出前的位置）
    if (isExportOpenRef.current) return;
    openSettings();
  }, [isSettingsOpenRef, isExportOpenRef, closeSettings, openSettings]);

  // ===== 导出为 PDF（纸张舞台） =====
  // 底稿从阅读 DOM 取（预览 / 测量 / 打印共用同一份消毒 HTML），故只能从阅读视图进入：
  // 设置视图期间正文不在 DOM 里，没有可取的（顶栏按钮此时禁用，Ctrl+P 同守）
  const openExport = useCallback(() => {
    if (isSettingsOpenRef.current || isExportOpenRef.current) return;
    const root = documentContentRef.current;
    if (!root || !root.querySelector(".markdown-body")) return;
    const doc = buildExportDocument(root);
    stashReadingPosition();
    setExportDoc(doc);
  }, [isSettingsOpenRef, isExportOpenRef, documentContentRef, stashReadingPosition]);

  const closeExport = useCallback(() => {
    settingsScrollRecordRef.current = null;
    setExportDoc(null);
  }, [settingsScrollRecordRef]);

  const toggleExport = useCallback(() => {
    if (isExportOpenRef.current) {
      closeExport();
      return;
    }
    openExport();
  }, [isExportOpenRef, closeExport, openExport]);

  return {
    isSettingsOpen,
    settingsSectionId,
    setSettingsSectionId,
    exportDoc,
    isExportOpen,
    openSettings,
    closeSettings,
    handleToggleSettings,
    openExport,
    closeExport,
    toggleExport,
  };
}
