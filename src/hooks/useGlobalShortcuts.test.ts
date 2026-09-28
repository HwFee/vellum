import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";
import { useAppRuntime } from "./useAppRuntime";
import { useGlobalShortcuts, type GlobalShortcutDeps } from "./useGlobalShortcuts";

function makeDeps(overrides: Partial<GlobalShortcutDeps> = {}): GlobalShortcutDeps {
  return {
    isOutlineOpen: false,
    setOutlineOpenPinned: vi.fn(),
    toggleOutlinePinned: vi.fn(),
    handleNavBack: vi.fn(),
    handleNavForward: vi.fn(),
    toggleExport: vi.fn(),
    handleOpen: vi.fn(),
    stepReaderFontSize: vi.fn(),
    handleNextMatch: vi.fn(),
    handlePrevMatch: vi.fn(),
    toggleFocusMode: vi.fn(),
    setSidebarTab: vi.fn(),
    // 测试默认站在库模式一侧（Ctrl+Shift+F 的既有用例都预设它在）；单文件模式的
    // 「吞键不动作」另有专门用例显式传 { current: false }
    isLibraryModeRef: { current: true },
    librarySearchInputRef: { current: null },
    ...overrides,
  };
}

function setup(deps: GlobalShortcutDeps) {
  return renderHook(() => {
    const rt = useAppRuntime();
    useGlobalShortcuts(rt, deps);
    return rt;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGlobalShortcuts · Ctrl+Shift+F 全库检索", () => {
  it("开侧栏、切「檢索」页签，60ms 后聚焦库检索框", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const focusSpy = vi.spyOn(input, "focus");
    const deps = makeDeps({ librarySearchInputRef: { current: input } });
    setup(deps);

    // 吞键（false = preventDefault 已调）：它是 WebView 的整页搜索加速键，不能让渡
    expect(fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true })).toBe(false);
    // 侧栏未开 → 先钉视口开侧栏
    expect(deps.setOutlineOpenPinned).toHaveBeenCalledWith(true);
    expect(deps.setSidebarTab).toHaveBeenCalledWith("search");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(focusSpy).toHaveBeenCalled();
    input.remove();
  });

  it("侧栏已开：不再发 setOutlineOpenPinned（只切页签聚焦）", () => {
    const deps = makeDeps({ isOutlineOpen: true });
    setup(deps);

    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    expect(deps.setOutlineOpenPinned).not.toHaveBeenCalled();
    expect(deps.setSidebarTab).toHaveBeenCalledWith("search");
  });

  it("设置视图打开时静默忽略：键仍吞掉，不切页签", () => {
    const deps = makeDeps();
    const { result } = setup(deps);
    result.current.views.isSettingsOpenRef.current = true;

    expect(fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true })).toBe(false);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(deps.setSidebarTab).not.toHaveBeenCalled();
    expect(deps.setOutlineOpenPinned).not.toHaveBeenCalled();
  });

  it("单文件模式：吞键不动作（不开侧栏、不切页签、不聚焦）", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const focusSpy = vi.spyOn(input, "focus");
    const deps = makeDeps({
      isLibraryModeRef: { current: false },
      librarySearchInputRef: { current: input },
    });
    setup(deps);

    // 键仍被吞掉（false = preventDefault 已调）——它是 WebView 的整页搜索加速键，
    // 不让渡；但库三命令在非库模式下被 Rust 拒答，打开了也只是空面板，故不做任何动作
    expect(fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true })).toBe(false);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(deps.setSidebarTab).not.toHaveBeenCalled();
    expect(deps.setOutlineOpenPinned).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
    input.remove();
  });
});
