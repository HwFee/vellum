import { describe, expect, it } from "vitest";
import {
  buildExportDocument,
  buildExportPageStyle,
  escapeCssContentString,
  normalizeExportTitle,
  stripLeadingOwnTitle,
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
      ownTitle: null,
      bodyHtml: "",
    });
  });

  it("正文首块 h1 与文档题归一相同：ownTitle 取它的原文文本", () => {
    const root = makeRoot(
      '<h1 class="document-title">Kimi-K3技术报告通俗解读</h1>' +
        '<div class="markdown-body"><h1>Kimi K3 技术报告通俗解读</h1><p>正文</p></div>'
    );
    const doc = buildExportDocument(root);
    expect(doc.ownTitle).toBe("Kimi K3 技术报告通俗解读");
    // 正文原样保留（摘除与否是视图按模式决定的）
    expect(doc.bodyHtml).toContain("<h1>Kimi K3 技术报告通俗解读</h1>");
  });

  it("首块 h1 与文档题不同名：ownTitle 为 null（两枚标题都算数，不摘）", () => {
    const root = makeRoot(
      '<h1 class="document-title">2026-09-21 日志</h1>' +
        '<div class="markdown-body"><h1>今天的三件事</h1><p>正文</p></div>'
    );
    expect(buildExportDocument(root).ownTitle).toBeNull();
  });

  it("首块套着块单元外壳（.vellum-unit-wrap）：展平一层照样认出 h1", () => {
    const root = makeRoot(
      '<h1 class="document-title">小窗幽记 · 卷一</h1>' +
        '<div class="markdown-body">' +
        '<div class="vellum-unit-wrap" data-vellum-unit="0"><h1>小窗幽记 · 卷一</h1></div>' +
        "<p>正文</p></div>"
    );
    expect(buildExportDocument(root).ownTitle).toBe("小窗幽记 · 卷一");
  });
});

describe("readOwnTitle / stripLeadingOwnTitle", () => {
  it("归一比对抹平连字符 / 空白 / 大小写", () => {
    expect(normalizeExportTitle("Kimi-K3 技术报告")).toBe(normalizeExportTitle("kimi k3技术报告"));
  });

  it("摘除首块 h1，其余正文逐字保留", () => {
    const html = "<h1>题</h1><p>第一段</p><h2>第二节</h2>";
    expect(stripLeadingOwnTitle(html)).toBe("<p>第一段</p><h2>第二节</h2>");
  });

  it("外壳只装这枚 h1：连同外壳一起摘；首块不是 h1 则原样返回", () => {
    const wrapped =
      '<div class="vellum-unit-wrap" data-vellum-unit="0"><h1>题</h1></div><p>正文</p>';
    expect(stripLeadingOwnTitle(wrapped)).toBe("<p>正文</p>");
    expect(stripLeadingOwnTitle("<p>先有一段</p><h1>题</h1>")).toBe("<p>先有一段</p><h1>题</h1>");
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
