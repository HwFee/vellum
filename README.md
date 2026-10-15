<div align="center">

# Vellum · 素笺

_A warm, parchment-toned Markdown reader for Windows and Linux._

**给 Markdown 一张纸。** 暖纸底色、今楷正文、一笔靛青 —— 一个把长文档认真排出来的窗口。

[下载安装](https://github.com/HwFee/vellum/releases) ·
[设计语言](./DESIGN.md) ·
[更新日志](./CHANGELOG.md) ·
[让 Agent 写带图与演示的文档](./docs/vellum-widget-md.md)

</div>

![Vellum 渲染的《二分查找》：条形图、公式、逐步演示都在文档里](./samples/assets/binary-search.png)

上图是 Vellum 打开 [`samples/binary-search.md`](./samples/binary-search.md) 的画面：整篇文档由 Agent 一次写成，其中的条形图与可拖动演示直接由文档内的 `vellum-widget` 围栏渲染。GitHub 只会把围栏显示为代码块，在 Vellum 中打开即可查看并交互。

## 下载与安装

从 [GitHub Releases](https://github.com/HwFee/vellum/releases) 下载对应平台的安装包：

- **Windows（10 1809+ / 11 x64）**：运行 `Vellum_<版本>_x64-setup.exe`（NSIS 单用户安装）。安装后自动关联 `.md` 与 `.markdown`，双击文件即可打开，支持应用内自动更新。
- **Linux（WebKitGTK 4.1 + GTK 3）**：提供 `.deb` 与 `.AppImage`。`.deb` 已声明依赖与 `text/markdown` 文件关联。

## 它能做什么

### 读：纸墨版心

- **宣纸与今楷**：默认 14px / 1.55 行高、800px 版心，标题与强调最高只用 500 字重，层级靠字号、字重与留白区分。
- **完整语法与公式**：支持 GFM（表格、任务列表、脚注上标悬停浮笺）、KaTeX 数学公式（含 `$5 和 $10` 货币保护）、CJK 贴标点强调兜底、20 种常用语言代码高亮、本地图片/GIF 解析与点击放大查看器（滚轮 1–5 倍缩放、双击切换）。
- **Obsidian 笔记直读**：文首 YAML frontmatter 渲染为两列属性卡，`> [!tip]` 渲染为提示块，`[[wikilink]]` 支持片段跳转（`[[笔记#标题]]`）、悬停笺页预览与历史前进/后退。
- **阅读与外观定制**：字号（13 / 14 / 16 / 18，支持 <kbd>Ctrl</kbd>+滚轮缩放）、栏宽（720 / 800 / 960px）、行高（1.5 / 1.55 / 1.7）；**中文 / 西文 / 代码三槽字体**独立设置并支持实时样张预览；外观支持**跟随系统 / 浅色 / 深色**（宣纸的暗色倒影）及侧栏简繁题头切换。
- **专注模式与导出 PDF**：<kbd>F11</kbd> 收起顶栏与侧栏，仅在顶缘留一线阅读进度；<kbd>Ctrl</kbd>+<kbd>P</kbd> 进入 A4 纸张舞台预览，所见即所得导出宣纸底色 PDF（含页码、页脚与题目排印切换）。

### 寻：单篇与整库

- **单文件与库双模式**：拖入文件夹、通过「选择文件夹…」打开，或打开祖先目录（8 级以内）含 `.vellum` / `.obsidian` 的笔记时自动进入**库模式**；开始页同时记录最近打开的文件与最近库。
- **侧栏四面板**：同一侧栏内切换 **目錄**（h1–h6 大纲跟随与跳转）、**文件**（库文件树）、**檢索**（<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> 全库全文检索与上下文摘录）、**反鏈**（引用当前笔记的反向链接与摘录）。
- **文内检索与锚定**：<kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>Ctrl</kbd>+<kbd>F</kbd> 实时高亮匹配项，<kbd>F3</kbd> / <kbd>Shift</kbd>+<kbd>F3</kbd> 逐处跳转；阅读位置按文件持久记忆，开关或拖宽侧栏、调整字号栏宽时自动钉住当前视口首行，画面不跳位。

### 写：就地改、原处存

- **块级就地编辑（<kbd>Ctrl</kbd>+<kbd>E</kbd>）**：不切左右分屏，点击任意正文块即在原位置展开等宽源码覆盖层，失焦或按 <kbd>Ctrl</kbd>+<kbd>S</kbd> 经同目录临时文件 + 原子重命名写回磁盘，保留原文件换行符（CRLF / LF）。
- **任务勾选直写**：阅读视图下点击任务复选框即可翻转状态（「钤印 + 划线」，父项勾选时子项随同完成），改动即时原子落盘，写盘失败自动回滚并提示。
- **静默热重载**：外部编辑器或 Agent 改写文件后自动合并重载、保持阅读位置，并以「新墨落纸」模糊过渡与「墨迹未干」印章轻提示。

### 图与演示：`vellum-widget`

- **隔离沙箱演示**：文档中的 ```` ```vellum-widget ```` 围栏会渲染成独立跨源沙箱内的 SVG 图示或交互式 HTML 演示，断网、禁存储、自适应高度、注入根溢出保护（滚轮手势经过演示区不卡顿）。
- **按指纹记住授权**：交互式演示首次显示「交互内容 · 点击加载」，点击一次后按内容指纹持久记住授权；全局最多保留 10 个存活实例（LRU 休眠唤醒），离屏自动停帧降载。

### 底子

- **原生轻量**：Tauri 2 + Rust 后端，随包内嵌 subset 化仓耳今楷与 JetBrains Mono（启动即显、无闪烁）。
- **本地与多开**：除启动更新检查外完全离线；无账号、不建私有库，读写皆是磁盘上的原文件；双击多篇文档各自独立开窗。

## 让 Agent 写带图与演示的文档

本仓库内置 pi 技能 [`vellum-widget-md`](./pi/skills/vellum-widget-md/)（经 `.pi/settings.json` 自动加载）。在仓库目录启动 pi，直接告诉 Agent：

```text
用 vellum-widget-md 写一篇二分查找的讲解，保存到 samples/binary-search.md。
```

Agent 会按「选形态 → 起草 → 自查 → 脚本检查 → 交付」五步写出带静态图或可交互演示的 Markdown，无需额外配置。详见 [docs/vellum-widget-md.md](./docs/vellum-widget-md.md) 与 [`samples/`](./samples/) 示例。

需要边对话边在 Vellum 里实时看排版时，可使用仓库内置的 [mdlog 扩展](./pi/extensions/mdlog/)：在 pi 中运行 `/mdlog <文件路径>`，对话回合与 `vellum_figure` 投递的图示会实时追加成书札版式的 Markdown。

## 常用快捷键

| 快捷键 | 作用 |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>O</kbd> | 打开文件（开始页亦支持拖入文件/文件夹、打开最近文件与最近库） |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> | 展开 / 收起侧栏 |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>Ctrl</kbd>+<kbd>F</kbd> | 聚焦文内检索（自动切回「目錄」页签） |
| <kbd>F3</kbd> / <kbd>Shift</kbd>+<kbd>F3</kbd> | 下一处 / 上一处文内匹配 |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> | 全库全文检索（库模式下切到「檢索」页签） |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> | 切换阅读 / 就地编辑视图 |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | 提交并保存当前编辑块 |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | 打开 / 退出「导出为 PDF」纸张舞台 |
| <kbd>Ctrl</kbd>+<kbd>+</kbd> / <kbd>-</kbd> / <kbd>0</kbd> | 正文字号放大、缩小、复位（或 <kbd>Ctrl</kbd>+滚轮） |
| <kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>→</kbd> | `[[wikilink]]` 跳转后后退 / 前进 |
| <kbd>F11</kbd> | 进出专注模式（「留一线」） |

## 从源码构建

准备好 Node.js、Rust 工具链与 [Tauri 2 系统依赖](https://tauri.app/start/prerequisites/) 后执行：

```bash
npm install
npm run dev          # 启动 Vite 开发服务器（端口 1420）
npm test             # 运行前端单元测试（Vitest）
npm run build        # 类型检查 + 前端生产构建
npm run tauri build  # 打包桌面安装包
```

仓库目录结构、架构不变量与调试探针说明见 [AGENTS.md](./AGENTS.md) 及 `docs/agents/`。

## 技术栈与致谢

- **技术栈**：[Tauri 2](https://tauri.app/) · [React 19](https://react.dev/) · [Vite 8](https://vite.dev/) · [react-markdown 10](https://github.com/remarkjs/react-markdown) · [KaTeX](https://katex.org/) · [react-syntax-highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter) · TypeScript · Rust
- **致谢**：纸墨视觉语言直接受 Tw93 的文档系统 **[Kami](https://github.com/tw93/kami)** 启发；随包正文字体为**仓耳今楷 TsangerJinKai02**，等宽字体为 **JetBrains Mono**。

## 许可

MIT
