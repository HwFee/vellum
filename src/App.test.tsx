import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";

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
const storeGet = vi.fn((key: string) =>
  key === "lastOpenedPath" ? lastOpenedGet() : Promise.resolve(undefined)
);

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(() =>
      Promise.resolve({
        get: storeGet,
        set: vi.fn(() => Promise.resolve()),
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
