---
version: "1.13"
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
  faint-text: "#a5a294"
  faint-mark: "#b9b6a9"
  brand-tint: "#EEF2F7"
  tag-bg: "#E4ECF5"
  border: "#e8e6dc"
  border-soft: "#e5e3d8"
  hairline: "#dddacc"
  danger: "#c42b1c"
  danger-active: "#a12014"
dark-colors:
  primary: "#8fb0d9"
  parchment: "#1c1b19"
  ivory: "#242320"
  inline-code-bg: "#2a2926"
  warm-sand: "#33312c"
  near-black: "#e8e6dc"
  dark-warm: "#cfccc0"
  olive: "#b3b0a4"
  stone: "#8f8c82"
  faint-text: "#6a675c"
  faint-mark: "#57544b"
  brand-tint: "#1f2733"
  tag-bg: "#25303f"
  border: "#34322d"
  border-soft: "#2f2d29"
  hairline: "#3d3b35"
typography:
  font-slots:
    cjk-default: "TsangerJinKai02"
    cjk-tail: "Source Han Serif SC, Noto Serif CJK SC, Songti SC, STSong, Charter, Georgia, Palatino"
    latin-default: "var(--font-cjk)"
    mono-default: "JetBrains Mono"
    mono-tail: "SF Mono, Fira Code, Consolas, Monaco, TsangerJinKai02, Source Han Serif SC"
  body:
    fontFamily: "var(--serif)"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0.3pt
  h1:
    fontFamily: "var(--serif)"
    fontSize: 30px
    fontWeight: 500
    lineHeight: 1.2
  h2:
    fontFamily: "var(--serif)"
    fontSize: 21px
    fontWeight: 500
    lineHeight: 1.25
  h3:
    fontFamily: "var(--serif)"
    fontSize: 17px
    fontWeight: 500
    lineHeight: 1.3
  caption:
    fontFamily: "var(--serif)"
    fontSize: 11px
    lineHeight: 1.3
  code:
    fontFamily: "var(--mono)"
    fontSize: 12px
    lineHeight: 1.5
  kbd:
    fontFamily: "var(--mono)"
    fontSize: 9px
    fontWeight: 500
  edit-source:
    fontFamily: "var(--mono)"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
  ui-mono:
    fontFamily: "var(--mono)"
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.4px
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
  block-editor:
    textColor: "{colors.near-black}"
    typography: "{typography.edit-source}"
    rounded: "{rounded.xs}"
    padding: 0px 2px
  editor-toast:
    backgroundColor: "{colors.tag-bg}"
    textColor: "{colors.near-black}"
    typography: "{typography.ui-mono}"
    rounded: "{rounded.sm}"
    padding: 6px 14px
---

## Overview

「素笺」是一张未施重彩的信纸。视觉基调是**纸墨书斋**：暖调宣纸底色、近乎墨黑的正文、衬线中文今楷，再点上一笔克制的靛青。界面退作「读」的容器，不画厚重投影、渐变或高饱和色块，层次全靠发丝线（hairline）与纸面明度差区分。

动效意象取自文房：热重载时正文如新墨落纸由虚而实（`fresh-ink` 模糊过渡），状态提示以朱文印章按下（`stamp-press`），图标按笔顺逐笔描出（`icon-draw`）。版面对齐上游 kami v1.15.0 的「Quieter Pages」减法原则——标题去题签、引用去侧线、表格默认去条纹，层级由字号、字重、留白与象牙底填充承担。

## Colors

调色板分为三层：**暖纸底、墨色阶、一笔靛青**。

- **Primary / Brand 靛青（`#1B365D`）**：页面唯一的彩色（占比 ≤ 5%）。承担全部交互指向——链接、激活态（大纲当前章、侧栏活动页签、分段选择器选中项、顶栏按下态）、焦点描边、搜索高亮、任务勾选的钤印方框与「记录中」印章。
- **Parchment 宣纸（`#f5f4ed`）**：全局基底色，带微弱暖黄调。
- **Ivory 象牙（`#faf9f5`）**：比宣纸亮半级的浮起纸面，用于代码块、搜索框、浮笺预览卡与长表格斑马纹。
- **Inline-code-bg 行内码底（`#f0eee6`）**：比宣纸深一级的屏幕专用暖灰，区分于代表浮起容器的象牙色与代表可点击的靛青色（打印与导出回归象牙色）。
- **Warm-sand 暖砂（`#e8e6dc`）**：按钮悬停填充、实色按钮底色、导出视图舞台底色，同时兼任主边框色。
- **墨色四阶**：
  - **Near-black 墨（`#141413`）**：正文与一级标题，温润不刺眼。
  - **Dark-warm 淡墨（`#3d3d3a`）**：次级标题、按钮文字、行内代码。
  - **Olive 赭灰（`#504e49`）**：引用文字、检索命中摘录、辅助说明。
  - **Stone 石灰（`#6b6a64`）**：图标、占位符、元信息、行号、已完成任务文字。
- **Tag-bg / Brand-tint（`#E4ECF5` / `#EEF2F7`）**：实色标签底（一律使用 solid hex，不用半透明叠加）。默认用 `tag-bg`，密集选中态退回更淡的 `brand-tint`。
- **三级边框**：`border`（`#e8e6dc`）> `border-soft`（`#e5e3d8`）> `hairline`（`#dddacc`），依次用于控件外框、区域分隔与最轻的发丝结构线。
- **Danger 朱红（`#c42b1c` / 按下 `#a12014`）**：仅用于窗口关闭按钮的悬停与按下态，顺应桌面平台习惯。
- **深色色板（`:root[data-theme="dark"]`）**：同一套暖纸语汇的暗色倒影——宣纸沉为 `#1c1b19`、象牙 `#242320`、行内码底 `#2a2926`、暖砂 `#33312c`；墨色反转为暖白 `#e8e6dc`、淡墨 `#cfccc0`、赭灰 `#b3b0a4`、石灰 `#8f8c82`；靛青提亮为雾蓝 `#8fb0d9`，标签底 `#25303f` / `#1f2733`，三级边框 `#34322d` / `#2f2d29` / `#3d3b35`。所有样式规则只消费 `var(--*)` 令牌，不写第二套硬编码色值。**打印与导出为 PDF 强制使用浅色色板**，保证纸面恒为宣纸底。

## Typography

随包内嵌 subset 化的**仓耳今楷（TsangerJinKai02 W04/W05）**与 **JetBrains Mono**（覆盖 GB2312 简体、Big5 繁体、拉丁扩展、数学与框线符号约 1.79 万字），并通过**中文 / 西文 / 代码三槽字体体系**支持本机字体定制：

- **三槽合成（`--serif` 与 `--mono`）**：
  - **中文槽（`--font-cjk`）**：默认仓耳今楷，兜底尾巴 `--font-cjk-tail` 回退至思源宋体 / Noto Serif CJK / 宋体。
  - **西文槽（`--font-latin`）**：出厂值为 `var(--font-cjk)`（跟随中文槽）。用户单独指定西文字体时，运行时通过 `unicode-range` 将其收窄在拉丁与通用标点区（`Vellum Latin`），全角标点与汉字仍落回中文槽，实现中西混排真分离。
  - **代码槽（`--font-mono`）**：默认 JetBrains Mono，兜底尾巴 `--font-mono-tail` 兼顾等宽西文与中文回退。
- **正文尺度**：默认 14px / 1.55 行高、`letter-spacing: 0.3pt`。正文字号（13 / 14 / 16 / 18px）与行高（1.5 / 1.55 / 1.7）可经设置页、快捷键（<kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>-</kbd>/<kbd>0</kbd>）或 <kbd>Ctrl</kbd>+滚轮实时调整。
- **标题与强调**：最高字重只到 **500**（今楷 W05），不用 700 粗黑。标题按字号阶梯递减：h1 30px（窄屏 25px）→ h2 21px → h3 17px → h4–h6 递收；`strong` 与代码高亮 bold 同样收敛在 500。
- **等宽与就地编辑**：代码块 12px，行号与计数 10–12px，`kbd` 9px，状态提示 `ui-mono` 10px / 500。块级就地编辑面（`edit-source`）使用等宽字但保持 **14px / 1.55 行高**，与渲染态正文同尺度，展开编辑时不撑跳上下文。
- **篆刻字距**：侧栏题头与印章提示使用 4–5px 宽字距，呼应题跋与钤印章法。

## Layout

单栏居中版心，配左侧可推拉抽屉侧栏与无框固定顶栏。

- **版心与留白**：正文列宽 `min(var(--reader-column-width), 100%)` 居中，支持 720 / 800 / 960px 三档（默认 800px）。页面内边距 `40px 32px`（窄屏 `24px 16px`），无标题页顶距 70px，首行带 `h1.document-title` 时顶距收至 42px 以贴近顶栏。
- **固定顶栏（46px）**：`border-box` 定高 46px，三列网格（左工具簇 `auto` / 中间拖拽热区 `1fr` / 右窗口控制簇 `auto`），全宽度统一 `padding: 0 0 0 16px`。顶栏只放工具图标与「记录中」小章，**不显示文件名与路径**——文档名归正文首行 `h1.document-title`，完整路径归其 `title` 悬停提示与设置页「关于与数据」。
- **侧栏与响应式让位**：`.outline-sidebar` 默认宽 240px + 20px gutter，右缘手柄可在 200–320px 间拖宽（双击复位）。窗口 ≥ 720px 时正文向右平滑让位 `var(--outline-shift)`；< 720px 时侧栏化为浮层并铺 15% 墨色纱罩（`--scrim`）。设置视图打开时复用同一侧栏容器，内容切换为分节导航。
- **呼吸节奏**：段落间距 14px，h2 上距 34px，引用与表格上下 17px，`hr` 上下 32px；隐藏原生滚动条，仅在滚动时淡入 6px 自定义滑条。

## Elevation & Depth

界面近乎纯平，层次靠三种轻手法建立：

1. **发丝内描边**：按钮与输入框使用 `inset 0 0 0 1px` 内描边，如纸上浅刻。
2. **明度分层**：象牙色（`#faf9f5`）容器浮于宣纸（`#f5f4ed`）之上，仅凭约 3% 的明度差区分。
3. **靛青焦点晕**：`:focus-visible` 与搜索框聚焦时亮起 2px 靛青描边或 10–18% 透明度光晕。

除悬停微投影、浮笺/纸页浅影（`--shadow-soft`）与窄屏纱罩外，不使用大面积阴影。

## Shapes

圆角收敛在 **2–6px** 之间，不使用胶囊形（pill）或大圆角卡片：

- **6px（`rounded.lg`）**：按钮、输入框、代码块、图片、浮笺卡片。
- **3–4px（`rounded.sm` / `rounded.md`）**：`kbd`、印章、行内代码、分段选择器小格、提示条。
- **2px（`rounded.xs`）**：大纲激活竖轨、侧栏页签底栏、就地编辑左边轨、任务复选框、搜索高亮。

## Components

- **幽灵与实色按钮**：顶栏图标按钮为 28×28 幽灵样式（透明底 + 1px 内描边 + stone 图标，悬停填 `warm-sand`、图标转靛青，按下微沉 1px；关闭按钮悬停转朱红）。实色主按钮（`button-primary`，32px 定高）用 `warm-sand` 底 + 发丝内描边 + 淡墨字。
- **开始页一体拖放区（`empty-state--start`）**：居中题头下设虚线内描边拖放匣（「文件进阅读 · 文件夹进库」）与「选择文件… / 选择文件夹…」双主按钮；下方分列「最近库」（带 `库` 标签）与「最近打开」文件列表。
- **侧栏四页签与面板（`sidebar-tabs`）**：顶栏题头区排布四枚等宽页签——**目錄 / 文件 / 檢索 / 反鏈**（出厂繁体，设置页可切换简体，与「設定」题头联动），激活项下画 2px 靛青底栏。目录支持 h1–h6（h1 配中文数字章号，h4–h6 逐级缩进 14px）；文件树、全库检索与反向链接面板共用同一套搜索框、等宽石色路径行与 12px 赭灰命中摘录。
- **设置视图與行内字体选择器（`settings-view` / `font-picker`）**：640px 居中整页视图，分「阅读 / 界面 / 更新 / 关于与数据」四节。阅读节内嵌实时**样张**（中、英、代码三段同步反映当前字号、栏宽、行高与三槽字体）；字体选择器点击后在行下以 `grid-template-rows: 0fr → 1fr` 原地展开搜索框与三列字片栅格，候选项滚入视口时渐进渲染字体真身。
- **Obsidian 三族组件**：
  - **属性卡（`md-props`）**：上下两条发丝线夹住两列键值网格（`78px minmax(0, 1fr)`），无底色无外框，`tags` 以中点分隔，`sources` / `related` 渲染为可点链接。
  - **提示块（`callout`）**：无底色无圆角，仅留一道发丝左竖线；`tip` 等类型标题用靛青，警示族标题用淡墨并将竖线沉为石色。
  - **双向链接（`wikilink`）**：已解析目标呈靛青下划线链接，缺失目标退化为 `wikilink--missing` 纯文本加悬停说明。
- **浮笺与笺页卡（`hover-preview`）**：象牙底 + 发丝内描边 + 浅影。悬停脚注上标 200ms 弹出**脚注浮笺**（≤ 320px，`注 n` 题签 + 正文）；悬停已解析 wikilink 350ms 弹出 **wikilink 笺页卡**（360px 宽，标题 + 路径 + 正文摘录 + 底缘 36px 渐隐，整卡可点击跳转）。
- **图片查看器（`image-viewer`）**：点击正文图片在顶栏下铺开 94% 宣纸遮罩（纸上读图而非黑底灯箱），图片带发丝描边与 6px 圆角，支持滚轮 1–5 倍缩放、拖拽平移与双击 1↔2 倍切换。
- **任务勾选「钤印 + 划线」**：阅读视图复选框自绘为 15×15px 发丝方框（`padding: 0`、2px 圆角）；勾选后填 `tag-bg` 实底 + 靛青对勾，本项文字转石色并划 1px 删除线，父项勾选时嵌套子项一并灰化划线（打印时恢复正文墨色以保纸面对比度）。
- **块级就地编辑与页边字符**：编辑视图下正文保持原貌，可编辑块悬停在左页边浮出淡色 `¶`，只读块（frontmatter / HTML / widget）常驻灰 `×`；点选块后原位覆盖透明底等宽 `textarea`，左缘亮 2px 靛青竖轨与 `¶` 标记。
- **专注模式「留一线」（`app-shell--focus`）**：<kbd>F11</kbd> 收起顶栏与侧栏，顶缘仅留 2px 发丝轨上的靛青阅读进度线；指针探入顶缘 8px 感应带时顶栏滑出暂驻。
- **导出视图「纸张舞台」（`export-view`）**：<kbd>Ctrl</kbd>+<kbd>P</kbd> 整页替换为暖砂舞台，铺开 A4 宣纸页（794×1123px，版心 166mm，首页留白、次页起右上页码与居中页脚「文档题 · 素笺」），底部悬浮 sticky 工具条提供文件名与题目排印（原文左齐 / 居中）切换，所见即所得直出 PDF。
- **线性图标动效**：图标挂载按笔顺描出，悬停微动 1–2px 或旋转咬合，编辑/复制双态图标原地旋缩换章；`prefers-reduced-motion: reduce` 下全部关闭。

## Do's and Don'ts

**Do**

- 新增任何元素先想「印在信纸上是什么样」：优先用纸面明度差、留白与发丝线建立秩序。
- 交互与状态色严格收束在**靛青**一色；文字强调使用 500 字重或字距，保持版面清朗。
- 所有颜色一律消费 `:root` 的 CSS 变量，让浅色宣纸与深色墨纸自动镜像切换。
- 动效时长控制在 150–250ms（`ease`），并为 `prefers-reduced-motion` 提供零动画退路。
- 执行「删线测试」：拿掉一条线而不影响分组、状态或导航时，用留白代替线。

**Don't**

- 不引入第二种彩色强调色、渐变填充或半透明彩色底块。
- 不使用 6px 以上圆角、胶囊按钮或弥散卡片阴影。
- 不使用 700 及以上粗黑字重；正文不混用等宽字体，代码不混用衬线楷体。
- 不给标题加前导色块、不给普通引用加粗侧线、不给提示块铺满彩色底。
- 不让印章提示、状态浮条或装饰动画拦截指针事件（保持 `pointer-events: none`）。
