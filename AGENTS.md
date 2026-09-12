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
npm test             # vitest run（34 测试文件，459 用例）
npm run tauri        # Tauri CLI
```

## 技能安装流程

### 仓库结构

全局技能仓库：`C:/Users/17445/Desktop/HwFee-skills/skills/`

每个项目通过**目录联接**引用仓库中的技能，**不拷贝**（本地 `.pi/skills/<skill-name>` 均为联接，永不入库；`.gitignore` 已忽略 `.pi/skills/`）。

> **git 会跟随联接读到真实内容**——所以这些路径可以被误 `git add` 进来，历史上就发生过。判据只有一条：`git ls-files .pi/skills/` 有输出就是错，用 `git rm -r --cached .pi/skills/<skill-name>/` 解除跟踪（`--cached` 只动索引）。**别用 `rm -rf` 删那个路径**——它会顺着联接删掉全局库里的真身。

> 2026-09-12 记录：`vellum-mdlog` 单一归属全局技能库（`C:\Users\17445\Desktop\HwFee-skills\skills\vellum-mdlog`；该库自身是 git 仓库，远端 `HwFee/skills-manager-backup`，备份由 Skills Manager 维护）。此前「项目专属、不迁库、开箱即用」的例外不再成立：本仓库只留目录联接，外部 clone **不会**得到该技能，需按「安装新技能」第 5 步重建联接。2026-09-10 的迁移当时只删了磁盘目录、漏了解除跟踪，已于 2026-09-12 补齐。

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
| `vellum-mdlog` | Vellum 纸墨 Markdown 与 `vellum-widget` 契约（2026-09-10 起迁入全局仓库，本地为目录联接）。三个触发分支：mdlog 连接（逐回合强制）、**写本机 Vellum 阅读的 md 笔记**（2026-09-12 新增）、无提示出图。契约 1–6 全文在技能内 `references/widget-contracts.md`，速查在 `references/troubleshooting.md`——主体 `SKILL.md` 只留分支路由、图承载禁令、出图流程与最小清单。其「强调定界符跨汉字+括号」写法要求已于 2026-09 起降级为可移植性建议——渲染层由 remark-cjk-friendly 软件兼容（见「注意事项」） |

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
- **宽度过渡期必须自己钉住视口（`viewportPin.ts`）**：侧栏开关/拖宽只改正文**宽度**，正文按新宽度重新断行 ⇒ 整篇文档高度变化（用户文档实测 ±3965px），而 **Chromium 原生滚动锚定对「行内尺寸变化驱动的重排」一律不补偿**——真机对照实验里同一个纯 1000px 滚动容器改字号（`Δh=+10239` ⇒ `ΔscrollTop=+4777`，正常补偿）、改宽度则 `ΔscrollTop` 恒为 0；于是 scrollTop 原地不动、视口内容整段平移（关侧栏向上跳 ~3600px，开回来再跳回原位，观感即「页面闪到别处、开回来又恢复」）。故事件入口（**状态更新之前**，此刻仍是旧布局）先 `captureViewportAnchor` 记下视口顶部首个可见块 + 偏移，再在窗内逐帧按该锚点补偿，首帧补偿放在 `useLayoutEffect` 里绘制前同步完成，用户滚动输入立即交还控制权。**侧栏开关的全部入口**（顶栏按钮 / `Ctrl+K` / 窄屏 Escape 与遮罩 / 窄屏选章）与拖宽手柄都必须走 `beginWidthTransition()`——漏一个入口，该路径就会闪；别指望原生锚定接手
- 热重载滚动恢复在用户滚动输入（滚轮/触摸/按键/滚动条拖拽）后 300ms 内跳过（`lastUserScrollAtRef`）：否则提交瞬间会把用户刚滚出去的距离当「漂移」拽回。键盘只在**会滚动的键**上记时间戳（清单在 `lib/scrollInput.ts`，带单元测试）——任何按键都记会把 `Ctrl+K` 等快捷键误判成用户接管，而 `Ctrl+K` 开侧栏时视口钉住会被当场取消、宽度回流没人补偿（快捷键路径重新跳动）
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
- **沙箱根溢出保护（scroll-latch 的正面修复）**：`widget.rs` 的 `WIDGET_ROOT_SCROLL_GUARD` / `inject_root_scroll_guard` 给每个 widget 响应注入 `<style>html{overflow:hidden !important}</style>`——跨源子帧只要有几 px 可滚余量，滚轮手势就会被 Chromium scroll-latch **整段**吞掉且跨帧不续滚（「指针在 widget 上滚不动」的根因）。三条不可回退：① 出网前注入（`build_widget_response`，`WidgetRegistry` 保持纯存储）；② 样式必须落在文档内部（越过 `<!DOCTYPE` 会退回 quirks 模式）；③ 只作用 `html`、不碰 `body`（`body{height:100vh;overflow:auto}` 是合法自滚动形态）。实测数据见 `CHANGELOG.md` 未发布段，探针与踩坑见 `scripts/cdp-perf-scroll.mjs` 头部注释
- **交互块授权是「三源 + 落盘台账」**（`widgetTrust.ts`）：a) `autoMount`（mdlog 日志文档）；b) `trustedWidgets` 台账——按 **widget 源码指纹**（cyrb53 + 长度前缀）记住用户点过 `[点击加载]` 的内容，写入共享 settings Store（上限 300、FIFO；Store 失败退 localStorage），渲染期用 `useSyncExternalStore` 同步判定；c) 本会话 ref。**同一份内容只需点一次**（跨文档重开与重启应用都有效），同一文档里*不同的*交互块仍需各自点一次。已授权的块被 LRU 休眠后**滑回视野自动 `activate`**（休眠只是「全局最多 10 个存活 iframe」的内存闸门，不该让人点第二次）；**未授权**的块一律停在占位块，门禁不得放宽。注意自动恢复会让存活数在滚动/高度上报期间**短暂超过 10**（淘汰只在滚动静默 400ms 后跑一轮，且 `isScrolling` 期间不淘汰），静默后收敛回 10——上限是**稳态**约束，真机实测（21 块文档）：滑到底部 3s 后 `frames=10`，滑回顶部首个块自动恢复且仍未超过 10
- 高度夹取 `[80, 6000]` px（不是 2000）：根文档禁滚后，夹取过紧等于直接裁掉高内容，别改回
- **离屏 widget 停帧降载**：`WidgetSandbox` 的「渲染窗」观察器（`PARK_ROOT_MARGIN` **必须严格大于预载视距**，否则滑到前会出现空框）双向切 `--parked` = `visibility: hidden`，是跨源沙箱唯一可用的宿主侧降载手段；**禁止改成 `display:none`**（布局高塌成 0、顶动整篇，已由 `kami.css.test.ts` 锁死）。视口内动画的固有成本（跨源，宿主无权干预）由 widget 契约的帧预算约束
- **静态 widget 的 iframe 仍必须带 `mdlog-widget__frame--static`（`pointer-events: none`）**：根溢出保护已覆盖交互 widget，这个类作为静态图的纵深防线保留（静态图不需要指针，穿透后连 hover 都不抢）。交互性由 `widgetInteractivity.ts` 保守判定（通信 IIFE 之外有脚本/控件/链接/canvas 才算交互），宁可多放行也不错杀；别给静态图去掉这个类
- `read_mdlog_state` 的返回值必须 `?? null` 归一后再入 state：后端抖动给出 `undefined` 时 `undefined !== null` 会被误判为记录中，静默禁用吸底与热重载印章
- 残留 `.mdlog` sidecar 自动清理：`read_mdlog_state` 命令层在判定记录死亡（pid 死 或 心跳超时且非时钟回拨）后 best-effort 删除 sidecar 文件（`should_cleanup_stale_sidecar` / `cleanup_stale_sidecar_if_dead`）；`read_mdlog_state_from_path` 保持纯函数无副作用，pi 扩展侧 `session_start` 的 sessionId 不匹配分支也会对 pid 已死的 sidecar 做同样清理
- **块级就地编辑（2026-09-10 新增）不变量**：
  - 编辑面沿用既有 `.document-scroll` 容器（textarea 自增高推流），**不得**新建内层滚动系统——滚动记忆 / 跳底 / 自定义滚动条 / 布局过渡窗全部复用
  - 提交（`useDocumentEditor.commitActive` → `onMarkdownChange` + `save_document`）**不递增 `reloadTick`、不播「墨迹未干」印章、不做滚动补偿**：印章语义是「外部改写了文件」；提交后 watcher 的回声由「磁盘 vs 内存 markdown（LF 归一）比对」抑制（`App.tsx` `reloadIfExternal`），相等即整体忽略
  - 块标记包裹层 `.vellum-unit-wrap` 必须 `display: contents`（不生成布局盒）：`BlockEditor` 的隐藏/锁高/自增高/测量因此**必须**作用在 `resolveTarget()` 选出的「首个有布局盒的元素」上，作用于包裹层本身会全部失效
  - 覆盖层选择器必须是 `.document-scroll__content--editing > .block-editor__input`（特异度高于 `kami.css` 的 `.markdown-body textarea`），且覆盖层**不是** `.markdown-body` 后代：CSS 侧由 `kami.css.test.ts` 锁死规则文本，DOM 侧由 `App.test.tsx` 断言直接父元素带 `--editing`（终审修复波 F41 补齐，两侧齐备才防接线漂移）
  - `Ctrl+S` 双通道去重：编辑框 `onKeyDown` 只阻止默认行为、不停止冒泡，全局处理器必须 `if (event.defaultPrevented) return;`，且 `useDocumentEditor` 要有在途提交闸门（`committingRef`）——只做其中一处，结构变化草稿会被 splice 两遍并二次落盘
  - 切换文档（`loadPath` 判定非同路径）必须调用 `editorRef.current?.resetSession()`：落盘失败时 F24 会把编辑会话留在原地，不清就会把上一份文档的草稿拼进新文档
  - 结构性只读必须覆盖**全部**块级容器（`list` / `listItem` / `blockquote` / `footnoteDefinition`）；脚注定义要当可下钻容器（与引用同列），否则其中的块级 HTML / `vellum-widget` 源码会落到一个 `editable: true` 的块上。回归断言用「容器 × 锁定块」遍历式清单（`editUnits.test.ts`），不得只补容器例子
  - mdlog 记录中编辑门禁三重：顶栏/入口禁用（`toggleView`/`activateUnit`）＋ 提交口 `commitActive` 拦截 ＋ Rust `save_document` 存活闸门；**不得**只保留入口一处
  - **编辑视图视觉形态（2026-09-12 A2「页边字符」定稿）**：正文与阅读视图一致，编辑信号全在块左页边——hover 淡 `¶`、只读块常驻灰 `×`（不再有粗灰虚线框）、激活块由覆盖层伴生的 `.block-editor__mark`（brand `¶`）标示；覆盖层 textarea 透明底零框线（padding 左归零，草稿首字与渲染态逐像素对齐）。页边字符一律「绝对定位 + auto 偏移（静态位置）+ `margin-left: -26px`」，**绝不给块自身加 `position:relative`**——代码块 / widget 根容器带 `overflow:hidden`，伪元素以它们为包含块时 `-26px` 处的字符会被整条裁掉（`kami.css.test.ts` 有反裁剪红线断言）
  - 入口 chunk（`dist/assets/index-*.js`）因本功能实测 143.76KB → 158.08KB（+14.32KB，gzip +4.57KB，来源：`npm run build` 产物对比 `848899c` 之前 `d9f8523` 的工作树）；终审修复波后为 **158.53KB**（`index-BAtPp06D.js`，再 +0.45KB：脚注下钻 + 提交在途闸门/会话复位 + 重文档轻提示接线）；**离屏 widget 停帧降载后为 158.99KB**（`index-BlB50Eub.js`，再 +0.46KB：渲染窗观察器与 `--parked` 类）；**宽度过渡期视口钉住后为 160.02KB**（`index-Blh-c-xV.js`，再 +1.03KB：`viewportPin` + `scrollInput` 按键分类 + 侧栏各入口接线）；**锚点接管 + 交互块信任台账后为 160.88KB**（`index-BRHmFj8f.js`，再 +0.86KB：`widgetTrust` 指纹台账 + `useSyncExternalStore` + 锚点点击委托）；**A2 页边字符重设计后为 161.10KB**（`index-CDZYDhaa.js`，再 +0.22KB：`.block-editor__mark` 页边标记）。此增量为 `useDocumentEditor` 引入 `buildEditUnits`（math 解析器进入口）所致。若后续继续增长，按裁定 F11 的退路把单元计算移回 lazy 侧
- 完整优化记录见 `OPTIMIZATION_HANDOFF.md`（含评估后放弃的方向）

### 文件索引

| 文件 | 职责 |
|------|------|
| `src/App.tsx` | 主入口、文档加载、窗口显示、编辑视图接线（提交落盘 / 回声抑制 / 外部变更分流） |
| `src/components/MarkdownDocument.tsx` | Markdown 渲染（`React.lazy` 懒加载） |
| `src/components/BlockEditor.tsx` | 就地编辑面（隐藏原块锁高、自增高推流、Esc/失焦提交） |
| `src/hooks/useDocumentEditor.ts` | 编辑会话状态机（视图门禁、草稿、提交即落盘、提示条） |
| `src/lib/editUnits.ts` | Markdown → 块单元（纯函数：区间、可编辑性、HTML/widget 结构性只读） |
| `src/lib/rehypeEditUnits.ts` | 编辑视图的块标记 rehype 插件（sanitize 之后、katex 之前） |
| `src/lib/scrollStick.ts` | 贴底判定 |
| `src/lib/viewportAnchor.ts` | 热重载视口锚点（捕获/补偿原语） |
| `src/lib/viewportPin.ts` | 宽度过渡期视口钉住（侧栏开关/拖宽不跳） |
| `src/lib/scrollInput.ts` | 「用户滚动输入」的按键分类（快捷键不得误判） |
| `src/lib/widgetTrust.ts` | 交互块信任台账（按源码指纹落盘，点一次即可） |
| `src/components/JumpToBottom.tsx` | 跳转到底部浮钮 |
| `src/components/CodeBlock.tsx` | 代码高亮（PrismLight，20 种语言） |
| `src/hooks/useOutlineWidth.ts` | 侧边栏宽度（200–320px，持久化） |
| `src/main.tsx` | 入口、字体加载 |
| `vite.config.ts` | 构建配置 |
| `src-tauri/tauri.conf.json` | Tauri 窗口配置 |

## 注意事项

- **多实例（2026-09-12）**：无单实例锁（`early_single_instance` 模块与 `tauri-plugin-single-instance` 均已移除），每次启动都是独立进程/窗口，各自从命令行参数加载自己的文档。settings Store 跨进程共享、后写覆盖——阅读位置按文件路径键控，不同文件的实例互不干扰；同一份设置（侧栏宽等）以最后退出者为准。运行期不再有 `pending-open-paths` 事件，前端只在启动时 drain 一次 `drain_pending_open_paths`
- 阅读器 + 块级就地编辑（`Ctrl+E` / 顶栏按钮进编辑视图；mdlog 记录中禁止编辑）
- 文档内锚点链接（`[文字](#id)`）由 App 接管点击（`scrollToContentFragment` + `.document-scroll` 上的事件委托）：目标在正文里走缓动滚动（与大纲点击同一路径），`#`/`#top`/`#main` 视为回到顶部；**编辑视图下不接管**（那里点击是「进入块编辑」）。新增锚点入口时必须同时更新 `handleSelectHeading` / `scrollToContentFragment` / `animateContainerTo` 这三者共用的缓动路径
- 窗口初始隐藏（`visible: false`），由前端控制显示
- `CustomScrollbar` 非常轻量，不需要优化
- 字体文件在 `public/fonts/`（~17MB），是应用资源
- 强调定界符贴 CJK/标点的兼容由**渲染层软件兜底**：`remark-cjk-friendly` + `remark-cjk-friendly-gfm-strikethrough`（在 `REMARK_PLUGINS` 中位于 remarkMath 之前），并有渲染级回归测试锁定（`MarkdownDocument.test.tsx`）；`vellum-mdlog` 技能侧的写法要求仅为跨渲染器可移植性建议，不再是硬禁令
- **打包前必须确认没有 Vellum 实例在跑**（`Get-Process vellum` 为空）：release 二进制被占用时 `npm run tauri build` 会在链接阶段报 `failed to remove file ... vellum.exe / os error 5 拒绝访问`，且**前端产物已构建完成**，很容易误以为是代码错。先 `taskkill /IM vellum.exe /F` 再打包。
- **生产构建专属坑（真机才会暴露，jsdom 与 dev 模式下全绿）**：
  - capabilities 必须有 `core:window:allow-destroy`：`onCloseRequested` 的 JS 包装层在处理器**不拦截**时会调 `destroy()`，只声明 `allow-close` 是不够的——缺权限则**窗口永远关不掉**（真机 Console：`Command plugin:window|destroy not allowed by ACL`）。同理关闭处理器必须有异常兜底（任何意外都放行关闭，否则一次抛错就把窗口永久留住）
  - CSP 必须含 `connect-src ipc: http://ipc.localhost`：缺它会回落到 `default-src 'self'` 把 IPC 拦掉，`plugin:store`（阅读位置 / 侧栏状态 / 上次打开）与 `plugin:event`（`file-changed` / `mdlog-state-changed`）在整个生产构建里**全程走 postMessage 降级通道并持续报错**（`main.rs` 有断言 CSP 字符串全等的测试，改 CSP 必须同步改它）
  - 真机验证入口：`scripts/cdp-verify.mjs`（以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 启动 release exe，再用 Node 原生 WebSocket 走 CDP 断言：CSP 违规数 / ACL 拒绝数 / 笔⇄书图标 / 单位块数量 / 点 ✕ 后 page target 归零）
  - 真机滚动/锁存探针：`scripts/cdp-perf-scroll.mjs`（`npm run perf:scroll`）——合成手势逐 widget 判锁存 + 帧时序 / 进程级 CPU / 可选 trace 归因 + 每个沙箱子帧的根溢出保护断言；跑前必须 `taskkill /IM vellum.exe /F`（多实例后新实例不再被吞，但并存实例的 WebView2 会污染 CPU/帧时序读数，preflight 仍要求独占）。方法论与踩坑写在脚本头部注释
  - 真机「侧栏开关跳位」探针：`scripts/cdp-sidebar-jump.mjs --file <真实.md>`——逐帧对比「钉住元素相对容器顶偏移」与 scrollTop/文档高/正文宽，分**帧内读数**与**绘制后读数**两个数（只有后者是用户看到的画面：rAF 内的修正回调早于探针采样时，帧内读数会记下修正前的状态）；自带四个相位/实验：关侧栏 / 开侧栏 / 窗口缩放（Emulation）/ 拖宽手柄（合成指针），以及「瞬时改宽」与「关停全部 CSS 过渡的侧栏开关」两组对照，并回放 scrollTop 写入来源栈。**必须先派一次 wheel 再等 6s**，否则阅读位置落位守护的缓动动画会污染测量
  - 真机锚定规则对照：`scripts/cdp-anchor-synthetic.mjs`——纯合成滚动容器里「改宽度 vs 改字号」的锚定矩阵，确认「行内尺寸变化不补偿」是**浏览器规则**（同一容器改字号正常补偿、改宽度恒为 0），与项目结构无关
- **`tauri/custom-protocol` feature 是生产上下文的开关**（tauri 2.11 的 `dev = !custom_protocol` 判定）：`Cargo.toml` 已显式声明，缺失它的构建会产出 dev 上下文 exe——窗口加载 `http://localhost:1420`、不嵌入前端资源，无 dev 服务器时显示「localhost 拒绝连接」。打包始终用 `npm run tauri build`（CLI 也会自动注入该 feature）；改 Rust 代码后验证可用裸 `cargo build --release`（manifest 已声明，结果一致）
