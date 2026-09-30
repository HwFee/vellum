import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FilesVirtualTree } from "./FilesVirtualTree";
import { buildFileTree, flattenVisibleFileTree, type FileTreeNode } from "../lib/library";

function FolderIcon() {
  return <svg data-testid="folder-icon" />;
}

function bigFiles(count: number): FileTreeNode[] {
  return buildFileTree(
    Array.from({ length: count }, (_, index) => {
      const relPath = `note-${String(index).padStart(5, "0")}.md`;
      return { path: `/root/${relPath}`, relPath };
    })
  );
}

function nestedNodes(): FileTreeNode[] {
  return buildFileTree([
    { path: "/r/dirA/a1.md", relPath: "dirA/a1.md" },
    { path: "/r/dirA/deep/d1.md", relPath: "dirA/deep/d1.md" },
    { path: "/r/dirA/deep/d2.md", relPath: "dirA/deep/d2.md" },
    { path: "/r/dirA/a2.md", relPath: "dirA/a2.md" },
    { path: "/r/root.md", relPath: "root.md" },
  ]);
}

function Harness({
  nodes,
  flat = false,
  documentPath = null,
  resetKey = "",
  onOpenPath,
  initialExpanded = new Set<string>(),
  scrollRef,
  opens,
}: {
  nodes: FileTreeNode[];
  flat?: boolean;
  documentPath?: string | null;
  resetKey?: string;
  onOpenPath?: (path: string) => void;
  initialExpanded?: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  opens?: string[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  return (
    <div className="outline-panel__scroll" ref={scrollRef}>
      <FilesVirtualTree
        rows={flattenVisibleFileTree(nodes, expanded)}
        scrollRef={scrollRef}
        documentPath={documentPath}
        onToggle={(relPath) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(relPath)) next.delete(relPath);
            else next.add(relPath);
            return next;
          })
        }
        onOpenPath={onOpenPath ?? ((path) => opens?.push(path))}
        expanded={expanded}
        flat={flat}
        resetKey={resetKey}
        FolderIcon={FolderIcon}
      />
    </div>
  );
}

describe("FilesVirtualTree", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame = 0;

  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  };

  const scrollTo = (el: HTMLElement, top: number) => {
    act(() => {
      el.scrollTop = top;
      el.dispatchEvent(new Event("scroll"));
    });
    act(flushFrames);
  };

  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("20000 行的视口只挂载窗口内行：首屏与滚到底部都不超界", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const opens: string[] = [];
    render(
      <Harness nodes={bigFiles(20000)} scrollRef={scrollRef} opens={opens} />
    );

    const scroller = scrollRef.current!;
    expect(scroller).not.toBeNull();
    const initial = document.querySelectorAll(".library-tree__file").length;
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThanOrEqual(64);
    expect(document.querySelector(".library-tree--virtual")).not.toBeNull();

    scrollTo(scroller, 20000 * 32);
    const tail = document.querySelectorAll(".library-tree__file").length;
    expect(tail).toBeLessThanOrEqual(64);
    const last = document.querySelector<HTMLButtonElement>(
      ".library-tree__file[title='note-19999.md']"
    );
    expect(last).not.toBeNull();
    fireEvent.click(last!);
    expect(opens).toEqual(["/root/note-19999.md"]);
  });

  it("扁平筛选行：48px 行高、目录文本在按钮内", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    render(<Harness nodes={bigFiles(400)} flat scrollRef={scrollRef} />);
    const first = document.querySelector<HTMLButtonElement>(".library-tree__file--flat");
    expect(first).not.toBeNull();
    expect(first!.querySelector(".library-tree__dir")?.textContent).toBe("note-00000.md");
    const count = document.querySelectorAll(".library-tree__file").length;
    expect(count).toBeLessThanOrEqual(64);
    expect(count).toBeLessThan(400);
  });

  it("滚动把视口推走但焦点行仍挂载，普通滚动不抢焦点", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    render(<Harness nodes={bigFiles(500)} scrollRef={scrollRef} />);
    const first = document.querySelector<HTMLButtonElement>(
      ".library-tree__file[title='note-00000.md']"
    )!;
    act(() => first.focus());
    expect(document.activeElement).toBe(first);

    scrollTo(scrollRef.current!, 500 * 32);
    expect(document.activeElement).toBe(first);
    expect(document.querySelector(".library-tree__file[title='note-00000.md']")).not.toBeNull();
  });

  it("键盘导航：方向键/翻页/首末移动焦点并带动视口", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    render(<Harness nodes={bigFiles(500)} scrollRef={scrollRef} />);
    const first = document.querySelector<HTMLButtonElement>(".library-tree__file")!;
    act(() => first.focus());

    fireEvent.keyDown(first, { key: "ArrowDown" });
    const second = document.querySelector<HTMLButtonElement>(
      ".library-tree__file[title='note-00001.md']"
    )!;
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: "PageDown" });
    const expected15 = document.querySelector<HTMLButtonElement>(
      ".library-tree__file[title='note-00016.md']"
    )!;
    expect(document.activeElement).toBe(expected15);

    fireEvent.keyDown(expected15, { key: "End" });
    const last = document.querySelector<HTMLButtonElement>(
      ".library-tree__file[title='note-00499.md']"
    )!;
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(last, { key: "Home" });
    expect(document.activeElement).toBe(
      document.querySelector(".library-tree__file[title='note-00000.md']")
    );

    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(document.activeElement).toBe(
      document.querySelector(".library-tree__file[title='note-00000.md']")
    );
  });

  it("ArrowRight 展开折叠目录 / 进首个可见子项；ArrowLeft 收起或回到父目录", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    render(<Harness nodes={nestedNodes()} scrollRef={scrollRef} />);
    const folder = screen.getByRole("treeitem", { name: /dirA/ });
    act(() => folder.focus());

    fireEvent.keyDown(folder, { key: "ArrowRight" });
    expect(folder).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "a1" })).toBeInTheDocument();

    fireEvent.keyDown(folder, { key: "ArrowRight" });
    const deep = screen.getByRole("treeitem", { name: /deep/ });
    expect(document.activeElement).toBe(deep);

    fireEvent.keyDown(deep, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(folder);

    fireEvent.keyDown(folder, { key: "ArrowLeft" });
    expect(folder).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("treeitem", { name: "a1" })).toBeNull();
    expect(document.activeElement).toBe(folder);
  });

  it("Enter/Space 不拦截：交给按钮原生点击语义", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    render(<Harness nodes={nestedNodes()} scrollRef={scrollRef} />);
    const folder = screen.getByRole("treeitem", { name: /dirA/ });
    expect(fireEvent.keyDown(folder, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(folder, { key: " " })).toBe(true);
    expect(folder).toHaveAttribute("aria-expanded", "false");

    const file = screen.getByRole("treeitem", { name: "root" });
    expect(fireEvent.keyDown(file, { key: "Enter" })).toBe(true);
  });

  it("修饰键导航不接管（Ctrl/Alt/Meta 留给 App 快捷键）", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    render(<Harness nodes={bigFiles(50)} scrollRef={scrollRef} />);
    const first = document.querySelector<HTMLButtonElement>(".library-tree__file")!;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown", ctrlKey: true });
    fireEvent.keyDown(first, { key: "PageDown", altKey: true });
    expect(document.activeElement).toBe(first);
  });

  it("焦点行随折叠消失时回退到父目录行", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    render(
      <Harness
        nodes={nestedNodes()}
        scrollRef={scrollRef}
        initialExpanded={new Set(["dirA", "dirA/deep"])}
      />
    );
    const deepFile = screen.getByRole("treeitem", { name: "d1" });
    act(() => deepFile.focus());
    expect(deepFile).toHaveAttribute("tabindex", "0");

    const folderA = screen.getByRole("treeitem", { name: /dirA/ });
    fireEvent.click(folderA);
    expect(folderA).toHaveAttribute("aria-expanded", "false");
    expect(folderA).toHaveAttribute("tabindex", "0");
    expect(document.querySelectorAll("[role='treeitem'][tabindex='0']")).toHaveLength(1);
  });

  it("外部折叠祖先（不点目录本身）：焦点落在最近的幸存祖先行", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const api = { collapse: (_p: string) => {} };
    function External() {
      const [expanded, setExpanded] = useState<Set<string>>(new Set(["dirA", "dirA/deep"]));
      api.collapse = (p) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(p);
          return next;
        });
      const nodes = buildFileTree([
        { path: "/r/dirB/x.md", relPath: "dirB/x.md" },
        { path: "/r/dirA/deep/d1.md", relPath: "dirA/deep/d1.md" },
        { path: "/r/dirA/a1.md", relPath: "dirA/a1.md" },
        { path: "/r/dirA/a2.md", relPath: "dirA/a2.md" },
      ]);
      return (
        <div className="outline-panel__scroll" ref={scrollRef}>
          <FilesVirtualTree
            rows={flattenVisibleFileTree(nodes, expanded)}
            scrollRef={scrollRef}
            documentPath={null}
            onToggle={(p) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              })
            }
            onOpenPath={() => {}}
            expanded={expanded}
            flat={false}
            resetKey=""
            FolderIcon={FolderIcon}
          />
        </div>
      );
    }
    render(<External />);
    const d1 = screen.getByRole("treeitem", { name: "d1" });
    act(() => d1.focus());
    expect(document.activeElement).toBe(d1);

    act(() => api.collapse("dirA"));
    const dirA = screen.getByRole("treeitem", { name: /dirA/ });
    expect(document.activeElement).toBe(dirA);
  });

  it("行集外部更换且焦点在树外输入框：不抢焦点且恰留一个 Tab 停靠", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const nodesA = nestedNodes();
    const nodesB = buildFileTree([
      { path: "/r/new1.md", relPath: "new1.md" },
      { path: "/r/new2.md", relPath: "new2.md" },
    ]);
    function Swap({ list }: { list: FileTreeNode[] }) {
      return (
        <div>
          <input aria-label="外部输入" />
          <div className="outline-panel__scroll" ref={scrollRef}>
            <FilesVirtualTree
              rows={flattenVisibleFileTree(list, new Set(["dirA"]))}
              scrollRef={scrollRef}
              documentPath="/r/dirA/deep/d1.md"
              onToggle={() => {}}
              onOpenPath={() => {}}
              expanded={new Set(["dirA"])}
              flat={false}
              resetKey=""
              FolderIcon={FolderIcon}
            />
          </div>
        </div>
      );
    }
    const view = render(<Swap list={nodesA} />);
    const input = screen.getByLabelText("外部输入");
    act(() => input.focus());
    expect(document.activeElement).toBe(input);

    view.rerender(<Swap list={nodesB} />);
    expect(document.activeElement).toBe(input);
    expect(document.querySelectorAll("[role='treeitem'][tabindex='0']")).toHaveLength(1);
  });

  it("当前文档行在视口外：初始即滚动到它且不抢焦点", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    render(
      <Harness
        nodes={bigFiles(300)}
        scrollRef={scrollRef}
        documentPath="/root/note-00200.md"
      />
    );
    const scroller = scrollRef.current!;
    act(flushFrames);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    const current = document.querySelector<HTMLButtonElement>(
      ".library-tree__file[title='note-00200.md']"
    )!;
    expect(current).not.toBeNull();
    expect(current).toHaveClass("outline-panel__link--active");
    expect(document.activeElement).not.toBe(current);
  });

  it("实际视口 240px：当前行按真实高度落位", () => {
    const scroller = document.createElement("div");
    Object.defineProperty(scroller, "clientHeight", { value: 240, configurable: true });
    const scrollRef = { current: scroller };
    const nodes = Array.from({ length: 400 }, (_, index) => ({
      name: `f${String(index).padStart(3, "0")}.md`,
      relPath: `f${String(index).padStart(3, "0")}.md`,
      path: `/r/f${String(index).padStart(3, "0")}.md`,
    }));
    const view = render(
      <FilesVirtualTree
        rows={flattenVisibleFileTree(nodes, new Set())}
        scrollRef={scrollRef}
        documentPath="/r/f200.md"
        onToggle={() => {}}
        onOpenPath={() => {}}
        expanded={new Set()}
        flat={false}
        resetKey=""
        FolderIcon={FolderIcon}
      />,
      { container: scroller }
    );
    const rowTop = 200 * 32;
    expect(scroller.scrollTop).toBeLessThanOrEqual(rowTop);
    expect(scroller.scrollTop + 240).toBeGreaterThanOrEqual(rowTop + 32);
    view.unmount();
  });

  it("行集收缩时视口上界被钳住：尾部行有效且滚动位置收敛", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const nodes = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        name: `n${String(index).padStart(5, "0")}.md`,
        relPath: `n${String(index).padStart(5, "0")}.md`,
        path: `/r/n${String(index).padStart(5, "0")}.md`,
      }));
    function Shrink({ count }: { count: number }) {
      const list = nodes(count);
      return (
        <div className="outline-panel__scroll" ref={scrollRef}>
          <FilesVirtualTree
            rows={flattenVisibleFileTree(list, new Set())}
            scrollRef={scrollRef}
            documentPath={null}
            onToggle={() => {}}
            onOpenPath={() => {}}
            expanded={new Set()}
            flat={false}
            resetKey=""
            FolderIcon={FolderIcon}
          />
        </div>
      );
    }
    const view = render(<Shrink count={20000} />);
    scrollTo(scrollRef.current!, 20000 * 32);
    view.rerender(<Shrink count={500} />);
    const max = 500 * 32 - 480;
    expect(scrollRef.current!.scrollTop).toBeLessThanOrEqual(max);
    const buttons = document.querySelectorAll(".library-tree__file");
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.length).toBeLessThanOrEqual(64);
    expect(
      document.querySelector(".library-tree__file[title='n00499.md']")
    ).not.toBeNull();
  });

  it("resetKey 变化把滚动位置归零", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const nodes = bigFiles(400);
    const view = render(
      <Harness nodes={nodes} scrollRef={scrollRef} resetKey="aa" />
    );
    scrollTo(scrollRef.current!, 400 * 32);
    expect(scrollRef.current!.scrollTop).toBeGreaterThan(0);
    view.rerender(<Harness nodes={nodes} scrollRef={scrollRef} resetKey="zz" />);
    expect(scrollRef.current!.scrollTop).toBe(0);
  });

  it("展开的深层节点带正确 aria 层级与同级位置元数据", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    render(
      <Harness
        nodes={nestedNodes()}
        scrollRef={scrollRef}
        initialExpanded={new Set(["dirA", "dirA/deep"])}
      />
    );
    const deep = screen.getByRole("treeitem", { name: "d1" });
    expect(deep).toHaveAttribute("aria-level", "3");
    expect(deep).toHaveAttribute("aria-posinset", "1");
    expect(deep).toHaveAttribute("aria-setsize", "2");
    const folder = screen.getByRole("treeitem", { name: /dirA/ });
    expect(folder).toHaveAttribute("aria-level", "1");
    expect(folder).toHaveAttribute("aria-posinset", "1");
    expect(folder).toHaveAttribute("aria-expanded", "true");
    const deepLi = deep.parentElement!;
    expect(deepLi.style.paddingLeft).toBe("38px");
  });

  it("卸载取消待决帧并摘除监听", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const view = render(<Harness nodes={bigFiles(100)} scrollRef={scrollRef} />);
    const scroller = scrollRef.current!;
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
  });
});

describe("FilesVirtualTree · 补充边界", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame = 0;
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  };
  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = ++nextFrame;
      frames.set(id, cb);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("空目录（无子项）右侧不跳转：ArrowRight 无实际子行可进", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const nodes: FileTreeNode[] = [
      { name: "empty", relPath: "empty", children: [] },
      { name: "sib.md", relPath: "sib.md", path: "/r/sib.md" },
    ];
    render(
      <Harness nodes={nodes} scrollRef={scrollRef} initialExpanded={new Set(["empty"])} />
    );
    const folder = screen.getByRole("treeitem", { name: /empty/ });
    act(() => folder.focus());
    fireEvent.keyDown(folder, { key: "ArrowRight" });
    expect(document.activeElement).toBe(folder);
  });

  it("当前行后到时才定位：初始折叠缺位不重复移动用户焦点", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const api = { expand: (_p: string) => {} };
    function Late({ nodes }: { nodes: FileTreeNode[] }) {
      const [expanded, setExpanded] = useState<Set<string>>(new Set());
      api.expand = (p) => setExpanded((prev) => new Set(prev).add(p));
      return (
        <div className="outline-panel__scroll" ref={scrollRef}>
          <FilesVirtualTree
            rows={flattenVisibleFileTree(nodes, expanded)}
            scrollRef={scrollRef}
            documentPath="/r/dirA/deep/d2.md"
            onToggle={(p) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              })
            }
            onOpenPath={() => {}}
            expanded={expanded}
            flat={false}
            resetKey=""
            FolderIcon={FolderIcon}
          />
        </div>
      );
    }
    const nodes = buildFileTree([
      { path: "/r/dirA/deep/d1.md", relPath: "dirA/deep/d1.md" },
      { path: "/r/dirA/deep/d2.md", relPath: "dirA/deep/d2.md" },
      ...Array.from({ length: 300 }, (_, i) => ({
        path: `/r/m${String(i).padStart(3, "0")}.md`,
        relPath: `m${String(i).padStart(3, "0")}.md`,
      })),
    ]);
    render(<Late nodes={nodes} />);
    expect(scrollRef.current!.scrollTop).toBe(0);

    act(() => {
      api.expand("dirA");
      api.expand("dirA/deep");
    });
    const current = screen.getByRole("treeitem", { name: "d2" });
    expect(current).toHaveClass("outline-panel__link--active");
    const rowTop = Number(current.parentElement!.style.top.replace("px", ""));
    const height = 480;
    expect(rowTop).toBeGreaterThanOrEqual(scrollRef.current!.scrollTop);
    expect(rowTop + 32).toBeLessThanOrEqual(scrollRef.current!.scrollTop + height);
  });

  it("ResizeObserver 高度增长扩大窗口；卸载时断开观察者", () => {
    const observers: Array<{ cb: ResizeObserverCallback; disconnect: () => void }> = [];
    const disconnects: number[] = [];
    class RO {
      cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        observers.push(this as never);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnects.push(1);
      }
    }
    vi.stubGlobal("ResizeObserver", RO);
    const scroller = document.createElement("div");
    Object.defineProperty(scroller, "clientHeight", { value: 480, configurable: true });
    const scrollRef = { current: scroller };
    const nodes = Array.from({ length: 400 }, (_, i) => ({
      name: `g${String(i).padStart(3, "0")}.md`,
      relPath: `g${String(i).padStart(3, "0")}.md`,
      path: `/r/g${String(i).padStart(3, "0")}.md`,
    }));
    const view = render(
      <FilesVirtualTree
        rows={flattenVisibleFileTree(nodes, new Set())}
        scrollRef={scrollRef}
        documentPath={null}
        onToggle={() => {}}
        onOpenPath={() => {}}
        expanded={new Set()}
        flat={false}
        resetKey=""
        FolderIcon={FolderIcon}
      />,
      { container: scroller }
    );
    const before = scroller.querySelectorAll(".library-tree__file").length;
    Object.defineProperty(scroller, "clientHeight", { value: 640, configurable: true });
    act(() => {
      observers[0]?.cb([], {} as ResizeObserver);
    });
    act(flushFrames);
    const after = scroller.querySelectorAll(".library-tree__file").length;
    expect(after).toBeGreaterThan(before);

    view.unmount();
    expect(disconnects.length).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });
});

describe("FilesVirtualTree · 终检回归", () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame = 0;
  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  };
  const scrollTo = (el: HTMLElement, top: number) => {
    act(() => {
      el.scrollTop = top;
      el.dispatchEvent(new Event("scroll"));
    });
    act(flushFrames);
  };
  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = ++nextFrame;
      frames.set(id, cb);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("行集未变时滚动不再重复扫描当前文档目标（findIndex 只在换代/行集变化时跑）", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const rows = flattenVisibleFileTree(bigFiles(400), new Set());
    const spy = vi.spyOn(rows, "findIndex");
    render(
      <div className="outline-panel__scroll" ref={scrollRef}>
        <FilesVirtualTree
          rows={rows}
          scrollRef={scrollRef}
          documentPath="/root/not-present.md"
          onToggle={() => {}}
          onOpenPath={() => {}}
          expanded={new Set()}
          flat={false}
          resetKey=""
          FolderIcon={FolderIcon}
        />
      </div>
    );
    const afterMount = spy.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    scrollTo(scrollRef.current!, 3000);
    scrollTo(scrollRef.current!, 6000);
    expect(spy.mock.calls.length).toBe(afterMount);
  });

  it("焦点行消失且树持焦：幸存祖先行被滚入视口后接收 DOM 焦点", () => {
    const scrollRef = { current: null as HTMLDivElement | null };
    const api = { collapse: (_p: string) => {} };
    function Wide() {
      const [expanded, setExpanded] = useState<Set<string>>(new Set(["adir"]));
      api.collapse = (p) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(p);
          return next;
        });
      const nodes = buildFileTree([
        ...Array.from({ length: 300 }, (_, i) => ({
          path: `/r/adir/c${String(i).padStart(3, "0")}.md`,
          relPath: `adir/c${String(i).padStart(3, "0")}.md`,
        })),
        ...Array.from({ length: 300 }, (_, i) => ({
          path: `/r/m${String(i).padStart(3, "0")}.md`,
          relPath: `m${String(i).padStart(3, "0")}.md`,
        })),
      ]);
      return (
        <div className="outline-panel__scroll" ref={scrollRef}>
          <FilesVirtualTree
            rows={flattenVisibleFileTree(nodes, expanded)}
            scrollRef={scrollRef}
            documentPath={null}
            onToggle={(p) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(p)) next.delete(p);
                else next.add(p);
                return next;
              })
            }
            onOpenPath={() => {}}
            expanded={expanded}
            flat={false}
            resetKey=""
            FolderIcon={FolderIcon}
          />
        </div>
      );
    }
    render(<Wide />);
    const scroller = scrollRef.current!;
    scrollTo(scroller, 290 * 32);
    const deep = screen.getByRole("treeitem", { name: "c289" });
    act(() => deep.focus());
    expect(document.activeElement).toBe(deep);

    act(() => api.collapse("adir"));
    const folder = screen.getByRole("treeitem", { name: /adir/ });
    expect(document.activeElement).toBe(folder);
    const li = folder.parentElement!;
    const rowTop = Number(li.style.top.replace("px", ""));
    expect(rowTop).toBeGreaterThanOrEqual(scroller.scrollTop);
    expect(rowTop + 32).toBeLessThanOrEqual(scroller.scrollTop + 480);
  });
});
