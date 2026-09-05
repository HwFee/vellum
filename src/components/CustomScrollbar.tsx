import { useEffect, useRef, useState } from "react";

type CustomScrollbarProps = {
  containerRef: React.RefObject<HTMLElement | null>;
  contentRef: React.RefObject<HTMLElement | null>;
};

export function CustomScrollbar({ containerRef, contentRef }: CustomScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbHeight, setThumbHeight] = useState(0);
  const [thumbTop, setThumbTop] = useState(0);
  const hideTimeoutRef = useRef<number | undefined>(undefined);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  function show() {
    setVisible(true);
    window.clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = window.setTimeout(() => {
      if (!draggingRef.current) {
        setVisible(false);
      }
    }, 1000);
  }

  function updateThumb() {
    const container = containerRef.current;
    if (!container || container.clientHeight === 0 || container.scrollHeight === 0) return;

    const trackHeight = container.clientHeight;
    const contentHeight = container.scrollHeight;
    const scrollable = Math.max(0, contentHeight - trackHeight);

    const height = Math.max((trackHeight / contentHeight) * trackHeight, 24);
    const top = scrollable > 0 ? (container.scrollTop / scrollable) * (trackHeight - height) : 0;
    setThumbHeight(height);
    setThumbTop(top);
  }

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef?.current;
    if (!container) return;

    let mounted = true;

    function handleScroll() {
      updateThumb();
      show();
    }

    function handleMouseEnter() {
      updateThumb();
      show();
    }

    function handleMouseLeave() {
      if (!draggingRef.current) {
        setVisible(false);
      }
    }

    function handleMouseMove(event: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;

      // 检测鼠标是否在容器右侧 24px 范围内
      const rect = container.getBoundingClientRect();
      const isNearRight =
        event.clientX >= rect.right - 24 &&
        event.clientX <= rect.right + 4 &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (isNearRight) {
        show();
      }
    }

    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("mouseenter", handleMouseEnter);
    container.addEventListener("mouseleave", handleMouseLeave);
    document.addEventListener("mousemove", handleMouseMove);

    const resizeObserver = new ResizeObserver(() => {
      updateThumb();
    });
    resizeObserver.observe(container);
    if (content) {
      resizeObserver.observe(content);
    }

    // 等布局和字体加载完成后再计算并显示一次
    function initialShow() {
      updateThumb();
      const c = containerRef.current;
      if (c && c.scrollHeight > c.clientHeight) {
        show();
      }
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (mounted) initialShow();
      });
    });

    if (document.fonts) {
      void document.fonts.ready.then(() => {
        if (mounted) initialShow();
      });
    }

    return () => {
      mounted = false;
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("mouseenter", handleMouseEnter);
      container.removeEventListener("mouseleave", handleMouseLeave);
      document.removeEventListener("mousemove", handleMouseMove);
      resizeObserver.disconnect();
      window.clearTimeout(hideTimeoutRef.current);
      // 拖拽过程中卸载时移除 document 级拖拽监听，避免泄漏
      dragCleanupRef.current?.();
    };
  }, [containerRef, contentRef]);

  function handleThumbMouseDown(event: React.MouseEvent) {
    event.preventDefault();
    draggingRef.current = true;
    dragStartYRef.current = event.clientY;
    const container = containerRef.current;
    dragStartScrollTopRef.current = container?.scrollTop ?? 0;

    // 拖 thumb 是直接写 container.scrollTop，不会像滚轮/触摸/按键那样产生输入事件。
    // 阅读位置恢复的「落位守护」与任何程序化滚动动画都需要在接管瞬间知道这件事，
    // 否则下一次内容尺寸变化会把用户刚拖走的位置重新拉回锚点。事件在滚动容器上
    // 派发并允许冒泡，使仅监听容器或仅监听 document 的消费方都能收到。
    container?.dispatchEvent(new CustomEvent("vellum:scrollbar-drag", { bubbles: true }));

    function handleMouseMove(moveEvent: MouseEvent) {
      const container = containerRef.current;
      if (!container) return;

      const trackHeight = container.clientHeight;
      const contentHeight = container.scrollHeight;
      const thumbHeight = Math.max((container.clientHeight / contentHeight) * trackHeight, 24);
      const scrollableTrack = trackHeight - thumbHeight;
      const scrollableContent = contentHeight - trackHeight;

      if (scrollableTrack <= 0 || scrollableContent <= 0) return;

      const deltaY = moveEvent.clientY - dragStartYRef.current;
      const ratio = deltaY / scrollableTrack;
      container.scrollTop = Math.max(0, Math.min(scrollableContent, dragStartScrollTopRef.current + ratio * scrollableContent));
    }

    function handleMouseUp() {
      draggingRef.current = false;
      setVisible(false);
      removeDragListeners();
    }

    function removeDragListeners() {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      dragCleanupRef.current = null;
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    dragCleanupRef.current = removeDragListeners;
  }

  function handleTrackClick(event: React.MouseEvent) {
    const container = containerRef.current;
    const thumb = thumbRef.current;
    if (!container || !thumb) return;

    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    const thumbRect = thumb.getBoundingClientRect();
    const thumbTopRelative = thumbRect.top - rect.top;
    const thumbHeight = thumbRect.height;

    if (clickY < thumbTopRelative) {
      container.scrollTop -= container.clientHeight * 0.8;
    } else if (clickY > thumbTopRelative + thumbHeight) {
      container.scrollTop += container.clientHeight * 0.8;
    }
  }

  return (
    <div
      ref={trackRef}
      className={`custom-scrollbar ${visible ? "custom-scrollbar--visible" : ""}`}
      onClick={handleTrackClick}
    >
      <div
        ref={thumbRef}
        className="custom-scrollbar__thumb"
        style={{ height: thumbHeight, top: thumbTop }}
        onMouseDown={handleThumbMouseDown}
      />
    </div>
  );
}
