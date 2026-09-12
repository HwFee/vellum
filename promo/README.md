# Vellum · 素笺 宣传品

这一份是产品的对外材料：一枚 30 秒宣传片、一张落地页、一组海报帧与分享卡。
界面像素全部来自**真实运行的 Vellum**（CDP 抓取），配色与字体逐条对齐仓库根 `DESIGN.md`，
所以宣传品与应用看起来是同一个东西——因为它们本来就是同一个东西。

## 目录

| 文件 | 用途 |
|------|------|
| `index.html` | 落地页。单文件、内联 CSS、零依赖，双击即开 |
| `assets/vellum-promo.mp4` | 正片 1920×1080 / 30 fps / 30 s（含配乐） |
| `assets/vellum-promo.gif` | 9 秒循环（13.6→22.6 s：长图推进 → 大纲搜索 → 就地编辑），README 用 |
| `assets/social-preview.png` | 社交分享卡 1280×640（Open Graph / GitHub Social Preview） |
| `assets/poster-title.jpg` | 海报帧 · 开场落墨 |
| `assets/poster-rendering.jpg` | 海报帧 · 排版全貌（标题 / 公式 / 代码 / 表格） |
| `assets/poster-edit.jpg` | 海报帧 · 块级就地编辑 |
| `assets/poster-session.jpg` | 海报帧 · 现场会话日志 |
| `assets/window-reading.png` | 真实窗口截图 · 阅读视图（2880×1800） |
| `assets/window-search.png` | 真实窗口截图 · 大纲与全文检索 |
| `assets/window-editing.png` | 真实窗口截图 · 激活块的编辑面 |
| `assets/window-widget.png` | 真实窗口截图 · 沙箱交互块 |
| `build-assets.mjs` | 从 `video/` 的成片导出上面这一整套 |

## 重新生成

```bash
# 1. 素材 + 渲染（video/ 里，见 video/README.md）
cd video
npm run assets          # 同步字体 → 合成配乐 → CDP 抓真实界面
npm run render          # out/vellum-promo.mp4        （含配乐）
npm run render:silent   # out/vellum-promo-silent.mp4 （GIF 用）

# 2. 导出对外分发的那一套
cd ..
node promo/build-assets.mjs            # 全量（含 Remotion 出的海报帧与分享卡）
node promo/build-assets.mjs --skip-stills   # 只重编正片 / GIF / 截图
```

`build-assets.mjs` 会重编码正片（CRF 22 + faststart，母版留 CRF 18）、
用两级调色板生成 GIF、把窗口截图改好名复制过来，
再调 `remotion still` 出四张海报帧与社交卡。它只依赖 `ffmpeg` 与 `video/` 的依赖。

## 落地页

单文件、无构建步骤、无 CDN：CSS 全内联，字体与截图走相对路径
（`../public/fonts/`、`../assets/`、`promo/assets/`）。
**整个仓库 clone 下来双击 `promo/index.html` 就能看**；若要单独部署，
把 `public/fonts/` 与 `promo/assets/` 一并搬走即可。

- 版式与配色取自 `DESIGN.md`：暖纸三层底（parchment / ivory / warm-sand）、
  墨色文字阶、单一靛青（页面占比 ≤5%）、圆角 2–6px、层次靠发丝线不靠投影。
- 正片默认静音自动循环（浏览器自动播放的要求），右上角可开声音；滚出视野自动暂停。
- 动效只有「进场淡入」一种，260ms，尊重 `prefers-reduced-motion`。
- 页面顶端的 2px 靛青进度条与应用大纲的激活指示条同一语汇。

## 已知约束

- **字体是仓耳今楷（8.4 MB × 2）**，落地页与正片都要它。落地页走 `../public/fonts/`，
  单独部署时必须把这几个 woff2 一起带上，否则会回退到系统宋体。
- 海报帧与分享卡需要 `video/` 的依赖（`remotion still`），只用 `--skip-stills` 时不需要。
- 片子里出现的窗口截图来自 `~/Documents/Notes` 下的两份素材文档
  （`video/assets/demo.md`、`video/assets/session-log.md` 的暂存副本）——
  顶栏会原样显示绝对路径，所以不能直接用仓库路径。
