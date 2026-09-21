import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsNav } from "./SettingsNav";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./SettingsView";

function setup(activeSectionId: SettingsSectionId = "reading") {
  const onSelectSection = vi.fn();
  const searchInputRef = { current: null };
  const view = render(
    <SettingsNav
      activeSectionId={activeSectionId}
      onSelectSection={onSelectSection}
      searchInputRef={searchInputRef}
    />
  );
  return { onSelectSection, searchInputRef, view };
}

describe("SettingsNav", () => {
  it("题头「設定」+ 描边搜索框 + 四个分节条目（复用大纲语汇）", () => {
    setup();

    const header = document.querySelector(".outline-panel__header");
    expect(header).toHaveTextContent("設定");
    expect(screen.getByLabelText("搜索设置项")).toHaveAttribute("placeholder", "寻项…");
    // idle 态右侧是 kbd「Ctrl K」，与大纲一致
    expect(screen.getByText("Ctrl K")).toHaveClass("outline-search__kbd");

    for (const section of SETTINGS_SECTIONS) {
      expect(screen.getByRole("button", { name: section.label })).toBeInTheDocument();
    }
    expect(document.querySelector("nav")).toHaveAttribute("aria-label", "设置分节");
  });

  it("激活条目复用 --active 语汇（brand + 500 + 左缘靛青轨）", () => {
    setup("updates");

    const active = screen.getByRole("button", { name: "更新" });
    expect(active).toHaveClass("outline-panel__link--active");
    expect(active).toHaveAttribute("aria-current", "true");
    const inactive = screen.getByRole("button", { name: "阅读" });
    expect(inactive).not.toHaveClass("outline-panel__link--active");
    expect(inactive).not.toHaveAttribute("aria-current");
  });

  it("点条目回调分节 id（滚动交给 App 的同一条缓动路径）", () => {
    const { onSelectSection } = setup();

    fireEvent.click(screen.getByRole("button", { name: "关于与数据" }));
    expect(onSelectSection).toHaveBeenCalledWith("about");
  });

  it("输入即过滤条目，无匹配时给空态；清除按钮复位", () => {
    setup();
    const input = screen.getByLabelText("搜索设置项");

    fireEvent.change(input, { target: { value: "更新" } });
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "阅读" })).toBeNull();
    expect(screen.queryByText("Ctrl K")).toBeNull();

    fireEvent.change(input, { target: { value: "不存在" } });
    expect(screen.getByText("无匹配分节")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(screen.getByRole("button", { name: "阅读" })).toBeInTheDocument();
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
  });

  it("搜索框里的 Escape 只清词：事件不再冒到 window（不连带关掉设置视图）", () => {
    setup();
    const input = screen.getByLabelText("搜索设置项");
    fireEvent.change(input, { target: { value: "更新" } });

    const windowSpy = vi.fn();
    window.addEventListener("keydown", windowSpy);

    fireEvent.keyDown(input, { key: "Escape" });

    expect(input).toHaveValue("");
    expect(windowSpy).not.toHaveBeenCalled();
    window.removeEventListener("keydown", windowSpy);
  });
});
