import { getSettingsStore } from "./settings";

/**
 * 交互块（`vellum-widget`）的信任台账。
 *
 * 为什么需要它：沙箱是 `allow-scripts` 的跨源 iframe，未受信文档里的交互块必须先由用户
 * 点一次「交互内容 · 点击加载」才执行脚本。此前授权只存在组件内部的 ref 上（键为 html），
 * 文档重开、热重载重建实例、重启应用后全都丢失——于是「我明明加载过一次，每次进来还要我点」。
 * 现在按 **widget 源码指纹**记住：同一份交互块点一次即可（用户裁定；同一文档里*不同*的
 * 交互块仍需各自点一次），写入共享 settings Store，重启 Vellum 依然有效。
 *
 * 指纹用同步的 53 位哈希（cyrb53）而不是 `crypto.subtle`：渲染期必须能**同步**判定
 * 「这块是否已受信」（`useSyncExternalStore` 的 getSnapshot 不能是异步的）。它在这里只充当
 * 「同一份内容的身份证」，台账规模下的碰撞概率可忽略；指纹里额外带上源码长度，
 * 长度不同绝不相等。
 */
const STORE_KEY = "trustedWidgets";
/** 台账上限：交互块内容会随 mdlog 追加不断变化，必须有界（超出按插入序淘汰最旧） */
const MAX_TRUSTED = 300;

const trusted = new Set<string>();
const listeners = new Set<() => void>();
let hydration: Promise<void> | null = null;

/// cyrb53：快、无依赖、雪崩性够用的 53 位字符串哈希
function cyrb53(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function widgetFingerprint(html: string): string {
  return `${html.length.toString(36)}-${cyrb53(html).toString(36)}`;
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error("Widget trust subscriber error:", error);
    }
  }
}

function readFallback(): string[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function persist(): void {
  const snapshot = Array.from(trusted);
  void (async () => {
    try {
      const store = await getSettingsStore();
      await store.set(STORE_KEY, snapshot);
      await store.save();
    } catch (storeError) {
      console.warn("Failed to persist widget trust:", storeError);
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(snapshot));
      } catch (localError) {
        console.warn("Failed to persist widget trust to localStorage:", localError);
      }
    }
  })();
}

/** 读一次持久化台账（幂等；Store 不可用时退回 localStorage）。订阅时自动触发。 */
export function ensureWidgetTrustLoaded(): Promise<void> {
  if (hydration) return hydration;
  hydration = (async () => {
    let stored: string[] = [];
    try {
      const store = await getSettingsStore();
      const value = await store.get<string[]>(STORE_KEY);
      stored = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
      stored = readFallback();
    }
    for (const fingerprint of stored) {
      trusted.add(fingerprint);
    }
    notify();
  })();
  return hydration;
}

export function isWidgetTrusted(html: string): boolean {
  return trusted.has(widgetFingerprint(html));
}

export function subscribeWidgetTrust(listener: () => void): () => void {
  listeners.add(listener);
  void ensureWidgetTrustLoaded();
  return () => {
    listeners.delete(listener);
  };
}

/** 记住「这份交互块已获用户授权」。同内容重复调用是 no-op。 */
export function trustWidget(html: string): void {
  const fingerprint = widgetFingerprint(html);
  if (trusted.has(fingerprint)) return;
  // Set 保持插入序：超限时淘汰最旧的一条
  while (trusted.size >= MAX_TRUSTED) {
    const oldest = trusted.values().next().value;
    if (oldest === undefined) break;
    trusted.delete(oldest);
  }
  trusted.add(fingerprint);
  notify();
  persist();
}

/** 仅测试用：清空内存台账与订阅（模块级单例需要显式隔离） */
export function __resetWidgetTrustForTest(): void {
  trusted.clear();
  listeners.clear();
  hydration = null;
}
