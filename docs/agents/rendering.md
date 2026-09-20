# 渲染管线、滚动与就地编辑

`AGENTS.md` 的详情分册。收录第二轮优化后的性能结构约束与后续增量：Markdown 渲染结构、搜索跳转、大纲跟随、侧栏布局与宽度、阅读位置记忆与热重载滚动恢复、布局过渡窗、宽度过渡期视口钉住、数学公式管线，以及块级就地编辑的全部不变量。

## 渲染结构

- `MarkdownDocument.tsx` 内拆有 memo 化的 `MarkdownBody`，传给它的 props 必须保持引用稳定。
- `search-match--current` 由 layout effect 操作 DOM 维护，**不要**放回 rehype 插件参数（会让切换匹配项时整篇重解析）。
- `components` prop 必须是 `useMemo` 结果；其引用稳定性由生产接线级回归测试（`MarkdownDocument.test.tsx` 接线用例）保证，热重载不得重建 iframe。
- 文档无原始 HTML 时会自动跳过 `rehype-raw`。
- `CodeBlock.tsx` 与 `MarkdownDocument.tsx` 语言提取正则必须支持连字符（`/language-([\w-]+)/`），确保 `vellum-widget` 与 `objective-c` 等语言标识完整提取，未注册语言平滑降级为普通代码块。
- 窗口初始隐藏（`visible: false`），由前端控制显示。
- `CustomScrollbar` 非常轻量，不需要优化。
- 字体文件在 `public/fonts/`（~17MB），是应用资源。
- 阅读器 + 块级就地编辑（`Ctrl+E` / 顶栏按钮进编辑视图；mdlog 记录中禁止编辑）。

## 搜索跳转

- 搜索跳转滚动对「纯删除」（新词是旧词子串且更短）有 300ms debounce，且延迟触发时首个匹配已在视口内则不滚动。
- 输入变长 / 替换 / 上一个下一个按钮：保持立即滚动。
- `searchQueryPending`（App 传入，urgent 渲染期间 deferred 搜索词未跟进时为 true）：此时 `activeMatchIndex` 被重置为 0 只是输入的副产物。
- 该状态下搜索 effect **不得**据此滚动，否则删除时页面会秒跳到旧词首个匹配、防抖形同虚设。
- 同一位也传给 `OutlinePanel`（`searchQueryPending` prop）：pending 时计数位显示「…」而不是「无匹配」——此刻的 `matchCount` 还是上一轮查询的结果，凭它下结论会闪一帧假话。

## 大纲跟随

- 大纲收录 **h1–h6**（`outline.ts` 的 `extractOutline`）：条目 id 与正文标题 id 同源——`MarkdownDocument` 的 `components.h1–h6` 走同一个 `resolveHeadingId` 分配器，条目点击/片段跳转都靠 `getElementById` 取目标，**新增层级时这两处必须一起改**（层级类型 `HeadingLevel` 在 `types.ts`）。l4–l6 只在侧栏里降档（缩进 / 12px / `--olive`→`--stone`），中文数字编号仍只给 h1。
- 大纲对**所有**正文滚动始终跟随（普通滚动、搜索输入/删除/导航统一行为）。
- 跟随走自定义 `animateScrollTo` 缓动；同容器新动画自动顶掉旧的、从当前位置接续，高频 `activeHeadingId` 变化不会抖动。
- 不要再加「搜索期间不跟随」之类的门禁。
- **例外**：点击大纲章节跳转期间，`handleSelectHeading` 会把目标标题 id 写入 `outlineNavTargetRef` 锁定 `activeHeadingId`（`useOutlineSync` 第三参数）。
- 不锁的话，正文缓动途经的中间标题会让大纲先滚去中间位置再折返（先上后下跳动）。
- 动画自然结束或被用户滚动/按键打断时经 `animateScrollTo` 的 `onComplete` 解除锁定，恢复正常跟随。
- `useOutlineSync` 有顶部兜底：所有标题都在阈值线（容器顶 +80px）下方时激活文档顺序第一个标题，保证页面在文档开头时高亮不消失。

## 侧栏布局与宽度

- 目錄 header + 搜索框固定在滚动区外，只有大纲列表在 `.outline-panel__scroll` 内滚动，跟随滚动以它为参照容器。
- **不要**把搜索框改回 sticky 或放回滚动容器内——会重新引入「搜索框遮挡激活项」和「连点导航按钮时搜索框上浮误点」。
- 侧边栏宽度可调：`useOutlineWidth`（200–320px，默认 240，双击手柄复位）覆写根 `--outline-width` 变量，`--outline-shift` 由 calc 派生自动跟随。
- 启动时侧边栏**恒为关闭**：`App.tsx` 必须传 `useOutlineOpen(false)`，该 hook 启动时不读取持久化状态（用户交互后的状态仍照写，只是不回读）。改回 `true` 会让侧栏每次启动都自行展开——这是产品决定，不是待修项。
- 手柄 `.outline-resize-handle` 必须作 aside 的**兄弟节点**外置（aside 有 `overflow:hidden`）。
- `JumpToBottom`：距底 >300px 浮现的右下角跳底按钮，z 序须低于窄屏遮罩（750）；点击走 `animateScrollTo` 缓动，用户输入可被全局监听打断。

## 阅读位置记忆与恢复

- 阅读位置记忆是「标题锚点 + 顶层块索引锚点 + 比例兜底」三级（`scrollMemory.ts` 记录 / `scrollRestore.ts` 恢复）。
- 恢复优先按 anchorId 定位；标题被删则按 anchorIndex 找最近幸存标题；都没有才退回比例。
- 无标题文档（mdlog 日志常态）落到 blockIndex——`.markdown-body` 顶层块序号对末尾追加天然稳定，是「记录期间末尾注入新内容后恢复失败」的修复点。
- 恢复后图片/字体会撑大 scrollHeight 使落点漂移，`restoreScrollPosition` 的落位守护（ResizeObserver，用户输入/5s 超时结束）会在布局稳定前持续重锚。
- **不要**改回一次性 `ratio × scrollHeight`——那就是间歇性恢复失败的根因。
- 阅读位置保存在 mdlog 记录期间**不再禁用**：连接建立瞬间基线保存一次 + 滚动防抖持续保存 + 断开补写 + beforeunload 兜底——pi 或 Vellum 被强杀（无 beforeunload）也能恢复到 300ms 内的位置。

## 热重载滚动恢复与用户输入

- 热重载滚动恢复是「视口锚点元素优先、像素兜底」（`viewportAnchor.ts` 捕获 / App 恢复）。
- 不要改回纯像素恢复——视口上方内容同步变高（流式代码块收合成 widget 等）时旧像素对应另一处内容会跳。
- 且程序化像素覆盖会顶掉 Chromium 原生滚动锚定对异步 iframe 高度上报的补偿。
- 热重载滚动恢复在用户滚动输入（滚轮/触摸/按键/滚动条拖拽）后 300ms 内跳过（`lastUserScrollAtRef`）：否则提交瞬间会把用户刚滚出去的距离当「漂移」拽回。
- 键盘只在**会滚动的键**上记时间戳：判据是 `lib/scrollInput.ts` 的 `isScrollInputKey(event)`（清单与修饰键例外都归该模块，带单元测试）——**Alt 例外不写在调用方**。
- `Alt+←` / `Alt+→` 是历史导航（另一条快捷键），箭头键本身在清单里，靠 `!altKey` 排除；判据散在 `App.tsx` 里各写一份，漏一处就等于「按后退键被当成用户接管」、宽度过渡期的钉住当场取消。
- 任何按键都记会把 `Ctrl+K` 等快捷键误判成用户接管，而 `Ctrl+K` 开侧栏时视口钉住会被当场取消、宽度回流没人补偿（快捷键路径重新跳动）。
- 文档内锚点链接（`[文字](#id)`）由 App 接管点击（`scrollToContentFragment` + `.document-scroll` 上的事件委托）：目标在正文里走缓动滚动（与大纲点击同一路径），`#`/`#top`/`#main` 视为回到顶部。
- **编辑视图下不接管**（那里点击是「进入块编辑」）。
- 新增锚点入口时必须同时更新 `handleSelectHeading` / `scrollToContentFragment` / `animateContainerTo` 这三者共用的缓动路径。

## 布局过渡窗（侧栏开关 / 拖宽）

- 侧边栏开关（450ms）与拖宽期间（持续续窗）由 `layoutShiftUntilRef` + `app-shell--layout-shifting`/`app-shell--sidebar-resizing` 类承载。
- 窗内热重载延迟合并提交（`reloadDeferTimerRef`，多次追加只留最后一次）、热重载滚动恢复整体让位原生 scroll anchoring、widget iframe 高度过渡关闭。
- 这是「mdlog 连接中开关侧边栏页面卡死」的修复机制：过渡期所有 iframe 随宽集体重排，恰逢整篇重解析的热重载会饱和主线程。

## 宽度过渡期必须自己钉住视口（`viewportPin.ts`）

- 侧栏开关/拖宽只改正文**宽度**，正文按新宽度重新断行 ⇒ 整篇文档高度变化（用户文档实测 ±3965px）。
- 而 **Chromium 原生滚动锚定对「行内尺寸变化驱动的重排」一律不补偿**。
- 真机对照实验：同一个纯 1000px 滚动容器改字号（`Δh=+10239` ⇒ `ΔscrollTop=+4777`，正常补偿）、改宽度则 `ΔscrollTop` 恒为 0。
- 于是 scrollTop 原地不动、视口内容整段平移（关侧栏向上跳 ~3600px，开回来再跳回原位，观感即「页面闪到别处、开回来又恢复」）。
- 解法：事件入口（**状态更新之前**，此刻仍是旧布局）先 `captureViewportAnchor` 记下视口顶部首个可见块 + 偏移。
- 再在窗内逐帧按该锚点补偿；首帧补偿放在 `useLayoutEffect` 里、绘制前同步完成，用户滚动输入立即交还控制权。
- **侧栏开关的全部入口**（顶栏按钮 / `Ctrl+B` / `Ctrl+K` / 窄屏 Escape 与遮罩 / 窄屏选章）与拖宽手柄都必须走 `beginWidthTransition()`。
- 漏一个入口，该路径就会闪；别指望原生锚定接手。

## 数学公式

- 数学公式：remark-math + rehype-katex。
- katex 必须位于 rehype 管线末尾（sanitize 和搜索高亮之后）——提前会让 KaTeX 输出被 sanitize 剥光，或被高亮逻辑拆坏公式 DOM。
- remark 侧的 `remarkMathCurrencyGuard` 是 Pandoc 式货币保护（「$5 和 $10」不误判为公式），别删。
- KaTeX 字体由 `vite.config.ts` 的 `katexWoff2Only` 插件裁成 woff2-only（WebView2 不需要 woff/ttf）。
- **katex 版本必须与 rehype-katex 嵌套依赖的 katex 严格同版**（当前均 0.16.47）。
- 因果：CSS 从根 `katex` 包导入，渲染器是 rehype-katex 嵌套的 katex；katex 0.17+ 把 `sizing` 等类名改名，两边不同版会导致上下标 sizing 规则全部失配、公式重合。
- 升级 rehype-katex 前必须先核对其 katex 依赖版本。

## 块级就地编辑（2026-09-10 新增）不变量

- 编辑面沿用既有 `.document-scroll` 容器（textarea 自增高推流），**不得**新建内层滚动系统——滚动记忆 / 跳底 / 自定义滚动条 / 布局过渡窗全部复用。
- 提交（`useDocumentEditor.commitActive` → `onMarkdownChange` + `save_document`）**不递增 `reloadTick`、不播「墨迹未干」印章、不做滚动补偿**：印章语义是「外部改写了文件」。
- 提交后 watcher 的回声由「磁盘 vs 内存 markdown（LF 归一）比对」抑制（`App.tsx` `reloadIfExternal`），相等即整体忽略。
- 块标记包裹层 `.vellum-unit-wrap` 必须 `display: contents`（不生成布局盒）。
- 因此 `BlockEditor` 的隐藏/锁高/自增高/测量**必须**作用在 `resolveTarget()` 选出的「首个有布局盒的元素」上，作用于包裹层本身会全部失效。
- 覆盖层选择器必须是 `.document-scroll__content--editing > .block-editor__input`（特异度高于 `kami.css` 的 `.markdown-body textarea`）。
- 且覆盖层**不是** `.markdown-body` 后代：CSS 侧由 `kami.css.test.ts` 锁死规则文本，DOM 侧由 `App.test.tsx` 断言直接父元素带 `--editing`（终审修复波 F41 补齐，两侧齐备才防接线漂移）。
- `Ctrl+S` 双通道去重：编辑框 `onKeyDown` 只阻止默认行为、不停止冒泡，全局处理器必须 `if (event.defaultPrevented) return;`。
- 且 `useDocumentEditor` 要有在途提交闸门（`committingRef`）——只做其中一处，结构变化草稿会被 splice 两遍并二次落盘。
- 切换文档（`loadPath` 判定非同路径）必须调用 `editorRef.current?.resetSession()`：落盘失败时 F24 会把编辑会话留在原地，不清就会把上一份文档的草稿拼进新文档。
- 结构性只读必须覆盖**全部**块级容器（`list` / `listItem` / `blockquote` / `footnoteDefinition`）。
- 脚注定义要当可下钻容器（与引用同列），否则其中的块级 HTML / `vellum-widget` 源码会落到一个 `editable: true` 的块上。
- 回归断言用「容器 × 锁定块」遍历式清单（`editUnits.test.ts`），不得只补容器例子。
- mdlog 记录中编辑门禁三重：顶栏/入口禁用（`toggleView`/`activateUnit`）＋ 提交口 `commitActive` 拦截 ＋ Rust `save_document` 存活闸门；**不得**只保留入口一处。

### 编辑视图视觉形态（2026-09-12 A2「页边字符」定稿）

- 正文与阅读视图一致，编辑信号全在块左页边。
- hover 淡 `¶`；只读块常驻灰 `×`（不再有粗灰虚线框）；激活块由覆盖层伴生的 `.block-editor__mark`（brand `¶`）标示。
- 覆盖层 textarea 透明底零框线（padding 左归零，草稿首字与渲染态逐像素对齐）。
- 页边字符一律「绝对定位 + auto 偏移（静态位置）+ `margin-left: -26px`」。
- **绝不给块自身加 `position:relative`**：代码块 / widget 根容器带 `overflow:hidden`，伪元素以它们为包含块时 `-26px` 处的字符会被整条裁掉（`kami.css.test.ts` 有反裁剪红线断言）。

## 任务列表勾选写回（2026-09-20 新增）

- 阅读视图里点 GFM 任务复选框 = 直接改源码：`<li>` 的源码起点 → `useDocumentEditor.toggleTask` → `taskList.ts` 在**所属块单元区间内**按序号翻转标记（`*` / `+` / 有序列表、多空格 / Tab 分隔、`[X]` 都认；勾选字符沿用文档里已有的大小写风格）。
- 定位信息只能来自 `<li>`：GFM 复选框由 `mdast-util-to-hast` 生成，**不带源码位置**（`<input>` 恒 disabled）；原始 HTML 里的 `<input>` 带位置。`MarkdownDocument` 的 `li` / `input` 两条覆盖渲染据此分工——只摘 GFM 复选框的 disabled，原始 HTML 的 disabled 一律留着。
- 覆盖渲染只在**阅读视图 + 有 `onToggleTask`** 时挂上：编辑视图与未接线调用方的 `components` 与从前逐字相同（复选框保持 disabled，块激活那条路不受影响）。
- 门禁与回滚与块编辑同款：mdlog 记录中拦在写盘口（`mdlogActive` 来自 `read_mdlog_state` 的 `?? null` 归一）、只读块（HTML / widget / frontmatter 及其容器）静默忽略、编辑视图整体不接管（组件侧不挂覆盖渲染 + hook 里 `viewMode !== "reading"` 兜底）、落盘失败回滚乐观更新并弹 `写入失败`。
- **回滚必须过两道守卫**（缺一个就会写坏内存）：① 文档代际未变（App 每次「由外部装入内容」——换文档 / 热重载——递增 `documentGenerationRef`，只由装入路径递增，编辑自己的写入不算），跨代际回滚会把上一篇的 markdown 写进新文档；② 内存里仍是我写的那份（`markdownRef.current === next`），被别的写路径顶掉时那份更新的状态才是磁盘的未来。任一条不成立就只报失败、不动内存。
- 代际**必须经 getter 同步读**（`getDocumentGeneration: () => documentGenerationRef.current`，hook 里存成 ref 后当场调用）：装入路径递增的是 App 的 ref，那一刻**渲染尚未提交**，按 prop 快照镜像会漏掉「ref 递增 → 渲染提交」这段调度窗——窗内失败的勾选会以为还是同一篇文档，把旧内容写回新文档（`useDocumentEditor.test.ts` 有一条不做 rerender、只改 getter 背后值的用例钉住这个窗口）。
- 勾选**在途串行**（`taskChainRef`）：两次并发会让后一次以「前一次的乐观结果」为基准，前一次失败回滚就把后一次一起抹掉。链上的后续调用读 `markdownRef` / `unitsRef` / 代际 getter 的**此刻值**，不得用自己那次点击的闭包快照。
- 勾选态由源码字符串单向驱动（`checked` 受控 + `readOnly` + `flushSync(onMarkdownChange)`）：**不得**改成 `defaultChecked`——那样落盘失败回滚后复选框不会回到源码状态。
- 勾选**不**递增 `reloadTick`、不播印章、不做滚动补偿（同块编辑提交）；watcher 回声照旧由「磁盘 vs 内存比对」抑制。

## 打印样式（2026-09-20 新增）

- 两段 `@media print` 都在 `kami.css`，都**不动屏幕态规则**：**主段**（隐藏界面件 / 放开版心 / 分页保护）排在首个 mdlog widget 选择器**之前**，**末段**（隐 chrome 题头栏、恢复停帧 iframe）含该字样、排在其**之后**。主段的注释里也**不得**出现该字样——`kami.css.test.ts` 用 `indexOf` 找扫描起点，注释同样会把它提前（本轮就是这么踩到的）。
- 隐藏清单：`.top-bar` / `.outline-sidebar` / `.outline-resize-handle` / `.outline-scrim` / `.custom-scrollbar` / `.jump-bottom` / `.reload-note` / `.editor-toast` / `.editor-hint` / `.settings-popover` / `.mdlog-live`（记录中的呼吸小章是状态指示器，不是文档内容；该选择器不含 `.mdlog-widget` 字样，故留在主段）。
- 版心必须放开：屏幕态把正文关在「`100vh` + `overflow:hidden`/`scroll`」的壳里（窗口内滚动），不改成 `height:auto` + `overflow:visible` 就只印得出第一屏。侧栏开启时的 `--outline-shift` 位移与 `.document-scroll__content:has(.document-title)` 的 42px 顶距都是 0,2,0，打印段必须用同特异度显式归零——同特异度靠顺序取胜，所以打印段整体必须排在屏幕态规则之后（测试锁死）。
- 列宽：`.markdown-body` 与 `.document-title` 的 `max-width` 打印下放开到 100%（左右 32px 内边距保留，标题与正文左缘的对齐关系不变）。**正文字号不另设**：沿用 `--reader-font-size`，用户的阅读设置就是他的选择。
- 分页：`.code-block` / `.markdown-body pre` / `table` / `blockquote` / `img` 加 `break-inside: avoid`；`.document-title` 与 h1–h6 加 `break-after: avoid`；**不设 `@page`**，页边距交给浏览器默认。
- 交互块：`--parked` 停帧（`visibility:hidden`）按**屏幕视口**判定，打印时落在后几页的 widget 会整块空白，故打印段里恢复 `visibility:visible`——这不是「停帧禁止用 `display:none`」那条红线的例外，只是打印媒体下的另一份取值。
- `Ctrl+P` 走 `window.print()`（`App.tsx` 全局快捷键，`typeof window.print === "function"` 守卫；拿不到实现时既不动作也不 `preventDefault`，不无谓吞键；分支末尾 `return`，且带 Shift 的组合键（`Ctrl+Shift+P`）不归它）。WebView2 具备这条路径（Chromium 打印管线），但**真机未验证**：打印对话框是否真的弹出、打印件里 widget iframe 是否渲染都只有引擎级证据（headless Chrome `printToPDF`）+ 微软 WebView2 打印文档。**在真机确认之前，README 不写这条快捷键**；确认方式见 `docs/agents/tooling.md` 的真机探针一节（起 release exe + CDP）。

## 文件索引

| 文件 | 职责 |
|------|------|
| `src/App.tsx` | 主入口、文档加载、窗口显示、编辑视图接线（提交落盘 / 回声抑制 / 外部变更分流 / 文档代际） |
| `src/components/MarkdownDocument.tsx` | Markdown 渲染（`React.lazy` 懒加载） |
| `src/components/BlockEditor.tsx` | 就地编辑面（隐藏原块锁高、自增高推流、Esc/失焦提交） |
| `src/hooks/useDocumentEditor.ts` | 编辑会话状态机（视图门禁、草稿、提交即落盘、提示条） |
| `src/lib/editUnits.ts` | Markdown → 块单元（纯函数：区间、可编辑性、HTML/widget/frontmatter 结构性只读） |
| `src/lib/taskList.ts` | GFM 任务标记的定位与翻转（绝对偏移，纯函数；勾选写回用） |
| `src/lib/rehypeEditUnits.ts` | 编辑视图的块标记 rehype 插件（sanitize 之后、katex 之前） |
| `src/lib/scrollStick.ts` | 贴底判定 |
| `src/lib/viewportAnchor.ts` | 热重载视口锚点（捕获/补偿原语） |
| `src/lib/viewportPin.ts` | 宽度过渡期视口钉住（侧栏开关/拖宽不跳） |
| `src/lib/scrollInput.ts` | 「用户滚动输入」的按键分类（快捷键不得误判；Alt 例外也归这里：`isScrollInputKey`） |
| `src/lib/navHistory.ts` | wikilink 前进/后退历史两栈（栈条目 = 路径 + 三级位置记录） |
| `src/components/JumpToBottom.tsx` | 跳转到底部浮钮 |
| `src/components/CodeBlock.tsx` | 代码高亮（PrismLight，20 种语言） |
| `src/hooks/useOutlineWidth.ts` | 侧边栏宽度（200–320px，持久化） |
| `src/main.tsx` | 入口、字体加载 |
| `vite.config.ts` | 构建配置 |
| `src-tauri/tauri.conf.json` | Tauri 窗口配置 |
