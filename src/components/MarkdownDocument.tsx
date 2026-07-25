import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isValidElement, memo, useCallback, useLayoutEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { MarkdownImage } from "./MarkdownImage";
import { slugify } from "../lib/outline";
import { animateScrollTo } from "../lib/smoothScroll";
import { CodeBlock } from "./CodeBlock";
import type { OutlineHeading } from "../types";
import type { PluggableList } from "unified";

type MarkdownDocumentProps = {
  markdown: string;
  headings?: OutlineHeading[];
  /** 内容渲染进 DOM 后回调（用于在懒加载完成后恢复滚动位置等） */
  onRendered?: () => void;
  searchQuery?: string;
  /** 输入框中的新词尚未同步到 searchQuery（useDeferredValue 的 urgent 渲染期间为 true）。
   *  此时 activeMatchIndex 已被重置为 0 是输入的副产物，effect 不得据此滚动 */
  searchQueryPending?: boolean;
  activeMatchIndex?: number;
  onMatchCountChange?: (count: number) => void;
};

type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
};
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const SEARCH_SKIP_TAGS = new Set(["mark", "script", "style", "pre", "code"]);

// 搜索高亮只负责生成 <mark class="search-match">；「当前匹配」的
// search-match--current 类由下方 layout effect 直接操作 DOM 添加。
// 这样切换上一个/下一个匹配不会改动插件参数，也就不会触发整篇文档重新解析。
function rehypeSearchHighlights({ query }: { query: string }) {
  const normalizedQuery = query.trim().toLowerCase();

  return (tree: HastNode) => {
    if (!normalizedQuery) return;

    function highlightChildren(parent: { children: HastNode[] }) {
      const nextChildren: HastNode[] = [];

      for (const child of parent.children) {
        if (child.type === "text") {
          const text = (child as HastText).value;
          const lowerText = text.toLowerCase();
          let lastIndex = 0;
          let matchIndex = lowerText.indexOf(normalizedQuery);

          while (matchIndex !== -1) {
            if (matchIndex > lastIndex) {
              nextChildren.push({ type: "text", value: text.slice(lastIndex, matchIndex) });
            }

            const mark: HastElement = {
              type: "element",
              tagName: "mark",
              properties: { className: ["search-match"] },
              children: [{
                type: "text",
                value: text.slice(matchIndex, matchIndex + normalizedQuery.length),
              }],
            };
            nextChildren.push(mark);
            lastIndex = matchIndex + normalizedQuery.length;
            matchIndex = lowerText.indexOf(normalizedQuery, lastIndex);
          }

          if (lastIndex === 0) {
            nextChildren.push(child);
          } else if (lastIndex < text.length) {
            nextChildren.push({ type: "text", value: text.slice(lastIndex) });
          }
          continue;
        }

        if (child.type === "element") {
          const element = child as HastElement;
          if (!SEARCH_SKIP_TAGS.has(element.tagName)) {
            highlightChildren(element);
          }
        } else if ("children" in child && child.children) {
          highlightChildren(child as { children: HastNode[] });
        }
        nextChildren.push(child);
      }

      parent.children = nextChildren;
    }

    if ("children" in tree && tree.children) {
      highlightChildren(tree as { children: HastNode[] });
    }
  };
}

const kamiSchema: RehypeSanitizeOptions = {
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
// 这里放行 ftp，使其 href 保留，点击时与 http(s) 一样交给系统 opener 处理
function urlTransform(url: string) {
  return url.startsWith("ftp:") ? url : defaultUrlTransform(url);
}

// remark 插件列表与文档无关，提升为模块常量，避免每次渲染产生新引用
const REMARK_PLUGINS: PluggableList = [remarkGfm];

// 文档中是否可能出现原始 HTML（误判为 true 无害，只是不省 rehype-raw 的开销）
const RAW_HTML_RE = /<\/?[a-zA-Z!?]/;

function useHeadingIdResolver(headings?: OutlineHeading[]) {
  const usedIds = useRef(new Set<string>());
  const fallbackCounter = useRef(0);

  // Reset allocation on every render so document/headings changes do not carry over stale ids.
  usedIds.current = new Set<string>();
  fallbackCounter.current = 0;

  return useCallback(
    (level: 1 | 2 | 3, text: string) => {
      const candidates = headings?.filter((h) => h.level === level && h.text === text) ?? [];
      for (const candidate of candidates) {
        if (!usedIds.current.has(candidate.id)) {
          usedIds.current.add(candidate.id);
          return candidate.id;
        }
      }

      let baseId = slugify(text) || "heading";
      if (!usedIds.current.has(baseId)) {
        usedIds.current.add(baseId);
        return baseId;
      }

      let suffix = fallbackCounter.current + 1;
      let id = `${baseId}-${suffix}`;
      while (usedIds.current.has(id)) {
        suffix += 1;
        id = `${baseId}-${suffix}`;
      }
      usedIds.current.add(id);
      fallbackCounter.current = suffix;
      return id;
    },
    [headings]
  );
}

function extractText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { alt?: string; children?: unknown } }).props;
    if (props && "alt" in props) {
      return props.alt ?? "";
    }
    return extractText(props?.children);
  }
  return "";
}

type MarkdownBodyProps = {
  markdown: string;
  headings?: OutlineHeading[];
  searchQuery?: string;
};

/// 真正执行 unified 解析管线的部分。props 全部是稳定引用（字符串或 memo 结果），
/// 因此父组件因 activeMatchIndex 等无关状态重渲染时，这里整体跳过，不重新解析文档。
const MarkdownBody = memo(function MarkdownBody({ markdown, headings, searchQuery }: MarkdownBodyProps) {
  const resolveHeadingId = useHeadingIdResolver(headings);

  // 文档不含原始 HTML 时跳过 rehype-raw（其内部会对整棵树再做一次 HTML 解析），
  // 输出完全一致；rehype-sanitize 始终保留作为安全保障
  const hasRawHtml = useMemo(() => RAW_HTML_RE.test(markdown), [markdown]);

  const rehypePlugins: PluggableList = useMemo(
    () => [
      ...(hasRawHtml ? [rehypeRaw] : []),
      [rehypeSanitize, kamiSchema],
      [rehypeSearchHighlights, { query: searchQuery ?? "" }],
    ],
    [hasRawHtml, searchQuery]
  );

  // components 对象必须 memo：内联创建会让 react-markdown 每次渲染都重走解析管线
  const components: Components = useMemo(
    () => ({
      h1: ({ children }) => <h1 id={resolveHeadingId(1, extractText(children))}>{children}</h1>,
      h2: ({ children }) => <h2 id={resolveHeadingId(2, extractText(children))}>{children}</h2>,
      h3: ({ children }) => <h3 id={resolveHeadingId(3, extractText(children))}>{children}</h3>,
      a: ({ href, children }) => {
        // 带协议（http(s)、mailto、ftp 等）的链接交给系统默认程序打开；
        // 页内锚点（#...）与相对路径保持原生行为
        const hasProtocol = href ? /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href) : false;

        function isImageElement(child: unknown): boolean {
          if (!isValidElement(child)) return false;
          const type = (child as { type?: unknown }).type;
          return type === "img" || type === MarkdownImage;
        }

        const childArray = Array.isArray(children) ? children : [children];
        const isImageLink = childArray.length === 1 && isImageElement(childArray[0]);

        if (hasProtocol) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              data-image-link={isImageLink ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                void openUrl(href ?? "");
              }}
            >
              {children}
            </a>
          );
        }
        return <a href={href}>{children}</a>;
      },
      img: ({ src, alt, title }) => <MarkdownImage src={src} alt={alt} title={title} />,
      pre: ({ children }) => {
        const childArray = Array.isArray(children) ? children : [children];
        const nonWhitespaceChildren = childArray.filter((child) => {
          if (typeof child === "string" || typeof child === "number") {
            return String(child).trim() !== "";
          }
          return true;
        });
        if (nonWhitespaceChildren.length === 1) {
          const child = nonWhitespaceChildren[0];
          if (
            isValidElement(child) &&
            (typeof child.type === "string"
              ? child.type === "code"
              : (child.props as { node?: { tagName?: string } }).node?.tagName === "code")
          ) {
            const codeChild = child as ReactElement<{
              className?: string;
              children?: ReactNode;
              node?: { tagName?: string };
            }>;
            const className = codeChild.props.className ?? "";
            const match = /language-(\w+)/.exec(className);
            const language = match?.[1] ?? "";
            const code = extractText(codeChild.props.children).replace(/\n$/, "");
            return <CodeBlock code={code} language={language} />;
          }
        }
        return <pre>{children}</pre>;
      },
      code: ({ node: _node, className, children, ...props }) => {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }),
    [resolveHeadingId]
  );

  return (
    <ReactMarkdown
      remarkPlugins={REMARK_PLUGINS}
      rehypePlugins={rehypePlugins}
      urlTransform={urlTransform}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  );
});

export const MarkdownDocument = memo(function MarkdownDocument({ markdown, headings, onRendered, searchQuery, searchQueryPending, activeMatchIndex, onMatchCountChange }: MarkdownDocumentProps) {
  const articleRef = useRef<HTMLElement>(null);
  const prevQueryRef = useRef("");
  const deleteScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 内容提交到 DOM 后通知父级（useLayoutEffect 在绘制前同步执行，此时 scrollHeight 已可用于测量）
  useLayoutEffect(() => {
    onRendered?.();
  });

  // 搜索标记由 rehype 插件声明式生成；此 effect 负责：
  // 1. 统计匹配数并通知父级
  // 2. 用 DOM 操作为「当前匹配」打上 search-match--current 类并滚动到它
  // 放在绘制前的 layout effect 中，用户不会看到类名切换的中间态。
  // 滚动时机分流：
  // - 「纯删除」（新词更短且是旧词的子串）→ 延迟 300ms，连续退格时每次击键
  //   取消上一个定时器，只在停手后滚动一次；延迟触发时若首个匹配已在视口内
  //   （留边距）则只保留高亮不再滚动——删短词后首个匹配通常已在屏幕上。
  // - searchQueryPending（输入已变、deferred 词未跟进的 urgent 渲染）→ 不滚动。
  //   此时 activeMatchIndex 被重置为 0 只是输入的副产物，若据此立即滚动，
  //   页面会秒跳到旧词的第一个匹配，防抖形同虚设；等 deferred 提交后再决定。
  // - 其余（输入变长/替换/上一个下一个按钮）→ 立即滚动。
  useLayoutEffect(() => {
    const marks = articleRef.current?.querySelectorAll<HTMLElement>("mark.search-match") ?? [];
    onMatchCountChange?.(marks.length);

    for (const mark of marks) {
      mark.classList.remove("search-match--current");
    }

    const nextQuery = searchQuery ?? "";
    const isDeletion =
      nextQuery.length < prevQueryRef.current.length &&
      prevQueryRef.current.includes(nextQuery);
    prevQueryRef.current = nextQuery;

    if (marks.length === 0 || activeMatchIndex === undefined) return;

    const currentIndex = Math.max(0, Math.min(activeMatchIndex, marks.length - 1));
    const current = marks[currentIndex];
    current.classList.add("search-match--current");

    // 与恢复位置/大纲跳转同一套缓动动画（居中滚动），用户滚动/按键可被 App 的监听取消；
    // 原生 smooth scrollIntoView 不会响应用户打断，会产生拉扯闪动
    const scrollToCurrent = (onlyIfOutsideViewport: boolean) => {
      const container = current.closest(".document-scroll");
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const currentRect = current.getBoundingClientRect();
      if (onlyIfOutsideViewport) {
        const margin = 24;
        const alreadyVisible =
          currentRect.top >= containerRect.top + margin &&
          currentRect.bottom <= containerRect.bottom - margin;
        if (alreadyVisible) return;
      }
      const target =
        container.scrollTop +
        (currentRect.top - containerRect.top) -
        (container.clientHeight - currentRect.height) / 2;
      animateScrollTo(container as HTMLElement, target);
    };

    if (isDeletion) {
      deleteScrollTimerRef.current = setTimeout(() => {
        deleteScrollTimerRef.current = null;
        // 300ms 后重新测量（等待期间用户可能已自行滚动）
        scrollToCurrent(true);
      }, 300);
    } else if (!searchQueryPending) {
      scrollToCurrent(false);
    }

    return () => {
      if (deleteScrollTimerRef.current) {
        clearTimeout(deleteScrollTimerRef.current);
        deleteScrollTimerRef.current = null;
      }
    };
  }, [searchQuery, searchQueryPending, activeMatchIndex, markdown, onMatchCountChange]);

  return (
    <article className="markdown-body" ref={articleRef}>
      <MarkdownBody markdown={markdown} headings={headings} searchQuery={searchQuery} />
    </article>
  );
});

// default 导出供 App.tsx 的 React.lazy 代码分割使用（命名导出保留给测试等直接引用）
export default MarkdownDocument;
