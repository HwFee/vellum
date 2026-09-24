import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import "katex/dist/katex.min.css";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { animateScrollTo } from "../lib/smoothScroll";
import { buildEditUnits, caretOffsetForRatio, type EditUnit } from "../lib/editUnits";
import { parseFrontmatter } from "../lib/frontmatter";
import { rehypeEditUnits } from "../lib/rehypeEditUnits";
import { rehypeObsidian } from "../lib/rehypeObsidian";
import { rehypeSearchHighlights } from "../lib/rehypeSearchHighlights";
import { kamiSchema, urlTransform } from "../lib/kamiSchema";
import { REMARK_PLUGINS } from "../lib/remarkPlugins";
import { useHeadingIdResolver } from "../hooks/useHeadingIdResolver";
import { useMarkdownComponents } from "./markdownComponents";
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

// strict: "ignore"：容忍公式里的 CJK/Unicode 文本（如 $\text{向量}$），不在控制台刷警告。
// 解析失败时 rehype-katex 内部会降级为红色源码兜底渲染，不会中断整篇文档。
const KATEX_OPTIONS = { strict: "ignore" } as const;

// 文档中是否可能出现原始 HTML（误判为 true 无害，只是不省 rehype-raw 的开销）
const RAW_HTML_RE = /<\/?[a-zA-Z!?]/;

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
  const components = useMarkdownComponents({
    resolveHeadingId,
    isTrustedMdlog,
    wikilinks,
    onOpenWikilink,
    taskToggleEnabled,
    onToggleTask,
  });

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
