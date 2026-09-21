# Vellum · 素笺 — 设置页 / 顶栏 B / 勾选定稿（2026-09-20 第二批）

来源：界面提案预览 `docs/preview/topbar-settings-proposal.html`（定稿版，用户已逐节拍板：「OK 开改吧」）。该文件是本计划的 **Spec**——视觉与交互以它为准，像素值取 kami.css 现行规则。

上一批（reader-polish，T1–T12）已全部完成并合在 `feat/reader-polish`；本批在其之上继续。

## Global Constraints（所有任务必须遵守）

承袭 `2026-09-20-reader-polish.md` 的 Global Constraints 1–15，另增：

16. 顶栏任何位置不显示路径与文件名；路径归宿 = 正文 `h1.document-title` 的 `title` tooltip + 设置页「当前文档」。
17. 设置页复用文章页整副骨架：同一枚侧栏（240px、parchment、发丝右缘、`outline-panel` 语汇）换内容为「設定」导航；侧栏开合/拖宽全部入口仍走 `beginWidthTransition()`。
18. 设置页文案全部简体中文；唯二繁体为题头「設定」（与「目錄」同例）。侧栏题头二字以外的条目（阅读/界面/更新/关于与数据）一律简体。
19. 勾选灰化与划线只作用阅读视图；编辑视图里源码就是源码，不加任何样式。
20. 既有 aria-label 钉住的测试文案不动：「切换大纲」「阅读设置」「切换编辑视图」「打开文件」等；设置视图中顶栏最左按钮仍是同一枚（侧栏内容换，按钮不换）。
21. 预览页里的演示用文案（如样张段落）不进生产代码；生产 UI 文案从本计划任务文本取。

## Task 1 — 顶栏 B：路径退出，按钮重排

范围：`src/components/TopBar.tsx`、`src/App.tsx`（如路径/prop 传递需要）、`src/styles/kami.css`、相关测试（`TopBar.test.tsx` / `App.test.tsx`）。

- **路径退出顶栏**：移除顶栏中列的 `.top-bar__path`（及配套 `.top-bar__meta`，若无其他内容）；中列留空。kami.css 中对应规则删除。
- **按钮顺序**（左簇，从左到右）：大纲切换 → 后退 ‹ → 前进 › → 编辑 → 打开文件 → 分隔线 `.top-bar__divider` → 设置齿轮 → 「记录中」小章（`.top-bar__recording`，现挂在路径右侧，挪到齿轮右侧）。现状是 ‹ › 在最前、路径居中列。
- **h1 tooltip**：正文 `h1.document-title` 加 `title={完整路径}`（绝对路径，与设置页「当前文档」同源）。
- 「记录中」小章样式不变（tag-bg 底、brand 字、mono 10px、3px 圆角、padding 2px 6px）。
- 全部 aria-label / title 文案保持不变（约束 20）。

测试：TopBar 渲染顺序断言（按钮 aria-label 序列）、路径不再出现、记录中小章位置；h1 title 属性用例。`npm test` 全绿 + `npm run build`。

## Task 2 — 设置页（替换正文区，复用侧栏）

依赖 Task 1 的顶栏终态。范围：新 `src/components/SettingsView.tsx`、`src/App.tsx`、`src/components/TopBar.tsx`（齿轮按下态）、`src/components/OutlinePanel.tsx` 或侧栏容器（内容可换）、`src/styles/kami.css`、`src/main.tsx`（更新检查抽公共）、`src/lib/`（设置存取）、退役 `src/components/SettingsPopover.tsx`（删除组件与其测试，弹层不再存在）。

**骨架**（对应 Spec §3）：

- 齿轮点击 = 进入设置视图：正文区整块替换为设置视图（顶栏不变）；`Esc` 或视图内左上「‹ 返回阅读」退出；设置视图打开期间齿轮呈按下态（warm-sand 底 + brand 字色，同 `.seg[aria-pressed]` 语汇之外的 pressed 表达——用 `background: var(--warm-sand); color: var(--brand);`）。
- **侧栏复用**：设置视图中侧栏内容从文档大纲换为设置导航——题头「設定」（繁体，`.outline-panel__header` 原样：brand、16px、5px 字距、发丝底线 + brand 小方块）；题头下是搜索框（`.outline-search` 描边式原样复用，占位「寻项…」，输入即过滤下方条目；idle 态右侧 kbd「Ctrl K」与大纲一致）；其下四个导航条目：阅读 / 界面 / 更新 / 关于与数据，样式复用 `.outline-panel__link`（13.5px 衬线、dark-warm、hover 转 brand），激活条目复用 `--active`（brand + 500 + 左缘 2px 靛青轨）。点击条目平滑滚动到对应分节。
- 侧栏默认关（出厂值），顶栏最左同一枚按钮开合，走 `beginWidthTransition()`；侧栏开合状态与阅读视图共享同一份（同一枚侧栏，内容随视图换）。
- **内容栏**：`max-width: 640px` 居中；顶行左「‹ 返回阅读」幽灵按钮（hairline 描边、13px、6px 圆角、hover warm-sand + brand），右 mono 10px stone「ESC · 改动即存」。
- **分节**：每节 mono eyebrow（10px / 500 / 4px 字距 / stone / 大写感）拖一条发丝线（`::after` flex:1 hairline）收尾；节间距 28px；不设大标题块（侧栏题头已报名）。

**四节内容**：

1. **阅读**：三行分段选择器（正文字号 13/14/16/18、栏宽 720/800/960、行高 1.5/1.55/1.7），数据走既有 `useReaderSettings`（key `readerSettings`、CSS 变量机制、viewportPin 钉住重排全部复用，不改机制只改 UI 入口）。其下「样张」试笔区：ivory 浮面 + 1px border + 6px 圆角 + padding 20px 24px，tag 行 mono「样张」，内部一段中文示例文字，字号/栏宽/行高实时消费同一组 CSS 变量（样张内 `max-width` 消费栏宽变量，直观可见）。再下一行「恢复默认」（沿用 `settings-popover__reset` 样式或迁为通用类）。
2. **界面**：一行「启动时展开侧栏」两态分段（开 / 关，出厂 **关**）。新 store key `sidebarOpenOnLaunch: boolean`（与 `outlineWidth` 同一 Store 文件），启动时据此决定侧栏初始开合（现状写死关，改为读设置，默认 false = 现状不变）。
3. **更新**：「启动时自动检查更新」两态分段（开 / 关，出厂 **开**，store key `autoCheckUpdates`，默认 true）；「当前版本」行右侧 mono 10px stone 显示 `v<version>`（取 `package.json` 或 tauri conf 版本，构建期注入或 `getVersion()`）；「手动检查」行右侧实色按钮「立即检查」（`.button.button-primary` 语汇）。`main.tsx` 的启动静默更新检查抽到 `src/lib/updater.ts`（导出 `checkForUpdates(manual?: boolean)`），启动检查尊重 `autoCheckUpdates`；手动点击无论开关都查，结果复用既有 toast 表达（有新版本：「发现新版本，重启后更新」；已最新：manual 时提示「已是最新版本」；失败：manual 时提示「检查失败，稍后再试」，自动模式静默）。
4. **关于与数据**：「当前文档」行右侧 mono 10px stone 完整路径（无文档时显示「未打开文件」）；「最近打开列表」行右侧幽灵按钮「清除（N 条）」（N 取 `recentFiles` 长度，0 条时禁用），点击清空 `recentFiles`（约束：不影响 `lastOpenedPath` 迁移逻辑）；「快捷键」行下双列网格六行：切换大纲 Ctrl B / 聚焦搜索 Ctrl K / 就地编辑 Ctrl E / 提交保存 Ctrl S / 打印 Ctrl P / 后退·前进 Alt ← →（kbd 用 `.outline-search__kbd` 样式）。

**退役**：`SettingsPopover.tsx` 与其测试删除；顶栏齿轮不再开弹层。`useReaderSettings` 的 API 不变，只换调用方。

测试：SettingsView 渲染四节、分段切换回调、Esc/返回退出、清除最近列表、侧栏内容随视图切换；删除 SettingsPopover 测试；受影响的 App/TopBar 用例同步。`npm test` 全绿 + `npm run build`。

## Task 3 — 任务勾选：钤印 + 划线

范围：`src/styles/kami.css`（现状规则在 :1295 / :1439 附近）、勾选渲染相关组件（仅当选择器需要配合时）。

- 阅读视图任务列表 checkbox 自绘：`appearance: none`；15×15px；1px `var(--hairline)` 描边；2px 圆角；透明底；`cursor: pointer`（沿用 T8 可点行为）。
- hover：框线转 `var(--brand)`；focus-visible：1px brand outline + 1px offset（沿用现状焦点表达）。
- checked：框内填 `var(--tag-bg)`（#E4ECF5）实色 + 靛青对勾——对勾用 `background` data-URI SVG（input 是 void 元素，塞不进子节点），描边 2px、圆头；框线转 brand。
- checked 同行的任务文字：`color: var(--stone)` + 1px 删除线（`text-decoration: line-through`）。只作用阅读视图渲染产物（约束 19）；兄弟选择器定位文字（现状 DOM 结构里 checkbox 与文字的关系，沿用既有 :1295 规则的选择器路径）。
- 打印样式段里勾选保持可读（不灰化到看不清），如需 `@media print` 覆盖则补。

测试：`kami.css.test.ts` 增补断言（appearance none、15px、tag-bg 填充、划线规则存在且作用域正确）；如有点击行为用例受样式影响则同步。`npm test` 全绿 + `npm run build`。

## Task 4 — 文档收口

- `CHANGELOG.md`：在 v1.9.0（或 Unreleased）条目内追加本批三条：顶栏纯工具栏化（路径退出）/ 设置页（弹层退役）/ 勾选钤印划线。
- `AGENTS.md`：红线 15 改写为「顶栏不显示文件名与路径；路径归宿 = h1 tooltip + 设置页『当前文档』」；红线速查补「设置视图打开时侧栏内容换『設定』导航，开合仍走 beginWidthTransition()」；关键路径补 SettingsView / updater.ts。
- `docs/agents/rendering.md` / `tooling.md`：弹层相关描述改为设置页；更新检查一节改为 updater.ts + 设置开关。
- `README.md`：Features/Usage 涉及设置面板的描述改为设置页（含四节内容一句话）。
- `docs/preview/topbar-settings-proposal.html` 保留（设计定稿档案），git add 入库。
- 测试计数如有变化同步 AGENTS.md / README.md。

## 串行说明

T1 → T2 → T3 严格串行（共享 TopBar.tsx / App.tsx / kami.css）；T4 最后。每任务：实现 + 测试 + 中文 conventional commit。

## 完成后

整体 review；`npm test` + `npm run build` 终验。不打包、不合并 master（用户另行决定）。
