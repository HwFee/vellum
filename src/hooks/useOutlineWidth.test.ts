import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Store } from "@tauri-apps/plugin-store";
import {
  useOutlineWidth,
  OUTLINE_WIDTH_DEFAULT,
  OUTLINE_WIDTH_MIN,
  OUTLINE_WIDTH_MAX,
} from "./useOutlineWidth";
import { __resetSettingsStoreForTest } from "../lib/settings";

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockSave = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => (({
      get: mockGet,
      set: mockSet,
      save: mockSave,
    }) as unknown as Store)),
  },
}));

describe("useOutlineWidth", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockSave.mockReset();
    __resetSettingsStoreForTest();
    vi.mocked(Store.load).mockImplementation(async () => (({
      get: mockGet,
      set: mockSet,
      save: mockSave,
    }) as unknown as Store));
    document.documentElement.style.removeProperty("--outline-width");
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--outline-width");
  });

  it("默认 240px 并覆写根 --outline-width 变量", () => {
    const { result } = renderHook(() => useOutlineWidth());
    expect(result.current[0]).toBe(OUTLINE_WIDTH_DEFAULT);
    expect(
      document.documentElement.style.getPropertyValue("--outline-width")
    ).toBe(`${OUTLINE_WIDTH_DEFAULT}px`);
  });

  it("启动时恢复持久化宽度", async () => {
    mockGet.mockResolvedValue(280);
    const { result } = renderHook(() => useOutlineWidth());
    await waitFor(() => expect(result.current[0]).toBe(280));
    expect(document.documentElement.style.getPropertyValue("--outline-width")).toBe("280px");
  });

  it("持久化的非法/越界值被忽略或钳制", async () => {
    mockGet.mockResolvedValue("not-a-number");
    const { result, unmount } = renderHook(() => useOutlineWidth());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current[0]).toBe(OUTLINE_WIDTH_DEFAULT);
    unmount();

    mockGet.mockResolvedValue(9999);
    const { result: result2 } = renderHook(() => useOutlineWidth());
    await waitFor(() => expect(result2.current[0]).toBe(OUTLINE_WIDTH_MAX));
  });

  it("调节幅度钳制在 200–320", () => {
    const { result } = renderHook(() => useOutlineWidth());
    act(() => {
      result.current[1](5000);
    });
    expect(result.current[0]).toBe(OUTLINE_WIDTH_MAX);
    act(() => {
      result.current[1](10);
    });
    expect(result.current[0]).toBe(OUTLINE_WIDTH_MIN);
  });

  it("宽度变化防抖后持久化到 settings Store", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useOutlineWidth());
      act(() => {
        result.current[1](300);
        result.current[1](310); // 连续拖动只落盘最后一次
      });
      await act(async () => {
        vi.advanceTimersByTime(450);
      });
      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith("outlineWidth", 310);
      expect(mockSave).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Store 落盘失败只告警、不影响当前宽度", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      vi.mocked(Store.load).mockRejectedValue(new Error("store unavailable"));
      const { result } = renderHook(() => useOutlineWidth());
      act(() => {
        result.current[1](260);
      });
      await act(async () => {
        vi.advanceTimersByTime(450);
      });
      expect(result.current[0]).toBe(260);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("outlineWidth"),
        expect.anything()
      );
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it("卸载时移除 CSS 变量覆写", () => {
    const { result, unmount } = renderHook(() => useOutlineWidth());
    act(() => {
      result.current[1](300);
    });
    expect(document.documentElement.style.getPropertyValue("--outline-width")).toBe("300px");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--outline-width")).toBe("");
  });
});
