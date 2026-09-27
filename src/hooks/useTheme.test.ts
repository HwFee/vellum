import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTheme } from "./useTheme";
import { THEME_STORAGE_KEY, type ThemePreference } from "../lib/theme";

// jsdom 没有 matchMedia：打桩成一个可手动翻面的桩，add/removeEventListener
// 记到集合里，用例据此验证「跟随系统」才订阅、并模拟系统主题变更事件
let prefersDark = false;
let mediaListeners: Set<() => void>;
let matchMediaSpy: ReturnType<typeof vi.fn>;

function stubMatchMedia() {
  mediaListeners = new Set();
  matchMediaSpy = vi.fn(() => ({
    get matches() {
      return prefersDark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, cb: EventListener) => {
      mediaListeners.add(cb as () => void);
    },
    removeEventListener: (_type: string, cb: EventListener) => {
      mediaListeners.delete(cb as () => void);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  Object.defineProperty(window, "matchMedia", {
    value: matchMediaSpy,
    configurable: true,
    writable: true,
  });
}

function flipSystemTheme(dark: boolean) {
  act(() => {
    prefersDark = dark;
    for (const cb of [...mediaListeners]) cb();
  });
}

beforeEach(() => {
  prefersDark = false;
  stubMatchMedia();
  localStorage.clear();
});

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

describe("useTheme", () => {
  it("跟随系统：按 matchMedia 解算 light/dark，写到 dataset.theme 与 colorScheme", () => {
    prefersDark = true;
    renderHook(() => useTheme("system", false));

    expect(matchMediaSpy).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    // 偏好（而不是解算结果）镜像给首帧解算用
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("跟随系统期间订阅 prefers-color-scheme 变化，翻面即时换色", () => {
    const { unmount } = renderHook(() => useTheme("system", false));
    expect(document.documentElement.dataset.theme).toBe("light");

    flipSystemTheme(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    flipSystemTheme(false);
    expect(document.documentElement.dataset.theme).toBe("light");

    unmount();
    flipSystemTheme(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("显式浅色 / 深色不订阅系统变化", () => {
    const { rerender } = renderHook(
      ({ theme }: { theme: ThemePreference }) => useTheme(theme, false),
      { initialProps: { theme: "dark" } }
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(mediaListeners.size).toBe(0);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    rerender({ theme: "light" });
    expect(document.documentElement.dataset.theme).toBe("light");

    // 显式主题下系统翻面不动界面
    flipSystemTheme(true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("导出为 PDF 视图打开期间强制浅色（印出的是纸），关回原解算", () => {
    prefersDark = true;
    const { rerender } = renderHook(({ open }) => useTheme("system", open), {
      initialProps: { open: false },
    });
    expect(document.documentElement.dataset.theme).toBe("dark");

    rerender({ open: true });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");

    rerender({ open: false });
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
