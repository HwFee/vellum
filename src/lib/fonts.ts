import { invoke } from "@tauri-apps/api/core";

/// 字体三槽：中文 / 西文 / 代码。槽位只决定「写哪个 CSS 变量、用哪条兜底尾巴」，
/// 不改候选表本身——候选表是「随包字体 + 本机已装字体」，三槽共用。
export type FontSlot = "cjk" | "latin" | "mono";

export interface SystemFont {
  name: string;
  /// 该字体支持 CJK 字符集（Rust 侧按 charset 枚举判定）；只用于排序与标签
  cjk: boolean;
  /// 等宽（Rust 侧按 FIXED_PITCH 判定）；同上，只影响排序与标签
  mono: boolean;
}

/// 每个槽位对应的根 CSS 变量（useReaderSettings 覆写它们；空值 = 不覆写）
export const FONT_SLOT_VAR: Record<FontSlot, string> = {
  cjk: "--font-cjk",
  latin: "--font-latin",
  mono: "--font-mono",
};

/// 未选字面：空串是「默认」的表示——不覆写变量，由 kami.css 的回退承接
export const FONT_SLOT_DEFAULT = "";

/// 随包字体（`public/fonts/`）：应用只带这两款，任何环境下都在候选表里。
/// 楷体是正文与界面的出厂字面，JetBrains Mono 是代码槽的出厂字面。
export const BUNDLED_FONTS: readonly SystemFont[] = [
  { name: "TsangerJinKai02", cjk: true, mono: false },
  { name: "JetBrains Mono", cjk: false, mono: true },
];

/// 字体名长度上限：字号之外的字段都做一次收紧，读盘来的脏值不至于把变量刷爆
const FONT_NAME_MAX = 96;

/**
 * 字体名清洗：只留可安全塞进 CSS 自定义属性值里的字符。
 * 引号 / 反斜杠会被 quoteFontFamily 转义，这里直接剔除 `" \ ; { }` 与控制字符
 * ——字体名里本不该有它们，留着只会让变量值变成一段可疑的声明片段。
 */
export function sanitizeFontName(value: unknown): string {
  if (typeof value !== "string") return FONT_SLOT_DEFAULT;
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["\\;{}]/g, "")
    .trim()
    .slice(0, FONT_NAME_MAX);
}

/// 字面加引号（含 `"` / `\` 的转义）：字体族名可能带空格或中文，一律带引号进栈
export function quoteFontFamily(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * 槽位变量值：`"字面", <兜底>`。
 * - 中文槽：尾巴是 --font-cjk-tail（思源宋 → 宋体 → 西文兜底）；
 * - 西文槽：兜底接回 --font-cjk——西文字面没有汉字字形，汉字必须落回中文槽；
 * - 代码槽：尾巴是 --font-mono-tail（再带一层汉字回退）。
 * 尾巴由 CSS 端着（kami.css :root），JS 只写「字面 + 接尾巴」，两边不各自维护一份。
 */
export function fontSlotValue(slot: FontSlot, name: string): string {
  const quoted = quoteFontFamily(name);
  if (slot === "cjk") return `${quoted}, var(--font-cjk-tail)`;
  if (slot === "mono") return `${quoted}, var(--font-mono-tail)`;
  return `${quoted}, var(--font-cjk)`;
}

function byName(a: SystemFont, b: SystemFont): number {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

/// 候选表平铺序：当前选中项最先（再开面板时它就在抬眼处），随包两款紧随，
/// 其余按名字。不分组不分类——字体不分家，三槽共用同一张全表；「默认」项
/// 由调用方补在最前。选中名不在候选表里（脏值 / 已卸载）也按名塞进去露脸。
export function flatFontOptions(
  fonts: readonly SystemFont[],
  selected: string
): SystemFont[] {
  const seen = new Set<string>();
  const out: SystemFont[] = [];
  const push = (font: SystemFont) => {
    const key = font.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(font);
  };
  if (selected) {
    const hit = fonts.find((font) => font.name === selected);
    push(hit ?? { name: selected, cjk: false, mono: false });
  }
  const bundledNames = new Set(BUNDLED_FONTS.map((font) => font.name));
  for (const font of fonts) if (bundledNames.has(font.name)) push(font);
  for (const font of [...fonts].sort(byName)) if (!bundledNames.has(font.name)) push(font);
  return out;
}

/// 搜索过滤（大小写不敏感的子串匹配）；空格分词，逐词命中
export function filterFonts(fonts: readonly SystemFont[], query: string): SystemFont[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...fonts];
  return fonts.filter((font) => {
    const name = font.name.toLowerCase();
    return terms.every((term) => name.includes(term));
  });
}

/// 按名去重合并：随包字体在表里时以随包那份为准（保留 cjk 标记与「随包」标签）
export function mergeFonts(
  bundled: readonly SystemFont[],
  system: readonly SystemFont[]
): SystemFont[] {
  const seen = new Set<string>();
  const merged: SystemFont[] = [];
  for (const font of [...bundled, ...system]) {
    const key = font.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(font);
  }
  return merged;
}

/// 本机字体缓存的当前值（null = 还没拉过）
let systemFontsCache: SystemFont[] | null = null;
let systemFontsInflight: Promise<SystemFont[]> | null = null;

/**
 * 拉取本机已装字体（Rust 的 `list_system_fonts`），与随包字体合并后返回。
 * 进程内只拉一次（字体表不会在应用运行中变），失败回退出厂表（只有随包两款）
 * ——拿不到系统字体只是选项少了，不该让设置页报错。
 */
export function loadSystemFonts(): Promise<SystemFont[]> {
  if (systemFontsCache) return Promise.resolve(systemFontsCache);
  if (systemFontsInflight) return systemFontsInflight;
  // async IIFE 而不是直接接 .then：非 Tauri 环境（vitest/jsdom、浏览器预览）里
  // invoke 本身就不存在，同步抛出的 TypeError 只有在 await 里才会变成 rejection
  systemFontsInflight = (async () => {
    try {
      const fonts = await invoke<SystemFont[]>("list_system_fonts");
      const list = mergeFonts(BUNDLED_FONTS, Array.isArray(fonts) ? fonts : []);
      systemFontsCache = list;
      return list;
    } catch (error) {
      console.warn("list_system_fonts failed:", error);
      systemFontsCache = mergeFonts(BUNDLED_FONTS, []);
      return systemFontsCache;
    } finally {
      systemFontsInflight = null;
    }
  })();
  return systemFontsInflight;
}

/// 闲时预热候选表：设置页打开时 picker 直接吃到全量本机字体，不再先只摆随包两款
/// 再跳全量。进程内仍只拉一次——重复调用是空操作。
export function prefetchSystemFonts(): void {
  const schedule =
    typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback.bind(window)
      : (cb: () => void) => setTimeout(cb, 0);
  schedule(() => {
    void loadSystemFonts();
  });
}

/// 测试用：清掉缓存与在途请求
export function __resetSystemFontsForTest(): void {
  systemFontsCache = null;
  systemFontsInflight = null;
}
