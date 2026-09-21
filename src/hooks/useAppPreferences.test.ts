import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Store } from "@tauri-apps/plugin-store";
import { useAppPreferences } from "./useAppPreferences";
import {
  APP_PREFERENCES_DEFAULT,
  AUTO_CHECK_UPDATES_KEY,
  SIDEBAR_OPEN_ON_LAUNCH_KEY,
} from "../lib/appPreferences";
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

describe("useAppPreferences", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockSave.mockReset();
    mockGet.mockResolvedValue(undefined);
    __resetSettingsStoreForTest();
    vi.mocked(Store.load).mockImplementation(async () => (({
      get: mockGet,
      set: mockSet,
      save: mockSave,
    }) as unknown as Store));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("出厂值：启动时展开侧栏 = 关，启动时自动检查更新 = 开", async () => {
    const { result } = renderHook(() => useAppPreferences());
    expect(result.current[0]).toEqual(APP_PREFERENCES_DEFAULT);
    expect(result.current[0].sidebarOpenOnLaunch).toBe(false);
    expect(result.current[0].autoCheckUpdates).toBe(true);
    // 等异步读盘落地，免得用例结束后才 setState（React 会告警）
    await act(async () => {});
  });

  it("启动时恢复持久化偏好（逐字段校验，非法值回退出厂值）", async () => {
    mockGet.mockImplementation((key: string) =>
      Promise.resolve(key === SIDEBAR_OPEN_ON_LAUNCH_KEY ? true : "not-a-boolean")
    );

    const { result } = renderHook(() => useAppPreferences());

    await waitFor(() => expect(result.current[0].sidebarOpenOnLaunch).toBe(true));
    // autoCheckUpdates 存的是字符串：回退出厂值 true（而不是把它当真）
    expect(result.current[0].autoCheckUpdates).toBe(true);
  });

  it("改动即落盘到共享 settings Store（只写改动的那个 key）", async () => {
    const { result } = renderHook(() => useAppPreferences());
    await act(async () => {});

    act(() => {
      result.current[1]({ sidebarOpenOnLaunch: true });
    });

    await waitFor(() => expect(mockSet).toHaveBeenCalledWith(SIDEBAR_OPEN_ON_LAUNCH_KEY, true));
    expect(mockSet).not.toHaveBeenCalledWith(AUTO_CHECK_UPDATES_KEY, expect.anything());
    expect(mockSave).toHaveBeenCalled();
  });

  it("启动读盘不算改动：不触发回写", async () => {
    mockGet.mockResolvedValue(true);

    const { result } = renderHook(() => useAppPreferences());
    await waitFor(() => expect(result.current[0].sidebarOpenOnLaunch).toBe(true));

    expect(mockSet).not.toHaveBeenCalled();
  });

  it("Store 读盘失败只告警，保持出厂值", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(Store.load).mockRejectedValue(new Error("store unavailable"));

    const { result } = renderHook(() => useAppPreferences());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current[0]).toEqual(APP_PREFERENCES_DEFAULT);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("appPreferences"),
      expect.anything()
    );
  });
});
