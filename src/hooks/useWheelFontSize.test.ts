import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  accumulateWheelStep,
  useWheelFontSize,
  WHEEL_STEP_THRESHOLD,
} from "./useWheelFontSize";
import type { AppRuntime } from "./useAppRuntime";

/// 只喂 hook 真正会读的两处：导出视图的 ref（只吞不改的守卫）
function fakeRuntime(isExportOpen = false) {
  return {
    views: { isExportOpenRef: { current: isExportOpen } },
  } as unknown as AppRuntime;
}

function wheel(deltaY: number, init: WheelEventInit = {}) {
  const event = new WheelEvent("wheel", {
    deltaY,
    ctrlKey: true,
    cancelable: true,
    bubbles: true,
    ...init,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("accumulateWheelStep 滚轮累计", () => {
  it("不足一档不发步，余量留到下一发（触控板的小 delta 靠累计）", () => {
    const first = accumulateWheelStep(0, WHEEL_STEP_THRESHOLD - 1);
    expect(first.steps).toBe(0);
    expect(first.accumulated).toBe(WHEEL_STEP_THRESHOLD - 1);

    const second = accumulateWheelStep(first.accumulated, 1);
    expect(second.steps).toBe(1);
    expect(second.accumulated).toBe(0);
  });

  it("向下滚为正、向上滚为负；反向立刻清零累计", () => {
    expect(accumulateWheelStep(0, WHEEL_STEP_THRESHOLD).steps).toBe(1);
    expect(accumulateWheelStep(0, -WHEEL_STEP_THRESHOLD).steps).toBe(-1);

    // 反向：上一次攒的余量不该凑出一档
    const flipped = accumulateWheelStep(WHEEL_STEP_THRESHOLD - 1, -1);
    expect(flipped.steps).toBe(0);
    expect(flipped.accumulated).toBe(-1);
  });

  it("一次事件最多发一步：甩一下不该连跳三四档", () => {
    const fast = accumulateWheelStep(0, WHEEL_STEP_THRESHOLD * 4);
    expect(fast.steps).toBe(1);
    expect(fast.accumulated).toBe(0);
  });

  it("deltaY 为 0 不发步也不清零", () => {
    expect(accumulateWheelStep(40, 0)).toEqual({ accumulated: 40, steps: 0 });
  });
});

describe("useWheelFontSize Ctrl + 滚轮", () => {
  it("Ctrl + 滚轮向下 = 缩小、向上 = 放大，并吞掉事件（不让 WebView 叠一层整页缩放）", () => {
    const stepFontSize = vi.fn();
    renderHook(() =>
      useWheelFontSize(fakeRuntime(), { enabled: true, stepFontSize })
    );

    const down = wheel(WHEEL_STEP_THRESHOLD);
    expect(stepFontSize).toHaveBeenCalledWith(-1);
    expect(down.defaultPrevented).toBe(true);

    const up = wheel(-WHEEL_STEP_THRESHOLD);
    expect(stepFontSize).toHaveBeenLastCalledWith(1);
    expect(up.defaultPrevented).toBe(true);
    expect(stepFontSize).toHaveBeenCalledTimes(2);
  });

  it("没按 Ctrl 的普通滚轮一概不碰（照常滚动）", () => {
    const stepFontSize = vi.fn();
    renderHook(() =>
      useWheelFontSize(fakeRuntime(), { enabled: true, stepFontSize })
    );

    const plain = wheel(WHEEL_STEP_THRESHOLD, { ctrlKey: false });
    expect(stepFontSize).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);
  });

  it("开关关掉时连监听都不挂：Ctrl+滚轮完全让给 WebView", () => {
    const stepFontSize = vi.fn();
    renderHook(() =>
      useWheelFontSize(fakeRuntime(), { enabled: false, stepFontSize })
    );

    const event = wheel(WHEEL_STEP_THRESHOLD);
    expect(stepFontSize).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("导出视图打开时只吞不改（预览分页已按当前字号排好）", () => {
    const stepFontSize = vi.fn();
    renderHook(() =>
      useWheelFontSize(fakeRuntime(true), { enabled: true, stepFontSize })
    );

    const event = wheel(WHEEL_STEP_THRESHOLD);
    expect(stepFontSize).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("停下超过手势重置窗后再滚，不带走上一次的余量", () => {
    const stepFontSize = vi.fn();
    const nowSpy = vi.spyOn(performance, "now");
    nowSpy.mockReturnValue(1000);
    renderHook(() =>
      useWheelFontSize(fakeRuntime(), { enabled: true, stepFontSize })
    );

    // 第一次攒下 60（不足一档），停 1 秒后只剩 60 也不该发步
    wheel(60);
    expect(stepFontSize).not.toHaveBeenCalled();

    nowSpy.mockReturnValue(5000);
    wheel(40);
    expect(stepFontSize).not.toHaveBeenCalled();

    // 连续再滚一次（同一手势内）才凑够一档
    nowSpy.mockReturnValue(5100);
    wheel(60);
    expect(stepFontSize).toHaveBeenCalledWith(-1);
  });

  it("卸载后摘掉监听", () => {
    const stepFontSize = vi.fn();
    const { unmount } = renderHook(() =>
      useWheelFontSize(fakeRuntime(), { enabled: true, stepFontSize })
    );
    unmount();

    wheel(WHEEL_STEP_THRESHOLD);
    expect(stepFontSize).not.toHaveBeenCalled();
  });
});
