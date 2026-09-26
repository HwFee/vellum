import { useRef } from "react";
import type { MutableRefObject } from "react";
import type { NavHistory } from "../lib/navHistory";
import { EMPTY_NAV_HISTORY } from "../lib/navHistory";
import type { ScrollPositionRecord } from "../lib/scrollMemory";
import type { ViewportAnchor } from "../lib/viewportAnchor";
import type { ViewportPin } from "../lib/viewportPin";
import type { OutlineHeading } from "../types";

/// 空解析表：无 wikilink 的文档与解析失败时的共同兜底。必须是**同一个常量引用**——
/// App 每次渲染新建 Map 会让 memo 化的正文层整体重解析。
export const EMPTY_WIKILINKS: ReadonlyMap<string, string | null> = new Map();

/**
 * 换文档的来源，决定本次导航如何作用于历史栈（详见 `lib/navHistory.ts`）：
 * - `wikilink`：点库内链接换文档 ⇒ 当前文档 + 当前位置压入 back、清空 forward
 * - `history`：后退/前进本身 ⇒ 两侧栈都不动（互换已由 step* 完成）
 * - `direct`（默认）：对话框 / 拖放 / 最近列表 / 启动恢复 ⇒ 新导航，只作废 forward
 */
export type LoadSource = "wikilink" | "history" | "direct";

export type LoadOptions = {
  /** wikilink 的 `#片段`（人读标题原文）：目标文档进 DOM 后由 handleContentRendered 消费 */
  fragment?: string;
  source?: LoadSource;
  /** 后退/前进条目自带的阅读位置记录：取代持久化存储里那一份（见 pendingRestoreRef） */
  restore?: ScrollPositionRecord;
};

/// 编辑会话的最小表面：领域 hooks 只经此读到 useDocumentEditor 的返回，
/// 不把整个 hook 返回类型引进运行时定义（App 侧赋值时给出完整对象）。
export type EditorHandle = {
  viewMode: "reading" | "editing";
  activeUnit: { index: number } | null;
  commitActive: () => Promise<boolean>;
  toggleView: () => Promise<void> | void;
  resetSession: () => void;
  notifyInterrupted: (message: string) => void;
  toggleTask: (itemStart: number) => Promise<void> | void;
  activateUnit: (index: number, caretOffset: number) => void;
};

/**
 * App 运行时总线：跨域共享 ref 的**显式类型**。
 *
 * 这些 ref 本来就是多个职责域共用的（文档加载写 pendingFragmentRef、落位管线消费；
 * 布局过渡窗的 until 时间戳同时被热重载延迟与视口钉住读取……）。拆分 hooks 之后
 * 共享关系不变，只是从「同一个函数体的闭包」换成「同一个 runtime 对象的字段」。
 * 分组即领域归属：被 ≥2 个域读写的才进这里；单域自用的 state/ref 留在各自 hook 内。
 */
export type AppRuntime = {
  /// DOM 节点
  dom: {
    scrollRef: MutableRefObject<HTMLDivElement | null>;
    contentRef: MutableRefObject<HTMLDivElement | null>;
    documentContentRef: MutableRefObject<HTMLDivElement | null>;
    searchInputRef: MutableRefObject<HTMLInputElement | null>;
    /// 「檢索」页签的全库检索框（Ctrl+Shift+F 的聚焦目标）
    librarySearchInputRef: MutableRefObject<HTMLInputElement | null>;
  };
  /// 文档会话
  doc: {
    currentPathRef: MutableRefObject<string | null>;
    /** 文档代际：每次「由外部装入内容」（换文档 / 热重载）递增一次，只由装入路径递增
        （编辑 / 勾选自己的写入不算换代）。勾选的在途落盘失败后据此判断「这次写入针对的
        还是不是同一篇文档」——跨代际回滚会把上一篇的 markdown 写进新文档的内存。
        经 getter 交给 useDocumentEditor 同步读：递增发生在装入路径、渲染提交在其后，
        传值快照会漏掉中间那个调度窗（见该 hook 的 getDocumentGeneration 注释）。 */
    documentGenerationRef: MutableRefObject<number>;
    /** 当前内存里的 markdown（file-changed 回声判据的对照物，裁定 F30）。
        分流函数在挂载时注册一次，直接读 state 会拿到过期闭包值，故经 ref 读取最新内容；
        判据不依赖任何赋值时机，也没有需要失效的快照。 */
    currentMarkdownRef: MutableRefObject<string>;
    /** 当前 ready 态携带的 wikilink 解析表：热重载与外部变更分流在挂载时注册一次，
        直接读 state 会拿到过期闭包值，故经 ref 读取最新一份（与 currentMarkdownRef 同款） */
    wikilinksRef: MutableRefObject<ReadonlyMap<string, string | null>>;
    /** headings 供事件回调读取最新值（滚动保存等 effect 只注册一次，避免闭包过期） */
    headingsRef: MutableRefObject<OutlineHeading[]>;
    loadRequestRef: MutableRefObject<number>;
    /** 打开文档函数的稳定引用：wikilink 点击回调要在**空依赖**下还能调到最新一份 loadPath
        （它闭包了 state 与各个 ref，直接捕获会被 memo 化正文钉在首帧那一份上） */
    loadPathRef: MutableRefObject<(path: string, options?: LoadOptions) => void>;
    /** 编辑会话：回调与 effect 经此读到最新一份，
        既避免闭包过期，也让传给 memo 化 MarkdownDocument 的回调保持引用稳定 */
    editorRef: MutableRefObject<EditorHandle | null>;
  };
  /// 滚动恢复 / 落位
  scroll: {
    pendingScrollRef: MutableRefObject<number | null>;
    /** 热重载视口锚点：重载前记录的视口首个可见块元素及其相对偏移，
        渲染提交后按元素新位置补偿 scrollTop（内容不动），元素丢失时退回 pendingScrollRef 像素兜底 */
    pendingAnchorRef: MutableRefObject<ViewportAnchor | null>;
    /** 本次加载携带的 wikilink 片段（`[[目标#人读标题]]`）待跳转目标。ready 提交、正文
        进 DOM 之后才谈得上定位，故随加载记下、由 handleContentRendered 消费；
        消费即清空（命中与落空都清），加载失败也清——绝不留给下一次加载 */
    pendingFragmentRef: MutableRefObject<{ path: string; fragment: string } | null>;
    /** 后退/前进条目自带的阅读位置记录（与 pendingFragmentRef 同一时序：随本次加载记下、
        由 handleContentRendered 按路径命中后消费并清空，加载失败也清）。
        每次换文档的 loadPath 都会显式重设它（无记录即置 null），故残值不会跨到下一次加载；
        栈条目记的就是离开该文档时的位置，与持久化存储里那份同源，但不依赖那次写入成功 */
    pendingRestoreRef: MutableRefObject<{ path: string; record: ScrollPositionRecord } | null>;
    lastRestoredPathRef: MutableRefObject<string | null>;
    /** 恢复落位守护的取消函数（切换文档/重复恢复时终止上一段守护） */
    restoreCancelRef: MutableRefObject<(() => void) | null>;
    scrollSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
    /** 最近一次用户滚动输入（滚轮/触摸/按键/滚动条拖拽）时间戳：热重载恢复据此避让 */
    lastUserScrollAtRef: MutableRefObject<number>;
    shouldStickToBottomRef: MutableRefObject<boolean>;
    hasStuckToBottomRef: MutableRefObject<boolean>;
  };
  /// 布局过渡窗：侧边栏开关动画 / 拖宽期间，所有 widget iframe 随容器宽度集体重排，
  /// 若恰逢 mdlog 追加触发的热重载（整篇重解析），主线程被「过渡重排 + 解析提交」
  /// 双重工作饱和——页面完全卡死、过一会儿自愈（mdlog 连接中开关侧边栏卡死的根因）。
  /// 窗内：热重载延迟合并提交、程序化滚动恢复让位原生 scroll anchoring、iframe 高度
  /// 过渡关闭（消除 200ms 过渡的重排级联与子帧可滚动余量）。
  layout: {
    layoutShiftUntilRef: MutableRefObject<number>;
    layoutShiftTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
    reloadDeferTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
    /** 宽度过渡期的视口钉住（侧栏开关/拖宽 ⇒ 正文宽度变化 ⇒ 整篇行重排）。
        为什么必须自己钉：Chromium 原生滚动锚定不补偿行内尺寸变化驱动的重排（真机实测，
        纯容器瞬时改宽也 ΔscrollTop = 0），不钉就会「关侧栏页面闪到别处、开回来再闪回」。
        机制与分工见 lib/viewportPin.ts 头部注释。 */
    viewportPinRef: MutableRefObject<ViewportPin | null>;
  };
  /// mdlog 记录状态
  mdlog: {
    isMdlogActiveRef: MutableRefObject<boolean>;
    prevIsMdlogActiveRef: MutableRefObject<boolean>;
    activeMdlogPathRef: MutableRefObject<string | null>;
    recheckTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  };
  /// wikilink 前进/后退历史
  nav: {
    navHistoryRef: MutableRefObject<NavHistory>;
    /** 一次换文档是否仍在途：期间前进/后退**整体忽略**（不动栈、不发加载）。
        判据不能是「currentPathRef 是否等于目标」——那个 ref 只在加载成功时写入
        （loadPath 的 catch 与在途窗口里都还指着上一篇），拿它当「目标已在屏上」的替身
        会让后退/前进在错误页上变成互相抵消的空转。标志由「有文档重新显示」（ready 提交）
        或本次加载失败解除，故不会卡死 */
    navInFlightRef: MutableRefObject<boolean>;
    /** 大纲点击跳转的目标标题 id（动画期间锁定，见 handleSelectHeading） */
    outlineNavTargetRef: MutableRefObject<string | null>;
  };
  /// 整页视图（设置 / 导出）
  views: {
    isSettingsOpenRef: MutableRefObject<boolean>;
    isExportOpenRef: MutableRefObject<boolean>;
    /** 进入设置视图时取下的阅读位置：正文退出 DOM 期间它就是「当前阅读位置」——
        容器里滚的是设置内容，此刻再测容器量到的是设置页的偏移 */
    settingsScrollRecordRef: MutableRefObject<{ path: string; record: ScrollPositionRecord } | null>;
  };
};

/// 创建一次、终身稳定的运行时对象。各 ref 是普通 `{ current }` 盒——
/// 与 useRef 产物同构，可安全地交给 `ref={}` 与跨 effect/事件读取。
export function useAppRuntime(): AppRuntime {
  const holder = useRef<AppRuntime | null>(null);
  if (holder.current === null) {
    holder.current = {
      dom: {
        scrollRef: { current: null },
        contentRef: { current: null },
        documentContentRef: { current: null },
        searchInputRef: { current: null },
        librarySearchInputRef: { current: null },
      },
      doc: {
        currentPathRef: { current: null },
        documentGenerationRef: { current: 0 },
        currentMarkdownRef: { current: "" },
        wikilinksRef: { current: EMPTY_WIKILINKS },
        headingsRef: { current: [] },
        loadRequestRef: { current: 0 },
        loadPathRef: { current: () => {} },
        editorRef: { current: null },
      },
      scroll: {
        pendingScrollRef: { current: null },
        pendingAnchorRef: { current: null },
        pendingFragmentRef: { current: null },
        pendingRestoreRef: { current: null },
        lastRestoredPathRef: { current: null },
        restoreCancelRef: { current: null },
        scrollSaveTimerRef: { current: null },
        lastUserScrollAtRef: { current: 0 },
        shouldStickToBottomRef: { current: false },
        hasStuckToBottomRef: { current: false },
      },
      layout: {
        layoutShiftUntilRef: { current: 0 },
        layoutShiftTimerRef: { current: null },
        reloadDeferTimerRef: { current: null },
        viewportPinRef: { current: null },
      },
      mdlog: {
        isMdlogActiveRef: { current: false },
        prevIsMdlogActiveRef: { current: false },
        activeMdlogPathRef: { current: null },
        recheckTimerRef: { current: null },
      },
      nav: {
        navHistoryRef: { current: EMPTY_NAV_HISTORY },
        navInFlightRef: { current: false },
        outlineNavTargetRef: { current: null },
      },
      views: {
        isSettingsOpenRef: { current: false },
        isExportOpenRef: { current: false },
        settingsScrollRecordRef: { current: null },
      },
    };
  }
  return holder.current;
}
