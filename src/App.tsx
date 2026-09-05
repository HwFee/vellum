import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CustomScrollbar } from "./components/CustomScrollbar";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { OutlinePanel } from "./components/OutlinePanel";
import { TopBar } from "./components/TopBar";
import { useIsNarrow } from "./hooks/useIsNarrow";
import { useOutlineOpen } from "./hooks/useOutlineOpen";
import { useOutlineSync } from "./hooks/useOutlineSync";
import { extractOutline } from "./lib/outline";
import { loadLastOpened, saveLastOpened } from "./lib/lastOpened";
import { loadScrollPosition, saveScrollPosition } from "./lib/scrollMemory";
import { captureScrollPosition, restoreScrollPosition } from "./lib/scrollRestore";
import { animateScrollTo, cancelScrollAnimation } from "./lib/smoothScroll";
import { isContainerNearBottom } from "./lib/scrollStick";
import type { MdlogState } from "./lib/mdlogState";
import type { DocumentState, LoadedDocument, OutlineHeading } from "./types";

// 代码分割：react-markdown + rehype/remark + 语法高亮是体积最大的依赖，
// 懒加载后首屏（顶栏/空状态）先行渲染，文档引擎在后台加载。
const MarkdownDocument = lazy(() => import("./components/MarkdownDocument"));

export default function App() {
  const [state, setState] = useState<DocumentState>({ status: "empty" });
  const [reloadTick, setReloadTick] = useState(0);
  const [showReloadNote, setShowReloadNote] = useState(false);
  const [mdlogState, setMdlogState] = useState<MdlogState | null>(null);
  const isMdlogActive = mdlogState !== null;
  const isMdlogActiveRef = useRef(false);
  isMdlogActiveRef.current = isMdlogActive;
  const prevIsMdlogActiveRef = useRef(false);
  const shouldStickToBottomRef = useRef(false);
  const startupLoaded = useRef(false);
  const openRequestSeenRef = useRef(false);
  const drainChainRef = useRef(Promise.resolve());
  const loadRequestRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const documentContentRef = useRef<HTMLDivElement>(null);
  const currentPathRef = useRef<string | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  // 大纲点击跳转的目标标题 id（动画期间锁定，见 handleSelectHeading）
  const outlineNavTargetRef = useRef<string | null>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRestoredPathRef = useRef<string | null>(null);
  // 恢复落位守护的取消函数（切换文档/重复恢复时终止上一段守护）
  const restoreCancelRef = useRef<(() => void) | null>(null);
  // headings 供事件回调读取最新值（滚动保存等 effect 只注册一次，避免闭包过期）
  const headingsRef = useRef<OutlineHeading[]>([]);
  const [isOutlineOpen, toggleOutline, setIsOutlineOpen] = useOutlineOpen(true);
  const isNarrow = useIsNarrow();

  // ===== 搜索状态 =====
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 搜索词延迟传给文档渲染层：输入框即时响应，大文档的高亮重解析
  // 以低优先级在后台进行（MarkdownDocument 已 memo， deferred 值不变时整体跳过渲染）
  const deferredSearchQuery = useDeferredValue(searchQuery);
  // urgent 渲染期间 deferred 值尚未跟进：此时 activeMatchIndex 已被重置为 0，
  // MarkdownDocument 凭此标记知道「索引重置是输入的副产物」，不触发滚动
  const searchQueryPending = searchQuery !== deferredSearchQuery;

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setActiveMatchIndex(0);
  }, []);

  const handleNextMatch = useCallback(() => {
    setActiveMatchIndex((prev) => (matchCount > 0 ? (prev + 1) % matchCount : 0));
  }, [matchCount]);

  const handlePrevMatch = useCallback(() => {
    setActiveMatchIndex((prev) => (matchCount > 0 ? (prev - 1 + matchCount) % matchCount : 0));
  }, [matchCount]);

  const handleMatchCountChange = useCallback((count: number) => {
    setMatchCount(count);
  }, []);

  // ⌘K / Ctrl+K 聚焦搜索框
  useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        if (!isOutlineOpen) {
          setIsOutlineOpen(true);
        }
        // 等侧栏展开后再聚焦
        setTimeout(() => searchInputRef.current?.focus(), 60);
      }
    }
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [isOutlineOpen, setIsOutlineOpen]);

  /** 把当前滚动位置（锚点 + 偏移 + 比例兜底）写入持久化存储 */
  function persistCurrentScroll() {
    const path = currentPathRef.current;
    const container = scrollRef.current;
    if (!path || !container) return;
    void saveScrollPosition(path, captureScrollPosition(container, headingsRef.current));
  }

  async function loadPath(path: string) {
    shouldStickToBottomRef.current = false;
    // 切换文档前先保存上一篇的阅读位置
    persistCurrentScroll();
    // 终止上一篇文档可能仍在进行的恢复落位守护
    restoreCancelRef.current?.();
    restoreCancelRef.current = null;
    // 连续打开文件时只有最新一次请求允许写回状态，避免慢响应覆盖新文档
    const requestId = ++loadRequestRef.current;
    setShowReloadNote(false);
    // 首次加载（尚无文档展示）跳过中间「加载中...」帧，直接 empty → ready，
    // 少一次无意义渲染；切换文档时保留 loading 态作为反馈。
    if (currentPathRef.current !== null) {
      setState({ status: "loading" });
    }
    try {
      const document = await invoke<LoadedDocument>("load_document", { path });
      if (loadRequestRef.current !== requestId) return;
      currentPathRef.current = document.path;
      setState({ status: "ready", document });
      void saveLastOpened(document.path);

      try {
        const liveState = await invoke<MdlogState | null>("read_mdlog_state");
        if (loadRequestRef.current === requestId) {
          setMdlogState(liveState);
        }
      } catch {
        if (loadRequestRef.current === requestId) {
          setMdlogState(null);
        }
      }
    } catch (error) {
      if (loadRequestRef.current !== requestId) return;
      setState({ status: "error", message: String(error), path });
    }
  }

  /// 热重载：静默重新读取当前文档，不闪烁 loading 态、不弹错误、保留滚动位置。
  async function reloadCurrent() {
    const path = currentPathRef.current;
    if (!path) return;
    const requestId = ++loadRequestRef.current;
    try {
      const document = await invoke<LoadedDocument>("load_document", { path });
      if (loadRequestRef.current !== requestId) return;
      const container = scrollRef.current;
      shouldStickToBottomRef.current = container
        ? isContainerNearBottom(container, 80)
        : false;
      pendingScrollRef.current = container ? container.scrollTop : 0;
      currentPathRef.current = document.path;
      setState({ status: "ready", document });
      setReloadTick((tick) => tick + 1);
      if (!isMdlogActiveRef.current) {
        setShowReloadNote(true);
      }
    } catch {
      // 重载失败时保留旧内容，不打扰用户
    }
  }

  async function handleOpen() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });

      if (typeof selected === "string") {
        await loadPath(selected);
      }
    } catch (error) {
      setState({ status: "error", message: String(error) });
    }
  }

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let shown = false;

    async function revealWindow() {
      if (shown || cancelled) return;
      shown = true;
      try {
        await getCurrentWindow().show();
      } catch {
        // 非关键路径：窗口可能已经可见
      }
    }

    function drainPendingPaths() {
      drainChainRef.current = drainChainRef.current.catch(() => {}).then(async () => {
        const paths = await invoke<string[]>("drain_pending_open_paths");
        const latestPath = paths[paths.length - 1];
        if (latestPath) {
          openRequestSeenRef.current = true;
          startupLoaded.current = true;
          await loadPath(latestPath);
        }
      });
      return drainChainRef.current;
    }

    async function bindStartup() {
      // 先监听再 drain；通知若先到，只会追加一次串行 drain，路径不会因竞态丢失。
      const unlistenFn = await listen("pending-open-paths", () => {
        void drainPendingPaths();
      });
      if (cancelled) {
        unlistenFn();
        return;
      }
      unlisten = unlistenFn;

      await drainPendingPaths();
      if (!openRequestSeenRef.current && !startupLoaded.current) {
        startupLoaded.current = true;
        const lastPath = await loadLastOpened();
        if (lastPath && !openRequestSeenRef.current) {
          await loadPath(lastPath);
        }
      }
      // 等待 React 将 loadPath 的状态更新提交到 DOM，避免窗口先显示空状态再闪现文档
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await revealWindow();
    }

    void bindStartup().catch(async (error) => {
      if (!cancelled) {
        setState({ status: "error", message: String(error) });
      }
      // 同样等待 React 提交错误状态到 DOM 再显示窗口
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await revealWindow();
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 监听后端文件变更事件，触发静默热重载
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function bindReload() {
      const unlistenFn = await listen("file-changed", () => {
        void reloadCurrent();
      });
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    }

    void bindReload();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const activeDocument = state.status === "ready" ? state.document : undefined;

  // 切换文档时恢复上次阅读位置（无记录则回到顶部）。
  // 恢复时机放在 MarkdownDocument 内容渲染进 DOM 之后（onRendered），而非 state 变 ready 时：
  // 因为 MarkdownDocument 是懒加载，state ready 时正文 chunk 可能尚未加载、未进 DOM，
  // 此时 scrollHeight 不可用，会导致恢复位置计算为 0。用 lastRestoredPathRef 记录已恢复的
  // 路径，仅在切换到新文档时恢复；同文档的热重载/重渲染不处理（由 pendingScrollRef 负责）。
  // 恢复走锚点优先（restoreScrollPosition）：标题被删则落到最近幸存标题附近；
  // 恢复后图片/字体加载会撑大 scrollHeight 导致落点漂移（间歇性恢复失败的根因），
  // 由落位守护在布局稳定前持续重新锚定。
  const handleContentRendered = useCallback(() => {
    const container = scrollRef.current;
    const path = currentPathRef.current;
    if (!container || !path) return;
    if (lastRestoredPathRef.current === path) return;
    lastRestoredPathRef.current = path;
    // 先归零，避免沿用上一篇文档的滚动位置
    container.scrollTop = 0;
    void loadScrollPosition(path).then((record) => {
      if (record === null) return;
      // 异步期间可能已切换到别的文档，作废本次恢复
      if (currentPathRef.current !== path) return;
      const content = contentRef.current;
      if (!content) return;
      restoreCancelRef.current?.();
      restoreCancelRef.current = restoreScrollPosition(
        container,
        content,
        record,
        headingsRef.current
      );
    });
  }, []);

  // 程序化滚动动画（恢复位置/大纲跳转/搜索跳转）期间用户主动滚动/按键，
  // 立即取消动画让出控制权
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const cancelRestore = () => cancelScrollAnimation(container);
    container.addEventListener("wheel", cancelRestore, { passive: true });
    container.addEventListener("touchstart", cancelRestore, { passive: true });
    window.addEventListener("keydown", cancelRestore);
    return () => {
      container.removeEventListener("wheel", cancelRestore);
      container.removeEventListener("touchstart", cancelRestore);
      window.removeEventListener("keydown", cancelRestore);
    };
  }, []);

  // 滚动时防抖记录阅读位置，窗口关闭前再兜底保存一次
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isMdlogActiveRef.current) return;
      if (scrollSaveTimerRef.current !== null) {
        clearTimeout(scrollSaveTimerRef.current);
      }
      scrollSaveTimerRef.current = setTimeout(() => {
        scrollSaveTimerRef.current = null;
        persistCurrentScroll();
      }, 300);
    };

    const handleUnload = () => persistCurrentScroll();

    container.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      window.removeEventListener("beforeunload", handleUnload);
      if (scrollSaveTimerRef.current !== null) {
        clearTimeout(scrollSaveTimerRef.current);
        scrollSaveTimerRef.current = null;
      }
    };
  }, []);

  // 热重载滚动仲裁：贴底跟随优先，非贴底保留原有滚动位置
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (shouldStickToBottomRef.current) {
      shouldStickToBottomRef.current = false;
      pendingScrollRef.current = null;
      container.scrollTop = container.scrollHeight;

      const content = contentRef.current;
      if (content) {
        restoreCancelRef.current?.();
        restoreCancelRef.current = restoreScrollPosition(
          container,
          content,
          { ratio: 1 },
          headingsRef.current
        );
      }
      return;
    }

    if (pendingScrollRef.current !== null) {
      container.scrollTop = pendingScrollRef.current;
      pendingScrollRef.current = null;
    }
  }, [activeDocument?.markdown]);

  // 热重载提示：正文做一次由虚而实的"落墨"；宽窗口的页边批注在动画结束后卸载
  useEffect(() => {
    if (reloadTick === 0 || isMdlogActiveRef.current) return;
    const el = documentContentRef.current;
    if (el) {
      el.classList.remove("fresh-ink");
      void el.offsetWidth;
      el.classList.add("fresh-ink");
    }
    const timer = setTimeout(() => setShowReloadNote(false), 2800);
    return () => clearTimeout(timer);
  }, [reloadTick]);

  // mdlog 活跃记录态与状态监听
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function checkState() {
      if (!currentPathRef.current) return;
      try {
        const liveState = await invoke<MdlogState | null>("read_mdlog_state");
        if (!cancelled) {
          setMdlogState(liveState);
        }
      } catch {
        if (!cancelled) {
          setMdlogState(null);
        }
      }
    }

    async function bindState() {
      const unlistenFn = await listen("mdlog-state-changed", () => {
        void checkState();
      });
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    }

    void bindState();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // 记录态断开时集中补写一次阅读位置
  useEffect(() => {
    if (prevIsMdlogActiveRef.current && !isMdlogActive) {
      persistCurrentScroll();
    }
    prevIsMdlogActiveRef.current = isMdlogActive;
  }, [isMdlogActive]);

  // 窄屏下按 Escape 关闭大纲面板
  useEffect(() => {
    if (!isNarrow || !isOutlineOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOutlineOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isNarrow, isOutlineOpen, setIsOutlineOpen]);

  const headings = useMemo(
    () => (activeDocument ? extractOutline(activeDocument.markdown) : []),
    [activeDocument?.markdown]
  );
  headingsRef.current = headings;
  const activeHeadingId = useOutlineSync(scrollRef, headings, outlineNavTargetRef);

  const handleSelectHeading = (id: string) => {
    const element = document.getElementById(id);
    const container = scrollRef.current;
    if (element && container) {
      // 与恢复位置同一套缓动动画；用户滚动/按键会经上面的监听取消动画，
      // 避免原生 smooth 滚动与用户输入互相拉扯导致的闪动
      const target =
        container.scrollTop +
        element.getBoundingClientRect().top -
        container.getBoundingClientRect().top;
      // 动画期间锁定 activeHeadingId 为点击目标：否则正文途经的中间标题会让大纲
      // 跟随动画先滚去中间位置、到位后再折返（先上后下的跳动）。动画自然结束或
      // 被用户滚动/按键打断时解除锁定，恢复正常跟随。
      if (Math.abs(target - container.scrollTop) >= 1) {
        animateScrollTo(container, target, () => {
          outlineNavTargetRef.current = null;
        });
        outlineNavTargetRef.current = id;
      }
    }
    if (isNarrow) {
      setIsOutlineOpen(false);
    }
  };

  return (
    <main className="app-shell">
      <TopBar
        fileName={activeDocument?.fileName}
        parentPath={activeDocument?.parentPath}
        onOpen={handleOpen}
        isOutlineOpen={isOutlineOpen}
        onToggleOutline={toggleOutline}
      />
      <div className={`app-shell__body ${isOutlineOpen ? "app-shell__body--outline-open" : ""}`}>
        {/* 热重载提示（二）：印章，悬浮于窗口中下方、不随文档滚动；key 变化即重播 */}
        {showReloadNote && (
          <div key={reloadTick} className="reload-note" role="status">
            墨迹未干
          </div>
        )}
        <aside className={`outline-sidebar ${isOutlineOpen ? "outline-sidebar--open" : ""}`}>
          <OutlinePanel
            headings={headings}
            activeHeadingId={activeHeadingId}
            onSelectHeading={handleSelectHeading}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            matchCount={matchCount}
            activeMatchIndex={activeMatchIndex}
            onNextMatch={handleNextMatch}
            onPrevMatch={handlePrevMatch}
            searchInputRef={searchInputRef}
          />
        </aside>
        <div ref={scrollRef} className="document-scroll" tabIndex={0}>
          <div ref={contentRef} className="document-scroll__content">
            <div ref={documentContentRef} className="document-content">
              {state.status === "empty" ? <EmptyState onOpen={handleOpen} /> : null}
              {state.status === "loading" ? (
                <section className="empty-state" role="status">
                  加载中...
                </section>
              ) : null}
              {state.status === "error" ? <ErrorState message={state.message} path={state.path} /> : null}
              {state.status === "ready" ? (
                <Suspense fallback={null}>
                  <MarkdownDocument
                    markdown={state.document.markdown}
                    headings={headings}
                    onRendered={handleContentRendered}
                    searchQuery={deferredSearchQuery}
                    searchQueryPending={searchQueryPending}
                    activeMatchIndex={activeMatchIndex}
                    onMatchCountChange={handleMatchCountChange}
                  />
                </Suspense>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <CustomScrollbar containerRef={scrollRef} contentRef={contentRef} />
      {isOutlineOpen && isNarrow && (
        <div className="outline-scrim" role="presentation" onClick={() => setIsOutlineOpen(false)} />
      )}
    </main>
  );
}
