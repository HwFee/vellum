import { useCallback, useEffect, useRef, useState } from "react";
import { animateScrollTo } from "../lib/smoothScroll";

type JumpToBottomProps = {
  containerRef: React.RefObject<HTMLElement | null>;
};

// 距底超过该像素才显示按钮（接近底部时自动隐去，不遮挡阅读）；
// mdlog 记录期间内容只往末尾追加，距底拉开时按钮随之浮现，点一下回到讨论现场
const SHOW_THRESHOLD_PX = 300;

function ArrowToBottomIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="3" x2="12" y2="15" />
      <polyline points="6 10 12 16 18 10" />
      <line x1="5" y1="20" x2="19" y2="20" />
    </svg>
  );
}

export function JumpToBottom({ containerRef }: JumpToBottomProps) {
  const [visible, setVisible] = useState(false);
  const rafRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const update = () => {
      rafRef.current = 0;
      const distance =
        container.scrollHeight - container.clientHeight - container.scrollTop;
      setVisible(distance > SHOW_THRESHOLD_PX);
    };
    const schedule = () => {
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(update);
      }
    };

    container.addEventListener("scroll", schedule, { passive: true });
    // 内容增长（mdlog 追加、图片/widget 撑高）不产生 scroll 事件，但会拉开距底距离
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    if (container.firstElementChild) {
      observer.observe(container.firstElementChild);
    }
    schedule();

    return () => {
      container.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [containerRef]);

  const jump = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // 与大纲跳转/位置恢复同一套缓动动画；动画期间用户滚轮/触摸/按键
    // 由 App 的全局监听取消动画让出控制权
    animateScrollTo(container, container.scrollHeight - container.clientHeight);
  }, [containerRef]);

  return (
    <button
      type="button"
      className={`jump-bottom ${visible ? "jump-bottom--visible" : ""}`}
      onClick={jump}
      aria-label="跳转到底部"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      title="跳转到底部"
    >
      <ArrowToBottomIcon />
    </button>
  );
}
