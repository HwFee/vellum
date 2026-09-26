import { useEffect, useRef, useState } from "react";

type ImageViewerProps = {
  src: string;
  alt: string;
  onClose: () => void;
};

const SCALE_MIN = 1;
const SCALE_MAX = 5;
/// 每档滚轮的缩放倍率
const WHEEL_FACTOR = 1.15;

/**
 * 图片点击查看器：点击正文图片后由 MarkdownImage 经 createPortal 挂到 document.body。
 * 宣纸底近全屏遮罩（非深色灯箱）：滚轮 1→5 倍缩放、放大后指针拖拽平移、
 * 双击图片 1↔2 倍切换，Esc / 点纸面背底关闭。
 * Esc 走 window 捕获阶段监听并 stopPropagation：窄屏「Escape 关侧栏」是 window
 * 冒泡监听，不拦的话一次 Esc 会把侧栏连带关掉。
 */
export function ImageViewer({ src, alt, onClose }: ImageViewerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScaleState] = useState(SCALE_MIN);
  const [translate, setTranslateState] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  // 事件监听器（wheel / document pointermove）按挂载期注册、生命周期内不重建，
  // 读到的是首帧闭包——缩放与平移的当前值另存一份 ref 给它们用
  const scaleRef = useRef(SCALE_MIN);
  const translateRef = useRef({ x: 0, y: 0 });
  // 放大后拖拽收尾（在图片上按下、拖到背底上松手）会在背底补一发 click：
  // 靠这个标记分辨「点背底关闭」与「拖拽收尾」，拖拽过的那次 click 不关闭
  const dragMovedRef = useRef(false);

  const applyScale = (raw: number) => {
    const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw));
    scaleRef.current = next;
    setScaleState(next);
    // 缩回 1 倍时平移归零——残留位移会让「未放大」的图偏出居中位
    if (next === SCALE_MIN) applyTranslate({ x: 0, y: 0 });
  };
  const applyTranslate = (next: { x: number; y: number }) => {
    translateRef.current = next;
    setTranslateState(next);
  };

  // 接管焦点：挂载时聚焦对话框（Esc / 滚轮的焦点语义都挂在这棵树上），卸载归还
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus();
    return () => previous?.focus();
  }, []);

  // Esc 关闭：捕获阶段 + preventDefault + stopPropagation，挡住窄屏
  // 「Escape 关侧栏」这类 window 冒泡监听——一次按键只关查看器一层
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  // 滚轮缩放必须 passive:false 才能 preventDefault：不拦会让正文（document-scroll）
  // 跟着滚，看图的人一松手就找不到原来的位置
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      applyScale(scaleRef.current * (event.deltaY < 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR));
    }
    root.addEventListener("wheel", handleWheel, { passive: false });
    return () => root.removeEventListener("wheel", handleWheel);
  }, []);

  // 点背底（事件落在对话框根元素本身，而非图片）关闭；拖拽收尾的那发 click 不关闭
  function handleBackdropClick(event: React.MouseEvent<HTMLDivElement>) {
    // portal 的合成事件沿 React 树冒泡回正文祖先（如编辑视图里 article 的块激活）：到此为止
    event.stopPropagation();
    const wasDrag = dragMovedRef.current;
    dragMovedRef.current = false;
    if (event.target !== event.currentTarget || wasDrag) return;
    onClose();
  }

  // 放大后的指针拖拽平移：移动/抬手挂在 document 上（指针拖出图片仍要继续跟手，
  // 不依赖 setPointerCapture——jsdom 与旧 WebView 都不保证实现）
  function handleImagePointerDown(event: React.PointerEvent<HTMLImageElement>) {
    if (scaleRef.current <= SCALE_MIN) return;
    // 拦掉图片原生拖曳与文本选择的起点
    event.preventDefault();
    dragMovedRef.current = false;
    const startX = event.clientX;
    const startY = event.clientY;
    const base = translateRef.current;
    setDragging(true);
    const onMove = (moveEvent: PointerEvent) => {
      dragMovedRef.current = true;
      applyTranslate({ x: base.x + moveEvent.clientX - startX, y: base.y + moveEvent.clientY - startY });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setDragging(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  // 双击图片在 1 ↔ 2 倍之间切换，平移归零回到居中
  function handleImageDoubleClick() {
    applyTranslate({ x: 0, y: 0 });
    applyScale(scaleRef.current > SCALE_MIN ? SCALE_MIN : 2);
  }

  return (
    <div
      ref={rootRef}
      className="image-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={alt || "图片"}
      tabIndex={-1}
      onClick={handleBackdropClick}
    >
      <img
        className={"image-viewer__img" + (dragging ? " image-viewer__img--dragging" : "")}
        src={src}
        alt={alt}
        draggable={false}
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
          cursor: scale > SCALE_MIN ? (dragging ? "grabbing" : "grab") : "zoom-in",
        }}
        onPointerDown={handleImagePointerDown}
        onDoubleClick={handleImageDoubleClick}
      />
    </div>
  );
}
