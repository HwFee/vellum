import { useCallback, useEffect, useLayoutEffect } from "react";
import { matchHeadingByFragment } from "../lib/outline";
import { isSamePath } from "../lib/path";
import { isScrollInputKey } from "../lib/scrollInput";
import { cancelScrollAnimation } from "../lib/smoothScroll";
import { loadScrollPosition } from "../lib/scrollMemory";
import { restoreScrollPosition } from "../lib/scrollRestore";
import { restoreViewportAnchor } from "../lib/viewportAnchor";
import type { AppRuntime } from "./useAppRuntime";

export type ScrollMemory = {
  /// MarkdownDocument 内容渲染进 DOM 后的落位入口（片段跳转 > 栈携带记录 > 持久化记录）
  handleContentRendered: () => void;
};

/**
 * 阅读位置记忆与热重载滚动仲裁（原 App.tsx 的 handleContentRendered /
 * 用户滚动输入监听 / 防抖保存 + beforeunload / 热重载仲裁 layout effect）。
 */
export function useScrollMemory(
  rt: AppRuntime,
  deps: {
    persistCurrentScroll: () => void;
    scrollHeadingIntoView: (id: string) => void;
    /// 热重载仲裁的重跑触发（原文档 markdown 与 reloadTick）
    markdown: string | undefined;
    reloadTick: number;
  }
): ScrollMemory {
  const { scrollRef, contentRef } = rt.dom;
  const { currentPathRef, headingsRef } = rt.doc;
  const {
    pendingScrollRef,
    pendingAnchorRef,
    pendingFragmentRef,
    pendingRestoreRef,
    lastRestoredPathRef,
    restoreCancelRef,
    scrollSaveTimerRef,
    lastUserScrollAtRef,
    shouldStickToBottomRef,
    hasStuckToBottomRef,
  } = rt.scroll;
  const { layoutShiftUntilRef } = rt.layout;
  const { persistCurrentScroll, scrollHeadingIntoView } = deps;

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
    let recordPromise: Promise<import("../lib/scrollMemory").ScrollPositionRecord | null>;
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
  }, [scrollRef, currentPathRef, lastRestoredPathRef, pendingFragmentRef, headingsRef, pendingRestoreRef, hasStuckToBottomRef, shouldStickToBottomRef, contentRef, restoreCancelRef, scrollHeadingIntoView]);

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
  }, [scrollRef, lastUserScrollAtRef]);

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
  }, [scrollRef, scrollSaveTimerRef, persistCurrentScroll]);

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
  }, [deps.markdown, deps.reloadTick, scrollRef, lastUserScrollAtRef, layoutShiftUntilRef, shouldStickToBottomRef, pendingScrollRef, pendingAnchorRef, hasStuckToBottomRef, contentRef, restoreCancelRef, headingsRef]);

  return { handleContentRendered };
}
