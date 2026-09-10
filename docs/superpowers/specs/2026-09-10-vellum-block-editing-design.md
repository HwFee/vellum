# Vellum 块级就地编辑（Obsidian Live Preview 近似）设计

- 日期：2026-09-10
- 状态：已实施并收口（2026-09-10，Task 8；实施期修订见 §14）
- 关联：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（mdlog 实时记录）、`AGENTS.md`（性能结构约束）

## 1. 背景

Vellum 目前是**纯阅读器**：`load_document` 只读命令把 Markdown 读进内存，前端渲染；外部改写由文件监听（`notify` + 400ms 防抖）触发静默热重载。仓库内**不存在任何写盘链路与编辑态代码**，因此本功能是新增子系统而非改造既有流程。

用户诉求（原话整理）：

1. 模仿 Obsidian 的编辑手感：**不编辑时就是渲染结果，点击某一块才进入编辑**
2. 保持 HTML **不会改变、不能被修改**，其他内容都可修改
3. 最基础的编辑功能即可

## 2. 目标与非目标

**目标**：以最小内核增量，提供「渲染为默认态、点击块即就地改源码、点走即提交」的编辑体验，用于**轻量修补**（改错别字、补一句话、调措辞）。

**非目标（明确不做）**

| 不做的事 | 原因 |
|---|---|
| 行级揭示 / 源码语法高亮 / 光标行附近才显示语法 | 这是 Obsidian Live Preview 的**编辑器内核**能力（CodeMirror 6 装饰器），需要把阅读面整体迁到 CM6，等于重写阅读器；单独立项 |
| 整篇源码模式（Obsidian 的 Source mode） | 用户已确认本阶段不需要 |
| 跨块选择、搬段、查找替换等结构重排 | 用户所选场景仅为轻量修补 |
| 新建文件 / 另存为 / 拖拽插入图片 | 与阅读器定位无关 |
| 编辑期间与 pi/mdlog 共存 | 见 §7 硬门禁 |
| 版本历史 / 撤销栈持久化 | YAGNI |

## 3. 关键决策

| 编号 | 决策 | 说明与否决的备选 |
|---|---|---|
| **D1** | 视图门禁：默认**阅读视图**（点击＝选字，与现状完全一致），`Ctrl+E` / 顶栏按钮进入**编辑视图**；编辑视图内点击可编辑块才进入就地编辑 | 对应 Obsidian 的 Reading view ⇄ Editing view。不做「打开即可编辑」，保护阅读器定位与 mdlog 记录态 |
| **D2** | 单元粒度：**顶层节点各成一块 + `list` 下钻到 `listItem` + `blockquote` 下钻到直接子块**（只下钻一层） | 更细的行级揭示需要 CM6；不下钻会让「点列表项」打开整张长列表，可用性不可接受 |
| **D3** | 编辑期间**不实时重渲染**；提交时整篇重解析一次 | 让键盘输入完全不进解析管线，这是现有性能机制得以全身而退的前提 |
| **D4** | 不可激活对象：**块级 HTML**、`vellum-widget` 围栏、mdlog 头注释（`<!-- mdlog:v1 -->`）；点击仅给一次提示 | 「HTML 不能改」由此成为**结构性事实**（无编辑入口、零绕过路径），不需要守卫代码。行内 HTML 位于可编辑块内部，作为普通源码文本可编辑 |
| **D5** | **提交即落盘**（自动保存）；`Ctrl+S` 等价于「提交当前块」；**不设体积硬阈值**，改为**自适应软提示**（实测提交耗时 > 800ms 时挂出） | 提交即落盘 ⇒ 不存在「未保存改动」⇒ 脏标记、冲突横幅、关窗提示、切换确认整套状态被删除。硬阈值被实测否决，见 §12 |
| **D6** | mdlog 记录中**一律禁止编辑**（硬门禁）；记录中若正有块在编辑，取消该块编辑并提示 | 用户明确要求：「修改文件与 mdlog 协作不能共存，必须断开连接后才能修改」 |
| **D7** | 编辑后 pi 会话上下文与磁盘分叉**不在本次范围**，记入已知限制 | 用户选择自行注意；如后续需要，由 pi 扩展侧在重连时提示模型重读 |
| **D8** | 数学块用**外层包裹元素**（`display: contents`）承载标记，保持可编辑 | `rehype-katex` 会整体替换命中 `math-display` / `math-inline` / `language-math` 的节点及其属性，不包裹就会变成「点不动的死块」 |

**被评估并否决的方案**

- **整篇源码模式**（`Ctrl+E` 在阅读 ⇄ 全文 textarea 间切）：实为 Obsidian 的 Source mode，非用户所描述的手感。
- **真 Live Preview（CodeMirror 6）**：忠实度最高，但需把滚动、搜索高亮、视口锚点恢复、widget 预载、布局过渡窗整体迁到 CM6 视口模型，既有 `MarkdownDocument.test.tsx` / `App.test.tsx` 接线回归大面积重写，新增 100–250KB gzip。属于「把阅读器改造成编辑器」的量级。
- **单 textarea + 锁定带 + 镜像叠层 + 双道保证**：在「整篇源码模式」方案下用于硬锁 HTML；D4 落地后其锁语义成为结构性事实，整套机制作废。

## 4. 架构与文件清单

### 新增单元（3 个，各自单一职责、可独立测试）

| 文件 | 职责 | 依赖 |
|---|---|---|
| `src/lib/editUnits.ts` | 纯函数：Markdown → 块单元序列（`可编辑/不可编辑` + 源码区间 + 单元类型） | `mdast-util-from-markdown` + gfm（**已在入口 chunk**，不新增体积） |
| `src/components/BlockEditor.tsx` | 就地编辑面：隐藏原块、锁高、绝对定位 textarea、自增高、光标落点、提交/取消 | `editUnits` |
| `src/hooks/useDocumentEditor.ts` | 编辑会话状态机：`viewMode / activeUnit / draft / commit / save / mdlog 门禁 / 外部变更` | `invoke`、`BlockEditor` |

### 改动文件

| 文件 | 改动 |
|---|---|
| `src/components/MarkdownDocument.tsx` | 新增 rehype **标记插件**（给块元素打 `data-vellum-unit`）、数学块包裹、~~`sanitize` schema 增加 `data*`~~（**该步骤已作废**，见 §14.2）、编辑视图下的点击解析与 `BlockEditor` 挂载（新增 props 需引用稳定，见下） |
| `src/App.tsx` | `Ctrl+E` 门禁、编辑视图接线、提交后状态更新、外部变更分流、回声抑制、滚动位置进出编辑的衔接 |
| `src/components/TopBar.tsx` | 阅读/编辑视图切换按钮（含禁用态：无文档 / mdlog 记录中） |
| `src-tauri/src/document.rs` | `save_markdown_file`：原子写 + EOL 保真 + 大小/扩展名/路径闸门 |
| `src-tauri/src/main.rs` | `save_document` 命令 + mdlog 存活闸门；注册进 `invoke_handler` |
| `src/styles/kami.css` | 编辑态区段（**必须位于首个 `.mdlog-widget` 之前**，且不得含 `.mdlog-widget` 字样） |
| `DESIGN.md` | 新增编辑态 token |

### 明确不动的既有约束

- `CodeBlock.tsx` 继续用 `PrismLight`（禁止切回 `PrismAsyncLight`）
- `MarkdownDocument.tsx` 内 `MarkdownBody` 的 memo 化与 props 引用稳定性 —— 本功能新增的 props（`editable`、`activeUnit`、`onActivate`、`onCommit`、`onLockedClick`）必须由 `App` 用 `useCallback`/`useMemo` 提供稳定引用，否则每次 App 渲染都会重走解析管线
- `search-match--current` 由 layout effect 维护（不放回 rehype 参数）
- `.document-scroll` + `CustomScrollbar` + `JumpToBottom` + 滚动记忆 + 布局过渡窗的既有分工
- `WidgetSandbox` 的 memo / 10 实例 LRU / 懒挂载 / `mdlog-widget__frame--static`

## 5. 块单元与标记

### 5.1 划分规则（`buildEditUnits(markdown)`）

遍历 mdast 顶层节点：

- 顶层节点各成一块
- 顶层为 `list` ⇒ 其每个 `listItem` 各成一块
- 顶层为 `blockquote` ⇒ 其每个直接块级子节点各成一块（不再深钻）
- 每块记录：`index`、`start`/`end`（`position.start.offset`/`end.offset`）、`nodeType`、`editable`

区间必须满足：**排序、互不重叠、并集 ⊆ `[0, len)`**；块之间的空白与空行不属于任何块，编辑不触碰它们（保真）。

### 5.2 不可编辑判定

| 类型 | 判定 | 提示语 |
|---|---|---|
| 块级 HTML | mdast `html`（含 HTML 注释，mdlog 头注释即此类） | 「HTML 区块为只读」 |
| 交互块 | `code` 且 `lang === "vellum-widget"` | 「交互块只读，点击可交互」 |
| 无位置信息 | `position` 缺失（防御路径） | 不提示，静默不可激活 |

### 5.3 标记插件与单一真相源

- rehype 插件按**源码区间查表**给块元素打 `data-vellum-unit="<index>"`；表中的 index 与区间来自 `buildEditUnits(markdown)` 的同一份结果 ⇒ 前端与 DOM 不存在两套索引，无漂移可能
- ~~`hast-util-sanitize` 的 schema 增加 `'data*'` 通配（readme 明示支持），标记属性得以活过 sanitize~~ —— **已作废**（见 §14.2）：标记插件位于 `rehype-sanitize` **之后**，标记属性根本不经过 sanitize；追加通配只会放宽**阅读视图**的白名单
- 插件位置在 `rehype-sanitize` **之后**（避免属性被剥）、`rehype-katex` **之前**（位置信息尚未丢失）
- **仅在编辑视图启用**：`editable === false`（阅读视图）时不打标记、不包裹数学块 ⇒ 阅读视图 DOM 与今日逐字节一致，零回归风险与零额外开销
- **数学块**：命中 `math-display` / `math-inline` / `pre > code.language-math` 的单元，标记打在新建的外层包裹元素上（`display: contents`，不参与布局）；取矩形时回退到首个元素子节点
- 点击解析：对点击目标向上找最近的 `[data-vellum-unit]`（表格单元内的 `<td>`、列表项内的 `<p>` 等都由祖先承担），命中不可编辑块则走提示分支

### 5.4 已知限制

- 块内文本被 `rehype-sanitize` 改写（如不允许的标签被剥离）时，块的**源码区间**仍指向原文 ⇒ 编辑的是原文，渲染与源码本就不一致的部分以源码为准（这是正确行为：编辑器改的是源码）

## 6. 激活与提交机制

### 6.1 激活（点击可编辑块）

1. 记录原块元素，`visibility: hidden`、锁定当前高度、`overflow: hidden`（**保留占位**，内容不下跳）
2. 在 `.markdown-body` 内渲染绝对定位的 `<textarea>`（React 兄弟节点，**不使用 portal、不插入外来 DOM**），位置/宽度对齐原块
3. 自增高：`ResizeObserver` 观察 textarea，同步写回原块元素高度 ⇒ 后续内容像 Obsidian 一样被**推下去**（不是被盖住）
4. 光标落点：行级近似 —— 以点击点纵向位置对照源码行数定位到对应源码行行首；若点击落在块下半部分则退到末行行首
5. 键盘：`Esc` = 提交并结束该块编辑；`Ctrl+S` = 提交当前块

### 6.2 提交

```
next = markdown.slice(0, unit.start) + draft + markdown.slice(unit.end)
```

- draft 与原文相同 ⇒ 不提交、不落盘、不重渲染
- 否则：更新内存 markdown ⇒ 整篇重渲染一次 ⇒ 落盘（**提交即落盘**，见 §7）
- 重渲染期间与之后的滚动稳定性：复用既有 `captureViewportAnchor` / `restoreViewportAnchor`，锚点元素失联时退回像素兜底 `pendingScrollRef`
- **不递增 `reloadTick`、不播放「墨迹未干」印章**：印章语义是「外部改写了文件」，我自己提交不该闪它（落盘后 watcher 触发的回声同样被 §7.2 抑制）
- 提交中/提交后清理原块上的内联样式（`visibility`/`height`/`overflow`），避免污染复用节点

### 6.3 触发提交的动作（全部走同一路径）

点击别的块（先提交旧的、再激活新的）、`Esc`、`Ctrl+S`、`Ctrl+E` 切回阅读视图、切换到别的文档、窗口关闭、搜索结果跳转、大纲跳转。

### 6.4 取消路径

- **mdlog 变活跃**：取消当前块编辑（草稿尽力写入剪贴板后丢弃）并提示「记录已开始，编辑已取消」；同时顶栏按钮进入禁用态
- **外部变更（非我方回声）且框内无改动**：按「块序号 + 源码区间」尝试重新激活原块；定位失败则关闭编辑并提示
- **外部变更且框内有改动**：保留草稿 + 提示「文件已被外部修改」+ 两个选择（保留我的改动 / 载入磁盘版本）

> **修订（2026-09-10，Task 4）**：上一条简化为与「mdlog 变活跃」完全相同的路径 —— `notifyInterrupted`（尽力把草稿写入剪贴板 + 取消编辑 + 提示），不实现二选一横幅。理由：提交即落盘使草稿存活窗口极短，而二选一横幅需额外状态机与 UI（YAGNI）。可见 `docs/superpowers/plans/2026-09-10-vellum-block-editing.md` Task 4 Step 5。

## 7. 落盘与一致性

### 7.1 `save_document` 命令（Rust）

`save_document(path: String, content: String) -> Result<SaveOutcome, String>`

闸门（全部为拒绝条件，返回可读错误）：

1. `path` 必须等于 `AppState.current`（canonicalize 后比对）——禁止任意路径写入
2. 扩展名必须为 `.md` / `.markdown`
3. 内容 ≤ 50MB（与 `load_markdown_file` 同一上限常量）
4. **mdlog 存活则拒绝**：复用 `read_mdlog_state_from_path` 纯函数（注入 `is_pid_alive_win32`）

写入语义：

- **原子写**：同目录临时文件 `.<name>.vellum-tmp` 写入 + `fs::rename` 替换（Windows 下为 `MoveFileEx` 替换语义）；失败时 best-effort 清理临时文件
- **EOL 保真**：读取原文件检测主导换行符（`\r\n` 优先判定），把入参的 `\n` 转回该风格后再写（textarea 会把 CRLF 归一成 LF，不在 Rust 侧还原就会整篇换行符翻新）
- **BOM 保真**：BOM 是内容的一部分，随文本自然保留，不额外处理
- 返回 `{ path, bytesWritten }`（camelCase）

### 7.2 回声抑制（我方写入触发的热重载）

`file-changed` 到达时：调用既有 `load_document` 读取，把结果与**当前内存 markdown**（而非「最近一次我方写入的内容」，见 §14.4）按**归一 EOL 后**比对：

- **相等 ⇒ 自己的回声**：整体忽略 —— 不更新状态、不递增 `reloadTick`、不播放「墨迹未干」印章、不做滚动补偿
- **不等 ⇒ 外部变更**：按 §6.4 分流（未在编辑 ⇒ 静默采纳，维持现状行为）

### 7.3 保存失败

草稿**保留在 textarea 内**（不丢弃）、块内文案提示错误原因并提供重试；`dirty` 概念不存在，因此失败态只由「框内仍有未提交草稿」表达。

## 8. 与既有机制的关系

| 机制 | 编辑视图下的行为 |
|---|---|
| 搜索 | 渲染面仍在 ⇒ 高亮照旧；跳转前先提交当前块（避免高亮落在被隐藏节点内） |
| 大纲 | 标题来自 `markdown`（提交时更新）；滚动跟随（`useOutlineSync`）与点击跳转照旧，跳转前先提交 |
| 滚动记忆 | 进编辑视图前按既有三级锚点记录，退出后 `restoreScrollPosition` 恢复 |
| 跳底 / 自定义滚动条 / 侧栏拖宽 / 布局过渡窗 | 完全不改（编辑面沿用 `.document-scroll` 容器，textarea 自增高，不引入内层滚动） |
| widget iframe | 编辑期间**保持挂载**（不重建）；提交重渲染时若改动块**上方**内容变化，其后 iframe 可能因 React 索引键漂移重建一次（已知代价） |
| 热重载 | 保留；新增回声抑制与冲突分流 |
| mdlog 记录态 | 编辑门禁全关（§D6） |

## 9. 样式与设计语言

- 轻提示条（HTML 只读 / 交互块只读 / 记录中 / 保存失败）由 **App 层**统一渲染为 `.editor-toast`，2.4s 自动消失，与既有「墨迹未干」印章同一视觉语言；不放进 `MarkdownDocument`，避免把提示状态带进 memo 化的解析层
- 新区段插入 `src/styles/kami.css` 的 mdlog 区段（当前 1236 行起、首个 `.mdlog-widget` 在 1297 行）**之前**；区段内不得出现 `.mdlog-widget` 字样（`kami.css.test.ts` 从首个出现处扫到文件尾）
- 编辑面字体用既有 `--mono`（JetBrains Mono 已自托管并参与 `main.tsx` 的字体预载）
- 新增 token（编辑面底色、只读块轨线、提示条）同步写入 `DESIGN.md`，并以 `npx -p @google/design.md designmd lint DESIGN.md` 校验
- 提示条/横幅样式复用既有印章与 toast 视觉语言，不引入新组件库

## 10. 测试策略与验收标准

**单元测试（Vitest）**

- `src/lib/editUnits.test.ts`：顶层划分、list 下钻、blockquote 下钻、块级 HTML/注释/围栏判定、行内 HTML 归属可编辑块、区间排序与互不重叠、CRLF 文本、无位置信息防御、空文档
- 提交拼接纯函数：`spliceUnit`、draft 与原文相同的短路

**组件/集成测试**

- `BlockEditor`：激活后出现 textarea 且内容为该块源码；`Esc`/`Ctrl+S`/失焦提交；自增高写回原块高度；提交后内联样式清理
- `MarkdownDocument`：标记插件给块元素打上正确的 `data-vellum-unit`；**不可编辑块无编辑入口且点击只出提示**；数学块（`$$…$$` 与 ```` ```math ````）经包裹后仍可激活
- `App`：`Ctrl+E` 门禁（无文档不可进、mdlog 记录中不可进）、点击块激活、提交落盘载荷正确、回声不闪「墨迹未干」、外部变更分流、搜索/大纲跳转前提交

**Rust 测试（`cargo test`）**

- 写入成功与内容一致；CRLF 文档保真；LF 文档不引入 CRLF；超限拒绝；非 Markdown 扩展名拒绝；路径非当前文档拒绝；mdlog 存活拒绝（注入 pid 判定）；临时文件在失败路径被清理；BOM 保留

**回归基线（硬线）**

- `npm test` 全绿（当前 26 文件 / 280 用例，含 `MarkdownDocument.test.tsx` 接线级回归与 `App.test.tsx` 大纲集成）
- `cargo test` 全绿
- `npm run build`（`tsc` + `vite build`）通过，入口 chunk 不因新代码显著增长（`mdast` 已在入口 chunk，无新增依赖）

**真机复核（CDP / 手动，写入验收清单）**

- 提交重渲染后视口内容不跳动（长段落编辑场景）
- 编辑一个块后，其下方 widget iframe 不重建（块内容不变时）
- 提交耗时实测（用于自适应提示阈值 800ms 的合理性复核）
- 数学块包裹后的视觉间距与包裹前一致

## 11. 风险与已知限制

| 项 | 说明 | 处置 |
|---|---|---|
| 光标落点近似 | 行级而非字符级 | 接受；精确映射需编辑器内核 |
| 提交 = 整篇重解析 | 大文档有停顿 | 自适应软提示；复用布局过渡窗与延迟合并，避免与热重载叠加 |
| iframe 索引键漂移 | 改动块上方时其后 widget 可能重建一次 | 接受并记入文档 |
| 与 pi 会话的分叉 | 编辑后 pi 的上下文不知情，下次续写可能与已改内容重复/矛盾 | 用户已知并接受；不在本次范围 |
| 数学块包裹 | 新增加一层 DOM | 用 `display: contents` 消除布局影响 + 真机复核 |
| pi/mdlog 并发 | 记录中禁止编辑 | §D6 硬门禁 + Rust 侧二次闸门 |

## 12. 附录：块提交成本实测（PASS 1，2026-09-10）

方法：`scripts/bench-markdown-pipeline.bench.tsx`（`react-dom/server` 的 `renderToStaticMarkup`，跑**真实生产管线**：同一份 remark/rehype 配置与 components，仅跳过 DOM 节点创建；Node 与 WebView2 同为 V8，量级可比）。配套的 `scripts/bench-markdown-commit.bench.tsx`（jsdom 全量提交）作为**保守上限**对照。

| 文档 | 实测体积 / 标题数 | 单次整篇解析 mean |
|---|---|---|
| 散文 101KB | 102KB / 148 | 1.54 s |
| 散文 301KB | 304KB / 434 | 4.04 s |
| 散文 1MB | 1033KB / 1464 | 15.89 s |
| widget 重度 512KB | 518KB / 31 | 0.66 s |

### PASS 2（对照）：jsdom 全量提交上限

方法：`scripts/bench-markdown-commit.bench.tsx`，`@testing-library/react` 真实挂载+卸载整篇文档（含 DOM 节点创建与 effect）。

| 文档 | 单次整篇提交 mean | 相对 PASS 1 倍数 |
|---|---|---|
| 散文 101KB | 2.29 s | ×1.49 |
| 散文 301KB | 7.06 s | ×1.75 |
| 散文 1MB | 31.65 s | ×1.99 |
| widget 重度 512KB | 1.05 s | ×1.59 |

两条读数一致指向：

1. **大头是解析本身，DOM 提交只贡献 1.5–2 倍**（且 jsdom 的 DOM 开销远高于 WebView2/Chromium，真机倍率会更小）
2. 文档类型排序完全一致 ⇒ §12 结论 1 不是因为选了哪条测量路径才成立

### 结论

1. **成本由「块数 + 公式数」主导，而非字节数** —— widget 重度 512KB 比散文 101KB 快 2.3 倍（远端 HTML 对解析器只是单个代码块节点）
2. 基于字节的硬阈值是错的工具：会误杀用户实际要编辑的 widget 重度日志，又放过高块数散文
3. 因此 D5 采用**自适应软提示**（实测提交耗时 > 800ms 时挂出），不设硬门禁。800ms 这个值的来源：jsdom 这种悲观环境下，散文 101KB 已需 2.29s、widget 重度 512KB 需 1.05s ⇒ 真机落到「明显可感但仍可接受」的区间在数百毫秒量级，故取 800ms 作为「这篇文档确实重」的分界线；真机 CDP 复核后可调
4. **提交即整篇重解析，与现有热重载走的是同一条管线、同一笔成本** —— mdlog 记录期间每次模型追加本来就在付这笔钱，本功能并未新增一类开销

## 13. 交付顺序（供实施计划细化）

1. `editUnits` 纯函数 + 测试（无 UI 依赖，可先行）
2. 标记插件 + 数学块包裹 + `MarkdownDocument` 测试
3. `BlockEditor` 组件 + 测试
4. `useDocumentEditor` 状态机 + 门禁 + 测试
5. Rust `save_document` + 测试
6. `App` 接线 + 集成测试 + 回声抑制
7. 样式与 `DESIGN.md`
8. 全量回归 + 真机复核

## 14. 实施期修订登记（2026-09-10，Task 8 收口）

本功能的实施全程受 `.superpowers/sdd/2026-09-10-vellum-block-editing/rulings.md` 的裁定 F1–F35 约束；后者与本文冲突时以裁定为准。以下是**已交付形态与本文正文不一致**的部分（其余裁定属对计划代码的细化，不改本文口径）：

### 14.1 §6.4 「外部变更且框内有改动」二选一横幅 → 中断路径（已交付 `db001e0`）

已按 Task 4 的登记落定：不实现「保留我的改动 / 载入磁盘版本」二选一横幅，一律走与「mdlog 变活跃」完全相同的 `notifyInterrupted`（尽力把草稿写入剪贴板 + 取消编辑 + 提示）。理由：提交即落盘使草稿存活窗口极短，二选一横幅需额外状态机与 UI（YAGNI）。§6.4 正文已就地标注该修订。

### 14.2 计划步骤 5.4 「给 `kamiSchema` 追加 `data*`」**作废**（裁定 F13，已交付 `3ad0f80`）

不追加、也不新建派生 schema。理由：标记插件插在 `[rehypeSanitize, kamiSchema]` **之后**，`data-vellum-*` 根本不经过 sanitize；追加 `data*` 只会放宽**阅读视图**的白名单，直接违反「阅读视图 DOM 与改动前逐字节一致」这条绑定约束。§4 与 §5.3 的对应文字已就地作废。

### 14.3 `<pre>` 一律外包 `.vellum-unit-wrap`，标题交还标记属性（裁定 F12，已交付 `3ad0f80`）

计划的包裹规则只覆盖「会被 katex 替换的节点」（数学块），实测漏了第二类：`components.pre`（`CodeBlock` / `WidgetSandbox`）与 `components.h1/h2/h3` 是 React 覆盖渲染、**不透传 hast 属性**，不外包则代码块/widget 的 `data-vellum-unit`、`data-vellum-locked="widget"` 永远到不了 DOM。现规则：所有 `<pre>` 外包 `div.vellum-unit-wrap`（`display: contents` 退布局，见 §9 与 T7），`h1/h2/h3` 手动把两个标记属性交还给元素。

### 14.4 §7.2 回声判据改为「与内存 markdown 比对」（裁定 F30，已交付 `46ed156`）

原口径的「最近一次我方写入的内容」快照被删除：固定快照会误吞真实外部变更（外部改成 E 再改回 W ⇒ 视图永久停在 E），且在 `await save` 之后才赋值会造成提交在途竞态。现判据：磁盘内容（LF 归一）== 内存 `state.document.markdown`（LF 归一）⇒ 视为无实际变更（可能是我方回声）整体忽略；不等 ⇒ 走外部分支。§7.2 正文已就地修订。

### 14.5 就地编辑面的三处实现细化（裁定 F4 / F18 / F19 / F20 / F27，已交付 `0ab2e1c`、`1b64c53`）

- **覆盖层定位基准**是 `.document-scroll__content`（与覆盖层的 containing block 同容器矩形相减），不是 `.document-scroll` + `scrollTop`；也不使用 jsdom 下恒为 null 的 `offsetParent`
- **操作目标解析**：包裹层 `display: contents` 不生成布局盒，故隐藏/锁高/自增高/测量必须作用在「首个有布局盒的子元素」上；判定以 `classList.contains("vellum-unit-wrap")` 为首选，「高 0 且子节点自身有布局盒」为兜底
- **自增高由组件显式写高**（`onChange` 与 RO 回调都把 `textarea.scrollHeight` 写进 `height`），不依赖 textarea 自身盒高变化触发 RO——后者在真机上回调永不触发、内容会被 `overflow:hidden` 裁掉

### 14.6 提示条 2.4s 自动消失已落地（裁定 F31，已交付 `46ed156`）

`useDocumentEditor` 内 `TOAST_DURATION_MS = 2400`，每次新提示重置计时，并导出 `dismissToast()`；CSS 只负责淡入淡出、**不得**成为消失机制。与 §9 一致，此处仅登记落地。

### 14.7 其余裁定的落地位置

块单元重叠归一化 / 嵌套 HTML·widget 锁定 / 区间对齐行首 + 草稿与光标同用 LF 归一（F7–F9，`3017ac3`）；畸形围栏下的已知取舍（F17，见 §11 与验收报告「已知限制」）；Rust 侧读旧文件失败不静默降级为 LF、临时文件名唯一（F28/F29，`b700a86`）；关窗失败不得关窗、成功路径不自行 `close()`（F33，`46ed156`）；`heavyDoc` 提示本会话内粘性不回退（F26，有意为之）。

### 14.8 §10 回归基线的实测数字

§10 写的「26 文件 / 280 用例」是撰写时的旧值：本功能开始前实测 **31 文件 / 399 用例**，收口后 **31 文件 / 400 用例**（新增一条：File-changed 无变更早退），`cargo test` 收口后 **63 用例**（56 + 7）。入口 chunk 体积实测见 `AGENTS.md` 性能结构约束与验收报告。
