import {
  addRecentLibrary,
  loadRecentLibraries,
  removeRecentLibrary,
  RECENT_LIBRARIES_LIMIT,
} from "./recentLibraries";

const storeGet = vi.fn((_key: string): Promise<unknown> => Promise.resolve(undefined));
const storeSet = vi.fn((_key: string, _value: unknown) => Promise.resolve());
const storeSave = vi.fn(() => Promise.resolve());
const storeDelete = vi.fn((_key: string) => Promise.resolve(true));

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(() =>
      Promise.resolve({
        get: storeGet,
        set: storeSet,
        save: storeSave,
        delete: storeDelete,
      })
    ),
  },
}));

async function resetStore() {
  const { __resetSettingsStoreForTest } = await import("./settings");
  __resetSettingsStoreForTest();
}

beforeEach(async () => {
  await resetStore();
  storeGet.mockReset();
  storeGet.mockImplementation(() => Promise.resolve(undefined));
  storeSet.mockReset();
  storeSave.mockReset();
  storeDelete.mockReset();
});

it("空读返回空数组", async () => {
  expect(await loadRecentLibraries()).toEqual([]);
});

it("置顶去重、上限 8 条，与 recentFiles 同款 normalize", async () => {
  let stored: unknown = [
    { path: "D:/vaults/a", name: "a" },
    { path: "D:/vaults/b", name: "b" },
  ];
  storeGet.mockImplementation(() => Promise.resolve(stored));
  storeSet.mockImplementation((_key, value) => {
    stored = value;
    return Promise.resolve();
  });

  const next = await addRecentLibrary({ path: "D:/vaults/a", name: "a" });
  expect(next).toHaveLength(2);
  expect(next[0].path).toBe("D:/vaults/a");

  // 同一路径（大小写/分隔符差异）不重复进
  await addRecentLibrary({ path: "d:\\vaults\\a", name: "a" });
  expect(stored as unknown[]).toHaveLength(2);
});

it("name 缺省回落到路径末段（损坏数据不炸）", async () => {
  let stored: unknown = [{ path: "D:/vaults/wisdom" }];
  storeGet.mockImplementation(() => Promise.resolve(stored));
  const list = await loadRecentLibraries();
  expect(list[0].name).toBe("wisdom");
});

it("remove 不在列表里的路径是 no-op（不落盘）", async () => {
  let stored: unknown = [{ path: "D:/vaults/a", name: "a" }];
  storeGet.mockImplementation(() => Promise.resolve(stored));
  storeSet.mockImplementation((_k, v) => {
    stored = v;
    return Promise.resolve();
  });

  await removeRecentLibrary("D:/vaults/nothere");
  expect(stored as unknown[]).toHaveLength(1);
  expect(storeSet).not.toHaveBeenCalled();
});

it("RECENT_LIBRARIES_LIMIT 封顶", async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    path: `D:/lib/${i}`,
    name: `lib${i}`,
  }));
  storeGet.mockImplementation(() => Promise.resolve(many));
  const list = await loadRecentLibraries();
  expect(list).toHaveLength(RECENT_LIBRARIES_LIMIT);
});

it("持久化失败静默（不炸启动恢复路径）", async () => {
  storeSet.mockRejectedValueOnce(new Error("disk full"));
  const next = await addRecentLibrary({ path: "D:/vaults/x", name: "x" });
  expect(next[0].path).toBe("D:/vaults/x");
});
