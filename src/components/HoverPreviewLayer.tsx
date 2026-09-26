import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import { parseFrontmatter } from "../lib/frontmatter";
import { basename, fileNameToTitle } from "../lib/path";
import { parseWikilink, WIKILINK_RE, wikilinkLabel } from "../lib/wikilink";

/** `read_note_preview` 命令的返回契约（camelCase，对应 Rust 侧 NotePreview）。 */
export type NotePreview = {
  path: string;
  fileName: string;
  markdown: string;
  truncated: boolean;
};

export type HoverPreviewProps = {
  /// 滚动容器（定位边界与 scroll 隐藏信号）：App 的 scrollRef
  containerRef: MutableRefObject<HTMLDivElement | null>;
  /// 正文宿主（脚注 li 的归属判定）：App 的 documentContentRef
  contentRef: MutableRefObject<HTMLDivElement | null>;
  /// 编辑视图下不出预览（BlockEditor 的指针交互优先）
  enabled: boolean;
  /// 目标 → 已解析绝对路径（useDocumentLoader 的解析表）
  wikilinks: ReadonlyMap<string, string | null>;
  /// 换文档时清掉预览缓存
  documentPath: string | null;
  /// 点笺页卡 = 点链接本身（与 markdownComponents 的点击同参调用）
  onOpenWikilink: (path: string, target: string, fragment?: string) => void;
};

type Preview =
  | { kind: "footnote"; anchor: HTMLElement; n: string; li: HTMLLIElement }
  | {
      kind: "wikilink";
      anchor: HTMLElement;
      target: string;
      fragment?: string;
      resolved: string;
    };

const FOOTNOTE_DELAY_MS = 200;
const WIKILINK_DELAY_MS = 350;
const HIDE_GRACE_MS = 150;
/// 预览正文只取开头：64KiB 的后端截断之上再收窄到 3000 字符（卡片只露前几行）
const NOTE_BODY_MAX_CHARS = 3000;

// 预览卡的 remark 链只有两条（gfm + CJK 强调放宽），无 rehype、不跑 sanitize：
// 内容是磁盘文件原文，skipHtml 挡掉原始 HTML；wikilink 语法在进管线前已被换成纯文本
const PREVIEW_PLUGINS = [remarkGfm, remarkCjkFriendly];

// 预览卡的 components 映射是模块常量（任何渲染都不产新引用）：
// img 丢弃（预览不加载图片），a 降成 span（预览内不嵌套导航），
// pre/code 用纯元素（不引 CodeBlock/Prism，也不进 WidgetSandbox 分支）
const PREVIEW_COMPONENTS: Components = {
  img: () => null,
  a: ({ children }) => <span>{children}</span>,
  pre: ({ children }) => <pre>{children}</pre>,
  code: ({ children, className }) => <code className={className}>{children}</code>,
};

/// 预览正文：剥 frontmatter、截前 3000 字符、`[[目标|别名]]`/`[[目标]]` 换成显示标签。
function previewMarkdown(raw: string): string {
  const body = parseFrontmatter(raw).body.slice(0, NOTE_BODY_MAX_CHARS);
  return body.replace(WIKILINK_RE, (match, inner: string) => {
    const link = parseWikilink(inner);
    return link.target ? wikilinkLabel(link) : match;
  });
}

/**
 * 悬停预览层（A1 浮笺 + B1 笺页卡）：对滚动容器做 pointerover/pointerout 委托，
 * 脚注上标（a[data-footnote-ref]，200ms）出浮笺、已解析 wikilink（a.wikilink[href]，
 * 未解析的渲染成 span 天然落选，350ms）出笺页卡。
 *
 * 组件挂在 App 层而非 components 映射内（红线 4：components 引用必须稳定）；
 * 懒加载以把 react-markdown 挡在入口 chunk 之外。
 *
 * 收卡路径：离开锚点 150ms 宽限（移入卡片取消）、离开卡片 150ms、滚动容器、
 * 卡外 pointerdown、Escape、enabled 变假、换文档、卸载。
 */
export default function HoverPreviewLayer({
  containerRef,
  contentRef,
  enabled,
  wikilinks,
  documentPath,
  onOpenWikilink,
}: HoverPreviewProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [note, setNote] = useState<NotePreview | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const cardRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /// 锚点去重：同一锚点内的 pointerover 抖动不重置延迟
  const anchorRef = useRef<HTMLElement | null>(null);
  /// 正在展示的卡片服务的锚点：只在 hide() 里清零。离卡回到原锚点时直接撤销
  /// pending 的收卡（不重走延迟），异步回包也用它判时效（悬停目标已换则丢弃展示）
  const shownAnchorRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  /// 预览结果缓存（路径 → NotePreview）；documentPath 换代即清空
  const cacheRef = useRef(new Map<string, NotePreview>());
  /// 易变输入经 ref 供常驻监听读取：监听器只挂一次，不随 wikilinks/enabled 换代重绑
  const liveRef = useRef({ enabled, wikilinks });
  liveRef.current = { enabled, wikilinks };

  const clearTimers = useCallback(() => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearTimers();
    anchorRef.current = null;
    shownAnchorRef.current = null;
    setPreview(null);
    setNote(null);
    setPos(null);
  }, [clearTimers]);

  const show = useCallback(
    (anchor: HTMLElement) => {
      const container = containerRef.current;
      const content = contentRef.current;
      if (!container || !content || !liveRef.current.enabled) return;

      // 脚注上标：href 指到同文档 footnotes 列表的 li；li 必须真的挂在当前正文宿主下
      if (anchor.hasAttribute("data-footnote-ref")) {
        const href = anchor.getAttribute("href") ?? "";
        if (!href.startsWith("#")) return;
        let li: HTMLLIElement | null = null;
        try {
          const found = document.getElementById(decodeURIComponent(href.slice(1)));
          if (found instanceof HTMLLIElement && content.contains(found)) li = found;
        } catch {
          li = null;
        }
        if (!li) return;
        shownAnchorRef.current = anchor;
        setNote(null);
        setPos(null);
        setPreview({ kind: "footnote", anchor, n: anchor.textContent?.trim() ?? "", li });
        return;
      }

      // 已解析 wikilink（a.wikilink[href]）：查解析表取真实路径；未命中不出卡
      const target = anchor.getAttribute("data-wikilink") ?? "";
      const resolved = liveRef.current.wikilinks.get(target);
      if (!resolved) return;
      const fragmentAttr = anchor.getAttribute("data-wikilink-fragment");
      const fragment = fragmentAttr ? fragmentAttr : undefined;

      shownAnchorRef.current = anchor;
      setNote(cacheRef.current.get(resolved) ?? null);
      setPos(null);
      setPreview({ kind: "wikilink", anchor, target, fragment, resolved });

      if (!cacheRef.current.has(resolved)) {
        void invoke<NotePreview>("read_note_preview", { path: resolved })
          .then((loaded) => {
            // 回包先落缓存；展示只给「仍是当前悬停目标」的那一份——悬停中途换链接时
            // 上一个目标的迟到响应不顶掉新卡的空白态
            cacheRef.current.set(resolved, loaded);
            if (shownAnchorRef.current === anchor) setNote(loaded);
          })
          .catch((error: unknown) => {
            // 读不到就静默不出卡（无 toast），卡若正开着就收掉
            // ——不走 hide()：它只是预览清空，不取消此刻悬停在新锚点上的出卡定时器
            console.warn("read_note_preview failed:", error);
            if (shownAnchorRef.current === anchor) {
              shownAnchorRef.current = null;
              setPreview(null);
              setPos(null);
            }
          });
      }
    },
    [containerRef, contentRef]
  );

  // 委托监听一次性挂在滚动容器上：pointerover/pointerout 决定进出，
  // scroll / 卡外 pointerdown / Escape 立即收卡
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    // 收窄后的非空引用：闭包内事件处理器不再重复判空
    const host: HTMLDivElement = container;

    const SELECTOR = "a[data-footnote-ref], a.wikilink[href]";

    function onPointerOver(event: PointerEvent) {
      if (!liveRef.current.enabled) return;
      const target = event.target as Element | null;
      const link = target?.closest?.(SELECTOR) as HTMLElement | null;
      if (!link || !host.contains(link)) return;
      if (link === shownAnchorRef.current) {
        // 卡片正开着（或还在这枚锚点的收卡宽限内）——回到原锚点直接撤销收卡，
        // 不重走延迟：否则出卡-收卡-再出卡就是一段肉眼可见的闪
        clearTimers();
        anchorRef.current = link;
        return;
      }
      if (link === anchorRef.current) return;
      anchorRef.current = link;
      clearTimers();
      const delay = link.hasAttribute("data-footnote-ref")
        ? FOOTNOTE_DELAY_MS
        : WIKILINK_DELAY_MS;
      showTimerRef.current = window.setTimeout(() => show(link), delay);
    }

    function onPointerOut(event: PointerEvent) {
      const target = event.target as Element | null;
      const link = target?.closest?.(SELECTOR);
      if (!link || link !== anchorRef.current) return;
      // 从锚点直接移进卡片不算离开：卡片的 pointerenter 已接管存续
      const into = event.relatedTarget as Element | null;
      if (into && cardRef.current?.contains(into)) {
        anchorRef.current = null;
        return;
      }
      anchorRef.current = null;
      clearTimers();
      hideTimerRef.current = window.setTimeout(hide, HIDE_GRACE_MS);
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (target && cardRef.current?.contains(target)) return;
      // 点脚注上标自身也走这里：先收卡，原生跳转到锚点照常发生
      hide();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") hide();
    }

    host.addEventListener("pointerover", onPointerOver);
    host.addEventListener("pointerout", onPointerOut);
    host.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      host.removeEventListener("pointerover", onPointerOver);
      host.removeEventListener("pointerout", onPointerOut);
      host.removeEventListener("scroll", hide);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [containerRef, show, hide, clearTimers]);

  // enabled 变假（进编辑视图）/ 换文档 / 卸载：立即收卡；换文档同时清缓存
  useEffect(() => {
    if (!enabled) hide();
  }, [enabled, hide]);
  useEffect(() => {
    cacheRef.current.clear();
    hide();
  }, [documentPath, hide]);
  useEffect(() => hide, [hide]);

  // 浮笺正文：克隆目标 li（去回链 ↩、剥掉全部 id 防重复 id），子节点搬进卡内
  // ——不走 innerHTML，复用浏览器对 DOM 的既有消毒结果
  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    if (preview?.kind !== "footnote") {
      node.replaceChildren();
      return;
    }
    const clone = preview.li.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.querySelectorAll("[data-footnote-backref]").forEach((el) => el.remove());
    clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    node.replaceChildren(...Array.from(clone.childNodes));
  }, [preview]);

  // 定位：卡片 position:fixed，坐标系就是视口。脚注偏上方、wikilink 偏下方；
  // 该侧放不下且另一侧放得下就翻面，两侧都不够时夹进滚动容器矩形内
  useLayoutEffect(() => {
    if (!preview) return;
    const card = cardRef.current;
    const container = containerRef.current;
    if (!card || !container) return;
    const s = container.getBoundingClientRect();
    const a = preview.anchor.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let left = a.left + a.width / 2 - w / 2;
    left = Math.max(s.left + 8, Math.min(left, s.right - w - 8));
    const aboveRoom = a.top - s.top - 8;
    const belowRoom = s.bottom - a.bottom - 8;
    const below =
      preview.kind === "wikilink"
        ? belowRoom >= h || belowRoom >= aboveRoom
        : !(aboveRoom >= h || aboveRoom >= belowRoom);
    let top = below ? a.bottom + 8 : a.top - h - 8;
    const minTop = s.top + 8;
    const maxTop = s.bottom - h - 8;
    if (top > maxTop) top = Math.max(minTop, maxTop);
    if (top < minTop) top = minTop;
    setPos({ left, top, below });
    // note 迟到会撑高卡片：高度变了重新评估翻面
  }, [preview, note, containerRef]);

  const noteBody = useMemo(() => (note ? previewMarkdown(note.markdown) : ""), [note]);

  // 浮笺里是克隆 DOM——React 的链接接管（外链 openUrl / wikilink 打开）全都丢了：
  // 外链 href 会让 WebView2 原地导航、`wikilink:` 自定义协议会触发未知协议跳转。
  // 卡片层统一 preventDefault 后按形态自行分发（与正文链接同一套去向）。
  const onFootnoteLinkClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const link = (event.target as Element | null)?.closest?.("a");
      if (!link || !cardRef.current?.contains(link)) return;
      event.preventDefault();
      const wikilinkTarget = link.getAttribute("data-wikilink");
      if (wikilinkTarget) {
        const resolved = liveRef.current.wikilinks.get(wikilinkTarget);
        if (resolved) {
          const fragment = link.getAttribute("data-wikilink-fragment");
          hide();
          // 与正文链接同一组参数：无片段保持两参调用
          if (fragment === null) onOpenWikilink(resolved, wikilinkTarget);
          else onOpenWikilink(resolved, wikilinkTarget, fragment);
        }
        return;
      }
      const href = link.getAttribute("href") ?? "";
      if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href)) {
        hide();
        void openUrl(href);
      }
      // `#…` 与其余形态：卡内锚点没有意义，拦下后什么都不做
    },
    [onOpenWikilink, hide]
  );

  if (!preview) return null;

  return (
    <div
      ref={cardRef}
      role="tooltip"
      className={
        "hover-preview " +
        (preview.kind === "footnote" ? "hover-preview--footnote" : "hover-preview--note") +
        (pos?.below ? " hover-preview--below" : "")
      }
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      onPointerEnter={() => clearTimers()}
      onPointerLeave={() => {
        // shownAnchorRef 有意不清：离卡回到原锚点时靠它认出「是同一张卡」
        anchorRef.current = null;
        hideTimerRef.current = window.setTimeout(hide, HIDE_GRACE_MS);
      }}
      onClick={
        preview.kind === "footnote"
          ? onFootnoteLinkClick
          : () => {
              hide();
              // 与正文链接同一组参数：无片段保持两参调用
              if (preview.fragment === undefined) {
                onOpenWikilink(preview.resolved, preview.target);
              } else {
                onOpenWikilink(preview.resolved, preview.target, preview.fragment);
              }
            }
      }
    >
      {preview.kind === "footnote" ? (
        <>
          <div className="hover-preview__eyebrow">注 {preview.n}</div>
          <div className="hover-preview__body" ref={bodyRef} />
        </>
      ) : (
        <>
          <div className="hover-preview__title">
            {fileNameToTitle(note?.fileName ?? basename(preview.resolved))}
          </div>
          <div className="hover-preview__path">{preview.resolved}</div>
          <div className="note-preview__body">
            <ReactMarkdown
              remarkPlugins={PREVIEW_PLUGINS}
              skipHtml
              components={PREVIEW_COMPONENTS}
            >
              {noteBody}
            </ReactMarkdown>
          </div>
          <div className="hover-preview__fade" />
        </>
      )}
    </div>
  );
}
