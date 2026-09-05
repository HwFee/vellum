import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWidgetRegistry, widgetRegistry } from "./widgetRegistry";

describe("widgetRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 清理全局单例
    if ("__clear" in widgetRegistry && typeof widgetRegistry.__clear === "function") {
      widgetRegistry.__clear();
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers widgets and allows mounting within capacity 10", () => {
    for (let i = 1; i <= 10; i++) {
      widgetRegistry.register(`w-${i}`);
      expect(widgetRegistry.requestMount(`w-${i}`)).toBe(true);
    }
  });

  it("evicts LRU widget only after scrolling stops for 400ms", () => {
    const events: { id: string; dormant: boolean }[] = [];
    const unsubscribe = widgetRegistry.subscribe((id, dormant) => {
      events.push({ id, dormant });
    });

    // 登记并挂载 10 个 widget，并按顺序更新 visible 时间
    for (let i = 1; i <= 10; i++) {
      vi.advanceTimersByTime(10);
      widgetRegistry.register(`w-${i}`);
      expect(widgetRegistry.requestMount(`w-${i}`)).toBe(true);
      widgetRegistry.markVisible(`w-${i}`);
    }

    // 触发滚动事件（模拟连续滚动）
    window.dispatchEvent(new Event("scroll"));

    // 登记第 11 个并请求挂载
    vi.advanceTimersByTime(10);
    widgetRegistry.register("w-11");
    expect(widgetRegistry.requestMount("w-11")).toBe(true);
    widgetRegistry.markVisible("w-11");

    // 滚动期间即便挂载数超过 10 个也不得淘汰
    expect(events.length).toBe(0);
    expect(widgetRegistry.requestMount("w-1")).toBe(true);

    // 滚动中途再次触发滚动（重置 400ms 定时器）
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);
    expect(events.length).toBe(0);

    // 距离上次滚动满 400ms：停止滚动稳定触发淘汰
    vi.advanceTimersByTime(200);
    // 最早 markVisible 的 w-1 应当被淘汰置为休眠
    expect(events).toEqual([{ id: "w-1", dormant: true }]);
    expect(widgetRegistry.requestMount("w-1")).toBe(false);

    unsubscribe();
  });

  it("does not auto-revive dormant widget when re-entering viewport until activate() is called", () => {
    const events: { id: string; dormant: boolean }[] = [];
    const unsubscribe = widgetRegistry.subscribe((id, dormant) => {
      events.push({ id, dormant });
    });

    // 登记并挂载 10 个
    for (let i = 1; i <= 10; i++) {
      widgetRegistry.register(`w-${i}`);
      expect(widgetRegistry.requestMount(`w-${i}`)).toBe(true);
      widgetRegistry.markVisible(`w-${i}`);
    }

    // 登记第 11 个并请求挂载触发淘汰
    widgetRegistry.register("w-11");
    expect(widgetRegistry.requestMount("w-11")).toBe(true);
    widgetRegistry.markVisible("w-11");
    vi.advanceTimersByTime(400);

    expect(widgetRegistry.requestMount("w-1")).toBe(false);

    // 被淘汰项重新入视口调用 markVisible，绝对不自动复活
    widgetRegistry.markVisible("w-1");
    expect(widgetRegistry.requestMount("w-1")).toBe(false);
    expect(events).toEqual([{ id: "w-1", dormant: true }]);

    // 必须由用户点击后显式调用 activate(id) 才能复活
    widgetRegistry.activate("w-1");
    expect(events).toEqual([
      { id: "w-1", dormant: true },
      { id: "w-1", dormant: false },
    ]);
    expect(widgetRegistry.requestMount("w-1")).toBe(true);

    unsubscribe();
  });

  it("releases widget and cleans up subscription", () => {
    let called = false;
    const unsubscribe = widgetRegistry.subscribe(() => {
      called = true;
    });

    widgetRegistry.register("w-temp");
    widgetRegistry.release("w-temp");
    expect(widgetRegistry.requestMount("w-temp")).toBe(false);

    unsubscribe();
    widgetRegistry.activate("w-temp");
    expect(called).toBe(false);
  });

  it("P4: activate() clears dormant flag without prematurely occupying active count until requestMount succeeds", () => {
    // 登记并挂载 10 个
    for (let i = 1; i <= 10; i++) {
      widgetRegistry.register(`w-${i}`);
      expect(widgetRegistry.requestMount(`w-${i}`)).toBe(true);
      widgetRegistry.markVisible(`w-${i}`);
    }

    // 登记第 11 个并请求挂载触发淘汰
    widgetRegistry.register("w-11");
    expect(widgetRegistry.requestMount("w-11")).toBe(true);
    widgetRegistry.markVisible("w-11");
    vi.advanceTimersByTime(400);

    // w-1 被淘汰休眠，活跃计数应为 10
    expect(widgetRegistry.__getActiveCount()).toBe(10);
    expect(widgetRegistry.requestMount("w-1")).toBe(false);

    // 调用 activate("w-1") 唤醒
    widgetRegistry.activate("w-1");

    // P4 核心约束：activate 应当解除休眠，但绝不虚占活跃计数（必须由后续 requestMount 成功挂载时才计入）
    expect(widgetRegistry.__getActiveCount()).toBe(10);

    // 显式调用 requestMount 成功后才计入活跃集
    expect(widgetRegistry.requestMount("w-1")).toBe(true);
    expect(widgetRegistry.__getActiveCount()).toBe(11);
  });
});

// F10/P11：dispose() 必须同时撤掉永久挂在 window 上的 scroll 监听、清掉 pending flush
// 定时器、并清空订阅集与内部注册表。这里用 createWidgetRegistry() 新建实例，避免
// 把全局单例的监听卸掉后影响同文件其他用例（dispose 是终止动作，不可逆）。
describe("widgetRegistry.dispose (F10/P11)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("disposes the scroll listener and pending flush so no eviction/notification fires afterwards", () => {
    const reg = createWidgetRegistry();
    const events: { id: string; dormant: boolean }[] = [];
    const unsubscribe = reg.subscribe((id, dormant) => events.push({ id, dormant }));

    for (let i = 1; i <= 10; i++) {
      vi.advanceTimersByTime(10);
      reg.register(`w-${i}`);
      expect(reg.requestMount(`w-${i}`)).toBe(true);
      reg.markVisible(`w-${i}`);
    }

    // 滚动期间挂载第 11 个：scroll 监听武装的 400ms flush 是唯一会触发淘汰的定时器
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(10);
    reg.register("w-11");
    expect(reg.requestMount("w-11")).toBe(true);
    reg.markVisible("w-11");

    reg.dispose();

    // 1. 遗留的 pending flush 定时器不得再fire
    vi.advanceTimersByTime(1_000);
    expect(events).toEqual([]);
    // 2. 已撤监听后再次滚动不得重新武装 flush
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(1_000);
    expect(events).toEqual([]);
    // 3. 内部状态已清空
    expect(reg.__getActiveCount()).toBe(0);

    unsubscribe();
  });

  it("clears subscribers and registry state on dispose", () => {
    const reg = createWidgetRegistry();
    let staleHits = 0;
    const unsubscribe = reg.subscribe(() => {
      staleHits += 1;
    });

    reg.register("w-a");
    expect(reg.requestMount("w-a")).toBe(true);
    expect(reg.__getActiveCount()).toBe(1);

    reg.dispose();
    expect(reg.__getActiveCount()).toBe(0);

    // dispose 后旧订阅者不得再被任何通知触达
    reg.register("w-b");
    reg.activate("w-b");
    expect(staleHits).toBe(0);

    // 重新订阅仍可正常工作（证明确系“清订阅集”而非一次性 disable）
    let freshHits = 0;
    const unsubscribeFresh = reg.subscribe(() => {
      freshHits += 1;
    });
    reg.activate("w-b");
    expect(freshHits).toBe(1);

    unsubscribeFresh();
    unsubscribe();
  });

  it("leaves no live scroll listener behind: a post-dispose scroll cannot re-arm or defer the flush timer", () => {
    const reg = createWidgetRegistry();
    // dispose 会清订阅集，故先 dispose 再订阅，保证下面看到的是“干净实例”的行为
    reg.dispose();

    const events: { id: string; dormant: boolean }[] = [];
    const unsubscribe = reg.subscribe((id, dormant) => events.push({ id, dormant }));

    for (let i = 1; i <= 11; i++) {
      vi.advanceTimersByTime(10);
      reg.register(`v-${i}`);
      expect(reg.requestMount(`v-${i}`)).toBe(true);
      reg.markVisible(`v-${i}`);
    }
    // 第 11 个挂载 → 超限 → scheduleEviction 武装了一个 flush 定时器（+400ms 后 fire）

    vi.advanceTimersByTime(200);
    window.dispatchEvent(new Event("scroll"));
    // 若 dispose 没撤掉监听：handleScroll 会 clearTimeout 并重新武装，淘汰被推迟到 +400ms
    vi.advanceTimersByTime(250);

    expect(events).toEqual([{ id: "v-1", dormant: true }]);

    unsubscribe();
  });

  it("cancels the pending flush timer so it cannot fire against state created after dispose", () => {
    const reg = createWidgetRegistry();

    // 阶段一：武装一个 flush 定时器（+400ms fire）后 dispose 撤销
    for (let i = 1; i <= 11; i++) {
      reg.register(`p-${i}`);
      expect(reg.requestMount(`p-${i}`)).toBe(true);
    }
    reg.dispose();

    vi.advanceTimersByTime(100);

    // 阶段二：dispose 不使实例失效，重新订阅并重新填充超限集（新定时器 +400ms → t=500 fire）
    const events: { id: string; dormant: boolean }[] = [];
    const unsubscribe = reg.subscribe((id, dormant) => events.push({ id, dormant }));
    for (let i = 1; i <= 11; i++) {
      reg.register(`q-${i}`);
      expect(reg.requestMount(`q-${i}`)).toBe(true);
    }

    // 阶段三：推到 t=450。旧定时器若未 clear，会在 t=400 抢先 fire 并淘汰 q-1
    vi.advanceTimersByTime(350);
    expect(events).toEqual([]);

    // t=500：本次挂载武装的新 flush 仍应正常执行（dispose 不是永久 disable）
    vi.advanceTimersByTime(100);
    expect(events).toHaveLength(1);

    unsubscribe();
  });
});
