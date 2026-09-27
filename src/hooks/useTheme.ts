import { useEffect } from "react";
import {
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../lib/theme";

/**
 * 主题（外观偏好）：把「跟随系统 / 浅色 / 深色」解析成 light | dark，
 * 写到 documentElement.dataset.theme 与 style.colorScheme——kami.css 的
 * :root[data-theme="dark"] 令牌块据此换色，colorScheme 让滚动条等原生件跟进。
 * 「跟随系统」期间订阅 prefers-color-scheme 变化。
 *
 * 导出为 PDF 视图打开期间强制 light：印出的是纸，printToPDF 打的是实时页面，
 * 深底进 PDF 等于往纸上泼墨。
 *
 * 偏好镜像到 localStorage（vellum-theme）：main.tsx 在首帧渲染前读同一键同步
 * 解算（CSP 禁内联脚本，index.html 放不了早期脚本），窗口初次亮起不闪错主题。
 */
export function useTheme(theme: ThemePreference, isExportOpen: boolean): void {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = isExportOpen ? "light" : resolveTheme(theme, media.matches);
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage 不可用只是丢首帧优化，不影响功能
    }
    if (theme === "system") {
      media.addEventListener("change", apply);
      return () => media.removeEventListener("change", apply);
    }
  }, [theme, isExportOpen]);
}
