import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import { OutlinePanel } from "./OutlinePanel";
import type { OutlineHeading } from "../types";

const sampleHeadings: OutlineHeading[] = [
  { id: "title", level: 1, text: "Title" },
  { id: "section-a", level: 2, text: "Section A" },
  { id: "subsection", level: 3, text: "Subsection" },
];

const searchDefaults = {
  searchQuery: "",
  onSearchChange: () => {},
  matchCount: 0,
  activeMatchIndex: 0,
  onNextMatch: () => {},
  onPrevMatch: () => {},
  searchInputRef: createRef<HTMLInputElement>(),
};

describe("OutlinePanel", () => {
  it("renders headings with indentation", () => {
    render(<OutlinePanel headings={sampleHeadings} {...searchDefaults} />);

    const items = screen.getAllByRole("button");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Title");
    expect(items[1]).toHaveTextContent("Section A");
    expect(items[2]).toHaveTextContent("Subsection");
  });

  it("highlights the active heading", () => {
    render(<OutlinePanel headings={sampleHeadings} activeHeadingId="section-a" {...searchDefaults} />);
    const active = screen.getByRole("button", { name: "Section A" });
    expect(active).toHaveClass("outline-panel__link--active");
  });

  it("calls onSelectHeading when clicked", () => {
    const handleSelect = vi.fn();
    render(<OutlinePanel headings={sampleHeadings} onSelectHeading={handleSelect} {...searchDefaults} />);

    fireEvent.click(screen.getByRole("button", { name: "Section A" }));
    expect(handleSelect).toHaveBeenCalledWith("section-a");
  });

  it("shows empty message when no headings", () => {
    render(<OutlinePanel headings={[]} {...searchDefaults} />);
    expect(screen.getByText("本文档暂无目录")).toBeInTheDocument();
  });

  it("nests lower-level headings inside their parent's item", () => {
    render(<OutlinePanel headings={sampleHeadings} {...searchDefaults} />);

    const sectionA = screen.getByRole("button", { name: "Section A" });
    const subsection = screen.getByRole("button", { name: "Subsection" });

    const nestedList = subsection.closest("ul");
    expect(nestedList?.parentElement?.tagName).toBe("LI");
    expect(nestedList?.parentElement).toContainElement(sectionA);
  });

  it("does not indent items with inline padding", () => {
    render(<OutlinePanel headings={sampleHeadings} {...searchDefaults} />);
    for (const button of screen.getAllByRole("button")) {
      expect(button.parentElement).not.toHaveStyle({ paddingLeft: "12px" });
      expect(button.parentElement).not.toHaveStyle({ paddingLeft: "24px" });
    }
  });

  it("follows the active outline item even while search is active", () => {
    // 激活项在列表滚动区视口下方，跟随触发时一定会启动 rAF 缓动动画
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("outline-panel__scroll")) {
        return { top: 0, bottom: 600, height: 600 } as DOMRect;
      }
      if (this.classList.contains("outline-panel__link--active")) {
        return { top: 700, bottom: 720, height: 20 } as DOMRect;
      }
      return { top: 0, bottom: 0, height: 0 } as DOMRect;
    });
    const raf = vi.spyOn(window, "requestAnimationFrame");

    render(
      <OutlinePanel
        headings={sampleHeadings}
        activeHeadingId="section-a"
        {...searchDefaults}
        searchQuery="section"
      />
    );

    // 所有正文滚动大纲都跟随：搜索激活（含输入/删除驱动）也不例外
    expect(raf).toHaveBeenCalled();
  });
});
