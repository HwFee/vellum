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

  it("路径退出顶栏：中列只留拖动热区，不再有 .top-bar__path / .top-bar__meta", () => {
    render(<TopBar onOpen={vi.fn()} />);

    const header = document.querySelector(".top-bar")!;
    expect(header.querySelector(".top-bar__path")).toBeNull();
    expect(header.querySelector(".top-bar__meta")).toBeNull();
    expect(header.querySelector(".top-bar__spacer")).toBeInTheDocument();
    expect(header.textContent).not.toContain("未打开文件");
  });

  it("大纲切换与打开文件按钮补 tooltip，与编辑切换一致", () => {
    render(<TopBar onOpen={vi.fn()} isOutlineOpen={false} onToggleOutline={vi.fn()} />);

    expect(screen.getByRole("button", { name: "切换大纲" })).toHaveAttribute(
      "title",
      "切换大纲（Ctrl+B）"
    );
    expect(screen.getByRole("button", { name: "打开文件" })).toHaveAttribute("title", "打开文件");
  });

  it("mdlog 记录中时在齿轮右侧显示「记录中」小章", () => {
    const settings = { fontSize: 14, columnWidth: 800, lineHeight: 1.55 };
    const { rerender } = render(
      <TopBar onOpen={vi.fn()} readerSettings={settings} onReaderSettingsChange={vi.fn()} />
    );
    expect(screen.queryByText("记录中")).toBeNull();

    rerender(
      <TopBar
        onOpen={vi.fn()}
        readerSettings={settings}
        onReaderSettingsChange={vi.fn()}
        isRecording
      />
    );
    const chip = screen.getByText("记录中");
    expect(chip).toBeInTheDocument();

    // 位置：小章在按钮簇内，且排在设置齿轮之后（齿轮是该簇最后一枚按钮）
    const cluster = chip.closest(".top-bar__actions--left")!;
    const children = Array.from(cluster.children);
    expect(children[children.length - 1]).toBe(chip);
    expect(children.indexOf(chip)).toBeGreaterThan(
      children.indexOf(screen.getByRole("button", { name: "阅读设置" }))
    );
  });

  it("无阅读设置入口时「记录中」小章仍落在按钮簇末尾", () => {
    render(<TopBar onOpen={vi.fn()} isRecording />);

    const chip = screen.getByText("记录中");
    const cluster = chip.closest(".top-bar__actions--left")!;
    expect(Array.from(cluster.children)[Array.from(cluster.children).length - 1]).toBe(chip);
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

  it("按钮顺序：大纲居首，‹ › 紧随成对，编辑与打开其后；无历史时历史按钮禁用并带快捷键提示", () => {
    render(<TopBar onOpen={vi.fn()} isOutlineOpen={false} onToggleOutline={vi.fn()} />);

    const back = screen.getByRole("button", { name: "后退" });
    const forward = screen.getByRole("button", { name: "前进" });
    expect(back).toHaveAttribute("title", "后退（Alt+←）");
    expect(forward).toHaveAttribute("title", "前进（Alt+→）");
    // 禁用由 disabled 属性表达（视觉上是透明度，见 kami.css 的 .nav-button:disabled）
    expect(back).toBeDisabled();
    expect(forward).toBeDisabled();

    const cluster = back.closest(".top-bar__actions--left")!;
    const order = Array.from(cluster.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label")
    );
    expect(order).toEqual(["切换大纲", "后退", "前进", "切换编辑视图", "打开文件"]);
  });

  it("有设置入口时：分隔线落在打开按钮之后、齿轮之前，齿轮在簇内", () => {
    render(
      <TopBar
        onOpen={vi.fn()}
        isOutlineOpen={false}
        onToggleOutline={vi.fn()}
        readerSettings={{ fontSize: 14, columnWidth: 800, lineHeight: 1.55 }}
        onReaderSettingsChange={vi.fn()}
      />
    );

    const cluster = screen.getByRole("button", { name: "打开文件" }).closest(".top-bar__actions--left")!;
    const children = Array.from(cluster.children);
    const divider = cluster.querySelector(".top-bar__divider")!;
    const open = screen.getByRole("button", { name: "打开文件" });
    // 齿轮包在 .settings-anchor 里（弹层的定位上下文），故按该锚点比位置
    const anchor = cluster.querySelector(".settings-anchor")!;

    expect(children.indexOf(divider)).toBeGreaterThan(children.indexOf(open));
    expect(children.indexOf(divider)).toBeLessThan(children.indexOf(anchor));
    expect(anchor.contains(screen.getByRole("button", { name: "阅读设置" }))).toBe(true);

    const order = Array.from(cluster.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label")
    );
    expect(order).toEqual([
      "切换大纲",
      "后退",
      "前进",
      "切换编辑视图",
      "打开文件",
      "阅读设置",
    ]);
  });

  it("有历史时可点并触发回调，禁用的一侧不触发", () => {
    const handleBack = vi.fn();
    const handleForward = vi.fn();
    const { rerender } = render(
      <TopBar onOpen={vi.fn()} canGoBack onGoBack={handleBack} onGoForward={handleForward} />
    );

    expect(screen.getByRole("button", { name: "后退" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "前进" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "后退" }));
    expect(handleBack).toHaveBeenCalledTimes(1);
    expect(handleForward).not.toHaveBeenCalled();

    rerender(
      <TopBar
        onOpen={vi.fn()}
        canGoBack
        canGoForward
        onGoBack={handleBack}
        onGoForward={handleForward}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "前进" }));
    expect(handleForward).toHaveBeenCalledTimes(1);
  });
});
