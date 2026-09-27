import { useEffect, useRef } from "react";
import type { AppRuntime } from "./useAppRuntime";

/// 一格滚轮要累计多少 deltaY 才算一档字号。Chromium 上一格标准鼠标滚轮是 100
/// （触控板则是每帧个位数的小 delta）——取 100 即「一格一档」，触控板靠累计。
export const WHEEL_STEP_THRESHOLD = 100;

/// 两次滚轮之间超过这么久就当作新手势：余量清零（松手再滚不该凑上一次的零头）
export const WHEEL_GESTURE_RESET_MS = 350;

/**
 * 滚轮累计 → 步数（纯函数，快捷键侧与测试用它）：
 * - 同向累计到阈值发一步，余量留到下一发（触控板的小 delta 靠累）；
 * - 反向立刻清零累计（改了主意，上一次的余量不该凑出一档）；
 * - 一次事件最多发一步：高分辨率滚轮或甩一下可能一次给出几百 deltaY，
 *   放它连跳三四档会让字号一路窜到底，手感反而失控。
 */
export function accumulateWheelStep(
  accumulated: number,
  deltaY: number
): { accumulated: number; steps: number } {
  const direction = deltaY > 0 ? 1 : deltaY < 0 ? -1 : 0;
  let next = accumulated;
  if (direction !== 0 && next !== 0 && Math.sign(next) !== direction) next = 0;
  next += deltaY;
  if (Math.abs(next) >= WHEEL_STEP_THRESHOLD) {
    return { accumulated: 0, steps: Math.sign(next) };
  }
  return { accumulated: next, steps: 0 };
}

export type WheelFontSizeDeps = {
  /// 「Ctrl + 滚轮改字号」（设置「阅读」节，出厂开）：关掉时本 hook 不挂监听，
  /// Ctrl+滚轮完全让给 WebView 自己（与出厂前的行为一致）
  enabled: boolean;
  /// 步进入口（App 侧收口在 usePinnedLayoutActions.stepReaderFontSize：
  /// 先钉视口再改字号，与 Ctrl+= / Ctrl+- 同一条路）
  stepFontSize: (direction: 1 | -1) => void;
};

/**
 * Ctrl + 滚轮改正文字号。
 *
 * 挂在 window 的**捕获**阶段、passive: false：
 * - 捕获：压在滚动容器与自定义滚动条之前，不会被别处的 wheel 处理器抢掉；
 * - 非被动：要 preventDefault —— 不吞掉这一下，WebView2 会在正文缩放之外
 *   再叠一层整页缩放（与 Ctrl+= / Ctrl+- 必须吞键同理）。
 *
 * 导出视图打开时**只吞不改**：预览分页已按当前字号排好，改字号会让预览与底稿
 * 失同步（与快捷键那条完全同规矩）。设置视图里照常生效——样张实时跟着变。
 */
export function useWheelFontSize(rt: AppRuntime, deps: WheelFontSizeDeps): void {
  const { isExportOpenRef } = rt.views;
  const enabled = deps.enabled;
  /// 步进回调随字号换代（useCallback 依赖了当前字号）：经 ref 读最新一份，
  /// 不为每次字号变化重挂 window 监听
  const stepRef = useRef(deps.stepFontSize);
  stepRef.current = deps.stepFontSize;

  useEffect(() => {
    if (!enabled) return;
    let accumulated = 0;
    let lastWheelAt = 0;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (isExportOpenRef.current) return;

      const now = performance.now();
      if (now - lastWheelAt > WHEEL_GESTURE_RESET_MS) accumulated = 0;
      lastWheelAt = now;

      const next = accumulateWheelStep(accumulated, event.deltaY);
      accumulated = next.accumulated;
      // 向下滚 = 缩小（与浏览器 Ctrl+滚轮的方向一致）
      if (next.steps !== 0) stepRef.current(next.steps > 0 ? -1 : 1);
    };

    const options = { passive: false, capture: true } as const;
    window.addEventListener("wheel", handleWheel, options);
    return () => window.removeEventListener("wheel", handleWheel, { capture: true });
  }, [enabled, isExportOpenRef]);
}
