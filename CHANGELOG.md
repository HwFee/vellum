# 更新日志

本项目所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.6.1] - 2026-09-11

### 修复

- **交互 widget 沙箱吞掉滚轮手势（「指针在 widget 上滚动卡住」的真正根因）**：跨源沙箱子帧内只要存在可滚动余量——哪怕只有几 px（iframe 高度过渡窗口、字体后加载撑高、绝对定位浮层）——滚轮手势会被 Chromium scroll-latch **整段**锁进子帧，且跨帧不做手势续滚，于是页面纹丝不动。修法：沙箱 HTML 由 Rust 在服务响应期注入 `<style>html{overflow:hidden !important}</style>`（`WIDGET_ROOT_SCROLL_GUARD` / `inject_root_scroll_guard`），根文档不再是滚动盒。真机实测（release exe + CDP 合成手势）：修复前 `churn` 家族 widget 上请求滚动 1200px、容器位移 **0**；修复后在**手动解除离屏停帧**的同一状态下位移 **1215/1200**；10/10 沙箱子帧 `html.overflowY=hidden`。指针事件与子帧内点击不受影响，契约测高逐值相等（独立 Chrome 对照实验）
- 高度夹取上限 2000px → 6000px：根文档禁滚后，「超高内容在沙箱内部局部滚动」不再是回退手段，夹取过紧等于直接裁掉高内容

### 性能

- **离屏 widget 停帧降载**：`WidgetSandbox` 新增「渲染窗」观察器（`1200px 0px 2400px 0px`，严格大于预载视距 400/1200）双向切换 `--parked`，CSS 侧 `visibility: hidden`——跨源子帧的 rAF 与 CSS 动画完全停摆，而 **iframe 自身布局高度不变**（`display:none` 同样停帧但会把布局高塌成 0、顶动整篇文档，已实测排除并被 `kami.css.test.ts` 锁死）。进程级 CPU 实测（排除 DevTools 附挂干扰）：阅读位置（10 个存活沙箱、9 个离屏）**557ms/s → 409ms/s（−27%）**；全部离屏时 **523ms/s → 16ms/s**
- 主线程滚动基线入库（真机 CDP）：整篇 9000px 长滚动与逐 widget 滚动手势下，帧时长 p50 4.2ms / p95 4.3ms、掉帧 0、长任务 0 —— 也就是说此前体感的「不流畅」并非掉帧，而是手势被沙箱吞掉（页面不动但帧率指标完全正常，最迷惑人的一类）
- widget 契约（`.pi/skills/vellum-mdlog`）新增动画帧预算：实测一个视口内的 rAF-canvas 动画 widget 可稳定吃掉 0.4 核 CPU（停帧后降到 9ms/s），故要求 rAF 动画按 ≥33ms 节流、优先 CSS 动画；宿主只治得了离屏，视口内成本只能靠生成侧约束

### 工具

- 新增真机滚动探针 `scripts/cdp-perf-scroll.mjs`（`npm run perf:scroll`）：用 `Input.synthesizeScrollGesture` 投放**带手势语义**的滚动（离散 wheel 事件复现不出 scroll-latch）逐 widget 判定是否被吞，采集 rAF 帧时长 / longtask / LoAF / `Performance.getMetrics` / 进程级 CPU，可 `--trace` 做 devtools trace 归因，并对每个沙箱子帧断言根溢出保护已生效；`npm run verify:cdp` 别名指向原有 `cdp-verify.mjs`
- 探针踩坑记录（写进脚本注释，防止后人重踩）：① `Target.setAutoAttach` 会把跨源子帧**挂起等调试器**，不显式 `Runtime.runIfWaitingForDebugger` 则子帧 JS/rAF 全停（实测 10 个动画沙箱 CPU 从 523ms/s 掉到 0、per-child ScriptDuration 恒为 0），据此得出的 CPU/子帧指标全是假的；② 自定义协议响应不受 Network 域缓存，`Network.getResponseBody` 取不到 widget HTML，真机断言必须改成进子帧读 `getComputedStyle(documentElement).overflowY`；③ 测量前必须 `taskkill /IM vellum.exe /F`，单实例插件会把新实例参数转发给已开窗口、测量直接作废

- 退役三个「文档内容 grep 式」校验器：`verify-agents-md.mjs` / `verify-skill-contract.mjs` / `verify-skill-discovery.mjs`。它们把 AGENTS.md 与 SKILL.md 的措辞、词元、数值缓存成断言，文档一改就集体失真（实测三只全红：旧夹取 `[80, 2000]`、旧 frontmatter 触发模式、已撤销的「目录随仓库版本化」例外）——文档本身是唯一真相，校验器只是它的副本。保留 `verify-widget-template.mjs`（盯的是 `assets/widget-template.html` 这个真实资产的契约 IIFE 与字体栈，不是文案）
- `.pi/skills/vellum-mdlog` 的 description 按 writing-for-agents 的指针写法重写：front-load `Use when`、两个触发分支各写一次（mdlog 连接 → 每条回复 / 无提示的图优于文字）、砍掉正文已承载的能力清单

## [1.6.0] - 2026-09-10

### 新增

- 块级就地编辑（Obsidian Live Preview 近似手感）：`Ctrl+E` / 顶栏按钮切换阅读 ⇄ 编辑视图，编辑视图下点任意块即就地改源码、点走即提交（`Esc` / `Ctrl+S` / 失焦 / 点别的块 / 切文档 / 关窗 / 搜索与大纲跳转全部走同一提交路径）。块粒度为顶层节点 + 列表项 + 引用/脚注定义内直接子块；光标落点为**行级近似**（精确到字符需编辑器内核，记入已知限制）
- 提交即落盘（自动保存）：新增 `save_document` 命令做原子写（同目录临时文件 + rename）并保真换行符与 BOM，带「当前文档路径 / Markdown 扩展名 / 50MB 上限」三重闸门；保存失败时内存回退到磁盘状态、草稿留在框内可重试。不设体积硬阈值，实测提交耗时 > 800ms 时在编辑视图内挂一条常驻软提示（仅本会话内粘性）
- 结构性只读：块级 HTML（含 mdlog 头注释）与 `vellum-widget` 交互块**没有编辑入口**（编辑视图里以**加粗灰色虚线框 + `not-allowed` 指针**标识，零文字提示），行内 HTML 仍作为块内源码文本可编辑；mdlog 记录中编辑门禁全关（顶栏禁用 + 提交口拦截 + Rust 侧存活闸门）
- 外部变更分流与回声抑制：`file-changed` 到达时先与内存 markdown 按归一 EOL 比对——相等（我方写入的回声）整体忽略，不递增 `reloadTick`、不闪「墨迹未干」、不做滚动补偿；不等则中断当前块编辑（草稿尽力写入剪贴板）后静默热重载
- 数学块、代码块与 widget 由 `display: contents` 包裹层 `div.vellum-unit-wrap` 承载块标记，包裹后仍可点入编辑；标记只在编辑视图挂载 ⇒ 阅读视图 DOM 与改动前逐字节一致

### 修复

- **✕ 关不掉窗口（真机）：** Tauri 的 `onCloseRequested` 包装层在不拦截时会调 `destroy()`，而 capabilities 里只有 `allow-close` —— 缺 `core:window:allow-destroy` 导致销毁被 ACL 拒绝（真机报 `Command plugin:window|destroy not allowed by ACL`）。已补权限，并给关闭处理器加异常兜底（任何意外都放行关闭，绝不因处理器抛错而卡住窗口）
- **生产构建 IPC 被 CSP 拦下（先于本功能存在）：** CSP 缺 `connect-src`，回落到 `default-src 'self'` 把 `http://ipc.localhost` 全拦，`plugin:store`（阅读位置 / 侧栏状态 / 上次打开）与 `plugin:event`（`file-changed` / `mdlog-state-changed` / `pending-open-docs`）在生产构建里全程走 postMessage 降级通道并持续报错。已加 `connect-src ipc: http://ipc.localhost`
- **单行块被撑成两行（真机）：** textarea 固有高默认 `rows=2`，而 `scrollHeight` 返回「内容高与自身可见高的较大值」——单行草稿被量成两行高，于是点每一块都会多出一行留白并把下方内容推走。已改为 `rows=1` + 自增高前先把高度归零再读 `scrollHeight`，并把行高按**该块渲染态实测值**对齐（段落/标题/列表项行高各异）
- **点第一块却整篇滚到底（真机）：** 激活瞬间覆盖层尚未拿到内联定位，停在内容末尾的静态位置，浏览器为把焦点元素滚入视野一路滚到底（widget 重度长文档必现），且该「底部」会被阅读位置记忆记住、下次打开也在底部。已改为 `focus({ preventScroll: true })` + 盒未就绪时**不渲染**覆盖层

## [1.5.0] - 2026-09-10

### 变更

- 设计语言对齐上游 kami v1.15.0（v1.14「Quieter Pages」减法规则落地）：正文 h1 去掉 3px 靛青题签、引用块去掉侧线改缩进赭灰、表格默认去掉斑马纹（行分隔先靠留白）；新增 `--inline-code-bg`（行内代码底色）、`--tag-bg` / `--brand-tint`（实色标签底）token；代码高亮配色收敛到 kami  token（keyword 靛青 / comment 石灰 / string 赭灰 / number 淡墨 / function-class 近墨，bold 上限 500）

## [1.4.0] - 2026-09-09

### 新增

- mdlog 实时记录与交互沙箱：`vellum-widget` 代码块渲染为隔离沙箱 iframe（postMessage 高度自适应、视口预载、10 实例 LRU 休眠唤醒），Rust 侧 widget 注册表与协议生命周期守卫；文件监听对日志追加与文档改写双独立防抖；顶部 live 徽标、定时复检与自动重连；书札卷轴版式（mdlog 作用域对话样式、去 widget chrome）；附 `vellum-mdlog` 项目专属技能、骨架模板与校验脚本
- 数学公式：remark-math + rehype-katex，KaTeX 字体裁成 woff2-only，`$5` 类货币文本不误判为公式
- 强调定界符贴 CJK/标点兼容：渲染层 remark-cjk-friendly 软件兜底（技能侧写法要求降级为可移植性建议）
- 字体统一与宽屏排版：正文与 widget 同栈今楷（TsangerJinKai02 优先，WOFF2 自托管）；正文列宽 800→1080px
- 侧边栏宽度拖拽调节：右缘手柄拖动在 200–320px 间微调（默认 240px），双击复位，持久化保存并在启动时恢复
- 「跳转到底部」浮钮：距底超过 300px 时在右下角浮现，点击缓动到底，用户滚动/按键可随时打断；mdlog 记录期间追加拉开距底距离后同样可用
- 阅读位置记忆增加顶层块索引锚点：无标题文档（mdlog 日志常态）不再依赖会被末尾追加稀释的比例值

### 修复

- **间歇性无法跳回上次阅读位置**（v1.3.3 未入库，现归档）：恢复按「比例 × 当时的 scrollHeight」一次性计算像素目标，而图片/字体的异步加载会撑大 scrollHeight 推动内容下移。现恢复后由「落位守护」盯住内容尺寸，布局稳定前持续重新锚定；用户一滚动/按键即让出控制权
- **上次的位置被删改后跳飞**（v1.3.3 未入库，现归档）：阅读位置从纯比例升级为「锚点 + 偏移 + 比例兜底」——记录视口顶部最近的标题及相对偏移；标题被删或改名则落到文档顺序上最近幸存的标题附近；旧版记录自动兼容
- **mdlog 连接中开关侧边栏页面卡死**：侧边栏过渡期间所有 widget iframe 随宽集体重排，恰逢 mdlog 追加触发的整篇热重载会饱和主线程。新增布局过渡窗机制：侧边栏开关 450ms 与拖宽期间，热重载延迟合并提交、程序化滚动恢复让位原生 scroll anchoring、widget 高度过渡关闭；同时热重载恢复在用户滚动输入后 300ms 内一律避让
- **末尾注入新内容后无法跳回记忆位置**：纯比例恢复记录按「比例 × 新总高」落点必然错位，且落位守护会随 widget 异步撑高持续追漂；块索引锚点对末尾追加天然稳定，恢复顺序为 标题锚点 → 顶层块锚点 → 比例兜底
- **强杀 pi 进程后残留 `.mdlog` sidecar 文件**：Vellum `read_mdlog_state` 命令层在判定记录死亡（pid 死或心跳超时且非时钟回拨）后自动清理；pi 扩展 `session_start` 的会话不匹配分支同样清理 pid 已死的残留 sidecar
- **重连后系统提示注入锁定**：补充回归测试锁定两条重连路径（手动 `/mdlog` 重连、`session_start` 自动重连）均恢复注入「mdlog live log: CONNECTED」系统提示
- **公式上下标重合**：根 `katex` 与 rehype-katex 嵌套渲染器版本错配（0.17+ 类名改名），现严格锁定同版 0.16.47
- **生产构建产出 dev 上下文 exe**（窗口加载 localhost、无前端资源）：`Cargo.toml` 显式声明 `tauri/custom-protocol` feature
- **指针在静态图上滚动卡住**：静态 widget iframe 带 `pointer-events: none`，交互性由保守判定（通信 IIFE 之外有脚本/控件/链接/canvas 才算交互）决定是否放行
- 热重载滚动仲裁：mdlog 记录期追加禁止吸底跟随（仅非记录态且距底 ≤80px 才吸底）；恢复走「视口锚点元素优先、像素兜底」，不再顶掉 Chromium 原生滚动锚定

### 变更

- mdlog 记录期间阅读位置不再暂停保存：连接建立瞬间基线保存一次，滚动防抖持续保存（块索引锚点对追加稳定）——pi 或 Vellum 被强杀（无 beforeunload）也能恢复到 300ms 内的位置

## [1.3.2] - 2026-07-25

### 修复

- 删除搜索词时页面立即跳动：urgent 渲染阶段（deferred 搜索词未跟进）索引被重置为 0 是输入的副产物，不再据此滚动；「纯删除」的 300ms 防抖不再被绕过
- 页面滚动到文档顶部时大纲高亮消失：`useOutlineSync` 增加顶部兜底，所有标题都在阈值线下方时激活第一个标题
- 搜索输入/删除时大纲不跟随：移除搜索期间的跟随门禁，大纲对所有正文滚动统一平滑跟随（自定义缓动自动接续，无连锁抖动）
- 搜索框遮挡大纲高亮、连点上/下导航时误点：搜索框与目錄标题固定在侧栏滚动区外，仅大纲列表独立滚动，搜索框位置不再随滚动上浮

## [1.3.1] - 2026-07-24

### 修复

- 修复程序化滚动被用户输入打断时产生的拉扯/闪动问题。所有自动滚动（恢复阅读位置、点击大纲跳转、搜索匹配定位）统一改为先快后慢的 ease-out 缓动，并在用户滚轮、触摸或按键时立即取消动画，将滚动控制权交还用户。

## [1.2.0] - 2026-07-24

### 新增

- 文档内搜索：大纲面板搜索框（⌘K / Ctrl+K 聚焦），Enter / Shift+Enter 在匹配项间跳转，当前匹配高亮并平滑滚动定位，实时显示「第 n/共 N 项」

### 性能

- 代码高亮改用 `PrismLight` 按需注册 20 种语言，打包产物由 303 个文件（~2.5MB）降至 6 个（672KB）
- `manualChunks` 拆分 React 核心与语法高亮为独立 chunk，正文引擎 `React.lazy` 懒加载
- 启动时窗口在首篇文档渲染提交后才显示，消除空状态闪现；字体改为后台加载不阻塞渲染
- 搜索体验：搜索词经 `useDeferredValue` 传入文档层，输入不再被大文档重解析阻塞；切换上一个/下一个匹配改为 DOM 打标，不再整篇重解析
- 文档不含原始 HTML 时自动跳过 `rehype-raw` 的二次解析
- `components` prop、大纲树、代码块/图片组件全面 memo 化，消除无关重渲染
- 打包只产出 NSIS 单安装包；release 构建保持 `lto = true` + `codegen-units = 1` 最大优化

## [1.1.0] - 2026-07-22

### 修复

- 启动时 reg.exe 控制台窗口闪现（`CREATE_NO_WINDOW`）

## [1.0.0] - 2026-07-21

### 重命名

- 项目由 "Kami Markdown Viewer" 更名为 "Vellum · 素笺"，应用标识符改为 `local.vellum`

### 新增

- 文件热重载：Rust 侧 `notify` 监听当前文档所在目录（兼容编辑器原子保存），400ms 防抖合并连续保存，变更后静默重载并保留滚动位置，以"新墨过渡"（正文由虚而实）提示更新，宽窗口下另有页边竖排小字"墨迹未干"随文档浮现两秒
- 字体预加载：TTF 转 WOFF2（体积减半）、`font-display: block`、`<link rel="preload">`、渲染前等待 `document.fonts.ready`（3s 兜底），消除首屏字体闪烁

### 变更

- 应用图标全套更新
- 重载提示 toast 改为纸面墨蓝风格（象牙底 + 墨蓝衬线 + 发丝线边框）

### 修复

- 首屏字体闪烁（FOUT）：打开时不再先显示回退字体再切换

## [0.1.3] - 2026-07-17

### 变更

- 大纲侧边栏重新设计：由悬浮卡片改为无框嵌入栏——贴边全高、与正文同一纸面，仅以发丝线分隔；层级以细竖线引导，当前标题改为墨色加句读墨点标记
- 顶栏视觉统一：大纲开关与打开文件组成左侧 ghost 图标工具簇，标题与路径改为单行排布并显示文件所在路径
- 大纲条目补充键盘焦点环样式

### 测试

- 大纲改以嵌套树渲染，新增树构建（含 h1→h3 跳级）与嵌套结构用例
- 修复代码块测试输出中的 React act(...) 警告，测试输出恢复干净

## [0.1.2] - 2026-07-17

### 安全

- `resolve_asset` 改为以 Rust 侧记录的当前文档目录为锚点解析资源路径，不再信任前端传入的 `document_path`，杜绝通过伪造锚点读取盘上任意文件
- 新增内容安全策略（CSP），此前为空，渲染层 XSS 失去最后一道防线
- Markdown sanitize 白名单移除 `form`、`button`、`select`、`textarea` 等表单元素，阻断经表单 `action` 的任意外部导航（保留任务列表所需的 `input`）

### 修复

- 切换文档时滚动位置重置回顶部，不再停留在上一篇文档的位置
- `load_document` / `resolve_asset` 改为异步命令，打开大文件、大图片不再冻结界面
- 连续打开两个文件时，较慢返回的响应不再覆盖较新的文档
- 文件对话框与加载失败不再产生未处理的 Promise rejection，错误正确进入错误状态
- 启动参数解析改用 `args_os`，避免非 Unicode 文件名导致启动即崩溃
- 修复 StrictMode / 竞态下 `open-file-from-args` 监听重复注册且无法清理
- 修复 CustomScrollbar 拖拽过程中组件卸载导致的全局监听泄漏
- 图片 `title` 属性正确透传，不再被静默丢弃
- `mailto:`、`ftp:` 等非 http(s) 链接改由系统默认程序打开，不再静默失败
- 删除从未生效的 `webview_scrollbar` 模块及 `webview2-com` 依赖

### 变更

- 代码高亮语言包改为按需异步加载，主包体积从 1MB+ 降至约 620KB
- 界面文案统一为中文（启动页、错误页、工具栏、窗口控制按钮）
- 文档与资源文件读取增加 50MB 上限，超限返回明确错误
- 窄屏下支持 Escape 键关闭大纲面板，滚动容器支持键盘滚动
- 依赖统一钉为精确版本（`@tauri-apps/plugin-store`）

### 测试

- 新增 CustomScrollbar 拖拽换算 / 轨道翻页测试、窗口宽度监听测试
- 修复路径遍历测试此前无法真正覆盖目录包含检查的问题
- 新增非 UTF-8 拒绝、文件不存在、percent 编码遍历、大写扩展名等 Rust 侧用例

## [0.1.1] - 2026-07-12

### 新增

- 文档大纲面板：提取 h1-h3 标题、滚动跟随高亮、展开状态持久化
- 代码块一键复制

## [0.1.0] - 初始版本

- Kami 风格的 Windows Markdown 查看器：GFM 渲染、代码高亮、本地图片解析、自定义滚动条、无边框窗口、文件关联与启动参数打开

[1.0.0]: https://github.com/HwFee/vellum/compare/v0.1.3...v1.0.0
[0.1.3]: https://github.com/HwFee/vellum/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/HwFee/vellum/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/HwFee/vellum/compare/v0.1.0...v0.1.1
