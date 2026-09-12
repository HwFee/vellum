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

export type Copy = {
  title: string;
  titleZh: string;
  tagline: string;
  subtitle: string;
  /** 开场底行：英文版走等宽大写，中文版走衬线宽字距（见 useMetaFont） */
  heroMeta: string;
  /** 社交分享卡的一句话主张 */
  cardLede: string;
  /** 社交分享卡底行元信息 */
  cardMeta: string;
  captions: {
    theWindow: string;
    paperScroll: string;
    outlineSearch: string;
    editInPlace: string;
    liveBlocks: string;
    endCard: string;
  };
  end: {
    repo: string;
    license: string;
    platform: string;
  };
};

/** 英文版（默认）。 */
export const COPY_EN: Copy = {
  title: "Vellum",
  titleZh: "素笺",
  tagline: "A warm, parchment-toned Markdown viewer for Windows.",
  subtitle:
    "Serif body type. Warm paper. One ink-blue accent. Built for reading long documents on a desktop.",
  heroMeta: "Windows 10 / 11 · offline · free",
  cardLede: "Markdown, typeset like paper.",
  cardMeta: "Windows 10 / 11 · offline · MIT",
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
};

/**
 * 中文版。
 *
 * 字幕不是逐字直译：中文字幕一行装得下的信息比英文多，逐字译会显得比画面长。
 * 另外注意——**标点用全角**（、——，…），这是中文排印的基本体面，也是这个产物
 * 在讲的事（见仓库根 DESIGN.md 的「中文内容优先按中文排印习惯处理」）。
 */
export const COPY_ZH: Copy = {
  title: "Vellum",
  titleZh: "素笺",
  tagline: "Windows 上的纸墨 Markdown 阅读器。",
  subtitle: "今楷正文、暖纸底色、一笔靛青。为读完一篇长文而做。",
  heroMeta: "Windows 10 / 11 · 离线可用 · 免费开源",
  cardLede: "给 Markdown 一张纸。",
  cardMeta: "Windows 10 / 11 · 离线可用 · MIT",
  captions: {
    theWindow: "Markdown，也按纸的规矩排版。",
    paperScroll: "标题、代码、公式、表格——是排出来的，不是凑出来的。",
    outlineSearch: "长文档有一张地图：找得到，也跳得到。",
    editInPlace: "就地编辑——点开一块，改完即存。",
    liveBlocks: "沙箱交互块，以及 agent 的现场日志。",
    endCard: "为读完一篇长文而做。",
  },
  end: {
    repo: "github.com/HwFee/vellum",
    license: "开源免费 · MIT 许可",
    platform: "Windows 10 / 11 · 7 MB 安装包",
  },
};
