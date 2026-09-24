import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { startViewportPin } from "../lib/viewportPin";
import type { ReaderSettings } from "./useReaderSettings";
import type { AppRuntime } from "./useAppRuntime";

export type LayoutShift = {
  isLayoutShifting: boolean;
  /** 进入/延长布局过渡窗；windowMs 后自动退出（连续调用续窗） */
  noteLayoutShift: (windowMs?: number) => void;
  /** 进入一次宽度过渡：开布局过渡窗 + 捕获视口锚点逐帧钉住。
      必须在**改宽度的事件处理器里、状态更新之前**调用。 */
  beginWidthTransition: () => void;
};

/**
 * 布局过渡窗 + 宽度过渡期视口钉住（原 App.tsx 的 noteLayoutShift /
 * beginWidthTransition / applyNow 补偿帧 / 卸载清理）。
 */
export function useLayoutShift(
  rt: AppRuntime,
  deps: {
    /// 触发 applyNow 补偿帧的渲染值（侧栏开合 / 宽度 / 阅读设置）
    isOutlineOpen: boolean;
    outlineWidth: number;
    readerSettings: ReaderSettings;
  }
): LayoutShift {
  const { scrollRef, contentRef } = rt.dom;
  const { layoutShiftUntilRef, layoutShiftTimerRef, viewportPinRef } = rt.layout;
  const { lastUserScrollAtRef } = rt.scroll;
  const { restoreCancelRef } = rt.scroll;
  const [isLayoutShifting, setIsLayoutShifting] = useState(false);

  /** 进入/延长布局过渡窗；windowMs 后自动退出（连续调用续窗） */
  const noteLayoutShift = useCallback(
    (windowMs = 450) => {
      const until = performance.now() + windowMs;
      if (until > layoutShiftUntilRef.current) {
        layoutShiftUntilRef.current = until;
      }
      setIsLayoutShifting(true);
      if (layoutShiftTimerRef.current !== null) {
        clearTimeout(layoutShiftTimerRef.current);
      }
      layoutShiftTimerRef.current = setTimeout(() => {
        layoutShiftTimerRef.current = null;
        setIsLayoutShifting(false);
      }, layoutShiftUntilRef.current - performance.now());
    },
    [layoutShiftUntilRef, layoutShiftTimerRef]
  );

  // 组件卸载时注销尚未完成的落位守护与视口钉住
  useEffect(
    () => () => {
      restoreCancelRef.current?.();
      viewportPinRef.current?.stop();
    },
    [restoreCancelRef, viewportPinRef]
  );

  /**
   * 进入一次宽度过渡：开布局过渡窗（窗内热重载延迟合并提交、widget 高度过渡关停），
   * 并捕获视口锚点、在窗内逐帧把内容钉回原位。
   *
   * 必须在**改宽度的事件处理器里、状态更新之前**调用：此刻 DOM 还是旧布局，
   * 捕获到的锚点偏移才是「读者当前看到的位置」。窗长 450ms（默认值）覆盖侧栏
   * 250ms 的 margin 过渡；拖宽时每次 pointermove 续窗，钉住随指针持续有效。
   */
  const beginWidthTransition = useCallback(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    noteLayoutShift();
    viewportPinRef.current?.stop();
    viewportPinRef.current = startViewportPin(container, content, {
      until: () => layoutShiftUntilRef.current,
      lastUserScrollAt: () => lastUserScrollAtRef.current,
    });
  }, [scrollRef, contentRef, noteLayoutShift, viewportPinRef, layoutShiftUntilRef, lastUserScrollAtRef]);

  // 绘制前同步补偿第一帧：事件入口捕获的是旧布局，此处 DOM 已带上新类名/新宽度，
  // 同步读 rect 会按新布局求值，从而在首帧就把视口内容钉回原位（否则每帧都可能闪）
  useLayoutEffect(() => {
    viewportPinRef.current?.applyNow();
  }, [deps.isOutlineOpen, deps.outlineWidth, deps.readerSettings, viewportPinRef]);

  return { isLayoutShifting, noteLayoutShift, beginWidthTransition };
}
