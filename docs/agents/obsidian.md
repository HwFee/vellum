# Obsidian 三族语法与定稿形态

`AGENTS.md` 的详情分册。三族语法 = frontmatter 属性卡 / callout / wikilink；另含文档标题（inline title）与属性卡、提示块的定稿形态，强调定界符的 CJK 兜底，全库语料检查与真机验收探针。

## frontmatter 渲染成属性卡

出处：`frontmatter.ts` 解析 + `rehypeObsidian.ts` 换树。

- **交给 react-markdown 的字符串永远是完整原文**（`App.tsx` 加载的那一份）：frontmatter 只是换树、绝不从源码里剥掉。
- 因果：块单元按**绝对源码偏移**工作（`editUnits` 算区间、`rehypeEditUnits` 按节点位置匹配、`spliceUnit` 回写整篇）。
- 字符串一旦被切短，正文每个块的偏移整体平移、标记落到邻块、回写写坏文件。
- 卡片的位置写成被替换节点的原始区间 `[range.start, range.end)`。
- `buildEditUnits` 相应把该区间合并成一块只读单元（`reason: "frontmatter"`，**其余单元的偏移逐字节不变**），编辑视图的 `data-vellum-locked="frontmatter"` 与页边灰 × 免费拿到。
- 不可回退 ①：插件必须挂在 `rehype-sanitize` 之后（自产 hast 不经白名单）、`rehypeEditUnits` 之前（卡片要先存在才谈得上打标）。
- 不可回退 ②：真实 hast 在块与块之间夹着**没有位置**的换行文本节点，插件只吞「已收下区间内节点之后」的空白文本节点。
  - 别放宽成无条件跳过无位置节点（会凭空多出卡片或吞掉正文）。
- 不可回退 ③：卡片里的 http(s) 锚点复用 `components.a`，而该覆盖渲染**不透传 hast 的 className**。
  - ⇒ CSS 只能写 `.md-props__list a` 这类结构性选择器，别指望 `.md-props__link` 在真机 DOM 里存在。

## Obsidian callout（`> [!tip] 标题`）就地换形

出处：`rehypeObsidian.ts` 的第三段换树 + `kami.css` 的提示块区段。

- **就地改造那个 blockquote 自己**：挂上 `callout callout--<类型>` 类与 `data-callout`，并在正文段落**之前**插一枚 `<div class="callout__title">`。
- **不换新容器、也不给 `components` 加 blockquote 覆盖渲染**。两条理由都是硬约束：
  - 块嵌套深度与钻取出来的块单元必须与今天逐字节相同（`editUnits` 在**原始 Markdown** 上把 blockquote 的直接子块各算一块，页边 `¶`/`×` 与 `[data-vellum-unit]` 查找全靠它）。
  - `components` 必须保持 memo 结果——多一条覆盖渲染就多一条整篇重解析的路径。
- **正文段落的对象与 `position` 都不动**：标记行只从段落**首个文本节点的字符**里剥掉（`[!type]`、可选折叠符、自定义标题）。
  - 段落区间因此逐字节不变，`rehypeEditUnits` 的区间包含判定照旧命中。
- **语料形状**是「标记行与正文行同属一个段落、同一个文本节点里夹着一枚软换行」（8 篇 21 处实测），不是「标题块 + 正文块」两块。
- 真实 hast 在引用首尾各夹一枚**没有位置**的换行文本节点，取段落时**只允许**跳过空白文本节点（前导是别的东西就停手）。
- **11 个已知类型**（`note|tip|info|warning|important|caution|danger|success|question|example|quote`，大小写不敏感）用 Obsidian 的英文默认标签。
  - **自定义标题取代**默认标签（与 Obsidian 一致）；表外类型退化成 `callout--generic` 并把**原始写法**留在 `data-callout`（默认标签也用原始词）。
- 检测严格：只在**首个段落的首行行首**认 `[!word]`，标题必须由空白引入（`[!tip]标题` 判为普通引用）。
- 段落中间 / 行内代码 / 后续段落里的 `[!tip]` 一律不动；已带 `callout` 类则幂等跳过；任何认不出的树形态退化成「引用照旧」，绝不抛。
- **折叠（`-`/`+`）本切片不实现**：折叠符接受并被剥掉，首行照常当标题渲染。
- **源/DOM 差异是刻意的**：DOM 里标记行不再含 `[!tip] 标题`（标题进了 `callout__title`），而那一段的**编辑单元切片仍含原始两行**（textarea 显示的就是带 `>` 的原文）。
  - 不把标记行做成只读块，提示块的文字照旧可点入编辑。
- CSS 侧：callout 区段必须放在首个 mdlog 选择器**之前**、且自身不出现 `mdlog-widget` 字样（mdlog 设计约束用例从首个该选择器扫到文件尾）。
- 类型区分只靠标题文字 + 左规则线/底色，颜色全取 `:root` 变量，不引入第二个色相。
- 本次增量不落入口 chunk：`rehypeObsidian` 属懒加载的 `MarkdownDocument` chunk（`MarkdownDocument-*.js` 269.56KB），入口 chunk 仍是 165.02KB。

## Obsidian wikilink 端到端

出处：`wikilink.ts` 解析/抽取 + `rehypeObsidian.ts` 行内换树 + Rust `resolve_wikilinks` + `App.tsx` 解析接线。

解析语义依次三条：

- ① 目标不合法（空 / 绝对 / 含 `..` / 含控制字符）→ 未找到。
- ② 从文档所在目录逐级向上，按原样或补 `.md`/`.markdown` 找**普通文件**。
- ③ 仍找不到则在最近的 `.obsidian` 库根内按**唯一 basename** 兜底（多命中取路径组件最少，同长按字典序；无 `.obsidian` 就跳过这一步）。
- 只读存在性检查，大小写交给文件系统，绝不手工折叠。
- **解析发生在 `setState({status:"ready"})` 之前**（`ready` 态与 `document` 一起携带 `wikilinks: ReadonlyMap<目标, 绝对路径|null>`）。
  - 否则首帧全是「未找到」纯文本、第二帧才变链接（闪烁 + 整篇重解析）。
- IPC 抛错一律退化空表，**绝不阻断打开**。
- **解析不到的目标降级为纯文本 + 提示**（`span.wikilink--missing`，`title="未找到笔记：<目标>"`），永不给假链接。
- 传入空串目标（`[[#片段]]` 这类同篇跳转）同样走这条路。

四条不可回退：

- ① **href 方案是 `wikilink:` 且必须在 `urlTransform` 里放行**——`defaultUrlTransform` 会把未列出的协议清成空串。
  - 而 `components.a` 的协议分支（`/^[a-zA-Z][\d+.-]*:/`）会把 `http(s):` 交给系统 opener，wikilink 分支必须排在它**之前**（`MarkdownDocument.test.tsx` 有「点击不触发 openUrl」断言）。
- ② hast 属性名写 camelCase `dataWikilink`，`hast-util-to-jsx-runtime` 经 property-information 落成 DOM 的 `data-wikilink`，自定义组件读到的 props 键也是带连字符的那个（DOM 断言锁定）。
- ③ 换树**不进入** `code`/`pre`/`a`/`script`/`style` 子树与 `.md-props` 卡片（katex 此刻还没跑，公式仍是 `code`，一并挡住）。
- ④ `extractWikilinkTargets` 必须与 `parseWikilink` 的目标切法**逐字节一致**（含 frontmatter 里的 `related`/`sources`），否则渲染层按 `data-wikilink` 查表全部落空。

### 片段跳转（`[[目标#人读标题]]`）

- 走一条与点大纲**完全相同**的路径：`data-wikilink-fragment`（人读标题原文，非 slug；无片段时锚点不带该属性、回调只有两参）随点击进 `loadPath(path, fragment)`。
- ready 提交、正文进 DOM 后由 `handleContentRendered` 用 `matchHeadingByFragment`（`outline.ts`，与 `slugify` 同处）在**目标文档的大纲**里定位。
- 再调 `scrollHeadingIntoView`（点大纲与片段跳转共用的唯一缓动路径：`animateContainerTo` + `outlineNavTargetRef` 锁高亮）。
- 自引用（`[[本笔记#标题]]`）走的是同路径分支，正文已在 DOM 里，直接跳。

四条不可回退：

- ① **匹配只认整段相等**（逐字节相等，两侧 trim → 折叠空白 + 大小写不敏感 → `slugify(片段) === 标题 id`），绝不做子串/模糊——跳到错的标题比不跳更糟（`Day 10` 不许含糊命中 `Day 100`）。
- ② **片段跳转取代阅读位置恢复**（命中时 `return`，不挂落位守护）：两者作用于同一容器、守护会在布局稳定前持续按锚点重锚定，不跳过就会「跳到位又被拽回旧位置」。
- ③ **落空即退回正常恢复**（片段消费即清空，加载失败也清），过期片段绝不阻断打开。
  - 实测：wisdom 库 10 处片段链接（7 个不同片段）里 **9 处（6 个片段）是过期的**（6 个 `Day 10…15` 指向的 checkin 笔记只剩 `For future Claude` / 打卡台账 / 骨架状态 / 晚间检测范围 / 判定 五个标题），只有 `#常见错误（周复盘②追问实证）` 命中。
- ④ 用户滚动中途接管时动画由全局输入监听取消（`onComplete` 同步解锁大纲），已消费的片段不会再来第二次。

## 文档标题（inline title）与属性卡 / 提示块的定稿形态

2026-09-18 定稿：四项样式经候选页逐块选定（候选页与汇总预览已在 2026-09-21 仓库清理中移除，从 git 历史取回）。

### ① 标题搬进正文

- `App.tsx` 在 `state.status === "ready"` 分支里、`<MarkdownDocument>` **之前**渲染 `h1.document-title`，文本取 `fileNameToTitle(state.document.fileName)`（`path.ts`，只剥 `.md`、大小写不敏感）。
- 它刻意留在 `.markdown-body` **之外**：标题不是文档内容，因此不进 markdown 解析 / 搜索高亮 / 块单元 / 大纲，也不需要在 `components` 或 rehype 侧做任何事。
- CSS 用与 `.markdown-body` 同参的 `min(800px, 100%)` + `40px 32px` 保证左缘与正文首块逐像素对齐。
- 不可回退 **顶栏不显示文件名与路径**：`.top-bar__title` / `TopBar` 的 `fileName` prop 与 `.top-bar__path` / `.top-bar__meta` 均已移除（中列只剩拖动热区 `.top-bar__spacer`，顶栏是纯工具栏），文件名只在正文首行出现一次；**完整路径的归宿只有两处**——`h1.document-title` 的 `title` tooltip（`App.tsx` 传 `state.document.path`）与设置页「关于与数据 · 当前文档」（无文档时显示「未打开文件」）。
- **换文档的判据一律看 `h1.document-title`**（真机探针 `cdp-obsidian-verify.mjs`、`App.test.tsx` 的用例都已改），别再引用 `.top-bar__title`。
- 不可回退 **标题贴顶**：`.document-scroll__content:has(.document-title)` 把正文区顶部留白从 70px 收到 42px、`.document-content:has(.document-title) .markdown-body` 把正文顶距从 40px 收到 20px。
- 那 70/40 是给**没有标题**的页面（空状态 / 错误页 / 加载中）准备的呼吸感，别为了「统一」删掉这两条 `:has()`，否则标题会掉回正文原本的位置（`kami.css.test.ts` 有对应断言）。
- 不可回退 **日志类文件名会让标题与正文 H1 挨着重复**（`2026-07-19.md` → 标题 `2026-07-19`，正文自己还有一行 `# 2026-07-19（Day 3，周日）`）——Obsidian 亦然，Owner 明确选了「照原样」。
- **别自作主张加「纯日期名不显示」的分支**（`path.test.ts` 有用例钉住这个行为）。

### ② 属性卡改形态

- `.md-props` 去掉 ivory 底色与 1px 外框，改 `border-top` 一条发丝线。
- `.md-props__row` 从 flex 改 `display: grid; grid-template-columns: 78px minmax(0, 1fr)` + `border-bottom` 行线。
- tags 从 `tag-bg` chip 退成 `.md-props__chip + .md-props__chip::before { content: "· " }` 的中点分隔。

### ③ 提示块改形态

- `blockquote.callout` 无底色、`border-radius: 0`、`border-left: 2px solid var(--hairline)`（原「靛青边 + brand-tint 底、警示族暖砂底」已废）。
- 类型只靠标题字色区分——`.callout__title` 靛青、警示族淡墨且竖线沉到 `--stone`。

### ②③ 的共同约束

- **都只改 CSS**：DOM 结构、块单元契约（`reason: "frontmatter"` 只读单元）、`components` 的 memo 与既有断言一律不动。
- 三条形态各由 `kami.css.test.ts` 的「文档标题 / 属性卡 / 提示块定稿形态」用例锁死，改样式前先读那里的断言。

## 强调定界符贴 CJK / 标点

- 由**渲染层软件兜底**：`remark-cjk-friendly` + `remark-cjk-friendly-gfm-strikethrough`（在 `REMARK_PLUGINS` 中位于 remarkMath 之前），并有渲染级回归测试锁定（`MarkdownDocument.test.tsx`）。
- `vellum-mdlog` 技能侧的写法要求仅为跨渲染器可移植性建议，不再是硬禁令。

## 全库语料检查（三族语法有没有真处理干净的收口证据）

入口 `node scripts/check-obsidian-corpus.mjs`，本体 `scripts/check-obsidian-corpus.test.tsx`。

- 把 wisdom 库（`VELLUM_VAULT` 可覆盖，默认 `C:/Users/17445/Desktop/wisdom`）里**每一篇** `.md` 走**真实渲染管线**（`<MarkdownDocument markdown={source} />`）后逐族计数——frontmatter 属性卡数、`.wikilink` 锚点数、callout 数与类型分布。
- **完成判据是「未处理构造数 = 0」**（字面 wikilink 候选 / callout 标记行 / 原始 YAML 键行一处都不许留）。
- 它有 180 个用例，约 +6s 墙钟（`npm test` 实测 10.1s → 16.0s，远低于值得拆出去的量级，故留在默认套件里）。
- ① **库目录不存在就整体跳过**（`describe.skipIf`），没装 wisdom 的机器上是一行 `1 skipped` 而不是一片红。
- ② **方括号按「字形完整的 wikilink 候选」判，不按裸子串判**——库里 6 处非代码文本节点含 `[[`/`]]`，全是引用块里没加围栏的 numpy / 矩阵字面量（`np.array([[1.0, …]])`、手算 `[[7 10] [15 22]]`）。
  - 实现侧与 Obsidian 都不把它们当链接，按裸子串判会报 6 个假阳性；这些仍被统计并打印为「方括号字面量（非 wikilink 形态，仅报告）」，只是不参与失败判定。
- ③ 判据里的正则**复用实现侧那一份**（`WIKILINK_RE` / `extractWikilinkTargets`），另外两族都是「源码侧 × 渲染侧」双闸（源码目标集必须全部落成 `[data-wikilink]`、源码标记行数必须等于 `[data-callout]` 个数）。
  - 被行内标记切成多节点的 `[[**粗**目标]]` 这类漏网只有双闸抓得到。

## 真机 Obsidian 验收探针

`scripts/cdp-obsidian-verify.mjs [--file <真实.md>] [--keep]`

- 脚本自己 `taskkill` 后独占启动 release exe（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`）、打开指定笔记、等属性卡与正文就位后读数断言。
- 属性卡：行数 / 芯片数 / `related` 行可点链接数。
- `document.body.innerText` 里 `[[` 与 `[!type]` 的字面计数必须为 0。
- `.callout` 数必须等于**源码里的标记行数**（脚本自己数）。
- 阅读视图 `[data-vellum-unit]` 为 0。
- 随后**点一个带 `wikilink:` href 的库内链接**并等正文首行的大标题换成目标笔记名（`h1.document-title`；2026-09-18 顶栏去标题之前用的是 `.top-bar__title`）——这一步是「点击真的加载了目标笔记」的唯一证据。
- **2026-09-18 起另加三条「定稿形态」的真机证据**（`getComputedStyle` 实算，防「源码里改了、打包产物没跟上」这类静默漂移）：
  - `h1.document-title` 的文本等于文件名去 `.md`。
  - 属性卡 `background` 透明且 `borderLeftWidth: 0px` + 上边一条细实线。
  - `blockquote.callout` 背景透明 + 一道细竖线。
- **边框宽度按区间判、不认死值**：真机 DPI 缩放 150% 下 computed style 会把 1px 折算成 `0.666667px`（本机实测），死等式会在别人的机器上假红。
- 最后点 ✕ 要求 page target 归零。
- 实测（`wiki/projects/checkin-archive/2026-07-17--2026-09-06.md`，41 处链接 / 14 个 callout）：rows 7 / chips 5 / related 2 / 字面 0 / callout 14=14——14 项全 PASS。
- 同一实测里点 `[[wiki/projects/inference-engineer-roadmap]]` 后正文大标题变 `inference-engineer-roadmap`（顶栏自 2026-09-18 起只报目录，不再显示文件名）。
- 另有一项「标题贴着顶栏下方」的位置断言：`titleTop=42px`（正文区顶部留白收窄后的实测值；掉回 ~110px 说明两条 `:has()` 上移规则被删了）。

## 文件索引

| 文件 | 职责 |
|------|------|
| `src/lib/frontmatter.ts` | 文首 YAML frontmatter 解析（保序键值对 + 精确源码区间，绝不抛异常） |
| `src/lib/wikilink.ts` | `[[wikilink]]` 解析/标签/切分/目标抽取（纯函数；不碰文件系统） |
| `src/lib/rehypeObsidian.ts` | 属性卡 + 行内 wikilink + callout 的 rehype 插件（sanitize 之后、editUnits 之前；只换树，源码偏移不动） |
| `scripts/check-obsidian-corpus.test.tsx` | Obsidian 全库语料检查（真实渲染管线跑 wisdom 每一篇 `.md`，三族语法各计识别数 + 未处理构造必须为 0） |
| `scripts/check-obsidian-corpus.mjs` | 语料检查入口（拉起 vitest 并透传退出码；检查本体在 .test.tsx 里，见文件头注释） |
| `scripts/cdp-obsidian-verify.mjs` | 真机验收 CDP 探针：独占启动 release exe 打开一篇真实 wisdom 笔记，断言属性卡/零字面 `[[`/零 `[!type]`/callout 数与语料一致/点库内链接真的换文档 |
