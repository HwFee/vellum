import { getSettingsStore } from "./settings";
import { parseThemePreference, type ThemePreference } from "./theme";
import { parseHeadingScript, type HeadingScript } from "./headingLabels";

/// 「启动时展开侧栏」：出厂关（维持 1.8.1 现状，2026-09-20 设置页起变为可调）
export const SIDEBAR_OPEN_ON_LAUNCH_KEY = "sidebarOpenOnLaunch";
/// 「启动时自动检查更新」：出厂开
export const AUTO_CHECK_UPDATES_KEY = "autoCheckUpdates";
/// 「外观」：跟随系统 / 浅色 / 深色，出厂跟随系统
export const THEME_KEY = "theme";
/// 「Ctrl + 滚轮改字号」：出厂开——它是「缩放正文」的常规手势（浏览器里 Ctrl+滚轮
/// 也是缩放），出厂不给人开门反而意外；不想要这一下的用户到设置里关掉即可
export const CTRL_WHEEL_FONT_SIZE_KEY = "ctrlWheelFontSize";
/// 「侧栏题头字形」：繁体 / 简体，出厂繁体（维持既有题头字形）
export const HEADING_SCRIPT_KEY = "headingScript";

export interface AppPreferences {
  sidebarOpenOnLaunch: boolean;
  autoCheckUpdates: boolean;
  theme: ThemePreference;
  ctrlWheelFontSize: boolean;
  headingScript: HeadingScript;
}

export const APP_PREFERENCES_DEFAULT: AppPreferences = {
  sidebarOpenOnLaunch: false,
  autoCheckUpdates: true,
  theme: "system",
  ctrlWheelFontSize: true,
  headingScript: "traditional",
};

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 读取界面行为偏好（与 outlineWidth / readerSettings 同一个 settings.json Store）。
 * 读盘失败或字段缺失一律回退出厂值、绝不抛错：启动路径（侧栏是否展开、是否静默查更新）
 * 都依赖它，一次 Store 抖动不该影响应用启动。
 */
export async function loadAppPreferences(): Promise<AppPreferences> {
  try {
    const store = await getSettingsStore();
    const [sidebarOpenOnLaunch, autoCheckUpdates, theme, ctrlWheelFontSize, headingScript] =
      await Promise.all([
        store.get<unknown>(SIDEBAR_OPEN_ON_LAUNCH_KEY),
        store.get<unknown>(AUTO_CHECK_UPDATES_KEY),
        store.get<unknown>(THEME_KEY),
        store.get<unknown>(CTRL_WHEEL_FONT_SIZE_KEY),
        store.get<unknown>(HEADING_SCRIPT_KEY),
      ]);
    return {
      sidebarOpenOnLaunch: pickBoolean(
        sidebarOpenOnLaunch,
        APP_PREFERENCES_DEFAULT.sidebarOpenOnLaunch
      ),
      autoCheckUpdates: pickBoolean(autoCheckUpdates, APP_PREFERENCES_DEFAULT.autoCheckUpdates),
      theme: parseThemePreference(theme),
      ctrlWheelFontSize: pickBoolean(
        ctrlWheelFontSize,
        APP_PREFERENCES_DEFAULT.ctrlWheelFontSize
      ),
      headingScript: parseHeadingScript(headingScript),
    };
  } catch (error) {
    console.warn("appPreferences Store load failed:", error);
    return { ...APP_PREFERENCES_DEFAULT };
  }
}

/** 落盘单个偏好（分段选择器是离散操作，改动即存，无需防抖） */
export async function saveAppPreference<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K]
): Promise<void> {
  try {
    const store = await getSettingsStore();
    await store.set(key, value);
    await store.save();
  } catch (error) {
    console.warn(`appPreferences Store save failed (${key}):`, error);
  }
}
