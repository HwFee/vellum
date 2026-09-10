export type DOMRectLike = { top: number; left: number; width: number; height: number };
export type OverlayBox = { top: number; left: number; width: number; minHeight: number };

/// 覆盖层（`.block-editor__input`）是 `.document-scroll__content` 的绝对定位子元素，
/// 故基准必须是该宿主容器自身：两个矩形都随滚动一起移动，相减即得稳定的相对坐标，
/// 不需要再叠加 scrollTop（裁定 F4：计划里的三参版本会差一个容器 padding/边框）。
export function computeOverlayBox(targetRect: DOMRectLike, hostRect: DOMRectLike): OverlayBox {
  return {
    top: targetRect.top - hostRect.top,
    left: targetRect.left - hostRect.left,
    width: targetRect.width,
    minHeight: Math.max(1, targetRect.height),
  };
}
