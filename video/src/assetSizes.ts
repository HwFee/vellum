// 由 video/capture/capture.mjs 抓出的素材尺寸（PNG 原生像素）。
// 供 PlateScroll / Ken Burns 精确计算位移，避免在渲染期读图测尺寸。
export const PLATE_ARTICLE = { width: 2360, height: 6856 } as const;
export const PLATE_LOG = { width: 2360, height: 8542 } as const;
export const WINDOW = { width: 2880, height: 1800 } as const;

// 中文版演示文档（video/assets/demo.zh.md）的正文长图：中文比英文紧凑，整篇短一截。
// 数字来自 capture/capture.mjs --lang zh 的抓取日志（clip 1180×3217 @ dsf 2）。
export const PLATE_ARTICLE_ZH = { width: 2360, height: 6434 } as const;
