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

// 深层级（h4–h6）：大纲收录到 h6，条目带自己的层级类（l4–l6 的缩进/字号/颜色在 kami.css）
const deepHeadings: OutlineHeading[] = [
  { id: "title", level: 1, text: "Title" },
  { id: "section-a", level: 2, text: "Section A" },
  { id: "subsection", level: 3, text: "Subsection" },
  { id: "detail", level: 4, text: "Detail" },
  { id: "finer", level: 5, text: "Finer" },
  { id: "finest", level: 6, text: "Finest" },
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

  it("h4–h6 条目带层级类，但编号仍只给 h1", () => {
    render(<OutlinePanel headings={deepHeadings} {...searchDefaults} />);

    for (const [level, text] of [
      [1, "Title"],
      [2, "Section A"],
      [3, "Subsection"],
      [4, "Detail"],
      [5, "Finer"],
      [6, "Finest"],
    ] as const) {
      expect(screen.getByRole("button", { name: text })).toHaveClass(`outline-panel__link--l${level}`);
    }

    // 中文数字是「章」的记号：只给 h1，深层级不带「四、」这类编号
    expect(screen.getByRole("button", { name: "Title" })).toHaveTextContent("一、");
    expect(screen.getByRole("button", { name: "Detail" })).not.toHaveTextContent("、");
  });

  it("点击 h4 条目把 id 交给 onSelectHeading（跳转与 h1–h3 同一条路径）", () => {
    const handleSelect = vi.fn();
    render(
      <OutlinePanel headings={deepHeadings} onSelectHeading={handleSelect} {...searchDefaults} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Detail" }));
    expect(handleSelect).toHaveBeenCalledWith("detail");
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

  it("idle 态搜索框 kbd chip 提示 Ctrl K（Windows 应用，不用 ⌘）", () => {
    render(<OutlinePanel headings={sampleHeadings} {...searchDefaults} />);
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
  });

  it("查询非空且 0 匹配时计数位显示「无匹配」，计数容器带 aria-live", () => {
    render(
      <OutlinePanel headings={sampleHeadings} {...searchDefaults} searchQuery="zzz" matchCount={0} />
    );
    const count = screen.getByText("无匹配");
    expect(count).toHaveAttribute("aria-live", "polite");
  });

  it("有查询时显示清除按钮，点击清空并保焦", () => {
    const handleSearchChange = vi.fn();
    const inputRef = createRef<HTMLInputElement>();
    render(
      <OutlinePanel
        headings={sampleHeadings}
        {...searchDefaults}
        searchQuery="sec"
        matchCount={2}
        onSearchChange={handleSearchChange}
        searchInputRef={inputRef}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
    expect(handleSearchChange).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(inputRef.current);
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
