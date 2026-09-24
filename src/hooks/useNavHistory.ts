import { useCallback, useState } from "react";
import {
  EMPTY_NAV_HISTORY,
  pushNav,
  resetForward,
  stepBack,
  stepForward,
  type NavEntry,
  type NavHistory,
} from "../lib/navHistory";
import { captureScrollPosition } from "../lib/scrollRestore";
import type { AppRuntime } from "./useAppRuntime";

export type Nav = {
  navHistory: NavHistory;
  /// wikilink 换文档压入 back 并清空 forward（加载成功后由 loadPath 调用）
  pushNavEntry: (entry: NavEntry) => void;
  /// 「新导航」只作废 forward，back 留给用户退回来处
  resetForwardStack: () => void;
  handleNavBack: () => void;
  handleNavForward: () => void;
};

/**
 * wikilink 前进/后退历史（原 App.tsx「===== wikilink 前进/后退历史 =====」一节）。
 * 只有 wikilink 换文档入栈（判据与两栈方向见 lib/navHistory.ts 的模块注释）；
 * 条目自带离开时的三级位置记录，落位复用 scrollRestore.ts 的既有管线。
 */
export function useNavHistory(rt: AppRuntime): Nav {
  const [navHistory, setNavHistory] = useState<NavHistory>(EMPTY_NAV_HISTORY);
  // 后退/前进的回调必须**空依赖**（快捷键 effect 的依赖表要稳、顶栏按钮不该每次渲染换引用），
  // 故栈与当前位置都经 ref 读最新一份——与 loadPathRef/editorRef 同一套路
  const { navHistoryRef, navInFlightRef } = rt.nav;
  navHistoryRef.current = navHistory;
  const { currentPathRef, headingsRef, loadPathRef } = rt.doc;
  const { scrollRef, contentRef } = rt.dom;

  const pushNavEntry = useCallback(
    (entry: NavEntry) => {
      const next = pushNav(navHistoryRef.current, entry);
      navHistoryRef.current = next;
      setNavHistory(next);
    },
    [navHistoryRef]
  );

  const resetForwardStack = useCallback(() => {
    const next = resetForward(navHistoryRef.current);
    if (next !== navHistoryRef.current) {
      navHistoryRef.current = next;
      setNavHistory(next);
    }
  }, [navHistoryRef]);

  /// 后退/前进一步：当前文档 + 当前位置互换进另一侧栈，再经 loadPath 打开目标文档
  const stepNav = useCallback(
    (direction: "back" | "forward") => {
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
    },
    [navInFlightRef, currentPathRef, scrollRef, navHistoryRef, headingsRef, contentRef, loadPathRef]
  );

  const handleNavBack = useCallback(() => stepNav("back"), [stepNav]);
  const handleNavForward = useCallback(() => stepNav("forward"), [stepNav]);

  return { navHistory, pushNavEntry, resetForwardStack, handleNavBack, handleNavForward };
}
