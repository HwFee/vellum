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
npm test             # vitest run（14 测试文件，142 用例）
npm run tauri        # Tauri CLI
```

## 技能安装流程

### 仓库结构

全局技能仓库：`C:/Users/17445/Desktop/HwFee-skills/.agents/skills/`

每个项目通过**符号链接**引用仓库中的技能，**不拷贝**。

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
- `useOutlineSync` 有顶部兜底：所有标题都在阈值线（容器顶 +80px）下方时激活文档顺序第一个标题，保证页面在文档开头时高亮不消失
- 侧栏布局：目錄 header + 搜索框固定在滚动区外，只有大纲列表在 `.outline-panel__scroll` 内滚动，跟随滚动以它为参照容器；**不要**把搜索框改回 sticky 或放回滚动容器内——会重新引入「搜索框遮挡激活项」和「连点导航按钮时搜索框上浮误点」
- `components` prop 必须是 `useMemo` 结果；文档无原始 HTML 时会自动跳过 `rehype-raw`
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
