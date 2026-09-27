import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Store } from "@tauri-apps/plugin-store";
import { useAppPreferences } from "./useAppPreferences";
import { useTheme } from "./useTheme";
import { THEME_STORAGE_KEY } from "../lib/theme";
import {
  APP_PREFERENCES_DEFAULT,
  AUTO_CHECK_UPDATES_KEY,
  HEADING_SCRIPT_KEY,
  SIDEBAR_OPEN_ON_LAUNCH_KEY,
  THEME_KEY,
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

  it("出厂值：启动时展开侧栏 = 关，启动时自动检查更新 = 开，外观 = 跟随系统", async () => {
    const { result } = renderHook(() => useAppPreferences());
    expect(result.current[0]).toEqual(APP_PREFERENCES_DEFAULT);
    expect(result.current[0].sidebarOpenOnLaunch).toBe(false);
    expect(result.current[0].autoCheckUpdates).toBe(true);
    expect(result.current[0].theme).toBe("system");
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

  it("外观从同一 Store 恢复", async () => {
    mockGet.mockImplementation((key: string) =>
      key === THEME_KEY ? Promise.resolve("dark") : Promise.resolve(undefined)
    );

    const { result } = renderHook(() => useAppPreferences());
    await waitFor(() => expect(result.current[0].theme).toBe("dark"));
  });

  it("侧栏题头字形从同一 Store 恢复；非法值回退繁体出厂", async () => {
    mockGet.mockImplementation((key: string) =>
      key === HEADING_SCRIPT_KEY ? Promise.resolve("simplified") : Promise.resolve(undefined)
    );
    const { result } = renderHook(() => useAppPreferences());
    await waitFor(() => expect(result.current[0].headingScript).toBe("simplified"));

    __resetSettingsStoreForTest();
    mockGet.mockImplementation((key: string) =>
      key === HEADING_SCRIPT_KEY ? Promise.resolve("katakana") : Promise.resolve(undefined)
    );
    const second = renderHook(() => useAppPreferences());
    await waitFor(() => expect(second.result.current[0].headingScript).toBe("traditional"));
  });

  it("外观初始值取自 localStorage 镜像：读盘落地前 useTheme 看到的已是镜像主题（首帧不闪）", () => {
    // main.tsx 首帧解算读的同一键；若初始 theme 是出厂「跟随系统」，读盘落地前
    // useTheme 会把 data-theme 覆盖回浅色并把镜像写成 system
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    renderHook(() => {
      const [preferences] = useAppPreferences();
      useTheme(preferences.theme, false);
    });
    // 同步断言：不等 Store 读盘（mockGet 恒 undefined，落地后是出厂值）
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    localStorage.removeItem(THEME_STORAGE_KEY);
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("外观读到非三值（如旧版本遗留 / 手改 settings.json）回退「跟随系统」", async () => {
    mockGet.mockImplementation((key: string) =>
      key === THEME_KEY ? Promise.resolve("neon") : Promise.resolve(undefined)
    );

    const { result } = renderHook(() => useAppPreferences());
    // 读到的与出厂值逐字段相等时一次 setState 都不发——等读盘落空即可
    await act(async () => {});
    expect(result.current[0].theme).toBe("system");
    expect(result.current[0]).toEqual(APP_PREFERENCES_DEFAULT);
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
