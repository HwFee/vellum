/// easeOutCubic：起步快、接近目标时逐渐减速，避免浏览器原生 smooth 滚动的匀速/急停感。
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// 每个滚动容器至多一段进行中的动画：新动画自动顶掉旧的（正文连续滚动时大纲跟随、
// 连续点大纲/搜索下一个时都靠这个保证动画接续而不是叠加）。
const activeAnimations = new WeakMap<HTMLElement, () => void>();

/** 取消容器上进行中的滚动动画（用户滚轮/触摸/按键时调用，把滚动控制权交还用户） */
export function cancelScrollAnimation(container: HTMLElement): void {
  activeAnimations.get(container)?.();
}

/**
 * 用 requestAnimationFrame 把容器平滑滚动到目标 scrollTop（先快后慢）。
 * 时长随距离自适应并封顶，返回取消函数；同一容器上的新动画会自动取消上一段。
 */
export function animateScrollTo(container: HTMLElement, targetTop: number): () => void {
  cancelScrollAnimation(container);
  const start = container.scrollTop;
  const delta = targetTop - start;
  if (delta === 0) return () => {};

  const duration = Math.min(900, 250 + Math.abs(delta) * 0.25);
  const startTime = performance.now();
  let rafId = 0;
  let finished = false;

  const cancel = () => {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(rafId);
    // 仅当 map 里存的还是本动画时才清除，避免误删后启动的动画
    if (activeAnimations.get(container) === cancel) {
      activeAnimations.delete(container);
    }
  };

  const step = (now: number) => {
    if (finished) return;
    const t = Math.min(1, (now - startTime) / duration);
    container.scrollTop = Math.round(start + delta * easeOutCubic(t));
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      finished = true;
      if (activeAnimations.get(container) === cancel) {
        activeAnimations.delete(container);
      }
    }
  };
  rafId = requestAnimationFrame(step);
  activeAnimations.set(container, cancel);

  return cancel;
}
