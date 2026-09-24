import { defaultUrlTransform } from "react-markdown";
import { defaultSchema, type Options as RehypeSanitizeOptions } from "rehype-sanitize";
import { WIKILINK_SCHEME } from "./wikilink";

/// rehype-sanitize 的白名单（原 MarkdownDocument.tsx 内嵌，逐字不变）。
/// 在 defaultSchema 之上放开排版需要的标签/属性；表单元素只放行 GFM 任务列表的 input。
export const kamiSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "div",
    "span",
    "b",
    "i",
    "em",
    "strong",
    "s",
    "sub",
    "sup",
    "small",
    "big",
    "br",
    "details",
    "summary",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    // input 仅用于 GFM task list 的复选框；其余表单元素（form/button/select/textarea/label 等）一律不允许
    "input",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": ["className", "ariaDescribedBy", "ariaLabel", "ariaLabelledBy"],
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel"],
    img: [...(defaultSchema.attributes?.img ?? []), "alt", "title", "width", "height", "loading"],
    div: ["align"],
    td: ["align", "valign", "width", "height"],
    th: ["align", "valign", "width", "height"],
    table: ["width"],
    br: [],
    input: ["type", "name", "value", "checked", "disabled", "readonly", "placeholder", "required"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "ftp"],
  },
};

// react-markdown 的 defaultUrlTransform 会把 ftp 等未列出的协议置为空字符串；
// 这里放行 ftp，使其 href 保留，点击时与 http(s) 一样交给系统 opener 处理。
// `wikilink:`（库内笔记互链的占位方案）同样必须放行——它不交给浏览器导航，
// 但 href 要留在 DOM 里可供检查；被清成空串会让锚点看起来是一条空链接。
export function urlTransform(url: string) {
  if (url.startsWith("ftp:")) return url;
  if (url.startsWith(WIKILINK_SCHEME)) return url;
  return defaultUrlTransform(url);
}
