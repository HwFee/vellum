import { Store } from "@tauri-apps/plugin-store";

const STORE_PATH = "settings.json";

let storePromise: Promise<Store> | null = null;

/**
 * 共享的 settings.json Store 单例。
 * recentFiles、outlineOpen、阅读设置等设置项都存于同一个 settings.json，
 * 复用同一个 Store 实例可避免各模块分别 Store.load 产生的冗余 IPC 往返。
 * 加载失败时不缓存，让下次调用可以重试。
 */
export function getSettingsStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_PATH).catch((error) => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

/** 仅测试用：重置缓存的 Store 实例，让每个用例能独立 mock Store.load */
export function __resetSettingsStoreForTest(): void {
  storePromise = null;
}
