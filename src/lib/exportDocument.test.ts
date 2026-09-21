import { describe, expect, it } from "vitest";
import {
  buildExportDocument,
  buildExportPageStyle,
  escapeCssContentString,
} from "./exportDocument";

function makeRoot(inner: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = inner;
  return root;
}

describe("buildExportDocument 底稿取样", () => {
  it("取文档题与 markdown-body 内部 HTML", () => {
    const root = makeRoot(
      '<h1 class="document-title">小窗幽记 · 卷一</h1>' +
        '<div class="markdown-body"><p>正文<strong>加粗</strong></p></div>'
    );
    const doc = buildExportDocument(root);
    expect(doc.title).toBe("小窗幽记 · 卷一");
    expect(doc.bodyHtml).toContain("正文");
    expect(doc.bodyHtml).not.toContain("document-title");
  });

  it("摘走界面件：复制按钮 / 复制回执 / 记录小章不进底稿", () => {
    const root = makeRoot(
      '<h1 class="document-title">t</h1>' +
        '<div class="markdown-body">' +
        '<div class="code-block"><div class="code-block__header">' +
        '<button class="code-block__copy">复制</button></div>' +
        '<div class="code-block__body"><pre><code>let a = 1;</code></pre></div>' +
        '<span class="code-block__status"></span></div>' +
        "</div>" +
        '<div class="mdlog-live">记录中 · PI</div>'
    );
    const doc = buildExportDocument(root);
    expect(doc.bodyHtml).toContain("let a = 1;");
    expect(doc.bodyHtml).not.toContain("code-block__copy");
    expect(doc.bodyHtml).not.toContain("code-block__status");
    expect(doc.bodyHtml).not.toContain("mdlog-live");
  });

  it("搜索高亮 mark 解包留文字（批注态不进打印件）", () => {
    const root = makeRoot(
      '<h1 class="document-title">t</h1>' +
        '<div class="markdown-body"><p>宠辱<mark class="search-match">不惊</mark>闲看</p></div>'
    );
    const doc = buildExportDocument(root);
    expect(doc.bodyHtml).toContain("宠辱不惊闲看");
    expect(doc.bodyHtml).not.toContain("<mark");
  });

  it("缺标题回退「未命名」，缺正文给空串", () => {
    expect(buildExportDocument(makeRoot("<p>nothing</p>"))).toEqual({
      title: "未命名",
      bodyHtml: "",
    });
  });
});

describe("buildExportPageStyle 页眉页脚边盒", () => {
  it("页码右上、页脚居中「文档题 · 素笺」，首页留白", () => {
    const css = buildExportPageStyle("小窗幽记-卷一");
    expect(css).toContain("@top-right { content: counter(page);");
    expect(css).toContain('@bottom-center { content: "小窗幽记-卷一 · 素笺";');
    expect(css).toContain("@page:first");
    expect(css).toContain("font-size: 9pt");
  });

  it("文档题里的引号 / 反斜杠 / 换行被转义", () => {
    const css = buildExportPageStyle('他说"你好"\\世界\n换行');
    // 页脚整行就是完整 content 串：转义后串内无原始换行（规则体自身的换行无妨）
    const footerLine = css.split("\n").find((line) => line.includes("@bottom-center")) ?? "";
    expect(footerLine).toContain('content: "他说\\"你好\\"\\\\世界 换行 · 素笺";');
  });
});

describe("escapeCssContentString", () => {
  it("逐字符转义", () => {
    expect(escapeCssContentString('a"b\\c\nd')).toBe('a\\"b\\\\c d');
  });
});
