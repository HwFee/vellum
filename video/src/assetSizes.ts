// 由 video/capture/capture.mjs 抓出的素材尺寸（PNG 原生像素）。
// 供 PlateScroll / Ken Burns 精确计算位移，避免在渲染期读图测尺寸。
export const PLATE_ARTICLE = { width: 2360, height: 6856 } as const;
export const PLATE_LOG = { width: 2360, height: 8542 } as const;
export const WINDOW = { width: 2880, height: 1800 } as const;
