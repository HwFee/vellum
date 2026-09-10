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
npm test             # vitest run（26 测试文件，280 用例）
npm run tauri        # Tauri CLI
```

## 技能安装流程

### 仓库结构

全局技能仓库：`C:/Users/17445/Desktop/HwFee-skills/skills/`

每个项目通过**目录联接**引用仓库中的技能，**不拷贝**（本地 `.pi/skills/<skill-name>` 均为联接，永不入库）。

> 2026-09-10 记录：`vellum-mdlog` 已迁入全局仓库，本地仅保留目录联接。此前随本仓库版本化的真实目录（`.pi/skills/vellum-mdlog/`）已移除——此前「项目专属、不迁库、开箱即用」的例外不再成立，外部 clone 本仓库后需按「安装新技能」第 5 步重建联接。

### 安装新技能

1. 用 `npx skills find <关键词>` 搜索全网技能
2. 评估质量：优先选 1K+ 安装量、官方源（vercel-labs、anthropics 等）
3. 安装到当前项目目录（不用 `-g`，避免污染全局 `~/.agents/skills/`）：
   ```bash
   npx skills add <owner/repo@skill> -a kimi-code-cli -y
   ```
4. 将安装的技能目录**移动**到全局仓库：
   ```bash
   mv .agents/skills/<skill-name> /c/Users/17445/Desktop/HwFee-skills/skills/
   ```
5. 从仓库创建目录联接（Windows 上 `ln -s` 不可靠，用 `mklink /J`）：
   ```bash
   cmd //c "mklink /J .pi\\skills\\<skill-name> C:\\Users\\17445\\Desktop\\HwFee-skills\\skills\\<skill-name>"
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
| `vellum-mdlog` | Vellum 交互式 mdlog 日志生成与 `vellum-widget` 交互块编写规范（2026-09-10 起迁入全局仓库，本地为目录联接）；其「强调定界符跨汉字+括号」写法要求已于 2026-09 起降级为可移植性建议——渲染层由 remark-cjk-friendly 软件兼容（见「注意事项」） |

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
- 阅读位置记忆是「标题锚点 + 顶层块索引锚点 + 比例兜底」三级（`scrollMemory.ts` 记录 / `scrollRestore.ts` 恢复）：恢复优先按 anchorId 定位，标题被删则按 anchorIndex 找最近幸存标题；无标题文档（mdlog 日志常态）落到 blockIndex——`.markdown-body` 顶层块序号对末尾追加天然稳定，是「记录期间末尾注入新内容后恢复失败」的修复点；都没有才退回比例；恢复后图片/字体会撑大 scrollHeight 使落点漂移，`restoreScrollPosition` 的落位守护（ResizeObserver，用户输入/5s 超时结束）会在布局稳定前持续重锚——**不要**改回一次性 `ratio × scrollHeight`，那就是间歇性恢复失败的根因
- **布局过渡窗**：侧边栏开关（450ms）与拖宽期间（持续续窗）由 `layoutShiftUntilRef` + `app-shell--layout-shifting`/`app-shell--sidebar-resizing` 类承载——窗内热重载延迟合并提交（`reloadDeferTimerRef`，多次追加只留最后一次）、热重载滚动恢复整体让位原生 scroll anchoring、widget iframe 高度过渡关闭。这是「mdlog 连接中开关侧边栏页面卡死」的修复机制：过渡期所有 iframe 随宽集体重排，恰逢整篇重解析的热重载会饱和主线程
- 热重载滚动恢复在用户滚动输入（滚轮/触摸/按键/滚动条拖拽）后 300ms 内跳过（`lastUserScrollAtRef`）：否则提交瞬间会把用户刚滚出去的距离当「漂移」拽回
- 阅读位置保存在 mdlog 记录期间**不再禁用**：连接建立瞬间基线保存一次 + 滚动防抖持续保存 + 断开补写 + beforeunload 兜底——pi 或 Vellum 被强杀（无 beforeunload）也能恢复到 300ms 内的位置
- 侧栏布局：目錄 header + 搜索框固定在滚动区外，只有大纲列表在 `.outline-panel__scroll` 内滚动，跟随滚动以它为参照容器；**不要**把搜索框改回 sticky 或放回滚动容器内——会重新引入「搜索框遮挡激活项」和「连点导航按钮时搜索框上浮误点」
- 侧边栏宽度可调：`useOutlineWidth`（200–320px，默认 240，双击手柄复位）覆写根 `--outline-width` 变量，`--outline-shift` 由 calc 派生自动跟随；手柄 `.outline-resize-handle` 必须作 aside 的**兄弟节点**外置（aside 有 `overflow:hidden`）
- `JumpToBottom`：距底 >300px 浮现的右下角跳底按钮，z 序须低于窄屏遮罩（750）；点击走 `animateScrollTo` 缓动，用户输入可被全局监听打断
- kami.css 的 mdlog 区段约束测试以**首个 `.mdlog-widget` 出现处**起扫描到文件尾：新规则只要含 `.mdlog-widget` 字样就必须放在该出现位置之后，否则无关区段会被卷入扫描
- 数学公式：remark-math + rehype-katex。katex 必须位于 rehype 管线末尾（sanitize 和搜索高亮之后）——提前会让 KaTeX 输出被 sanitize 剥光，或被高亮逻辑拆坏公式 DOM；remark 侧的 `remarkMathCurrencyGuard` 是 Pandoc 式货币保护（「$5 和 $10」不误判为公式），别删；KaTeX 字体由 `vite.config.ts` 的 `katexWoff2Only` 插件裁成 woff2-only（WebView2 不需要 woff/ttf）
- **katex 版本必须与 rehype-katex 嵌套依赖的 katex 严格同版**（当前均 0.16.47）：CSS 从根 `katex` 包导入，渲染器是 rehype-katex 嵌套的 katex，katex 0.17+ 把 `sizing` 等类名改名，两边不同版会导致上下标 sizing 规则全部失配、公式重合。升级 rehype-katex 前必须先核对其 katex 依赖版本
- `WidgetSandbox` 组件必须严格实施 `React.memo` 与全局最多 10 个存活 iframe LRU 休眠机制；沙箱必须懒挂载，追加写入触发整篇重载时已有 iframe 必须保持位置稳定，严禁未经 memo 或频繁重建导致 WebView 子帧暴涨与交互状态丢失
- `CodeBlock.tsx` 与 `MarkdownDocument.tsx` 语言提取正则必须支持连字符（`/language-([\w-]+)/`），确保 `vellum-widget` 与 `objective-c` 等语言标识完整提取，未注册语言平滑降级为普通代码块
- `components` prop 必须是 `useMemo` 结果；其引用稳定性由生产接线级回归测试（`MarkdownDocument.test.tsx` 接线用例）保证，热重载不得重建 iframe；文档无原始 HTML 时会自动跳过 `rehype-raw`
- 热重载滚动恢复是「视口锚点元素优先、像素兜底」（`viewportAnchor.ts` 捕获 / App 恢复）：不要改回纯像素恢复——视口上方内容同步变高（流式代码块收合成 widget 等）时旧像素对应另一处内容会跳，且程序化像素覆盖会顶掉 Chromium 原生滚动锚定对异步 iframe 高度上报的补偿
- mdlog 记录期间模型追加触发的热重载**禁止吸底跟随**（用户停在哪儿就保持在哪儿）；仅非记录态且距底 ≤80px 的热重载才吸底
- widget 预载视距为上 400px / 下 1200px（滑到前 iframe 已渲染完毕，不再闪）；iframe 首个 resize 上报（或 load 后 500ms 兑底）前保持透明、就绪后淡入，高度变化走 CSS 过渡——不要把 rootMargin 改回小值，也不要去掉 `--ready` 淡入门禁
- **静态 widget 的 iframe 必须带 `mdlog-widget__frame--static`（`pointer-events: none`）**：跨源沙箱子帧只要存在几 px 可滚动余量（高度过渡窗口、字体后加载、2000px 截断），滚轮手势就会被 Chromium scroll-latch 锁进子帧——整个手势期父容器收不到滚动（「指针在图上滚动卡住、图微移、停 1-2 秒自愈」的根因）。交互性由 `widgetInteractivity.ts` 保守判定（通信 IIFE 之外有脚本/控件/链接/canvas 才算交互），宁可多放行也不错杀；别给静态图去掉这个类
- `read_mdlog_state` 的返回值必须 `?? null` 归一后再入 state：后端抖动给出 `undefined` 时 `undefined !== null` 会被误判为记录中，静默禁用吸底与热重载印章
- 残留 `.mdlog` sidecar 自动清理：`read_mdlog_state` 命令层在判定记录死亡（pid 死 或 心跳超时且非时钟回拨）后 best-effort 删除 sidecar 文件（`should_cleanup_stale_sidecar` / `cleanup_stale_sidecar_if_dead`）；`read_mdlog_state_from_path` 保持纯函数无副作用，pi 扩展侧 `session_start` 的 sessionId 不匹配分支也会对 pid 已死的 sidecar 做同样清理
- 完整优化记录见 `OPTIMIZATION_HANDOFF.md`（含评估后放弃的方向）

### 文件索引

| 文件 | 职责 |
|------|------|
| `src/App.tsx` | 主入口、文档加载、窗口显示 |
| `src/components/MarkdownDocument.tsx` | Markdown 渲染（`React.lazy` 懒加载） |
| `src/components/JumpToBottom.tsx` | 跳转到底部浮钮 |
| `src/components/CodeBlock.tsx` | 代码高亮（PrismLight，20 种语言） |
| `src/hooks/useOutlineWidth.ts` | 侧边栏宽度（200–320px，持久化） |
| `src/main.tsx` | 入口、字体加载 |
| `vite.config.ts` | 构建配置 |
| `src-tauri/tauri.conf.json` | Tauri 窗口配置 |

## 注意事项

- 纯阅读器，无编辑功能
- 窗口初始隐藏（`visible: false`），由前端控制显示
- `CustomScrollbar` 非常轻量，不需要优化
- 字体文件在 `public/fonts/`（~17MB），是应用资源
- 强调定界符贴 CJK/标点的兼容由**渲染层软件兜底**：`remark-cjk-friendly` + `remark-cjk-friendly-gfm-strikethrough`（在 `REMARK_PLUGINS` 中位于 remarkMath 之前），并有渲染级回归测试锁定（`MarkdownDocument.test.tsx`）；`vellum-mdlog` 技能侧的写法要求仅为跨渲染器可移植性建议，不再是硬禁令
- **`tauri/custom-protocol` feature 是生产上下文的开关**（tauri 2.11 的 `dev = !custom_protocol` 判定）：`Cargo.toml` 已显式声明，缺失它的构建会产出 dev 上下文 exe——窗口加载 `http://localhost:1420`、不嵌入前端资源，无 dev 服务器时显示「localhost 拒绝连接」。打包始终用 `npm run tauri build`（CLI 也会自动注入该 feature）；改 Rust 代码后验证可用裸 `cargo build --release`（manifest 已声明，结果一致）
