import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorState } from "./ErrorState";

describe("ErrorState", () => {
  it("无最近列表：错误文案、路径与「重新打开」按钮照旧，不渲染列表区块", () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        message="Cannot open file"
        path="C:/notes/missing.md"
        onRetry={onRetry}
        recentFiles={[]}
        onOpenRecent={() => {}}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Cannot open file");
    expect(screen.getByText("无法打开此 Markdown 文件")).toBeInTheDocument();
    expect(screen.getByText("C:/notes/missing.md")).toBeInTheDocument();
    expect(screen.queryByText("最近打开")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重新打开" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("有最近列表：错误页里渲染「最近打开」列表，点击回调带完整路径", () => {
    const onOpenRecent = vi.fn();
    render(
      <ErrorState
        message="Cannot open file"
        path="C:/notes/missing.md"
        onRetry={() => {}}
        recentFiles={["C:/vault/笔记/日更.md", "C:\\vault\\归档\\旧稿.md"]}
        onOpenRecent={onOpenRecent}
      />
    );

    // 打不开文件时最需要的替代入口：列表就在错误消息与「重新打开」按钮之后
    expect(screen.getByText("最近打开")).toBeInTheDocument();
    expect(screen.getByText("日更")).toBeInTheDocument();
    expect(screen.getByText("C:/vault/笔记")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /旧稿/ }));
    expect(onOpenRecent).toHaveBeenCalledWith("C:\\vault\\归档\\旧稿.md");
  });

  it("对话框本身失败（无 path）时错误页照常给出最近列表", () => {
    render(
      <ErrorState
        message="dialog exploded"
        onRetry={() => {}}
        recentFiles={["C:/vault/笔记/日更.md"]}
        onOpenRecent={() => {}}
      />
    );

    expect(screen.getByRole("alert")).toHaveTextContent("dialog exploded");
    expect(screen.getByRole("button", { name: /日更/ })).toBeInTheDocument();
  });

  it("「重新打开」接线：每次点击都触发 onRetry（有最近列表时不被列表抢走），无回调则不渲染按钮", () => {
    const onRetry = vi.fn();
    const { unmount } = render(
      <ErrorState
        message="Cannot open file"
        path="C:/notes/missing.md"
        onRetry={onRetry}
        recentFiles={["C:/vault/笔记/日更.md"]}
        onOpenRecent={() => {}}
      />
    );

    const retry = screen.getByRole("button", { name: "重新打开" });
    expect(retry).toHaveAttribute("type", "button");
    fireEvent.click(retry);
    fireEvent.click(retry);
    // 打不开文件时列表是替代入口、按钮是重试入口：两条路都必须在，且各自只触发自己的回调
    expect(onRetry).toHaveBeenCalledTimes(2);
    unmount();

    // 未接线（无 onRetry）时按钮整体不渲染——不给一个点了没反应的实色按钮
    render(<ErrorState message="dialog exploded" recentFiles={[]} onOpenRecent={() => {}} />);
    expect(screen.queryByRole("button", { name: "重新打开" })).toBeNull();
  });
});
