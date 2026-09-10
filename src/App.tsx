import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BlockEditor } from "./components/BlockEditor";
import { CustomScrollbar } from "./components/CustomScrollbar";
import { EmptyState } from "./components/EmptyState";
import { ErrorState } from "./components/ErrorState";
import { JumpToBottom } from "./components/JumpToBottom";
import { OutlinePanel } from "./components/OutlinePanel";
import { TopBar } from "./components/TopBar";
import { useDocumentEditor } from "./hooks/useDocumentEditor";
import { useIsNarrow } from "./hooks/useIsNarrow";
import { useOutlineOpen } from "./hooks/useOutlineOpen";
import { useOutlineSync } from "./hooks/useOutlineSync";
import { OUTLINE_WIDTH_DEFAULT, useOutlineWidth } from "./hooks/useOutlineWidth";
import { extractOutline } from "./lib/outline";
import { isSamePath } from "./lib/path";
import { loadLastOpened, saveLastOpened } from "./lib/lastOpened";
import { loadScrollPosition, saveScrollPosition } from "./lib/scrollMemory";
import { captureScrollPosition, restoreScrollPosition } from "./lib/scrollRestore";
import { captureViewportAnchor, restoreViewportAnchor, type ViewportAnchor } from "./lib/viewportAnchor";
import { animateScrollTo, cancelScrollAnimation } from "./lib/smoothScroll";
import { isContainerNearBottom } from "./lib/scrollStick";
import { computeRecheckDelay, type MdlogState } from "./lib/mdlogState";
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
  const activeMdlogPathRef = useRef<string | null>(null);
  const recheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldStickToBottomRef = useRef(false);
  const hasStuckToBottomRef = useRef(false);
  const startupLoaded = useRef(false);
  const openRequestSeenRef = useRef(false);
  const drainChainRef = useRef(Promise.resolve());
  const loadRequestRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const documentContentRef = useRef<HTMLDivElement>(null);
  const currentPathRef = useRef<string | null>(null);
  // 最近一次我方写入的内容（LF 归一）：file-changed 回声据此比对（规格 §7.2）
  const lastSavedMarkdownRef = useRef<string | null>(null);
  // 编辑会话（在 activeDocument 之后创建）：回调与 effect 经此读到最新一份，
  // 既避免闭包过期，也让传给 memo 化 MarkdownDocument 的回调保持引用稳定
  const editorRef = useRef<ReturnType<typeof useDocumentEditor> | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  // 热重载视口锚点：重载前记录的视口首个可见块元素及其相对偏移，
  // 渲染提交后按元素新位置补偿 scrollTop（内容不动），元素丢失时退回 pendingScrollRef 像素兜底
  const pendingAnchorRef = useRef<ViewportAnchor | null>(null);
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
  const [outlineWidth, setOutlineWidth] = useOutlineWidth();
  const outlineWidthRef = useRef(outlineWidth);
  outlineWidthRef.current = outlineWidth;
  // 布局过渡窗：侧边栏开关动画 / 拖宽期间，所有 widget iframe 随容器宽度集体重排，
  // 若恰逢 mdlog 追加触发的热重载（整篇重解析），主线程被「过渡重排 + 解析提交」
  // 双重工作饱和——页面完全卡死、过一会儿自愈（mdlog 连接中开关侧边栏卡死的根因）。
  // 窗内：热重载延迟合并提交、程序化滚动恢复让位原生 scroll anchoring、iframe 高度
  // 过渡关闭（消除 200ms 过渡的重排级联与子帧可滚动余量）。
  const layoutShiftUntilRef = useRef(0);
  const layoutShiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reloadDeferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isLayoutShifting, setIsLayoutShifting] = useState(false);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  // 最近一次用户滚动输入（滚轮/触摸/按键/滚动条拖拽）时间戳：热重载恢复据此避让
  const lastUserScrollAtRef = useRef(0);

  /** 进入/延长布局过渡窗；windowMs 后自动退出（连续调用续窗） */
  const noteLayoutShift = useCallback((windowMs = 450) => {
    const until = performance.now() + windowMs;
    if (until > layoutShiftUntilRef.current) {
      layoutShiftUntilRef.current = until;
    }
    setIsLayoutShifting(true);
    if (layoutShiftTimerRef.current !== null) {
      clearTimeout(layoutShiftTimerRef.current);
    }
    layoutShiftTimerRef.current = setTimeout(() => {
      layoutShiftTimerRef.current = null;
      setIsLayoutShifting(false);
    }, layoutShiftUntilRef.current - performance.now());
  }, []);

  // 组件卸载时注销尚未完成的落位守护
  useEffect(() => () => restoreCancelRef.current?.(), []);

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

  // 全局快捷键：⌘K / Ctrl+K 聚焦搜索框，Ctrl+E 切换编辑视图，Ctrl+S 提交当前块。
  // 依赖里只有侧栏开关（其余经 editorRef/callback ref 读取），热重载与每次按键都不重新订阅。
  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();

      // Ctrl+S（裁定 F6）：阅读视图下也必须吞掉 WebView 自带的「保存网页」默认行为；
      // 无活动块时 commitActive 为 no-op
      if (key === "s") {
        event.preventDefault();
        void editorRef.current?.commitActive();
        return;
      }

      if (key === "e") {
        event.preventDefault();
        void editorRef.current?.toggleView();
        return;
      }

      if (key === "k") {
        event.preventDefault();
        if (!isOutlineOpen) {
          setIsOutlineOpen(true);
        }
        // 等侧栏展开后再聚焦
        setTimeout(() => searchInputRef.current?.focus(), 60);
      }
    }
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, [isOutlineOpen, setIsOutlineOpen]);

  const scheduleRecheck = useCallback((liveState: MdlogState | null) => {
    if (recheckTimerRef.current !== null) {
      clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
    if (!liveState) return;

    const delay = computeRecheckDelay(liveState.expiresAt);
    recheckTimerRef.current = setTimeout(async () => {
      recheckTimerRef.current = null;
      if (!currentPathRef.current) return;
      const expectedPath = currentPathRef.current;
      try {
        const latestState = await invoke<MdlogState | null>("read_mdlog_state");
        if (currentPathRef.current !== expectedPath) return;
        // 防御：后端异常/反序列化抖动可能给出 undefined，?? 归一为 null——
        // undefined !== null 会被 isMdlogActive 误判为记录中，静默禁用吸底、
        // 热重载印章与阅读位置记忆
        setMdlogState(latestState ?? null);
        if (latestState != null) {
          activeMdlogPathRef.current = expectedPath;
        }
        scheduleRecheck(latestState ?? null);
      } catch {
        if (currentPathRef.current !== expectedPath) return;
        setMdlogState(null);
      }
    }, delay);
  }, []);

  /** 把当前滚动位置（锚点 + 偏移 + 比例兜底）写入持久化存储 */
  function persistCurrentScroll() {
    const path = currentPathRef.current;
    const container = scrollRef.current;
    if (!path || !container) return;
    void saveScrollPosition(
      path,
      captureScrollPosition(container, headingsRef.current, contentRef.current ?? undefined)
    );
  }

  async function loadPath(path: string) {
    // 切换文档前先提交活动块（规格 §6.3）：经 OS 关联/第二实例深链切文档时没有失焦事件，
    // 不先提交就会把上一篇的草稿按「同序号块」拼进新文档（写到错的文件里）。
    // 提交口失败时 hook 会保留草稿与活动块，此处只是尽力提交。
    await editorRef.current?.commitActive();
    // 同路径重新打开（第二实例深链 drain_pending_open_paths 命中当前文档，或用户再次
    // 选中同一文件）：绝不能走 loading 帧——ready 分支整体卸载会销毁所有 widget iframe
    // 并丢失正在进行的交互状态。改走静默热重载（reloadCurrent 内部复用当前路径，
    // 保留滚动位置并以 reloadTick 驱动落墨/贴底仲裁）。
    if (isSamePath(path, currentPathRef.current)) {
      await reloadCurrent();
      return;
    }
    // 切换文档前先保存上一篇的阅读位置
    persistCurrentScroll();
    // 切换文档时重置 mdlog 活跃路径与前置标志，避免切换过渡时误触发断开补写
    prevIsMdlogActiveRef.current = false;
    activeMdlogPathRef.current = null;
    // 终止上一篇文档可能仍在进行的恢复落位守护
    restoreCancelRef.current?.();
    restoreCancelRef.current = null;
    if (recheckTimerRef.current !== null) {
      clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
    // 挂起的延迟热重载随文档切换作废（切走后应重读的是新文档，由下方加载负责）
    if (reloadDeferTimerRef.current !== null) {
      clearTimeout(reloadDeferTimerRef.current);
      reloadDeferTimerRef.current = null;
    }
    setMdlogState(null);
    shouldStickToBottomRef.current = false;
    hasStuckToBottomRef.current = false;
    pendingAnchorRef.current = null;
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
          setMdlogState(liveState ?? null);
          if (liveState != null) {
            activeMdlogPathRef.current = document.path;
          }
          scheduleRecheck(liveState ?? null);
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
  /// preloaded：调用方已读到的磁盘内容（回声抑制的预读），避免同一事件读盘两次
  async function reloadCurrent(preloaded?: LoadedDocument) {
    const path = currentPathRef.current;
    if (!path) return;
    // 布局过渡窗内延迟合并提交：窗内多次追加只保留最后一次重载，
    // 避免整篇重解析与侧边栏过渡/widget 集体重排争抢主线程
    const shiftRemaining = layoutShiftUntilRef.current - performance.now();
    if (shiftRemaining > 0) {
      if (reloadDeferTimerRef.current !== null) return;
      reloadDeferTimerRef.current = setTimeout(() => {
        reloadDeferTimerRef.current = null;
        void reloadCurrent();
      }, shiftRemaining);
      return;
    }
    const requestId = ++loadRequestRef.current;
    try {
      const document = preloaded ?? (await invoke<LoadedDocument>("load_document", { path }));
      if (loadRequestRef.current !== requestId) return;
      const container = scrollRef.current;
      // mdlog 记录期间模型每次追加都会触发热重载：禁止吸底跟随，
      // 用户停在哪儿就保持在哪儿（追加只在文档末尾，不影响当前阅读位置）
      shouldStickToBottomRef.current =
        !isMdlogActiveRef.current && container
          ? isContainerNearBottom(container, 80)
          : false;
      pendingScrollRef.current = container ? container.scrollTop : 0;
      pendingAnchorRef.current =
        container && contentRef.current
          ? captureViewportAnchor(container, contentRef.current)
          : null;
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
    let unlistenClose: (() => void) | undefined;
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

      // 关窗前先提交活动块（规格 §6.3）：有未提交草稿时拦下本次关闭，提交完成后再关；
      // 无活动块则放行原生关闭。经 editorRef 读最新会话，避免闭包过期
      const closeUnlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        const current = editorRef.current;
        if (!current || !current.activeUnit) return;
        event.preventDefault();
        await current.commitActive();
        void getCurrentWindow().close();
      });
      if (cancelled) {
        closeUnlisten();
      } else {
        unlistenClose = closeUnlisten;
      }

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
      unlistenClose?.();
    };
  }, []);

  // 监听后端文件变更事件：先分流「我方写入回声 / 外部变更」，再决定是否热重载
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    /// 外部变更分流（规格 §7.2）：file-changed 到达时先读盘，并与「最近一次我方写入」
    /// 按归一 EOL 比对——相等即自己的回声，整体忽略（不更新状态、不递增 reloadTick、
    /// 不闪印章、不做滚动补偿）；不等则属外部变更，中断当前编辑后走既有热重载路径。
    /// 经 editorRef 读最新会话：否则首次渲染的闭包会把中断当成无事发生（M11）。
    async function reloadIfExternal() {
      const path = currentPathRef.current;
      if (!path) return;
      try {
        const latest = await invoke<LoadedDocument>("load_document", { path });
        // 预读期间可能已切换文档/卸载：作废本次分流
        if (cancelled || currentPathRef.current !== path) return;
        const normalized = latest.markdown.replace(/\r\n/g, "\n");
        if (lastSavedMarkdownRef.current !== null && normalized === lastSavedMarkdownRef.current) {
          return; // 自己的写入回声：整体忽略
        }
        editorRef.current?.notifyInterrupted("文件已被外部修改 · 编辑已取消");
        await reloadCurrent(latest);
      } catch {
        // 读失败：保留旧内容
      }
    }

    async function bindReload() {
      const unlistenFn = await listen("file-changed", () => {
        void reloadIfExternal();
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

  /// 文档 markdown 的唯一写入点：提交新内容与失败回退都经此，保持引用稳定
  const applyMarkdown = useCallback((next: string) => {
    setState((previous) =>
      previous.status === "ready"
        ? { ...previous, document: { ...previous.document, markdown: next } }
        : previous
    );
  }, []);

  /// 落盘（提交即落盘，规格 §7.1）：写成功后记录本次内容，作为 watcher 回声的比对基准。
  /// 比对按 LF 归一口径（规格 §7.2），故记录前先归一 —— 否则 CRLF 文档下自己的回声
  /// 永远匹配不上，每次提交都会白闪一次「墨迹未干」并触发整篇重读。
  const saveMarkdown = useCallback(async (next: string) => {
    const path = currentPathRef.current;
    if (!path) throw new Error("No document is loaded");
    await invoke("save_document", { path, content: next });
    lastSavedMarkdownRef.current = next.replace(/\r\n/g, "\n");
  }, []);

  const editor = useDocumentEditor({
    markdown: activeDocument?.markdown ?? "",
    mdlogActive: isMdlogActive,
    onMarkdownChange: applyMarkdown,
    save: saveMarkdown,
  });
  editorRef.current = editor;

  // 传给 memo 化 MarkdownDocument 的回调必须引用稳定（性能结构约束）：
  // 用空依赖 + editorRef 读最新会话，避免每次按键/每次状态变化都换新引用
  const handleActivateUnit = useCallback((index: number, caretOffset: number) => {
    editorRef.current?.activateUnit(index, caretOffset);
  }, []);

  const handleToggleEdit = useCallback(() => {
    void editorRef.current?.toggleView();
  }, []);

  const handleLockedUnitClick = useCallback((reason: "html" | "widget") => {
    editorRef.current?.notifyLocked(reason);
  }, []);

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
      // P6: 异步恢复前检查是否已发生贴底仲裁（已贴底则跳过记忆恢复），消除「先掉底再弹回」抖动
      if (hasStuckToBottomRef.current || shouldStickToBottomRef.current) return;
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

  // 程序化滚动动画（恢复位置/大纲跳转/搜索跳转/跳底）期间用户主动滚动/按键，
  // 立即取消动画让出控制权；同时记下输入时间戳，热重载恢复据此避让 300ms——
  // 否则重载提交瞬间会把用户刚滚出去的距离当作「漂移」拽回（卡死/回弹观感）
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onUserScrollInput = () => {
      lastUserScrollAtRef.current = performance.now();
      cancelScrollAnimation(container);
    };
    container.addEventListener("wheel", onUserScrollInput, { passive: true });
    container.addEventListener("touchstart", onUserScrollInput, { passive: true });
    // 拖 thumb 直写 scrollTop 不产生原生输入事件，由 CustomScrollbar 派发此事件
    container.addEventListener("vellum:scrollbar-drag", onUserScrollInput);
    window.addEventListener("keydown", onUserScrollInput);
    return () => {
      container.removeEventListener("wheel", onUserScrollInput);
      container.removeEventListener("touchstart", onUserScrollInput);
      container.removeEventListener("vellum:scrollbar-drag", onUserScrollInput);
      window.removeEventListener("keydown", onUserScrollInput);
    };
  }, []);

  // 滚动时防抖记录阅读位置，窗口关闭前再兜底保存一次。
  // mdlog 记录期间同样持续保存：块索引锚点对末尾追加稳定，持续保存使
  // 「pi 被强杀 + Vellum 被强关（无 beforeunload）」后仍能恢复到 300ms 内的位置
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
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

    // 用户刚输入过滚动（300ms 内）或仍处布局过渡窗：位置交给用户与原生
    // scroll anchoring。此时程序化恢复会把窗内/输入产生的滚动增量当作漂移拽回，
    // 叠加过渡期的连续重排便是「mdlog 连接中开关侧边栏后页面卡死」的观感来源
    const userScrollActive = performance.now() - lastUserScrollAtRef.current < 300;
    const layoutShifting = performance.now() < layoutShiftUntilRef.current;
    if (userScrollActive || layoutShifting) {
      shouldStickToBottomRef.current = false;
      pendingScrollRef.current = null;
      pendingAnchorRef.current = null;
      return;
    }

    if (shouldStickToBottomRef.current) {
      shouldStickToBottomRef.current = false;
      hasStuckToBottomRef.current = true;
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

    // 锚点优先：视口上方内容在重载中发生同步高度变化（流式代码块收合成
    // widget、图片声明尺寸等）时按锚点元素恢复「内容不动」，而非恢复旧像素值——
    // 旧像素在新布局下对应另一处内容，且程序化像素覆盖会顶掉 Chromium 原生
    // 滚动锚定对异步高度变化（iframe 加载后上报真实高度等）的补偿。
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (anchor && restoreViewportAnchor(container, anchor)) {
      pendingScrollRef.current = null;
      return;
    }

    if (pendingScrollRef.current !== null) {
      container.scrollTop = pendingScrollRef.current;
      pendingScrollRef.current = null;
    }
  }, [activeDocument?.markdown, reloadTick]);

  // 热重载提示：正文做一次由虚而实的"落墨"；宽窗口的页边批注在动画结束后卸载
  useEffect(() => {
    if (reloadTick === 0) return;
    if (isMdlogActiveRef.current) {
      setShowReloadNote(false);
      return;
    }
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
      const expectedPath = currentPathRef.current;
      try {
        const liveState = await invoke<MdlogState | null>("read_mdlog_state");
        if (cancelled || currentPathRef.current !== expectedPath) return;
        setMdlogState(liveState ?? null);
        if (liveState != null) {
          activeMdlogPathRef.current = expectedPath;
        }
        scheduleRecheck(liveState ?? null);
      } catch {
        if (cancelled || currentPathRef.current !== expectedPath) return;
        setMdlogState(null);
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
      if (recheckTimerRef.current !== null) {
        clearTimeout(recheckTimerRef.current);
        recheckTimerRef.current = null;
      }
    };
  }, [scheduleRecheck]);

  // mdlog 连接状态迁移的集中处理：
  // 连接建立瞬间立即记录当前阅读位置——此后即使 pi 进程被强杀、Vellum 被强关
  //（beforeunload 来不及跑），下次打开也能回到连接前的位置；断开时再集中补写一次
  useEffect(() => {
    if (isMdlogActive && !prevIsMdlogActiveRef.current) {
      persistCurrentScroll();
    }
    if (prevIsMdlogActiveRef.current && !isMdlogActive) {
      if (activeMdlogPathRef.current && activeMdlogPathRef.current === currentPathRef.current) {
        persistCurrentScroll();
      }
      activeMdlogPathRef.current = null;
    }
    prevIsMdlogActiveRef.current = isMdlogActive;
  }, [isMdlogActive]);

  // mdlog 记录变活跃 ⇒ 编辑门禁全关（规格 §6.4）：先中断当前块编辑（草稿尽力写入剪贴板），
  // 再退回阅读视图。经 editorRef 读最新会话，effect 只随门禁边沿触发
  useEffect(() => {
    if (!isMdlogActive) return;
    const current = editorRef.current;
    if (!current) return;
    current.notifyInterrupted("记录已开始 · 编辑已取消");
    if (current.viewMode === "editing") {
      void current.toggleView();
    }
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

  // 侧边栏拖宽：右缘手柄按下后全局跟踪指针，即时覆写宽度并持续续布局过渡窗；
  // 拖拽期间正文 margin 与 widget 高度过渡均关闭（app-shell--sidebar-resizing），
  // 避免 margin 动画滞后于指针、iframe 过渡级联重排
  const handleSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = outlineWidthRef.current;
    setIsSidebarResizing(true);
    noteLayoutShift(300);

    const onMove = (moveEvent: PointerEvent) => {
      setOutlineWidth(startWidth + (moveEvent.clientX - startX));
      noteLayoutShift(300);
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setIsSidebarResizing(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

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
    <main
      className={
        "app-shell" +
        (isLayoutShifting ? " app-shell--layout-shifting" : "") +
        (isSidebarResizing ? " app-shell--sidebar-resizing" : "")
      }
    >
      <TopBar
        fileName={activeDocument?.fileName}
        parentPath={activeDocument?.parentPath}
        onOpen={handleOpen}
        isOutlineOpen={isOutlineOpen}
        onToggleOutline={toggleOutline}
        isEditing={editor.viewMode === "editing"}
        canEdit={!isMdlogActive}
        onToggleEdit={handleToggleEdit}
      />
      <div className={`app-shell__body ${isOutlineOpen ? "app-shell__body--outline-open" : ""}`}>
        {/* 热重载提示（二）：印章，悬浮于窗口中下方、不随文档滚动；key 变化即重播 */}
        {showReloadNote && (
          <div key={reloadTick} className="reload-note" role="status">
            墨迹未干
          </div>
        )}
        {/* 编辑提示条（HTML/交互块只读、记录中禁用、保存失败）：与「墨迹未干」同一视觉语言，
            由 App 层统一渲染 —— 不放进 memo 化的解析层，避免把提示状态带进正文渲染 */}
        {editor.toast ? (
          <div key={editor.toast.id} className="editor-toast" role="status">
            {editor.toast.message}
          </div>
        ) : null}
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
        {/* 侧边栏宽度手柄：骑跨侧栏右缘边线（aside overflow:hidden，须作兄弟节点外置），
            拖拽调宽 200–320px，双击复位默认宽度 */}
        {isOutlineOpen && (
          <div
            className="outline-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="调节侧边栏宽度"
            title="拖动调节宽度 · 双击复位"
            onPointerDown={handleSidebarResizeStart}
            onDoubleClick={() => setOutlineWidth(OUTLINE_WIDTH_DEFAULT)}
          />
        )}
        <div ref={scrollRef} className="document-scroll" tabIndex={0}>
          <div
            ref={contentRef}
            className={
              "document-scroll__content" +
              (editor.viewMode === "editing" ? " document-scroll__content--editing" : "")
            }
          >
            <div ref={documentContentRef} className="document-content">
              {state.status === "empty" ? <EmptyState onOpen={handleOpen} /> : null}
              {state.status === "loading" ? (
                <section className="empty-state" role="status">
                  加载中...
                </section>
              ) : null}
              {state.status === "error" ? <ErrorState message={state.message} path={state.path} /> : null}
              {state.status === "ready" ? (
                <>
                  <Suspense fallback={null}>
                    <MarkdownDocument
                      markdown={state.document.markdown}
                      headings={headings}
                      onRendered={handleContentRendered}
                      searchQuery={deferredSearchQuery}
                      searchQueryPending={searchQueryPending}
                      activeMatchIndex={activeMatchIndex}
                      onMatchCountChange={handleMatchCountChange}
                      editable={editor.viewMode === "editing"}
                      onActivateUnit={handleActivateUnit}
                      onLockedUnitClick={handleLockedUnitClick}
                    />
                  </Suspense>
                  {mdlogState !== null && (
                    <div className="mdlog-live">记录中 · PI</div>
                  )}
                </>
              ) : null}
            </div>
            {/* 就地编辑覆盖层：必须是 .document-scroll__content 的直接子元素（T3 的定位基准），
                且与正文同级并列 —— 不放进 .markdown-body，避开其 textarea 规则的样式覆盖（裁定 F23）。
                覆盖层与编辑态类名同一门槛（视图标志 + 活动块）：落盘失败后 toggleView 仍会退回阅读
                视图（T4 未修 I3），但活动块已重新激活且草稿保留 —— 此时不能留下无标记可依的孤悬
                覆盖层（units 为空、定位基准缺失），草稿由再按 Ctrl+E 原样带回 */}
            {editor.viewMode === "editing" && editor.activeUnit ? (
              <BlockEditor
                unitIndex={editor.activeUnit.index}
                value={editor.draft}
                initialCaret={editor.initialCaret}
                onChange={editor.updateDraft}
                onCommit={() => void editor.commitActive()}
                onCancel={() => void editor.commitActive()}
              />
            ) : null}
          </div>
        </div>
      </div>
      <CustomScrollbar containerRef={scrollRef} contentRef={contentRef} />
      {state.status === "ready" && <JumpToBottom containerRef={scrollRef} />}
      {isOutlineOpen && isNarrow && (
        <div className="outline-scrim" role="presentation" onClick={() => setIsOutlineOpen(false)} />
      )}
    </main>
  );
}
