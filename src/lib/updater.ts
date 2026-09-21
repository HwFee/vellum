import { check } from "@tauri-apps/plugin-updater";

/// 更新提示：复用编辑视图的 `.editor-toast`（实色标签底 + mono 10px + `pointer-events: none`），
/// 直接挂到 body 上——不进 React 树，App 侧零改动。打印段已把该类隐藏。
const UPDATE_NOTICE_ID = "vellum-update-notice";

/// 手动检查的回执是一次性提示：留着不走会一直挂在窗口角落
const MANUAL_NOTICE_MS = 4000;

/// 是否允许下载安装（会替换掉当前进程的包）。dev / 测试实例不该被 release 包替换掉：
/// pubkey 未配置时签名校验必然失败，那只是第二层保险，不该当作唯一防线。
/// 测试经 __setUpdaterInstallForTest 打开它——「启动静默更新」这条路径必须可测。
let canInstall = import.meta.env.PROD;

/** 仅测试用：打开/关闭「允许安装」闸门（默认值取构建期的 PROD） */
export function __setUpdaterInstallForTest(value: boolean): void {
  canInstall = value;
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function clearNoticeTimer(): void {
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
}

/** 撤掉提示条（自动路径的失败分支与手动提示的到期都走这里） */
function dismissUpdateNotice(): void {
  clearNoticeTimer();
  document.getElementById(UPDATE_NOTICE_ID)?.remove();
}

function showUpdateNotice(text: string, ttlMs?: number): void {
  clearNoticeTimer();
  let notice = document.getElementById(UPDATE_NOTICE_ID);
  if (!notice) {
    notice = document.createElement("div");
    notice.id = UPDATE_NOTICE_ID;
    notice.className = "editor-toast";
    notice.setAttribute("role", "status");
    document.body.appendChild(notice);
  }
  notice.textContent = text;
  if (ttlMs !== undefined) {
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      document.getElementById(UPDATE_NOTICE_ID)?.remove();
    }, ttlMs);
  }
}

/**
 * 检查更新。
 *
 * - `manual = true`：设置页「立即检查」。无论「启动时自动检查更新」开关如何都查，
 *   结果一律回执（有新版本 / 已是最新 / 检查失败）。
 * - `manual = false`：启动静默路径（main.tsx 在开关为开时调用）。无更新与失败都静默，
 *   只有真的拿到更新才出提示——中途任何一步出错都只落 console。
 *
 * 文案（2026-09-20 设置页定稿）：有新版本「发现新版本，重启后更新」；已最新与失败
 * 只在手动路径提示，自动路径不打扰。
 */
export async function checkForUpdates(manual = false): Promise<void> {
  // 启动静默路径只在能安装时跑：dev / 测试实例没有可替换的 release 包
  if (!manual && !canInstall) return;
  try {
    const update = await check();
    if (!update) {
      if (manual) showUpdateNotice("已是最新版本", MANUAL_NOTICE_MS);
      return;
    }
    try {
      // Windows 上安装器会接管并退出进程，这条提示是「应用即将关闭」的唯一预警
      showUpdateNotice("发现新版本，重启后更新");
      // dev / 测试：只报告不替换当前进程（见 canInstall）
      if (!canInstall) return;
      await update.downloadAndInstall();
      // Windows 上走不到这里（安装器已接管并退出进程），非 Windows 才需要用户自己重启
      showUpdateNotice("新版本已就绪，重启后生效");
    } finally {
      // Update 是 Resource，句柄必须归还，否则每次启动漏一个 rid
      update.close().catch(() => {});
    }
  } catch (error) {
    if (manual) {
      showUpdateNotice("检查失败，稍后再试", MANUAL_NOTICE_MS);
    } else {
      dismissUpdateNotice();
    }
    console.error("更新检查未完成：", error);
  }
}
