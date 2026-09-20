# 更新日志

本项目所有重要变更均记录于此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [1.9.0] - 2026-09-20

### 新增

- **阅读设置面板（顶栏弹层）**：顶栏左侧按钮簇末尾加一枚齿轮幽灵按钮（28×28，`aria-label="阅读设置"`），弹层里三行分段选择器——正文字号 13 / 14 / 16 / 18、栏宽 720 / 800 / 960、行高 1.5 / 1.55 / 1.7，底部「恢复默认」+ mono 小字「自动保存」。设置写进与 `outlineWidth` 同一个 settings Store（key `readerSettings`，逐字段校验、非法值回退默认），生效方式是在 `documentElement` 上覆写 `--reader-font-size` / `--reader-column-width` / `--reader-line-height`，`kami.css` 的正文、表格与文档标题消费这三个变量并带默认值回退——变量挂在根元素、与文档无关，热重载与换文档后继续生效。标题字号阶梯（30 / 21 / 17）与行内 code 的 12px 不随设置缩放（设计定稿）。栏宽 / 字号改动会引起整篇重排，故与侧栏拖宽同路径：改值前先走 `beginWidthTransition()` 钉住视口。点外部或 `Escape` 关闭，`Escape` 分支 `stopPropagation`（栈式语义：窄屏下不连带关侧栏）。
- **最近打开 + 拖放打开 + 空状态重做**：新增 `src/lib/recentFiles.ts`（Store key `recentFiles`，最多 8 条、按 `isSamePath` 去重置顶，读旧 key `lastOpenedPath` 迁移），每次成功打开文档即置顶，启动恢复改读列表首条。空态重做：保留既有文案与「打开文件…」按钮，下方加「最近打开」列表（文件名 500 字重 + 右侧 mono 10px stone 目录路径，hover ivory 底、文件名转靛青；列表为空则不渲染），再下方一行小字「或将 .md 文件拖入窗口」。拖放走 `getCurrentWebviewWindow().onDragDropEvent`：`enter` / `over` 时正文区亮一道 1px 靛青内描边，`drop` 取**第一个** Markdown 路径走既有打开管线，`leave` 熄灭；非 Markdown 整体忽略。打不开的条目从列表里摘掉，错误页复用同一份最近列表（`RecentFilesList`）。
- **窗口标题随文档**：`capabilities` 补 `core:window:allow-set-title`，打开文档后走 OS 级 `setTitle("文件名 — 素笺")`（文件名与正文 `h1.document-title` 同源），无文档与加载失败复位为「素笺」，切换文档的 loading 过渡帧**不改写**标题（否则任务栏会闪一帧「素笺」）。顶栏依旧不显示文件名（设计红线）——这条是窗口标题，不是顶栏文本。
- **wikilink 前进/后退历史**：新增 `src/lib/navHistory.ts`，栈条目 = 离开那篇的路径 + 三级阅读位置记录（两个栈的栈顶方向刻意相反：back 栈顶在末尾、forward 栈顶在开头，故「后退再前进」的次序与浏览器一致）。入栈判据只有一条：**点 wikilink 换文档**（压入 back、清空 forward）；对话框 / 拖放 / 最近列表 / 启动恢复都是「新导航」，不清 back、只作废 forward；后退/前进自身两侧都不动。快捷键 `Alt+←` / `Alt+→`（必须 `preventDefault`：WebView2 把它们当自己的历史导航加速键，不吞就会连页面一起导航走）与顶栏左侧 ‹ › 两个幽灵按钮（无路可走时禁用、不可点）。落位复用 `scrollRestore.ts` 的既有管线，条目自带的位置记录优先于持久化存储里那一份（不受一次失败的写入影响）。换文档在途期间前进/后退整体忽略（不动栈、不发加载）。
- **大纲收录 h4–h6**：`outline.ts` 的提取范围从 h1–h3 扩到 h1–h6（条目 id 与正文标题 id 同源，新增层级时两侧必须一起改），侧栏里 l4–l6 每级 +14px 缩进、字号降到 12px、色阶 olive → stone（不引新颜色）；中文数字编号仍只给 h1（「章」的记号，深层级不参与）。真实语料（wisdom 库 191 篇）里 0 个 h5/h6。
- **任务列表勾选写回**：阅读视图里点 GFM 复选框即改源码——`<li>` 的源码起点 → `useDocumentEditor.toggleTask` → `taskList.ts` 在**所属块单元区间内**按序号翻转标记（`*` / `+` / 有序列表、多空格 / Tab 分隔、`[X]` 都认，勾选字符沿用文档里已有的大小写风格），走既有原子写盘管线。乐观更新（`flushSync` 让复选框当场翻转）+ 失败回滚 + `写入失败` 提示。回滚必须过两道守卫：文档代际未变、内存里仍是我写的那份（任一条不成立只报失败、不动内存）。勾选在途串行（`taskChainRef`），链上的后续调用读此刻的源码 / 单元 / 代际，而不是各自那次点击的闭包快照。门禁与块编辑同款：mdlog 记录中拦在写盘口、只读块（HTML / widget / frontmatter 及其容器）静默忽略、编辑视图整体不接管。定位信息只能来自 `<li>`（GFM 复选框不带源码位置），原始 HTML 里的 `<input>` 一律保持 disabled。
- **打印样式（两段 `@media print`）**：打印只做三件事——隐藏界面件（顶栏 / 侧栏 / 拖宽手柄 / 纱罩 / 自定义滚动条 / 跳底按钮 / 印章 / 编辑提示条 / 设置弹层 / 记录中的呼吸小章）、放开版心（屏幕态把正文关在「`100vh` + `overflow:hidden`」的壳里，不放开就只印得出第一屏；列宽放开到 100%、侧栏位移与 42px 顶距显式归零）、分页保护（代码块 / 表格 / 引用 / 图片不跨页，标题不留在页脚）。屏幕态规则一字不动。位置约束由 `kami.css.test.ts` 锁死：主段不含 `.mdlog-widget` 字样且排在首个该选择器之前，含该字样的一半（隐 chrome 题头栏、恢复 `--parked` 停帧 iframe）在文件末尾。正文字号沿用 `--reader-font-size`（用户的阅读设置就是他的选择），不设 `@page`。`Ctrl+P` 绑定 `window.print()`（`typeof window.print === "function"` 守卫：拿不到实现时既不动作也不吞键；`Ctrl+Shift+P` 不归它）。**真机未验证**：WebView2 的打印对话框是否真的弹出仍属未测项（现有证据只有微软 WebView2 打印文档 + headless Chrome 的 `printToPDF` 引擎级验证），故 README 暂不写这条快捷键。
- **自动更新（tauri-plugin-updater）**：Rust 侧注册插件、npm 侧 `@tauri-apps/plugin-updater`，启动时**只在生产构建**里静默 `check()`（dev 实例不该被 release 包自动替换），有更新先出提示再下载安装（Windows 上安装会拉起安装器并退出进程，这条提示是「应用即将关闭」的唯一预警），无更新 / 检查失败 / 安装失败一律静默、只落 console。`capabilities` 补 `updater:default`（`check` / `download` / `install` / `download-and-install` 四命令同属这一套），CSP 的 `connect-src` 加 endpoint 域名（实际请求在 Rust 侧由 reqwest 发出，这条是防御性声明）。`pubkey` 当前是占位串 ⇒ **装不上任何包**（install 步 inert），但 **download 步不 inert**：`check()` 只看 endpoint 上的 `version`、不验签，只要 `latest.json` 在，每个实例都会先把 ~21MB 安装包整个下完、再卡在 `download()` 的签名校验上失败（失败静默，代价是白下载一次、每次启动都来一遍）；`bundle.createUpdaterArtifacts: true` 已开，发布前必须先 `tauri signer generate` 并填公钥——开了它之后打包**必须先有私钥**，否则会先产出安装包、再以退出码 1 报「没有私钥」（实测，别被前半段的产物误导）。换真公钥与产出 `latest.json` 的先后顺序见 `docs/agents/tooling.md` 的「时序红线」。

### 更改

- **UI 修复批量（2026-09-20）**：`Ctrl+B` 在**所有宽度**下切换侧栏开关（侧栏已开且搜索框聚焦时也能关，`Ctrl+K` 只保焦不动作），开关照旧先走 `beginWidthTransition()`；顶栏大纲与打开文件按钮补 `title`（「切换大纲（Ctrl+B）」/「打开文件」）；`ErrorState` 加「重新打开」实色按钮（触发打开文件对话框），空态与错误页共用 `.button.button-primary`（warm-sand 底 + 发丝内描边 + 6px 圆角，高度写死 32px 让两个页面逐像素同高）与 `.empty-eyebrow`；搜索框有查询时右侧出清除 × 按钮（点击清空并保焦），查询非空且 0 匹配时计数位显示「无匹配」、计数容器带 `aria-live="polite"`；窄屏不渲染拖宽手柄（正文不位移，拖了无意义）；`.outline-scrim` 的 z-index 抬到 950（高于自定义滚动条与印章，浮层时侧栏外不可交互）；`.document-scroll` 补克制的 `:focus-visible` 内描边；mdlog 记录中时顶栏路径右侧加一枚「记录中」小章（mono 10px、brand 字色），让记录状态不只出现在文档尾部。

### 修复

- **勾选回滚的代际判据改为同步读**（`getDocumentGeneration` getter）：装入路径（`loadPath` / `reloadCurrent`）递增的是 App 的 ref，此刻**渲染尚未提交**，按 prop 快照镜像代际会漏掉「ref 递增 → 渲染提交」这段调度窗——窗内落盘失败的勾选会以为还是同一篇文档，把上一篇的 markdown 写进新文档的内存。新增一条不做 rerender、只改 getter 背后值的用例把窗口钉住。
- **两个提示条的 key 撞车**：`.reload-note`（`key={reloadTick}`）与 `.editor-toast`（`key={editor.toast.id}`）都从 1 起计数，同屏时撞 key（React 会复用错节点、动画不重播）。两处 key 加字符串前缀。
- **搜索 pending 帧闪「无匹配」**：`useDeferredValue` 的 pending 态（输入已变、deferred 词未跟进）下 `matchCount` 还是上一轮查询的结果，凭它下「无匹配」的结论会闪一帧假话（大文档上这一帧能停留可见的时长）。App 把 `searchQueryPending` 传给 `OutlinePanel`，pending 时计数位显示「…」。
- **阅读设置落盘挪出 setState updater**：updater 在 StrictMode 下会被调用两次（副作用幂等只是运气好），且可能早于本次状态真正提交就发起 IPC。改成挂在 `settings` 的 effect 上（只在提交之后跑，落盘值就是屏幕上的值），并用「用户改过」的闸门避免启动读盘那次 setState 触发原样回写。
- **`Ctrl+P` 分支补 `return` 与 `!shiftKey`**：缺 `return` 时该分支会继续往下走后面的判断（当前无害，但下一条快捷键加在它之后就会踩到）；`Ctrl+Shift+P` 是另一个组合键，不该打印、也不该吞键。
- **打印隐藏清单补 `.mdlog-live`**：记录中的呼吸小章是状态指示器而非文档内容，打印件里不该出现（该选择器不含 `.mdlog-widget` 字样，故仍留在主打印段）。
- **`.outline-search__clear` 惰性类补样式**：类名在 `OutlinePanel.tsx` 里用了却没有规则，清除按钮与上/下导航同宽同高（22×22，在 200px 最窄侧栏里挤掉输入框约 25px）。现在 16×16 命中区、12px 图标，hover 转 brand（与 `.outline-search__nav` 同一套幽灵按钮语汇）。
- **`.button.button-primary` 补 `height: 32px` 与 `:active`**：内边距单独撑高会随字体度量漂，两个页面的实色按钮高度对不齐；按下态只压深底色、不位移（正文 `button:active` 的 1px 下沉是正文控件的语汇）。
- **`SettingsPopover` 的 `Escape` 加 `stopPropagation`**：窄屏下 `Escape` 同时是「关侧栏」的入口，不拦会一次按键关两层。
- **打印隐藏 `.mdlog-live` 的规则曾因级联顺序失效**：它原先写在主打印段（文件前段），而 `.mdlog-live` 的屏幕态规则（`display: flex`）在 mdlog 区段、也就是主打印段**之后**——媒体查询不参与特异度与来源序，同特异度（0,1,0）下靠后的屏幕态规则照样胜出，打印件里那枚「记录中 · PI」小章根本没被隐藏。现移入文件末尾那段打印规则（与交互块那条同段，收纳的都是「屏幕态规则排在主段之后」的选择器），`kami.css.test.ts` 同步补两条断言（主段清单**不含** `.mdlog-live`、末段覆写排在屏幕态规则之后）。headless Chrome 打印媒体实测：修前 `print` 下仍是 `flex`，修后 `none`（同一引擎里另做了「覆写放屏幕态之前 ⇒ 输掉」的对照）。
- **测试补齐**：`ErrorState` 的「重新打开」接线用例（连点两次各触发一次、未接线时不渲染按钮）、`Ctrl+P` 的 `printSpy.mockRestore()`（本套件没有全局 `restoreMocks`，不还原会跟着后面的用例跑）与 `Ctrl+Shift+P` 不打印用例、`useReaderSettings` 的「启动恢复只读不写」用例、`OutlinePanel` 的 pending 用例、`SettingsPopover` 的 Escape 不冒泡用例、`kami.css.test.ts` 的实色按钮 / 清除按钮 / 打印隐藏清单与级联顺序断言、`scrollInput` 的 Alt 例外用例。测试数 903 → **913**（45 个测试文件）。

### 工具

- **文档收口**：README 的 Features 补设置面板、最近打开与拖放、前进/后退、大纲到 h6、勾选写回、自动更新，Usage 补 `Ctrl+B` / `Alt+←` / `Alt+→` / 拖放与测试计数（45 个测试文件 / 913 用例）；`AGENTS.md` 红线 8 的侧栏入口枚举补 `Ctrl+B`、红线 11 补 `core:window:allow-set-title` 与 `updater:default`，关键路径登记 `recentFiles` / `navHistory` / `taskList` / `useReaderSettings`；`docs/agents/rendering.md` 补侧栏入口、文件索引补 `navHistory.ts`；Alt 例外契约归位到 `src/lib/scrollInput.ts`（`isScrollInputKey`，带单测）；`docs/agents/tooling.md` 的入口 chunk 尺寸历史更新到终验实测值。

## [1.8.1] - 2026-09-19

### 修复

- **启动时侧边栏默认展开**：`useOutlineOpen` 自身的语义是「启动恒为关闭，且不读取持久化状态」（`src/hooks/useOutlineOpen.ts` 的注释与单测都按此写），但 `App.tsx` 传的是 `useOutlineOpen(true)`，把这个默认整个覆盖掉了 ⇒ 每次启动应用侧栏都自行展开。现改为 `useOutlineOpen(false)`。持久化行为不变：用户交互后的开关状态仍写入共享 settings Store，仅启动时不回读；五条开启入口（顶栏按钮 / `Ctrl+K` / 窄屏选章 / 遮罩 / 窄屏 `Escape`）照旧全部走 `beginWidthTransition()`，宽度回流期的视口钉住不受影响。
- **随附的测试与文档同步**：`App.test.tsx` 中 7 条以「默认打开」为前提的用例改为以默认关闭为前提——侧栏开关用例两个方向都走一遍；宽度回流钉住用例补上「打开」方向，同时保留原先只覆盖的「关闭」方向（真机观测到跳位的正是这个方向）。`docs/agents/rendering.md` 的「侧栏布局与宽度」新增一条约束，避免日后被改回 `true`；测试里那个「真机里 App 恒以开启启动」的初始态覆盖点（`outlineInitialOverride`）随之删除。

## [1.8.0] - 2026-09-18

### 更改

- **文档标题搬进正文（Obsidian 的 inline title）+ 属性卡 / 提示块形态重做**（2026-09-18 Owner 定稿，四项样式来自 `docs/preview/note-block-styles.html` 的候选页）：
  - **文档标题**：正文首行新增 `h1.document-title`，文本取自**文件名**（`src/lib/path.ts` 的 `fileNameToTitle`，只剥 `.md`、大小写不敏感）。它刻意放在 `.markdown-body` **之外**——标题不属于文档内容，因此不进 markdown 解析、搜索高亮、块单元与大纲；宽度与 `.markdown-body` 同参（`min(800px, 100%)`）以保证标题左缘与正文首块逐像素对齐。**顶栏不再显示文件名**（`.top-bar__title` 与 `TopBar` 的 `fileName` prop 一并移除，中栏只报所在目录）——同一份信息不重复出现第二次。**标题贴顶**：有标题时 `:has()` 把正文区顶部留白从 70px 收到 42px、正文自身不再叠 40px 顶距，标题因此紧贴顶栏下方（那 70px 留白是给空状态 / 错误页 / 加载中这些**没有标题**的页面准备的）。日志类文件名（`2026-07-19.md`）会让标题与正文 H1 挨着重复——Obsidian 亦然，Owner 确认照原样，不做「纯日期名不显示」的特殊分支（`path.test.ts` 有对应断言）
  - **属性卡**：去掉 ivory 底色与 1px 外框，改成**上下各一条发丝线的键值两级表**（`.md-props__row` 改 `display: grid` + `78px minmax(0, 1fr)` + 行线），tags 从蓝底 chip 退成中点分隔的普通文字。**只改 CSS**——DOM 结构、块单元契约（`reason: "frontmatter"` 只读单元）与既有断言一字不动
  - **提示块（callout）**：从「靛青左边 + brand-tint 底、警示族暖砂底」改为**素**——无底色、圆角归零，只留一道发丝竖线（与引用块同一套语汇，连续几个也不撕版面），类型靠标题字色区分：tip 靛青、警示族淡墨（竖线同时沉一档到 `--stone`）。同样**只改 CSS**
  - 形态由 `src/styles/kami.css.test.ts` 新增的三条设计约束用例锁死（标题与正文同宽、属性卡无外框无底色 + 两列行线、callout 无底色 + 发丝竖线 + 标题靛青），改样式前先读那里的断言

### 新增

- **Obsidian callout（`> [!tip] 标题`）渲染成提示块**：老行为是把 `[!tip] 标题` 当普通引用的正文照字面渲染。现在由 `rehypeObsidian.ts` 的第三段换树**就地改造那个 blockquote**（不加新容器、也不给 `components` 加覆盖渲染——块嵌套深度与 `components` 的 memo 都是既有不变量）：引用挂上 `callout callout--<类型>` 与 `data-callout`，正文段落**之前**插一枚 `callout__title`（有自定义标题就用它，没有则用 Obsidian 的英文默认标签），标记行连同可选折叠符从段落首个文本节点里剥掉。11 个已知类型（`note|tip|info|warning|important|caution|danger|success|question|example|quote`）大小写不敏感，表外类型退化成 `callout--generic` 并把原始类型词留在 `data-callout`。**折叠（`-`/`+`）本切片不实现**：折叠符被接受并剥掉，首行照常当标题。正文段落的源码区间逐字节不变 ⇒ 块级就地编辑的单元映射与提示块文字的可编辑性都不受影响（真实语料 8 篇 21 处：19 tip / 1 info / 1 warning）
- **pi 扩展 `vellum_figure` 工具：图示 HTML 不再进对话记录**：Agent 把图交给工具（优先给已 lint 的草稿文件路径，源码连工具参数都不进），扩展回一枚 `<!-- mdlog-fig:ID -->` 短标记，写入器落盘前把它展开回 `vellum-widget` 围栏——日志文件与手写围栏逐字节同形（**Vellum 侧零改动**），只是原先挂在回复正文里的 4–15KB 源码不再逐字进对话记录。落位仍由 Agent 指定：实测 19 条带图回复里 10 条围栏之后还有图注、4 条一轮多图，「一律追加到末尾」会放错位置；漏放标记的图在回合末兜底追加，且只认本批开始时的快照（图片复制 await 期间新到的图属于下一回合，提前补会既放错位置、又把它标成已消费）。另配 markdown transformer 把标记在交互式记录里改写成「▤ 图 · 标题 · 8 KB」，工具行与结果行各压缩成一行
- **pi 扩展实体迁入本仓库 `extensions/mdlog/`**：原先只存在于 `~/.pi/agent/extensions/mdlog`（仓库外、无备份），现在 pi 的加载位改为指向仓库内实体的目录联接。克隆后必须按 `extensions/mdlog/README.md` 重建联接，否则实时日志**静默失效**（pi 不会报错，只会当扩展不存在）

- **宣传品项目（`video/` 宣传片工程 + `promo/` 对外材料）**：30 秒 / 1920×1080 / 30 fps 宣传片，七场分镜（落墨开场 → 阅读面 → 长图推进 → 大纲搜索 → 就地编辑 → 现场会话 → 收尾），配乐由零依赖 Node 合成器产出。界面素材全部由 CDP 驱动真实 release 版窗口抓取（窗口图 + 「擑高视口」得到的全高长图），滚动推进交给 Remotion 逐帧计算而不是录屏，因此缓动与停顿精确到帧
- **对外分发材料（`promo/`）**：单文件落地页 `promo/index.html`（内联 CSS、零依赖，字体与截图走相对路径，双击即开）、9 秒循环 GIF（README 用）、四张海报帧、1280×640 社交分享卡、四张真实窗口截图。整套由 `promo/build-assets.mjs` 从成片导出（CRF 22 + faststart 重编码 / 两级调色板 GIF / `remotion still` 出海报）
- README 首页重写：顶部换成当前版本的截图，加入宣传片与落地页入口，功能按「读 / 寻 / 写 / 流 / 底子」分组重写（原列表停在只读阅读器的阶段，缺大纲检索、就地编辑、mdlog 与公式）
- **Obsidian `[[wikilink]]` 端到端：库内笔记互链可点开**：老行为是把 `[[目标]]` 原样留在正文里（属性卡的 `related` 只去方括号当纯文本）。现在由 `src/lib/wikilink.ts`（解析目标/别名/片段、抽取文档里出现过的目标）与 `rehypeObsidian.ts` 的行内换树把 `[[…]]` 变成 `<a class="wikilink" data-wikilink="目标">标签</a>`，点击走与「打开文件」完全相同的加载路径（`loadPath`：提交活动块 → 保存上一篇阅读位置 → 重置编辑会话 → 恢复目标笔记的阅读位置）。**解析在 Rust 侧新增 `resolve_wikilinks` 命令**：① 目标不合法（空 / 绝对路径 / 含 `..` / 含控制字符）直接判未找到；② 从文档所在目录逐级向上，按原样或补 `.md`/`.markdown` 找普通文件（大小写交给文件系统，不手工折叠）；③ 仍找不到则在最近的 `.obsidian` 库根内按**唯一 basename** 兜底（多命中取路径组件最少、同长按字典序；遍历限深 12 / 限项 50000，跳过点目录与 `node_modules`）。**解析发生在 `setState({status:"ready"})` 之前**，ready 态与文档一起携带「目标 → 绝对路径 | null」的表，因此首帧就是解析后的样子（没有「先纯文本再变链接」的闪烁与二次整篇解析）；IPC 抛错退化成空表，**绝不让解析失败挡住打开文档**。**解析不到的目标降级为纯文本 + 提示**（`span.wikilink--missing` + `title="未找到笔记：目标"`），不给假链接：wisdom 库实测 159 个不同目标里 14 个（36 处）靠唯一 basename 兜底命中，其余 24 个（如 `wiki/courses/电磁场与电磁波-第1章-矢量分析.md`、`wiki/entities/opencode`）按纯文本展示。围栏/行内代码里的 `[[` 不会被当成链接（frontmatter 里的 `related`/`sources` 项除外——那两项本就要变成链接）。本切片**不做片段跳转**：`[[目标#人读标题]]` 的 `#标题` 以 `data-wikilink-fragment` 随 DOM 带上，定位到标题是后续切片（**该后续切片已落地**，见下一条）
- **Obsidian `[[wikilink]]` 片段跳转（`[[目标#人读标题]]`）**：老行为是片段随 DOM 带上、点击只打开目标笔记却不定位（上一版明确留给后续切片）。现在点击把片段一并交给 `loadPath(path, fragment)`，ready 提交、正文进 DOM 后由 `handleContentRendered` 在**目标文档的大纲**里用 `matchHeadingByFragment`（`outline.ts`，与 `slugify` 同处）定位，再走点大纲那条**完全相同**的缓动路径（`scrollHeadingIntoView` → `animateContainerTo` + `outlineNavTargetRef` 锁大纲高亮到动画结束）——不另写一套滚动；自引用（`[[本笔记#标题]]`）不换文档，走同路径分支直接跳。匹配只认**整段相等**：逐字节 trim → 折叠空白 + 大小写不敏感 → `slugify(片段) === 标题 id`，绝不做子串/模糊（`Day 10` 不许含糊命中 `Day 100`，跳到错的标题比不跳更糟）。**片段跳转取代阅读位置恢复**（命中即返回、不挂落位守护）：两者作用于同一个滚动容器，恢复的守护还会在布局稳定前持续按锚点重锚定，不跳过就会「跳到位又被拽回旧位置」。片段**落空就退回正常恢复**（过期片段绝不阻断打开），消费即清空、加载失败也清，用户中途滚动则由全局输入监听取消动画。真实语料（wisdom 库 179 篇）实测：片段链接 10 处 / 7 个不同片段里**只有 1 处命中**（`#常见错误（周复盘②追问实证）`），6 个 `Day 10…15` 全部过期——目标 checkin 笔记如今只剩 `For future Claude` / 打卡台账 / 骨架状态 / 晚间检测范围 / 判定 五个标题，它们按「照常打开，不跳」处理
- **文首 YAML frontmatter 渲染成「属性卡」**：老行为是分隔线 + setext 标题 + 原样 YAML 文本（`date: …`、`tags: [a, b]` 直接漏进正文）。现在由 `src/lib/frontmatter.ts`（自写小解析器，覆盖实测的三种值形态：标量 / `[a, b]` 行内序列 / `- 项` 块序列，绝不抛异常）解析、`src/lib/rehypeObsidian.ts` 换成一枚紧凑卡片：键值一行一条，`tags` 出 chip，`sources` 里的 http(s) 出可点外链（复用既有 `a:` 渲染器交给系统 opener，`javascript:`/`data:` 只作文本），`related` 的 wikilink 与正文同款锚点（原先只去方括号、取目标当纯文本展示）。**渲染字符串仍是完整原文**：卡片在 rehype 层换树、卡片位置即 frontmatter 块区间，`buildEditUnits` 相应把它合并成一块 `reason: "frontmatter"` 的只读单元（编辑视图页边灰 ×），其余块单元的绝对偏移逐字节不变——块级就地编辑的偏移基准、回写与滚动锚定都不受影响。无 frontmatter 或围栏未闭合（`malformed`）时插件空操作，渲染与改动前逐字节一致；空块（`---\n---`）整块丢掉、不留空卡片
- **宣传片中文版**：`VellumPromoZh` / `VellumPromoZhSilent` 合成，与英文版共用同一条时间线；语言由 `src/locale.tsx` 的 context 下发，场景用 `useCopy()` / `useShot()` / `useMetaFont()` 分别取文案、素材与元信息字族（等宽字体没有汉字，中文元信息行必须退回衬线栈）。**中文版不是同一支片配字幕**：另写了中文演示文档 `video/assets/demo.zh.md`，用 `capture/capture.mjs --lang zh` 抓了 `zh-*` 一整套界面素材，因此片中的文档、大纲、编辑面、交互块都是中文的（顶栏文件名 `纸的界面.md`）。配套导出中文正片 / GIF / 海报帧 / 分享卡 / 窗口截图，落地页顶部加中英切换（影片切源不重载页面）
- **Obsidian 全库语料检查（`scripts/check-obsidian-corpus.test.tsx` + 入口 `scripts/check-obsidian-corpus.mjs`）**：三族语法（frontmatter / wikilink / callout）此前只有单篇夹具的单元断言，没有「真实笔记库整体处理干净」的收口证据。新检查把 wisdom 库（`VELLUM_VAULT` 可覆盖）**每一篇** 179 篇 `.md` 经**真实渲染管线**（`<MarkdownDocument>`，不传 wikilinks 表、不依赖 Rust 解析）渲染后逐族计数，并断言**未处理构造 = 0**（字面 wikilink 候选 / callout 标记行 / 原始 YAML 键行一处不留）。实测：文首围栏 168 篇全部渲染成属性卡、`.wikilink` 锚点 858 个（162 篇）、callout 21 个（8 篇：tip 19 / info 1 / warning 1），未处理构造 0。判据里的正则复用实现侧 `WIKILINK_RE` / `extractWikilinkTargets`（检查器自带一套定义就会各自漂移），且每族都是「源码侧 × 渲染侧」双闸——源码目标集必须全部落成 `[data-wikilink]`、源码标记行数必须等于 `[data-callout]` 个数，被行内标记切开的 `[[**粗**目标]]` 这类漏网只有双闸抓得到。**方括号按「字形完整的 wikilink 候选」判而不是裸子串判**：库里 6 处非代码文本节点含 `[[`/`]]`，全是引用块里没加围栏的 numpy / 矩阵字面量（`np.array([[1.0, …]])`），Obsidian 与实现侧都不认它们是链接，裸子串判会报 6 个假阳性；这 6 处仍被统计并按「方括号字面量（非 wikilink 形态，仅报告）」打印，只是不参与失败判定。库目录不存在时整体跳过（`describe.skipIf`，本机以外的机器上是一行 `1 skipped`）。成本：180 个用例 / +6s 墙钟（`npm test` 10.1s → 16.0s），留在默认套件内

### 修复

- **2026-09-14 重建 pi 扩展时丢掉的那条系统提示注入**：重建版没有把「mdlog live log: CONNECTED」注回系统提示（本文件 2026-09 段仍留着它当年的修复记录与回归测试「重连后系统提示注入锁定」），于是技能里那条「mdlog 分支」判据在实战中根本不触发——按 mdlog 分支逐回合强制的写作与出图规则等于没生效。现由 `vellum_figure` 的激活门禁与 `promptGuidelines` 承担同一作用（工具只在记录连接期间进工具表，其指引也只在那时进系统提示），技能与 AGENTS.md 的判据同步改为「工具表里有 `vellum_figure`」
- **`npm run capture` / `npm run music` 跑不起来**：两个脚本的默认路径按 `process.cwd()` 解析，而 npm script 的 cwd 是 `video/`，于是去找 `video/video/assets/demo.md`、写 `video/video/public/*`——前者 ENOENT 直接挂掉，后者会把产物静默写到错地方。改为从脚本自身位置（`import.meta.dirname`）推仓库根，从仓库根、从 `video/`、从任何地方跑结果一致（顺带清掉已产生的 `video/video/` 空目录）
- **宣传片编辑场景的「修订中」镜头拍错地方**：输入草稿后程序化滚动会被宿主的「阅读位置落位守护」当成布局漂移拽回锚点，这张素材因此拍到了几百行外的公式区，编辑面与刚打的字都不在画面里（上一版成片第 5 场的第三层）。改为先派一次真实滚轮事件交还控制权，再连量几轮把编辑面钉回画面中央——现在拍到的是等宽字的编辑覆盖层、草稿新增句与页边 `¶`
- **同一镜头的第二层问题（做中文版时暴露）**：光标停在段末时浏览器会把 textarea 自己滚到能看到光标的位置，`overflow:hidden` 下这不会出现滚动条、只会把段首的字裁掉（中文长段尤其明显，英文段落因为会折成多行反而还好）。抓取时在拍前把编辑面内部滚动归零，并让输入的字跟语言走（中文那套打中文句子）。诊断数据留在抓取日志的「编辑面几何」一行（taW/taSW/taSL/taH/taSH/len），两份文档均确认无横向溢出
## [1.7.0] - 2026-09-12

### 更改

- **编辑视图视觉重设计（A2「页边字符」）**：正文渲染与阅读视图保持一致，编辑信号全部移到块左页边——hover 可编辑块浮出淡 `¶`；只读块（原生 HTML / 交互块）改为页边常驻灰 `×` + `not-allowed` 光标（不再画粗灰虚线框）；激活块的覆盖层 textarea 改为透明底零框线（草稿首字与渲染态逐像素对齐），编辑中的块由覆盖层左侧的 brand 色 `¶`（`.block-editor__mark`，随覆盖层定位）标示。实现要点：页边字符一律用「绝对定位 + auto 偏移取静态位置 + `margin-left: -26px`」，**绝不给块自身加 `position:relative`**——代码块 / widget 根容器带 `overflow:hidden`，伪元素以它们为包含块时 `-26px` 处的字符会被整条裁掉

### 新增

- **多实例支持**：移除单实例锁（`early_single_instance` 模块 + `tauri-plugin-single-instance`），双击多个 .md 或用 `vellum.exe a.md` 反复启动，每个进程开自己的窗口、载自己的文档，不再被转发给首实例。settings Store 跨进程共享、后写覆盖；阅读位置按文件路径键控，不同文件的实例互不干扰。前端运行期的 `pending-open-paths` 监听随之拆除（事件唯一生产者是已移除的插件），每个进程只在启动时 drain 自己的命令行路径

- **文档内锚点链接（Markdown 标准语法 `[文字](#id)`）接管点击**：以前交给浏览器默认的 hash 跳转——目标存在时虽能滚，但会改写 URL/历史、不参与我们的缓动滚动与大纲联动；目标不存在（如 `#main`）就直接没反应。现在点击统一接管：目标在正文里则缓动滚到它（与点大纲同一条路径，标题会顺带锁定大纲高亮）；`#` / `#top`（HTML 规范定义的「文档顶部」片段）与 `#main`（HTML 导出文档里最常见的包裹 id，即本应用的 `<main>` 主区域）滚到文档顶部；其余找不到的目标不猜不动，但仍阻止 hash 改写。用户那份报告的 7 处 `[返回顶部](#main)` 因此直接可用（文档自身从未定义 `id="main"`，这不是 Markdown 语法问题——链接语法一直支持，缺的是目标锚点）
- **交互块授权落盘**：`[点击加载]` 的授权以前只存在组件 ref 上（键为 html），文档重开/热重载重建实例/重启应用后就丢失，于是「我明明加载过一次，每次进来还要我点」。新增 `src/lib/widgetTrust.ts`：按 **widget 源码指纹**（cyrb53 + 长度前缀）记住用户点过的交互块，写入共享 settings Store（上限 300 条，FIFO 淘汰；Store 不可用时退回 localStorage），并稳定同步读：渲染期用 `useSyncExternalStore` 判定。同一文档里*不同*的交互块仍需各自点一次（用户裁定），未授权的块门禁不变

### 修复

- **同一个交互块被 LRU 卸载成「交互已休眠 · 点击查看」后又得点一次**：休眠只是「全局最多 10 个存活 iframe」的内存闸门，对**已授权**的块不该再要人工点击。现在已授权的块重新进入预载视野即自动 `activate` 恢复（存活上限仍为 10，内存/CPU 与之前一致；未授权的块仍然停在占位块）
- **开关侧边栏时正文「闪到别处」**：侧栏开关/拖宽只改正文**宽度**，正文按新宽度重新断行 ⇒ 整篇文档高度变化（用户文档实测 ±3965px），而 **Chromium 原生滚动锚定对「行内尺寸变化驱动的重排」一律不补偿**（真机对照：同一滚动容器改字号 `Δhtop=+4777` 正常补偿、顶部插块 `Δhtop=+400` 正常补偿，改宽度则 `scrollTop` 恒不变；合成对照里一个纯 1000px 容器瞬时改宽同样 `ΔscrollTop=0`），于是 scrollTop 原地不动、视口内容整段平移：关侧栏向上跳 ~3600px，开回来再跳回原位——观感就是「关侧栏页面闪到别处、开回侧栏又恢复」。修法：新增 `src/lib/viewportPin.ts`（在**事件入口、状态更新之前**按旧布局捕获「视口顶部首个可见块 + 相对偏移」，再在布局过渡窗内逐帧按该锚点补偿 `scrollTop`；首帧补偿放在 `useLayoutEffect` 里绘制前同步完成，用户滚动输入立即交还控制权），并把侧栏开关的**全部入口**（顶栏按钮 / `Ctrl+K` / 窄屏 `Escape` 与遮罩 / 窄屏选章）与拖宽手柄统一接入 `beginWidthTransition()`。顺带把文档里一直宣称、代码里从未接线的「侧栏开关 450ms 布局过渡窗」补上（此前只有拖宽会开窗），故开关期间的热重载合并延迟与 widget 高度过渡关停也一并生效
- **快捷键被当成「用户滚动」，`Ctrl+K` 开侧栏时钉住当场失效**：`lastUserScrollAtRef`（热重载避让与视口钉住都靠它判定「用户接管」）原先在任何 `keydown` 上都会打时间戳，而 `Ctrl+K` 的快捷键监听先于滚动输入监听执行——时间戳落在钉住开始之后 ⇒ 钉住被当场取消（顶栏按钮路径正常，只有快捷键路径跳）。现在只有**会滚动的键**（方向键 / PageUp·PageDown / Home·End / 空格 / Tab）打时间戳（新增 `src/lib/scrollInput.ts` + 单测），取消进行中滚动动画的行为不变
- 真机验收（`scripts/cdp-sidebar-jump.mjs`，release exe + CDP）：逐帧采「钉住元素相对容器顶的偏移」，并区分**帧内读数**与**绘制后读数**（rAF 内修正回调早于探针采样时，帧内读数会记录修正前的状态，不代表用户看到了跳）——用户真正看到的那个数：修复前最大位移 **3652px**、单帧最大突变 **1674px**；修复后关闭 **0px** / 打开 **1px**（单帧 1px），拖宽手柄 **0px**；关停全部 CSS 过渡（`prefers-reduced-motion` 形态）同样一次到位（scrollTop 32618 → 30803）。同一探针的对照实验顺带立了两条事实：① 同一滚动容器改字号（Δh +4777px）与顶部插块（+400px）**会被**原生锚定补偿，只有改宽度不会被；② 窗口缩放（Emulation 改布局视口宽，bodyW 728 → 508、总高 +20444px）由原生锚定自行补偿，内容位移仅 **22px**，故本修复不介入窗口缩放（也避免了一份会在热重载后失真的陈旧锚点快照）

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
