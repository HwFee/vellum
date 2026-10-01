/**
 * Sidecar 状态机与心跳守护（spec §3.7 / Z1）。
 *
 * 容错纪律：sidecar 是「附加信息」，任何写失败都不得冒泡——
 * 冒泡到 setInterval 回调会成为 uncaughtException，直接杀死宿主会话（Item 1 / 阻断 A1）。
 * 定时器一律 unref()，不得把事件循环钉住（否则 pi -p 与测试进程无法自然退出）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { SidecarData } from "./types.ts";

export function getSidecarPath(logFilePath: string): string {
  return `${logFilePath}.mdlog`;
}

/** 原子写：tmp + rename；失败清理 tmp 并返回 false，绝不抛出 */
export function writeSidecar(sidecarPath: string, data: SidecarData): boolean {
  let tempPath: string | null = null;
  try {
    const dir = path.dirname(sidecarPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    tempPath = `${sidecarPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tempPath, sidecarPath);
    return true;
  } catch {
    if (tempPath !== null) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // 清理失败不掩盖原始失败
      }
    }
    return false;
  }
}

export function readSidecar(sidecarPath: string): SidecarData | null {
  try {
    if (!fs.existsSync(sidecarPath)) return null;
    return JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as SidecarData;
  } catch {
    return null;
  }
}

export function updateHeartbeat(sidecarPath: string, now = Date.now()): boolean {
  try {
    const current = readSidecar(sidecarPath);
    if (!current) return false;
    current.heartbeatAt = now;
    return writeSidecar(sidecarPath, current);
  } catch {
    return false;
  }
}

export function updateLastWrite(sidecarPath: string, timestamp: number): boolean {
  try {
    const current = readSidecar(sidecarPath);
    if (!current) return false;
    current.lastWriteAt = timestamp;
    return writeSidecar(sidecarPath, current);
  } catch {
    return false;
  }
}

export function setAnchorLost(sidecarPath: string, anchorLost: boolean): boolean {
  try {
    const current = readSidecar(sidecarPath);
    if (!current) return false;
    current.anchorLost = anchorLost;
    return writeSidecar(sidecarPath, current);
  } catch {
    return false;
  }
}

export function removeSidecar(sidecarPath: string): boolean {
  try {
    if (fs.existsSync(sidecarPath)) {
      fs.unlinkSync(sidecarPath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private sidecarPath: string | null = null;

  public start(sidecarPath: string, intervalMs = 30_000): void {
    this.stop();
    this.sidecarPath = sidecarPath;
    this.timer = setInterval(() => {
      // 回调里再包一层：任何异常都不得冒泡出 setInterval（阻断 A1）
      try {
        if (this.sidecarPath) updateHeartbeat(this.sidecarPath);
      } catch {
        // 心跳失败静默降级，靠宿主 120s 超时判定掉线
      }
    }, intervalMs);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.sidecarPath = null;
  }

  public isRunning(): boolean {
    return this.timer !== null;
  }
}
