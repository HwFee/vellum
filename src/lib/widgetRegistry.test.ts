import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { widgetRegistry } from "./widgetRegistry";

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
