# Vellum · 素笺 — Agent 说明

Tauri 2 + React 19 桌面 Markdown 阅读器，Windows 10/11 x64。

本文件只留定位、仓库结构、命令、红线速查与文档导航；细节按主题拆进 `docs/agents/` 四个分册，动手前按「文档导航」找对应分册。

## 项目技术栈

- **桌面框架**：Tauri 2（Rust 后端）
- **前端**：React 19 + TypeScript + Vite 8
- **Markdown**：react-markdown 10 + remark-gfm + rehype-raw/rehype-sanitize
- **代码高亮**：react-syntax-highlighter（PrismLight，仅注册 20 种常用语言）
- **样式**：自定义 CSS（kami 风格），无 Tailwind
- **测试**：Vitest + jsdom + Testing Library
- **包管理**：npm

## 仓库结构

只留源码、资源与四份分册；过程产物（历史计划 / 评审记录 / 预览页 / 临时输出）已清理，需要时从 git 历史取回。

| 路径 | 内容 |
|------|------|
| `src/` | 前端：组件、hooks、`lib/`、样式 `styles/kami.css` |
| `src-tauri/` | Rust 后端：`src/main.rs` 命令、`capabilities/`、`tauri.conf.json` |
| `extensions/mdlog/` | pi 扩展实体（独立 npm 包，自带测试与 tsconfig） |
| `scripts/` | 真机 CDP 探针 `cdp-*.mjs`、基准、语料检查、widget 模板校验 |
| `public/fonts/` | 应用字体（~17MB，随包分发） |
| `samples/` | 示例 Markdown（`sample.md`；本地图片放 `samples/assets/`） |
| `docs/agents/` | 四份分册：渲染 / Obsidian 语法 / widget 沙箱 / 工程与发布 |
| `docs/design/` | 界面设计稿与真机取证截图（`export-pdf-mockups.html`、`shots/`） |
| 根目录 | `AGENTS.md`（本文件）、`DESIGN.md`、`CHANGELOG.md`、`README.md` |

- **不新建目录**：新素材放进上表已有位置——界面稿与截图给 `docs/design/`，示例文档给 `samples/`，长期文档给 `docs/agents/`。
- **临时产物不入库**：`outputs/`、`dist/`、`node_modules/`、`target/` 已在 `.gitignore`，别用 `git add -f` 绕过。
- **本地联接不入库**：`.pi/skills/<skill-name>` → 全局技能库 `C:/Users/17445/Desktop/HwFee-skills/skills/`；`~/.pi/agent/extensions/mdlog` → `extensions/mdlog/`。新 clone 后按 `docs/agents/tooling.md` 的「技能安装流程」重建。

## 命令

```bash
npm run dev          # Vite 开发服务器（端口 1420）
npm run build        # tsc + vite build
npm test             # vitest run
npm run tauri        # Tauri CLI
node scripts/check-obsidian-corpus.mjs   # Obsidian 全库语料检查（走 wisdom 真实笔记库；库不存在则整体跳过）
```

### 跑命令用哪个 shell（三个入口不是一个 shell）

| 入口 | 实际 shell | 语法 |
|------|-----------|------|
| 前台 `bash` 工具 | Git Bash / MSYS，bash 5.3.15 | POSIX（`&&`、`$(…)`、`for … do … done`） |
| `bg_run` 后台任务 | **会变，别按表猜**（表里原写 PowerShell 7.6.6；2026-09-18 复核实测跑的是 Git Bash） | 不保证，先探明 |
| `powershell` 工具 | PowerShell 7.6.6（Core） | PowerShell 7（`&&`、`? :`、`??` 均可用） |

- 后台命令只用跨 shell 都成立的部分（`&&`、`;`、重定向都不要依赖），或先跑 `echo $0` / `Write-Output $PSVersionTable` 探明。
- 截尾与匹配优先交给前台 `bash` 工具（那边确定是 Git Bash）。
- `bash -lc "…"` 不是逃生口：拿到的是 WSL 的 bash，而 **WSL 里没有 node/npm**（实测 `node: command not found`）。
- 完整说明（`PI_BG_SHELL` 环境变量、`tail` 被误读为测试失败的历史）见 `docs/agents/tooling.md`。

## 红线速查

一条要点一行，每条都是原文里的「不可回退 / 禁止 / 必须」；详情与因果链在各分册。

1. `CodeBlock.tsx` 用 `PrismLight`，**禁止切回 `PrismAsyncLight`**——会导致 Vite 生成 270+ 语言 chunk。 → `docs/agents/tooling.md`
2. 交给 react-markdown 的字符串永远是完整原文；块单元按**绝对源码偏移**工作，切短会让标记落到邻块、回写写坏文件。 → `docs/agents/obsidian.md`
3. `rehypeObsidian` 必须挂在 `rehype-sanitize` 之后、`rehypeEditUnits` 之前；katex 必须位于 rehype 管线末尾。 → `docs/agents/obsidian.md`
4. `components` prop 必须是 `useMemo` 结果，其引用稳定由接线级回归测试保证；热重载不得重建 iframe。 → `docs/agents/rendering.md`
5. `.vellum-unit-wrap` 必须 `display: contents`；`BlockEditor` 的隐藏/锁高/自增高/测量作用在 `resolveTarget()` 选出的「首个有布局盒的元素」上。 → `docs/agents/rendering.md`
6. 沙箱根溢出保护三条：出网前注入 / 样式必须落在文档内部 / 只作用 `html`、不碰 `body`。 → `docs/agents/widgets.md`
7. 离屏 widget 停帧降载**禁止改成 `display:none`**（用 `--parked` = `visibility: hidden`）。 → `docs/agents/widgets.md`
8. **侧栏开关与拖宽的全部入口**（顶栏按钮 / `Ctrl+B` / `Ctrl+K` / 窄屏 Escape 与遮罩 / 窄屏选章 / 拖宽手柄）都必须走 `beginWidthTransition()`。 → `docs/agents/rendering.md`
9. 热重载滚动恢复不要改回纯像素恢复；阅读位置恢复不要改回一次性 `ratio × scrollHeight`。 → `docs/agents/rendering.md`
10. 打包前必须先 `taskkill /IM vellum.exe /F`（`Get-Process vellum` 为空），否则链接阶段报 `os error 5 拒绝访问`。 → `docs/agents/tooling.md`
11. capabilities 必须有 `core:window:allow-destroy`、`core:window:allow-set-title` 与 `updater:default`；CSP 必须含 `connect-src ipc: http://ipc.localhost`。 → `docs/agents/tooling.md`
12. `.pi/skills/` 与 `extensions/mdlog` 是目录联接：`git ls-files .pi/skills/` 有输出就是错，别用 `git add -f` 绕过忽略；删这些路径时只删联接条目本身（`Remove-Item` 单条 或 `[System.IO.Directory]::Delete`），别用会顺着联接递归的 `rmdir /s`——会删掉全局技能库里的真身。 → `docs/agents/tooling.md`
13. kami.css 新规则只要含 `.mdlog-widget` 字样，就必须放在首个该选择器出现处**之后**。 → `docs/agents/widgets.md`
14. katex 版本必须与 rehype-katex 嵌套依赖的 katex 严格同版（当前均 0.16.47）。 → `docs/agents/rendering.md`
15. 顶栏不显示文件名与路径（`.top-bar__title` / `.top-bar__path` / `.top-bar__meta` 均已移除，中列只剩拖动热区）；完整路径的归宿只有两处——正文标题 `h1.document-title` 的 `title` tooltip 与设置页「关于与数据 · 当前文档」，换文档的判据一律看 `h1.document-title`。 → `docs/agents/obsidian.md`
16. `read_mdlog_state` 的返回值必须 `?? null` 归一后再入 state，否则 `undefined` 会被误判为记录中。 → `docs/agents/widgets.md`
17. 任务列表勾选只能走 `useDocumentEditor.toggleTask`（`<li>` 源码起点 → 块单元内按序号翻转标记）：mdlog 门禁 / 只读块忽略 / 编辑视图不接管 / 在途串行 / **回滚只在「同一文档代际（代际经 `getDocumentGeneration` getter 同步读 App 的 `documentGenerationRef`，不是 prop 快照——递增发生在渲染提交之前）且内存仍是我写的那份」时生效**，一处都不能少。 → `docs/agents/rendering.md`
18. 打印只允许新增 `@media print` 段（屏幕态规则一律不动）：主段（隐藏界面件 / 放开版心 / 分页保护）排在首个 `.mdlog-widget` 之前且注释里也不得出现该字样，含该字样的交互块打印规则排在它之后；**屏幕态规则落在主段之后的（mdlog 区段内的）选择器，其打印覆写必须放文件末尾那段**——同特异度靠来源序取胜、媒体查询不参与特异度，放主段等于没写（`.mdlog-live` 踩过）。 → `docs/agents/rendering.md`
19. **打印覆写要压过屏幕态规则时，屏幕态规则不能写成逗号列表**：构建期 minifier 会把列表包进 `:is()` 并取参数里最高特异度，只在产物里静默失效；屏幕态拆成单选择器、打印覆写与它逐字同选择器靠来源序取胜（勾选划线踩过）。 → `docs/agents/rendering.md`
20. 设置视图打开时侧栏只换内容（`SettingsNav`，「設定」题头 + 分节导航），**仍是同一枚 `.outline-sidebar`**：宽度、开合与拖宽的全部入口照旧走 `beginWidthTransition()`，别为设置页另写一套侧栏。 → `docs/agents/rendering.md`
21. 导出为 PDF（Ctrl+P，打印对话框已退役）：纸面底色必须刷在 `@page` 上——`body` 背景分页时不传播满页边区（会漏白，真机像素取证）；页眉页脚走导出视图运行时注入的 `@page` 边盒，不落 kami.css；预览测量流必须与打印底稿逐块同构（注入题目在则是第一块，「原文」模式不注入）；正文自带同题 h1 时按题目样式去重——同一题目不排两次。 → `docs/agents/rendering.md`

## 关键路径

- 应用字体资源：`public/fonts/`（~17MB）。
- 前端状态与持久化：`src/lib/recentFiles.ts`（最近 8 篇，Store key `recentFiles`，含 `lastOpenedPath` 迁移）、`src/lib/navHistory.ts`（wikilink 前进/后退两栈，条目自带三级位置记录）、`src/lib/taskList.ts`（任务标记定位与翻转，绝对偏移纯函数）、`src/hooks/useReaderSettings.ts`（字号/栏宽/行高，覆写根 CSS 变量，改值前须走 `beginWidthTransition()`）。
- 设置页与界面偏好：`src/components/SettingsView.tsx`（四节内容栏；`SETTINGS_SECTIONS` / `settingsSectionElementId` 是分节清单的唯一来源，侧栏导航据此生成）、`src/components/SettingsNav.tsx`（设置视图的侧栏内容）、`src/lib/appPreferences.ts`（Store key `sidebarOpenOnLaunch` / `autoCheckUpdates`，读盘失败回退出厂值）、`src/lib/updater.ts`（`checkForUpdates(manual?)`：启动静默检查 + 设置页「立即检查」）。
- 导出为 PDF：`src/components/ExportPdfView.tsx`（纸张舞台）、`src/lib/exportDocument.ts`（消毒后的正文底稿）、`src/lib/exportLayout.ts`（模板常量）、`src/lib/exportPagination.ts`（按行摹 Chromium 分页）、Rust 侧 `export_pdf` 命令（对主窗口 WebView2 调 CDP `Page.printToPDF`）。
- pi 扩展实体：`extensions/mdlog/`（pi 的加载位 `~/.pi/agent/extensions/mdlog` 是指向它的目录联接）。
- 真机探针：`scripts/cdp-*.mjs`（`cdp-verify` / `cdp-perf-scroll` / `cdp-sidebar-jump` / `cdp-anchor-synthetic` / `cdp-obsidian-verify`）。
- 设计语言：`DESIGN.md`；变更记录：`CHANGELOG.md`。

## 文档导航

| 文档 | 管什么 | 什么时候读 |
|------|--------|-----------|
| `docs/agents/rendering.md` | 渲染结构、搜索跳转、大纲跟随、侧栏布局与宽度（含设置视图的侧栏内容切换）、设置视图、阅读位置记忆、热重载恢复、布局过渡窗、`viewportPin`、数学公式、块级就地编辑不变量、任务勾选、打印样式、导出为 PDF、文件索引 | 改渲染管线 / 滚动 / 编辑器 / 大纲 / 设置页 / 打印 / 导出时 |
| `docs/agents/obsidian.md` | frontmatter 属性卡、callout、wikilink 端到端与片段跳转、文档标题与属性卡/提示块定稿形态、CJK 强调兜底、全库语料检查与真机验收 | 碰三族语法或 `rehypeObsidian` 时 |
| `docs/agents/widgets.md` | `WidgetSandbox` 存活上限与懒挂载、沙箱根溢出保护、交互块授权台账、停帧降载与静态图指针防线、预载视距与高度夹取、mdlog 状态与吸底、sidecar 清理 | 改 mdlog 或 widget 沙箱时 |
| `docs/agents/tooling.md` | shell 入口细节、技能安装与 pi 扩展、性能技能表与入口 chunk 尺寸、打包与生产构建坑、签名与发布、真机探针、`custom-protocol` | 配环境、打包发布时 |