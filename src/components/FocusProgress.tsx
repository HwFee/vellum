import { useEffect, useRef, type MutableRefObject } from "react";

/**
 * 专注模式顶缘的 2px 阅读进度线（C2「留一线」）：发丝轨上走一段靛青，
 * 宽度 = 已读比例。scroll 监听经 rAF 节流后直接写 style，不进 React 重渲染。
 * 只在专注态挂载（App 层条件渲染）；peek 顶栏滑回时由 CSS 藏掉（顶栏盖住它）。
 */
export function FocusProgress({
  containerRef,
}: {
  containerRef: MutableRefObject<HTMLDivElement | null>;
}) {
  const fillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const fill = fillRef.current;
    if (!container || !fill) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const max = container.scrollHeight - container.clientHeight;
      fill.style.width = `${max > 0 ? (container.scrollTop / max) * 100 : 0}%`;
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [containerRef]);

  return (
    <div className="focus-progress" aria-hidden="true">
      <span ref={fillRef} className="focus-progress__fill" />
    </div>
  );
}
