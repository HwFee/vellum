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
