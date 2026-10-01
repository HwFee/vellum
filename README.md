<div align="center">

# Vellum · 素笺

_A warm, parchment-toned Markdown reader for Windows and Linux._

**给 Markdown 一张纸。** 暖纸底色、今楷正文、一笔靛青 —— 一个把长文档认真排出来的窗口。

[下载](https://github.com/HwFee/vellum/releases) ·
[设计语言](./DESIGN.md) ·
[更新日志](./CHANGELOG.md) ·
[让 Agent 写带图与演示的文档](./docs/vellum-widget-md.md)

</div>

![Vellum 渲染的《二分查找》：条形图、公式、逐步演示都在文档里](./samples/assets/binary-search.png)

上图是 Vellum 打开 [`samples/binary-search.md`](./samples/binary-search.md) 的样子：这篇文档由 Agent 一次写成，其中的条形图和可拖动的演示是文档里的 `vellum-widget` 围栏渲染出来的。GitHub 只会把围栏显示成代码块，要看真的，请用 Vellum 打开。

## 下载与安装

从 [GitHub Releases](https://github.com/HwFee/vellum/releases) 下载最新版：

- **Windows**：`Vellum_<版本>_x64-setup.exe`（NSIS，单用户安装）。安装时自动关联 `.md` / `.markdown`，之后可直接在资源管理器里双击打开。
- **Linux**：提供 `.deb` 与 `.AppImage`。`.deb` 在桌面入口里声明了 `text/markdown`，文件管理器可以直接用它打开 `.md`。

系统要求：Windows 10 1809+ 或 Windows 11（x64，需要 WebView2，多数系统已预装）；Linux 需要 WebKitGTK 4.1 与 GTK 3（`.deb` 已声明依赖）。自动更新目前只支持 Windows。

## 它能做什么

**读**
- 纸墨排版：正文 14px / 1.55 行高，层级只靠字号、字重与留白，不画装饰线。
- GFM（表格、任务列表、脚注）、KaTeX 数学公式（含 `$5 和 $10` 的货币保护）、20 种语言的代码高亮、本地图片与 GIF、图片点击放大。
- Obsidian 常用语法：frontmatter 属性卡、`> [!tip]` callout、`[[wikilink]]`（悬停预览、前进/后退）。
- 设置页：字号、栏宽、行高，中文 / 西文 / 代码三槽字体，主题，启动行为，更新检查。
- 专注模式（<kbd>F11</kbd>）、导出 PDF（<kbd>Ctrl</kbd>+<kbd>P</kbd>）。

**寻**
- 侧栏四个页签：目录、库内文件、库内全文检索（<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>）、反向链接。
- 文内检索（<kbd>Ctrl</kbd>+<kbd>K</kbd>），命中就地高亮，<kbd>F3</kbd> 逐个跳。
- 阅读位置按文件记住；开关侧栏、拖宽时钉住你正在看的那一行，不跳位。

**写**
- <kbd>Ctrl</kbd>+<kbd>E</kbd> 块级就地编辑：不切分屏，点哪块改哪块；<kbd>Ctrl</kbd>+<kbd>S</kbd> 临时文件加原子重命名落盘。
- 阅读视图里直接勾选任务列表，改动立即写回文件；写盘失败会回滚并告诉你原因。

**图与演示**
- 文档里的 `vellum-widget` 围栏渲染成隔离沙箱里的图示或可交互演示：自包含 HTML，不联网、不存储。
- 每个演示首次需要点一次「点击加载」，同一份内容之后被记住。全局最多保留 10 个存活窗口，离屏自动停帧。

**底子**
- Tauri 2 + WebView2，无框原生窗口。离线优先：除启动时的一次版本检查外不联网，没有账号，打开和写回的都是磁盘上的那个文件。
- 双击几个 `.md` 就开几个窗口，各自独立。

## 让 Agent 写带图与演示的文档

仓库自带一个 pi 技能 [`vellum-widget-md`](./pi/skills/vellum-widget-md/)：Agent 按它判断什么时候该画图、怎么画、怎么检查、怎么交给你。在本仓库里启动 pi，说一句：

```text
用 vellum-widget-md 写一篇二分查找的讲解，保存到 samples/binary-search.md。
```

不需要任何连接或配置。完整说明与另一篇示例见 [docs/vellum-widget-md.md](./docs/vellum-widget-md.md)。

仓库里还有 [mdlog 扩展](./pi/extensions/mdlog/)：把 Agent 的对话实时写成一份 Markdown，Vellum 热重载显示，像看着它边写边排版。

## 常用快捷键

| 键 | 作用 |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>O</kbd> | 打开文件（也可拖放，或从空态的「最近打开」选） |
| <kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>Ctrl</kbd>+<kbd>F</kbd> | 文内检索 |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> | 库内检索 |
| <kbd>Ctrl</kbd>+<kbd>B</kbd> | 开关侧栏 |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> | 编辑视图 |
| <kbd>Ctrl</kbd>+<kbd>+</kbd> / <kbd>-</kbd> / <kbd>0</kbd> | 字号步进与复位（也可 <kbd>Ctrl</kbd>+滚轮） |
| <kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>→</kbd> | 经 wikilink 打开后，前进 / 后退 |
| <kbd>F11</kbd> | 专注模式 |

「库」是含 `.obsidian` 的最近祖先目录，否则就是文档所在目录。

## 从源码构建

```bash
npm install
npm run dev        # Vite 开发服务器（端口 1420）
npm test           # 前端测试（Vitest）
npm run build      # tsc + vite build
npm run tauri build
```

需要 Node.js、Rust 工具链与 [Tauri 2 的系统依赖](https://tauri.app/start/prerequisites/)。仓库结构、不可回退的约束与发布流程见 [AGENTS.md](./AGENTS.md) 和 `docs/agents/`。

## 技术栈

[Tauri 2](https://tauri.app/) · [React 19](https://react.dev/) · [Vite](https://vite.dev/) · [react-markdown](https://github.com/remarkjs/react-markdown) · [KaTeX](https://katex.org/) · [react-syntax-highlighter](https://github.com/react-syntax-highlighter/react-syntax-highlighter) · TypeScript · Rust

## 致谢

视觉语言——暖纸色、衬线正文、克制的靛青——直接受 Tw93 的文档系统 **[Kami](https://github.com/tw93/kami)** 启发，素笺把同样的阅读感带到 Windows 与 Linux 上的 Markdown 文件。正文字体是**仓耳今楷 TsangerJinKai02**，代码字体是 **JetBrains Mono**。

## 许可

MIT
