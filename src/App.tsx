import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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
import { useReaderSettings, type ReaderSettings } from "./hooks/useReaderSettings";
import { extractOutline, matchHeadingByFragment } from "./lib/outline";
import { fileNameToTitle, isMarkdownPath, isSamePath } from "./lib/path";
import { extractWikilinkTargets } from "./lib/wikilink";
import { addRecent, loadRecentFiles, removeRecent } from "./lib/recentFiles";
import { loadScrollPosition, saveScrollPosition, type ScrollPositionRecord } from "./lib/scrollMemory";
import { captureScrollPosition, restoreScrollPosition } from "./lib/scrollRestore";
import {
  EMPTY_NAV_HISTORY,
  pushNav,
  resetForward,
  stepBack,
  stepForward,
  type NavEntry,
  type NavHistory,
} from "./lib/navHistory";
import { captureViewportAnchor, restoreViewportAnchor, type ViewportAnchor } from "./lib/viewportAnchor";
import { startViewportPin, type ViewportPin } from "./lib/viewportPin";
import { isScrollInputKey } from "./lib/scrollInput";
import { animateScrollTo, cancelScrollAnimation } from "./lib/smoothScroll";
import { isContainerNearBottom } from "./lib/scrollStick";
import { computeRecheckDelay, type MdlogState } from "./lib/mdlogState";
import type { DocumentState, LoadedDocument, OutlineHeading } from "./types";

// 代码分割：react-markdown + rehype/remark + 语法高亮是体积最大的依赖，
// 懒加载后首屏（顶栏/空状态）先行渲染，文档引擎在后台加载。
const MarkdownDocument = lazy(() => import("./components/MarkdownDocument"));

/// 空解析表：无 wikilink 的文档与解析失败时的共同兜底。必须是**同一个常量引用**——
/// App 每次渲染新建 Map 会让 memo 化的正文层整体重解析。
const EMPTY_WIKILINKS: ReadonlyMap<string, string | null> = new Map();

/// 应用名：窗口标题的后半段（无文档时整条标题），与 `tauri.conf.json` 的窗口标题同值
const APP_NAME = "素笺";

/**
 * 换文档的来源，决定本次导航如何作用于历史栈（详见 `lib/navHistory.ts`）：
 * - `wikilink`：点库内链接换文档 ⇒ 当前文档 + 当前位置压入 back、清空 forward
 * - `history`：后退/前进本身 ⇒ 两侧栈都不动（互换已由 step* 完成）
 * - `direct`（默认）：对话框 / 拖放 / 最近列表 / 启动恢复 ⇒ 新导航，只作废 forward
 */
type LoadSource = "wikilink" | "history" | "direct";

type LoadOptions = {
  /** wikilink 的 `#片段`（人读标题原文）：目标文档进 DOM 后由 handleContentRendered 消费 */
  fragment?: string;
  source?: LoadSource;
  /** 后退/前进条目自带的阅读位置记录：取代持久化存储里那一份（见 pendingRestoreRef） */
  restore?: ScrollPositionRecord;
};

export default function App() {
  const [state, setState] = useState<DocumentState>({ status: "empty" });
  // 最近打开列表（新→旧）：空态列表与「启动恢复上一篇」共用同一份状态
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  // 拖放提示态：文件悬停在窗口上时正文区亮一道靛青内描边
  const [isDropTarget, setIsDropTarget] = useState(false);
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
  // 文档代际：每次「由外部装入内容」（换文档 / 热重载）递增一次，只由装入路径递增
  // （编辑 / 勾选自己的写入不算换代）。勾选的在途落盘失败后据此判断「这次写入针对的
  // 还是不是同一篇文档」——跨代际回滚会把上一篇的 markdown 写进新文档的内存。
  // 经 getter 交给 useDocumentEditor 同步读：递增发生在这里、渲染提交在其后，
  // 传值快照会漏掉中间那个调度窗（见该 hook 的 getDocumentGeneration 注释）。
  const documentGenerationRef = useRef(0);
  // 当前内存里的 markdown（file-changed 回声判据的对照物，裁定 F30）。
  // 分流函数在挂载时注册一次，直接读 state 会拿到过期闭包值，故经 ref 读取最新内容；
  // 判据不依赖任何赋值时机，也没有需要失效的快照。
  const currentMarkdownRef = useRef("");
  // 当前 ready 态携带的 wikilink 解析表：热重载与外部变更分流在挂载时注册一次，
  // 直接读 state 会拿到过期闭包值，故经 ref 读取最新一份（与 currentMarkdownRef 同款）
  const wikilinksRef = useRef<ReadonlyMap<string, string | null>>(EMPTY_WIKILINKS);
  // 打开文档函数的稳定引用：wikilink 点击回调要在**空依赖**下还能调到最新一份 loadPath
  // （它闭包了 state 与各个 ref，直接捕获会被 memo 化正文钉在首帧那一份上）
  const loadPathRef = useRef<(path: string, options?: LoadOptions) => void>(() => {});
  loadPathRef.current = loadPath;
  // 编辑会话（在 activeDocument 之后创建）：回调与 effect 经此读到最新一份，
  // 既避免闭包过期，也让传给 memo 化 MarkdownDocument 的回调保持引用稳定
  const editorRef = useRef<ReturnType<typeof useDocumentEditor> | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  // 热重载视口锚点：重载前记录的视口首个可见块元素及其相对偏移，
  // 渲染提交后按元素新位置补偿 scrollTop（内容不动），元素丢失时退回 pendingScrollRef 像素兜底
  const pendingAnchorRef = useRef<ViewportAnchor | null>(null);
  // 大纲点击跳转的目标标题 id（动画期间锁定，见 handleSelectHeading）
  const outlineNavTargetRef = useRef<string | null>(null);
  // 本次加载携带的 wikilink 片段（`[[目标#人读标题]]`）待跳转目标。ready 提交、正文
  // 进 DOM 之后才谈得上定位，故随加载记下、由 handleContentRendered 消费；
  // 消费即清空（命中与落空都清），加载失败也清——绝不留给下一次加载
  const pendingFragmentRef = useRef<{ path: string; fragment: string } | null>(null);
  // 后退/前进条目自带的阅读位置记录（与 pendingFragmentRef 同一时序：随本次加载记下、
  // 由 handleContentRendered 按路径命中后消费并清空，加载失败也清）。
  // 每次换文档的 loadPath 都会显式重设它（无记录即置 null），故残值不会跨到下一次加载；
  // 栈条目记的就是离开该文档时的位置，与持久化存储里那份同源，但不依赖那次写入成功
  const pendingRestoreRef = useRef<{ path: string; record: ScrollPositionRecord } | null>(null);
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRestoredPathRef = useRef<string | null>(null);
  // 恢复落位守护的取消函数（切换文档/重复恢复时终止上一段守护）
  const restoreCancelRef = useRef<(() => void) | null>(null);
  // headings 供事件回调读取最新值（滚动保存等 effect 只注册一次，避免闭包过期）
  const headingsRef = useRef<OutlineHeading[]>([]);
  const [isOutlineOpen, toggleOutline, setIsOutlineOpen] = useOutlineOpen(false);
  const isNarrow = useIsNarrow();
  const [outlineWidth, setOutlineWidth] = useOutlineWidth();
  const outlineWidthRef = useRef(outlineWidth);
  outlineWidthRef.current = outlineWidth;
  // 阅读设置（字号 / 栏宽 / 行高）：变量覆写挂在 documentElement，与文档无关
  const [readerSettings, setReaderSettings] = useReaderSettings();
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
  // 宽度过渡期的视口钉住（侧栏开关/拖宽 ⇒ 正文宽度变化 ⇒ 整篇行重排）。
  // 为什么必须自己钉：Chromium 原生滚动锚定不补偿行内尺寸变化驱动的重排（真机实测，
  // 纯容器瞬时改宽也 ΔscrollTop = 0），不钉就会「关侧栏页面闪到别处、开回来再闪回」。
  // 机制与分工见 lib/viewportPin.ts 头部注释。
  const viewportPinRef = useRef<ViewportPin | null>(null);

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

  // 组件卸载时注销尚未完成的落位守护与视口钉住
  useEffect(
    () => () => {
      restoreCancelRef.current?.();
      viewportPinRef.current?.stop();
    },
    []
  );

  /**
   * 进入一次宽度过渡：开布局过渡窗（窗内热重载延迟合并提交、widget 高度过渡关停），
   * 并捕获视口锚点、在窗内逐帧把内容钉回原位。
   *
   * 必须在**改宽度的事件处理器里、状态更新之前**调用：此刻 DOM 还是旧布局，
   * 捕获到的锚点偏移才是「读者当前看到的位置」。窗长 450ms（默认值）覆盖侧栏
   * 250ms 的 margin 过渡；拖宽时每次 pointermove 续窗，钉住随指针持续有效。
   */
  const beginWidthTransition = useCallback(() => {
    const container = scrollRef.current;
    const content = contentRef.current;
    if (!container || !content) return;
    noteLayoutShift();
    viewportPinRef.current?.stop();
    viewportPinRef.current = startViewportPin(container, content, {
      until: () => layoutShiftUntilRef.current,
      lastUserScrollAt: () => lastUserScrollAtRef.current,
    });
  }, [noteLayoutShift]);

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

  // 侧栏开关的全部入口（顶栏按钮 / Ctrl+K / 窄屏 Escape 与遮罩 / 窄屏选章）
  // 统一先走 beginWidthTransition：漏掉任何一处，该路径上的宽度回流就会闪。
  const toggleOutlinePinned = useCallback(() => {
    beginWidthTransition();
    toggleOutline();
  }, [beginWidthTransition, toggleOutline]);

  const setOutlineOpenPinned = useCallback(
    (open: boolean) => {
      beginWidthTransition();
      setIsOutlineOpen(open);
    },
    [beginWidthTransition, setIsOutlineOpen]
  );

  // 绘制前同步补偿第一帧：事件入口捕获的是旧布局，此处 DOM 已带上新类名/新宽度，
  // 同步读 rect 会按新布局求值，从而在首帧就把视口内容钉回原位（否则每帧都可能闪）
  useLayoutEffect(() => {
    viewportPinRef.current?.applyNow();
  }, [isOutlineOpen, outlineWidth, readerSettings]);

  // 阅读设置（字号 / 栏宽 / 行高）与侧栏拖宽同属「整篇重排」：改值前先钉住视口
  const handleReaderSettingsChange = useCallback(
    (patch: Partial<ReaderSettings>) => {
      beginWidthTransition();
      setReaderSettings(patch);
    },
    [beginWidthTransition, setReaderSettings]
  );

  // ===== wikilink 前进/后退历史 =====
  // 只有 wikilink 换文档入栈（判据与两栈方向见 lib/navHistory.ts 的模块注释）；
  // 条目自带离开时的三级位置记录，落位复用 scrollRestore.ts 的既有管线。
  const [navHistory, setNavHistory] = useState<NavHistory>(EMPTY_NAV_HISTORY);
  // 后退/前进的回调必须**空依赖**（下面快捷键 effect 的依赖表要稳、顶栏按钮不该每次渲染换引用），
  // 故栈与当前位置都经 ref 读最新一份——与 loadPathRef/editorRef 同一套路
  const navHistoryRef = useRef(navHistory);
  navHistoryRef.current = navHistory;
  // 一次换文档是否仍在途：期间前进/后退**整体忽略**（不动栈、不发加载）。
  // 判据不能是「currentPathRef 是否等于目标」——那个 ref 只在加载成功时写入
  // （loadPath 的 catch 与在途窗口里都还指着上一篇），拿它当「目标已在屏上」的替身
  // 会让后退/前进在错误页上变成互相抵消的空转。标志由「有文档重新显示」（ready 提交）
  // 或本次加载失败解除，故不会卡死
  const navInFlightRef = useRef(false);

  /// 后退/前进一步：当前文档 + 当前位置互换进另一侧栈，再经 loadPath 打开目标文档
  const stepNav = useCallback((direction: "back" | "forward") => {
    // 在途期间整体忽略：此刻「当前文档 + 当前位置」都不是确定的（正文还是加载过渡帧），
    // 走这一步只会在栈里留下与屏幕不符的条目
    if (navInFlightRef.current) return;
    const path = currentPathRef.current;
    const container = scrollRef.current;
    if (!path || !container) return;
    // 先看有没有路可走：无可走时不必测量当前位置（在空栈上按 Alt+← 是常态）
    const history = navHistoryRef.current;
    if (direction === "back" ? history.back.length === 0 : history.forward.length === 0) return;
    const current: NavEntry = {
      path,
      record: captureScrollPosition(container, headingsRef.current, contentRef.current ?? undefined),
    };
    const step = direction === "back" ? stepBack(history, current) : stepForward(history, current);
    if (!step) return;
    // 同步写回 ref：连按两次时第二次按键必须看到刚走完的那一步
    navHistoryRef.current = step.history;
    setNavHistory(step.history);
    // 目标恰好就是当前文档时不做特殊处理：loadPath 的同路径分支会走静默热重载
    // （提交活动块、恢复位置，且在该分支返回，绝不入栈）。历史加载失败后按前进退回
    // 上一篇正是靠这条路径恢复的——拦下它才是错的
    void loadPathRef.current(step.target.path, {
      source: "history",
      restore: step.target.record,
    });
  }, []);

  const handleNavBack = useCallback(() => stepNav("back"), [stepNav]);
  const handleNavForward = useCallback(() => stepNav("forward"), [stepNav]);

  // 全局快捷键：⌘K / Ctrl+K 聚焦搜索框，Ctrl+B 切换侧栏开关（所有宽度下，含侧栏已开时
  // 关闭——搜索框聚焦也不吞），Ctrl+E 切换编辑视图，Ctrl+S 提交当前块，Ctrl+P 打印，
  // Alt+← / Alt+→ 历史后退/前进。
  // 依赖只有侧栏开关与两个历史回调（它们都是空依赖 useCallback，引用恒定；其余经
  // editorRef/callback ref 读取），热重载与每次按键都不重新订阅。
  useEffect(() => {
    function handleGlobalShortcut(event: KeyboardEvent) {
      // Alt+← / Alt+→ 必须在下面的 Ctrl/Cmd 早退之前处理（Alt 组合没有 ctrl/meta）。
      // 不检查 event.defaultPrevented：这里就是它们的唯一消费者。
      // preventDefault 是必须的：WebView2 把 Alt+←/→ 当自己的历史导航加速键，
      // 不吞掉就会连整个页面一起导航走（与 Ctrl+S 吞「保存网页」同理）
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          handleNavBack();
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          handleNavForward();
          return;
        }
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      // 已被消费的按键不再处理（终审 C2 / 裁定 F38-A）：编辑框的 onKeyDown 对
      // Ctrl+S 调过 preventDefault，事件继续冒泡到 window；这里无条件再调一次
      // 就会形成双通道提交（而此时 editorRef 已被 flushSync 换成新闭包）。
      if (event.defaultPrevented) return;
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

      if (key === "b") {
        event.preventDefault();
        toggleOutlinePinned();
        return;
      }

      if (key === "k") {
        event.preventDefault();
        // 侧栏已开（搜索框可能已聚焦）时只保焦，第二次按下不动作；关闭走 Ctrl+B
        if (!isOutlineOpen) {
          setOutlineOpenPinned(true);
        }
        // 等侧栏展开后再聚焦
        setTimeout(() => searchInputRef.current?.focus(), 60);
        return;
      }

      // Ctrl+P（2026-09-20）：打印。WebView2 的 window.print() 走 Chromium 打印管线
      // （微软 WebView2 打印文档的 ShowPrintUI / 反馈 #42 都确认这条路径），打印样式见
      // kami.css 的两段 @media print。守卫只为「环境没有 print」时留一条安静的路：
      // 拿不到实现就什么都不做（也不吞按键），而不是抛错。
      // Ctrl+Shift+P 不归这里（带 Shift 是另一个组合键，不打印、不吞键）。
      if (key === "p" && !event.shiftKey) {
        if (typeof window.print !== "function") return;
        event.preventDefault();
        window.print();
        return;
      }
    }
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, [isOutlineOpen, setOutlineOpenPinned, toggleOutlinePinned, handleNavBack, handleNavForward]);

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

  /** 当前阅读位置的三级记录（无滚动容器时返回 null——此时没有位置可言） */
  function currentScrollRecord(): ScrollPositionRecord | null {
    const container = scrollRef.current;
    if (!container) return null;
    return captureScrollPosition(container, headingsRef.current, contentRef.current ?? undefined);
  }

  /** 把当前滚动位置（锚点 + 偏移 + 比例兜底）写入持久化存储 */
  function persistCurrentScroll() {
    const path = currentPathRef.current;
    if (!path) return;
    const record = currentScrollRecord();
    if (!record) return;
    void saveScrollPosition(path, record);
  }

  /**
   * 把文档里出现过的 wikilink 目标一次性交给后端解析（祖先目录逐级向上找 → 自动补
   * 扩展名 → 全库唯一 basename 兜底）。返回「目标 → 绝对路径 / null」的表。
   *
   * 无 wikilink 的文档不发 IPC（返回空表）；**IPC 失败会抛**，由调用方决定怎么降级——
   * 首次打开退化成空表（全部按未解析渲染成纯文本 + 提示，正文照常可读），
   * 热重载则保留原有表（一次抖动不该把已经点得动的链接降级）。
   */
  async function resolveWikilinks(
    path: string,
    markdown: string
  ): Promise<ReadonlyMap<string, string | null>> {
    const targets = extractWikilinkTargets(markdown);
    if (targets.length === 0) return EMPTY_WIKILINKS;
    const resolved = await invoke<Record<string, string | null>>("resolve_wikilinks", {
      fromPath: path,
      targets,
    });
    return new Map(Object.entries(resolved ?? {}));
  }

  async function loadPath(path: string, options: LoadOptions = {}) {
    const { fragment, source = "direct", restore } = options;
    // 切换文档前先提交活动块（规格 §6.3）：经 OS 关联/再次启动切文档时没有失焦事件，
    // 不先提交就会把上一篇的草稿按「同序号块」拼进新文档（写到错的文件里）。
    // 提交口失败时 hook 会保留草稿与活动块，此处只是尽力提交。
    await editorRef.current?.commitActive();
    // 同路径重新打开（启动参数 drain_pending_open_paths 命中当前文档，或用户再次
    // 选中同一文件）：绝不能走 loading 帧——ready 分支整体卸载会销毁所有 widget iframe
    // 并丢失正在进行的交互状态。改走静默热重载（reloadCurrent 内部复用当前路径，
    // 保留滚动位置并以 reloadTick 驱动落墨/贴底仲裁）。
    if (isSamePath(path, currentPathRef.current)) {
      await reloadCurrent();
      // 自引用（`[[本笔记#标题]]`）不换文档，走不到下面的 ready 提交：正文已在 DOM 里，
      // 直接按同一套缓动路径跳转——否则这枚片段会静默失效
      if (fragment) {
        const heading = matchHeadingByFragment(headingsRef.current, fragment);
        if (heading) {
          scrollHeadingIntoView(heading.id);
        }
      }
      return;
    }
    // 确认是「切换文档」后先清空编辑会话（终审 I1 / 裁定 F39）：落盘失败时 F24 会把
    // 活动块与草稿留在原地（上面的尽力提交拿不到成功），不清就会在新文档的同序号块上
    // 挂出旧草稿，任何后续提交触发都会把上一篇的文字写进新文件。
    // 同路径重开不走这里（上面的分支已返回）：热重载不得丢掉正在编辑的草稿。
    editorRef.current?.resetSession();
    // 切换文档前先保存上一篇的阅读位置。同一份记录随即进历史栈（wikilink 换文档时）：
    // 两次测量之间布局没有任何变化，故只测一次
    const outgoingPath = currentPathRef.current;
    const outgoingRecord = currentScrollRecord();
    if (outgoingPath && outgoingRecord) {
      void saveScrollPosition(outgoingPath, outgoingRecord);
    }
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
    // 片段只属于**本次**加载：无片段时显式清空，落空的旧片段不许跑进下一次加载里
    pendingFragmentRef.current = fragment ? { path, fragment } : null;
    // 后退/前进自带的阅读位置记录同属**本次**加载（无记录时显式清空，
    // 由 handleContentRendered 按路径命中后消费并取代持久化存储的读取）
    pendingRestoreRef.current = restore ? { path, record: restore } : null;
    // 从这里到「有文档重新显示」为止都算换文档在途：期间前进/后退整体忽略
    // （见 stepNav）。解除点有两个：ready 提交、本次加载失败
    navInFlightRef.current = true;
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
      // 换代：本篇的内容即将被装入，之前针对旧文档的在途勾选回滚就此作废
      documentGenerationRef.current += 1;
      // wikilink 解析必须在 setState 之前完成：ready 态一次就带上表，
      // 否则首帧全部是「未找到」纯文本、第二帧才变链接（闪烁 + 整篇重解析）。
      // 解析失败只退化成空表——绝不让它冒泡到外层 catch 把文档变成错误页
      let wikilinks: ReadonlyMap<string, string | null> = EMPTY_WIKILINKS;
      try {
        wikilinks = await resolveWikilinks(document.path, document.markdown);
      } catch {
        wikilinks = EMPTY_WIKILINKS;
      }
      if (loadRequestRef.current !== requestId) return;
      setState({ status: "ready", document, wikilinks });
      // 有文档重新显示 ⇒ 本次换文档不再在途（解除点之一，另一个是下面的 catch）
      navInFlightRef.current = false;
      // 历史栈只在**加载成功**后动（失败时 currentPathRef 仍指向上一篇，入栈会造出
      // 「退回到其实还在显示的文档」的条目）：wikilink 换文档压入 back 并清空 forward；
      // 其余来源是「新导航」，只作废 forward，back 留给用户退回来处。
      // 后退/前进自身（history）两侧都不动——互换已由 stepNav 完成
      if (source === "wikilink") {
        if (outgoingPath && outgoingRecord) {
          const entry: NavEntry = { path: outgoingPath, record: outgoingRecord };
          const next = pushNav(navHistoryRef.current, entry);
          navHistoryRef.current = next;
          setNavHistory(next);
        }
      } else if (source === "direct") {
        const next = resetForward(navHistoryRef.current);
        if (next !== navHistoryRef.current) {
          navHistoryRef.current = next;
          setNavHistory(next);
        }
      }
      // 「成功打开」的单一收口：最近打开列表在此置顶（列表状态与持久化同步更新）
      void addRecent(document.path).then(setRecentFiles);

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
      // 加载失败：本次片段与后退/前进的位置记录随之作废（绝不让它们落到下一次加载上），
      // 换文档在途标志同样解除——错误页上仍要能按前进退回上一篇（走同路径热重载恢复）
      pendingFragmentRef.current = null;
      pendingRestoreRef.current = null;
      navInFlightRef.current = false;
      setState({ status: "error", message: String(error), path });
      // 打不开的条目留在「最近打开」里没有意义（列表点击命中已删除的文件是常态，
      // 启动恢复命中已删除的文件同理）：摘掉它，列表不残留死条目。
      // removeRecent 对不在列表里的路径是 no-op（不落盘），故从对话框打开失败也不受影响。
      void removeRecent(path).then(setRecentFiles);
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
      // 换代：热重载换掉的是本篇的内容（外部改写 / mdlog 追加），针对旧内容的在途
      // 勾选回滚同样作废——把旧 markdown 写回去等于把外部变更整篇抹掉
      documentGenerationRef.current += 1;
      // 热重载（含 mdlog 每次追加）对延迟敏感：先沿用上一份表提交，绝不在此 await IPC。
      // 表里缺目标时（追加内容引入新链接）异步补齐，补齐前那些链接按未解析渲染成
      // 纯文本 + 提示；目标集合无变化时（绝大多数追加）一次多余调用都不发。
      const carried = wikilinksRef.current;
      const targets = extractWikilinkTargets(document.markdown);
      setState({ status: "ready", document, wikilinks: carried });
      if (targets.some((target) => !carried.has(target))) {
        void resolveWikilinks(document.path, document.markdown)
          .then((map) => {
            if (loadRequestRef.current !== requestId) return;
            setState((previous) =>
              previous.status === "ready" && previous.document === document
                ? { ...previous, wikilinks: map }
                : previous
            );
          })
          // 解析失败（IPC 抖动）：保留原有表，别把已经点得动的链接降级成纯文本
          .catch(() => {});
      }
      setReloadTick((tick) => tick + 1);
      if (!isMdlogActiveRef.current) {
        setShowReloadNote(true);
      }
    } catch {
      // 重载失败时保留旧内容，不打扰用户
    } finally {
      // 热重载可以顶掉一次仍在途的换文档（提交 ready 或失败都算「这一轮结束了」）：
      // 不在这里解除，被顶掉的那次导航留下的在途标志会让前进/后退永久失效。
      // 只由**最新一次**请求解除：更晚的请求可能还在途，标志归它所有
      if (loadRequestRef.current === requestId) {
        navInFlightRef.current = false;
      }
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

  /// 拖放打开（Tauri 2 的 webview 拖放事件）。提示态与打开动作分离：
  /// enter/over 亮描边（over 只带坐标、不带路径，故判定不依赖 paths），
  /// leave 熄灭；drop 先熄灭再取**第一个** Markdown 路径走既有打开管线——
  /// 非 Markdown（图片/压缩包等）整体忽略，多文件也只认第一个。
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function bindDragDrop() {
      const unlistenFn = await getCurrentWebviewWindow().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDropTarget(true);
          return;
        }
        if (payload.type === "leave") {
          setIsDropTarget(false);
          return;
        }
        setIsDropTarget(false);
        const path = payload.paths.find(isMarkdownPath);
        if (path) {
          // 经 ref 取最新一份 loadPath：本 effect 只在挂载时注册一次
          void loadPathRef.current(path);
        }
      });
      if (cancelled) {
        unlistenFn();
      } else {
        unlisten = unlistenFn;
      }
    }

    // 拖放能力缺失（旧 WebView2 / 权限未授予）不该影响阅读：失败即静默降级
    void bindDragDrop().catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
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
      // 多实例（2026-09-12）：无单实例转发，每个进程只在启动时 drain 自己的命令行路径；
      // 运行期不再有「pending-open-paths」事件（其唯一生产者是已移除的单实例插件）。

      // 关窗前先提交活动块（规格 §6.3）：有未提交草稿时拦下本次关闭，提交完成后再看结果。
      // 绝不能「先 preventDefault、再自行 close()」—— close() 会重发可拦截的 closeRequested
      //（window.d.ts:745；tauri-runtime-wry 的 WindowMessage::Close 也走同一处理器），
      // 落盘失败时 hook 会重新激活同一块并保留草稿（F24），于是形成
      // 「拦截 → 提交失败 → close → 再拦截」的无限重试（审查 C1）。
      // 正确姿势：提交之后按「活动块是否真的清掉」决定要不要拦（commitActive 的返回值
      // 就是这个问题 —— 消费者的 editorRef 是上一轮渲染的快照，不能用来判定）；
      // 不拦时的窗口销毁由 JS 包装层自己做（onCloseRequested → destroy，
      // 且它会 await 本处理器，故晚到的 preventDefault 依然生效）。
      const closeUnlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        // 关窗路径的**绝对不变量**：绝不能因本处理器抛错/卡住而让窗口关不掉。
        // 任何意外都放行（不 preventDefault），最多损失一次未提交的草稿；
        // 真正做到拦截的只有「提交返回 false」那一条路径。
        try {
          const current = editorRef.current;
          if (!current?.activeUnit) return;
          // 提交成功（含 mdlog 门禁把会话中断掉）⇒ 不拦，包装层 destroy；
          // 落盘失败 ⇒ 草稿仍在框里，拦下本次关闭让用户处理，绝不重试关闭。
          const cleared = await current.commitActive();
          if (!cleared) {
            event.preventDefault();
          }
        } catch (error) {
          console.error("close-requested handler failed, closing anyway", error);
        }
      });
      if (cancelled) {
        closeUnlisten();
      } else {
        unlistenClose = closeUnlisten;
      }

      await drainPendingPaths();
      if (!openRequestSeenRef.current && !startupLoaded.current) {
        startupLoaded.current = true;
        // 最近打开列表（新→旧）：列表供空态渲染，首条即「启动恢复」的目标。
        // 空列表不写 state——初值就是空数组，省掉一次无谓的重渲染
        const recents = await loadRecentFiles();
        if (recents.length > 0) {
          setRecentFiles(recents);
        }
        const lastPath = recents[0] ?? null;
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
      unlistenClose?.();
    };
  }, []);

  // 监听后端文件变更事件：先分流「我方写入回声 / 外部变更」，再决定是否热重载
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    /// 外部变更分流（规格 §7.2）：file-changed 到达时先读盘，并与**当前内存 markdown**
    /// 按归一 EOL 比对（裁定 F30）——相等即无实际外部变更（可能是我方写入的 watcher
    /// 回声；F24 保证内存不长期领先磁盘），整体忽略（不更新状态、不递增 reloadTick、
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
        if (normalized === currentMarkdownRef.current.replace(/\r\n/g, "\n")) {
          return; // 磁盘与内存一致：无变更可热重载，整体忽略
        }
        // 提示只在确有编辑会话被中断时才弹（裁定 F32）：mdlog 记录中模型每次追加
        // 都会走这条路径，而那时用户从未进过编辑态，不能刷「编辑已取消」。
        if (editorRef.current?.activeUnit) {
          editorRef.current.notifyInterrupted("文件已被外部修改 · 编辑已取消");
        }
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
  currentMarkdownRef.current = activeDocument?.markdown ?? "";
  wikilinksRef.current = state.status === "ready" ? state.wikilinks : EMPTY_WIKILINKS;

  // 窗口标题（OS 级 setTitle，**不是**顶栏文本——顶栏不显示文件名是设计红线）：
  // 有文档时「文件名 — 素笺」（fileNameToTitle 与正文 h1.document-title 同源），
  // 无文档（空态）与加载失败复位为应用名。
  // loading 是切文档的过渡帧：null 表示本次不改写标题，沿用上一篇的——否则任务栏
  // 会在换文档时闪一帧「素笺」。
  const windowTitle =
    state.status === "ready"
      ? `${fileNameToTitle(state.document.fileName)} — ${APP_NAME}`
      : state.status === "loading"
        ? null
        : APP_NAME;

  // 依赖是标题串而非 state 对象：编辑提交（markdown 变、state 换引用）不该重写标题。
  // 写标题失败（权限缺失/非 Tauri 环境）静默降级——它是装饰性副作用，不该冒泡成错误页
  useEffect(() => {
    if (windowTitle === null) return;
    void getCurrentWindow()
      .setTitle(windowTitle)
      .catch(() => {});
  }, [windowTitle]);

  /// 文档 markdown 的唯一写入点：提交新内容与失败回退都经此，保持引用稳定
  const applyMarkdown = useCallback((next: string) => {
    setState((previous) =>
      previous.status === "ready"
        ? { ...previous, document: { ...previous.document, markdown: next } }
        : previous
    );
  }, []);

  /// 落盘（提交即落盘，规格 §7.1）。不需要记录「最近一次我方写入」：
  /// 回声判据改为与内存 markdown 比对（裁定 F30），固定快照会误吞真实外部变更、
  /// 且在 await 之后才赋值会造成提交在途竞态。
  const saveMarkdown = useCallback(async (next: string) => {
    const path = currentPathRef.current;
    if (!path) throw new Error("No document is loaded");
    await invoke("save_document", { path, content: next });
  }, []);

  const editor = useDocumentEditor({
    markdown: activeDocument?.markdown ?? "",
    mdlogActive: isMdlogActive,
    onMarkdownChange: applyMarkdown,
    save: saveMarkdown,
    // 传 getter 而不是值：装入路径递增的是上面那个 ref，此刻渲染尚未提交，
    // 值快照会让 hook 在「递增 → 提交」的调度窗里仍按旧代际判断（勾选回滚可能写坏新文档）
    getDocumentGeneration: () => documentGenerationRef.current,
  });
  editorRef.current = editor;

  // 传给 memo 化 MarkdownDocument 的回调必须引用稳定（性能结构约束）：
  // 用空依赖 + editorRef 读最新会话，避免每次按键/每次状态变化都换新引用
  const handleActivateUnit = useCallback((index: number, caretOffset: number) => {
    editorRef.current?.activateUnit(index, caretOffset);
  }, []);

  // 点名库内链接：走与「打开文件」完全相同的加载路径（提交活动块、保存上一篇阅读位置、
  // 重置编辑会话、恢复位置）。片段（`#标题`）随路径一起交给 loadPath：目标文档进 DOM 后
  // 由 handleContentRendered 按同一套缓动路径跳转。同款空依赖 + ref 读最新函数，
  // 保住 memo 化正文的引用稳定。
  // 来源标成 wikilink：这是**唯一**会进历史栈的导航（同文档自引用由 loadPath 的同路径
  // 分支拦下，不换文档也就不入栈）
  const handleOpenWikilink = useCallback((path: string, _target: string, fragment?: string) => {
    void loadPathRef.current(path, { fragment, source: "wikilink" });
  }, []);

  const handleToggleEdit = useCallback(() => {
    void editorRef.current?.toggleView();
  }, []);

  // 阅读视图里点任务列表复选框：与块激活同一套路（空依赖 + editorRef 读最新会话），
  // 保住 memo 化正文的 components 引用稳定（否则每次渲染都重走解析管线）
  const handleToggleTask = useCallback((itemStart: number) => {
    void editorRef.current?.toggleTask(itemStart);
  }, []);

  // 只读块（HTML / 交互块）在编辑视图里由「加粗灰色虚线框 + not-allowed 指针」表达，
  // 不再弹文字提示（2026-09-10 设计定稿：零文字浮层）——因此这里没有 locked 点击处理器。

  /// 缓动滚到容器内某处（与恢复位置同一套动画）；lockId 非空时锁定大纲高亮到该标题，
  /// 动画自然结束或被用户滚动/按键打断时解除锁定。
  const animateContainerTo = useCallback((target: number, lockId?: string) => {
    const container = scrollRef.current;
    if (!container) return;
    if (Math.abs(target - container.scrollTop) < 1) return;
    outlineNavTargetRef.current = lockId ?? null;
    animateScrollTo(container, target, () => {
      outlineNavTargetRef.current = null;
    });
  }, []);

  /// 把正文里某个标题滚到视口顶：点大纲与 wikilink 片段跳转**共用**这一条缓动路径
  /// （含大纲高亮锁定）。调用前提是目标标题的 DOM 已提交——懒加载正文尚未进 DOM 时
  /// getElementById 取不到，直接不滚（宁可不动，也不去猜一个位置）。
  const scrollHeadingIntoView = useCallback(
    (id: string) => {
      const element = document.getElementById(id);
      const container = scrollRef.current;
      if (!element || !container) return;
      animateContainerTo(
        container.scrollTop +
          element.getBoundingClientRect().top -
          container.getBoundingClientRect().top,
        id
      );
    },
    [animateContainerTo]
  );

  // 切换文档时恢复上次阅读位置（无记录则回到顶部）。
  // 恢复时机放在 MarkdownDocument 内容渲染进 DOM 之后（onRendered），而非 state 变 ready 时：
  // 因为 MarkdownDocument 是懒加载，state ready 时正文 chunk 可能尚未加载、未进 DOM，
  // 此时 scrollHeight 不可用，会导致恢复位置计算为 0。用 lastRestoredPathRef 记录已恢复的
  // 路径，仅在切换到新文档时恢复；同文档的热重载/重渲染不处理（由 pendingScrollRef 负责）。
  // 恢复走锚点优先（restoreScrollPosition）：标题被删则落到最近幸存标题附近；
  // 恢复后图片/字体加载会撑大 scrollHeight 导致落点漂移（间歇性恢复失败的根因），
  // 由落位守护在布局稳定前持续重新锚定。
  //
  // 本次加载若带着 wikilink 片段（`[[目标#标题]]`），片段跳转**取代**阅读位置恢复：
  // 两者作用于同一个滚动容器，恢复还会挂落位守护（布局稳定前持续按锚点重锚定），
  // 后启动的那个必然把先启动的顶掉——不跳过就会出现「跳到位又被拽回旧位置」。
  // 片段命中时只跳转、**不**挂守护：读者要的是那个标题，不是记忆里的旧位置。
  const handleContentRendered = useCallback(() => {
    const container = scrollRef.current;
    const path = currentPathRef.current;
    if (!container || !path) return;
    if (lastRestoredPathRef.current === path) return;
    lastRestoredPathRef.current = path;

    // 片段消费即清空（命中与落空都清）：落空的片段退回下面的正常恢复，
    // 用户中途滚动时动画由全局输入监听取消（onComplete 同步解锁大纲目标，
    // 且已消费的片段不会再来第二次）。路径按 isSamePath 比对：请求路径与
    // ready 态携带的规范路径可能写法不同（与 loadPath 的同路径守卫同款）
    const pending = pendingFragmentRef.current;
    if (pending && isSamePath(pending.path, path)) {
      pendingFragmentRef.current = null;
      const heading = matchHeadingByFragment(headingsRef.current, pending.fragment);
      if (heading) {
        // 先归零（与恢复路径同款：不沿用上一篇文档的滚动位置）。缓动目标按目标元素
        // 自身在正文里的位置算，与这里的写入无关，跳转终点不受影响
        container.scrollTop = 0;
        scrollHeadingIntoView(heading.id);
        return;
      }
    }

    // 先归零，避免沿用上一篇文档的滚动位置
    container.scrollTop = 0;
    // 位置记录来源：后退/前进条目自带的那份优先（**路径命中**才消费并清空；
    // 路径不符说明这份记录不属于本次加载，退回存储），两者同源（离开该文档时同时
    // 写进栈与存储），但条目不受一次失败的写入影响
    const carried = pendingRestoreRef.current;
    let recordPromise: Promise<ScrollPositionRecord | null>;
    if (carried && isSamePath(carried.path, path)) {
      pendingRestoreRef.current = null;
      recordPromise = Promise.resolve(carried.record);
    } else {
      recordPromise = loadScrollPosition(path);
    }
    void recordPromise.then((record) => {
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
  }, [scrollHeadingIntoView]);

  // 程序化滚动动画（恢复位置/大纲跳转/搜索跳转/跳底）期间用户主动滚动/按键，
  // 立即取消动画让出控制权；同时记下输入时间戳，热重载恢复与宽度过渡期的视口钉住
  // 据此避让 300ms——否则重载提交瞬间会把用户刚滚出去的距离当作「漂移」拽回
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onUserScrollInput = () => {
      lastUserScrollAtRef.current = performance.now();
      cancelScrollAnimation(container);
    };
    // 按键只在**会滚动的键**上记为「滚动输入」（清单与修饰键例外都在 lib/scrollInput.ts，
    // 带单元测试）：任何按键都记会把 Ctrl+K / Ctrl+E / Ctrl+S / Escape 这类快捷键误判成
    // 用户接管——Ctrl+K 开侧栏时钉住会被当场取消，宽度回流又没人补偿（快捷键路径重新出现跳动）。
    // Alt+←/→ 是历史导航（另一条快捷键），由 isScrollInputKey 里的修饰键例外排除，
    // 不在调用方另写一份判据（漏一处就等于按后退键被当成用户接管）。
    // 取消动画仍然对所有按键生效（任何按键都说明用户接管了滚动意图），只是不污染时间戳。
    const onKeyDown = (event: KeyboardEvent) => {
      if (isScrollInputKey(event)) {
        lastUserScrollAtRef.current = performance.now();
      }
      cancelScrollAnimation(container);
    };
    container.addEventListener("wheel", onUserScrollInput, { passive: true });
    container.addEventListener("touchstart", onUserScrollInput, { passive: true });
    // 拖 thumb 直写 scrollTop 不产生原生输入事件，由 CustomScrollbar 派发此事件
    container.addEventListener("vellum:scrollbar-drag", onUserScrollInput);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("wheel", onUserScrollInput);
      container.removeEventListener("touchstart", onUserScrollInput);
      container.removeEventListener("vellum:scrollbar-drag", onUserScrollInput);
      window.removeEventListener("keydown", onKeyDown);
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
  // 再退回阅读视图。经 editorRef 读最新会话，effect 只随门禁边沿触发。
  // 提示只保留一条（审查 Minor 3）：编辑视图下 toggleView → commitActive 的提交口门禁
  // （F25）已经做了「写剪贴板 + 清场 + 提示」，此处不得再重复弹一次；
  // 既不在编辑视图又没有活动块时本就无编辑会话可中断，静默（与裁定 F32 同口径）。
  useEffect(() => {
    if (!isMdlogActive) return;
    const current = editorRef.current;
    if (!current) return;
    if (current.viewMode === "editing") {
      void current.toggleView();
      return;
    }
    if (current.activeUnit) {
      current.notifyInterrupted("记录已开始 · 编辑已取消");
    }
  }, [isMdlogActive]);

  // 窄屏下按 Escape 关闭大纲面板
  useEffect(() => {
    if (!isNarrow || !isOutlineOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOutlineOpenPinned(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isNarrow, isOutlineOpen, setOutlineOpenPinned]);

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
    // 拖宽与开关同源（都改正文宽度 ⇒ 行重排），同样钉住视口
    beginWidthTransition();

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

  /// 文档内锚点链接（Markdown 标准语法 `[文字](#id)`）。浏览器默认的 hash 跳转会改写
  /// URL 与历史，且不参与我们的缓动滚动与大纲联动，所以全部接管：
  /// - 目标元素在正文里 ⇒ 缓动滚到它（与点大纲同一条路径；标题会顺带锁定大纲高亮）
  /// - 「文档顶部」约定 ⇒ 回顶部。HTML 规范里空片段与 `top` 本就表示文档顶部；`main`
  ///   是 HTML 导出文档里最常见的包裹 id（`<main id="main">`——本应用外壳就是这层），
  ///   用户那份报告里 7 处 `[返回顶部](#main)` 正属于这一类（文档自身没定义该 id，
  ///   所以直接交给浏览器只会没反应）。
  /// - 其余找不到的目标：不猜、不动，但仍阻止 hash 改写
  const scrollToContentFragment = useCallback(
    (rawId: string) => {
      const container = scrollRef.current;
      const content = contentRef.current;
      if (!container) return;
      let id = rawId;
      try {
        id = decodeURIComponent(rawId);
      } catch {
        // 非法百分号编码：按原样找
      }
      const found = id === "" ? null : document.getElementById(id);
      const inContent = found && content?.contains(found) ? found : null;
      if (inContent) {
        animateContainerTo(
          container.scrollTop +
            inContent.getBoundingClientRect().top -
            container.getBoundingClientRect().top,
          headingsRef.current.some((heading) => heading.id === inContent.id)
            ? inContent.id
            : undefined
        );
        return;
      }
      const lower = id.toLowerCase();
      if (id === "" || lower === "top" || lower === "main") {
        animateContainerTo(0);
      }
    },
    [animateContainerTo]
  );

  // 锚点点击接管（事件委托在滚动容器上）。编辑视图下返回：那里点击的目标是「进入块编辑」，
  // 不能被链接抢走（块内链接仍可读，只是不跳转）
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const onClick = (event: MouseEvent) => {
      // 只接管「干净的左键点击」：带修饰键/其它键的点击交给浏览器原行为，
      // Shift+点击选字、Ctrl+点击等都不该被拽去跳锚点
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (editorRef.current?.viewMode === "editing") return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href^="#"]');
      if (!anchor) return;
      event.preventDefault();
      scrollToContentFragment((anchor.getAttribute("href") ?? "").slice(1));
    };
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [scrollToContentFragment]);

  const handleSelectHeading = (id: string) => {
    // 与 wikilink 片段跳转共用同一条缓动路径（scrollHeadingIntoView）
    scrollHeadingIntoView(id);
    if (isNarrow) {
      setOutlineOpenPinned(false);
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
        onOpen={handleOpen}
        isOutlineOpen={isOutlineOpen}
        onToggleOutline={toggleOutlinePinned}
        canGoBack={navHistory.back.length > 0}
        canGoForward={navHistory.forward.length > 0}
        onGoBack={handleNavBack}
        onGoForward={handleNavForward}
        isRecording={isMdlogActive}
        isEditing={editor.viewMode === "editing"}
        canEdit={!isMdlogActive}
        onToggleEdit={handleToggleEdit}
        readerSettings={readerSettings}
        onReaderSettingsChange={handleReaderSettingsChange}
      />
      <div className={`app-shell__body ${isOutlineOpen ? "app-shell__body--outline-open" : ""}`}>
        {/* 热重载提示（二）：印章，悬浮于窗口中下方、不随文档滚动；key 变化即重播。
            key 带前缀：两个提示都从 1 起计数，裸数字会与下面的 editor-toast 撞 key */}
        {showReloadNote && (
          <div key={`reload-${reloadTick}`} className="reload-note" role="status">
            墨迹未干
          </div>
        )}
        {/* 编辑提示条（HTML/交互块只读、记录中禁用、保存失败）：与「墨迹未干」同一视觉语言，
            由 App 层统一渲染 —— 不放进 memo 化的解析层，避免把提示状态带进正文渲染 */}
        {editor.toast ? (
          <div key={`toast-${editor.toast.id}`} className="editor-toast" role="status">
            {editor.toast.message}
          </div>
        ) : null}
        {/* 重文档软提示（spec D5 / 裁定 F40）：实测提交耗时超阈值后的常驻轻提示，
            只在编辑视图内可见（阅读视图 DOM 不变）；它是文档规模属性，不自动消失 */}
        {editor.viewMode === "editing" && editor.heavyDoc ? (
          <div className="editor-hint" role="status">
            本文档较大，提交可能有不到一秒的停顿
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
            searchQueryPending={searchQueryPending}
            onNextMatch={handleNextMatch}
            onPrevMatch={handlePrevMatch}
            searchInputRef={searchInputRef}
          />
        </aside>
        {/* 侧边栏宽度手柄：骑跨侧栏右缘边线（aside overflow:hidden，须作兄弟节点外置），
            拖拽调宽 200–320px，双击复位默认宽度；窄屏下正文不位移（浮层模式），拖了无意义，不渲染 */}
        {isOutlineOpen && !isNarrow && (
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
        <div
          ref={scrollRef}
          className={"document-scroll" + (isDropTarget ? " document-scroll--drop-target" : "")}
          tabIndex={0}
        >
          <div
            ref={contentRef}
            className={
              "document-scroll__content" +
              (editor.viewMode === "editing" ? " document-scroll__content--editing" : "")
            }
          >
            <div ref={documentContentRef} className="document-content">
              {state.status === "empty" ? (
                <EmptyState
                  onOpen={handleOpen}
                  recentFiles={recentFiles}
                  onOpenRecent={(path) => void loadPathRef.current(path)}
                />
              ) : null}
              {state.status === "loading" ? (
                <section className="empty-state" role="status">
                  加载中...
                </section>
              ) : null}
              {state.status === "error" ? (
                <ErrorState
                  message={state.message}
                  path={state.path}
                  onRetry={handleOpen}
                  recentFiles={recentFiles}
                  onOpenRecent={(path) => void loadPathRef.current(path)}
                />
              ) : null}
              {state.status === "ready" ? (
                <>
                  {/* 文档标题（Obsidian 的 inline title）：取自文件名，落在正文首行。
                      刻意放在 .markdown-body 之外——它不属于文档内容，也就不进 markdown
                      解析、搜索高亮、块单元与大纲。
                      title 是完整绝对路径：2026-09-20 顶栏纯工具栏化后，路径的归宿只有
                      这里（hover）与设置页「当前文档」 */}
                  <h1 className="document-title" title={state.document.path}>
                    {fileNameToTitle(state.document.fileName)}
                  </h1>
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
                      onToggleTask={handleToggleTask}
                      wikilinks={state.wikilinks}
                      onOpenWikilink={handleOpenWikilink}
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
        <div className="outline-scrim" role="presentation" onClick={() => setOutlineOpenPinned(false)} />
      )}
    </main>
  );
}
