import React from "react";
import ReactDOM from "react-dom/client";
import { check } from "@tauri-apps/plugin-updater";
import App from "./App";
import "./styles/kami.css";

const FONT_SPECS = [
  '400 16px "TsangerJinKai02"',
  '500 16px "TsangerJinKai02"',
  '400 16px "JetBrains Mono"',
  '500 16px "JetBrains Mono"',
];

/// 显式触发自定义字体加载（不阻塞渲染）。`font-display: block` 配合
/// `<link rel="preload">` 已能避免 FOUT；窗口初始隐藏进一步保证了首帧即正确字体。
async function waitForFonts(): Promise<void> {
  if (FONT_SPECS.every((spec) => document.fonts.check(spec))) return;
  await Promise.race([
    Promise.allSettled(FONT_SPECS.map((spec) => document.fonts.load(spec))),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

// 立即渲染 App，字体在后台加载（font-display: block 防止 FOUT，窗口隐藏保证首帧体验）
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void waitForFonts();

/// 更新提示：复用编辑视图的 `.editor-toast`（实色标签底 + mono 10px + `pointer-events: none`），
/// 直接挂到 body 上——不进 React 树，App 侧零改动。打印段已把该类隐藏。
const UPDATE_NOTICE_ID = "vellum-update-notice";

function showUpdateNotice(text: string): void {
  let notice = document.getElementById(UPDATE_NOTICE_ID);
  if (!notice) {
    notice = document.createElement("div");
    notice.id = UPDATE_NOTICE_ID;
    notice.className = "editor-toast";
    notice.setAttribute("role", "status");
    document.body.appendChild(notice);
  }
  notice.textContent = text;
}

/// 自动更新（启动路径，静默）：无更新 / 检查失败 / 更新失败一律不打扰——提示只在拿到更新
/// 之后才出现，中途任何一步出错都把提示撤掉并只落 console。
/// 只在生产构建里跑：dev 实例不该被 release 包自动替换掉（pubkey 未配置时签名校验必然失败，
/// 那只是第二层保险，不该当作唯一防线）。
async function checkForUpdates(): Promise<void> {
  if (!import.meta.env.PROD) return;
  try {
    const update = await check();
    if (!update) return;
    try {
      // 下载可能好几秒，先出提示再下：Windows 上安装会拉起 NSIS 安装器并退出进程，
      // 这条提示是「应用即将关闭」的唯一预警
      showUpdateNotice(`发现新版本 ${update.version}，正在更新…`);
      await update.downloadAndInstall();
      // Windows 上走不到这里（安装器已接管并退出进程），非 Windows 才需要用户自己重启
      showUpdateNotice("新版本已就绪，重启后生效");
    } finally {
      // Update 是 Resource，句柄必须归还，否则每次启动漏一个 rid
      update.close().catch(() => {});
    }
  } catch (error) {
    document.getElementById(UPDATE_NOTICE_ID)?.remove();
    console.error("自动更新未完成：", error);
  }
}

void checkForUpdates();
