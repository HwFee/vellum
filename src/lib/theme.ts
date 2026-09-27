/// 「外观」偏好：跟随系统 / 浅色 / 深色（settings.json Store key `theme`）
export type ThemePreference = "system" | "light" | "dark";

/// 解算结果：kami.css 的 :root[data-theme="dark"] 令牌块据此换色
export type ResolvedTheme = "light" | "dark";

/// localStorage 镜像键：useTheme 每次变更偏好时写入；main.tsx 在首帧渲染前
/// 读同一键同步解出 resolved 值（CSP 禁内联脚本，入口模块是最早的可执行点）
export const THEME_STORAGE_KEY = "vellum-theme";

/// 读盘校验：非三值一律回退「跟随系统」
export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return prefersDark ? "dark" : "light";
}
