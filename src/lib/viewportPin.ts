import { captureViewportAnchor, restoreViewportAnchor } from "./viewportAnchor";

/**
 * 宽度过渡期的视口钉住。
 *
 * 根因（真机 CDP 实测，2026-09）：侧栏开关/拖宽只改正文**宽度**，正文按新宽度重新
 * 断行 ⇒ 整篇文档高度变化（本项目实测 ±3965px）。而 Chromium 原生滚动锚定对
 * 「行内尺寸变化驱动的重排」一律不补偿——合成对照里一个纯 1000px 滚动容器瞬时改宽
 * 也是 ΔscrollTop = 0（同一个容器改字号、插块则正常补偿）。于是 scrollTop 原地不动，
 * 视口里的内容整段平移到别处：关侧栏往上跳约 3600px，开回来又跳回去，观感就是
 * 「页面闪到别的地方、开回侧栏又恢复」。
 *
 * 所以这里自己钉：事件入口先用 captureViewportAnchor 记下「视口顶部首个可见顶层块 +
 * 其相对偏移」（此刻仍是旧布局），随后在过渡窗内逐帧按该锚点补偿 scrollTop。
 * 每帧的补偿量都是按「当前 rect 与记录偏移的差」绝对求解，故与浏览器自身的锚定
 * 互不叠加、可反复执行；用户一旦滚动接管即立刻收手。
 *
 * 与既有的分工：viewportAnchor 提供捕获/补偿原语（热重载用同一对），
 * smoothScroll 负责缓动动画（本模块只写 scrollTop，不做动画）。
 */

/** 钉住开始后，用户滚动输入在此时长内仍算「接管中」（交还控制权） */
const USER_TAKEOVER_GRACE_MS = 150;

export interface ViewportPinOptions {
  /** 过渡窗结束时刻（performance.now() 基准）。每次调用重新求值，拖宽续窗即自动延长 */
  until: () => number;
  /** 最近一次用户滚动输入的时间戳（与 performance.now() 同一基准） */
  lastUserScrollAt: () => number;
}

export interface ViewportPin {
  /** 立即补偿一次（须在绘制前同步调用，如 useLayoutEffect）；返回是否真的改写了 scrollTop */
  applyNow: () => boolean;
  /** 结束钉住（用户接管、组件卸载、被新一次钉住顶掉） */
  stop: () => void;
}

export function startViewportPin(
  container: HTMLElement,
  contentRoot: HTMLElement,
  options: ViewportPinOptions
): ViewportPin {
  const startedAt = performance.now();
  const anchor = captureViewportAnchor(container, contentRoot);
  let stopped = false;
  let rafId: number | null = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  /// 只认「本轮钉住开始之后」的输入：启动前的时间戳（含初始 0）不算接管，
  /// 否则应用启动初期开关侧栏会被误判
  const userTookOver = (now: number) => {
    const last = options.lastUserScrollAt();
    return last > startedAt && now - last < USER_TAKEOVER_GRACE_MS;
  };

  const correct = () =>
    anchor !== null && !stopped ? restoreViewportAnchor(container, anchor) : false;

  const step = () => {
    rafId = null;
    if (stopped) return;
    const now = performance.now();
    if (userTookOver(now)) {
      stop();
      return;
    }
    correct();
    if (now < options.until()) {
      rafId = requestAnimationFrame(step);
    } else {
      // 窗口结束：本帧已按最终布局贴齐，不再续帧
      stopped = true;
    }
  };

  if (anchor !== null) {
    rafId = requestAnimationFrame(step);
  }

  return {
    applyNow: () => {
      if (stopped || anchor === null) return false;
      if (userTookOver(performance.now())) {
        stop();
        return false;
      }
      return correct();
    },
    stop,
  };
}
