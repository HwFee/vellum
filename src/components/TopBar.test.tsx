import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TopBar } from "./TopBar";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));

describe("TopBar", () => {
  it("renders the outline toggle and open button", () => {
    render(<TopBar onOpen={vi.fn()} isOutlineOpen={false} onToggleOutline={vi.fn()} />);

    expect(screen.getByRole("button", { name: "切换大纲" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开文件" })).toBeInTheDocument();
  });

  it("大纲切换与打开文件按钮补 tooltip，与编辑切换一致", () => {
    render(<TopBar onOpen={vi.fn()} isOutlineOpen={false} onToggleOutline={vi.fn()} />);

    expect(screen.getByRole("button", { name: "切换大纲" })).toHaveAttribute(
      "title",
      "切换大纲（Ctrl+B）"
    );
    expect(screen.getByRole("button", { name: "打开文件" })).toHaveAttribute("title", "打开文件");
  });

  it("mdlog 记录中时在路径右侧显示「记录中」小章", () => {
    const { rerender } = render(<TopBar onOpen={vi.fn()} parentPath="C:/notes" />);
    expect(screen.queryByText("记录中")).toBeNull();

    rerender(<TopBar onOpen={vi.fn()} parentPath="C:/notes" isRecording />);
    expect(screen.getByText("记录中")).toBeInTheDocument();
  });

  it("calls onToggleOutline when the outline toggle is clicked", () => {
    const handleToggle = vi.fn();
    render(<TopBar onOpen={vi.fn()} isOutlineOpen={false} onToggleOutline={handleToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "切换大纲" }));
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });

  it("toggles the edit view and reflects the editing state", () => {
    const handleToggleEdit = vi.fn();
    render(<TopBar onOpen={vi.fn()} isEditing canEdit onToggleEdit={handleToggleEdit} />);

    const button = screen.getByRole("button", { name: "切换编辑视图" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(handleToggleEdit).toHaveBeenCalledTimes(1);
  });

  it("disables the edit toggle while mdlog logging is active", () => {
    render(<TopBar onOpen={vi.fn()} canEdit={false} onToggleEdit={vi.fn()} />);

    const button = screen.getByRole("button", { name: "切换编辑视图" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "记录中 · 断开连接后才能修改");
  });

  it("阅读态显示笔、编辑态显示书，提示语随状态切换（Obsidian 视图切换语义）", () => {
    const { rerender } = render(<TopBar onOpen={vi.fn()} isEditing={false} />);

    const reading = screen.getByRole("button", { name: "切换编辑视图" });
    expect(reading).toHaveAttribute("data-icon", "pen");
    expect(reading).toHaveAttribute("title", "就地编辑（Ctrl+E）");

    rerender(<TopBar onOpen={vi.fn()} isEditing />);

    const editing = screen.getByRole("button", { name: "切换编辑视图" });
    expect(editing).toHaveAttribute("data-icon", "book");
    expect(editing).toHaveAttribute("title", "返回阅读视图（Ctrl+E）");
  });
});
