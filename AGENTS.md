# Vellum · 素笺 — Agent 说明

Tauri 2 + React 19 桌面 Markdown 阅读器，Windows 10/11 x64。

## 项目技术栈

- **桌面框架**：Tauri 2（Rust 后端）
- **前端**：React 19 + TypeScript + Vite 8
- **Markdown**：react-markdown 10 + remark-gfm + rehype-raw/rehype-sanitize
- **代码高亮**：react-syntax-highlighter（PrismLight，仅注册 20 种常用语言）
- **样式**：自定义 CSS（kami 风格），无 Tailwind
- **测试**：Vitest + jsdom + Testing Library
- **包管理**：npm

## 命令

```bash
npm run dev          # Vite 开发服务器（端口 1420）
npm run build        # tsc + vite build
npm test             # vitest run（22 测试文件，237 用例）
npm run tauri        # Tauri CLI
```

## 技能安装流程

### 仓库结构

全局技能仓库：`C:/Users/17445/Desktop/HwFee-skills/.agents/skills/`

每个项目通过**符号链接**引用仓库中的技能，**不拷贝**。

> **例外说明**：`vellum-mdlog` 为项目专属技能，以真实目录存放于 `.pi/skills/` 并随仓库版本化，**不迁入全局仓库**、**不使用符号联接**。理由：该技能包含针对 Vellum 交互沙箱协议、kami 设计 token 与 CommonMark 围栏规范的强绑定契约，随 Vellum 仓库一同分发版本管理，确保外部开发者 clone 本仓库后无需额外联接即可开箱即用。

### 安装新技能

1. 用 `npx skills find <关键词>` 搜索全网技能
2. 评估质量：优先选 1K+ 安装量、官方源（vercel-labs、anthropics 等）
3. 安装到当前项目目录（不用 `-g`，避免污染全局 `~/.agents/skills/`）：
   ```bash
   npx skills add <owner/repo@skill> -a kimi-code-cli -y
   ```
4. 将安装的技能目录**移动**到全局仓库：
   ```bash
   mv .agents/skills/<skill-name> /c/Users/17445/Desktop/HwFee-skills/.agents/skills/
   ```
5. 从仓库创建目录联接（Windows 上 `ln -s` 不可靠，用 `mklink /J`）：
   ```bash
   cmd //c "mklink /J .agents\\skills\\<skill-name> C:\\Users\\17445\\Desktop\\HwFee-skills\\.agents\\skills\\<skill-name>"
   ```

### 已安装的技能（本项目）

| 技能 | 用途 |
|------|------|
| `react-performance-optimization` | React memo/useMemo/code-splitting/virtualization |
| `bundle-size-optimization` | Bundle 分析、tree-shaking、code splitting |
| `design-md` | 按 google-labs DESIGN.md 规范提取/校验设计语言（项目设计语言见根目录 `DESIGN.md`，校验：`npx -p @google/design.md designmd lint DESIGN.md`） |
| `tauri-v2` | Tauri 2 架构、IPC 通信、插件与原生桌面事件开发规范 |
| `web-artifacts-builder` | 交互式 HTML / React / 可视化 Artifacts 沙箱构建规范 |
| `superpowers` | 工程化研发方法论套件（头脑风暴、TDD、系统化调试、执行计划、工作流规约） |
| `vellum-mdlog` | Vellum 交互式 mdlog 日志生成与 `vellum-widget` 交互块编写规范（项目专属技能，随仓库版本化） |

## 性能优化

### 遇到性能需求时

**先参考已安装的技能**，让技能指导优化方向，不要凭空发挥：

| 技能 | 适用场景 |
|------|----------|
| `react-performance-optimization` | React 渲染慢、重渲染、大列表 |
| `bundle-size-optimization` | 打包体积大、构建产物多 |
| `vercel-react-best-practices` | 70 条 React 性能规则（仓库中，需要时联接） |

### 一条死规则

`CodeBlock.tsx` 用 `PrismLight`，**禁止切回 `PrismAsyncLight`**——会导致 Vite 生成 270+ 语言 chunk。

### 性能结构约束（第二轮优化后）

- `MarkdownDocument.tsx` 内拆有 memo 化的 `MarkdownBody`，传给它的 props 必须保持引用稳定
- `search-match--current` 由 layout effect 操作 DOM 维护，**不要**放回 rehype 插件参数（会让切换匹配项时整篇重解析）
- 搜索跳转滚动对「纯删除」（新词是旧词子串且更短）有 300ms debounce，且延迟触发时首个匹配已在视口内则不滚动；输入变长/替换/上一个下一个按钮保持立即滚动
- `searchQueryPending`（App 传入， urgent 渲染期间 deferred 搜索词未跟进时为 true）：此时 `activeMatchIndex` 被重置为 0 只是输入的副产物，搜索 effect **不得**据此滚动，否则删除时页面会秒跳到旧词首个匹配、防抖形同虚设
- 大纲对**所有**正文滚动始终跟随（普通滚动、搜索输入/删除/导航统一行为）：跟随走自定义 `animateScrollTo` 缓动，同容器新动画自动顶掉旧的从当前位置接续，高频 `activeHeadingId` 变化不会抖动；不要再加「搜索期间不跟随」之类的门禁
- **例外**：点击大纲章节跳转期间，`handleSelectHeading` 会把目标标题 id 写入 `outlineNavTargetRef` 锁定 `activeHeadingId`（`useOutlineSync` 第三参数），否则正文缓动途经的中间标题会让大纲先滚去中间位置再折返（先上后下跳动）；动画自然结束或被用户滚动/按键打断时经 `animateScrollTo` 的 `onComplete` 解除锁定，恢复正常跟随
- `useOutlineSync` 有顶部兜底：所有标题都在阈值线（容器顶 +80px）下方时激活文档顺序第一个标题，保证页面在文档开头时高亮不消失
- 阅读位置记忆是「锚点 + 偏移 + 比例兜底」（`scrollMemory.ts` 记录 / `scrollRestore.ts` 恢复）：恢复优先按 anchorId 定位，标题被删则按 anchorIndex 找最近幸存标题，都没有才退回比例；恢复后图片/字体会撑大 scrollHeight 使落点漂移，`restoreScrollPosition` 的落位守护（ResizeObserver，用户输入/5s 超时结束）会在布局稳定前持续重锚——**不要**改回一次性 `ratio × scrollHeight`，那就是间歇性恢复失败的根因
- 侧栏布局：目錄 header + 搜索框固定在滚动区外，只有大纲列表在 `.outline-panel__scroll` 内滚动，跟随滚动以它为参照容器；**不要**把搜索框改回 sticky 或放回滚动容器内——会重新引入「搜索框遮挡激活项」和「连点导航按钮时搜索框上浮误点」
- 数学公式：remark-math + rehype-katex。katex 必须位于 rehype 管线末尾（sanitize 和搜索高亮之后）——提前会让 KaTeX 输出被 sanitize 剥光，或被高亮逻辑拆坏公式 DOM；remark 侧的 `remarkMathCurrencyGuard` 是 Pandoc 式货币保护（「$5 和 $10」不误判为公式），别删；KaTeX 字体由 `vite.config.ts` 的 `katexWoff2Only` 插件裁成 woff2-only（WebView2 不需要 woff/ttf）
- **katex 版本必须与 rehype-katex 嵌套依赖的 katex 严格同版**（当前均 0.16.47）：CSS 从根 `katex` 包导入，渲染器是 rehype-katex 嵌套的 katex，katex 0.17+ 把 `sizing` 等类名改名，两边不同版会导致上下标 sizing 规则全部失配、公式重合。升级 rehype-katex 前必须先核对其 katex 依赖版本
- `WidgetSandbox` 组件必须严格实施 `React.memo` 与全局最多 10 个存活 iframe LRU 休眠机制；沙箱必须懒挂载，追加写入触发整篇重载时已有 iframe 必须保持位置稳定，严禁未经 memo 或频繁重建导致 WebView 子帧暴涨与交互状态丢失
- `CodeBlock.tsx` 与 `MarkdownDocument.tsx` 语言提取正则必须支持连字符（`/language-([\w-]+)/`），确保 `vellum-widget` 与 `objective-c` 等语言标识完整提取，未注册语言平滑降级为普通代码块
- `components` prop 必须是 `useMemo` 结果；其引用稳定性由生产接线级回归测试（`MarkdownDocument.test.tsx` 接线用例）保证，热重载不得重建 iframe；文档无原始 HTML 时会自动跳过 `rehype-raw`
- 完整优化记录见 `OPTIMIZATION_HANDOFF.md`（含评估后放弃的方向）

### 文件索引

| 文件 | 职责 |
|------|------|
| `src/App.tsx` | 主入口、文档加载、窗口显示 |
| `src/components/MarkdownDocument.tsx` | Markdown 渲染（`React.lazy` 懒加载） |
| `src/components/CodeBlock.tsx` | 代码高亮（PrismLight，20 种语言） |
| `src/main.tsx` | 入口、字体加载 |
| `vite.config.ts` | 构建配置 |
| `src-tauri/tauri.conf.json` | Tauri 窗口配置 |

## 注意事项

- 纯阅读器，无编辑功能
- 窗口初始隐藏（`visible: false`），由前端控制显示
- `CustomScrollbar` 非常轻量，不需要优化
- 字体文件在 `public/fonts/`（~17MB），是应用资源
