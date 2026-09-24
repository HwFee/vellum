import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { matchHeadingByFragment } from "../lib/outline";
import { isSamePath } from "../lib/path";
import { saveScrollPosition, type ScrollPositionRecord } from "../lib/scrollMemory";
import { extractWikilinkTargets } from "../lib/wikilink";
import { isContainerNearBottom } from "../lib/scrollStick";
import { captureViewportAnchor } from "../lib/viewportAnchor";
import type { MdlogState } from "../lib/mdlogState";
import type { DocumentState, LoadedDocument } from "../types";
import { EMPTY_WIKILINKS, type AppRuntime, type LoadOptions } from "./useAppRuntime";

export type DocumentLoaderDeps = {
  /// 换文档时退出设置视图（整页视图钩子）
  closeSettings: () => void;
  /// 当前阅读位置的三级记录（滚动位置钩子）
  currentScrollRecord: () => ScrollPositionRecord | null;
  /// 自引用片段（`[[本笔记#标题]]`）与目标文档片段命中后的缓动跳转
  scrollHeadingIntoView: (id: string) => void;
  /// wikilink 换文档压入 back 并清空 forward（加载成功后调用）
  pushNavEntry: (entry: { path: string; record: ScrollPositionRecord }) => void;
  /// 「新导航」只作废 forward
  resetForwardStack: () => void;
  /// 「成功打开」的单一收口：最近打开列表置顶
  addRecentTop: (path: string) => void;
  /// 打不开的条目从最近列表摘掉
  removeRecentTop: (path: string) => void;
  /// 加载成功路径的 mdlog 状态写入（state + 活跃路径 + 复査调度）
  applyLoadedMdlogState: (liveState: MdlogState | null, path: string) => void;
  /// mdlog 状态置回（加载失败兜底写 null）
  setMdlogState: (state: MdlogState | null) => void;
  /// 切换文档时重置 mdlog 活跃路径与前置标志
  resetMdlogForSwitch: () => void;
};

export type DocumentLoader = {
  state: DocumentState;
  setState: (state: DocumentState) => void;
  /// state.ready ? state.document : undefined —— JSX 与下游 hook 的共用派生
  activeDocument: LoadedDocument | undefined;
  reloadTick: number;
  showReloadNote: boolean;
  loadPath: (path: string, options?: LoadOptions) => Promise<void>;
  reloadCurrent: (preloaded?: LoadedDocument) => Promise<void>;
  handleOpen: () => Promise<void>;
  /// 文档 markdown 的唯一写入点（编辑提交的内存侧）
  applyMarkdown: (next: string) => void;
  /// 落盘（提交即落盘，规格 §7.1）
  saveMarkdown: (next: string) => Promise<void>;
  handleActivateUnit: (index: number, caretOffset: number) => void;
  handleOpenWikilink: (path: string, target: string, fragment?: string) => void;
  handleToggleEdit: () => void;
  handleToggleTask: (itemStart: number) => void;
};

/**
 * 文档加载管线：loadPath（换文档编排）、reloadCurrent（静默热重载）、
 * wikilink 解析、状态机、markdown 写入点、传给 memo 化正文的稳定回调
 * （原 App.tsx 的 resolveWikilinks / loadPath / reloadCurrent / handleOpen /
 * applyMarkdown / saveMarkdown / 四个 editorRef 包装 / fresh-ink 提示）。
 *
 * loadPath / reloadCurrent / handleOpen 都是 useCallback 稳定引用：函数体只读
 * rt ref 与各域钩子返回的稳定回调，下游 effect 可以安全地列进依赖表而不重跑。
 */
export function useDocumentLoader(rt: AppRuntime, deps: DocumentLoaderDeps): DocumentLoader {
  const { currentPathRef, documentGenerationRef, currentMarkdownRef, wikilinksRef, headingsRef, loadRequestRef, loadPathRef, editorRef } = rt.doc;
  const { pendingAnchorRef, pendingFragmentRef, pendingRestoreRef, restoreCancelRef, shouldStickToBottomRef, hasStuckToBottomRef, pendingScrollRef } = rt.scroll;
  const { layoutShiftUntilRef, reloadDeferTimerRef } = rt.layout;
  const { isMdlogActiveRef } = rt.mdlog;
  const { navInFlightRef } = rt.nav;
  const { isSettingsOpenRef, isExportOpenRef } = rt.views;
  const { scrollRef, contentRef, documentContentRef } = rt.dom;
  const { closeSettings, currentScrollRecord, scrollHeadingIntoView, pushNavEntry, resetForwardStack, addRecentTop, removeRecentTop, applyLoadedMdlogState, setMdlogState, resetMdlogForSwitch } = deps;

  const [state, setState] = useState<DocumentState>({ status: "empty" });
  const [reloadTick, setReloadTick] = useState(0);
  const [showReloadNote, setShowReloadNote] = useState(false);

  /**
   * 把文档里出现过的 wikilink 目标一次性交给后端解析（祖先目录逐级向上找 → 自动补
   * 扩展名 → 全库唯一 basename 兜底）。返回「目标 → 绝对路径 / null」的表。
   *
   * 无 wikilink 的文档不发 IPC（返回空表）；**IPC 失败会抛**，由调用方决定怎么降级——
   * 首次打开退化成空表（全部按未解析渲染成纯文本 + 提示，正文照常可读），
   * 热重载则保留原有表（一次抖动不该把已经点得动的链接降级）。
   */
  const resolveWikilinks = useCallback(
    async (path: string, markdown: string): Promise<ReadonlyMap<string, string | null>> => {
      const targets = extractWikilinkTargets(markdown);
      if (targets.length === 0) return EMPTY_WIKILINKS;
      const resolved = await invoke<Record<string, string | null>>("resolve_wikilinks", {
        fromPath: path,
        targets,
      });
      return new Map(Object.entries(resolved ?? {}));
    },
    []
  );

  /// 热重载：静默重新读取当前文档，不闪烁 loading 态、不弹错误、保留滚动位置。
  /// preloaded：调用方已读到的磁盘内容（回声抑制的预读），避免同一事件读盘两次
  const reloadCurrent = useCallback(
    async (preloaded?: LoadedDocument) => {
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
    },
    [currentPathRef, layoutShiftUntilRef, reloadDeferTimerRef, loadRequestRef, scrollRef, isMdlogActiveRef, shouldStickToBottomRef, pendingScrollRef, pendingAnchorRef, contentRef, documentGenerationRef, wikilinksRef, resolveWikilinks, navInFlightRef]
  );

  const loadPath = useCallback(
    async (path: string, options: LoadOptions = {}) => {
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
      // 换文档时退出设置视图（顺序不能提前：上面那次测量读的正是设置视图期间留下的
      // 位置记录——先清掉再测就会量到设置内容的偏移）。读者要的是新文档，不是设置页
      closeSettings();
      // 切换文档时重置 mdlog 活跃路径与前置标志，避免切换过渡时误触发断开补写
      resetMdlogForSwitch();
      // 终止上一篇文档可能仍在进行的恢复落位守护
      restoreCancelRef.current?.();
      restoreCancelRef.current = null;
      // 挂起的延迟热重载随文档切换作废（切走后应重读的是新文档，由下方加载负责）
      if (reloadDeferTimerRef.current !== null) {
        clearTimeout(reloadDeferTimerRef.current);
        reloadDeferTimerRef.current = null;
      }
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
            pushNavEntry({ path: outgoingPath, record: outgoingRecord });
          }
        } else if (source === "direct") {
          resetForwardStack();
        }
        // 「成功打开」的单一收口：最近打开列表在此置顶（列表状态与持久化同步更新）
        addRecentTop(document.path);

        try {
          const liveState = await invoke<MdlogState | null>("read_mdlog_state");
          if (loadRequestRef.current === requestId) {
            applyLoadedMdlogState(liveState, document.path);
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
        removeRecentTop(path);
      }
    },
    [editorRef, currentPathRef, reloadCurrent, headingsRef, scrollHeadingIntoView, currentScrollRecord, closeSettings, resetMdlogForSwitch, restoreCancelRef, reloadDeferTimerRef, shouldStickToBottomRef, hasStuckToBottomRef, pendingAnchorRef, loadRequestRef, pendingFragmentRef, pendingRestoreRef, navInFlightRef, documentGenerationRef, resolveWikilinks, pushNavEntry, resetForwardStack, addRecentTop, applyLoadedMdlogState, setMdlogState, removeRecentTop]
  );

  const handleOpen = useCallback(async () => {
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
  }, [loadPath]);

  // 打开文档函数的稳定引用：wikilink 点击回调要在**空依赖**下还能调到最新一份 loadPath
  // （它闭包了 state 与各个 ref，直接捕获会被 memo 化正文钉在首帧那一份上）
  loadPathRef.current = loadPath;

  const activeDocument = state.status === "ready" ? state.document : undefined;
  currentMarkdownRef.current = activeDocument?.markdown ?? "";
  wikilinksRef.current = state.status === "ready" ? state.wikilinks : EMPTY_WIKILINKS;

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
  const saveMarkdown = useCallback(
    async (next: string) => {
      const path = currentPathRef.current;
      if (!path) throw new Error("No document is loaded");
      await invoke("save_document", { path, content: next });
    },
    [currentPathRef]
  );

  // 传给 memo 化 MarkdownDocument 的回调必须引用稳定（性能结构约束）：
  // 用空依赖 + editorRef 读最新会话，避免每次按键/每次状态变化都换新引用
  const handleActivateUnit = useCallback(
    (index: number, caretOffset: number) => {
      editorRef.current?.activateUnit(index, caretOffset);
    },
    [editorRef]
  );

  // 点名库内链接：走与「打开文件」完全相同的加载路径（提交活动块、保存上一篇阅读位置、
  // 重置编辑会话、恢复位置）。片段（`#标题`）随路径一起交给 loadPath：目标文档进 DOM 后
  // 由 handleContentRendered 按同一套缓动路径跳转。同款空依赖 + ref 读最新函数，
  // 保住 memo 化正文的引用稳定。
  // 来源标成 wikilink：这是**唯一**会进历史栈的导航（同文档自引用由 loadPath 的同路径
  // 分支拦下，不换文档也就不入栈）
  const handleOpenWikilink = useCallback(
    (path: string, _target: string, fragment?: string) => {
      void loadPathRef.current(path, { fragment, source: "wikilink" });
    },
    [loadPathRef]
  );

  // 设置视图里点铅笔同样不切视图：正文不在 DOM 里，切了也看不见；静默改掉 viewMode
  // 只会让「返回阅读」时落在编辑态（与 Ctrl+E 分支同款守卫，两处必须一致）
  const handleToggleEdit = useCallback(() => {
    if (isSettingsOpenRef.current || isExportOpenRef.current) return;
    void editorRef.current?.toggleView();
  }, [isSettingsOpenRef, isExportOpenRef, editorRef]);

  // 阅读视图里点任务列表复选框：与块激活同一套路（空依赖 + editorRef 读最新会话），
  // 保住 memo 化正文的 components 引用稳定（否则每次渲染都重走解析管线）
  const handleToggleTask = useCallback(
    (itemStart: number) => {
      void editorRef.current?.toggleTask(itemStart);
    },
    [editorRef]
  );

  // 只读块（HTML / 交互块）在编辑视图里由「加粗灰色虚线框 + not-allowed 指针」表达，
  // 不再弹文字提示（2026-09-10 设计定稿：零文字浮层）——因此这里没有 locked 点击处理器。

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
  }, [reloadTick, isMdlogActiveRef, documentContentRef]);

  return {
    state,
    setState,
    activeDocument,
    reloadTick,
    showReloadNote,
    loadPath,
    reloadCurrent,
    handleOpen,
    applyMarkdown,
    saveMarkdown,
    handleActivateUnit,
    handleOpenWikilink,
    handleToggleEdit,
    handleToggleTask,
  };
}
