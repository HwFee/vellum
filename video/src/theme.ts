// 品牌 token 与文案：单一事实来源。
//
// 颜色 / 字体逐字取自仓库根目录 DESIGN.md 的 kami 设计语言，视频里的纸墨底、
// 靛青强调、衬线标题因此与应用本身完全同源——片子里出现的每一处颜色都能在
// DESIGN.md 里找到对应 token。
export const COLORS = {
  parchment: "#f5f4ed",
  ivory: "#faf9f5",
  primary: "#1B365D",
  nearBlack: "#141413",
  darkWarm: "#3d3d3a",
  olive: "#504e49",
  stone: "#6b6a64",
  warmSand: "#e8e6dc",
  hairline: "#dddacc",
  border: "#e8e6dc",
  inlineCodeBg: "#f0eee6",
} as const;

export const FONT_SERIF = "TsangerJinKai02";
export const FONT_MONO = "JetBrains Mono";

/** 衬线字体栈：与应用 kami.css 的回退链一致。 */
export const SERIF_STACK = `${FONT_SERIF}, "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", Georgia, serif`;
export const MONO_STACK = `${FONT_MONO}, "SF Mono", Consolas, monospace`;

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  /** 30 秒 */
  durationInFrames: 900,
} as const;

/** 场景时长（帧）。含转场重叠，总计 = 900 + 6 × TRANSITION。 */
export const SCENES = {
  TRANSITION: 12,
  coldOpen: 120,
  theWindow: 180,
  paperScroll: 150,
  outlineSearch: 140,
  editInPlace: 160,
  liveBlocks: 112,
  endCard: 110,
} as const;

export const COPY = {
  title: "Vellum",
  titleZh: "素笺",
  tagline: "A warm, parchment-toned Markdown viewer for Windows.",
  subtitle:
    "Serif body type. Warm paper. One ink-blue accent. Built for reading long documents on a desktop.",
  captions: {
    theWindow: "Markdown, typeset like paper.",
    paperScroll: "Headings, code, math, tables — rendered, not approximated.",
    outlineSearch: "Long documents, mapped. Find anything, jump to it.",
    editInPlace: "Edit in place — click a block, type, done.",
    liveBlocks: "Sandboxed interactive blocks. Stream a live log from your agent.",
    endCard: "Built for focused reading.",
  },
  end: {
    repo: "github.com/HwFee/vellum",
    license: "Free and open source · MIT",
    platform: "Windows 10 / 11 · 7 MB installer",
  },
} as const;
