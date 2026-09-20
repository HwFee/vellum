import { beforeEach, describe, expect, it, vi } from "vitest";

// 内存版 Store：验证列表格式的读写与旧 key 迁移
const data = new Map<string, unknown>();
const setMock = vi.fn((key: string, value: unknown) => {
  data.set(key, value);
  return Promise.resolve();
});
const saveMock = vi.fn(() => Promise.resolve());
const deleteMock = vi.fn((key: string) => {
  data.delete(key);
  return Promise.resolve(true);
});

// 工厂在 import 期执行，故用 vi.hoisted 提前建桶（否则读到的常量还在 TDZ）
const flags = vi.hoisted(() => ({ failLoad: false }));

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(() =>
      flags.failLoad
        ? Promise.reject(new Error("store unavailable"))
        : Promise.resolve({
            get: (key: string) => Promise.resolve(data.get(key) ?? null),
            set: setMock,
            save: saveMock,
            delete: deleteMock,
          })
    ),
  },
}));

import { addRecent, loadRecentFiles, RECENT_FILES_LIMIT, removeRecent } from "./recentFiles";
import { __resetSettingsStoreForTest } from "./settings";

describe("recentFiles", () => {
  beforeEach(() => {
    data.clear();
    setMock.mockClear();
    saveMock.mockClear();
    deleteMock.mockClear();
    flags.failLoad = false;
    __resetSettingsStoreForTest();
  });

  it("新开一篇置顶，读回顺序与打开顺序相反", async () => {
    await addRecent("C:/vault/a.md");
    await addRecent("C:/vault/b.md");

    expect(setMock).toHaveBeenLastCalledWith("recentFiles", ["C:/vault/b.md", "C:/vault/a.md"]);
    await expect(loadRecentFiles()).resolves.toEqual(["C:/vault/b.md", "C:/vault/a.md"]);
  });

  it("同路径重开只留最新一条并置顶（大小写/分隔符写法不同也算同一条）", async () => {
    await addRecent("C:/vault/a.md");
    await addRecent("C:/vault/b.md");
    await addRecent("C:\\Vault\\A.MD");

    expect(setMock).toHaveBeenLastCalledWith("recentFiles", ["C:\\Vault\\A.MD", "C:/vault/b.md"]);
  });

  it(`最多保留 ${RECENT_FILES_LIMIT} 条，超出从最旧的开始丢弃`, async () => {
    for (let index = 0; index <= RECENT_FILES_LIMIT; index += 1) {
      await addRecent(`C:/vault/${index}.md`);
    }

    const list = await loadRecentFiles();
    expect(list).toHaveLength(RECENT_FILES_LIMIT);
    expect(list[0]).toBe(`C:/vault/${RECENT_FILES_LIMIT}.md`);
    // 最早打开的 0.md 已被挤掉，其余按新→旧排列
    expect(list).not.toContain("C:/vault/0.md");
    expect(list[RECENT_FILES_LIMIT - 1]).toBe("C:/vault/1.md");
  });

  it("迁移旧 key：recentFiles 不存在而 lastOpenedPath 有值时以其为种子，并删掉旧 key（迁移只做一次）", async () => {
    data.set("lastOpenedPath", "C:/notes/legacy.md");

    await expect(loadRecentFiles()).resolves.toEqual(["C:/notes/legacy.md"]);
    expect(deleteMock).toHaveBeenCalledWith("lastOpenedPath");
    expect(saveMock).toHaveBeenCalled();
    expect(data.has("lastOpenedPath")).toBe(false);
  });

  it("已显式清空（键存在但为 []）不再用旧 key 播种——失效条目不会复活", async () => {
    // 审阅 Important #1 的确定性链路：升级用户 → 种子 X → 打不开 → 摘掉并落盘 []
    data.set("recentFiles", []);
    data.set("lastOpenedPath", "C:/notes/gone.md");

    await expect(loadRecentFiles()).resolves.toEqual([]);
    // 摘掉一条不在列表里的路径时不得把旧种子算回来（修复前这里会返回 ["C:/notes/gone.md"]）
    await expect(removeRecent("C:/notes/never.md")).resolves.toEqual([]);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("迁移种子打不开被摘掉后也不复活：旧 key 已删除，列表不会再被播种", async () => {
    data.set("lastOpenedPath", "C:/notes/gone.md");

    // 启动：迁移读出种子，并就地删掉旧 key（种子只在内存里，Store 里本就没有 recentFiles 键）
    await expect(loadRecentFiles()).resolves.toEqual(["C:/notes/gone.md"]);
    expect(data.has("lastOpenedPath")).toBe(false);

    // 加载失败 ⇒ 摘掉该条
    await expect(removeRecent("C:/notes/gone.md")).resolves.toEqual([]);

    // 此后任何一次读取都不会把死路径算回来（修复前每次都会返回 ["C:/notes/gone.md"]）
    await expect(loadRecentFiles()).resolves.toEqual([]);
    await expect(removeRecent("C:/notes/never.md")).resolves.toEqual([]);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("迁移不覆盖已有列表：recentFiles 非空时忽略旧 key，也不删它", async () => {
    data.set("recentFiles", ["C:/notes/new.md"]);
    data.set("lastOpenedPath", "C:/notes/legacy.md");

    await expect(loadRecentFiles()).resolves.toEqual(["C:/notes/new.md"]);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("recentFiles 内容损坏（非数组）时按空列表处理，不从旧 key 补种", async () => {
    data.set("recentFiles", "corrupted");
    data.set("lastOpenedPath", "C:/notes/legacy.md");

    await expect(loadRecentFiles()).resolves.toEqual([]);
  });

  it("读取时剔除非法条目并去重（Store 内容可能被手改或来自旧版本）", async () => {
    data.set("recentFiles", ["C:/notes/a.md", "", 42, "C:/Notes/A.md", "C:/notes/b.md"]);

    await expect(loadRecentFiles()).resolves.toEqual(["C:/notes/a.md", "C:/notes/b.md"]);
  });

  it("removeRecent 摘掉一条并落盘；不在列表里则不写盘", async () => {
    data.set("recentFiles", ["C:/notes/a.md", "C:/notes/b.md"]);

    await expect(removeRecent("C:/Notes/B.md")).resolves.toEqual(["C:/notes/a.md"]);
    expect(setMock).toHaveBeenLastCalledWith("recentFiles", ["C:/notes/a.md"]);

    setMock.mockClear();
    await expect(removeRecent("C:/notes/never-opened.md")).resolves.toEqual(["C:/notes/a.md"]);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("Store 读失败时退化成空列表，不抛错", async () => {
    flags.failLoad = true;

    await expect(loadRecentFiles()).resolves.toEqual([]);
    // 写失败同样只吞不抛（下一次成功打开再补写）
    await expect(addRecent("C:/notes/a.md")).resolves.toEqual(["C:/notes/a.md"]);
  });
});
