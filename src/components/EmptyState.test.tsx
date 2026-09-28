import { fireEvent, render, screen } from "@testing-library/react";
import { compactPath, dirname } from "../lib/path";
import { EmptyState } from "./EmptyState";

const noop = () => {};

function baseProps(overrides: Partial<Parameters<typeof EmptyState>[0]> = {}) {
  return {
    onOpen: noop,
    onOpenLibrary: noop,
    recentFiles: [] as string[],
    recentLibraries: [] as { path: string; name: string }[],
    onOpenRecent: noop,
    onOpenRecentLibrary: noop,
    ...overrides,
  };
}

describe("EmptyState（方案 B · 一体拖放区）", () => {
  it("渲染拖放区与两个「选择…」按钮；无最近列表时分组不渲染", () => {
    render(<EmptyState {...baseProps()} />);

    expect(screen.getByText("把 .md 文件或文件夹拖进来。")).toBeInTheDocument();
    expect(screen.getByText("文件进阅读 · 文件夹进库")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择文件…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择文件夹…" })).toBeInTheDocument();
    expect(screen.queryByText("最近打开")).toBeNull();
    expect(screen.queryByText("最近库")).toBeNull();
  });

  it("有最近列表：文件名剥 .md、目录紧随其后，点击回调带完整路径", () => {
    const onOpenRecent = vi.fn();
    render(
      <EmptyState
        {...baseProps({
          recentFiles: ["C:/vault/笔记/日更.md", "C:\\vault\\归档\\旧稿.md"],
          onOpenRecent,
        })}
      />
    );

    expect(screen.getByText("最近打开")).toBeInTheDocument();
    expect(screen.getByText("日更")).toBeInTheDocument();
    expect(screen.getByText("C:/vault/笔记")).toBeInTheDocument();
    // 分隔符写法不同也要还原出文件名与目录
    expect(screen.getByText("旧稿")).toBeInTheDocument();
    expect(screen.getByText("C:/vault/归档")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /日更/ }));
    expect(onOpenRecent).toHaveBeenCalledWith("C:/vault/笔记/日更.md");
  });

  it("最近库分组：条目带「库」签、目录显示完整路径、点击回调带库根", () => {
    const onOpenRecentLibrary = vi.fn();
    render(
      <EmptyState
        {...baseProps({
          recentLibraries: [
            { path: "D:/vaults/wisdom", name: "wisdom" },
            { path: "D:/projects/vellum", name: "dev-log" },
          ],
          onOpenRecentLibrary,
        })}
      />
    );

    expect(screen.getByText("最近库")).toBeInTheDocument();
    expect(screen.getByText("wisdom")).toBeInTheDocument();
    expect(screen.getByText("dev-log")).toBeInTheDocument();
    expect(screen.getAllByText("库")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /wisdom/ }));
    expect(onOpenRecentLibrary).toHaveBeenCalledWith("D:/vaults/wisdom");
  });

  it("长目录路径做紧凑化，不整条铺开（最近文件分组的既有行为）", () => {
    const long = "C:/Users/name/Documents/Projects/vault/areas/reading/notes/deep/deeper/deepest/笔记.md";
    render(<EmptyState {...baseProps({ recentFiles: [long] })} />);

    expect(screen.getByText("笔记")).toBeInTheDocument();
    const dir = screen.getByText(/^\.\.\.\//);
    expect(dir.textContent).toBe(compactPath(dirname(long)));
    expect(dir.textContent!.length).toBeLessThan(long.length);
  });

  it("两个按钮分别回调 onOpen / onOpenLibrary", () => {
    const onOpen = vi.fn();
    const onOpenLibrary = vi.fn();
    render(<EmptyState {...baseProps({ onOpen, onOpenLibrary })} />);

    fireEvent.click(screen.getByRole("button", { name: "选择文件…" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpenLibrary).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "选择文件夹…" }));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
