import { act, fireEvent, render, screen } from "@testing-library/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { MarkdownDocument } from "./MarkdownDocument";
import { buildEditUnits } from "../lib/editUnits";
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

/// jsdom 里所有 getBoundingClientRect() 都返回全 0（块内比率恒为 0），caret 计算路径因此
/// 无法被断言。这里按元素指定测量盒，让「点击高度 → 比率 → 源码偏移」可精确验证。
/// 桩刻意打在**元素实例**上（而非 Element/HTMLElement.prototype）：本文件已有若干用例
/// 对 HTMLElement.prototype 打了不还原的桩，原型级桩会被它们遮住，导致断言随文件内
/// 测试顺序漂移。
function stubRects(entries: Array<[Element, { top: number; height: number }]>) {
  const zero = {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as unknown as DOMRect;

  return entries.map(([element, { top, height }]) =>
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(
      (): DOMRect => ({ ...zero, top, height, bottom: top + height, y: top }) as DOMRect
    )
  );
}

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

  it("h4–h6 与 h1–h3 同源分配 id：大纲条目的 id 就是正文标题 id（点击跳转靠 getElementById）", () => {
    const markdown = ["# Title", "", "### Sub", "", "#### Detail", "", "###### Finest"].join("\n");
    const headings = extractOutline(markdown);

    render(<MarkdownDocument markdown={markdown} headings={headings} />);

    expect(screen.getByRole("heading", { name: "Detail" })).toHaveAttribute("id", "detail");
    expect(screen.getByRole("heading", { name: "Finest" })).toHaveAttribute("id", "finest");
    for (const heading of headings) {
      expect(document.getElementById(heading.id)).not.toBeNull();
    }
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

  it("renders CJK-adjacent bold and strikethrough that strict CommonMark leaves literal", () => {
    // CommonMark flanking 规则下，** 跨「汉字+括号」交界会被判为普通字符（GitHub/VS Code 原样输出）；
    // remark-cjk-friendly 放宽该判定，中文书写习惯下应渲染为真正的强调
    const markdown = [
      "所谓的**记忆腐化(Memory Rot)**是情景记忆系统的隐患",
      "",
      "这是~~已废弃方案(旧版)~~不建议采用的写法",
    ].join("\n");
    const { container } = render(<MarkdownDocument markdown={markdown} />);

    const strong = container.querySelector("strong");
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent("记忆腐化(Memory Rot)");
    const del = container.querySelector("del");
    expect(del).toBeInTheDocument();
    expect(del).toHaveTextContent("已废弃方案(旧版)");
    expect(container.textContent).not.toContain("**");
    expect(container.textContent).not.toContain("~~");
  });

  it("renders bold when the closing ** sits between an ASCII paren and a CJK character (mdlog 实录回归)", () => {
    // 2026-09-04 线上事故实录：`**标准终止条件(Stop Condition)**是` 的闭 ** 左侧贴 ASCII 括号、
    // 右侧贴汉字，严格 flanking 判为普通字符被原样输出。此用例锁定该失败类别不再回潮
    const markdown = "课程推荐的**标准终止条件(Stop Condition)**是哪一种？";
    const { container } = render(<MarkdownDocument markdown={markdown} />);

    const strong = container.querySelector("strong");
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent("标准终止条件(Stop Condition)");
    expect(container.textContent).not.toContain("**");
  });

  it("renders emphasis adjacent to CJK quotation marks and sentence-final particles", () => {
    const cases: Array<{ markdown: string; tag: "strong" | "del"; text: string }> = [
      { markdown: "**「记忆腐化」**是隐患", tag: "strong", text: "「记忆腐化」" },
      { markdown: "答案是**C**！", tag: "strong", text: "C" },
      { markdown: "写**粗体**(注)中文", tag: "strong", text: "粗体" },
      { markdown: "这是~~删除线~~中文", tag: "del", text: "删除线" },
    ];
    for (const { markdown, tag, text } of cases) {
      const { container, unmount } = render(<MarkdownDocument markdown={markdown} />);
      const el = container.querySelector(tag);
      expect(el, markdown).toBeInTheDocument();
      expect(el, markdown).toHaveTextContent(text);
      expect(container.textContent, markdown).not.toMatch(/\*\*|~~/);
      unmount();
    }
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

  it("已解析的 wikilink 渲染成库内锚点：data-wikilink 落到 DOM、标签无方括号、点击回调解析出的路径", () => {
    const onOpenWikilink = vi.fn();
    const wikilinks = new Map([["wiki/x", "C:/vault/wiki/x.md"]]);
    const { container } = render(
      <MarkdownDocument
        markdown="见 [[wiki/x#Day 10|第十天]]。"
        wikilinks={wikilinks}
        onOpenWikilink={onOpenWikilink}
      />
    );

    const anchor = container.querySelector("a.wikilink") as HTMLAnchorElement;
    expect(anchor).toBeInTheDocument();
    expect(anchor).toHaveAttribute("data-wikilink", "wiki/x");
    expect(anchor).toHaveAttribute("data-wikilink-fragment", "Day 10");
    expect(anchor).toHaveAttribute("title", "wiki/x#Day 10|第十天");
    // href 是占位方案：必须活过 urlTransform（否则会被 defaultUrlTransform 清成空串），
    // 但它绝不带 http(s) 协议，点击不该落进外链分支
    expect(anchor).toHaveAttribute("href", "wikilink:wiki/x");
    expect(anchor).toHaveTextContent("第十天");
    expect(container.textContent).not.toContain("[[");

    fireEvent.click(anchor);

    // 第三参是 `#` 后的人读标题原文（App 据此在目标笔记里定位标题）
    expect(onOpenWikilink).toHaveBeenCalledWith("C:/vault/wiki/x.md", "wiki/x", "Day 10");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("没有片段的 wikilink 仍是两参调用（既有调用方与断言不受影响）", () => {
    const onOpenWikilink = vi.fn();
    const { container } = render(
      <MarkdownDocument
        markdown="见 [[wiki/x]]。"
        wikilinks={new Map([["wiki/x", "C:/vault/wiki/x.md"]])}
        onOpenWikilink={onOpenWikilink}
      />
    );

    const anchor = container.querySelector("a.wikilink") as HTMLAnchorElement;
    expect(anchor).not.toHaveAttribute("data-wikilink-fragment");

    fireEvent.click(anchor);

    expect(onOpenWikilink).toHaveBeenCalledWith("C:/vault/wiki/x.md", "wiki/x");
    // 实参个数也要锁：多带一个 undefined 会让既有两参断言在运行时落空
    expect(onOpenWikilink.mock.calls[0]).toHaveLength(2);
  });

  it("空片段（`[[wiki/x#]]`）按没有片段处理：不落 data 属性、两参调用", () => {
    const onOpenWikilink = vi.fn();
    const { container } = render(
      <MarkdownDocument
        markdown="见 [[wiki/x#]]。"
        wikilinks={new Map([["wiki/x", "C:/vault/wiki/x.md"]])}
        onOpenWikilink={onOpenWikilink}
      />
    );

    const anchor = container.querySelector("a.wikilink") as HTMLAnchorElement;
    expect(anchor).not.toHaveAttribute("data-wikilink-fragment");

    fireEvent.click(anchor);

    expect(onOpenWikilink.mock.calls[0]).toHaveLength(2);
  });

  it("目标在表里为 null 或压根不在表里：降级为纯文本 + 提示，不给假链接", () => {
    const wikilinks = new Map<string, string | null>([["wiki/x", null]]);
    const { container } = render(
      <MarkdownDocument markdown="见 [[wiki/x]] 与 [[wiki/missing]]。" wikilinks={wikilinks} />
    );

    const missing = Array.from(container.querySelectorAll("span.wikilink--missing"));
    expect(missing).toHaveLength(2);
    expect(missing[0]).toHaveTextContent("wiki/x");
    expect(missing[0]).toHaveAttribute("title", "未找到笔记：wiki/x");
    expect(missing[1]).toHaveAttribute("title", "未找到笔记：wiki/missing");
    expect(container.querySelector("a.wikilink")).not.toBeInTheDocument();
    // 方括号一个都不留在正文
    expect(container.textContent).not.toContain("[[");
    expect(container.textContent).not.toContain("]]");
  });

  it("未传 wikilinks 表（不接 App 的调用方）：锚点惰性——不发导航也不报未找到", () => {
    const { container } = render(<MarkdownDocument markdown="见 [[wiki/x]]。" />);

    const anchor = container.querySelector("a.wikilink") as HTMLAnchorElement;
    expect(anchor).toBeInTheDocument();
    expect(anchor).toHaveAttribute("data-wikilink", "wiki/x");
    expect(anchor).not.toHaveAttribute("href");
    expect(container.querySelector(".wikilink--missing")).not.toBeInTheDocument();

    fireEvent.click(anchor);

    expect(openUrl).not.toHaveBeenCalled();
  });

  it("属性卡里的 wikilink 走同一套渲染：已解析出锚点、未解析出纯文本", () => {
    const onOpenWikilink = vi.fn();
    const markdown = ["---", 'related: ["[[wiki/x]]", "[[wiki/missing]]"]', "---", "", "正文。"].join("\n");
    const { container } = render(
      <MarkdownDocument
        markdown={markdown}
        wikilinks={new Map([["wiki/x", "C:/vault/wiki/x.md"]])}
        onOpenWikilink={onOpenWikilink}
      />
    );

    const anchor = container.querySelector(".md-props__row--related a.wikilink") as HTMLAnchorElement;
    expect(anchor).toHaveAttribute("data-wikilink", "wiki/x");
    fireEvent.click(anchor);
    expect(onOpenWikilink).toHaveBeenCalledWith("C:/vault/wiki/x.md", "wiki/x");
    expect(openUrl).not.toHaveBeenCalled();

    const missing = container.querySelector(".md-props__row--related span.wikilink--missing");
    expect(missing).toHaveTextContent("wiki/missing");
  });

  it("代码里的 `[[ ]]` 从不变锚点（围栏块与行内代码都一样）", () => {
    const markdown = ["正文 [[wiki/x]]", "", "```md", "示例 [[wiki/y]]", "```", "", "行内 `[[wiki/z]]`。"].join(
      "\n"
    );
    const { container } = render(
      <MarkdownDocument markdown={markdown} wikilinks={new Map([["wiki/x", "C:/vault/wiki/x.md"]])} />
    );

    const anchors = container.querySelectorAll("a.wikilink");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toHaveAttribute("data-wikilink", "wiki/x");
    expect(container.querySelector("pre")?.textContent).toContain("[[wiki/y]]");
    expect(container.querySelector("p code")?.textContent).toBe("[[wiki/z]]");
  });

  it("编辑视图下 wikilink 不挪动块单元（锚点无位置，块标记仍按源码偏移落位）", () => {
    const markdown = "# 标题\n\n见 [[wiki/x]] 与 [[wiki/missing]]。\n";
    const { container } = render(
      <MarkdownDocument
        markdown={markdown}
        editable
        wikilinks={new Map([["wiki/x", "C:/vault/wiki/x.md"]])}
      />
    );

    const units = buildEditUnits(markdown);
    expect(container.querySelectorAll("[data-vellum-unit]").length).toBe(units.length);
    const paragraph = container.querySelector('[data-vellum-unit="1"]') as HTMLElement;
    expect(paragraph.tagName).toBe("P");
    expect(paragraph).toHaveTextContent("见 wiki/x 与 wiki/missing。");
  });

  /// 真实语料形状（8 篇 21 处实测）：标记行与正文行之间没有空引用行，
  /// 真实解析管线里它们是同一个段落（软换行），不是两块。
  const CALLOUT_DOC = [
    "> [!tip] 今天没时间？",
    "> 启用保底模式（15 分钟）：只背 20 个单词。",
  ].join("\n");

  it("callout：引用就地换形为提示块，`[!tip]` 与自定义标题不再留在正文里", () => {
    const { container } = render(<MarkdownDocument markdown={CALLOUT_DOC} />);

    const callout = container.querySelector("blockquote.callout") as HTMLElement;
    expect(callout).toBeInTheDocument();
    expect(callout).toHaveClass("callout--tip");
    expect(callout).toHaveAttribute("data-callout", "tip");

    const title = callout.querySelector(".callout__title") as HTMLElement;
    expect(title).toBeInTheDocument();
    // 标题行是引用的首个元素子节点
    expect(title).toBe(callout.firstElementChild);
    expect(title).toHaveTextContent("今天没时间？");

    // 标记不再作为字面量出现在正文里
    expect(container.textContent).not.toContain("[!");
    expect(container.textContent).not.toContain("[!tip");
    // 正文段落仍在，且仍是一个 <p>（结构没被换成新容器）
    expect(callout.querySelectorAll("p")).toHaveLength(1);
    expect(callout).toHaveTextContent("启用保底模式（15 分钟）：只背 20 个单词。");
  });

  it("callout：编辑视图下正文段落仍带块标记，单元数与同形状的普通引用一致", () => {
    const plainDoc = CALLOUT_DOC.replace("[!tip] ", "");
    const { container } = render(<MarkdownDocument markdown={CALLOUT_DOC} editable />);

    const paragraph = container.querySelector("blockquote.callout p") as HTMLElement;
    expect(paragraph).toHaveAttribute("data-vellum-unit", "0");
    // 装饰只发生在渲染树上：块单元仍在原始 Markdown 上算，与普通引用逐项一致
    const units = buildEditUnits(CALLOUT_DOC);
    const plainUnits = buildEditUnits(plainDoc);
    expect(units).toHaveLength(1);
    expect(plainUnits).toHaveLength(1);
    expect(units.map((unit) => [unit.kind, unit.editable])).toEqual(
      plainUnits.map((unit) => [unit.kind, unit.editable])
    );
    expect(container.querySelector("blockquote")).toHaveClass("callout--tip");
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
    // F12: 降级语言统一为 Prism 已注册的 markup（widget 内容是完整 HTML 文档），
    // 不得再用空串降级（会当成 text 丢高亮）
    expect(container.querySelector(".code-block__lang")?.textContent).toBe("markup");
  });

  it("P9: short-circuits 512KB pre-check without TextEncoder when length > 524288 or safe range", async () => {
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode");

    // 1. 字符数超 524288：直接短路降级为 CodeBlock，不得调用 TextEncoder.encode
    const oversizedCode = "a".repeat(524290);
    const mdOversized = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "```vellum-widget",
      oversizedCode,
      "```",
    ].join("\n");

    const { container: c1 } = render(<MarkdownDocument markdown={mdOversized} />);
    await act(async () => {});
    expect(c1.querySelector(".code-block")).toBeInTheDocument();
    expect(encodeSpy).not.toHaveBeenCalled();

    // 2. 字符数安全范围（<= 131072）：直接短路安全进入 WidgetSandbox，不得调用 TextEncoder.encode
    const safeCode = "<div>short content</div>";
    const mdSafe = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "```vellum-widget",
      safeCode,
      "```",
    ].join("\n");

    const { container: c2 } = render(<MarkdownDocument markdown={mdSafe} />);
    await act(async () => {});
    expect(c2.querySelector(".mdlog-widget")).toBeInTheDocument();
    expect(encodeSpy).not.toHaveBeenCalled();

    // 3. 临界区间 (131072, 524288]：多字节字符超 512KB 需调用 TextEncoder.encode 并在超限时降级
    // 200,000 个汉字 "字"（每个 3 字节，共 600,000 字节 > 524288）
    const boundaryCode = "字".repeat(200000);
    const mdBoundary = [
      "<!-- mdlog:v1 s=123 -->",
      "",
      "```vellum-widget",
      boundaryCode,
      "```",
    ].join("\n");

    const { container: c3 } = render(<MarkdownDocument markdown={mdBoundary} />);
    await act(async () => {});
    expect(encodeSpy).toHaveBeenCalled();
    expect(c3.querySelector(".code-block")).toBeInTheDocument();
    expect(c3.querySelector(".mdlog-widget")).not.toBeInTheDocument();

    encodeSpy.mockRestore();
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

  it("trusted mdlog 指纹文档挂载 markdown-body--mdlog 书札版式作用域", () => {
    const trusted = render(
      <MarkdownDocument markdown={"<!-- mdlog:v1 s=abc123 -->\n\n> **你** · 21:30\n>\n> 你好\n"} />
    );
    expect(trusted.container.querySelector("article")).toHaveClass("markdown-body", "markdown-body--mdlog");
    trusted.unmount();

    const plain = render(<MarkdownDocument markdown={"# 普通文档\n\n> 普通引用块\n"} />);
    expect(plain.container.querySelector("article")).toHaveClass("markdown-body");
    expect(plain.container.querySelector("article")).not.toHaveClass("markdown-body--mdlog");
  });

  it("编辑视图下块元素带 data-vellum-unit 与 markdown-body--editing，阅读视图下都没有", () => {
    const markdown = "# 标题\n\n正文\n";
    const { container, unmount } = render(<MarkdownDocument markdown={markdown} editable />);
    expect(container.querySelectorAll("[data-vellum-unit]").length).toBe(2);
    // 标题由自定义组件接管渲染，标记仍必须落到 h1 元素上
    expect(container.querySelector('[data-vellum-unit="0"]')?.tagName).toBe("H1");
    expect(container.querySelector('[data-vellum-unit="1"]')?.tagName).toBe("P");
    expect(container.querySelector("article")).toHaveClass("markdown-body--editing");
    unmount();

    const reading = render(<MarkdownDocument markdown={markdown} />);
    expect(reading.container.querySelectorAll("[data-vellum-unit]").length).toBe(0);
    expect(reading.container.querySelector("article")).not.toHaveClass("markdown-body--editing");
  });

  /// 文首 frontmatter 的端到端形态：真实解析管线（remark → rehype）下的属性卡
  const FRONTMATTER_DOC = [
    "---",
    "date: 2026-06-25",
    "tags: [concept, ai-agent]",
    "---",
    "",
    "## 标题",
    "",
    "正文。",
  ].join("\n");

  it("阅读视图把文首 frontmatter 渲染成属性卡：无 hr、无原始 YAML 文本、标签成 chip", () => {
    const { container } = render(<MarkdownDocument markdown={FRONTMATTER_DOC} />);

    // 老行为是「分隔线 + setext 标题 + 原样 YAML 文本」，三者都必须消失
    expect(container.querySelector("hr")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("date:");
    expect(container.textContent).not.toContain("tags:");

    expect(container.querySelector(".md-props")).toBeInTheDocument();
    expect(container.querySelector(".md-props__key")).toHaveTextContent("date");
    expect(
      Array.from(container.querySelectorAll(".md-props__chip")).map((chip) => chip.textContent)
    ).toEqual(["concept", "ai-agent"]);
    // 正文照常渲染
    expect(screen.getByRole("heading", { name: "标题" })).toBeInTheDocument();
    expect(container.textContent).toContain("正文。");
  });

  it("块序列形态（related / sources 后跟 - 项）的 frontmatter 同样整块成卡：闭合围栏变分隔线也不残留", () => {
    // 该形态在真实解析里产出的是「分隔线 + 段落 + 列表 + 分隔线」（闭合围栏不再是 setext 下划线）
    const markdown = [
      "---",
      "type: log",
      "tags: [concept]",
      "related:",
      '  - "[[wiki/x]]"',
      "sources:",
      "  - https://example.com/a",
      "---",
      "",
      "## Heading",
      "",
      "body text",
    ].join("\n");

    const { container } = render(<MarkdownDocument markdown={markdown} />);

    expect(container.querySelector("hr")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("related:");
    // related 的 wikilink 项是锚点（不再是去括号的纯文本条目）；未传解析表时惰性锚点
    const related = container.querySelector(".md-props__row--related a.wikilink");
    expect(related).toHaveTextContent("wiki/x");
    expect(related).toHaveAttribute("data-wikilink", "wiki/x");
    expect(container.querySelector(".md-props__row--sources a")).toHaveAttribute(
      "href",
      "https://example.com/a"
    );
    expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
  });

  it("属性卡里的 sources 锚点走既有的外链渲染器（点击交给系统 opener）", () => {
    const markdown = ["---", 'sources: ["https://example.com/a"]', "---", "", "正文。"].join("\n");
    render(<MarkdownDocument markdown={markdown} />);

    fireEvent.click(screen.getByRole("link", { name: "https://example.com/a" }));

    expect(openUrl).toHaveBeenCalledWith("https://example.com/a");
  });

  it("编辑视图下属性卡是第一个只读块：unit/locked 标记齐备，标记总数与单元数一致", () => {
    const { container } = render(<MarkdownDocument markdown={FRONTMATTER_DOC} editable />);

    const card = container.querySelector(".md-props") as HTMLElement;
    expect(card).toHaveAttribute("data-vellum-unit", "0");
    expect(card).toHaveAttribute("data-vellum-locked", "frontmatter");

    // 卡片子节点没有 hast 位置 ⇒ 不额外打标；本夹具的块都是纯文本块（无嵌套元素），
    // 故标记总数恰好等于单元数
    const units = buildEditUnits(FRONTMATTER_DOC);
    expect(units).toHaveLength(3);
    expect(container.querySelectorAll("[data-vellum-unit]").length).toBe(units.length);
    expect(container.querySelector('[data-vellum-unit="1"]')?.tagName).toBe("H2");
    expect(container.querySelector('[data-vellum-unit="2"]')?.tagName).toBe("P");
  });

  it("frontmatter 与原始 HTML 同篇时两者各就其位（rehype-raw 不干扰卡片与块编号）", () => {
    const markdown = [
      FRONTMATTER_DOC,
      "",
      '<div align="center">Centered</div>',
    ].join("\n");
    const { container } = render(<MarkdownDocument markdown={markdown} editable />);

    expect(container.querySelector(".md-props")).toHaveAttribute("data-vellum-unit", "0");
    // 原始 HTML 块仍是自己的只读块（索引按源码顺序顺延，落位不受卡片影响）
    const raw = container.querySelector('[data-vellum-locked="html"]') as HTMLElement;
    expect(raw).toHaveTextContent("Centered");
    expect(raw).toHaveAttribute("data-vellum-unit", "3");
    expect(container.querySelector('[data-vellum-unit="1"]')?.tagName).toBe("H2");
    expect(container.querySelector('[data-vellum-unit="2"]')?.tagName).toBe("P");
  });

  it("点击可编辑块回调索引，点击只读块回调原因", () => {
    const onActivateUnit = vi.fn();
    const onLockedUnitClick = vi.fn();
    const markdown = '正文\n\n```vellum-widget\n<div>x</div>\n```\n';
    render(
      <MarkdownDocument
        markdown={markdown}
        editable
        onActivateUnit={onActivateUnit}
        onLockedUnitClick={onLockedUnitClick}
      />
    );

    fireEvent.click(screen.getByText("正文"));
    expect(onActivateUnit).toHaveBeenCalledWith(0, expect.any(Number));

    fireEvent.click(document.querySelector('[data-vellum-locked="widget"]') as Element);
    expect(onLockedUnitClick).toHaveBeenCalledWith("widget");
    expect(onActivateUnit).toHaveBeenCalledTimes(1);
  });

  it("点击文档中部的原始 HTML 只读块回调 html 原因，锁定标记落在该 div 上", () => {
    const onActivateUnit = vi.fn();
    const onLockedUnitClick = vi.fn();
    // 前置段落使 raw HTML 块的 offset ≠ 0：hast position 若被当成「块内相对偏移」，
    // 标记会错落到第一个块上（offset 0 的旧夹具区分不出相对/绝对）
    render(
      <MarkdownDocument
        markdown={'前段\n\n<div class="x">原始块</div>\n'}
        editable
        onActivateUnit={onActivateUnit}
        onLockedUnitClick={onLockedUnitClick}
      />
    );

    const locked = document.querySelector('[data-vellum-locked="html"]') as Element;
    expect(locked.tagName).toBe("DIV");
    expect(locked).toHaveAttribute("data-vellum-unit", "1");
    // 前置段落保持自己的索引与可编辑性
    expect(document.querySelector('[data-vellum-unit="0"]')?.tagName).toBe("P");

    fireEvent.click(locked);
    expect(onLockedUnitClick).toHaveBeenCalledWith("html");
    expect(onActivateUnit).not.toHaveBeenCalled();
  });

  it("编辑视图下块级公式的外包容器在 katex 替换后仍存活并带索引", () => {
    const { container } = render(<MarkdownDocument markdown={"$$\na = b\n$$\n"} editable />);

    // rehype-katex 会整体替换块级公式节点（连同属性），标记必须落在报外容器上
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    const wrapper = container.querySelector(".vellum-unit-wrap");
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveAttribute("data-vellum-unit", "0");
  });

  it("阅读视图（含代码块与 widget 围栏）不产生包裹层，也没有任何块标记", () => {
    const markdown = [
      "正文",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "```vellum-widget",
      "<div>x</div>",
      "```",
    ].join("\n");
    const { container } = render(<MarkdownDocument markdown={markdown} />);

    // <pre> 一律外包是本任务结构风险最高的改动，阅读视图零泄漏必须被测试锁定，
    // 不能只靠「插件不入管线」的推理
    expect(container.querySelector(".vellum-unit-wrap")).toBeNull();
    expect(container.querySelectorAll("[data-vellum-unit]").length).toBe(0);
    expect(container.querySelector(".code-block")).toBeInTheDocument();
  });

  it("点击可编辑块得到精确 caret 偏移（LF 与 CRLF 均按归一文本计算）", () => {
    // 块源码 = "alpha\nbeta\ngamma"（三行）：行首偏移依次为 0 / 6 / 11；
    // CRLF 文档的原始切片含 \r，若按原始切片算行宽，块中/块尾会分别偏成 7 / 13
    const cases = [
      { name: "LF 块首", markdown: "alpha\nbeta\ngamma\n\nend\n", clientY: 100, expected: 0 },
      { name: "LF 块中", markdown: "alpha\nbeta\ngamma\n\nend\n", clientY: 150, expected: 6 },
      { name: "LF 块尾", markdown: "alpha\nbeta\ngamma\n\nend\n", clientY: 200, expected: 11 },
      { name: "CRLF 块首", markdown: "alpha\r\nbeta\r\ngamma\r\n\r\nend\r\n", clientY: 100, expected: 0 },
      { name: "CRLF 块中", markdown: "alpha\r\nbeta\r\ngamma\r\n\r\nend\r\n", clientY: 150, expected: 6 },
      { name: "CRLF 块尾", markdown: "alpha\r\nbeta\r\ngamma\r\n\r\nend\r\n", clientY: 200, expected: 11 },
    ];

    for (const { name, markdown, clientY, expected } of cases) {
      const onActivateUnit = vi.fn();
      const { container, unmount } = render(
        <MarkdownDocument markdown={markdown} editable onActivateUnit={onActivateUnit} />
      );
      const block = container.querySelector('[data-vellum-unit="0"]') as HTMLElement;
      // 测量盒固定贴 top=100、高 100，使 clientY 直接映射成块内比率 0 / 0.5 / 1
      const spies = stubRects([[block, { top: 100, height: 100 }]]);
      try {
        fireEvent.click(block, { clientY });
        expect(onActivateUnit, name).toHaveBeenCalledWith(0, expected);
      } finally {
        spies.forEach((spy) => spy.mockRestore());
        unmount();
      }
    }
  });

  it("键盘触发点击（clientY 为 0，在块上方）时比率被钳制，光标落在块首", () => {
    const onActivateUnit = vi.fn();
    const markdown = "alpha\nbeta\ngamma\n\nend\n";
    const { container } = render(
      <MarkdownDocument markdown={markdown} editable onActivateUnit={onActivateUnit} />
    );
    const block = container.querySelector('[data-vellum-unit="0"]') as HTMLElement;
    // 块在视口下方（top=400）而 clientY=0 ⇒ 比率为负，必须钳到块首而不是取到负数行
    const spies = stubRects([[block, { top: 400, height: 100 }]]);
    try {
      fireEvent.click(block, { clientY: 0 });
      expect(onActivateUnit).toHaveBeenCalledWith(0, 0);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("包裹层自身无布局盒（display: contents）时回退到首个元素子节点测量", () => {
    const onActivateUnit = vi.fn();
    const markdown = "```ts\nalpha\nbeta\ngamma\n```\n";
    const { container } = render(
      <MarkdownDocument markdown={markdown} editable onActivateUnit={onActivateUnit} />
    );

    const wrapper = container.querySelector(".vellum-unit-wrap") as HTMLElement;
    expect(wrapper).toHaveAttribute("data-vellum-unit", "0");
    const inner = wrapper.firstElementChild as HTMLElement;
    expect(inner).not.toBeNull();

    // T7 用 display: contents 让包裹层退出布局 ⇒ Chromium 对其 getBoundingClientRect()
    // 返回 height 0。此时必须改用首个元素子节点当测量盒，否则比率恒为 0、光标永远落在块首
    // （块源码 "```ts\nalpha\nbeta\ngamma\n```" 的行首偏移依次为 0 / 6 / 12 / 17 / 23）
    const spies = stubRects([
      [wrapper, { top: 0, height: 0 }],
      [inner, { top: 100, height: 100 }],
    ]);
    try {
      fireEvent.click(inner, { clientY: 150 });
      expect(onActivateUnit).toHaveBeenCalledWith(0, 12);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
