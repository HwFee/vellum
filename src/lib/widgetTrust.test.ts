import { describe, expect, it, vi, beforeEach } from "vitest";

const storeGet = vi.fn((key: string): Promise<unknown> => {
  void key;
  return Promise.resolve(undefined);
});
const storeSet = vi.fn((_key: string, _value: unknown) => Promise.resolve());
const storeSave = vi.fn(() => Promise.resolve());
const storeLoad = vi.fn(() => Promise.resolve({ get: storeGet, set: storeSet, save: storeSave }));

vi.mock("./settings", () => ({
  getSettingsStore: () => storeLoad(),
}));

import {
  __resetWidgetTrustForTest,
  ensureWidgetTrustLoaded,
  isWidgetTrusted,
  subscribeWidgetTrust,
  trustWidget,
  widgetFingerprint,
} from "./widgetTrust";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("widgetTrust", () => {
  beforeEach(() => {
    __resetWidgetTrustForTest();
    storeGet.mockReset();
    storeGet.mockImplementation((key: string) => (key === "trustedWidgets" ? Promise.resolve(undefined) : Promise.resolve(undefined)));
    storeSet.mockClear();
    storeSave.mockClear();
    storeLoad.mockClear();
    storeLoad.mockImplementation(() => Promise.resolve({ get: storeGet, set: storeSet, save: storeSave }));
    localStorage.clear();
  });

  it("指纹只由内容决定，且长度不同不会撞车", () => {
    expect(widgetFingerprint("<div>a</div>")).toBe(widgetFingerprint("<div>a</div>"));
    expect(widgetFingerprint("<div>a</div>")).not.toBe(widgetFingerprint("<div>b</div>"));
    // 抗「同哈希不同长度」：指纹里带上长度
    expect(widgetFingerprint("abc")).not.toBe(widgetFingerprint("abcd"));
  });

  it("未点过加载的交互块一律未受信", () => {
    expect(isWidgetTrusted("<div>demo</div>")).toBe(false);
  });

  it("信任写入台账并落盘，同内容立即生效", async () => {
    trustWidget("<div>demo</div>");
    expect(isWidgetTrusted("<div>demo</div>")).toBe(true);
    expect(isWidgetTrusted("<div>other</div>")).toBe(false);
    await flush();
    expect(storeSet).toHaveBeenCalledWith("trustedWidgets", [widgetFingerprint("<div>demo</div>")]);    expect(storeSave).toHaveBeenCalled();
  });

  it("订阅者收到通知（跨实例自动加载的依据）", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWidgetTrust(listener);
    trustWidget("<div>demo</div>");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    trustWidget("<div>another</div>");
    expect(listener).not.toHaveBeenCalled();
  });

  it("启动时从设置读回台账（重启后不再问）", async () => {
    storeGet.mockImplementation((key: string) =>
      key === "trustedWidgets" ? Promise.resolve([widgetFingerprint("<div>persisted</div>")]) : Promise.resolve(undefined)
    );
    await ensureWidgetTrustLoaded();
    expect(isWidgetTrusted("<div>persisted</div>")).toBe(true);
    expect(isWidgetTrusted("<div>fresh</div>")).toBe(false);
  });

  it("Store 不可用时退回 localStorage（读写双向）", async () => {
    storeLoad.mockImplementation(() => Promise.reject(new Error("no store")));
    trustWidget("<div>fallback</div>");
    await flush();
    const raw = localStorage.getItem("trustedWidgets");
    expect(raw).toContain(widgetFingerprint("<div>fallback</div>"));

    // 重新起一轮（清内存台账，模拟重启）：应从 localStorage 读回
    __resetWidgetTrustForTest();
    await ensureWidgetTrustLoaded();
    expect(isWidgetTrusted("<div>fallback</div>")).toBe(true);
  });

  it("台账有上限，最旧的先淘汰", async () => {
    for (let i = 0; i < 320; i += 1) {
      trustWidget(`<div>${i}</div>`);
    }
    await flush();
    expect(isWidgetTrusted("<div>0</div>")).toBe(false);
    expect(isWidgetTrusted("<div>319</div>")).toBe(true);
    const persisted = storeSet.mock.calls[storeSet.mock.calls.length - 1]?.[1] as unknown as string[];
    expect(persisted.length).toBeLessThanOrEqual(300);
  });

  it("重复信任同一内容不重复写入", async () => {
    trustWidget("<div>demo</div>");
    await flush();
    storeSet.mockClear();
    trustWidget("<div>demo</div>");
    await flush();
    expect(storeSet).not.toHaveBeenCalled();
  });
});
