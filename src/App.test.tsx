import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import "./components/MarkdownDocument";

const backendInvoke = vi.fn();
const drainInvoke = vi.fn(() => Promise.resolve<string[]>([]));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string, args?: unknown) =>
    command === "drain_pending_open_paths" ? drainInvoke() : backendInvoke(command, args)
  ),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

// 窗口实例与关窗处理器需可被用例断言：mock 工厂在 import 期执行，
// 故用 vi.hoisted 提前建桶（否则工厂运行时常量还在 TDZ）。
//
// 关窗语义必须与真机一致（@tauri-apps/api/window.js 的 onCloseRequested 包装层）：
// close()/系统关闭按钮都会发出**可拦截的** closeRequested，处理器全部 resolve 后，
// 若没有任何一处 preventDefault，包装层调用 destroy() 真正销毁窗口。
// 审查 C1（落盘失败时「拦截 → close() → 再拦截」死循环）正是在
// 「close() 是空 vi.fn()、不重发事件」的假语义下逃逸的，故这里必须回放处理器。
type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;

const windowMock = vi.hoisted(() => {
  // 递归上限：把无限重试变成可断言的失败（recursion），而不是让用例挂死
  const MAX_REPLAYS = 4;

  const mock = {
    closeHandlers: [] as CloseHandler[],
    instances: [] as Array<{
      close: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    }>,
    /// 关窗请求被处理的次数（>1 即「close 重试」）
    replays: 0,
    /// 窗口真正被销毁的次数（未拦截的关窗各计一次）
    destroyed: 0,
    /// 是否触发了递归 close（C1 的死循环特征）
    recursion: false,
    /// 在途关窗链：fire-and-forget 的递归 close 也会挂进来，settle() 据此等到静止
    chain: Promise.resolve() as Promise<void>,

    async replay(): Promise<void> {
      mock.replays += 1;
      if (mock.replays > MAX_REPLAYS) {
        mock.recursion = true;
        return;
      }
      let prevented = false;
      const event = {
        preventDefault: () => {
          prevented = true;
        },
      };
      for (const handler of [...mock.closeHandlers]) {
        await handler(event);
      }
      if (!prevented) {
        mock.destroyed += 1;
      }
    },

    /// 发出一次关窗请求（等价真机 close() / 系统关闭按钮）
    requestClose(): Promise<void> {
      mock.chain = mock.chain.then(() => mock.replay());
      return mock.chain;
    },

    /// 等到所有在途关窗处理静止（含处理器内部 fire-and-forget 的递归 close）
    async settle(): Promise<void> {
      for (let i = 0; i < 64; i += 1) {
        const current = mock.chain;
        await current;
        if (mock.chain === current) return;
      }
    },

    reset() {
      mock.closeHandlers.length = 0;
      mock.instances.length = 0;
      mock.replays = 0;
      mock.destroyed = 0;
      mock.recursion = false;
      mock.chain = Promise.resolve();
    },
  };
  return mock;
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => {
    const instance = {
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      close: vi.fn(() => windowMock.requestClose()),
      destroy: vi.fn(() => {
        windowMock.destroyed += 1;
        return Promise.resolve();
      }),
      show: vi.fn(() => Promise.resolve()),
      onCloseRequested: vi.fn((handler: CloseHandler) => {
        windowMock.closeHandlers.push(handler);
        return Promise.resolve(() => {});
      }),
    };
    windowMock.instances.push(instance);
    return instance;
  }),
}));

const lastOpenedGet = vi.fn(() => Promise.resolve<string | undefined>(undefined));
const storeGet = vi.fn((key: string): Promise<unknown> =>
  key === "lastOpenedPath" ? lastOpenedGet() : Promise.resolve(undefined)
);
const storeSet = vi.fn((_key: string, _value: unknown) => Promise.resolve());

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(() =>
      Promise.resolve({
        get: storeGet,
        set: storeSet,
        save: vi.fn(() => Promise.resolve()),
      })
    ),
  },
}));

// 拖放处理器需可被用例触发：mock 工厂在 import 期执行，故用 vi.hoisted 提前建桶
const dragDrop = vi.hoisted(() => ({
  handlers: [] as Array<(event: { payload: unknown }) => void>,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn((handler: (event: { payload: unknown }) => void) => {
      dragDrop.handlers.push(handler);
      return Promise.resolve(() => {});
    }),
  })),
}));

const loadedDoc = {
  path: "C:/notes/readme.md",
  fileName: "readme.md",
  parentPath: "C:/notes",
  markdown: "# Intro\n\n## Section\n\nBody text.",
};

// F40：`heavyDoc` 的界面接线用一条用例验证，但 800ms 阈值在 jsdom 里几乎不可能自然触发。
// 处置是「包装真实 hook、只注入阈值」——绝不 mock 掉 hook 自身，
// 否则这条用例测的就不是交付的会话状态机了（其余行为与真机逐字一致）。
const heavyCommitMsOverride = vi.hoisted(() => ({ value: undefined as number | undefined }));
vi.mock("./hooks/useDocumentEditor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./hooks/useDocumentEditor")>();
  return {
    ...actual,
    useDocumentEditor: (options: Parameters<typeof actual.useDocumentEditor>[0]) =>
      actual.useDocumentEditor(
        heavyCommitMsOverride.value === undefined
          ? options
          : { ...options, heavyCommitMs: heavyCommitMsOverride.value }
      ),
  };
});

async function loadDocument() {
  backendInvoke.mockResolvedValueOnce(loadedDoc);
  vi.mocked(open).mockResolvedValueOnce("C:/notes/readme.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument();
  });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.innerWidth = 1024;
  vi.mocked(invoke).mockClear();
  backendInvoke.mockReset();
  drainInvoke.mockReset();
  drainInvoke.mockResolvedValue([]);
  storeGet.mockClear();
  storeGet.mockImplementation((key: string): Promise<unknown> =>
    key === "lastOpenedPath" ? lastOpenedGet() : Promise.resolve(undefined)
  );
  storeSet.mockClear();
  storeSet.mockImplementation(() => Promise.resolve());
  lastOpenedGet.mockReset();
  lastOpenedGet.mockResolvedValue(undefined);
  dragDrop.handlers.length = 0;
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
  heavyCommitMsOverride.value = undefined;
  windowMock.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders the empty viewer state", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "素笺" })).toBeInTheDocument();
  expect(screen.getByText("打开 Markdown 文件开始查看。")).toBeInTheDocument();
});

test("renders the top bar", () => {
  render(<App />);
  expect(screen.getByText("未打开文件")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "打开文件" })).toBeInTheDocument();
});

test("drains pending open paths once at startup (multi-instance: no runtime forwarding event)", async () => {
  render(<App />);

  // 多实例（2026-09-12）：每个进程只 drain 自己的启动参数，
  // 不再有「pending-open-paths」运行期事件（其生产者单实例插件已移除），
  // 启动 drain 因此不需要等待任何监听就位。
  await waitFor(() => expect(drainInvoke).toHaveBeenCalledTimes(1));
  expect(vi.mocked(listen).mock.calls.some(([event]) => event === "pending-open-paths")).toBe(false);
});

test("loads the last-opened path after an empty startup drain", async () => {
  lastOpenedGet.mockResolvedValueOnce("C:/notes/last.md");
  backendInvoke.mockResolvedValueOnce({ ...loadedDoc, path: "C:/notes/last.md" });

  render(<App />);

  await waitFor(() => expect(backendInvoke).toHaveBeenCalledWith("load_document", {
    path: "C:/notes/last.md",
  }));
});

test("renders an initial drain error", async () => {
  drainInvoke.mockRejectedValueOnce("Cannot read pending paths");

  render(<App />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot read pending paths");
});

test("loads a selected Markdown file", async () => {
  vi.mocked(open).mockResolvedValueOnce("C:/notes/readme.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/readme.md",
    fileName: "readme.md",
    parentPath: "C:/notes",
    markdown: "# Loaded",
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("load_document", { path: "C:/notes/readme.md" });
  });
  await waitFor(
    () => expect(screen.getByRole("heading", { name: "Loaded" })).toBeInTheDocument(),
    { timeout: 3000 }
  );
  // 顶栏自 2026-09-18 起不再显示文件名（只报目录）：文件名出现在正文首行的大标题上
  expect(screen.getByRole("heading", { name: "readme" })).toBeInTheDocument();
});

test("renders a file load error", async () => {
  vi.mocked(open).mockResolvedValueOnce("C:/notes/missing.md");
  backendInvoke.mockRejectedValueOnce("Cannot open file");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot open file");
  expect(screen.getByText("C:/notes/missing.md")).toBeInTheDocument();
});

test("loads the latest queued startup Markdown file", async () => {
  vi.mocked(invoke).mockResolvedValueOnce([
    "C:/notes/older.md",
    "C:/notes/startup.md",
  ]);
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/startup.md",
    fileName: "startup.md",
    parentPath: "C:/notes",
    markdown: "# Startup",
  });

  render(<App />);

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("drain_pending_open_paths");
  });
  await waitFor(() => expect(screen.getByRole("heading", { name: "Startup" })).toBeInTheDocument());
  expect(invoke).not.toHaveBeenCalledWith("load_document", { path: "C:/notes/older.md" });
});

test("wikilink：打开文档时先解析目标再进入 ready，首帧就是已解析的锚点", async () => {
  const markdown = "# 笔记\n\n见 [[wiki/x]] 与 [[wiki/missing]]。";
  let textDuringResolve = "";

  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "load_document") {
      return { path: "C:/vault/note.md", fileName: "note.md", parentPath: "C:/vault", markdown };
    }
    if (command === "resolve_wikilinks") {
      // 解析调用发生的那一刻，正文必须还没提交到 DOM（否则首帧会是「未找到」纯文本）
      textDuringResolve = document.body.textContent ?? "";
      return { "wiki/x": "C:/vault/wiki/x.md", "wiki/missing": null };
    }
    return null;
  });
  vi.mocked(open).mockResolvedValueOnce("C:/vault/note.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "笔记" })).toBeInTheDocument());

  expect(backendInvoke).toHaveBeenCalledWith("resolve_wikilinks", {
    fromPath: "C:/vault/note.md",
    targets: ["wiki/x", "wiki/missing"],
  });
  expect(textDuringResolve).not.toContain("wiki/x");

  const anchor = document.querySelector("a.wikilink") as HTMLAnchorElement;
  expect(anchor).toHaveAttribute("data-wikilink", "wiki/x");
  // 解析不到的目标降级成纯文本，且方括号一个都不留在正文
  expect(document.querySelector(".wikilink--missing")).toHaveTextContent("wiki/missing");
  expect(document.querySelector(".markdown-body")?.textContent).not.toContain("[[");
});

test("wikilink：解析失败（IPC 抛错）不阻断打开，全部按未找到渲染", async () => {
  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "load_document") {
      return {
        path: "C:/vault/note.md",
        fileName: "note.md",
        parentPath: "C:/vault",
        markdown: "# 笔记\n\n见 [[wiki/x]]。",
      };
    }
    if (command === "resolve_wikilinks") throw new Error("resolver exploded");
    return null;
  });
  vi.mocked(open).mockResolvedValueOnce("C:/vault/note.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  expect(await screen.findByRole("heading", { name: "笔记" })).toBeInTheDocument();
  expect(document.querySelector("a.wikilink")).not.toBeInTheDocument();
  expect(document.querySelector(".wikilink--missing")).toHaveTextContent("wiki/x");
});

test("wikilink：点击库内链接用解析出的路径加载目标笔记", async () => {
  const resolveCalls: Array<{ fromPath: string; targets: string[] }> = [];

  backendInvoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_document") {
      const { path } = args as { path: string };
      return path === "C:/vault/wiki/x.md"
        ? {
            path,
            fileName: "x.md",
            parentPath: "C:/vault/wiki",
            markdown: "# 目标笔记\n\n回链 [[wiki/y]]。",
          }
        : {
            path,
            fileName: "note.md",
            parentPath: "C:/vault",
            markdown: "见 [[wiki/x]]。",
          };
    }
    if (command === "resolve_wikilinks") {
      const call = args as { fromPath: string; targets: string[] };
      resolveCalls.push(call);
      return call.fromPath === "C:/vault/note.md"
        ? { "wiki/x": "C:/vault/wiki/x.md" }
        : { "wiki/y": null };
    }
    return null;
  });
  vi.mocked(open).mockResolvedValueOnce("C:/vault/note.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  const anchor = await waitFor(() => {
    const link = document.querySelector("a.wikilink") as HTMLAnchorElement | null;
    expect(link).toBeInTheDocument();
    return link as HTMLAnchorElement;
  });
  fireEvent.click(anchor);

  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("load_document", { path: "C:/vault/wiki/x.md" })
  );
  expect(await screen.findByRole("heading", { name: "目标笔记" })).toBeInTheDocument();
  // 目标笔记自己的 wikilink 也重新解析了一遍（表随文档走）
  expect(resolveCalls.map((call) => call.fromPath)).toEqual([
    "C:/vault/note.md",
    "C:/vault/wiki/x.md",
  ]);
});

test("wikilink：热重载沿用原有解析表，新出现的目标异步补齐", async () => {
  vi.mocked(listen).mockClear();

  const resolveCalls: string[][] = [];
  let disk = {
    path: "C:/vault/note.md",
    fileName: "note.md",
    parentPath: "C:/vault",
    markdown: "见 [[wiki/x]]。",
  };

  backendInvoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_document") return disk;
    if (command === "resolve_wikilinks") {
      const { targets } = args as { targets: string[] };
      resolveCalls.push(targets);
      return Object.fromEntries(
        targets.map((target) => [target, `C:/vault/wiki/${target.split("/")[1]}.md`])
      );
    }
    return null;
  });
  vi.mocked(open).mockResolvedValueOnce("C:/vault/note.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(document.querySelector("a.wikilink")).toBeInTheDocument());

  // 磁盘上追加了一段带新链接的内容（mdlog 追加的常态）
  disk = { ...disk, markdown: "见 [[wiki/x]] 与 [[wiki/new]]。" };
  const fileChangedCall = vi.mocked(listen).mock.calls.find(([event]) => event === "file-changed");
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  // 补齐后两枚链接都在；解析只针对「表里没有的目标」整批重来一次
  await waitFor(() => expect(document.querySelectorAll("a.wikilink")).toHaveLength(2));
  expect(resolveCalls).toEqual([["wiki/x"], ["wiki/x", "wiki/new"]]);
});

test("wikilink：热重载时解析失败保留原有表，已解析的链接不降级", async () => {
  vi.mocked(listen).mockClear();

  let failResolve = false;
  let disk = {
    path: "C:/vault/note.md",
    fileName: "note.md",
    parentPath: "C:/vault",
    markdown: "见 [[wiki/x]]。",
  };

  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "load_document") return disk;
    if (command === "resolve_wikilinks") {
      if (failResolve) throw new Error("resolver exploded");
      return { "wiki/x": "C:/vault/wiki/x.md" };
    }
    return null;
  });
  vi.mocked(open).mockResolvedValueOnce("C:/vault/note.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(document.querySelector("a.wikilink")).toBeInTheDocument());

  failResolve = true;
  disk = { ...disk, markdown: "见 [[wiki/x]] 与 [[wiki/new]]。" };
  const fileChangedCall = vi.mocked(listen).mock.calls.find(([event]) => event === "file-changed");
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText(/wiki\/new/)).toBeInTheDocument());
  // 原有表保住：wiki/x 仍是锚点，补不上的新目标按「未找到」呈现
  expect(document.querySelectorAll("a.wikilink")).toHaveLength(1);
  expect(document.querySelector(".wikilink--missing")).toHaveTextContent("wiki/new");
});

/// 片段跳转的通用夹具：目标笔记 `wiki/x.md` 的阅读位置记忆 + 滚动容器 + 帧循环。
/// 记忆位置故意存成 0.5（19200 的一半）：片段跳转若**没有**跳过恢复，两个缓动动画会
/// 抢同一个容器（恢复后启动的那个胜出），最终落点就不是标题——一条断言同时锁住两件事。
function mockFragmentJump(scrollTop = 300, headingTop = 500) {
  mockScrollable(document.querySelector(".document-scroll") as HTMLElement, scrollTop);
  // 标题元素要到点击之后才存在于 DOM，实例级 spy 挂不上去，故 mock 原型方法；
  // 容器顶与其它元素一律 0（与既有用例的几何夹具同义）
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.id === "day-10" || this.id === "day-100") {
      return { top: headingTop, bottom: headingTop + 20 } as DOMRect;
    }
    return { top: 0, bottom: 0 } as DOMRect;
  });

  // jsdom 的 rAF 时序不足以等缓动自然跑完（要看真实时钟），接管帧循环：
  // 传入远超动画时长的帧时间戳，一帧即落到目标值
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });
  return () => {
    while (frames.length > 0) {
      frames.shift()!(performance.now() + 5000);
    }
  };
}

test("wikilink：点击 `#标题` 片段链接打开目标笔记并缓动滚到匹配的标题", async () => {
  backendInvoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_document") {
      const { path } = args as { path: string };
      return path === "C:/vault/wiki/x.md"
        ? {
            path,
            fileName: "x.md",
            parentPath: "C:/vault/wiki",
            markdown: "# 目标笔记\n\n## Day 10\n\n正文。",
          }
        : {
            path,
            fileName: "note.md",
            parentPath: "C:/vault",
            markdown: "见 [[wiki/x#Day 10]]。",
          };
    }
    if (command === "resolve_wikilinks") return { "wiki/x": "C:/vault/wiki/x.md" };
    return null;
  });
  vi.mocked(open).mockResolvedValueOnce("C:/vault/note.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  const anchor = await waitFor(() => {
    const link = document.querySelector("a.wikilink") as HTMLAnchorElement | null;
    expect(link).toBeInTheDocument();
    return link as HTMLAnchorElement;
  });
  // 片段经 hast 属性落到 DOM，再随点击进入 loadPath
  expect(anchor).toHaveAttribute("data-wikilink-fragment", "Day 10");

  storeGet.mockImplementation((key: string) =>
    Promise.resolve(key === "C:/vault/wiki/x.md" ? { ratio: 0.5 } : undefined)
  );
  const drainFrames = mockFragmentJump();

  fireEvent.click(anchor);

  await waitFor(() => expect(screen.getByRole("heading", { name: "Day 10" })).toBeInTheDocument());
  drainFrames();

  const container = document.querySelector(".document-scroll") as HTMLElement;
  // 跳转终点 = 正文内偏移 500（缓动到标题）；恢复记忆若生效落点会是 0.5 × 19200 = 9600
  expect(container.scrollTop).toBe(500);
});

test("wikilink：片段在目标笔记里落空（只差一个字符也不匹配）时照常打开，恢复旧阅读位置", async () => {
  backendInvoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_document") {
      const { path } = args as { path: string };
      return path === "C:/vault/wiki/x.md"
        ? {
            path,
            fileName: "x.md",
            parentPath: "C:/vault/wiki",
            markdown: "# 目标笔记\n\n## Day 100\n\n正文。",
          }
        : {
            path,
            fileName: "note.md",
            parentPath: "C:/vault",
            markdown: "见 [[wiki/x#Day 10]]。",
          };
    }
    if (command === "resolve_wikilinks") return { "wiki/x": "C:/vault/wiki/x.md" };
    return null;
  });
  vi.mocked(open).mockResolvedValueOnce("C:/vault/note.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  const anchor = await waitFor(() => {
    const link = document.querySelector("a.wikilink") as HTMLAnchorElement | null;
    expect(link).toBeInTheDocument();
    return link as HTMLAnchorElement;
  });

  storeGet.mockImplementation((key: string) =>
    Promise.resolve(key === "C:/vault/wiki/x.md" ? { ratio: 0.5 } : undefined)
  );
  const drainFrames = mockFragmentJump();

  fireEvent.click(anchor);

  // 笔记照常打开（片段落空绝不阻断打开），且「Day 100」这枚近似标题也确实在正文里
  expect(await screen.findByRole("heading", { name: "目标笔记" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Day 100" })).toBeInTheDocument();
  drainFrames();

  // 只认整段相等：`Day 10` 不许含糊地跳到 `Day 100`（跳到会落在 500），
  // 而是退回正常恢复路径（0.5 × 19200 = 9600）——恢复因此没被片段破坏
  const container = document.querySelector(".document-scroll") as HTMLElement;
  expect(container.scrollTop).toBe(9600);
});

test("wikilink：自引用片段（`[[本笔记#标题]]`）不换文档，直接缓动到该标题", async () => {
  const markdown = "# 笔记\n\n## Day 10\n\n正文。\n\n见 [[note#Day 10]]。";
  const loadPaths: string[] = [];
  backendInvoke.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "load_document") {
      const { path } = args as { path: string };
      loadPaths.push(path);
      return { path, fileName: "note.md", parentPath: "C:/vault", markdown };
    }
    if (command === "resolve_wikilinks") return { note: "C:/vault/note.md" };
    return null;
  });
  vi.mocked(open).mockResolvedValueOnce("C:/vault/note.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Day 10" })).toBeInTheDocument());

  const container = document.querySelector(".document-scroll") as HTMLElement;
  // 初始 0：跳转目标因此是纯粹的「正文内偏移 500」，不受热重载的像素兜底写入影响
  mockScrollable(container, 0);
  const dayTen = document.getElementById("day-10")!;
  vi.spyOn(dayTen, "getBoundingClientRect").mockReturnValue({ top: 500, bottom: 520 } as DOMRect);
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    frames.push(cb);
    return frames.length;
  });

  // 按角色取锚点：正文顶部现在还有一枚同名 inline title（h1.document-title），
  // 光凭文本 "note" 会命中两处
  fireEvent.click(screen.getByRole("link", { name: "note" }));

  await waitFor(() => expect(loadPaths).toEqual([
    "C:/vault/note.md",
    "C:/vault/note.md",
  ]));
  while (frames.length > 0) {
    frames.shift()!(performance.now() + 5000);
  }

  // 同路径分支（热重载，不换文档）也要把片段跳掉，否则这枚链接是死的
  expect(container.scrollTop).toBe(500);
});

test("resets the scroll position when a different document is opened", async () => {
  vi.mocked(open).mockResolvedValueOnce("C:/notes/a.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/a.md",
    fileName: "a.md",
    parentPath: "C:/notes",
    markdown: "# DocA",
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "DocA" })).toBeInTheDocument());

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 120;
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  expect(scrollContainer.scrollTop).toBe(120);

  vi.mocked(open).mockResolvedValueOnce("C:/notes/b.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/b.md",
    fileName: "b.md",
    parentPath: "C:/notes",
    markdown: "# DocB",
  });
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "DocB" })).toBeInTheDocument());
  expect(scrollContainer.scrollTop).toBe(0);
});

test("ignores a stale load response when a newer file was opened", async () => {
  let resolveFirst: (document: unknown) => void = () => {};
  const firstPromise = new Promise<unknown>((resolve) => {
    resolveFirst = resolve;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/a.md");
  backendInvoke.mockReturnValueOnce(firstPromise);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("load_document", { path: "C:/notes/a.md" }));

  vi.mocked(open).mockResolvedValueOnce("C:/notes/b.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/b.md",
    fileName: "b.md",
    parentPath: "C:/notes",
    markdown: "# DocB",
  });
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "DocB" })).toBeInTheDocument());

  // 先发起的慢响应最后才返回，不应覆盖新文档
  await act(async () => {
    resolveFirst({
      path: "C:/notes/a.md",
      fileName: "a.md",
      parentPath: "C:/notes",
      markdown: "# DocA",
    });
  });

  expect(screen.getByRole("heading", { name: "DocB" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "DocA" })).not.toBeInTheDocument();
});

test("silently reloads the document when file-changed event fires", async () => {
  vi.mocked(listen).mockClear();

  vi.mocked(open).mockResolvedValueOnce("C:/notes/reload.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/reload.md",
    fileName: "reload.md",
    parentPath: "C:/notes",
    markdown: "# V1",
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "V1" })).toBeInTheDocument());

  await waitFor(() => {
    expect(vi.mocked(listen).mock.calls.some(([event]) => event === "file-changed")).toBe(true);
  });

  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/reload.md",
    fileName: "reload.md",
    parentPath: "C:/notes",
    markdown: "# V2",
  });

  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByRole("heading", { name: "V2" })).toBeInTheDocument());
  expect(screen.queryByRole("heading", { name: "V1" })).not.toBeInTheDocument();
});

test("preserves scroll position across a hot reload", async () => {
  vi.mocked(listen).mockClear();

  vi.mocked(open).mockResolvedValueOnce("C:/notes/scroll.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/scroll.md",
    fileName: "scroll.md",
    parentPath: "C:/notes",
    markdown: "# ScrollDoc",
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "ScrollDoc" })).toBeInTheDocument());

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 240;
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });

  await waitFor(() => {
    expect(vi.mocked(listen).mock.calls.some(([event]) => event === "file-changed")).toBe(true);
  });

  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/scroll.md",
    fileName: "scroll.md",
    parentPath: "C:/notes",
    markdown: "# ScrollDoc Updated",
  });

  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByRole("heading", { name: "ScrollDoc Updated" })).toBeInTheDocument());
  expect(scrollContainer.scrollTop).toBe(240);
});

test("sticks to bottom and launches settle guard when hot reload occurs near bottom", async () => {
  vi.mocked(listen).mockClear();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);

  vi.mocked(open).mockResolvedValueOnce("C:/notes/stick.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/stick.md",
    fileName: "stick.md",
    parentPath: "C:/notes",
    markdown: "# Stick Doc V1",
  });

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Stick Doc V1" })).toBeInTheDocument(), { timeout: 5000 });

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 560;
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });

  // 1000 - 560 - 400 = 40 <= 80，判定为贴底
  await waitFor(() => {
    expect(vi.mocked(listen).mock.calls.some(([event]) => event === "file-changed")).toBe(true);
  });

  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/stick.md",
    fileName: "stick.md",
    parentPath: "C:/notes",
    markdown: "# Stick Doc V2\n\nAppended new lines.",
  });

  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Appended new lines.")).toBeInTheDocument());
  // 新内容渲染后 scrollTop 必须被设为最新的 scrollHeight (落底)
  expect(scrollContainer.scrollTop).toBe(scrollContainer.scrollHeight);
});

test("does not stick to bottom on hot reload while mdlog is active, preserving the reading position", async () => {
  vi.mocked(listen).mockClear();

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/nostick.md",
        fileName: "nostick.md",
        parentPath: "C:/notes",
        markdown: "# NoStick V1",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/nostick.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "NoStick V1" })).toBeInTheDocument());

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 560;
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });

  await waitFor(() => {
    expect(vi.mocked(listen).mock.calls.some(([event]) => event === "file-changed")).toBe(true);
  });

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/nostick.md",
        fileName: "nostick.md",
        parentPath: "C:/notes",
        markdown: "# NoStick V2\n\nModel appended a line.",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Model appended a line.")).toBeInTheDocument());
  // 距底 1000-560-400=40px（<=80，非记录态会吸底），但 mdlog 记录期间模型追加
  // 不得拽动窗口：滚动位置保持 560 不变
  expect(scrollContainer.scrollTop).toBe(560);
});

test("suppresses reload note and fresh-ink animation during hot reload when mdlog is active", async () => {
  vi.mocked(listen).mockClear();

  // 模拟当前文档存在存活的 sidecar
  backendInvoke.mockImplementation(async (cmd: string, _args?: unknown) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/live.md",
        fileName: "live.md",
        parentPath: "C:/notes",
        markdown: "# Live Doc V1",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Doc V1" })).toBeInTheDocument());

  // 触发 file-changed 热重载
  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/live.md",
        fileName: "live.md",
        parentPath: "C:/notes",
        markdown: "# Live Doc V2",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Doc V2" })).toBeInTheDocument());

  // 印章组件不得挂载
  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();
  // .document-content 上不得添加 fresh-ink 类名
  const docContent = document.querySelector(".document-content");
  expect(docContent).not.toHaveClass("fresh-ink");
});

test("keeps debounced scrollMemory saving during active mdlog and flushes upon disconnection", async () => {
  const saveSpy = vi.fn();
  storeSet.mockImplementation(saveSpy);
  const { Store } = await import("@tauri-apps/plugin-store");
  vi.mocked(Store.load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve(undefined)),
    set: storeSet,
    save: vi.fn(() => Promise.resolve()),
  } as unknown as Awaited<ReturnType<typeof Store.load>>);

  let activeState: { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null = {
    lastWriteAt: Date.now(),
    heartbeatAt: Date.now(),
    expiresAt: Date.now() + 120_000,
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/scroll-live.md",
        fileName: "scroll-live.md",
        parentPath: "C:/notes",
        markdown: "# Scroll Live\n\nLong body content.",
      };
    }
    if (cmd === "read_mdlog_state") {
      return activeState;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/scroll-live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Scroll Live" })).toBeInTheDocument());

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;

  // 连接建立瞬间应基线保存一次当前位置（强杀容错的第一道防线）
  await waitFor(() => {
    expect(saveSpy).toHaveBeenCalledWith("C:/notes/scroll-live.md", expect.any(Object));
  });
  saveSpy.mockClear();

  // 记录态下滚动仍会防抖保存（块索引锚点对末尾追加稳定，持续保存使强杀可恢复）
  vi.useFakeTimers();
  try {
    fireEvent.scroll(scrollContainer);
    // async act 同时推进防抖定时器并冲洗 saveScrollPosition 的 promise 链
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(saveSpy).toHaveBeenCalledWith("C:/notes/scroll-live.md", expect.any(Object));
  } finally {
    // 断言失败也必须交还真实定时器，否则后续用例的 waitFor 永远不推进
    vi.useRealTimers();
  }

  saveSpy.mockClear();

  // 模拟 sidecar 断开（mdlog-state-changed 返回 null）
  activeState = null;
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );
  await act(async () => {
    if (stateChangedCall) {
      (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
    }
  });

  // 断开时集中补写一次当前滚动位置
  await waitFor(() => {
    expect(saveSpy).toHaveBeenCalledWith("C:/notes/scroll-live.md", expect.any(Object));
  });
});

test("renders '记录中 · PI' badge when read_mdlog_state returns active state", async () => {
  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/live-doc.md",
        fileName: "live-doc.md",
        parentPath: "C:/notes",
        markdown: "# Live Title",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: 1_000_000,
        heartbeatAt: 1_000_000,
        expiresAt: 1_120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live-doc.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Title" })).toBeInTheDocument(), { timeout: 5000 });

  const badge = await screen.findByText("记录中 · PI");
  expect(badge).toBeInTheDocument();
  expect(badge).toHaveClass("mdlog-live");
  // 断言徽章位于 .document-content 容器内部
  expect(badge.parentElement).toHaveClass("document-content");
});

test("silently hides badge when expiresAt arrives and sidecar expired (Z1)", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  const now = Date.now();
  let stateResult: { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null = {
    lastWriteAt: now,
    heartbeatAt: now,
    expiresAt: now + 50_000,
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/expire.md",
        fileName: "expire.md",
        parentPath: "C:/notes",
        markdown: "# Expire Test",
      };
    }
    if (cmd === "read_mdlog_state") {
      return stateResult;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/expire.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Expire Test" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 模拟到期后 sidecar 判定失效（进程崩溃，无心跳）
  stateResult = null;

  // 快进 50_000ms 到达 expiresAt
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50_000);
  });

  await waitFor(() => {
    expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument();
  });

  vi.useRealTimers();
});

test("keeps badge alive across 200s idle time when heartbeat refreshes (Z1 spec §9.2)", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  let currentTime = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => currentTime);

  let stateResult = {
    lastWriteAt: 1_000_000,
    heartbeatAt: 1_000_000,
    expiresAt: 1_120_000, // +120s
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/idle.md",
        fileName: "idle.md",
        parentPath: "C:/notes",
        markdown: "# Idle Session",
      };
    }
    if (cmd === "read_mdlog_state") {
      return stateResult;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/idle.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Idle Session" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 模拟空闲期间每 30s 刷新一次心跳，持续至 200s（无内容写，但 heartbeatAt/expiresAt 递增）
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );

  for (let t = 30_000; t <= 200_000; t += 30_000) {
    currentTime = 1_000_000 + t;
    stateResult = {
      lastWriteAt: 1_000_000, // 内容未变
      heartbeatAt: currentTime,
      expiresAt: currentTime + 120_000,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      if (stateChangedCall) {
        (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
      }
    });
  }

  // 200s 后徽章依旧保持存活
  expect(screen.getByText("记录中 · PI")).toBeInTheDocument();

  vi.useRealTimers();
});

test("clears timer and unmounts badge when switching to a regular document", async () => {
  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      return {
        path: p,
        fileName: p.endsWith("live.md") ? "live.md" : "plain.md",
        parentPath: "C:/notes",
        markdown: p.endsWith("live.md") ? "# Live" : "# Plain",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 切换到普通文档（read_mdlog_state 返回 null）
  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      return {
        path: p,
        fileName: "plain.md",
        parentPath: "C:/notes",
        markdown: "# Plain",
      };
    }
    if (cmd === "read_mdlog_state") {
      return null;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/plain.md");
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Plain" })).toBeInTheDocument());
  expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument();
});

test("switching from active mdlog doc A to regular doc B never overwrites A with ratio: 0 and only persists A once via loadPath", async () => {
  const saveSpy = vi.fn();
  storeSet.mockImplementation(saveSpy);
  const { Store } = await import("@tauri-apps/plugin-store");
  vi.mocked(Store.load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve(undefined)),
    set: saveSpy,
    save: vi.fn(() => Promise.resolve()),
  } as unknown as Awaited<ReturnType<typeof Store.load>>);

  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      return {
        path: p,
        fileName: p.endsWith("live.md") ? "live.md" : "plain.md",
        parentPath: "C:/notes",
        markdown: p.endsWith("live.md") ? "# Live Heading\n\nLive content" : "# Plain Heading\n\nPlain content",
      };
    }
    if (cmd === "read_mdlog_state") {
      return {
        lastWriteAt: Date.now(),
        heartbeatAt: Date.now(),
        expiresAt: Date.now() + 120_000,
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/live.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Live Heading" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 模拟文档 A 已有阅读位置（如 scrollTop > 0，有真实比例与高度）
  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  Object.defineProperty(scrollContainer, "scrollTop", { value: 300, writable: true, configurable: true });
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, writable: true, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 500, writable: true, configurable: true });

  saveSpy.mockClear();

  // 切换到文档 B（模拟真实的异步加载延时）
  let resolveLoadDoc!: (value: unknown) => void;
  const loadDocPromise = new Promise((resolve) => {
    resolveLoadDoc = resolve;
  });

  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      if (p.endsWith("plain.md")) {
        await loadDocPromise;
      }
      return {
        path: p,
        fileName: "plain.md",
        parentPath: "C:/notes",
        markdown: "# Plain Heading\n\nPlain content",
      };
    }
    if (cmd === "read_mdlog_state") {
      return null;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/plain.md");
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  // 等待切换过渡态渲染（此时处于 loading 态）
  await waitFor(() => expect(screen.getByText("加载中...")).toBeInTheDocument());

  // 此时完成异步加载
  resolveLoadDoc(undefined);

  await waitFor(() => expect(screen.getByRole("heading", { name: "Plain Heading" })).toBeInTheDocument());

  // 提取针对文档 A ("C:/notes/live.md") 的所有保存调用
  const docASaveCalls = saveSpy.mock.calls.filter(([path]) => path === "C:/notes/live.md");

  // 断言：A 的位置只被 loadPath 的正常保存写入一次
  expect(docASaveCalls).toHaveLength(1);

  // 断言：绝不能写入 { ratio: 0 }
  for (const [, position] of docASaveCalls) {
    expect(position).not.toEqual({ ratio: 0 });
    expect((position as { ratio: number }).ratio).toBeGreaterThan(0);
  }
});

test("scheduleRecheck ignores late-resolving response if document path changed during await", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  let resolveLateRecheck!: (val: unknown) => void;
  const lateRecheckPromise = new Promise((resolve) => {
    resolveLateRecheck = resolve;
  });

  let recheckCount = 0;

  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      return {
        path: p,
        fileName: p.endsWith("docA.md") ? "docA.md" : "docB.md",
        parentPath: "C:/notes",
        markdown: p.endsWith("docA.md") ? "# Doc A" : "# Doc B",
      };
    }
    if (cmd === "read_mdlog_state") {
      recheckCount++;
      if (recheckCount === 1) {
        // docA 初次加载返回活跃态
        return {
          lastWriteAt: Date.now(),
          heartbeatAt: Date.now(),
          expiresAt: Date.now() + 500,
        };
      }
      if (recheckCount === 2) {
        // 第一次 scheduleRecheck 触发的 read_mdlog_state，挂起等待
        return lateRecheckPromise;
      }
      return null;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/docA.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Doc A" })).toBeInTheDocument());
  expect(await screen.findByText("记录中 · PI")).toBeInTheDocument();

  // 前进定时器触发 scheduleRecheck
  act(() => {
    vi.advanceTimersByTime(600);
  });

  // 在挂起期间切换到 docB
  vi.mocked(open).mockResolvedValueOnce("C:/notes/docB.md");
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Doc B" })).toBeInTheDocument());
  expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument();

  // 此时让 docA 的迟到 recheck 完成并返回活跃态
  await act(async () => {
    resolveLateRecheck({
      lastWriteAt: Date.now(),
      heartbeatAt: Date.now(),
      expiresAt: Date.now() + 120_000,
    });
  });

  // docB 绝不能被污染挂载徽章
  expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument();

  vi.useRealTimers();
});

test("checkState event handler ignores late-resolving response if document path changed during await", async () => {
  let resolveLateEventCheck!: (val: unknown) => void;
  const lateEventCheckPromise = new Promise((resolve) => {
    resolveLateEventCheck = resolve;
  });

  let readCount = 0;
  backendInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === "load_document") {
      const p = (args as { path: string }).path;
      return {
        path: p,
        fileName: p.endsWith("docA.md") ? "docA.md" : "docB.md",
        parentPath: "C:/notes",
        markdown: p.endsWith("docA.md") ? "# Doc A" : "# Doc B",
      };
    }
    if (cmd === "read_mdlog_state") {
      readCount++;
      if (readCount === 1) {
        // docA 初始为常规文档
        return null;
      }
      if (readCount === 2) {
        // 事件触发的查询被挂起
        return lateEventCheckPromise;
      }
      return null;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/docA.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Doc A" })).toBeInTheDocument());

  // 触发 mdlog-state-changed 事件
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );
  expect(stateChangedCall).toBeDefined();
  act(() => {
    (stateChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  // 在查询挂起期间切换到 docB
  vi.mocked(open).mockResolvedValueOnce("C:/notes/docB.md");
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Doc B" })).toBeInTheDocument());

  // 此时事件查询迟到返回 docA 的活跃态
  await act(async () => {
    resolveLateEventCheck({
      lastWriteAt: Date.now(),
      heartbeatAt: Date.now(),
      expiresAt: Date.now() + 120_000,
    });
  });

  // docB 绝不能被污染挂载徽章
  expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument();
});

test("cleans up active scroll restore settle guard when App unmounts", async () => {
  const scrollRestoreModule = await import("./lib/scrollRestore");
  const originalRestore = scrollRestoreModule.restoreScrollPosition;
  const cleanupSpy = vi.fn();
  const restoreSpy = vi.spyOn(scrollRestoreModule, "restoreScrollPosition").mockImplementation((...args) => {
    const realCleanup = originalRestore(...args);
    return () => {
      cleanupSpy();
      realCleanup();
    };
  });

  storeGet.mockImplementation((key: string) => {
    if (key === "C:/notes/unmount-test.md") {
      return Promise.resolve({ ratio: 0.5 });
    }
    return Promise.resolve(undefined);
  });

  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/unmount-test.md",
    fileName: "unmount-test.md",
    parentPath: "C:/notes",
    markdown: "# Unmount Test",
  });
  vi.mocked(open).mockResolvedValueOnce("C:/notes/unmount-test.md");

  const { unmount } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Unmount Test" })).toBeInTheDocument());
  expect(restoreSpy).toHaveBeenCalled();
  expect(cleanupSpy).not.toHaveBeenCalled();

  unmount();

  expect(cleanupSpy).toHaveBeenCalledTimes(1);
  restoreSpy.mockRestore();
});

test("P6: handleContentRendered skips async scroll position restore if bottom arbitration has already occurred", async () => {
  let resolveStoreGet!: (value: unknown) => void;
  const storeGetPromise = new Promise((resolve) => {
    resolveStoreGet = resolve;
  });

  storeGet.mockImplementation((key: string) => {
    if (key === "C:/logs/p6-test.md") {
      return storeGetPromise;
    }
    return Promise.resolve(undefined);
  });

  let currentDocMarkdown = "# Log Doc\n\nLine 1";
  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/logs/p6-test.md",
        fileName: "p6-test.md",
        parentPath: "C:/logs",
        markdown: currentDocMarkdown,
      };
    }
    if (cmd === "read_mdlog_state") {
      // P6 场景（贴底仲裁抢在异步记忆恢复前完成）以非记录态为前提：
      // mdlog 记录期间热重载本就不吸底，谈不上「仲裁已过」，必须返回 null
      return null;
    }
    return undefined;
  });

  const scrollRestoreModule = await import("./lib/scrollRestore");
  const restoreSpy = vi.spyOn(scrollRestoreModule, "restoreScrollPosition");

  vi.mocked(open).mockResolvedValueOnce("C:/logs/p6-test.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Log Doc" })).toBeInTheDocument());

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 600;
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });

  // 模拟在异步 loadScrollPosition 尚未 resolve 时，快速到达一次热重载追加并触发贴底仲裁
  currentDocMarkdown = "# Log Doc\n\nLine 1\n\nNew line appended";
  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  // 此时已发生贴底仲裁，restoreSpy 被调用且参数为 { ratio: 1 }
  expect(restoreSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    { ratio: 1 },
    expect.anything()
  );
  const callsBeforeResolve = restoreSpy.mock.calls.length;

  // 此时异步 loadScrollPosition 完成，返回历史记忆位置 { ratio: 0.3 }
  await act(async () => {
    resolveStoreGet({ ratio: 0.3 });
  });

  // P6 断言：由于已发生贴底仲裁，.then 回调必须跳过历史记忆恢复，restoreScrollPosition 不被再次调用
  expect(restoreSpy.mock.calls.length).toBe(callsBeforeResolve);
  restoreSpy.mockRestore();
});

test("hot reload with unchanged content is a no-op: no reloadTick, no scroll arbitration (F30 早退)", async () => {
  // 磁盘内容与内存逐字符相同 —— 我方写入的 watcher 回声场景（裁定 F30）：
  // 必须不更新状态、不递增 reloadTick、不闪印章、不做滚动补偿。
  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/notes/same.md",
        fileName: "same.md",
        parentPath: "C:/notes",
        markdown: "# Unchanged Content\n\nLine 1\nLine 2",
      };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/same.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Unchanged Content" })).toBeInTheDocument());

  const container = document.querySelector(".document-scroll") as HTMLElement;
  // 距底 1000 − 380 − 600 = 20px ≤ 80：若滚动仲裁被执行，这里会被吸底成 scrollHeight=1000
  Object.defineProperty(container, "scrollTop", { value: 380, writable: true, configurable: true });
  Object.defineProperty(container, "scrollHeight", { value: 1000, writable: true, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, writable: true, configurable: true });

  const reloadCall = vi.mocked(listen).mock.calls.find(([event]) => event === "file-changed");
  expect(reloadCall).toBeDefined();
  await act(async () => {
    (reloadCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  // 非空断言：分流确实读过一次盘（否则本用例会因「处理器没跑」而假绿）
  expect(
    backendInvoke.mock.calls.filter(([command]) => command === "load_document")
  ).toHaveLength(2);
  // 判据：内容未变 ⇒ 无 reloadTick ⇒ 布局 effect 不跑 ⇒ 位置与印章都不动
  expect(container.scrollTop).toBe(380);
  expect(document.querySelector(".reload-note")).toBeNull();
});

test("layout effect arbitrates scroll on hot reload even when markdown content is unchanged (via reloadTick)", async () => {
  // 布局 effect 的依赖是 [markdown, reloadTick]：同路径重开（系统关联 / 第二实例深链）
  // 时 markdown 字符串逐字符相同，React 视为未变化，唯一能驱动仲裁的就是 reloadTick。
  // 故这条路径是本用例名的真实落点（F30 之后 file-changed 已不再承载「内容未变」的场景）。
  // 断掉 rAF：让缓动动画一帧都不走，仲裁写入的 scrollTop 可被精确断言
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);

  const markdown = "# Unchanged Content\n\nLine 1\nLine 2";
  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return { path: "C:/notes/same.md", fileName: "same.md", parentPath: "C:/notes", markdown };
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/notes/same.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Unchanged Content" })).toBeInTheDocument());

  const scrollRestoreModule = await import("./lib/scrollRestore");
  const restoreSpy = vi.spyOn(scrollRestoreModule, "restoreScrollPosition");

  const container = document.querySelector(".document-scroll") as HTMLElement;
  // 距底 20px ≤ 80：命中「mdlog 非记录态 + 贴底 ⇒ 吸底跟随」分支
  Object.defineProperty(container, "scrollTop", { value: 380, writable: true, configurable: true });
  Object.defineProperty(container, "scrollHeight", { value: 1000, writable: true, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, writable: true, configurable: true });

  // 同路径二次打开：loadPath 走 reloadCurrent（静默热重载）⇒ reloadTick 递增
  vi.mocked(open).mockResolvedValueOnce("C:/notes/same.md");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  });

  expect(
    backendInvoke.mock.calls.filter(([command]) => command === "load_document")
  ).toHaveLength(2);
  // 贴底仲裁写入 scrollHeight（rAF 已断，缓动不会覆盖它）：
  // 去掉 reloadTick 依赖或删掉贴底分支，这里都会停在 380
  expect(container.scrollTop).toBe(1000);
  // 贴底分支同时按 ratio 1 重锚（与既有 P6 用例同一判据）
  expect(restoreSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    { ratio: 1 },
    expect.anything()
  );
  // reloadTick 递增的可见证据：非 mdlog 热重载的「墨迹未干」印章
  expect(screen.getByText("墨迹未干")).toBeInTheDocument();
  restoreSpy.mockRestore();
});


test("end-to-end: live mdlog lifecycle from bottom stickiness to disconnection recovery", async () => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
  vi.useFakeTimers({ shouldAdvanceTime: true });

  const saveSpy = vi.fn();
  storeSet.mockImplementation(saveSpy);
  const { Store } = await import("@tauri-apps/plugin-store");
  vi.mocked(Store.load).mockResolvedValue({
    get: vi.fn(() => Promise.resolve(undefined)),
    set: saveSpy,
    save: vi.fn(() => Promise.resolve()),
  } as unknown as Awaited<ReturnType<typeof Store.load>>);

  let currentDocMarkdown = "# Session Log\n\nInitial message.";
  let liveState: { lastWriteAt: number; heartbeatAt: number; expiresAt: number } | null = {
    lastWriteAt: 1_000_000,
    heartbeatAt: 1_000_000,
    expiresAt: 1_120_000,
  };

  backendInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "load_document") {
      return {
        path: "C:/logs/pi.md",
        fileName: "pi.md",
        parentPath: "C:/logs",
        markdown: currentDocMarkdown,
      };
    }
    if (cmd === "read_mdlog_state") {
      return liveState;
    }
    return undefined;
  });

  vi.mocked(open).mockResolvedValueOnce("C:/logs/pi.md");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

  await waitFor(() => expect(screen.getByRole("heading", { name: "Session Log" })).toBeInTheDocument());

  // 1. 验证徽章渲染且副作用抑制开启
  expect(screen.getByText("记录中 · PI")).toBeInTheDocument();
  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();

  const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
  let scrollTop = 600;
  Object.defineProperty(scrollContainer, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollContainer, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scrollContainer, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });

  // 2. 模拟热重载（贴底状态下追加对话）
  currentDocMarkdown = "# Session Log\n\nInitial message.\n\nNew AI response appended.";
  const fileChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "file-changed"
  );
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("New AI response appended.")).toBeInTheDocument());
  // mdlog 记录期间模型追加禁止吸底跟随（新规则）：即便当前在底部，位置也保持 600 不变；印章不挂载
  expect(scrollContainer.scrollTop).toBe(600);
  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();

  // 3. 用户主动上滑查看历史（滚至顶部 scrollTop = 100，距离底部 1000 - 100 - 400 = 500 > 80）
  scrollTop = 100;
  fireEvent.wheel(scrollContainer);

  // 再次发生热重载
  currentDocMarkdown = "# Session Log\n\nInitial message.\n\nNew AI response appended.\n\nAnother turn.";
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Another turn.")).toBeInTheDocument());
  // 用户不在底部，滚动位置必须严格保持在 100，不得强制落底
  expect(scrollContainer.scrollTop).toBe(100);

  // 4. 会话结束断开（sidecar 删除或心跳超时，返回 null）
  saveSpy.mockClear();
  liveState = null;
  const stateChangedCall = vi.mocked(listen).mock.calls.find(
    ([event]) => event === "mdlog-state-changed"
  );
  await act(async () => {
    if (stateChangedCall) {
      (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
    }
  });

  // 徽章静默隐藏，阅读位置集中补写一次
  await waitFor(() => expect(screen.queryByText("记录中 · PI")).not.toBeInTheDocument());
  expect(saveSpy).toHaveBeenCalledWith("C:/logs/pi.md", expect.any(Object));

  // 5. 断开后的普通热重载恢复印章显示
  currentDocMarkdown = "# Session Log\n\nManual edit by user.";
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Manual edit by user.")).toBeInTheDocument());
  expect(screen.getByText("墨迹未干")).toBeInTheDocument();

  // P5: 若印章正在显示时文件变为活跃 mdlog 并触发新 reloadTick，早退前必须立即隐藏印章，防止常驻。
  //（裁定 F30 后，与内存一致的内容会被当作「无变更」整体忽略、不产生 reloadTick，
  //  故这里让磁盘内容真的变一下——等价于 mdlog 重连后的首次追加。）
  await act(async () => {
    liveState = {
      lastWriteAt: 1_000_000,
      heartbeatAt: 1_000_000,
      expiresAt: 1_120_000,
    };
    if (stateChangedCall) {
      (stateChangedCall[1] as (payload: unknown) => void)({ payload: {} });
    }
  });

  currentDocMarkdown = "# Session Log\n\nManual edit by user.\n\nNew session turn.";
  await act(async () => {
    (fileChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  expect(screen.queryByText("墨迹未干")).not.toBeInTheDocument();

  vi.useRealTimers();
});


/// 宽度回流的真机几何模型（jsdom 无布局，必须自建）：
/// 视口 top = 文档坐标 − scrollTop（若返回与 scrollTop 无关的固定 top，补偿量会被
/// 重复计入，量出的行为与真机不符）；块取足够高以跨过视口顶，否则锚点候选为空。
function mockSidebarReflow(
  container: HTMLElement,
  block: HTMLElement,
  docTops: { open: number; closed: number },
  blockHeight = 2600
) {
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
  vi.spyOn(block, "getBoundingClientRect").mockImplementation(() => {
    const open = !!document.querySelector(".outline-sidebar--open");
    const top = (open ? docTops.open : docTops.closed) - container.scrollTop;
    return { top, bottom: top + blockHeight } as DOMRect;
  });
}

/// 给滚动容器装上可读写的 scrollTop/scrollHeight/clientHeight（jsdom 默认全 0、只读语义）
function mockScrollable(container: HTMLElement, initial: number, scrollHeight = 20000, clientHeight = 800) {
  let scrollTop = initial;
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, v);
    },
  });
  Object.defineProperty(container, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(container, "clientHeight", { configurable: true, get: () => clientHeight });
}

describe("App outline integration", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.mocked(open).mockClear();
  });

  it("toggles the outline panel open and closed", async () => {
    await loadDocument();
    const toggle = screen.getByRole("button", { name: "切换大纲" });

    // 默认关闭
    expect(document.querySelector(".outline-sidebar--open")).not.toBeInTheDocument();

    // 点击打开
    fireEvent.click(toggle);
    expect(document.querySelector(".outline-sidebar--open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Section" })).toBeInTheDocument();

    // 再点击关闭
    fireEvent.click(toggle);
    expect(document.querySelector(".outline-sidebar--open")).not.toBeInTheDocument();
  });

  it("侧栏开关引起的宽度回流期间钉住视口（Chromium 原生锚定不补偿行内尺寸变化）", async () => {
    await loadDocument();

    const container = document.querySelector(".document-scroll") as HTMLElement;
    const intro = document.getElementById("intro")!;
    mockScrollable(container, 3000);
    // 真机几何：正文更窄 ⇒ 行数更多 ⇒ 文档更高。开侧栏时首块文档坐标 3100，关闭后 2500
    mockSidebarReflow(container, intro, { open: 3100, closed: 2500 });
    const toggle = screen.getByRole("button", { name: "切换大纲" });

    // 打开：文档整体变高 600px、内容下移 ⇒ 补偿 600px 把视口顶部那块钉回原位
    fireEvent.click(toggle);
    expect(container.scrollTop).toBe(3600);
    expect(intro.getBoundingClientRect().top).toBe(-500);
    // 同时进入布局过渡窗（热重载延迟合并提交、widget 高度过渡关停）
    expect(document.querySelector(".app-shell--layout-shifting")).toBeInTheDocument();

    // 关闭：文档整体变矮 600px、内容上移 ⇒ 反向补偿，内容仍在同一视口位置
    fireEvent.click(toggle);
    expect(container.scrollTop).toBe(3000);
    expect(intro.getBoundingClientRect().top).toBe(-500);
  });

  it("Ctrl+K 打开侧栏同样钉住视口（快捷键不得被当成用户滚动而取消钉住）", async () => {
    // 起始关闭（默认态）：让 Ctrl+K 成为本实例里的**第一次**侧栏操作——真机首次按
    // Ctrl+K 时快捷键监听注册在滚动输入监听之前，时间戳会落在钉住开始之后；「任何
    // keydown 都记时间戳」的写法会在这一拍当场取消钉住（而这正是快捷键路径比顶栏按钮跳的原因）
    await loadDocument();

    const container = document.querySelector(".document-scroll") as HTMLElement;
    const intro = document.getElementById("intro")!;
    mockScrollable(container, 3000);
    mockSidebarReflow(container, intro, { open: 3100, closed: 2500 });

    // jsdom 的 performance.now() 精度粗，同一次事件里两次取样相等，看不出「快捷键被
    // 当成用户滚动」这回事；这里用单调递增的细粒度时钟，把真机（Chromium）的时序逼出来。
    let clock = 100000;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 0.1));

    // 快捷键开侧栏：文档变高 600px，内容下移 600px ⇒ 必须补偿回 3600
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(document.querySelector(".outline-sidebar--open")).toBeInTheDocument();
    expect(container.scrollTop).toBe(3600);
    // 内容没动：同一块相对容器顶仍是 −500（未补偿的话会留在 3000，视口内容整体下移 600）
    expect(intro.getBoundingClientRect().top).toBe(-500);
  });

  it("文档内锚点链接（Markdown 标准语法）接管点击：缓动滚到目标，不再交给浏览器改 hash", async () => {
    backendInvoke.mockResolvedValueOnce({
      ...loadedDoc,
      markdown: "# Intro\n\n[回到顶部](#main)\n\n## Section\n\n[去 Section](#section)",
    });
    vi.mocked(open).mockResolvedValueOnce("C:/notes/anchors.md");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Section" })).toBeInTheDocument());

    const container = document.querySelector(".document-scroll") as HTMLElement;
    mockScrollable(container, 300);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    const section = document.getElementById("section")!;
    vi.spyOn(section, "getBoundingClientRect").mockReturnValue({ top: 500, bottom: 520 } as DOMRect);
    // jsdom 的 rAF 时序不足以等待动画自然跑完（缓动要看真实时钟），改为接管帧循环：
    // 传入远超动画时长的帧时间戳，一帧即落到目标值
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const drainFrames = () => {
      while (frames.length > 0) {
        const cb = frames.shift()!;
        cb(performance.now() + 5000);
      }
    };

    // 真实存在的锚点：滚到目标（300 + 500），且点击不发 hash 跳转
    expect(fireEvent.click(screen.getByText("去 Section"))).toBe(false);
    drainFrames();
    expect(container.scrollTop).toBe(800);
    expect(window.location.hash).toBe("");

    // #main 不在文档里，但它是 HTML 导出文档里最常见的「页面主区域」id ⇒ 视为回到顶部
    fireEvent.click(screen.getByText("回到顶部"));
    drainFrames();
    expect(container.scrollTop).toBe(0);
  });

  it("找不到目标且非顶部约定的锚点：不动，也不让浏览器改写 hash", async () => {
    backendInvoke.mockResolvedValueOnce({
      ...loadedDoc,
      markdown: "# Intro\n\n[空链接](#nothing-here)",
    });
    vi.mocked(open).mockResolvedValueOnce("C:/notes/dead-anchor.md");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Intro" })).toBeInTheDocument());

    const container = document.querySelector(".document-scroll") as HTMLElement;
    mockScrollable(container, 300);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);

    expect(fireEvent.click(screen.getByText("空链接"))).toBe(false);
    await act(async () => {});
    expect(container.scrollTop).toBe(300);
    expect(window.location.hash).toBe("");
  });

  it("shows an empty outline message when the document has no headings", async () => {
    backendInvoke.mockResolvedValueOnce({
      ...loadedDoc,
      markdown: "Just plain text.",
    });
    vi.mocked(open).mockResolvedValueOnce("C:/notes/plain.md");

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

    await waitFor(() => expect(screen.getByText("Just plain text.")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));

    expect(screen.getByText("本文档暂无目录")).toBeInTheDocument();
  });

  it("scrolls to the heading when an outline item is clicked", async () => {
    await loadDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));

    // jsdom 的 getBoundingClientRect 全为 0，mock 出标题位于视口下方 500px
    const section = document.getElementById("section")!;
    vi.spyOn(section, "getBoundingClientRect").mockReturnValue({ top: 500 } as DOMRect);
    const raf = vi.spyOn(window, "requestAnimationFrame");

    fireEvent.click(screen.getByRole("button", { name: "Section" }));

    // 点击后应启动 rAF 缓动滚动动画
    await waitFor(() => expect(raf).toHaveBeenCalled());
  });

  it("cancels the heading-jump animation when the user scrolls", async () => {
    await loadDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));

    const section = document.getElementById("section")!;
    vi.spyOn(section, "getBoundingClientRect").mockReturnValue({ top: 500 } as DOMRect);
    const cancel = vi.spyOn(window, "cancelAnimationFrame");

    fireEvent.click(screen.getByRole("button", { name: "Section" }));
    const scrollContainer = document.querySelector(".document-scroll") as HTMLElement;
    fireEvent.wheel(scrollContainer);

    // 用户滚动应取消进行中的跳转动画
    await waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it("closes the outline after selecting a heading on narrow windows", async () => {
    window.innerWidth = 500;

    await loadDocument();
    // 默认关闭：先打开，才谈得上「选章后自动关闭」
    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));
    expect(document.querySelector(".outline-sidebar--open")).toBeInTheDocument();

    const intro = document.getElementById("intro")!;
    vi.spyOn(intro, "scrollIntoView");

    fireEvent.click(screen.getByRole("button", { name: "Intro" }));

    await waitFor(() => expect(document.querySelector(".outline-sidebar--open")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "切换大纲" })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the outline scrim when open on narrow windows", async () => {
    window.innerWidth = 500;

    await loadDocument();
    // 默认关闭：不渲染遮罩
    expect(document.querySelector(".outline-scrim")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));
    expect(document.querySelector(".outline-scrim")).toBeInTheDocument();
  });

  it("closes the outline when the scrim is clicked", async () => {
    window.innerWidth = 500;

    await loadDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));
    const scrim = document.querySelector(".outline-scrim");
    expect(scrim).toBeInTheDocument();
    fireEvent.click(scrim!);

    await waitFor(() => expect(document.querySelector(".outline-sidebar--open")).not.toBeInTheDocument());
  });

  it("closes the outline with Escape on narrow windows", async () => {
    window.innerWidth = 500;

    await loadDocument();
    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));
    expect(document.querySelector(".outline-sidebar--open")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(document.querySelector(".outline-sidebar--open")).not.toBeInTheDocument());
  });

  it("adds the outline-open layout class to the body", async () => {
    await loadDocument();

    // 默认关闭：不带 outline-open 类
    expect(document.querySelector(".app-shell__body--outline-open")).not.toBeInTheDocument();

    // 打开后带上
    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));
    expect(document.querySelector(".app-shell__body--outline-open")).toBeInTheDocument();
  });

  it("keeps rendered images mounted when outline state changes", async () => {
    backendInvoke.mockResolvedValueOnce({
      ...loadedDoc,
      markdown: "# Intro\n\n![Preview](https://example.com/preview.png)",
    });
    vi.mocked(open).mockResolvedValueOnce("C:/notes/readme.md");

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

    const imageBeforeToggle = await screen.findByRole("img", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));

    expect(screen.getByRole("img", { name: "Preview" })).toBe(imageBeforeToggle);
  });

  it("F8/C7: re-opening the same path does not destroy ready state or widget iframe", async () => {
    const docPath = "C:/notes/live-widget.md";
    const doc = {
      path: docPath,
      fileName: "live-widget.md",
      parentPath: "C:/notes",
      // 必须带 mdlog:v1 头：autoMount 仅对受信 mdlog 日志生效，否则交互块停在
      // 「点击加载」占位块上，iframe 根本不会挂载，本用例就测不到保活语义。
      markdown:
        "<!-- mdlog:v1 s=123 -->\n\n# Title\n\n```vellum-widget\n<div>persisted widget</div>\n```",
    };

    let loadDocumentCalls = 0;
    let gateSecondLoad: ((value: unknown) => void) | null = null;
    backendInvoke.mockImplementation((command: string) => {
      if (command === "load_document") {
        loadDocumentCalls += 1;
        // 第二次加载挂起，留出观察窗口：bug 下 loading 帧会在 resolve 之前浮现
        if (loadDocumentCalls === 1) return Promise.resolve(doc);
        return new Promise((resolve) => {
          gateSecondLoad = resolve;
        });
      }
      if (command === "read_mdlog_state") {
        return {
          lastWriteAt: 1000,
          heartbeatAt: 1000,
          expiresAt: Date.now() + 120_000,
        };
      }
      if (command === "register_widget") {
        return Promise.resolve({
          id: "w-persist-1",
          url: "http://vellum-widget.localhost/w-persist-1",
        });
      }
      return Promise.resolve(undefined);
    });

    // jsdom 的 IntersectionObserver 桩件永不回调，需模拟「进入视口」才会走注册→挂载流程
    vi.spyOn(globalThis, "IntersectionObserver").mockImplementation(function (
      this: unknown,
      callback: IntersectionObserverCallback
    ) {
      return {
        observe: vi.fn(() => {
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
          );
        }),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "200px",
        thresholds: [0],
      } as unknown as IntersectionObserver;
    });

    // 1. 首次打开文档并等待 iframe 挂载
    vi.mocked(open).mockResolvedValueOnce(docPath);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

    const iframeBefore = await screen.findByTitle("交互演示");
    expect(iframeBefore).toBeInTheDocument();

    // 2. 同路径二次 open（例如由系统/第二实例再次请求相同路径）
    vi.mocked(open).mockResolvedValueOnce(docPath);
    fireEvent.click(screen.getByRole("button", { name: "打开文件" }));

    // 给 loading 帧充分浮现的机会（若实现有 bug，此处就能看到「加载中...」与 iframe 被卸）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByText("加载中...")).not.toBeInTheDocument();
    expect(document.contains(iframeBefore)).toBe(true);

    await act(async () => {
      gateSecondLoad?.(doc);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(loadDocumentCalls).toBe(2);
    const iframeAfter = screen.getByTitle("交互演示");
    // 核心断言：同路径重开绝不能销毁原有 iframe DOM 实例
    expect(iframeAfter).toBe(iframeBefore);
    // 保活的等价证据：未重建沙箱就不会再走一次 register_widget
    expect(
      backendInvoke.mock.calls.filter(([command]) => command === "register_widget")
    ).toHaveLength(1);
  });
});

// ===== 块级就地编辑接线（Task 6） =====

function blockEditorInput(): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>("textarea.block-editor__input");
}

/// 该事件的监听在挂载时注册（不是本次测试设的 mockImplementation），
/// 因此必须从 listen 的调用记录里取处理器 —— 否则拿到 undefined，用例会变成
/// 「回调从未触发」的空断言。
function fileChangedHandler(): (payload: unknown) => void {
  const call = vi.mocked(listen).mock.calls.find(([event]) => event === "file-changed");
  expect(call).toBeTruthy();
  return call![1] as (payload: unknown) => void;
}

async function enterEditingView(): Promise<void> {
  fireEvent.keyDown(window, { key: "e", ctrlKey: true });
  await waitFor(() => expect(document.querySelector("[data-vellum-unit]")).not.toBeNull());
}

async function activateBlockText(text: string): Promise<HTMLTextAreaElement> {
  fireEvent.click(screen.getByText(text));
  return waitFor(() => {
    const textarea = blockEditorInput();
    expect(textarea).not.toBeNull();
    return textarea!;
  });
}

/// App 自己调用 getCurrentWindow().close() 的次数。裁定 F33 要求成功路径不自行 close()
/// （不 preventDefault 时 JS 包装层会 await 处理器后自行 destroy）；
/// 失败路径更不能 close() —— 那正是 C1 的死循环。
function selfCloseCalls(): number {
  return windowMock.instances.reduce(
    (total, instance) => total + instance.close.mock.calls.length,
    0
  );
}

/// 落盘调用记录（F38：必须恰好一次且载荷不含重复段）
function saveDocumentCalls(): Array<{ path: string; content: string }> {
  return backendInvoke.mock.calls
    .filter(([command]) => command === "save_document")
    .map(([, args]) => args as { path: string; content: string });
}

test("Ctrl+E 进入编辑视图，点击块激活就地编辑，提交后落盘", async () => {
  await loadDocument();
  await enterEditingView();

  // 编辑视图标记：正文 article 与覆盖层宿主都要带编辑态类名
  expect(document.querySelector(".markdown-body--editing")).not.toBeNull();
  expect(document.querySelector(".document-scroll__content--editing")).not.toBeNull();

  const textarea = await activateBlockText("Body text.");
  // 草稿即块原文（覆盖层宿主是 .document-scroll__content 的直接子元素）
  expect(textarea.value).toBe("Body text.");
  expect(textarea.parentElement).toHaveClass("document-scroll__content");

  fireEvent.change(textarea, { target: { value: "Body text edited." } });
  fireEvent.keyDown(textarea, { key: "Escape" });

  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("save_document", {
      path: loadedDoc.path,
      content: expect.stringContaining("Body text edited."),
    })
  );
  // 提交后覆盖层卸载，正文更新
  await waitFor(() => expect(blockEditorInput()).toBeNull());
  expect(screen.getByText("Body text edited.")).toBeInTheDocument();
});

test("mdlog 记录中不得进入编辑视图", async () => {
  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "load_document") return loadedDoc;
    if (command === "read_mdlog_state") {
      return { lastWriteAt: 1, heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000 };
    }
    return undefined;
  });
  vi.mocked(open).mockResolvedValueOnce(loadedDoc.path);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByText("记录中 · PI")).toBeInTheDocument());

  fireEvent.keyDown(window, { key: "e", ctrlKey: true });

  expect(document.querySelector("textarea.block-editor__input")).toBeNull();
  expect(document.querySelector(".markdown-body--editing")).toBeNull();
  expect(screen.getByText("记录中 · 断开连接后才能修改")).toBeInTheDocument();

  // 记录中点击正文块同样不得激活覆盖层。原断言（覆盖层仍为 null）是恒真的：
  // editable=false 时正文根本没挂 data-vellum-unit，点击本来就不可能走到激活路径。
  // 改为直接断言「块标记未挂载」—— 这才是顶栏禁用之外的门禁证据。
  expect(document.querySelector("[data-vellum-unit]")).toBeNull();
  fireEvent.click(screen.getByText("Body text."));
  expect(document.querySelector("textarea.block-editor__input")).toBeNull();
});

test("mdlog 记录中无活动块时 Ctrl+S 不弹「记录已开始」", async () => {
  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "load_document") return loadedDoc;
    if (command === "read_mdlog_state") {
      return { lastWriteAt: 1, heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000 };
    }
    return undefined;
  });
  vi.mocked(open).mockResolvedValueOnce(loadedDoc.path);

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByText("记录中 · PI")).toBeInTheDocument());

  // F6 的全局兜底让 commitActive 在阅读态可达；无活动块时必须是静默 no-op
  expect(fireEvent.keyDown(window, { key: "s", ctrlKey: true })).toBe(false);
  expect(screen.queryByText(/记录已开始/)).toBeNull();
  expect(document.querySelector(".editor-toast")).toBeNull();
  expect(backendInvoke).not.toHaveBeenCalledWith("save_document", expect.anything());
});

test("空态按 Ctrl+E 不进入编辑视图（顶栏不呈按下态）", () => {
  render(<App />);
  fireEvent.keyDown(window, { key: "e", ctrlKey: true });

  expect(document.querySelector(".document-scroll__content--editing")).toBeNull();
  expect(screen.getByRole("button", { name: "切换编辑视图" })).toHaveAttribute(
    "aria-pressed",
    "false"
  );
});

test("Ctrl+B 切换侧栏开关，焦点在搜索框上时也能关闭", () => {
  render(<App />);
  expect(document.querySelector(".outline-sidebar--open")).toBeNull();

  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(document.querySelector(".outline-sidebar--open")).toBeInTheDocument();

  // 侧栏已开且搜索框聚焦：Ctrl+K 只保焦不关闭，关闭必须走 Ctrl+B
  const searchInput = screen.getByLabelText("搜索文档内容");
  searchInput.focus();
  fireEvent.keyDown(searchInput, { key: "k", ctrlKey: true });
  expect(document.querySelector(".outline-sidebar--open")).toBeInTheDocument();

  fireEvent.keyDown(searchInput, { key: "b", ctrlKey: true });
  expect(document.querySelector(".outline-sidebar--open")).toBeNull();
});

test("全局 Ctrl+S 拦截 WebView 默认保存并在有活动块时提交", async () => {
  await loadDocument();

  // 阅读视图（无活动块）：仍须吞掉 WebView 自带的「保存网页」对话框
  expect(fireEvent.keyDown(window, { key: "s", ctrlKey: true })).toBe(false);
  expect(backendInvoke).not.toHaveBeenCalledWith("save_document", expect.anything());

  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text via keyboard." } });

  // 焦点不在编辑框、按在 window 上也要能提交（F6：全局兜底）
  expect(fireEvent.keyDown(window, { key: "s", ctrlKey: true })).toBe(false);
  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("save_document", {
      path: loadedDoc.path,
      content: expect.stringContaining("Body text via keyboard."),
    })
  );
});

test("编辑框内 Ctrl+S 只提交一次：结构变化草稿不重复拼入、不二次落盘（F38）", async () => {
  await loadDocument();
  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  // 草稿改变块结构（补一个空行再写一句）正是终审 C2 的复现输入：
  // 没有去重时，第二次提交拿「新 markdown 的同索引单元」当原文比对 ⇒ 不相等 ⇒ 把草稿再拼一遍。
  fireEvent.change(textarea, { target: { value: "Body text.\n\nNew paragraph." } });
  backendInvoke.mockClear();

  // 焦点在编辑框内按 Ctrl+S（不是打在 window 上）：真机里事件从 textarea 冒泡到 window，
  // 两条提交通道必须同时生效。
  fireEvent.keyDown(textarea, { key: "s", ctrlKey: true });

  await waitFor(() => expect(saveDocumentCalls()).toHaveLength(1));
  // 再空转一轮，给「第二次提交」留出发生的机会（无闸门时它在同一次派发里同步发生）
  await act(async () => {});

  const saves = saveDocumentCalls();
  expect(saves).toHaveLength(1);
  expect(saves[0].path).toBe(loadedDoc.path);
  expect(saves[0].content).toBe("# Intro\n\n## Section\n\nBody text.\n\nNew paragraph.");
  expect(saves[0].content.match(/New paragraph\./g)).toHaveLength(1);
});

test("覆盖层的直接父元素是 .document-scroll__content--editing（F41：DOM 层位置守卫）", async () => {
  await loadDocument();
  await enterEditingView();
  const textarea = await activateBlockText("Body text.");

  // 位置无关的 querySelector 不能发现接线漂移：必须按 F23 的直接子元素关系断言，
  // 否则覆盖层被挪进 .markdown-body（特异度 0,1,1 会压过 0,2,0）时测试依旧全绿。
  expect(
    document.querySelector(".document-scroll__content--editing > textarea.block-editor__input")
  ).toBe(textarea);
  expect(textarea.parentElement).toHaveClass("document-scroll__content--editing");
  expect(textarea.closest(".markdown-body")).toBeNull();
});

test("落盘失败后切换文档：上一份文档的草稿不得带进新文档（F39）", async () => {
  await loadDocument();
  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "旧文档的草稿。" } });

  // 落盘必然失败（只读/被占用/目录被删）：F24 会把会话留在原地并保留草稿
  backendInvoke.mockImplementation((command: string) =>
    command === "save_document" ? Promise.reject("磁盘只读") : Promise.resolve(undefined)
  );
  fireEvent.keyDown(textarea, { key: "Escape" });
  await waitFor(() => expect(screen.getByText("保存失败：磁盘只读")).toBeInTheDocument());
  expect(blockEditorInput()?.value).toBe("旧文档的草稿。");

  // 切换文档（失败时 loadPath 仍会继续加载新文档）；落盘继续失败，
  // 故 F24 的「保留草稿 + 重新激活」会把会话一直带过文档边界 —— 正是终审 I1 的复现条件
  vi.mocked(open).mockResolvedValueOnce("C:/notes/other.md");
  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "save_document") throw "磁盘只读";
    if (command === "load_document") {
      return {
        path: "C:/notes/other.md",
        fileName: "other.md",
        parentPath: "C:/notes",
        // 与 A 同构：同序号块存在，才会暴露「B 的块被隐藏、框里却是 A 的草稿」
        markdown: "# Other\n\n## Section\n\nBody text elsewhere.",
      };
    }
    return undefined;
  });
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument());

  // 新文档不得带着上一份的草稿：覆盖层清场、没有块被隐藏
  expect(blockEditorInput()).toBeNull();
  expect(screen.getByText("Body text elsewhere.")).toBeVisible();
  expect(document.querySelector('[data-vellum-unit][style*="visibility"]')).toBeNull();

  // 后续提交触发（Esc/Ctrl+S/失焦）也不得把 A 的草稿拼进 B
  backendInvoke.mockImplementation(async () => undefined);
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await act(async () => {});
  expect(saveDocumentCalls().filter((call) => call.path === "C:/notes/other.md")).toHaveLength(0);
  // 此处两处失败尝试都只针对原文档（切文档前的尽力提交）
  expect(saveDocumentCalls().filter((call) => call.path === loadedDoc.path)).toHaveLength(2);
  expect(backendInvoke).toHaveBeenCalledWith("save_document", {
    path: loadedDoc.path,
    content: expect.stringContaining("旧文档的草稿。"),
  });
});

test("重文档：提交耗时超阈值后在编辑视图内挂出常驻软提示（F40）", async () => {
  // heavyCommitMs: 0 ⇒ 任何一次提交都判为「重文档」，不必真跑 800ms
  heavyCommitMsOverride.value = 0;
  await loadDocument();
  await enterEditingView();

  // 未观测到超阈值提交前不出现（软提示是实测结果，不是文档体积启发式）
  expect(screen.queryByText(/本文档较大/)).toBeNull();

  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text heavy." } });
  fireEvent.keyDown(textarea, { key: "Escape" });

  const hint = await screen.findByText(/本文档较大/);
  expect(hint).toHaveClass("editor-hint");
  // 常驻：提交后覆盖层已卸载（不再有活动块），提示仍在编辑视图里
  await waitFor(() => expect(blockEditorInput()).toBeNull());
  expect(screen.getByText(/本文档较大/)).toBeInTheDocument();
});

test("自己的写入回声不触发「墨迹未干」印章", async () => {
  await loadDocument();
  const fileChanged = fileChangedHandler();

  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });
  fireEvent.keyDown(textarea, { key: "Escape" });
  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("save_document", {
      path: loadedDoc.path,
      content: expect.stringContaining("Body text edited."),
    })
  );

  // 模拟我方写入引发的 watcher 回声：磁盘内容与最近一次落盘内容一致
  backendInvoke.mockImplementation((command: string) =>
    command === "load_document"
      ? Promise.resolve({ ...loadedDoc, markdown: "# Intro\n\n## Section\n\nBody text edited." })
      : Promise.resolve(undefined)
  );
  await act(async () => {
    fileChanged({ payload: {} });
  });

  expect(screen.queryByText("墨迹未干")).toBeNull();
  expect(document.querySelector(".document-content")).not.toHaveClass("fresh-ink");
});

test("mdlog 记录中外部追加：静默热重载，不弹「文件已被外部修改」（裁定 F32）", async () => {
  let currentDocMarkdown = "# Log\n\n第一段。";
  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "load_document") {
      return {
        path: "C:/logs/pi.md",
        fileName: "pi.md",
        parentPath: "C:/logs",
        markdown: currentDocMarkdown,
      };
    }
    if (command === "read_mdlog_state") {
      return { lastWriteAt: 1, heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000 };
    }
    return undefined;
  });
  vi.mocked(open).mockResolvedValueOnce("C:/logs/pi.md");

  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByText("记录中 · PI")).toBeInTheDocument());

  // 模型追加 ⇒ 常态的 file-changed：无人编辑，不得弹「编辑已取消」
  const fileChanged = fileChangedHandler();
  currentDocMarkdown = "# Log\n\n第一段。\n\n追加段。";
  await act(async () => {
    fileChanged({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("追加段。")).toBeInTheDocument());
  expect(screen.queryByText("文件已被外部修改 · 编辑已取消")).toBeNull();
  expect(document.querySelector(".editor-toast")).toBeNull();
});

test("外部改动回退：不再因旧落盘快照被当回声吞掉（裁定 F30）", async () => {
  await loadDocument();
  const fileChanged = fileChangedHandler();

  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });
  fireEvent.keyDown(textarea, { key: "Escape" });
  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("save_document", {
      path: loadedDoc.path,
      content: expect.stringContaining("Body text edited."),
    })
  );

  // ① 外部把文件改成别的内容 ⇒ 照常热重载
  backendInvoke.mockImplementation((command: string) =>
    command === "load_document"
      ? Promise.resolve({
          ...loadedDoc,
          markdown: "# Intro\n\n## Section\n\nBody text from elsewhere.",
        })
      : Promise.resolve(undefined)
  );
  await act(async () => {
    fileChanged({ payload: {} });
  });
  await waitFor(() => expect(screen.getByText("Body text from elsewhere.")).toBeInTheDocument());

  // ② 外部又把文件改回「我方上次写入的内容」。按固定快照（lastSavedMarkdownRef）判回声的实现
  //    会把它当成自己的回声整体忽略，视图永久停在 elsewhere；与内存 markdown 比对则认出
  //    这是外部变更（内存 ≠ 磁盘），照常热重载。
  backendInvoke.mockImplementation((command: string) =>
    command === "load_document"
      ? Promise.resolve({ ...loadedDoc, markdown: "# Intro\n\n## Section\n\nBody text edited." })
      : Promise.resolve(undefined)
  );
  await act(async () => {
    fileChanged({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("Body text edited.")).toBeInTheDocument());
  expect(screen.queryByText("Body text from elsewhere.")).toBeNull();
});

test("外部变更不误判为回声：照常热重载并提示编辑已取消", async () => {
  await loadDocument();
  const fileChanged = fileChangedHandler();

  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });
  fireEvent.keyDown(textarea, { key: "Escape" });
  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("save_document", {
      path: loadedDoc.path,
      content: expect.stringContaining("Body text edited."),
    })
  );

  // 裁定 F32：中断提示只在确有编辑会话时出现 —— 重新激活一块并改草稿，
  // 模拟「编辑进行中文件被外部改写」
  const resumed = await activateBlockText("Body text edited.");
  fireEvent.change(resumed, { target: { value: "Body text in progress." } });

  // 磁盘内容与我方最近写入不同 ⇒ 外部变更：必须热重载（印章照闪）
  backendInvoke.mockImplementation((command: string) =>
    command === "load_document"
      ? Promise.resolve({
          ...loadedDoc,
          markdown: "# Intro\n\n## Section\n\nBody text from elsewhere.",
        })
      : Promise.resolve(undefined)
  );
  await act(async () => {
    fileChanged({ payload: {} });
  });

  await waitFor(() =>
    expect(screen.getByText("Body text from elsewhere.")).toBeInTheDocument()
  );
  expect(screen.getByText("文件已被外部修改 · 编辑已取消")).toBeInTheDocument();
  expect(screen.getByText("墨迹未干")).toBeInTheDocument();
});

test("保存失败后退回阅读视图不留下孤悬覆盖层，草稿可再进编辑视图找回", async () => {
  await loadDocument();
  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });

  // 落盘失败 ⇒ hook 回退内存并重新激活同一块（裁定 F24），但 toggleView 仍会退回阅读视图（I3）
  backendInvoke.mockImplementationOnce(() => Promise.reject("磁盘只读"));
  fireEvent.keyDown(window, { key: "e", ctrlKey: true });

  await waitFor(() => expect(screen.getByText("保存失败：磁盘只读")).toBeInTheDocument());
  // 界面保持一致：覆盖层与编辑态类名一起消失（units 已为空，留着覆盖层就没有定位基准）
  expect(blockEditorInput()).toBeNull();
  expect(document.querySelector(".document-scroll__content--editing")).toBeNull();
  expect(screen.getByText("Body text.")).toBeInTheDocument();

  // 但草稿没有丢：再进编辑视图即原样带回
  await enterEditingView();
  const restored = await waitFor(() => {
    const element = blockEditorInput();
    expect(element).not.toBeNull();
    return element!;
  });
  expect(restored.value).toBe("Body text edited.");
});

test("编辑中 mdlog 变活跃：草稿尽力写入剪贴板、中断编辑并退回阅读视图", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  await loadDocument();
  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });

  // 记录建立：sidecar 状态经事件上报（不必等轮询到期）
  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "load_document") return loadedDoc;
    if (command === "read_mdlog_state") {
      return { lastWriteAt: 1, heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000 };
    }
    return undefined;
  });
  const stateChangedCall = vi
    .mocked(listen)
    .mock.calls.find(([event]) => event === "mdlog-state-changed");
  await act(async () => {
    (stateChangedCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  await waitFor(() => expect(screen.getByText("记录中 · PI")).toBeInTheDocument());
  expect(screen.getByText(/编辑已取消/)).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith("Body text edited.");
  expect(blockEditorInput()).toBeNull();
  expect(document.querySelector(".document-scroll__content--editing")).toBeNull();
  expect(document.querySelector(".markdown-body--editing")).toBeNull();

  delete (navigator as unknown as { clipboard?: unknown }).clipboard;
});

test("关窗请求：有未提交草稿时先落盘，提交完成后由包装层销毁窗口", async () => {
  await loadDocument();

  // 无活动块：不拦截 ⇒ 包装层自行 destroy
  expect(windowMock.closeHandlers.length).toBeGreaterThan(0);
  await act(async () => {
    await windowMock.requestClose();
    await windowMock.settle();
  });
  expect(windowMock.replays).toBe(1);
  expect(windowMock.destroyed).toBe(1);
  // 成功路径不自行 close()（F33）：窗口销毁由包装层负责
  expect(selfCloseCalls()).toBe(0);

  // 有未提交草稿：拦下本次关闭的判定必须在提交之后 —— 提交成功则不拦截，包装层销毁窗口
  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });

  await act(async () => {
    await windowMock.requestClose();
    await windowMock.settle();
  });
  expect(backendInvoke).toHaveBeenCalledWith("save_document", {
    path: loadedDoc.path,
    content: expect.stringContaining("Body text edited."),
  });
  expect(windowMock.replays).toBe(2);
  expect(windowMock.destroyed).toBe(2);
  expect(selfCloseCalls()).toBe(0);
});

test("关窗时落盘失败：窗口保持打开且不重试关闭（审查 C1）", async () => {
  await loadDocument();
  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });

  // 落盘必然失败（文件只读/被占用/目录被删等）：草稿必须留在框里让用户处理，
  // 且绝不能自行 close() —— 真机上 close() 会重发 closeRequested，形成无限提交循环。
  backendInvoke.mockImplementation((command: string) =>
    command === "save_document" ? Promise.reject("磁盘只读") : Promise.resolve(undefined)
  );

  await act(async () => {
    await windowMock.requestClose();
    await windowMock.settle();
  });

  expect(windowMock.replays).toBe(1);
  expect(windowMock.recursion).toBe(false);
  expect(windowMock.destroyed).toBe(0);
  // 失败路径绝不自行 close()（F33）：重发 closeRequested 就是 C1 的死循环
  expect(selfCloseCalls()).toBe(0);
  expect(screen.getByText("保存失败：磁盘只读")).toBeInTheDocument();
  expect(blockEditorInput()?.value).toBe("Body text edited.");
});

test("切换文档前先提交活动块：草稿落回原文档，不写进新文档", async () => {
  await loadDocument();
  await enterEditingView();
  const textarea = await activateBlockText("Body text.");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });

  // 未经失焦的切换（OS 关联 / 第二实例深链走 loadPath）：jsdom 的 click 不会移焦，
  // 因此这条用例只可能由 loadPath 的「先提交」满足
  vi.mocked(open).mockResolvedValueOnce("C:/notes/other.md");
  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "load_document") {
      return {
        path: "C:/notes/other.md",
        fileName: "other.md",
        parentPath: "C:/notes",
        markdown: "# Other\n\nBody text elsewhere.",
      };
    }
    return undefined;
  });
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument());

  expect(backendInvoke).toHaveBeenCalledWith("save_document", {
    path: loadedDoc.path,
    content: expect.stringContaining("Body text edited."),
  });
  const savedPaths = backendInvoke.mock.calls
    .filter(([command]) => command === "save_document")
    .map(([, args]) => (args as { path: string }).path);
  expect(savedPaths).toEqual([loadedDoc.path]);
  // 覆盖层随提交清场，新文档以阅读渲染呈现
  expect(blockEditorInput()).toBeNull();
  expect(screen.getByText("Body text elsewhere.")).toBeInTheDocument();
});

// ===== 最近打开 + 拖放打开接线（Task 4） =====

/// 拖放处理器在挂载时注册，且只注册一次；用例经此取出它来派发事件
async function dragDropHandler(): Promise<(event: { payload: unknown }) => void> {
  return waitFor(() => {
    expect(dragDrop.handlers.length).toBeGreaterThan(0);
    return dragDrop.handlers[0];
  });
}

function dropTarget(): Element | null {
  return document.querySelector(".document-scroll--drop-target");
}

test("启动恢复读 recentFiles[0]（新格式优先于旧 key）", async () => {
  storeGet.mockImplementation((key: string) =>
    Promise.resolve(key === "recentFiles" ? ["C:/notes/newest.md", "C:/notes/older.md"] : undefined)
  );
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/newest.md",
    fileName: "newest.md",
    parentPath: "C:/notes",
    markdown: "# Newest",
  });

  render(<App />);

  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("load_document", { path: "C:/notes/newest.md" })
  );
  expect(backendInvoke).not.toHaveBeenCalledWith("load_document", { path: "C:/notes/older.md" });
});

test("成功打开文档后把该路径置顶写入 recentFiles", async () => {
  await loadDocument();
  await waitFor(() =>
    expect(storeSet).toHaveBeenCalledWith("recentFiles", ["C:/notes/readme.md"])
  );

  // 再开一篇：新的一篇在前，旧的一篇仍在列表里
  storeGet.mockImplementation((key: string) =>
    Promise.resolve(key === "recentFiles" ? ["C:/notes/readme.md"] : undefined)
  );
  vi.mocked(open).mockResolvedValueOnce("C:/notes/other.md");
  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/other.md",
    fileName: "other.md",
    parentPath: "C:/notes",
    markdown: "# Other",
  });
  fireEvent.click(screen.getByRole("button", { name: "打开文件" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Other" })).toBeInTheDocument());

  await waitFor(() =>
    expect(storeSet).toHaveBeenCalledWith("recentFiles", ["C:/notes/other.md", "C:/notes/readme.md"])
  );
});

test("打开失败：走既有错误管线（ErrorState），并把该条从 recentFiles 摘掉", async () => {
  storeGet.mockImplementation((key: string) =>
    Promise.resolve(key === "recentFiles" ? ["C:/notes/gone.md", "C:/notes/kept.md"] : undefined)
  );
  backendInvoke.mockRejectedValueOnce("Cannot open file");
  vi.mocked(open).mockResolvedValueOnce("C:/notes/gone.md");

  render(<App />);
  // 启动恢复先尝试 recentFiles[0]（同一份失败响应），直接进入错误态
  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot open file");

  // 失效条目被摘掉：列表里只剩还能打开的那条
  await waitFor(() => expect(storeSet).toHaveBeenCalledWith("recentFiles", ["C:/notes/kept.md"]));
  // 「重新打开」按钮仍在（既有错误管线未被改动）
  expect(screen.getByRole("button", { name: "重新打开" })).toBeInTheDocument();
});

test("拖放：enter 亮提示描边，drop 取第一个 Markdown 路径打开并熄灭提示", async () => {
  render(<App />);
  const handler = await dragDropHandler();

  await act(async () => {
    handler({ payload: { type: "enter", paths: ["C:/notes/other.md"], position: { x: 0, y: 0 } } });
  });
  expect(dropTarget()).toBeInTheDocument();

  backendInvoke.mockResolvedValueOnce({
    path: "C:/notes/other.md",
    fileName: "other.md",
    parentPath: "C:/notes",
    markdown: "# Dropped",
  });
  await act(async () => {
    handler({
      payload: {
        type: "drop",
        paths: ["C:/notes/other.md", "C:/notes/second.md"],
        position: { x: 0, y: 0 },
      },
    });
  });

  // 多文件只取第一个；提示态在 drop 时熄灭
  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("load_document", { path: "C:/notes/other.md" })
  );
  expect(dropTarget()).toBeNull();
  expect(backendInvoke).not.toHaveBeenCalledWith("load_document", { path: "C:/notes/second.md" });
});

test("拖放：over 续亮提示态；非 Markdown 文件不打开；leave 熄灭提示态", async () => {
  render(<App />);
  const handler = await dragDropHandler();

  // over 只带坐标、不带路径，仍须续亮（enter 之后鼠标每次移动都走这条）
  await act(async () => {
    handler({ payload: { type: "over", position: { x: 10, y: 10 } } });
  });
  expect(dropTarget()).toBeInTheDocument();

  await act(async () => {
    handler({ payload: { type: "drop", paths: ["C:/images/pic.png"], position: { x: 0, y: 0 } } });
  });
  expect(dropTarget()).toBeNull();
  expect(backendInvoke).not.toHaveBeenCalledWith("load_document", expect.anything());

  await act(async () => {
    handler({ payload: { type: "enter", paths: ["C:/images/pic.png"], position: { x: 0, y: 0 } } });
  });
  expect(dropTarget()).toBeInTheDocument();

  await act(async () => {
    handler({ payload: { type: "leave" } });
  });
  expect(dropTarget()).toBeNull();
});

test("错误态里点最近列表的失效条目：停留在 ErrorState（不递归），失效条目被摘掉", async () => {
  // 可变的内存 Store：removeRecent 的写入必须能被下一次读取看见，
  // 否则测的只是「按固定列表再算一遍」而不是真实的列表收缩
  let stored: unknown = ["C:/notes/gone.md", "C:/notes/kept.md"];
  storeGet.mockImplementation((key: string) =>
    Promise.resolve(key === "recentFiles" ? stored : undefined)
  );
  storeSet.mockImplementation((key: string, value: unknown) => {
    if (key === "recentFiles") stored = value;
    return Promise.resolve();
  });
  // 所有加载都失败：启动恢复的 gone.md 与随后点击的 kept.md
  backendInvoke.mockImplementation(async (command: string) => {
    if (command === "load_document") throw "Cannot open file";
    return undefined;
  });

  render(<App />);

  // 启动恢复 gone.md 失败 ⇒ 错误页，且错误页里就带着替代入口（kept.md）
  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot open file");
  await waitFor(() => expect(storeSet).toHaveBeenCalledWith("recentFiles", ["C:/notes/kept.md"]));
  const kept = await screen.findByRole("button", { name: /kept/ });

  await act(async () => {
    fireEvent.click(kept);
  });

  // 依然停在错误页，没有递归/重试风暴：load_document 恰好两次（启动恢复一次 + 点击一次）
  expect(screen.getByRole("alert")).toHaveTextContent("Cannot open file");
  expect(
    backendInvoke.mock.calls.filter(([command]) => command === "load_document")
  ).toHaveLength(2);

  // kept.md 也失效 ⇒ 摘掉后列表为空，整个区块不渲染（错误页本身仍在）
  await waitFor(() => expect(stored).toEqual([]));
  expect(screen.queryByText("最近打开")).toBeNull();
  expect(screen.getByRole("button", { name: "重新打开" })).toBeInTheDocument();
});
