/**
 * 导出为 PDF 的页面几何（2026-09-21）。
 * 纸张与边距是模板常量、不是用户选项——对齐上游 kami 的 WeasyPrint 模板
 * （tw93/kami · references/production.md：A4 纵向、margin 20mm 22mm、宣纸底色）。
 * 屏幕预览（纸张舞台的缩放纸页）与打印底稿（Chromium printToPDF 的 PrintSettings）
 * 共用这份常量，两处不各自换算，避免漂移。
 */

/// CSS 像素换算：96dpi（Chromium 打印管线同样以 96dpi 为 CSS 单位基准）
export const MM_TO_CSS_PX = 96 / 25.4;

export const EXPORT_PAGE = {
  widthPx: 210 * MM_TO_CSS_PX,
  heightPx: 297 * MM_TO_CSS_PX,
  marginXPx: 22 * MM_TO_CSS_PX,
  marginYPx: 20 * MM_TO_CSS_PX,
} as const;

/// 页内版心：预览的测量容器宽度、分页算法的页容量都取自这里
export const EXPORT_CONTENT_WIDTH_PX = EXPORT_PAGE.widthPx - 2 * EXPORT_PAGE.marginXPx;
export const EXPORT_CONTENT_HEIGHT_PX = EXPORT_PAGE.heightPx - 2 * EXPORT_PAGE.marginYPx;
