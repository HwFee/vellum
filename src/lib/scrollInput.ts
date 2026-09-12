/**
 * 「用户滚动输入」的按键判定。
 *
 * 滚动容器上的 wheel / touchstart / scrollbar-drag 天然是滚动输入，
 * 但键盘要区分：Ctrl+K / Ctrl+E / Ctrl+S / Escape 这类快捷键不是滚动，
 * 若把任何 keydown 都记成滚动输入，热重载避让与宽度过渡期的视口钉住
 *（`viewportPin`）都会被当场误判成「用户接管」而收手——表现为
 * 用 Ctrl+K 开侧栏时页面照样跳（顶栏按钮路径却正常，因为那里没有 keydown）。
 *
 * 之所以单列成模块并用集合判定（而不是 `event.key.startsWith("Arrow")` 之类）：
 * 这份清单是行为契约——列表里漏一个键，对应按键的滚动就被静默忽略；
 * 多一个键，对应快捷键就静默失效。
 */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Spacebar",
  "Tab",
]);

export function isScrollKey(key: string): boolean {
  return SCROLL_KEYS.has(key);
}
