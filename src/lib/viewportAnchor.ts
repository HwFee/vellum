/**
 * 热重载视口锚点：在文档内容被替换前，记录「视口顶部第一个可见的顶层块元素」
 * 及其顶边相对滚动容器顶边的像素偏移；重载渲染提交后按该元素的新位置补偿
 * scrollTop，使屏幕上显示的内容保持不动（内容不动，而非像素不动）。
 *
 * 为什么不用像素恢复：热重载会让整篇文档重排版，视口上方内容的高度一旦同步
 * 变化（流式代码块在围栏闭合时收合成 widget 占位块、图片声明尺寸等），旧像素
 * 值在新布局下对应的是另一处内容，直接恢复像素会看到页面跳动；且程序化的像素
 * 覆盖会顶掉 Chromium 原生滚动锚定（overflow-anchor）本可给出的补偿。
 *
 * 与 scrollRestore.ts 的分工：scrollRestore 负责「打开文档时按历史记录恢复」
 * （锚点标题 + 偏移 + 比例兜底 + 落位守护）；本模块只服务「同一文档热重载」的
 * 瞬时保持，元素引用随 React 复用 DOM 节点而存活，不读写持久化存储，互不耦合。
 */

export interface ViewportAnchor {
  /** 捕获时位于视口顶部的顶层块元素（React 重渲染通常复用同一 DOM 节点） */
  el: Element;
  /** 捕获时锚点元素顶边 − 滚动容器顶边 的像素差（元素在容器顶上方为负） */
  delta: number;
}

/**
 * 捕获当前视口锚点：contentRoot 内 .markdown-body（缺省时为 contentRoot 自身）
 * 的顶层子元素中，第一个底边越过容器顶的元素。全部元素都在视口上方（理论上
 * 不可能，只要有可见内容）时返回 null，调用方退回像素恢复。
 */
export function captureViewportAnchor(
  container: HTMLElement,
  contentRoot: HTMLElement
): ViewportAnchor | null {
  const containerTop = container.getBoundingClientRect().top;
  const scope = contentRoot.querySelector(".markdown-body") ?? contentRoot;
  for (const el of Array.from(scope.children)) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > containerTop + 1) {
      return { el, delta: rect.top - containerTop };
    }
  }
  return null;
}

/**
 * 按锚点恢复：补偿锚点元素的位移，使屏幕内容保持不动。直接设置 scrollTop
 * （不走动画，必须在绘制前同步完成，由调用方放在 layout effect 中执行）。
 * 锚点元素已被移除（热重载恰好编辑了该块）时返回 false，调用方退回像素恢复。
 */
export function restoreViewportAnchor(
  container: HTMLElement,
  anchor: ViewportAnchor
): boolean {
  if (!anchor.el.isConnected) return false;
  const drift =
    anchor.el.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    anchor.delta;
  if (Math.abs(drift) >= 1) {
    // 赋值越界时浏览器自动夹取到 [0, scrollHeight - clientHeight]，无需手工 clamp
    container.scrollTop += drift;
  }
  return true;
}
