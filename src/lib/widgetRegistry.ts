export interface WidgetRegistry {
  register(id: string): void;
  release(id: string): void;
  markVisible(id: string): void;
  requestMount(id: string): boolean;
  activate(id: string): void;
  subscribe(cb: (id: string, dormant: boolean) => void): () => void;
  /**
   * 终止化清理：撤掉挂在 window 上的捕获期 scroll 监听、清掉 pending flush 定时器、
   * 清空订阅集与内部注册表。用于宿主卸载/测试隔离，避免 registry 实例泄漏全局监听。
   */
  dispose(): void;
  __clear?(): void;
  __getActiveCount?(): number;
}

interface WidgetEntry {
  id: string;
  lastVisible: number;
  dormant: boolean;
  mounted: boolean; // S2: 仅当 requestMount 成功挂载时置 true
}

const MAX_ACTIVE_WIDGETS = 10;
const SCROLL_QUIET_MS = 400;

export function createWidgetRegistry(): WidgetRegistry & {
  __clear(): void;
  __getActiveCount(): number;
  dispose(): void;
} {
  const widgets = new Map<string, WidgetEntry>();
  const subscribers = new Set<(id: string, dormant: boolean) => void>();
  let isScrolling = false;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;

  function notify(id: string, dormant: boolean) {
    for (const cb of subscribers) {
      try {
        cb(id, dormant);
      } catch (err) {
        console.error("Widget subscriber error:", err);
      }
    }
  }

  function evictIfNecessary() {
    if (isScrolling) return;

    // S2: 仅已实际挂载且未休眠的 widget 计入活跃集，未进入视口的条目不占用 10 个存活名额
    const mountedList = Array.from(widgets.values()).filter((w) => w.mounted && !w.dormant);
    if (mountedList.length <= MAX_ACTIVE_WIDGETS) return;

    // 按 lastVisible 升序排序：最近一次 markVisible 最久远的项排在最前
    mountedList.sort((a, b) => a.lastVisible - b.lastVisible);

    const excessCount = mountedList.length - MAX_ACTIVE_WIDGETS;
    for (let i = 0; i < excessCount; i++) {
      const victim = mountedList[i];
      victim.dormant = true;
      victim.mounted = false;
      notify(victim.id, true);
    }
  }

  function scheduleEviction() {
    const mountedList = Array.from(widgets.values()).filter((w) => w.mounted && !w.dormant);
    if (mountedList.length <= MAX_ACTIVE_WIDGETS) return;

    if (scrollTimer !== null) {
      return;
    }

    scrollTimer = setTimeout(() => {
      isScrolling = false;
      scrollTimer = null;
      evictIfNecessary();
    }, SCROLL_QUIET_MS);
  }

  function handleScroll() {
    isScrolling = true;
    if (scrollTimer !== null) {
      clearTimeout(scrollTimer);
    }
    scrollTimer = setTimeout(() => {
      isScrolling = false;
      scrollTimer = null;
      evictIfNecessary();
    }, SCROLL_QUIET_MS);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
  }

  return {
    register(id: string): void {
      if (widgets.has(id)) return;
      widgets.set(id, {
        id,
        lastVisible: Date.now(),
        dormant: false,
        mounted: false,
      });
    },

    release(id: string): void {
      widgets.delete(id);
    },

    markVisible(id: string): void {
      const entry = widgets.get(id);
      if (!entry) return;
      // LRU 排序键更新为最近 markVisible 时间
      entry.lastVisible = Date.now();
      // 被淘汰项重新入视口不自动复活（必须点击 activate）
      if (!entry.dormant && entry.mounted) {
        scheduleEviction();
      }
    },

    requestMount(id: string): boolean {
      const entry = widgets.get(id);
      if (!entry) return false;
      if (entry.dormant) return false;

      // S2: 仅 requestMount 通过时才计入活跃集
      entry.mounted = true;
      scheduleEviction();
      return true;
    },

    activate(id: string): void {
      const entry = widgets.get(id);
      if (!entry) return;
      entry.dormant = false;
      entry.lastVisible = Date.now();
      notify(id, false);
      // S2/P4: 不在此预先 entry.mounted = true，由组件在 requestMount 成功时置为 true，
      // 防止在 requestMount 失败或取消时不虚占活跃计数
    },

    subscribe(cb: (id: string, dormant: boolean) => void): () => void {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },

    __clear(): void {
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
      isScrolling = false;
      widgets.clear();
      subscribers.clear();
    },

    /**
     * 与 __clear 的区别：__clear 仅重置状态供测试复用同一实例（全局监听保留，
     * 因为单例仍需靠 scroll 驱动淘汰仲裁）；dispose 额外撤除全局监听，是实例生命
     * 周期终点的彻底释放。可重复调用（removeEventListener / clearTimeout 幂等）。
     */
    dispose(): void {
      if (typeof window !== "undefined") {
        window.removeEventListener("scroll", handleScroll, { capture: true });
      }
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
      isScrolling = false;
      widgets.clear();
      subscribers.clear();
    },

    __getActiveCount(): number {
      return Array.from(widgets.values()).filter((w) => w.mounted && !w.dormant).length;
    },
  };
}

export const widgetRegistry = createWidgetRegistry();
