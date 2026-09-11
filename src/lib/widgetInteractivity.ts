/**
 * 判定 widget 是否包含交互逻辑，供宿主决定 iframe 是否放行指针事件。
 *
 * 背景（滚动卡住的根因修复）：滚轮手势命中跨源沙箱 iframe 时会被 Chromium
 * scroll-latch 锁进子帧——子帧文档只要存在几 px 可滚动余量（高度过渡窗口、
 * 字体后加载撑高内容、2000px 截断），整个手势期内父容器完全收不到滚动，
 * 表现为「指针在图上滚动卡住、图微微移动、停 1-2 秒自愈」。
 * 静态 SVG 图（mdlog 契约的默认形态）不需要任何指针交互，把 iframe 的
 * pointer-events 关掉即可让命中测试穿透 iframe、手势直接落在滚动容器上。
 *
 * 2026-09-11 补充：交互 widget 不能关指针事件，改由宿主在服务响应期注入
 * `html{overflow:hidden !important}` 根溢出保护（Rust `widget.rs`
 * `WIDGET_ROOT_SCROLL_GUARD`）——根文档不是滚动盒后，跨源子帧同样无法被
 * scroll-latch 锁住。本判定只决定「静态图是否额外获得指针穿透」，不再是
 * 锁存修复的唯一手段，但依旧保持保守（宁可多放行，不错杀可交互 widget）。
 *
 * 判定保守化：通信 IIFE（契约 5）之外的任何脚本、内联 on*= 处理器、表单控件、
 * <a href>、<canvas>（可能有 hover/拖拽）一律视为交互——宁可多放行指针，
 * 也不错杀一个可交互 widget。
 */

// 契约 5 通信 IIFE 的逐字形态（允许空白差异）：<script> 里只有它、没有别的逻辑时，
// 该 script 块不算交互。签名是上报消息类型 vellum-widget:resize。
const COMM_IIFE_PATTERN = /\(function\s*\(\s*\)\s*\{[\s\S]*?vellum-widget:resize[\s\S]*?\}\s*\)\s*\(\s*\)\s*;?/g;

export function isWidgetInteractive(html: string): boolean {
  // 先按逐字形态摘除通信 IIFE 本身（不是整段 <script>——同块里若还有别的逻辑，
  // 剩下的内容照样会被下面的检查捕获），再检查是否残留实质脚本
  const stripped = html.replace(COMM_IIFE_PATTERN, "");
  const scriptBlocks = stripped.match(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi) ?? [];
  for (const block of scriptBlocks) {
    if (/\bsrc\s*=/i.test(block)) return true; // 外链脚本（CSP 会拦，仍按交互保守处理）
    const inner = block.replace(/<script\b[^>]*>/i, "").replace(/<\/script\s*>/i, "").trim();
    if (inner !== "") return true;
  }
  // 内联事件处理器（onclick= / onload= / onmouseenter= …）
  if (/\son[a-z]+\s*=/i.test(stripped)) return true;
  // 原生可交互元素
  if (/<(button|input|select|textarea|details|summary|canvas|video|audio)\b/i.test(stripped)) {
    return true;
  }
  // 超链接
  if (/<a\b[^>]*\bhref\s*=/i.test(stripped)) return true;
  return false;
}
