import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Store } from "@tauri-apps/plugin-store";
import {
  useReaderSettings,
  READER_SETTINGS_DEFAULT,
} from "./useReaderSettings";
import { __resetSettingsStoreForTest } from "../lib/settings";

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockSave = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () =>
      ({
        get: mockGet,
        set: mockSet,
        save: mockSave,
      }) as unknown as Store
    ),
  },
}));

const READER_VARS = ["--reader-font-size", "--reader-column-width", "--reader-line-height"];

function clearReaderVars() {
  for (const name of READER_VARS) {
    document.documentElement.style.removeProperty(name);
  }
}

describe("useReaderSettings", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockSave.mockReset();
    __resetSettingsStoreForTest();
    clearReaderVars();
  });

  afterEach(() => {
    clearReaderVars();
  });

  it("默认值并覆写根 CSS 变量", () => {
    const { result } = renderHook(() => useReaderSettings());
    expect(result.current[0]).toEqual(READER_SETTINGS_DEFAULT);
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--reader-font-size")).toBe("14px");
    expect(root.getPropertyValue("--reader-column-width")).toBe("800px");
    expect(root.getPropertyValue("--reader-line-height")).toBe("1.55");
  });

  it("启动时恢复持久化设置", async () => {
    mockGet.mockResolvedValue({ fontSize: 16, columnWidth: 960, lineHeight: 1.7 });
    const { result } = renderHook(() => useReaderSettings());
    await waitFor(() => expect(result.current[0]).toEqual({ fontSize: 16, columnWidth: 960, lineHeight: 1.7 }));
    expect(document.documentElement.style.getPropertyValue("--reader-font-size")).toBe("16px");
  });

  it("持久化的非法字段逐字段回退默认，合法字段保留", async () => {
    mockGet.mockResolvedValue({ fontSize: 99, columnWidth: 720, lineHeight: "loose" });
    const { result } = renderHook(() => useReaderSettings());
    await waitFor(() =>
      expect(result.current[0]).toEqual({ fontSize: 14, columnWidth: 720, lineHeight: 1.55 })
    );
  });

  it("读取失败/无记录时保持默认值", async () => {
    mockGet.mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useReaderSettings());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current[0]).toEqual(READER_SETTINGS_DEFAULT);
    unmount();

    __resetSettingsStoreForTest();
    vi.mocked(Store.load).mockRejectedValueOnce(new Error("store unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result: result2 } = renderHook(() => useReaderSettings());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result2.current[0]).toEqual(READER_SETTINGS_DEFAULT);
    warnSpy.mockRestore();
  });

  it("局部更新合并后立即持久化到 settings Store", async () => {
    const { result } = renderHook(() => useReaderSettings());
    await act(async () => {
      result.current[1]({ fontSize: 18 });
    });
    expect(result.current[0]).toEqual({ ...READER_SETTINGS_DEFAULT, fontSize: 18 });
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith("readerSettings", {
        ...READER_SETTINGS_DEFAULT,
        fontSize: 18,
      })
    );
    expect(mockSave).toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--reader-font-size")).toBe("18px");
  });

  it("落盘失败只告警、不影响当前设置", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSet.mockRejectedValue(new Error("disk readonly"));
    const { result } = renderHook(() => useReaderSettings());
    await act(async () => {
      result.current[1]({ lineHeight: 1.7 });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current[0].lineHeight).toBe(1.7);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("readerSettings"),
      expect.anything()
    );
    warnSpy.mockRestore();
  });

  it("启动恢复只读不写：读盘得到的设置不触发回写，只有用户改动才落盘", async () => {
    mockGet.mockResolvedValue({ fontSize: 16, columnWidth: 960, lineHeight: 1.7 });
    const { result } = renderHook(() => useReaderSettings());
    await waitFor(() => expect(result.current[0].fontSize).toBe(16));
    // 落盘挂在 settings 的 effect 上，若不加「用户改过」这道闸，启动那次 setState 会
    // 立刻把刚读到的值原样写回（StrictMode 下还会写两遍）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();

    // 用户改一次 ⇒ 落盘的是**已提交的状态**（读到的 16/960/1.7 与这次改动合并后的那份）
    await act(async () => {
      result.current[1]({ fontSize: 18 });
    });
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith("readerSettings", {
        fontSize: 18,
        columnWidth: 960,
        lineHeight: 1.7,
      })
    );
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it("卸载时移除 CSS 变量覆写", () => {
    const { result, unmount } = renderHook(() => useReaderSettings());
    act(() => {
      result.current[1]({ columnWidth: 720 });
    });
    expect(document.documentElement.style.getPropertyValue("--reader-column-width")).toBe("720px");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--reader-column-width")).toBe("");
  });
});
