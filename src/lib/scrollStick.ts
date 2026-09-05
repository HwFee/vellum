/**
 * 判定容器当前滚动位置是否处于视口底部附近（剩余未滚出距离 <= 阈值）。
 * @param scrollHeight 容器总滚动高度
 * @param scrollTop 容器当前滚动位移
 * @param clientHeight 容器可视高度
 * @param threshold 判定阈值像素，默认 80px
 */
export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold = 80
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

/**
 * 判定 DOM 滚动容器是否处于底部附近。
 */
export function isContainerNearBottom(container: HTMLElement, threshold = 80): boolean {
  return isNearBottom(container.scrollHeight, container.scrollTop, container.clientHeight, threshold);
}
