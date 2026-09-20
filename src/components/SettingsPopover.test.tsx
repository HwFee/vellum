import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsPopover } from "./SettingsPopover";
import { READER_SETTINGS_DEFAULT, type ReaderSettings } from "../hooks/useReaderSettings";

function setup(settings: ReaderSettings = READER_SETTINGS_DEFAULT) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const anchorRef = { current: null };
  render(
    <SettingsPopover
      settings={settings}
      onChange={onChange}
      onClose={onClose}
      anchorRef={anchorRef}
    />
  );
  return { onChange, onClose };
}

describe("SettingsPopover", () => {
  it("渲染正文字号 / 栏宽 / 行高三个分段组，并标出当前选中值", () => {
    setup();

    for (const label of ["正文字号", "栏宽", "行高"]) {
      expect(screen.getByRole("group", { name: label })).toBeInTheDocument();
    }
    // 默认值高亮：14 / 800 / 1.55
    expect(screen.getByRole("button", { name: "14" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "800" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1.55" })).toHaveAttribute("aria-pressed", "true");
    // 未选项不呈按下态
    expect(screen.getByRole("button", { name: "16" })).toHaveAttribute("aria-pressed", "false");
  });

  it("点击分段触发对应设置回调", () => {
    const { onChange } = setup();

    fireEvent.click(screen.getByRole("button", { name: "16" }));
    expect(onChange).toHaveBeenCalledWith({ fontSize: 16 });

    fireEvent.click(screen.getByRole("button", { name: "960" }));
    expect(onChange).toHaveBeenCalledWith({ columnWidth: 960 });

    fireEvent.click(screen.getByRole("button", { name: "1.7" }));
    expect(onChange).toHaveBeenCalledWith({ lineHeight: 1.7 });
  });

  it("「恢复默认」回写整套默认设置", () => {
    const { onChange } = setup({ fontSize: 18, columnWidth: 960, lineHeight: 1.7 });

    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(onChange).toHaveBeenCalledWith(READER_SETTINGS_DEFAULT);
  });

  it("点外部与 Escape 关闭弹层", () => {
    const { onClose } = setup();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("点击弹层内部不关闭", () => {
    const { onClose } = setup();

    fireEvent.mouseDown(screen.getByRole("dialog", { name: "阅读设置" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
