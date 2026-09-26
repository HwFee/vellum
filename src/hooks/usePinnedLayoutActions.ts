import { useCallback, useEffect, useRef, useState } from "react";
import { loadAppPreferences } from "../lib/appPreferences";
import { stepFontSize, type ReaderSettings } from "./useReaderSettings";

export type PinnedLayoutActions = {
  /// 侧栏开合的唯一入口（顶栏按钮 / Ctrl+B / 窄屏 Escape 与遮罩 / 窄屏选章都经它）
  toggleOutlinePinned: () => void;
  setOutlineOpenPinned: (open: boolean) => void;
  /// 阅读设置改值入口（与拖宽同属「整篇重排」，先钉视口）
  handleReaderSettingsChange: (patch: Partial<ReaderSettings>) => void;
  /// Ctrl+= / Ctrl+- 步进、Ctrl+0 复位正文字号（与分段选择器同一条钉视口路径）
  stepReaderFontSize: (direction: 1 | -1 | 0) => void;
  /// 侧栏右缘拖宽手柄的 pointerdown（JSX 直接用）
  handleSidebarResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  isSidebarResizing: boolean;
};

export type PinnedLayoutDeps = {
  /// useOutlineOpen 的三元组（原 App.tsx 直传）
  toggleOutline: () => void;
  setIsOutlineOpen: (open: boolean) => void;
  isOutlineOpen: boolean;
  isNarrow: boolean;
  outlineWidth: number;
  setOutlineWidth: (width: number) => void;
  setReaderSettings: (patch: Partial<ReaderSettings>) => void;
  /// 当前正文字号：Ctrl+= / - / 0 步进的基准值
  readerFontSize: number;
  /// 布局过渡窗钩子（useLayoutShift 的稳定回调）
  beginWidthTransition: () => void;
  noteLayoutShift: (windowMs?: number) => void;
  /// 窄屏 Escape 的互斥守卫：设置/导出视图打开时 Escape 归它们
  isSettingsOpen: boolean;
  isExportOpen: boolean;
};

/**
 * 「先钉视口再改布局」的全部入口（红线 8 的结构化收口）：侧栏开关、拖宽、
 * 阅读设置改值、启动展开侧栏、窄屏 Escape——原 App.tsx 的
 * toggleOutlinePinned / setOutlineOpenPinned / handleReaderSettingsChange /
 * handleSidebarResizeStart + isSidebarResizing + outlineWidthRef / 两个 effect。
 * 本 hook 不读 rt：全部跨域入口都是「先钉视口再改值」的纯动作，共享态经 deps 传入。
 */
export function usePinnedLayoutActions(deps: PinnedLayoutDeps): PinnedLayoutActions {
  const {
    toggleOutline,
    setIsOutlineOpen,
    isOutlineOpen,
    isNarrow,
    outlineWidth,
    setOutlineWidth,
    setReaderSettings,
    readerFontSize,
    beginWidthTransition,
    noteLayoutShift,
    isSettingsOpen,
    isExportOpen,
  } = deps;

  const outlineWidthRef = useRef(outlineWidth);
  outlineWidthRef.current = outlineWidth;
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);

  // 侧栏开关的全部入口（顶栏按钮 / Ctrl+K / 窄屏 Escape 与遮罩 / 窄屏选章）
  // 统一先走 beginWidthTransition：漏掉任何一处，该路径上的宽度回流就会闪。
  const toggleOutlinePinned = useCallback(() => {
    beginWidthTransition();
    toggleOutline();
  }, [beginWidthTransition, toggleOutline]);

  const setOutlineOpenPinned = useCallback(
    (open: boolean) => {
      beginWidthTransition();
      setIsOutlineOpen(open);
    },
    [beginWidthTransition, setIsOutlineOpen]
  );

  // 阅读设置（字号 / 栏宽 / 行高）与侧栏拖宽同属「整篇重排」：改值前先钉住视口
  const handleReaderSettingsChange = useCallback(
    (patch: Partial<ReaderSettings>) => {
      beginWidthTransition();
      setReaderSettings(patch);
    },
    [beginWidthTransition, setReaderSettings]
  );

  // 快捷键字号步进：与分段选择器同一条「先钉视口」路径（字号改动同样是整篇重排）。
  // 端点夹取后无实际变化时不触发钉视口——按下依旧吞键，但布局侧是空转
  const stepReaderFontSize = useCallback(
    (direction: 1 | -1 | 0) => {
      const next = stepFontSize(readerFontSize, direction);
      if (next !== readerFontSize) handleReaderSettingsChange({ fontSize: next });
    },
    [readerFontSize, handleReaderSettingsChange]
  );

  // 「启动时展开侧栏」（设置页「界面」节，出厂关）：偏好是异步读盘的，故启动时单独读一次
  // ——读到开就展开。这是一次性的**启动**行为：此后用户在设置页里改这个开关不该当场开合
  // 侧栏（开合只由顶栏按钮 / Ctrl+B 决定）。走 setOutlineOpenPinned 与其它入口同一条
  // 宽度过渡路径（红线：侧栏开关的任何入口都要经 beginWidthTransition）。
  useEffect(() => {
    let cancelled = false;
    void loadAppPreferences().then((loaded) => {
      if (!cancelled && loaded.sidebarOpenOnLaunch) setOutlineOpenPinned(true);
    });
    return () => {
      cancelled = true;
    };
  }, [setOutlineOpenPinned]);

  // 窄屏下按 Escape 关闭大纲面板。设置视图打开时 Escape 归设置视图（退出设置），
  // 不在这里连带关侧栏——一次按键关两层是弹层时代就刻意避免的观感。
  // isSettingsOpen 必须进依赖表：只写在守卫里的话，effect 不随设置视图开合重跑，
  // 陈旧监听闭包里的它永远是 false（先开侧栏、后开设置视图就正好命中这条），
  // 于是窄屏下一次 Escape 会把设置视图与侧栏一起关掉
  useEffect(() => {
    if (!isNarrow || !isOutlineOpen || isSettingsOpen || isExportOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOutlineOpenPinned(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isNarrow, isOutlineOpen, isSettingsOpen, isExportOpen, setOutlineOpenPinned]);

  // 侧边栏拖宽：右缘手柄按下后全局跟踪指针，即时覆写宽度并持续续布局过渡窗；
  // 拖拽期间正文 margin 与 widget 高度过渡均关闭（app-shell--sidebar-resizing），
  // 避免 margin 动画滞后于指针、iframe 过渡级联重排
  const handleSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = outlineWidthRef.current;
    setIsSidebarResizing(true);
    // 拖宽与开关同源（都改正文宽度 ⇒ 行重排），同样钉住视口
    beginWidthTransition();

    const onMove = (moveEvent: PointerEvent) => {
      setOutlineWidth(startWidth + (moveEvent.clientX - startX));
      noteLayoutShift(300);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setIsSidebarResizing(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  return {
    toggleOutlinePinned,
    setOutlineOpenPinned,
    handleReaderSettingsChange,
    stepReaderFontSize,
    handleSidebarResizeStart,
    isSidebarResizing,
  };
}
