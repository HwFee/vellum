// 字体加载：复用应用 public/fonts/ 里的同两个字体文件（仓耳今楷 W04/W05 +
// JetBrains Mono），所以片中的中文标题、正文与代码与应用渲染像素同源。
//
// 踩过的坑（症状：标题的中文是今楷、英文变成几何无衬线体，而正文里的中文正常）：
// **那是字体还没加载完就先截了帧**，不是字体缺拉丁字形。仓耳今楷 8.4MB，Remote
// 渲染每秒要截几十帧，任何一帧抢在 `document.fonts.load` 之前都会被 Chrome 画成
// 回退字体。诊断方法写在 `src/probe-fonts.tsx`：它把 `document.fonts` 的每个面的
// status 直接画到图上（现在稳定是 `TsangerJinKai02/400/loaded`）。
//
// 所以真正的约束是：**每个合成都要在字体就位后再渲染**。
// `useBrandFontsGate()` 就是这个闸门，必须挂在真正渲染画面的组件里——只挂在
// Root.tsx 上不够：Remotion 渲染单个 composition 时，Root 那一遍的 delayRender
// 句柄不一定拦得住目标合成的那一遍。
import { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

const STYLE_ID = "vellum-brand-fonts";

const CSS = `
@font-face {
  font-family: "TsangerJinKai02";
  src: url("${staticFile("fonts/TsangerJinKai02-W04.woff2")}") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "TsangerJinKai02";
  src: url("${staticFile("fonts/TsangerJinKai02-W05.woff2")}") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: block;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("${staticFile("fonts/JetBrainsMono.woff2")}") format("woff2");
  font-weight: 400 500;
  font-style: normal;
  font-display: block;
}
`;

const PROBE_TEXT = "The Paper Interface 素笺 Vellum — A warm, parchment-toned viewer 0123";

/** 排障用：每次渲染都会把字体加载实况记在这里，供 FontProbe 画到图上。 */
export const fontDiagnostics: string[] = [];

let started: Promise<unknown> | null = null;

export const loadBrandFonts = () => {
  started ??= (async () => {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    // 逐面显式加载：中文字体 8.4MB×2，必须等真的 loaded 再放行，否则首帧是回退字体
    await Promise.all([
      document.fonts.load('400 16px "TsangerJinKai02"', PROBE_TEXT),
      document.fonts.load('500 16px "TsangerJinKai02"', PROBE_TEXT),
      document.fonts.load('400 16px "JetBrains Mono"', PROBE_TEXT),
      document.fonts.load('500 16px "JetBrains Mono"', PROBE_TEXT),
    ]);
    await document.fonts.ready;
    if (fontDiagnostics.length === 0) {
      fontDiagnostics.push(
        `faces: ${[...document.fonts]
          .map((f) => `${f.family}/${f.weight}/${f.status}`)
          .join("  ")}`
      );
      fontDiagnostics.push(
        `check 400=${document.fonts.check('400 16px "TsangerJinKai02"', "Vellum")} ` +
          `500=${document.fonts.check('500 16px "TsangerJinKai02"', "Vellum")}`
      );
    }
  })();
  return started;
};

/**
 * 把当前合成挂起，直到品牌字体真的可用。
 * 任何「直接画到画布上」的组件都必须调用它（见文件头注释）。
 */
export const useBrandFontsGate = (): void => {
  const [handle] = useState(() => delayRender("加载品牌字体"));
  useEffect(() => {
    let done = false;
    loadBrandFonts()
      .catch(() => undefined)
      .finally(() => {
        if (done) return;
        done = true;
        continueRender(handle);
      });
  }, [handle]);
};
