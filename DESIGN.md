---
version: "alpha"
name: Vellum 素笺
description: 纸墨风格（kami）的中文 Markdown 桌面阅读器设计语言——暖纸底色、墨色文字、单一靛蓝点缀
colors:
  primary: "#1B365D"
  parchment: "#f5f4ed"
  ivory: "#faf9f5"
  inline-code-bg: "#f0eee6"
  warm-sand: "#e8e6dc"
  near-black: "#141413"
  dark-warm: "#3d3d3a"
  olive: "#504e49"
  stone: "#6b6a64"
  brand-tint: "#EEF2F7"
  tag-bg: "#E4ECF5"
  border: "#e8e6dc"
  border-soft: "#e5e3d8"
  hairline: "#dddacc"
  danger: "#c42b1c"
  danger-active: "#a12014"
typography:
  body:
    fontFamily: HarmonyOS Sans, PingFang SC, 苹方-简, TsangerJinKai02, Source Han Serif SC, Noto Serif CJK SC, Songti SC, STSong, Charter, Georgia, Palatino, serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0.4px
  h1:
    fontFamily: TsangerJinKai02, Source Han Serif SC, Noto Serif CJK SC, serif
    fontSize: 30px
    fontWeight: 500
    lineHeight: 1.2
  h2:
    fontFamily: TsangerJinKai02, Source Han Serif SC, Noto Serif CJK SC, serif
    fontSize: 21px
    fontWeight: 500
    lineHeight: 1.25
  h3:
    fontFamily: TsangerJinKai02, Source Han Serif SC, Noto Serif CJK SC, serif
    fontSize: 17px
    fontWeight: 500
    lineHeight: 1.3
  caption:
    fontFamily: TsangerJinKai02, Source Han Serif SC, serif
    fontSize: 11px
    lineHeight: 1.3
  code:
    fontFamily: JetBrains Mono, SF Mono, Fira Code, Consolas, Monaco, monospace
    fontSize: 12px
    lineHeight: 1.5
  kbd:
    fontFamily: JetBrains Mono, SF Mono, monospace
    fontSize: 9px
    fontWeight: 500
rounded:
  xs: 2px
  sm: 3px
  md: 4px
  lg: 6px
spacing:
  xs: 4px
  sm: 8px
  md: 14px
  lg: 22px
  xl: 34px
  topbar-height: 46px
  outline-width: 240px
  outline-gutter: 20px
  content-max-width: 800px
components:
  button-ghost:
    backgroundColor: "{colors.parchment}"
    textColor: "{colors.stone}"
    rounded: "{rounded.lg}"
    padding: 0px
    width: 28px
    height: 28px
  button-ghost-hover:
    backgroundColor: "{colors.warm-sand}"
    textColor: "{colors.primary}"
  button-contained:
    backgroundColor: "{colors.warm-sand}"
    textColor: "{colors.dark-warm}"
    rounded: "{rounded.lg}"
    padding: 7px 16px
    height: 32px
  input-outlined:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.near-black}"
    rounded: "{rounded.lg}"
    padding: 7px 8px
  code-block:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.near-black}"
    typography: "{typography.code}"
    rounded: "{rounded.lg}"
    padding: 14px 19px
  inline-code:
    backgroundColor: "{colors.inline-code-bg}"
    textColor: "{colors.dark-warm}"
    typography: "{typography.code}"
    rounded: "{rounded.sm}"
    padding: 1px 5px
  blockquote:
    textColor: "{colors.olive}"
    padding: 6px 21px
  table-row-alt:
    backgroundColor: "{colors.ivory}"
    textColor: "{colors.near-black}"
    padding: 7px 11px
  seal-stamp:
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 4px 11px
  window-close-hover:
    backgroundColor: "{colors.danger}"
    textColor: "#ffffff"
  window-close-active:
    backgroundColor: "{colors.danger-active}"
    textColor: "#ffffff"
---

## Overview

「素笺」——一张未施重彩的信纸。整体气质是**纸墨书斋**：暖调纸张底色、近乎墨黑的正文、衬线中文楷体，再以最克制的方式点上一笔靛青。界面是「读」的容器而非「操作」的舞台：几乎无投影、无渐变、无饱和色块，层次全靠发丝线（hairline）与纸张明度差区分。装饰语言取自文房意象——热重载时正文如新墨落纸由虚而实（fresh-ink 模糊过渡），提示以「印章」形式朱文按下（stamp-press 动画）。密度适中偏疏，留白慷慨，像一页排版讲究的笺纸。

2026-09 对齐上游 kami v1.15.0：v1.14「Quieter Pages」减法规则落地——标题去题签、引用去侧线、表格默认去条纹，层级只靠字号、字重、留白与 ivory 填充承担。

## Colors

调色板分为三层：暖纸底、墨色阶、一笔靛青。

- **Primary 靛青（#1B365D）：** 唯一的彩色。承担所有交互指向——链接、激活态、焦点框、标题左侧的 3px 题签、引用块边线、搜索高亮。取自传统青花/印章蓝的沉稳色相，绝不用于大面积填充。页面占比 ≤5%，多余的强调退回字重/字号解决。
- **Parchment 宣纸（#f5f4ed）：** 全局底色，带微弱黄绿暖调，是「纸」的基调。
- **Ivory 象牙（#faf9f5）：** 比底色更亮半级的纸面，用于浮起的容器——代码块、搜索框、表格斑马纹（8 行以上难跟踪时才用）、卡片。行内代码不用它，另见 inline-code-bg。
- **Warm-sand 暖砂（#e8e6dc）：** 悬停填充与实色按钮底色，同时兼任主边框色。
- **Near-black 墨（#141413）：** 正文与一级标题，不是纯黑，带一点暖。
- **Dark-warm 淡墨（#3d3d3a）：** 三级标题、正文按钮文字、行内代码。
- **Olive 赭灰（#504e49）：** 引用文字、辅助说明。
- **Stone 石灰（#6b6a64）：** 图标、占位符、元信息、行号——最弱的一级文字。
- **Inline-code-bg 行内码底（#f0eee6）：** 屏幕专用的暖灰，比宣纸深一级。行内小字用它而不用 ivory——ivory 意味着「浮起的容器」，蓝色则意味着可点击；印刷模板仍用 ivory。
- **Tag-bg / Brand-tint（#E4ECF5 / #EEF2F7）：** 实色标签底。标签底永远 solid hex，不用 rgba（上游 WeasyPrint 双重矩形 bug；屏幕侧同样遵守以保一致）；默认用 tag-bg，密集处退回更淡的 brand-tint。
- 印刷专用的 token（brand-light、dark-surface、deep-dark、breaking 暖棕警示）本阅读器无对应场景，不引入。
- **边框三级：** border（#e8e6dc）> border-soft（#e5e3d8）> hairline（#dddacc），层层减淡，用于外框、分隔、最轻的结构线。
- **Danger 朱红（#c42b1c / 按下 #a12014）：** 仅出现在窗口关闭按钮的悬停态，是平台惯例的让位。

## Typography

双字体体系：**仓耳今楷（TsangerJinKai02）** 承载一切阅读文字，**JetBrains Mono** 承载一切代码与计数。

- 正文 14px / 1.55 行高，letter-spacing 0.4px（CSS 源码中为 0.3pt）——中文排印的舒展感来自字距而非字号。
- 标题只用 font-weight 500（今楷 W05），不用粗黑；层级靠字号递减：h1 30px（窄屏 25px）→ h2 21px → h3 17px。层级只靠字号与间距，不用前导短线/侧栏装饰（2026-09 起跟随上游去掉 h1 题签）。
- `strong` 同样只用 500，与标题字重一致，拒绝粗重的块状强调。
- 等宽字用于代码（12px）、行号与计数（10–12px）、kbd 快捷键标记（9px 大写感）。
- 特殊排印：目录 header 与印章提示使用 4–5px 的超宽字距（letter-spacing），模仿篆刻与题跋的仪式感。
- 字体栈回退到思源宋体 / Noto Serif CJK / 宋体，保证无字体文件时仍是衬线中文。

## Layout

单栏阅读居中，侧栏为可推拉的抽屉。

- 正文列宽 `min(1080px, 100%)` 居中，上下留白 70px / 40px，页面 padding 40px 32px（窄屏 24px 16px）。（2026-09-05 修订：列宽上限 800px → 1080px，宽屏下排版跟随展宽。）
- 顶栏固定 46px，三列网格（标题区 / 弹性 / 操作区），整栏可拖拽（Tauri 无框窗口）。
- 大纲侧栏 240px 宽 + 20px  gutter；≥720px 时把正文向右推 260px，<720px 时变为浮层加 15% 墨色纱罩（scrim）。
- 间距尺度松而散：段落间距 14px、h2 上间距 34px、引用与表格上下 17px、hr 上下 32px——节奏像书籍版心，不靠卡片堆叠分区。
- 滚动条隐藏原生样式，用 6px 自定义滑条，平时透明，滚动时淡入。

## Elevation & Depth

几乎是纯平的。深度用三种极轻的手段表达，禁用厚重投影：

- **发丝描边：** 按钮、输入框用 `inset 0 0 0 1px` 内描边，像纸上刻出的浅痕。
- **明度分层：** ivory 容器浮在 parchment 底上，仅靠约 3% 的明度差区分纸面。
- **聚焦光晕：** 焦点态用 2px 10–18% 透明度的靛青外发光，是唯一的「光」。
- 唯一的投影出现在按钮悬停（`0 1px 2px` 4% 黑）与纱罩（15% 墨色），克制到近乎不可见。

## Shapes

圆润但收敛，全部落在 2–6px 区间，没有 pill、没有全圆角头像：

- 6px 是默认圆角——按钮、输入框、代码块、图片。
- 3–4px 用于小件：kbd、印章、行内代码、徽章。
- 2px 用于激活指示条的端头，接近方头。
- 圆角统一 `border-radius`，无不对称造型；装饰性小方块（目录 header 的 6px 章点）用 1px 微圆。

## Components

- **幽灵图标按钮（window-control / outline-toggle / open-button）：** 28×28，6px 圆角，透明底 + 1px 内描边，stone 色图标；悬停填 warm-sand、图标转靛青；按下下沉 1px。关闭按钮悬停转朱红是仅有的例外。
- **实色按钮（markdown button）：** warm-sand 底 + 内描边，dark-warm 文字，500 字重；悬停仅加深底色并浮现一丝投影。
- **描边搜索框（outline-search）：** ivory 底 + border 描边，focus-within 时描边转靛青并加 10% 靛青光晕；内嵌 kbd 提示与 mono 计数。
- **代码块（code-block）：** ivory 纸面 + 6px 圆角，填充即容器本身、不再加边框；头部 11px 大写等宽语言标签，复制按钮平时隐藏、悬停浮现（opacity 过渡）。语法高亮只用现有 token（keyword 靛青 / comment 石灰 / string 赭灰 / number 淡墨 / function-class 近墨），无第二种彩色。
- **引用块：** 无底色、无侧线，缩进 + 赭灰文字（上游 quote 规范，最素的形式）。mdlog 用户回合顶部的通栏发丝线是结构分隔线，不在此列，保留。
- **表格：** 无竖线，hairline 横线分隔（表头/合计线粗于正文行线），表头 500 字重；默认无斑马纹，行分隔先靠留白，8 行以上难跟踪时才加中性 ivory 条纹。
- **链接：** 靛青 + 1px 下划线（55% 透明度，offset 3px），悬停时下划线转实；外链自动追加「↗」掩码图标，锚链接除外。
- **印章提示（reload-note）：** 1.8px 靛青描边、4px 字距的朱文印章样式，2.8s 内按下-定住-消散，不遮挡交互。
- **搜索高亮：** mark 用 18% 靛青底，当前匹配加深到 32% 并加 1px 光晕，2px 圆角。

## Do's and Don'ts

**Do**

- 一切新界面元素先问「印在纸上是什么样」——用明度差和发丝线分层，而不是投影和色块。
- 交互指向只用靛青一个颜色（页面占比 ≤5%）；强调文字用字重 500 或字距，不用加粗、不用彩色文字。
- 动画向文房意象取材（落墨、钤印、翻页），时长 150–250ms，ease 缓动，尊重 `prefers-reduced-motion`。
- 删线测试：拿掉一条线仍不损失含义/状态/分组/导航，就删掉，用间距补回停顿（上游 subtractive 规则；表头线、mdlog 回合分隔线这类结构线除外）。
- 中文内容优先按中文排印习惯处理：字距、两端对齐感、标点悬置。

**Don't**

- 不要引入第二种强调色、渐变、彩色背景块或深色模式色板（当前设计语言为单色暖纸）。
- 不要用 6px 以上的大圆角、pill 按钮或厚重卡片阴影。
- 不要把等宽字体用于正文阅读，也不要把衬线楷体用于代码。
- 不要用 font-weight 700+ 的粗黑强调——今楷的 500 已是上限（代码高亮的 bold 同样收敛到 500）。
- 不要给标题加前导短线/侧栏、给引用加侧线、给表格默认加斑马纹或彩色表头——层级由字号、字重、留白和 ivory 填充承担。
- 不要让装饰动画遮挡内容或捕获指针（印章提示 `pointer-events: none` 是惯例）。
