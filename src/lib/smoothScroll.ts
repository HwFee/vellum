/// easeOutCubic：起步快、接近目标时逐渐减速，避免浏览器原生 smooth 滚动的匀速/急停感。
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * 用 requestAnimationFrame 把容器平滑滚动到目标 scrollTop（先快后慢）。
 * 时长随距离自适应并封顶，返回取消函数；调用方负责在新动画启动前取消上一段。
 */
export function animateScrollTo(container: HTMLElement, targetTop: number): () => void {
  const start = container.scrollTop;
  const delta = targetTop - start;
  if (delta === 0) return () => {};

  const duration = Math.min(900, 250 + Math.abs(delta) * 0.25);
  const startTime = performance.now();
  let rafId = 0;

  const step = (now: number) => {
    const t = Math.min(1, (now - startTime) / duration);
    container.scrollTop = Math.round(start + delta * easeOutCubic(t));
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    }
  };
  rafId = requestAnimationFrame(step);

  return () => cancelAnimationFrame(rafId);
}
