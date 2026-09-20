import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema, type Options as RehypeSanitizeOptions } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isValidElement, memo, useCallback, useLayoutEffect, useMemo, useRef, type ReactElement, type ReactNode } from "react";
import { MarkdownImage } from "./MarkdownImage";
import { slugify } from "../lib/outline";
import { animateScrollTo } from "../lib/smoothScroll";
import { buildEditUnits, caretOffsetForRatio, type EditUnit } from "../lib/editUnits";
import { parseFrontmatter } from "../lib/frontmatter";
import { wikilinkHref, WIKILINK_SCHEME } from "../lib/wikilink";
import { rehypeEditUnits } from "../lib/rehypeEditUnits";
import { rehypeObsidian } from "../lib/rehypeObsidian";
import { CodeBlock } from "./CodeBlock";
import { WidgetSandbox } from "./WidgetSandbox";
import type { HeadingLevel, OutlineHeading } from "../types";
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
  /** 块级就地编辑视图：为真时才给块打标记并响应点击；缺省（阅读视图）不接入标记插件 */
  editable?: boolean;
  onActivateUnit?: (index: number, caretOffset: number) => void;
  onLockedUnitClick?: (reason: "html" | "widget" | "frontmatter") => void;
  /** 阅读视图里点击任务列表复选框：实参是该列表项的源码起点（`-` / `*` / `1.` 的偏移）。
   *  缺省时复选框保持 disabled（未接线的调用方与改动前逐字相同） */
  onToggleTask?: (itemStart: number) => void;
  /** wikilink 目标 → 已解析的绝对路径（null = 库内找不到）。缺省时锚点不接任何行为 */
  wikilinks?: ReadonlyMap<string, string | null>;
  /** 点击库内链接（已解析）时回调：App 用它切换文档；第三参是 `#片段`（人读标题原文，
   *  没有片段时省略，保持两参调用），App 据此在目标笔记里滚到对应标题 */
  onOpenWikilink?: (path: string, target: string, fragment?: string) => void;
};

type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
  /// 源码位置（hast 的标准字段）：任务列表勾选靠它把 <li> 映射回源码偏移
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

// mdast 节点的最小结构（只声明本文件用到的字段）
type MdastNode = {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdastNode[];
};

// micromark-extension-math 的语法没有 Pandoc 的货币保护规则，会把
// 「价格在 $5 和 $10 之间」里的 $5 和 $ 误判为行内公式。
// 这里按节点位置回查原文，套用 Pandoc 的判定规则：
// 开 $ 后紧跟空格、闭 $ 前是空格、或闭 $ 紧跟 ASCII 数字 → 不是公式，还原为文本。
function remarkMathCurrencyGuard() {
  return (tree: MdastNode, file: { value?: unknown }) => {
    const source = typeof file.value === "string" ? file.value : "";
    if (!source) return;

    function visit(node: MdastNode) {
      if (!node.children) return;
      for (let index = 0; index < node.children.length; index++) {
        const child = node.children[index];
        if (child.type === "inlineMath") {
          const start = child.position?.start.offset;
          const end = child.position?.end.offset;
          if (start !== undefined && end !== undefined && end > start + 1) {
            let openLength = 0;
            while (source[start + openLength] === "$") openLength += 1;
            let closeLength = 0;
            while (source[end - 1 - closeLength] === "$") closeLength += 1;

            const afterOpen = source[start + openLength];
            const beforeClose = source[end - closeLength - 1];
            const afterClose = source[end];

            const looksLikeCurrency =
              afterOpen === " " ||
              afterOpen === "\t" ||
              beforeClose === " " ||
              beforeClose === "\t" ||
              (afterClose !== undefined && afterClose >= "0" && afterClose <= "9");

            if (looksLikeCurrency) {
              node.children[index] = { type: "text", value: source.slice(start, end) };
              continue;
            }
          }
        }
        visit(child);
      }
    }

    visit(tree);
  };
}

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
// 这里放行 ftp，使其 href 保留，点击时与 http(s) 一样交给系统 opener 处理。
// `wikilink:`（库内笔记互链的占位方案）同样必须放行——它不交给浏览器导航，
// 但 href 要留在 DOM 里可供检查；被清成空串会让锚点看起来是一条空链接。
function urlTransform(url: string) {
  if (url.startsWith("ftp:")) return url;
  if (url.startsWith(WIKILINK_SCHEME)) return url;
  return defaultUrlTransform(url);
}

/// react-markdown 把 hast 属性作为 props 交给自定义 components，而被自定义组件接管的
/// 标签不会自动把这些属性落到 DOM。这里只交还块标记属性（不透传 node 等内部 prop），
/// 阅读视图下标记属性本就不存在，DOM 保持零差异。
function unitMarkProps(props: object): { unit?: number; locked?: string } {
  const record = props as Record<string, unknown>;
  const unit = record["data-vellum-unit"];
  const locked = record["data-vellum-locked"];
  return {
    unit: typeof unit === "number" ? unit : undefined,
    locked: typeof locked === "string" ? locked : undefined,
  };
}

// remark 插件列表与文档无关，提升为模块常量，避免每次渲染产生新引用
// remark-cjk-friendly（含 gfm 删除线版）：放宽 CommonMark 强调定界符的 flanking 判定，
// 使 **粗体**(注)、~~删除线~~中文 这类「标点贴 CJK」写法正常渲染（规范原文下会输出字面 **）
const REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkCjkFriendly,
  remarkCjkFriendlyGfmStrikethrough,
  remarkMath,
  remarkMathCurrencyGuard,
];

// strict: "ignore"：容忍公式里的 CJK/Unicode 文本（如 $\text{向量}$），不在控制台刷警告。
// 解析失败时 rehype-katex 内部会降级为红色源码兜底渲染，不会中断整篇文档。
const KATEX_OPTIONS = { strict: "ignore" } as const;

// 文档中是否可能出现原始 HTML（误判为 true 无害，只是不省 rehype-raw 的开销）
const RAW_HTML_RE = /<\/?[a-zA-Z!?]/;

function useHeadingIdResolver(headings?: OutlineHeading[]) {
  const usedIds = useRef(new Set<string>());
  const fallbackCounter = useRef(0);
  const headingsRef = useRef(headings);
  headingsRef.current = headings;

  // Reset allocation on every render so document/headings changes do not carry over stale ids.
  usedIds.current = new Set<string>();
  fallbackCounter.current = 0;

  // 【不变量约束（React 19 并发渲染合规，C5）】：
  // resolveHeadingId 必须且仅允许在渲染期被组件（components.h1–h6）同步调用。
  // headingsRef 在每次渲染函数体中赋值，usedIds/fallbackCounter 也在同一次渲染中重置。
  // 严禁将其放入事件处理器、useEffect/useLayoutEffect 或 setTimeout 等异步回调中调用，
  // 否则在 React 19 并发中断/重放渲染时，读取到的将是未提交帧或已被废弃 pass 的 stale headings。
  return useCallback(
    (level: HeadingLevel, text: string) => {
      const candidates = headingsRef.current?.filter((h) => h.level === level && h.text === text) ?? [];
      for (const candidate of candidates) {
        if (!usedIds.current.has(candidate.id)) {
          usedIds.current.add(candidate.id);
          return candidate.id;
        }
      }

      // 精确匹配失败多半是公式标题：渲染文本与源文本不一致（「$O(n)$」渲染成「O(n)」，
      // 且 KaTeX 输出含 MathML 隐藏副本）。渲染顺序与大纲顺序一致（同源文档），取同级
      // 第一个未使用且源文本含 $ 的标题按序分配。限定含 $ 是为了防止原始 HTML 标题
      //（不在大纲里）误占大纲 id。
      const mathCandidate = headingsRef.current?.find(
        (h) => h.level === level && h.text.includes("$") && !usedIds.current.has(h.id)
      );
      if (mathCandidate) {
        usedIds.current.add(mathCandidate.id);
        return mathCandidate.id;
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
    []
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
  editable?: boolean;
  /** 块单元由 MarkdownDocument 统一构建后传入（reading 视图恒为空数组） */
  units: EditUnit[];
  wikilinks?: ReadonlyMap<string, string | null>;
  onOpenWikilink?: (path: string, target: string, fragment?: string) => void;
  onToggleTask?: (itemStart: number) => void;
};

/// 真正执行 unified 解析管线的部分。props 全部是稳定引用（字符串或 memo 结果），
/// 因此父组件因 activeMatchIndex 等无关状态重渲染时，这里整体跳过，不重新解析文档。
const MarkdownBody = memo(function MarkdownBody({
  markdown,
  headings,
  searchQuery,
  editable,
  units,
  wikilinks,
  onOpenWikilink,
  onToggleTask,
}: MarkdownBodyProps) {
  const resolveHeadingId = useHeadingIdResolver(headings);

  const isTrustedMdlog = useMemo(
    () => /^\uFEFF?\s*<!--\s*mdlog:v1/.test(markdown),
    [markdown]
  );

  // 文档不含原始 HTML 时跳过 rehype-raw（其内部会对整棵树再做一次 HTML 解析），
  // 输出完全一致；rehype-sanitize 始终保留作为安全保障
  const hasRawHtml = useMemo(() => RAW_HTML_RE.test(markdown), [markdown]);

  // 插件选项对象必须 memo：内联创建会让 unified 每次渲染都重跑标记插件
  const editUnitOptions = useMemo(() => ({ units }), [units]);

  // frontmatter 解析与插件选项都按 markdown memo：MarkdownBody 的 props 保持稳定引用，
  // 父组件因无关状态重渲染时这里整体跳过
  const frontmatter = useMemo(() => parseFrontmatter(markdown), [markdown]);
  const obsidianOptions = useMemo(() => ({ frontmatter }), [frontmatter]);

  const rehypePlugins: PluggableList = useMemo(() => {
    // 块标记插件只在编辑视图接入，且位于 sanitize 之后：标记不经 sanitize 白名单，
    // 阅读视图（editable 为假）的管线与改动前逐字节一致
    const editPlugins: PluggableList = editable ? [[rehypeEditUnits, editUnitOptions]] : [];

    return [
      ...(hasRawHtml ? [rehypeRaw] : []),
      [rehypeSanitize, kamiSchema],
      // 属性卡在 sanitize 之后（自产 hast，不经白名单）、在 rehypeEditUnits 之前
      // （卡片要先存在，才谈得上打上只读块标记）。它只换树、不动源码字符串，
      // 正文节点的偏移因此保持原样（见 rehypeObsidian 头部注释）
      [rehypeObsidian, obsidianOptions],
      ...editPlugins,
      // 搜索高亮必须在 katex 之前：此刻公式仍是 <code class="math-*"> 纯文本
      //（被 SEARCH_SKIP_TAGS 跳过），katex 渲染产物（MathML + 大量定位 span）
      // 不会被高亮逻辑拆开破坏
      [rehypeSearchHighlights, { query: searchQuery ?? "" }],
      // katex 放管线末尾：其输出含大量 class、MathML 属性与内联样式，必须绕过
      // sanitize；rehype-katex 默认 trust:false（\href 等禁用），产物安全
      [rehypeKatex, KATEX_OPTIONS],
    ];
  }, [hasRawHtml, searchQuery, editable, editUnitOptions, obsidianOptions]);

  // 任务勾选只在阅读视图接管，且必须有接管方（App 侧经 editorRef 读最新会话）。
  // 两条都不满足时下方两条覆盖渲染整体不挂：编辑视图与未接线调用方的
  // components 与改动前逐字相同（复选框保持 disabled）。
  const taskToggleEnabled = !editable && typeof onToggleTask === "function";

  // components 对象必须 memo：内联创建会让 react-markdown 每次渲染都重走解析管线
  const components: Components = useMemo(
    () => ({
      h1: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h1
            id={resolveHeadingId(1, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h1>
        );
      },
      h2: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h2
            id={resolveHeadingId(2, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h2>
        );
      },
      h3: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h3
            id={resolveHeadingId(3, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h3>
        );
      },
      // h4–h6 与 h1–h3 同一套 id 分配器：大纲收录到 h6，条目点击依赖正文标题带 id
      h4: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h4
            id={resolveHeadingId(4, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h4>
        );
      },
      h5: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h5
            id={resolveHeadingId(5, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h5>
        );
      },
      h6: ({ children, ...props }) => {
        const mark = unitMarkProps(props);
        return (
          <h6
            id={resolveHeadingId(6, extractText(children))}
            data-vellum-unit={mark.unit}
            data-vellum-locked={mark.locked}
          >
            {children}
          </h6>
        );
      },
      a: ({ href, children, ...rest }) => {
        // wikilink 必须在协议分支**之前**处理：它的 href 也带方案（`wikilink:`），
        // 落到外链分支就会被交给系统 opener 打开一个不存在的协议
        const props = rest as Record<string, unknown>;
        const target = props["data-wikilink"];
        if (typeof target === "string" && target !== "") {
          // 片段（`#人读标题原文`）单独携带：渲染层只负责把它交给 App，
          // 匹配哪一条标题由 App 按目标文档的大纲决定
          const rawFragment = props["data-wikilink-fragment"];
          const fragment = typeof rawFragment === "string" && rawFragment !== "" ? rawFragment : undefined;
          const label = children;
          const resolved = wikilinks?.get(target);

          // 未传表（只出现在不接 App 的调用方与测试里）：锚点保持惰性——
          // 不接点击、不导航，但形状与已解析时一致
          if (!wikilinks) {
            return (
              <a className="wikilink" data-wikilink={target} title={typeof props.title === "string" ? props.title : undefined}>
                {label}
              </a>
            );
          }

          if (typeof resolved === "string") {
            return (
              <a
                className="wikilink"
                href={wikilinkHref(target)}
                data-wikilink={target}
                data-wikilink-fragment={fragment}
                title={typeof props.title === "string" ? props.title : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  // 有片段才带第三个实参：没有片段的链接保持两参调用，
                  // 既有调用方与断言一字不改
                  if (fragment === undefined) {
                    onOpenWikilink?.(resolved, target);
                  } else {
                    onOpenWikilink?.(resolved, target, fragment);
                  }
                }}
              >
                {label}
              </a>
            );
          }

          // 库内找不到（或表里显式 null）：降级为纯文本 + 提示，绝不给出假链接
          return (
            <span
              className="wikilink wikilink--missing"
              data-wikilink={target}
              title={`未找到笔记：${target}`}
            >
              {label}
            </span>
          );
        }

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
            const match = /language-([\w-]+)/.exec(className);
            const language = match?.[1] ?? "";
            const code = extractText(codeChild.props.children).replace(/\n$/, "");

            if (language === "vellum-widget") {
              // P9: 512KB 预检短路：字符数超 524288 字节数必超（短路超限）；
              // 字符数 <= 131072 即便全部为 4 字节 UTF-8 字符也绝不可能超（短路安全）；
              // 仅在临界区间 (131072, 524288] 才执行 TextEncoder 编码。
              const isOversized =
                code.length > 524288 ||
                (code.length > 131072 && new TextEncoder().encode(code).length > 524288);
              if (isOversized) {
                // F12: 降级语言统一为 markup——CodeBlock 已注册的 Prism 语言，
                // 且 widget 内容本就是完整 HTML 文档；空串会被当成 text 丢掉高亮
                return <CodeBlock code={code} language="markup" />;
              }
              return (
                <WidgetSandbox
                  html={code}
                  autoMount={isTrustedMdlog}
                />
              );
            }

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
      // 任务列表勾选：<input> 上没有源码位置（GFM 生成时就不带），<li> 上有——
      // 所以「点的是哪一项」由 <li> 交出去，勾选与写盘全在 App / useDocumentEditor 一侧。
      ...(taskToggleEnabled
        ? {
            li: ({ node, children, ...props }) => {
              const position = node?.position?.start?.offset;
              const className = typeof props.className === "string" ? props.className : "";
              // task-list-item 这个类是 mdast-util-to-hast 给 GFM 任务项加的；
              // 没有源码位置就定位不到块单元与标记，宁可不接管
              const toggleable =
                className.split(/\s+/).includes("task-list-item") &&
                typeof position === "number";
              return (
                <li
                  {...props}
                  onClick={
                    toggleable
                      ? (event) => {
                          const target = event.target;
                          // 只有点在复选框上才算勾选：点条目文字是选字/阅读，不该改文件
                          if (
                            !(target instanceof HTMLInputElement) ||
                            target.type !== "checkbox"
                          ) {
                            return;
                          }
                          onToggleTask?.(position);
                        }
                      : undefined
                  }
                >
                  {children}
                </li>
              );
            },
            input: ({ node, ...props }) => {
              // GFM 任务复选框由 mdast-util-to-hast 生成：**不带源码位置**且恒为 disabled。
              // disabled 控件不派发点击事件，要让它在 Vellum 里可点就必须摘掉。
              // 原始 HTML 里的 <input>（rehype-raw 解析，带位置）一律不动：HTML 块只读，
              // 作者写下的 disabled 该留着。
              const isTaskCheckbox =
                props.type === "checkbox" && node !== undefined && node.position === undefined;
              if (!isTaskCheckbox) return <input {...props} />;

              // checked 受控 + readOnly：勾选态由源码字符串单向驱动，乐观更新与失败回滚
              // 都靠这次重渲染回到正确状态（readOnly 只是压掉 React 的受控告警；
              // 复选框本身不认 readOnly，点击照常冒泡到上面的 <li>）
              const { disabled: _disabled, ...rest } = props;
              return <input {...rest} type="checkbox" checked={rest.checked === true} readOnly />;
            },
          }
        : {}),
    }),
    [
      resolveHeadingId,
      isTrustedMdlog,
      wikilinks,
      onOpenWikilink,
      taskToggleEnabled,
      onToggleTask,
    ]
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

export const MarkdownDocument = memo(function MarkdownDocument({
  markdown,
  headings,
  onRendered,
  searchQuery,
  searchQueryPending,
  activeMatchIndex,
  onMatchCountChange,
  editable,
  onActivateUnit,
  onLockedUnitClick,
  wikilinks,
  onOpenWikilink,
  onToggleTask,
}: MarkdownDocumentProps) {
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

  const isTrustedMdlogDoc = useMemo(
    () => /^\uFEFF?\s*<!--\s*mdlog:v1/.test(markdown),
    [markdown]
  );

  // 块单元只在编辑视图构建（阅读视图恒为空数组，不接入标记插件、无点击处理）
  const units = useMemo(() => (editable ? buildEditUnits(markdown) : []), [editable, markdown]);

  // 点击块 → 索引 + 块内纵向比率换算出的源码光标落点
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!editable) return;
      const target = (event.target as Element | null)?.closest("[data-vellum-unit]");
      if (!target) return;
      const index = Number(target.getAttribute("data-vellum-unit"));
      // 不变量：closest 已保证属性存在、且 data* 不经 sanitize（标记插件在 sanitize 之后），
      // 故取值恒为整数。守卫只是显式阻断 Number(null) === 0 这类隐式误命中，不改变可达路径
      if (!Number.isInteger(index)) return;
      const unit = units.find((candidate) => candidate.index === index);
      if (!unit) return;

      if (!unit.editable) {
        // reason 原样转发（frontmatter 属性卡也是只读块，不能被折叠成 html）
        onLockedUnitClick?.(unit.reason ?? "html");
        return;
      }

      // 被包裹的块（代码块/数学块/widget）命中的是 .vellum-unit-wrap 包裹层，而 T7 给它的
      // CSS 是 display: contents（不生成布局盒，Chromium 对其 getBoundingClientRect() 返回全 0）。
      // 此时改用首个元素子节点当测量盒；只有 rect 不可用才回退，因为普通 <p> 的首个子元素
      // 可能是行内 <strong>/<code>，无条件使用会算错盒。
      const measured =
        target.getBoundingClientRect().height > 0 ? target : target.firstElementChild ?? target;
      const rect = measured.getBoundingClientRect();
      const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
      // 裁定 F9b：消费端（textarea）拿到的是 LF 归一文本，caret 偏移必须按同一文本算。
      // 若直接用原始切片，行尾 \r 会被 caretOffsetForRatio 计入行宽（每行 +1），CRLF 文档
      // 每多一行就多偏一位，点块中/块尾落在错误的行上。
      const source = markdown.slice(unit.start, unit.end).replace(/\r\n/g, "\n");
      onActivateUnit?.(index, caretOffsetForRatio(source, ratio));
    },
    [editable, markdown, onActivateUnit, onLockedUnitClick, units]
  );

  const articleClassName = [
    "markdown-body",
    isTrustedMdlogDoc ? "markdown-body--mdlog" : null,
    editable ? "markdown-body--editing" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={articleClassName} ref={articleRef} onClick={editable ? handleClick : undefined}>
      <MarkdownBody
        markdown={markdown}
        headings={headings}
        searchQuery={searchQuery}
        editable={editable}
        units={units}
        wikilinks={wikilinks}
        onOpenWikilink={onOpenWikilink}
        onToggleTask={onToggleTask}
      />
    </article>
  );
});

// default 导出供 App.tsx 的 React.lazy 代码分割使用（命名导出保留给测试等直接引用）
export default MarkdownDocument;
