// 语言闸门：一条时间线、两套文案，由 composition 包一层 LocaleProvider 决定。
//
// 为什么不把 locale 当每个场景的 prop 一路传下去：场景有八层嵌套（场景 → 组件 → 组件），
// 逐层透传会在每个中间组件上多出一个它自己用不到的 prop。Context 在这里恰好合适——
// locale 在一整条时间线里是常量，不会变。
//
// 两件容易忘的事：
//   ① **素材也要分语言**：中文版的窗口截图带 zh- 前缀（capture/capture.mjs --lang zh），
//      用 useShot() 取，别直接写 staticFile("capture/01-…")。
//   ② **等宽字体没有汉字**：中文文案落到 mono 栈上会掉进系统 CJK 字体、行高与字重都对不上，
//      用 useMetaFont() 取「当前语言该用的元信息字族」。
import React from "react";
import { COPY_EN, COPY_ZH, MONO_STACK, SERIF_STACK, type Copy } from "./theme";

export type Locale = "en" | "zh";

const LocaleContext = React.createContext<Locale>("en");

export const LocaleProvider: React.FC<{ locale: Locale; children: React.ReactNode }> = ({
  locale,
  children,
}) => <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;

export const useLocale = (): Locale => React.useContext(LocaleContext);

/** 当前语言的文案。 */
export const useCopy = (): Copy => (useLocale() === "zh" ? COPY_ZH : COPY_EN);

/**
 * 素材名解析：给英文素材名，返回当前语言该用的**相对路径**。
 *
 * 注意返回的是相对路径而不是 staticFile() 结果：WindowShot / PlateScroll 内部
 * 自己会调 staticFile，把已经处理过的路径再传进去 Remotion 会抛
 * 「The value "/public/capture/…" is already …」（这个坑真被渲染到第 108 帧才发现）。
 * 需要完整 URL 的地方（如 <Img>）自己再包一层 staticFile()。
 */
const PER_LOCALE_SHOT = /^(0[1-9]|1[0-2])-/;

export const useShot = (): ((name: string) => string) => {
  const locale = useLocale();
  return (name: string) => {
    // 两种写法都收：裸文件名（01-window-reading.png）与带 capture/ 前缀的写法。
    // 场景里 LAYERS 表习惯写完整路径，早先不剥前缀时就成了 capture/capture/…，
    // 渲染到第 S5 场才报「Error loading image」——这里一劳永逸地归一。
    const bare = name.startsWith("capture/") ? name.slice("capture/".length) : name;
    return locale === "zh" && PER_LOCALE_SHOT.test(bare) ? `capture/zh-${bare}` : `capture/${bare}`;
  };
};

/** 元信息行的字族：中文用衬线（等宽栈没有汉字），英文保持等宽。 */
export const useMetaFont = (): string => (useLocale() === "zh" ? SERIF_STACK : MONO_STACK);
