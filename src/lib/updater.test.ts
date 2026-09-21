import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { __setUpdaterInstallForTest, checkForUpdates } from "./updater";

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

const NOTICE_ID = "vellum-update-notice";

function noticeText(): string | null {
  return document.getElementById(NOTICE_ID)?.textContent ?? null;
}

function makeUpdate(version = "1.9.0") {
  return {
    version,
    downloadAndInstall: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  vi.mocked(check).mockReset();
  document.getElementById(NOTICE_ID)?.remove();
  // 测试环境没有 PROD：闸门默认关闭（不安装、启动静默路径整体不跑）
  __setUpdaterInstallForTest(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.getElementById(NOTICE_ID)?.remove();
});

describe("checkForUpdates", () => {
  it("启动静默路径：无更新时不打扰（不建提示条）", async () => {
    __setUpdaterInstallForTest(true);
    vi.mocked(check).mockResolvedValue(null);

    await checkForUpdates();

    expect(check).toHaveBeenCalledTimes(1);
    expect(noticeText()).toBeNull();
  });

  it("启动静默路径：拿到更新时提示「发现新版本，重启后更新」并下载安装", async () => {
    __setUpdaterInstallForTest(true);
    const update = makeUpdate();
    vi.mocked(check).mockResolvedValue(update as never);

    await checkForUpdates();

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    // 非 Windows 才走得到这一句（Windows 上安装器已接管并退出进程）
    expect(noticeText()).toBe("新版本已就绪，重启后生效");
    // Update 是 Resource：句柄必须归还
    expect(update.close).toHaveBeenCalledTimes(1);
  });

  it("启动静默路径：检查失败只落 console，不打扰（提示条撤掉）", async () => {
    __setUpdaterInstallForTest(true);
    vi.mocked(check).mockRejectedValue(new Error("network down"));

    await checkForUpdates();

    expect(noticeText()).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it("dev / 测试实例不跑启动静默检查（dev 不该被 release 包替换）", async () => {
    await checkForUpdates();

    expect(check).not.toHaveBeenCalled();
  });

  it("手动检查：已是最新时给回执", async () => {
    vi.mocked(check).mockResolvedValue(null);

    await checkForUpdates(true);

    expect(check).toHaveBeenCalledTimes(1);
    expect(noticeText()).toBe("已是最新版本");
  });

  it("手动检查：有更新时提示「发现新版本，重启后更新」；不可安装时只报告不替换进程", async () => {
    const update = makeUpdate();
    vi.mocked(check).mockResolvedValue(update as never);

    await checkForUpdates(true);

    expect(noticeText()).toBe("发现新版本，重启后更新");
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(update.close).toHaveBeenCalledTimes(1);
  });

  it("手动检查：失败时给回执", async () => {
    vi.mocked(check).mockRejectedValue(new Error("network down"));

    await checkForUpdates(true);

    expect(noticeText()).toBe("检查失败，稍后再试");
    expect(console.error).toHaveBeenCalled();
  });

  it("手动回执是限时提示：4 秒后自动撤掉", async () => {
    vi.useFakeTimers();
    vi.mocked(check).mockResolvedValue(null);

    await checkForUpdates(true);
    expect(noticeText()).toBe("已是最新版本");

    vi.advanceTimersByTime(4000);
    expect(noticeText()).toBeNull();
  });

  it("提示条复用 .editor-toast 语汇并挂在 body 上（不进 React 树）", async () => {
    vi.mocked(check).mockResolvedValue(null);

    await checkForUpdates(true);

    const notice = document.getElementById(NOTICE_ID)!;
    expect(notice.parentElement).toBe(document.body);
    expect(notice).toHaveClass("editor-toast");
    expect(notice).toHaveAttribute("role", "status");
  });
});
