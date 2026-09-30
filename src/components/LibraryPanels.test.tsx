import { invoke } from "@tauri-apps/api/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BacklinksPanel } from "./BacklinksPanel";
import { FilesPanel } from "./FilesPanel";
import { LibrarySearchPanel } from "./LibrarySearchPanel";
import { SidebarTabs } from "./SidebarTabs";
import type { BacklinkFile, LibraryListing, LibrarySearch } from "../lib/library";

const invokeMock = vi.mocked(invoke);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const LISTING: LibraryListing = {
  root: "D:/wisdom",
  rootName: "wisdom",
  isVault: true,
  files: [
    { path: "D:/wisdom/读书/纸的历史.md", relPath: "读书/纸的历史.md" },
    { path: "D:/wisdom/读书/墨的制作.md", relPath: "读书/墨的制作.md" },
    { path: "D:/wisdom/index.md", relPath: "index.md" },
  ],
  truncated: false,
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("SidebarTabs", () => {
  it("四枚页签渲染 tablist，激活态与 onSelect 正确", () => {
    const onSelect = vi.fn();
    render(<SidebarTabs active="files" onSelect={onSelect} />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["目錄", "文件", "檢索", "反鏈"]);
    expect(screen.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "目錄" })).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("tab", { name: "反鏈" }));
    expect(onSelect).toHaveBeenCalledWith("backlinks");
  });

  it("script=simplified 时题头换简体字形（目录 / 检索 / 反链）", () => {
    render(<SidebarTabs active="outline" onSelect={vi.fn()} script="simplified" />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["目录", "文件", "检索", "反链"]);
    // 繁体原样不在场——换的是字形不是别名共存
    expect(screen.queryByRole("tab", { name: "目錄" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "檢索" })).toBeNull();
  });
});

describe("FilesPanel", () => {
  const props = {
    header: <div>tabs</div>,
    // 当前文档在「读书」目录里：祖先目录自动展开才有内容可断
    documentPath: "D:/wisdom/读书/纸的历史.md",
    onOpenPath: vi.fn(),
  };

  it("挂载即调 list_library；目录树目录在前、当前篇高亮且祖先目录自动展开", async () => {
    invokeMock.mockResolvedValue(LISTING);
    render(<FilesPanel {...props} />);

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_library"));
    // 库根行：库名 + 「· 库」标记
    await waitFor(() =>
      expect(document.querySelector(".library-root")?.textContent).toBe("wisdom · 库")
    );
    // 目录节点自动展开（当前篇在其中）——展开是清单到手后的第二轮 effect
    const folder = screen.getByRole("button", { name: /读书/ });
    await waitFor(() => expect(folder).toHaveAttribute("aria-expanded", "true"));
    // 当前文档带激活样式（与大纲激活同一条边轨）
    const current = screen.getByRole("button", { name: "纸的历史" });
    expect(current).toHaveClass("outline-panel__link--active");
    expect(screen.getByRole("button", { name: "墨的制作" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "index" })).toBeInTheDocument();
  });

  it("目录折叠切换；筛选输入命中退成扁平列表", async () => {
    invokeMock.mockResolvedValue(LISTING);
    render(<FilesPanel {...props} />);
    await screen.findByRole("button", { name: "墨的制作" });

    // 折叠「读书」：里面的文件退场
    fireEvent.click(screen.getByRole("button", { name: /读书/ }));
    expect(screen.queryByRole("button", { name: "墨的制作" })).toBeNull();

    // 筛选：扁平列表含路径行
    fireEvent.change(screen.getByLabelText("筛选库内文件"), { target: { value: "纸" } });
    expect(screen.getByRole("button", { name: /纸的历史/ })).toBeInTheDocument();
    expect(screen.getByText("读书/纸的历史.md")).toBeInTheDocument();
    // 目录节点不再出现
    expect(screen.queryByRole("button", { name: /^读书$/ })).toBeNull();
  });

  it("点文件行按普通路径打开", async () => {
    const onOpenPath = vi.fn();
    invokeMock.mockResolvedValue(LISTING);
    render(<FilesPanel {...props} onOpenPath={onOpenPath} />);
    await screen.findByRole("button", { name: "纸的历史" });

    fireEvent.click(screen.getByRole("button", { name: "纸的历史" }));
    expect(onOpenPath).toHaveBeenCalledWith("D:/wisdom/读书/纸的历史.md");
  });

  it("命令失败显示空态文案", async () => {
    invokeMock.mockRejectedValue(new Error("no document loaded"));
    render(<FilesPanel {...props} />);
    await screen.findByText("无法读取文件列表");
  });

  it("空库换代：documentPath 同为空串但库根变化必须重取列表", async () => {
    const emptyA: LibraryListing = {
      root: "D:/lib-a", rootName: "lib-a", isVault: false, files: [], truncated: false,
    };
    const emptyB: LibraryListing = {
      root: "D:/lib-b", rootName: "lib-b", isVault: false, files: [], truncated: false,
    };
    invokeMock.mockResolvedValueOnce(emptyA).mockResolvedValueOnce(emptyB);
    const { rerender } = render(
      <FilesPanel {...props} documentPath="" libraryRoot="D:/lib-a" />
    );
    await waitFor(() =>
      expect(document.querySelector(".library-root")?.textContent).toBe("lib-a")
    );

    rerender(<FilesPanel {...props} documentPath="" libraryRoot="D:/lib-b" />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(document.querySelector(".library-root")?.textContent).toBe("lib-b")
    );
  });

  it("空库换代：旧库的迟到响应不得覆盖新库清单", async () => {
    let resolveA!: (v: LibraryListing) => void;
    const pendingA = new Promise<LibraryListing>((r) => {
      resolveA = r;
    });
    const emptyA: LibraryListing = {
      root: "D:/lib-a", rootName: "lib-a", isVault: false, files: [], truncated: false,
    };
    const emptyB: LibraryListing = {
      root: "D:/lib-b", rootName: "lib-b", isVault: false, files: [
        { path: "D:/lib-b/b.md", relPath: "b.md" },
      ], truncated: false,
    };
    invokeMock.mockReturnValueOnce(pendingA).mockResolvedValueOnce(emptyB);
    const { rerender } = render(
      <FilesPanel {...props} documentPath="" libraryRoot="D:/lib-a" />
    );

    rerender(<FilesPanel {...props} documentPath="" libraryRoot="D:/lib-b" />);
    await waitFor(() =>
      expect(document.querySelector(".library-root")?.textContent).toBe("lib-b")
    );

    await act(async () => {
      resolveA(emptyA);
      await Promise.resolve();
    });
    expect(document.querySelector(".library-root")?.textContent).toBe("lib-b");
    expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
  });

  it("筛选态下截断提示仍然显示", async () => {
    invokeMock.mockResolvedValue({ ...LISTING, truncated: true });
    render(<FilesPanel {...props} />);
    await screen.findByRole("button", { name: "index" });
    expect(screen.getByText(/文件过多/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("筛选库内文件"), { target: { value: "纸" } });
    expect(screen.getByRole("button", { name: /纸的历史/ })).toBeInTheDocument();
    expect(screen.getByText(/文件过多/)).toBeInTheDocument();
  });

  it("超过 200 行的清单走虚拟化分支：DOM 行数受限且末行可滚到", async () => {
    const files = Array.from({ length: 500 }, (_, index) => {
      const relPath = `n-${String(index).padStart(3, "0")}.md`;
      return { path: `/root/${relPath}`, relPath };
    });
    invokeMock.mockResolvedValue({
      root: "/root", rootName: "root", isVault: false, files, truncated: false,
    });
    render(<FilesPanel {...props} documentPath={null} />);

    await waitFor(() =>
      expect(document.querySelector(".library-tree--virtual")).not.toBeNull()
    );
    const count = document.querySelectorAll(".library-tree__file").length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(64);

    const scroller = document.querySelector<HTMLElement>(".outline-panel__scroll")!;
    act(() => {
      scroller.scrollTop = 500 * 32;
      scroller.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() =>
      expect(
        document.querySelector(".library-tree__file[title='n-499.md']")
      ).not.toBeNull()
    );
  });

  it("虚拟化 + 当前篇深目录自动展开后定位：当前行挂载且被滚入视口", async () => {
    const deepFiles = Array.from({ length: 350 }, (_, index) => ({
      path: `/root/adir/inner/f${String(index).padStart(3, "0")}.md`,
      relPath: `adir/inner/f${String(index).padStart(3, "0")}.md`,
    }));
    const rootFiles = Array.from({ length: 250 }, (_, index) => ({
      path: `/root/m${String(index).padStart(3, "0")}.md`,
      relPath: `m${String(index).padStart(3, "0")}.md`,
    }));
    const listing: LibraryListing = {
      root: "/root", rootName: "root", isVault: false,
      files: [...deepFiles, ...rootFiles], truncated: false,
    };
    invokeMock.mockResolvedValue(listing);
    render(
      <FilesPanel {...props} documentPath="/root/adir/inner/f349.md" />
    );

    await waitFor(() =>
      expect(document.querySelector(".library-tree--virtual")).not.toBeNull()
    );
    const current = await screen.findByRole("treeitem", { name: "f349" });
    expect(current).toHaveClass("outline-panel__link--active");
    const li = current.parentElement!;
    const rowTop = Number(li.style.top.replace("px", ""));
    const scroller = document.querySelector<HTMLElement>(".outline-panel__scroll")!;
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
    expect(rowTop).toBeGreaterThanOrEqual(scroller.scrollTop);
    expect(rowTop + 32).toBeLessThanOrEqual(scroller.scrollTop + 480);
  });

  it("筛选态超过 200 行同样虚拟化：48px 行界、目录文本、过滤换词归零", async () => {
    const files = Array.from({ length: 500 }, (_, index) => ({
      path: `/root/n-${String(index).padStart(3, "0")}.md`,
      relPath: `n-${String(index).padStart(3, "0")}.md`,
    }));
    invokeMock.mockResolvedValue({
      root: "/root", rootName: "root", isVault: false, files, truncated: false,
    });
    render(<FilesPanel {...props} documentPath={null} />);
    await waitFor(() =>
      expect(document.querySelector(".library-tree--virtual")).not.toBeNull()
    );

    fireEvent.change(screen.getByLabelText("筛选库内文件"), { target: { value: "n-" } });
    await waitFor(() =>
      expect(document.querySelector(".library-tree__file--flat")).not.toBeNull()
    );
    const count = document.querySelectorAll(".library-tree__file").length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(64);
    expect(document.querySelector(".library-tree__dir")?.textContent).toBe("n-000.md");

    const scroller = document.querySelector<HTMLElement>(".outline-panel__scroll")!;
    act(() => {
      scroller.scrollTop = 500 * 48;
      scroller.dispatchEvent(new Event("scroll"));
    });
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("筛选库内文件"), { target: { value: "n" } });
    await waitFor(() => expect(scroller.scrollTop).toBe(0));
    expect(document.querySelector(".library-tree--virtual")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("筛选库内文件"), { target: { value: "zzz" } });
    expect(screen.getByText("无匹配文件")).toBeInTheDocument();
    expect(document.querySelectorAll("[role='treeitem']").length).toBe(0);
    expect(document.querySelector(".library-tree--virtual")).toBeNull();
  });
});

describe("LibrarySearchPanel", () => {
  const makeProps = () => ({
    header: <div>tabs</div>,
    documentPath: "D:/wisdom/index.md",
    query: "",
    onQueryChange: vi.fn(),
    onOpenHit: vi.fn(),
    inputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
  });

  it("输入 300ms 防抖后才发 search_library；命中片段按 char 索引切出 mark", async () => {
    vi.useFakeTimers();
    try {
      const result: LibrarySearch = {
        files: [
          {
            path: "D:/wisdom/读书/纸的历史.md",
            relPath: "读书/纸的历史.md",
            matches: [
              { line: 7, snippet: "…前面全是中文填充字符，关键字在这里…", matchStart: 12, matchLen: 3 },
            ],
          },
        ],
        truncated: false,
      };
      invokeMock.mockResolvedValue(result);
      const props = { ...makeProps(), query: "关键字" };
      render(<LibrarySearchPanel {...props} />);

      // 防抖窗内不发请求
      act(() => void vi.advanceTimersByTime(200));
      expect(invokeMock).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(150);
        await Promise.resolve();
      });
      expect(invokeMock).toHaveBeenCalledWith("search_library", { query: "关键字" });

      // 命中词被 <mark> 包在正确的 char 位置上（CJK 前后文不错位）
      const mark = document.querySelector("mark.search-match");
      expect(mark?.textContent).toBe("关键字");
      expect(mark?.parentElement?.textContent).toBe("…前面全是中文填充字符，关键字在这里…");
      expect(screen.getByText("L7")).toBeInTheDocument();
      expect(screen.getByText("纸的历史")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("过期的旧响应被请求号守卫丢弃", async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst!: (v: LibrarySearch) => void;
      const first = new Promise<LibrarySearch>((r) => (resolveFirst = r));
      const second: LibrarySearch = {
        files: [
          {
            path: "D:/wisdom/b.md",
            relPath: "b.md",
            matches: [{ line: 1, snippet: "new hit", matchStart: 0, matchLen: 3 }],
          },
        ],
        truncated: false,
      };
      invokeMock.mockReturnValueOnce(first).mockResolvedValue(second);
      const onQueryChange = vi.fn();
      const props = { ...makeProps(), query: "旧词", onQueryChange };

      const { rerender } = render(<LibrarySearchPanel {...props} />);
      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(invokeMock).toHaveBeenCalledTimes(1);

      // 词变了 → 第二次请求
      rerender(<LibrarySearchPanel {...props} query="新词" />);
      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(invokeMock).toHaveBeenCalledTimes(2);
      expect(invokeMock).toHaveBeenLastCalledWith("search_library", { query: "新词" });

      // 旧响应迟到：不许盖掉新结果（mark 拆分了文本节点，按 textContent 断言）
      await act(async () => {
        resolveFirst({
          files: [{ path: "D:/x.md", relPath: "x.md", matches: [{ line: 1, snippet: "stale", matchStart: 0, matchLen: 5 }] }],
          truncated: false,
        });
        await Promise.resolve();
      });
      expect(document.querySelector(".library-hit__line")?.textContent).toContain("new hit");
      expect(document.querySelector(".library-hit__line")?.textContent).not.toContain("stale");
    } finally {
      vi.useRealTimers();
    }
  });

  it("旧响应在新词防抖窗内回来：不显示旧命中、不解除 pending", async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst!: (v: LibrarySearch) => void;
      const first = new Promise<LibrarySearch>((r) => (resolveFirst = r));
      const second: LibrarySearch = {
        files: [
          {
            path: "D:/wisdom/b.md",
            relPath: "b.md",
            matches: [{ line: 1, snippet: "new hit", matchStart: 0, matchLen: 3 }],
          },
        ],
        truncated: false,
      };
      invokeMock.mockReturnValueOnce(first).mockResolvedValue(second);
      const props = makeProps();

      const { rerender } = render(<LibrarySearchPanel {...props} query="旧词" />);
      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(invokeMock).toHaveBeenCalledTimes(1);

      rerender(<LibrarySearchPanel {...props} query="新词" />);
      await act(async () => {
        resolveFirst({
          files: [{ path: "D:/x.md", relPath: "x.md", matches: [{ line: 1, snippet: "stale", matchStart: 0, matchLen: 5 }] }],
          truncated: false,
        });
        await Promise.resolve();
      });
      expect(document.querySelector(".library-hit__line")).toBeNull();
      expect(document.querySelector(".outline-search__count")).not.toBeNull();

      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(invokeMock).toHaveBeenLastCalledWith("search_library", { query: "新词" });
      expect(document.querySelector(".library-hit__line")?.textContent).toContain("new hit");
    } finally {
      vi.useRealTimers();
    }
  });

  it("清空再输入：旧请求不得在新防抖窗内复活旧结果", async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst!: (v: LibrarySearch) => void;
      const first = new Promise<LibrarySearch>((r) => (resolveFirst = r));
      invokeMock.mockReturnValueOnce(first).mockResolvedValue({
        files: [
          {
            path: "D:/wisdom/b.md",
            relPath: "b.md",
            matches: [{ line: 1, snippet: "new hit", matchStart: 0, matchLen: 3 }],
          },
        ],
        truncated: false,
      });
      const props = makeProps();

      const { rerender } = render(<LibrarySearchPanel {...props} query="旧词" />);
      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(invokeMock).toHaveBeenCalledTimes(1);

      rerender(<LibrarySearchPanel {...props} query="" />);
      rerender(<LibrarySearchPanel {...props} query="新词" />);
      await act(async () => {
        resolveFirst({
          files: [{ path: "D:/x.md", relPath: "x.md", matches: [{ line: 1, snippet: "stale", matchStart: 0, matchLen: 5 }] }],
          truncated: false,
        });
        await Promise.resolve();
      });
      expect(document.querySelector(".library-hit__line")).toBeNull();

      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(invokeMock).toHaveBeenCalledTimes(2);
      expect(document.querySelector(".library-hit__line")?.textContent).toContain("new hit");
    } finally {
      vi.useRealTimers();
    }
  });

  it("文档换代（query 不变）使在途旧响应作废", async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst!: (v: LibrarySearch) => void;
      const first = new Promise<LibrarySearch>((r) => (resolveFirst = r));
      invokeMock.mockReturnValueOnce(first).mockResolvedValue({
        files: [
          {
            path: "D:/wisdom/c.md",
            relPath: "c.md",
            matches: [{ line: 2, snippet: "gen2", matchStart: 0, matchLen: 4 }],
          },
        ],
        truncated: false,
      });
      const props = makeProps();

      const { rerender } = render(<LibrarySearchPanel {...props} query="词" />);
      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(invokeMock).toHaveBeenCalledTimes(1);

      rerender(<LibrarySearchPanel {...props} query="词" documentPath="D:/wisdom/读书/纸的历史.md" />);
      await act(async () => {
        resolveFirst({
          files: [{ path: "D:/x.md", relPath: "x.md", matches: [{ line: 1, snippet: "stale", matchStart: 0, matchLen: 5 }] }],
          truncated: false,
        });
        await Promise.resolve();
      });
      expect(document.querySelector(".library-hit__line")).toBeNull();

      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(invokeMock).toHaveBeenCalledTimes(2);
      expect(document.querySelector(".library-hit__line")?.textContent).toContain("gen2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("旧请求的失败回包不得清除新请求的 pending", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let rejectFirst!: (e: unknown) => void;
      const first = new Promise<LibrarySearch>((_, rej) => (rejectFirst = rej));
      invokeMock.mockReturnValueOnce(first).mockResolvedValue({
        files: [
          {
            path: "D:/wisdom/b.md",
            relPath: "b.md",
            matches: [{ line: 1, snippet: "new hit", matchStart: 0, matchLen: 3 }],
          },
        ],
        truncated: false,
      });
      const props = makeProps();

      const { rerender } = render(<LibrarySearchPanel {...props} query="旧词" />);
      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());

      rerender(<LibrarySearchPanel {...props} query="新词" />);
      await act(async () => {
        rejectFirst(new Error("boom"));
        await Promise.resolve();
      });
      expect(document.querySelector(".outline-search__count")).not.toBeNull();
      expect(document.querySelector(".library-hit__line")).toBeNull();

      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(document.querySelector(".library-hit__line")?.textContent).toContain("new hit");
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("词一变已渲染的旧命中立即撤下（旧按钮不可再点）", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockResolvedValue({
        files: [
          {
            path: "D:/wisdom/读书/纸的历史.md",
            relPath: "读书/纸的历史.md",
            matches: [{ line: 3, snippet: "hit", matchStart: 0, matchLen: 3 }],
          },
        ],
        truncated: false,
      });
      const props = makeProps();
      const { rerender } = render(<LibrarySearchPanel {...props} query="旧词" />);
      await act(async () => {
        vi.advanceTimersByTime(320);
        await Promise.resolve();
      });
      expect(document.querySelector(".library-hit__line")).not.toBeNull();

      rerender(<LibrarySearchPanel {...props} query="新词" />);
      expect(document.querySelector(".library-hit__line")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("卸载后在途回包安全落地（不更新已卸载组件）", async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst!: (v: LibrarySearch) => void;
      const first = new Promise<LibrarySearch>((r) => (resolveFirst = r));
      invokeMock.mockReturnValueOnce(first);
      const { unmount } = render(<LibrarySearchPanel {...makeProps()} query="词" />);
      act(() => void vi.advanceTimersByTime(320));
      await act(async () => void Promise.resolve());
      expect(invokeMock).toHaveBeenCalledTimes(1);

      unmount();
      await act(async () => {
        resolveFirst({
          files: [{ path: "D:/x.md", relPath: "x.md", matches: [{ line: 1, snippet: "stale", matchStart: 0, matchLen: 5 }] }],
          truncated: false,
        });
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("同行同 matchStart 的两条命中不触发重复 key，逐行可点", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      invokeMock.mockResolvedValue({
        files: [
          {
            path: "D:/wisdom/读书/纸的历史.md",
            relPath: "读书/纸的历史.md",
            matches: [
              { line: 9, snippet: "…" + "前".repeat(30) + "命中 alpha…", matchStart: 31, matchLen: 2 },
              { line: 9, snippet: "…" + "前".repeat(30) + "命中 beta…", matchStart: 31, matchLen: 2 },
            ],
          },
        ],
        truncated: false,
      });
      const onOpenHit = vi.fn();
      render(<LibrarySearchPanel {...makeProps()} query="命中" onOpenHit={onOpenHit} />);
      await act(async () => {
        vi.advanceTimersByTime(320);
        await Promise.resolve();
      });

      const rows = document.querySelectorAll(".library-hit__line");
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain("alpha");
      expect(rows[1].textContent).toContain("beta");
      expect(
        error.mock.calls.some((args) => String(args[0]).includes("same key"))
      ).toBe(false);

      fireEvent.click(rows[1]);
      expect(onOpenHit).toHaveBeenCalledWith("D:/wisdom/读书/纸的历史.md", "命中");
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it("点命中行回调 onOpenHit(path, query)", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockResolvedValue({
        files: [
          {
            path: "D:/wisdom/读书/纸的历史.md",
            relPath: "读书/纸的历史.md",
            matches: [{ line: 3, snippet: "hit", matchStart: 0, matchLen: 3 }],
          },
        ],
        truncated: false,
      });
      const onOpenHit = vi.fn();
      render(<LibrarySearchPanel {...makeProps()} query="hit" onOpenHit={onOpenHit} />);

      await act(async () => {
        vi.advanceTimersByTime(320);
        await Promise.resolve();
      });
      fireEvent.click(document.querySelector(".library-hit__line")!);
      expect(onOpenHit).toHaveBeenCalledWith("D:/wisdom/读书/纸的历史.md", "hit");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BacklinksPanel", () => {
  const props = {
    header: <div>tabs</div>,
    documentPath: "D:/wisdom/index.md",
    onOpenPath: vi.fn(),
  };

  it("无反链显示空态", async () => {
    invokeMock.mockResolvedValue([]);
    render(<BacklinksPanel {...props} />);
    await screen.findByText("暂无笔记链接到本篇");
    expect(invokeMock).toHaveBeenCalledWith("find_backlinks");
  });

  it("列出链到本篇的笔记与至多五行摘录", async () => {
    const links: BacklinkFile[] = [
      {
        path: "D:/wisdom/读书/纸的历史.md",
        relPath: "读书/纸的历史.md",
        snippets: [
          { line: 3, snippet: "参 [[index]] 的考目。" },
          { line: 9, snippet: "又见 [[index|索引]]。" },
        ],
      },
    ];
    invokeMock.mockResolvedValue(links);
    const onOpenPath = vi.fn();
    render(<BacklinksPanel {...props} onOpenPath={onOpenPath} />);

    const title = await screen.findByRole("button", { name: "纸的历史" });
    expect(screen.getByText("参 [[index]] 的考目。")).toBeInTheDocument();
    expect(screen.getByText("L9")).toBeInTheDocument();

    fireEvent.click(title);
    expect(onOpenPath).toHaveBeenCalledWith("D:/wisdom/读书/纸的历史.md");
  });
});
