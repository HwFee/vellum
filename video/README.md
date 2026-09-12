# Vellum · 素笺 宣传片（Remotion 工程）

30 秒 / 1920×1080 / 30 fps 的产品宣传片，以及配套的静态海报帧。
片子里出现的每一帧界面都是**真实运行的 Vellum 窗口**（CDP 抓取），
不是重画的示意稿；颜色、字体、文案与仓库根 `DESIGN.md` 同源。

```
npm i                 # 安装依赖（Remotion 4）
npm run assets        # ① 同步字体 ② 合成配乐 ③ CDP 抓取真实界面素材（英文）
npm run capture:zh    # 中文演示文档的界面素材（zh- 前缀，与英文那套共存）
npm run dev           # Remotion Studio 逐场景预览（改分镜时用）
npm run render        # 出片 → out/vellum-promo.mp4（含配乐）
npm run render:silent # 出片 → out/vellum-promo-silent.mp4（无需配乐的嵌入用）
npm run typecheck     # tsc --noEmit
```

## 中英两版

一条时间线、两套文案：`VellumPromo`（英文）与 `VellumPromoZh`（中文）。
语言由 `src/locale.tsx` 的 `LocaleProvider` 通过 context 下发，场景用 `useCopy()` 取文案、
`useShot()` 取素材（中文版用 `capture/zh-*.png`）、`useMetaFont()` 取元信息字族
（**等宽字体没有汉字**，中文元信息行必须退回衬线栈）。

中文版不是逐字直译：字幕按中文字数重写，标点用全角；演示文档也另写了一份
`assets/demo.zh.md`（顶栏会显示文件名 `纸的界面.md`）——对一个以今楷中文排版为卖点的
产品来说，中文版片子里出现一份英文文档是本末倒置的。

```
npx remotion render VellumPromo   out/vellum-promo.mp4
npx remotion render VellumPromoZh out/vellum-promo-zh.mp4
```

导出对外分发的那一套时，中文海报帧直接从正片合成取帧（场景在 `TransitionSeries` 里各自
从 0 计帧，所以要用全局帧号：**S1 起点 0 / S3 276 / S5 542 / S6 690**，
已用 `cmp` 验证过「正片第 371 帧 == 单独渲染 `S3-PaperScroll` 第 95 帧」逐字节相同）。

## 分镜

| # | 合成 ID | 帧数 | 画面 |
|---|---------|------|------|
| 1 | `S1-ColdOpen` | 120 | 落墨：一道横划写出，标题落到纸上 |
| 2 | `S2-TheWindow` | 180 | 阅读面本体，聚光落在正文列 |
| 3 | `S3-PaperScroll` | 150 | 全高长图推进：标题、代码、公式、表格 |
| 4 | `S4-OutlineSearch` | 140 | 大纲与全文检索（Ctrl+K） |
| 5 | `S5-EditInPlace` | 160 | 块级就地编辑三段状态交叉溶解 |
| 6 | `S6-LiveBlocks` | 112 | 沙箱交互块 → 一份真实的 mdlog 会话日志 |
| 7 | `S7-EndCard` | 110 | 品牌与下载信息 |

转场 12 帧、与相邻场景**重叠**，所以 7 场之和（972）比成片（900 帧 = 30 秒）多出 6 × 12。
`Root.tsx` 里另有 7 个单场合成，便于只渲染一场来核对画面。

## 素材管线（`npm run assets`）

```
public/fonts/*.woff2   ← scripts/sync-fonts.mjs   （从仓库根 public/fonts 复制，不入库）
public/music.wav       ← audio/make-music.mjs     （纯 Node 合成，不入库）
public/capture/*.png   ← capture/capture.mjs      （CDP 抓真实窗口，不入库）
public/capture/zh-*.png ← capture/capture.mjs --lang zh（中文演示文档，同上一行脚本）
```

三者都是**生成物**，已由 `.gitignore` 排除；换机器后跑一次 `npm run assets` 即可重建。

`capture/capture.mjs` 会用 CDP 驱动一份 release 版 `vellum.exe`，抓两组素材：

- **窗口图**（1440×900 @ dsf 2，2880×1800）：阅读 / 搜索 / 公式 / 代码 / 交互块占位与加载 /
  编辑三段状态 / 日志文档首页。
- **全高长图**（`02-article-plate` 2360×6856、`15-log-plate` 2360×8542）：
  抓取时临时把视口撑到全文高度，让整篇真正布局出来再截。

两个关键决定写在脚本头部注释里，改动前务必先读：

1. **长图用「撑高视口」而不是 `captureBeyondViewport`**——`.document-scroll` 是 `overflow:auto` 的滚动盒，
   盒外再截只能得到纸色空白。
2. **滚动交给 Remotion 逐帧推进，而不是录屏**——截图的耗时不可控、帧间隔会抖；
   一张全高图按帧号推进则是确定性的，缓动与停顿能精确到帧。

脚本会先 `taskkill` 既有实例：并存实例会互相抢占远程调试端口。

## 渲染期的两个约束

- **字体闸门**（`src/fonts.ts`）：仓耳今楷 8.4MB × 2，任何一帧抢在 `document.fonts.load` 之前
  都会被 Chrome 画成回退字体（症状：中文是今楷、英文变成几何无衬线）。
  `useBrandFontsGate()` 必须挂在**真正画画面的组件**里——`PaperBackground` 是每场的底，
  因此闸门落在那里；只挂在 `Root.tsx` 上不够。排障用 `FontProbe` 合成。
- **不带 CSS 动画**：Remotion 逐帧截图，CSS transition/keyframes 根本不会被采样。
  所有运动都由 `useCurrentFrame()` 驱动。

## 配乐

`audio/make-music.mjs` 是零依赖的纯 Node 合成器（44.1kHz / 16bit 立体声 WAV）：
pad 用数个微失谐正弦叠出、1.7s 慢起音；bass 是根音下方八度；motif 是稀疏的“电钢”动机；
空间用 Schroeder 混响（4 comb + 3 allpass）。版权干净、时长精确对齐分镜、不引入外部资产。

## 目录

```
src/theme.ts              品牌 token 与中英文两套文案（单一事实来源）
src/locale.tsx            语言闸门：LocaleProvider / useCopy / useShot / useMetaFont
src/fonts.ts              字体加载与渲染闸门
src/VellumPromo.tsx       成片时间线（TransitionSeries）
src/Root.tsx              合成注册
src/scenes/*.tsx          七场分镜
src/SocialCard.tsx        社交分享卡（1280×640，中英各一张）
src/components/*.tsx      Caption / PaperBackground / WindowShot·Spotlight·PlateScroll·Highlight
capture/capture.mjs       CDP 抓真实界面素材（--lang zh 抓中文那套）
capture/probe-edit.mjs    编辑视图几何探针（排障用）
audio/make-music.mjs      配乐合成
scripts/sync-fonts.mjs    字体同步
```

成片不会入库（`out/` 已忽略）；对外分发的那一套放在仓库根的 `promo/assets/`，
由 `node promo/build-assets.mjs` 从成片重新编码、压缩导出。
