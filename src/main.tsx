import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadAppPreferences } from "./lib/appPreferences";
import { parseThemePreference, resolveTheme, THEME_STORAGE_KEY } from "./lib/theme";
import { checkForUpdates } from "./lib/updater";
import { prefetchSystemFonts } from "./lib/fonts";
import "./styles/kami.css";

const FONT_SPECS = [
  '400 16px "TsangerJinKai02"',
  '500 16px "TsangerJinKai02"',
  '400 16px "JetBrains Mono"',
  '500 16px "JetBrains Mono"',
];

/// 显式触发自定义字体加载（不阻塞渲染）。`font-display: block` 配合
/// `<link rel="preload">` 已能避免 FOUT；字体预载在后台进行，不挡首帧显示。
async function waitForFonts(): Promise<void> {
  if (FONT_SPECS.every((spec) => document.fonts.check(spec))) return;
  await Promise.race([
    Promise.allSettled(FONT_SPECS.map((spec) => document.fonts.load(spec))),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// 首帧主题：useTheme 把「外观」偏好镜像在 localStorage，此处赶在首帧渲染前按同一
// 规则同步解出（CSP 禁内联脚本，index.html 放不了早期脚本，入口模块是最早的
// 可执行点）。导出视图的强制 light 由 useTheme 接管（启动时它必关）。
try {
  const preference = parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  const resolved = resolveTheme(
    preference,
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
} catch {
  // matchMedia / localStorage 不可用：不设 data-theme，样式按 :root 浅色走
}

// 立即渲染 App，字体在后台加载（font-display: block 防止 FOUT，后台加载不阻塞显示）
root.render(
  <React.StrictMode>
    <App onStartupVisible={onStartupVisible} />
  </React.StrictMode>,
);

void waitForFonts();

/// 首个内容可见之后才跑的两件事（useStartupWindow 亮窗回调，只触发一次）：
/// 字体候选表预热（requestIdleCallback / setTimeout 兜底，设置页字体选择器直接吃到
/// 全量本机字体）与启动静默更新检查（lib/updater.ts，尊重设置页「启动时自动检查更新」，
/// 偏好异步读盘、失败回退出厂值）。两者都不许挡首帧——枚举字体与查网都排在显示之后。
function onStartupVisible(): void {
  prefetchSystemFonts();
  void loadAppPreferences().then((preferences) => {
    if (preferences.autoCheckUpdates) return checkForUpdates();
  });
}
