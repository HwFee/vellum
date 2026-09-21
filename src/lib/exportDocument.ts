/**
 * 导出为 PDF 的文档取样（2026-09-21）。
 * 从阅读 DOM 克隆一份「底稿」：界面件与瞬时态（搜索高亮、复制按钮、记录小章）
 * 不进打印件。预览、测量与 Chromium printToPDF 共用这同一份 HTML —— 预览即所得。
 */

export interface ExportDocument {
  /** 文档题（h1.document-title 的文本）：页脚文案与默认文件名的来源 */
  title: string;
  /**
   * 正文自带的头题：正文首块是 h1 且归一后与文档题相同（文件名常有连字符 /
   * 空白之差，如「Kimi-K3」对「Kimi K3」），取其原文文本；没有则为 null。
   * 「居中」模式下视图用它顶替注入的题目并把正文里那枚摘掉（同一题目不排两次）
   */
  ownTitle: string | null;
  /** markdown-body 的内部 HTML（已消毒；正文自带的头题原样保留在其中） */
  bodyHtml: string;
}

/// 底稿里要整枚摘掉的界面件（都是状态/交互装置，不是文档内容）
const STRIP_SELECTORS = [
  ".mdlog-live", // 「记录中 · PI」小章（打印段也隐它，这里直接不取）
  ".code-block__copy", // 复制按钮：屏幕态靠 hover 隐去，底稿里直接删
  ".code-block__status", // 复制回执 live region
].join(",");

/**
 * 从正文容器（.document-content）取底稿。正文必须仍在 DOM 里（阅读视图）——
 * 设置视图 / 导出视图期间正文整块退出 DOM，那里没有可取的。
 */
export function buildExportDocument(root: HTMLElement): ExportDocument {
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(STRIP_SELECTORS).forEach((node) => node.remove());
  // 搜索高亮 <mark class="search-match">：解包留文字——批注态不进打印件
  //（底色在 printBackground 下会印出来，不能留）
  clone.querySelectorAll("mark.search-match").forEach((mark) => {
    mark.replaceWith(...Array.from(mark.childNodes));
  });
  const title = clone.querySelector("h1.document-title")?.textContent?.trim() || "未命名";
  const body = clone.querySelector(".markdown-body");
  return { title, ownTitle: body ? readOwnTitle(body, title) : null, bodyHtml: body ? body.innerHTML : "" };
}

/// 题名归一：文件名派生题与正文 h1 常有连字符 / 空白 / 间隔号之差
///（「Kimi-K3技术报告」对「Kimi K3 技术报告」），比对前全部抹平
export function normalizeExportTitle(value: string): string {
  return value.toLowerCase().replace(/[\s\-_·—–]+/g, "");
}

/// 首枚有布局盒的块：块单元外壳（display:contents 的 .vellum-unit-wrap）展平一层——
/// 底稿克隆是游离节点，取不到应用样式后的 computed display，认类名而不是算样式
function firstLayoutBlock(body: Element): Element | null {
  let el = body.firstElementChild;
  while (el && el.classList.contains("vellum-unit-wrap")) el = el.firstElementChild;
  return el;
}

/** 正文自带的头题文本：首块是 h1 且归一后与文档题相同才认，否则返回 null */
export function readOwnTitle(body: Element, title: string): string | null {
  const first = firstLayoutBlock(body);
  if (!first || first.tagName !== "H1") return null;
  const text = first.textContent?.trim() ?? "";
  const want = normalizeExportTitle(title);
  return text && want && normalizeExportTitle(text) === want ? text : null;
}

/**
 * 摘除正文自带的头题（首块 h1，连同只装它的块单元外壳）。用于「居中」模式：
 * 头题由底稿开头的 h1.document-title 居中承担，正文里那枚同款 h1 不再重复排印。
 * 只在 readOwnTitle 命中的底稿上调用（视图以 ownTitle 作闸门）。
 */
export function stripLeadingOwnTitle(bodyHtml: string): string {
  const host = document.createElement("div");
  host.innerHTML = bodyHtml; // bodyHtml 已是消毒后的底稿
  const first = firstLayoutBlock(host);
  if (!first || first.tagName !== "H1") return bodyHtml;
  const wrap = first.parentElement;
  first.remove();
  if (
    wrap &&
    wrap !== host &&
    wrap.classList.contains("vellum-unit-wrap") &&
    wrap.childElementCount === 0 &&
    !(wrap.textContent ?? "").trim()
  ) {
    wrap.remove();
  }
  return host.innerHTML;
}

/// CSS content 字符串转义：页脚要嵌文档题，引号 / 反斜杠 / 换行都得收编
export function escapeCssContentString(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}

/**
 * 页眉页脚的 @page 边盒规则：页码右上、页脚居中「文档题 · 素笺」，首页留白——
 * 上游 kami 模板的页眉页脚规格（9pt 衬线石灰）。文档题是运行时值，故整段由
 * 导出视图挂载时注入 <style>、卸载移除，不落进 kami.css。
 * Chromium 131+ 支持 @page 边盒；更旧的运行时静默降级为无页眉页脚（内容不受影响）。
 */
export function buildExportPageStyle(title: string): string {
  const footer = escapeCssContentString(title + " · 素笺");
  const font =
    'font-family: "TsangerJinKai02", "Source Han Serif SC", serif; font-size: 9pt; color: #6b6a64;';
  return [
    "@page {",
    "  @top-right { content: counter(page); " + font + " }",
    '  @bottom-center { content: "' + footer + '"; ' + font + " }",
    "}",
    '@page:first { @top-right { content: ""; } @bottom-center { content: ""; } }',
  ].join("\n");
}
