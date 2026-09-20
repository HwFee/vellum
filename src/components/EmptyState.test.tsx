import { fireEvent, render, screen } from "@testing-library/react";
import { compactPath, dirname } from "../lib/path";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("无最近列表：不渲染最近区块，只留既有文案、打开按钮与拖放提示", () => {
    render(<EmptyState onOpen={() => {}} recentFiles={[]} onOpenRecent={() => {}} />);

    expect(screen.getByText("打开 Markdown 文件开始查看。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开文件…" })).toBeInTheDocument();
    expect(screen.getByText("或将 .md 文件拖入窗口")).toBeInTheDocument();
    expect(screen.queryByText("最近打开")).toBeNull();
  });

  it("有最近列表：文件名剥 .md、目录紧随其后，点击回调带完整路径", () => {
    const onOpenRecent = vi.fn();
    render(
      <EmptyState
        onOpen={() => {}}
        recentFiles={["C:/vault/笔记/日更.md", "C:\\vault\\归档\\旧稿.md"]}
        onOpenRecent={onOpenRecent}
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

  it("长目录路径做紧凑化，不整条铺开", () => {
    const long = "C:/Users/name/Documents/Projects/vault/areas/reading/notes/deep/deeper/deepest/笔记.md";
    render(<EmptyState onOpen={() => {}} recentFiles={[long]} onOpenRecent={() => {}} />);

    expect(screen.getByText("笔记")).toBeInTheDocument();
    // compactPath 的产出以省略号开头，且长度受控
    const dir = screen.getByText(/^\.\.\.\//);
    expect(dir.textContent).toBe(compactPath(dirname(long)));
    expect(dir.textContent!.length).toBeLessThan(long.length);
  });

  it("点「打开文件…」调用 onOpen", () => {
    const onOpen = vi.fn();
    render(<EmptyState onOpen={onOpen} recentFiles={[]} onOpenRecent={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
