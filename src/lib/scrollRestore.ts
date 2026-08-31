import { animateScrollTo, cancelScrollAnimation } from "./smoothScroll";
import type { ScrollPositionRecord } from "./scrollMemory";
import type { OutlineHeading } from "../types";

// 恢复落位守护的最长时长：覆盖图片/字体异步加载导致的布局稳定期
const SETTLE_GUARD_MS = 5000;
// 尺寸抖动重锚定的最短间隔，避免连续图片加载触发过多动画
const REANCHOR_MIN_INTERVAL_MS = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function headingElement(id: string): HTMLElement | null {
  const el = document.getElementById(id);
  return el instanceof HTMLElement ? el : null;
}

/**
 * 记录当前阅读位置：视口顶部最近的标题作为锚点 + 相对偏移，附比例兜底。
 * 锚点取「最后一个顶边不高于视口顶的标题」；页面在首个标题之前时取第一个标题
 * （偏移为负），内容在前面增删时仍能落在附近。
 */
export function captureScrollPosition(
  container: HTMLElement,
  headings: OutlineHeading[]
): ScrollPositionRecord {
  const max = container.scrollHeight - container.clientHeight;
  const ratio = max > 0 ? clamp(container.scrollTop / max, 0, 1) : 0;
  const record: ScrollPositionRecord = { ratio };
  if (headings.length === 0) return record;

  const containerTop = container.getBoundingClientRect().top;
  let anchor: { id: string; index: number; top: number } | null = null;

  for (let i = 0; i < headings.length; i++) {
    const el = headingElement(headings[i].id);
    if (!el) continue;
    const top = el.getBoundingClientRect().top;
    if (top <= containerTop + 1) {
      if (!anchor || top > anchor.top) {
        anchor = { id: headings[i].id, index: i, top };
      }
    } else if (!anchor) {
      // 视口顶上方没有任何标题：锚定第一个标题（偏移为负），随后 break 之前的
      // 标题都更远，无需继续
      anchor = { id: headings[i].id, index: i, top };
      break;
    } else {
      break;
    }
  }

  if (anchor) {
    record.anchorId = anchor.id;
    record.anchorIndex = anchor.index;
    record.offset = Math.round(containerTop - anchor.top);
  }
  return record;
}

/**
 * 按记录解析锚点元素：
 * 1. anchorId 直接命中 → 用之；
 * 2. 该标题被删/改名 → 以 anchorIndex 为中心向两侧找文档顺序上最近幸存的标题；
 * 3. 都没有 → null（调用方退回比例兜底）。
 */
export function resolveAnchorElement(
  record: ScrollPositionRecord,
  headings: OutlineHeading[]
): HTMLElement | null {
  if (record.anchorId) {
    const el = headingElement(record.anchorId);
    if (el) return el;
  }
  const index = record.anchorIndex;
  if (index === undefined || headings.length === 0) return null;

  const start = Math.min(Math.round(index), headings.length - 1);
  for (let d = 0; d < headings.length; d++) {
    const forward = headings[start + d];
    if (forward) {
      const el = headingElement(forward.id);
      if (el) return el;
    }
    const backward = headings[start - d];
    if (d > 0 && backward) {
      const el = headingElement(backward.id);
      if (el) return el;
    }
    if (start + d >= headings.length - 1 && start - d <= 0) break;
  }
  return null;
}

/**
 * 恢复阅读位置，并在布局稳定前守护落点。
 *
 * 间歇性恢复失败的根因：恢复是一次性按「比例 × 当时 scrollHeight」计算像素目标，
 * 但图片（占位符 → 异步解析 → loading=lazy 的 <img> 无宽高）与字体加载会撑大
 * scrollHeight、推动内容下移，目标点随之漂移。这里在初次恢复后用 ResizeObserver
 * 盯住内容尺寸，一旦变化就按锚点重新定位，直到布局稳定。
 *
 * 守护结束条件（先到为准）：用户滚轮/触摸/按键接管、超过 SETTLE_GUARD_MS、
 * 返回的取消函数被调用（切换文档/组件卸载）。
 */
export function restoreScrollPosition(
  container: HTMLElement,
  contentEl: HTMLElement,
  record: ScrollPositionRecord,
  headings: OutlineHeading[]
): () => void {
  const computeTarget = (): number => {
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    const anchor = resolveAnchorElement(record, headings);
    if (anchor) {
      const offset = record.offset ?? 0;
      const target =
        container.scrollTop +
        (anchor.getBoundingClientRect().top - container.getBoundingClientRect().top) +
        offset;
      return clamp(Math.round(target), 0, max);
    }
    return clamp(Math.round(record.ratio * max), 0, max);
  };

  let done = false;
  let lastReanchor = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    container.removeEventListener("wheel", endByUser);
    container.removeEventListener("touchstart", endByUser);
    window.removeEventListener("keydown", endByUser);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  // 用户主动接管：结束守护并停掉进行中的动画，避免动画与用户输入拉扯
  const endByUser = () => {
    cleanup();
    cancelScrollAnimation(container);
  };

  const observer = new ResizeObserver(() => {
    if (done) return;
    const now = performance.now();
    if (now - lastReanchor < REANCHOR_MIN_INTERVAL_MS) return;
    const target = computeTarget();
    if (Math.abs(target - container.scrollTop) <= 1) return;
    lastReanchor = now;
    // 同容器新动画自动顶掉旧的，从当前位置接续，无跳变
    animateScrollTo(container, target);
  });

  animateScrollTo(container, computeTarget());
  observer.observe(contentEl);
  container.addEventListener("wheel", endByUser, { passive: true });
  container.addEventListener("touchstart", endByUser, { passive: true });
  window.addEventListener("keydown", endByUser);
  timer = setTimeout(cleanup, SETTLE_GUARD_MS);

  return cleanup;
}
