import { beforeEach, describe, expect, it, vi } from "vitest";

// 内存版 Store：验证记录格式的读写与旧格式兼容
const data = new Map<string, unknown>();
const setMock = vi.fn((key: string, value: unknown) => {
  data.set(key, value);
  return Promise.resolve();
});
const saveMock = vi.fn(() => Promise.resolve());

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: () =>
      Promise.resolve({
        get: (key: string) => Promise.resolve(data.get(key) ?? null),
        set: setMock,
        save: saveMock,
      }),
  },
}));

import { loadScrollPosition, saveScrollPosition } from "./scrollMemory";

describe("scrollMemory", () => {
  beforeEach(() => {
    data.clear();
    setMock.mockClear();
    saveMock.mockClear();
  });

  it("保存并读回锚点记录", async () => {
    const record = {
      ratio: 0.42,
      anchorId: "section-a",
      anchorIndex: 3,
      offset: 120,
      blockIndex: 17,
      blockOffset: 36,
    };
    await saveScrollPosition("/a.md", record);
    expect(setMock).toHaveBeenCalledWith("/a.md", record);
    expect(saveMock).toHaveBeenCalled();
    await expect(loadScrollPosition("/a.md")).resolves.toEqual(record);
  });

  it("兼容旧版纯比例记录", async () => {
    data.set("/old.md", 0.75);
    await expect(loadScrollPosition("/old.md")).resolves.toEqual({ ratio: 0.75 });
  });

  it("无记录 / 非法记录返回 null", async () => {
    await expect(loadScrollPosition("/missing.md")).resolves.toBeNull();
    data.set("/bad.md", "not-a-record");
    await expect(loadScrollPosition("/bad.md")).resolves.toBeNull();
    data.set("/bad2.md", { ratio: 1.5 });
    await expect(loadScrollPosition("/bad2.md")).resolves.toBeNull();
    data.set("/bad3.md", { ratio: -0.1 });
    await expect(loadScrollPosition("/bad3.md")).resolves.toBeNull();
  });

  it("剔除记录中的非法字段", async () => {
    data.set("/mixed.md", {
      ratio: 0.5,
      anchorId: 123,
      anchorIndex: -2,
      offset: Number.NaN,
      blockIndex: -1,
      blockOffset: "bad",
    });
    await expect(loadScrollPosition("/mixed.md")).resolves.toEqual({ ratio: 0.5 });
  });

  it("无标题文档的块锚点记录完整读写", async () => {
    const record = { ratio: 0.9, blockIndex: 42, blockOffset: 128 };
    await saveScrollPosition("/log.md", record);
    await expect(loadScrollPosition("/log.md")).resolves.toEqual(record);
  });
});
