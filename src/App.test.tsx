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

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    show: vi.fn(() => Promise.resolve()),
  })),
}));

const lastOpenedGet = vi.fn(() => Promise.resolve<string | undefined>(undefined));
const storeGet = vi.fn((key: string): Promise<unknown> =>
  key === "lastOpenedPath" ? lastOpenedGet() : Promise.resolve(undefined)
);
const storeSet = vi.fn(() => Promise.resolve());

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

const loadedDoc = {
  path: "C:/notes/readme.md",
  fileName: "readme.md",
  parentPath: "C:/notes",
  markdown: "# Intro\n\n## Section\n\nBody text.",
};

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
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
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

test("registers the pending listener before draining paths", async () => {
  let resolveListen!: (unlisten: () => void) => void;
  vi.mocked(listen).mockImplementationOnce(
    () => new Promise((resolve) => { resolveListen = resolve; })
  );

  render(<App />);
  await act(async () => {});
  expect(drainInvoke).not.toHaveBeenCalled();

  await act(async () => resolveListen(() => {}));
  await waitFor(() => expect(drainInvoke).toHaveBeenCalledTimes(1));
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
  expect(screen.getByText("readme.md")).toBeInTheDocument();
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

test("pauses debounced scrollMemory saving during active mdlog and flushes once upon disconnection", async () => {
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
  saveSpy.mockClear();

  // 记录态下触发多次滚动事件（使用 fake timers 推进 400ms 验证 300ms 防抖被暂停）
  vi.useFakeTimers();
  fireEvent.scroll(scrollContainer);
  act(() => {
    vi.advanceTimersByTime(400);
  });
  // 必须被暂停，不写入 store
  expect(saveSpy).not.toHaveBeenCalled();
  vi.useRealTimers();

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

test("layout effect arbitrates scroll on hot reload even when markdown content is unchanged (via reloadTick)", async () => {
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
  Object.defineProperty(container, "scrollTop", { value: 200, writable: true, configurable: true });
  Object.defineProperty(container, "scrollHeight", { value: 1000, writable: true, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: 600, writable: true, configurable: true });

  const reloadCall = vi.mocked(listen).mock.calls.find(([event]) => event === "file-changed");
  expect(reloadCall).toBeDefined();

  container.scrollTop = 250;
  await act(async () => {
    (reloadCall![1] as (payload: unknown) => void)({ payload: {} });
  });

  expect(container.scrollTop).toBe(250);
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
  // 确认自动贴底且未挂载印章
  expect(scrollContainer.scrollTop).toBe(1000);
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

  vi.useRealTimers();
});


describe("App outline integration", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    vi.mocked(open).mockClear();
  });

  it("toggles the outline panel closed and open", async () => {
    await loadDocument();
    const toggle = screen.getByRole("button", { name: "切换大纲" });

    // 默认打开
    expect(document.querySelector(".outline-sidebar--open")).toBeInTheDocument();

    // 点击关闭
    fireEvent.click(toggle);
    expect(document.querySelector(".outline-sidebar--open")).not.toBeInTheDocument();

    // 再点击打开
    fireEvent.click(toggle);
    expect(document.querySelector(".outline-sidebar--open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Section" })).toBeInTheDocument();
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
    // 默认打开
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
    // 默认打开即显示 scrim
    expect(document.querySelector(".outline-scrim")).toBeInTheDocument();
  });

  it("closes the outline when the scrim is clicked", async () => {
    window.innerWidth = 500;

    await loadDocument();
    // 默认打开即显示 scrim
    const scrim = document.querySelector(".outline-scrim");
    expect(scrim).toBeInTheDocument();
    fireEvent.click(scrim!);

    await waitFor(() => expect(document.querySelector(".outline-sidebar--open")).not.toBeInTheDocument());
  });

  it("closes the outline with Escape on narrow windows", async () => {
    window.innerWidth = 500;

    await loadDocument();
    // 默认打开
    expect(document.querySelector(".outline-sidebar--open")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(document.querySelector(".outline-sidebar--open")).not.toBeInTheDocument());
  });

  it("adds the outline-open layout class to the body", async () => {
    await loadDocument();

    // 默认打开即带 outline-open 类
    expect(document.querySelector(".app-shell__body--outline-open")).toBeInTheDocument();

    // 关闭后移除
    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));
    expect(document.querySelector(".app-shell__body--outline-open")).not.toBeInTheDocument();
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
});
