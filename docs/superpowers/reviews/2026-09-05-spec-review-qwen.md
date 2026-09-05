# Spec 审核报告（reviewer-qwen）

审核对象：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（309 行）
审核性质：只读核查，未修改任何实现文件（唯一写入物为本报告）
审核项覆盖：1 占位与歧义 / 2 内部一致性 / 3 技术事实核查（pi 扩展、Vellum 代码、Tauri 2 自定义协议）/ 4 范围与可实施性 / 5 性能与风格

结论：**驳回**

一句话理由：设计意图、架构切分与安全方向正确，Vellum 侧集成点引用基本准确，DESIGN.md 色板/字重/圆角与「无 emoji」全部合规；但存在 **3 项阻断级技术事实错误**（widget 分发点按现有正则永远无法命中、WebView2 下 iframe URL 形式错误、锚点 `entryId` 在 `message_end` 时刻根本不可得），任一不修正都会让功能主链路直接失效。另有 15 项「应当修复」（含与 AGENTS.md 已验证结论冲突 2 项、spec 内部自相矛盾 2 项、未定义需求 3 项）与 11 项建议。修订并满足文末「复审通过条件」后可进入实现计划。

真实测试输出（基线）：

- `npm test` → `Test Files  17 passed (17)` / `Tests  175 passed (175)`，`Duration 4.15s`，全绿。
- `cd src-tauri && cargo test` → `vellum_lib` `test result: ok. 13 passed; 0 failed`；`unittests src\main.rs` `2 passed; 0 failed`；doc-tests `0 passed`；`Finished test profile [unoptimized + debuginfo] in 2.08s`。
- 对照：spec §9 写「现有 142 用例」，AGENTS.md 写「14 测试文件，142 用例」，均已过期（见 G1）。

---

## 问题清单

### 阻断（3）

**[阻断] §4.2：`pre` 分发点按现有提取逻辑永远拿不到 `language === "vellum-widget"`**
证据：`src/components/MarkdownDocument.tsx:378` 为 `const match = /language-(\w+)/.exec(className);`；`\w` 不含连字符，`class="language-vellum-widget"` 只会捕获到 `vell`，随后按未知语言交给 `CodeBlock`（`:381`）。
后果：spec §4.2 的片段 `if (language === "vellum-widget") return <WidgetSandbox html={code} />;` 条件恒为 false——整个 widget 特性一次都不会触发，而 §4.1/§4.3/§6/§7 全部建立在这条分发上。
修法要求：spec 必须显式要求把正则改为 `language-([\w-]+)`（或按围栏 meta 分发），并说明副作用：含连字符的信息串（如 `objective-c`）之前被截断、现在整串传入 `CodeBlock`，需确认未注册语言的降级路径不变。

**[阻断] §4.1 / §4.4：Windows/WebView2 下 iframe `src` 不能写 `vellum-widget://localhost/<id>`**
证据：wry 0.55.1 只在**导航 URL**上做 `scheme://localhost → http://scheme.localhost` 改写（`~/.cargo/registry/src/index.crates.io-*/wry-0.55.1/src/webview2/mod.rs:517-523`，该调用位于 `if let Some(mut url) = attributes.url` 分支内）；实际注册的资源过滤器只有 `http://<name>.localhost/*`（同文件 `:931-947`；前缀判定见 `src/custom_protocol_workaround.rs:14-38`）；默认是 http 而非 https（`wry/src/lib.rs:1866-1870`，`with_https_scheme` 默认 false）。Tauri 计算 window origin 时用同一映射（`tauri-2.11.5/src/manager/webview.rs:245-252`：`format!("{https}://{}.localhost", window_url.scheme())`）。
后果：页内子资源（`<iframe src>`）不会得到改写，Chromium 直接拒掉未注册 scheme 的子帧加载；§4.4「三者并列」的注释给出错误心智模型，掩盖了「唯一生效的是 `http://vellum-widget.localhost`」。
修法要求：`register_widget` 由 Rust 侧按平台返回可直接加载的 URL（Windows 为 `http://vellum-widget.localhost/<id>`），前端不得自行拼 scheme；§9 增加对应加载断言（见 G9）。

**[阻断] §3.4 规则 4 / §3.5：`entryId` 在 `message_end` 处不可得，锚点机制定义不成立**
证据链：
- `MessageEndEvent` 字段只有 `{ type, message }`（`pi-coding-agent/dist/core/extensions/types.d.ts:604-606`；`docs/extensions.md:615-646` 同）。
- `message` 是 `AgentMessage`：`UserMessage`/`AssistantMessage` **无 id 字段**（`@earendil-works/pi-ai/dist/types.d.ts:302-329`）；8-char 十六进制 `id` 属于 `SessionEntryBase`（`docs/session-format.md`「Entry Base」）。
- 时序更关键：扩展事件先于持久化——`dist/core/agent-session.js:383-399` 先 `await this._emitExtensionEvent(event)`，之后才 `sessionManager.appendMessage(event.message)`；`dist/core/cache-stats.d.ts:46` 明文写「`entries` must not yet contain `message` (message_end fires before persistence)」。
后果：「锚点 = 该消息的会话条目 ID」在 `message_end` 回调里取不到；即便当场读 `getBranch()` 也会少当前这条 → §3.5 的增量判定与「重复连接幂等」失去依据。
修法要求：spec 必须改写锚点来源与时机——例如在 150ms 合并防抖的 **flush 时刻**从 `ctx.sessionManager.getLeafId()` / `getBranch()` 末项取 id（`getBranch` 返回 root-first，`dist/core/session-manager.js:958-968`），并说明 flush 前发生分支移动/fork 时的失效语义。

### 应当修复（15）

**[应当修复] §3.3：`content` 结构假设不成立（用户消息可为纯字符串）**
`UserMessage.content: string | (TextContent | ImageContent)[]`（`pi-ai/dist/types.d.ts:302-306`；`session-format.md` 示例 `{"role":"user","content":"Hello"}`）。spec 写「`content` 数组中 `type === "text"` 的项拼接」，对字符串 content 会抛错或静默丢消息。两种形态都要处理，并规定多个 text 块的拼接符（见 G8）。

**[应当修复] §3.3：`session_start` 的 reason 漏了 `"startup"`，常规启动不会恢复连接**
`event.reason ∈ {"startup","reload","new","resume","fork"}`（`docs/extensions.md:393-405`；生命周期图 `:281` 显示启动即发 `session_start { reason: "startup" }`）。spec 只列 `new/resume/fork/reload` → 字面实现在最常见的「打开 pi 就是该会话」路径上不重连（sidecar 不建、徽章不亮）。

**[应当修复] §3.5：锚点扫描规则在「最后一个锚点不合法」时产生重复回填；会话结构变化未定义**
(a) §3.4 规则 2 规定助手正文「原样透传」，模型只要复述过 `<!-- mdlog:m=xxx -->` 字样（被记录的会话里正在写 mdlog 相关代码时极常见），锚点即被劫持 → 按 §3.5 第 4 步全量回填 → 同一对话在文件中出现两份。(b) `/tree` 导航、`/fork`（条目 id 可能重建）、`session_compact` 之后锚点可能不在 `getBranch()` 里，同样触发回填。应改为「向后扫描，取第一个 `entryId ∈ getBranch()` 的锚点」，并加会话指纹（如文件头 `<!-- mdlog:s=<sessionId> -->`），把「无合法锚点但文件已含本会话内容」定义为显式确认或按内容去重，而不是静默追加；§8 需补对应行。

**[应当修复] §3.4 规则 3/4：`---` 与隐藏注释之间的空行未定义，分隔线会被解析坏**
规则 4 要求「每条消息末尾**紧跟**隐藏注释」，规则 3 要求「回合结束后写入一行 `---`」。CommonMark 下：注释行是类型 2 HTML block，延续到空行为止，`<!-- mdlog:m=… -->` 后不空行直接写 `---` 会被吞进 HTML block（渲染成字面 `---` 文本，不是发丝线）；若前一行是普通段落且不空行，`---` 会被解析为 setext H2 下划线，污染大纲。spec 必须给出逐字节级的空行约定（建议：注释行 → 空行 → `---` → 空行），并把文件头后、首条消息前的空行一并规定，否则 §11 派出的不同子智能体会写出不同结果、§9 的格式单测也无从断言。
附带事实：隐藏注释使 `RAW_HTML_RE`（`MarkdownDocument.tsx:222`）对 mdlog 文件恒为 true，`rehype-raw` 再也跳不过（`:300-303`）——AGENTS.md 记录的这项优化对 mdlog 永久失效，§6 应如实写明。

**[应当修复] §3.4/§4.5/§5 契约：写入侧对「围栏未闭合」零防御**
§3.4 规则 2 原样透传，§5 只靠提醒 AI「围栏必须合法闭合」。一次截断（`stopReason: "length"` 的长回复、用户打断）即让后续所有内容变成围栏内文本，其中的 `<!-- mdlog:m=… -->` 锚点被吞 → 触发上一条的重复回填，用户看到「整篇聊天记录塌成一个代码块」。spec 需规定写入前校验 ``` 围栏配对，不配对则补闭合（或降级为缩进代码块）并留一行可见提示。

**[应当修复] §4.5：「可配置规则」是未定义需求；图片复制缺安全与容量约束**
「可配置规则」（§3.3、§4.5）没有载体定义：配置在哪、什么格式、作用域、由谁何时读取，全部缺失——这是全文最大的一块实质 TBD。此外：(a) 无单文件/总量上限（`resolve_asset` 把本地图片转成 base64 data URL，见 `cargo test` 的 `resolve_asset_to_data_url_returns_base64_for_local_image`，内存放大数倍；`mdlog-assets/` 无清理策略）；(b) 无源路径约束——规则是「工具结果文本中的绝对路径」，任何出现在输出里的路径（例如 `C:\Users\<me>\.ssh\id.png`、内网导出物）都会被复制进长期留存的日志目录；建议限定「必须位于 `ctx.sessionManager.getCwd()` 之下 + 常规文件 + 大小上限 + 扩展名白名单二次校验，`.svg` 默认排除（外部文本入口）」；(c) §7 现有四条完全未覆盖这条链路。

**[应当修复] §4.5 + §6：回合内写入顺序（图片异步 vs 150ms 文本 flush）未定义**
§6 声明「图片复制异步化」，§4.5 又要求「该回合未引用图片则自动补一行」。事实顺序是 `message_end`（正文）→ `tool_execution_end`（图片路径）→ 下一条 `message_end`（`docs/extensions.md:292-307`），因此补写必然发生在该消息与其锚点落盘之后：要么违反 §3.4 规则 4「末尾紧跟」，要么与 `---` / 下一条消息争抢写入位置。spec 应改为回合级事务（`agent_end` / `agent_settled`（`types.d.ts:555-562`），或 flush 前等待复制完成并带超时），一次性写出「正文 + 图片行 + 锚点 + 分隔线」。同理：`session_shutdown` 时若仍有未 flush 缓冲，§8 没有一行说明「先落盘再删 sidecar」，按现写法会丢最后一条消息。

**[应当修复] §4.3：「文档切换（`load_document`）时清空」会把热重载误判为切换文档**
`reloadCurrent` 调的就是同一个命令（`src/App.tsx:135` → `src-tauri/src/main.rs:173`）。而 §6/§4.1 的核心设计是「热重载时 iframe 不重挂载」：注册表被清空后，已挂载 iframe 靠已加载文档续命，但 IntersectionObserver 的懒挂载/休眠重挂载会走「先 `register_widget` → 若与清空竞态 → URL 立即失效 → 空白框」，重挂载再次注册又是新 id，旧 id 只能等 LRU 淘汰。应改为「仅 canonical 路径变化才清空」，或按文档引入引用计数/双代保留。

**[应当修复] §4.7 / §2：sidecar「存活」定义缺失，徽章会在崩溃后长期说谎**
§2 与 §4.7 的判据是「sidecar 存在且存活」。`session_shutdown` 只在正常退出/Ctrl+C/SIGHUP/SIGTERM 时触发（`docs/extensions.md:359-361`），强杀、终端关闭、休眠、断电都会留下孤儿 sidecar；sidecar 里有 `pid`，但 spec 没说由谁、用什么方式校验 pid 存活，也没有 `lastWriteAt` 的过期阈值。需定义 stale 规则（例如 `now - lastWriteAt > 120s` → 转「已断开」静态态或隐藏），否则「记录中」成为长期假承诺。

**[应当修复] §4.6：一次性 `scrollTop = scrollHeight` 与 AGENTS.md 已验证结论冲突，且与 `pendingScrollRef` 恢复顺序未定义**
AGENTS.md 性能结构约束明确：落点会被图片/字体撑高 scrollHeight 冲掉，正解是 `restoreScrollPosition` 的 ResizeObserver 落位守护（`src/lib/scrollRestore.ts:101-160`），并禁止退回一次性比例计算（「那就是间歇性恢复失败的根因」）。§4.6 恰好是一次性赋值，在 mdlog 场景更糟：widget 懒挂载与图片 `loading="lazy"`（`MarkdownImage.tsx:64`）在赋值之后继续撑高文档，下一轮 `scrollHeight - scrollTop - clientHeight > 80` → 自动跟随几轮后静默失效。另外 `reloadCurrent` 已写 `pendingScrollRef`（`App.tsx:138`），恢复 effect 依赖 `[activeDocument?.markdown]`（`App.tsx:337-345`）：若跟随另起一个 effect 就会「先跳回旧位置、再落底」两帧跳动。spec 需规定判定与落位在同一 layout effect 内完成（贴底时跳过 `pendingScrollRef` 恢复）并复用落位守护。

**[应当修复] §4.6 / §6：热重载既有副作用在「每 ~400ms 追加」下被放大，spec 只字未提**
`reloadCurrent` 每次都 `setShowReloadNote(true)`（`App.tsx:142`）→ 印章 `stamp-press` 动画（`src/styles/kami.css:542-553`）+ `fresh-ink` 全文模糊 1s（`:508-511`），卸载计时 2.8s（`App.tsx:357`）；程序化 `scrollTop` 触发 scroll 事件 → 300ms 防抖写阅读位置（`App.tsx:313-322` → `lib/scrollMemory` → store 落盘）。即每来一条消息就钤一次印、糊一次全文、每轮写一次磁盘。§6「热重载管线沿用现状」不成立：mdlog 连接态必须抑制 reload-note、跳过 `fresh-ink`、记录期间对 scrollMemory 降频或暂停。

**[应当修复] §4.7：「防抖逻辑共用」与 watcher 现有单事件槽结构冲突**
`src-tauri/src/watcher.rs:33-66` 是**单个** `deadline: Option<Instant>`、到期只 `emit("file-changed", ())` 一次（`:62`），路径判定为严格等值（`:54`）。两类事件（日志文件 / sidecar）共用一个 deadline 会互相顶掉，或合并成一次无法区分类型的 emit。spec 要写清：按类型分路各持 deadline（并说明是否互相抑制），或「sidecar 变更不发独立事件、前端在 `file-changed` 里顺带查一次」——后者 IPC 更少（现状：§3.7 每次写入都更新 `lastWriteAt`，字面实现就是每批多一次 `read_mdlog_state` 往返）。

**[应当修复] §4.3 / §4.7 / §7：注册表与 sidecar 命令的安全契约不完整**
(a) `register_widget` 的 `id` 生成方式未定义——协议端点是纯 id 寻址、无文档归属校验，必须是不可猜的高熵随机 id；(b) handler 对 `/<id>` 之外路径、非 GET、id 不存在时的行为未定义（应 404/403，且**错误响应也必须带 CSP**——否则某条早退路径返回无 CSP 的 HTML，`http://vellum-widget.localhost` 上就出现一个无 CSP 文档，§7 第 1 条防线失效，只剩 Tauri origin 校验兜底，而这条纵深防御 spec 没写下来）。另注意 wry 的前缀判定意味着该 host 下任意路径都会进我们的 handler（`custom_protocol_workaround.rs:14-20`）。(c) `read_mdlog_state()` 参数完全未定义：若接受前端传入路径就是新的任意文件读原语；应规定以 Rust 侧 `AppState.current` 为唯一锚（对照 `src-tauri/src/main.rs:204-216` 的 `resolve_asset` 范式），并校验基名严格等于 `<当前文件>.mdlog`。(d) 512KB/64 条超限行为需与「协议不可用」区分（§4.1 的降级否则无解释）。

**[应当修复] §4.1 与 §7 自相矛盾：opaque origin 下读不到 widget 的 `<title>`**
§4.1 要求「`title` 取 widget 文档 `<title>`」，同节又规定 `sandbox="allow-scripts"` 且**不得**加 `allow-same-origin`（§7 以此为安全前提）。父文档读 `iframe.contentDocument` 为 null → 必然只能落到兜底文案。改法：标题随首次 resize 经 `postMessage` 上报（与高度同样校验 `event.source`），或从围栏 meta 取（` ```vellum-widget 标题`，但注意 §4.2 现只读 className，meta 未被提取，`MarkdownDocument.tsx:376-379`）。

**[应当修复] §7：缺少「打开任意第三方 .md 即本机执行 JS」的威胁评估与决策**
Vellum 是通用 Markdown 阅读器且注册了 `.md/.markdown` 文件关联（`src-tauri/tauri.conf.json:41-47`）。加入 `vellum-widget` 后，网上下载的一份 md 只要含该围栏，打开即在本机 WebView2 中执行任意脚本。现有沙箱确实强（无网络、无同源、无表单/弹窗/下载、opaque origin 无存储），但仍有：视觉伪装/钓鱼 UI（可仿造本应用与系统对话框外观）、DOM 内键盘事件伪造、长任务耗尽渲染进程、以及被 prompt 注入的 Agent 把恶意 widget 写进日志。spec 应显式记录该威胁并给出决策：推荐默认把 widget 渲染为占位块（§4.1 已有「点击查看重新挂载」的占位样式可复用），按文档授权后才挂载；或至少限定「仅含 `<!-- mdlog:v1 -->` 头的文件允许执行 widget」。当前 §4.1 把「自动懒挂载」写成了无条件行为。

### 建议（11）

**[建议] §9：测试基线与风格校验口径需更新。** 实测 17 文件 / 175 用例（不是 14/142）。`designmd lint DESIGN.md` 在「DESIGN.md 不改」前提下是恒通过的无效校验，验证不到新增 CSS 是否只用既有 token；项目已有 `src/styles/kami.css.test.ts`，应改为对该文件断言「仅使用 `:root` 已声明变量 / 圆角 ∈ {2,3,4,6}px / 无 `font-weight` > 500 / 无新增色值」。

**[建议] §10 改动清单不完整。** 至少漏：`src/test/setup.ts`（现只 mock `ResizeObserver`，`:3-10`，§9 要 mock `IntersectionObserver`）、`src-tauri/src/lib.rs`（模块声明，`:1-4`）、`src-tauri/Cargo.toml`（若 id 生成引入随机依赖）、以及 sidecar 解析的代码归属（`document.rs` 还是 `widget.rs`，§4.7 未指文件）。

**[建议] §5.2 字体栈与实现不一致。** `src/styles/kami.css:42-43` 的 `--serif` 含 `"Songti SC","STSong",Charter,Georgia,Palatino`，`--mono` 末尾**特意**追加 `"TsangerJinKai02","Source Han Serif SC"` 以兜中文。spec 的子集栈（尤其 `"JetBrains Mono",monospace` 配中文标签「沙箱中运行」「交互 · vellum-widget」）会让中文落到浏览器默认等宽。沙箱内拿不到应用字体是真实约束，但 spec 应写明「widget 内 CJK 落到衬线回退」并给完整栈；另注意本项目靛青变量名是 `--brand`，不是 `--primary`。

**[建议] §4.1 样式描述歧义。** 「mono 10px 大写字距 1.2px」未说明是否施加 `text-transform: uppercase`（对 CJK 无效、会把 `vellum-widget` 变全大写）；现成惯例是 `.code-block` 头部 11px 大写等宽语言标签（DESIGN.md「Components」），建议直接对齐并写死结论。

**[建议] §6「React key 稳定」表述不准。** `pre` 渲染器返回的元素没有显式 key（`MarkdownDocument.tsx:381` 同位置），实际依赖「位置稳定的隐式匹配」。append-only 时成立；一旦发生早期消息修改/插入（§4.5 补写、用户手工编辑日志），后续 widget 整体移位重挂载、交互状态全丢。建议 spec 直接要求 `key` 取 `entryId`/消息序号。

**[建议] §3.2 决策表与 §3.8：「系统关联程序」被等同于「Vellum」。** `cmd /c start` 取决于用户默认应用（常被改成编辑器）。Vellum 启动时会注册关联（`main.rs:257` `register_markdown_association`），但 spec 应补「唤起失败或唤起者非 Vellum 时的提示/回退」。

**[建议] §3.2 命令解析规则未定义。** `handler(args, ctx)` 的 `args` 是整行剩余字符串（`docs/extensions.md:1532-1555`）：含空格路径（`/mdlog C:\My Docs\a.md`）如何与 `--full/--append/--no-open` 分离、尾部空白、`off`/`status` 与真实文件名冲突均未规定；同名命令会被 pi 加 `/mdlog:1` 后缀（`extensions.md:1527-1529`）也应提示；`status` 的输出格式未定义。

**[建议] §3.4 规则 5 的时间源未指定。** 消息有两个时间：`message.timestamp`（Unix ms）与 `entry.timestamp`（ISO 字符串）。跨天判定必须基于被记录消息自身时间，否则回填与实时写入会得出不一致标签；多个 text 块的拼接分隔符同样需规定（建议 `\n\n`）。

**[建议] §9 缺沙箱/CSP 的可验证手段。** dev 走 `devUrl: http://localhost:1420`（`tauri.conf.json:8`），CSP 生效路径与打包后不同。spec 应注明「CSP 断网与同源隔离只能在 release 构建验证」，并给清单：widget 内 `fetch`/`XMLHttpRequest`/`new Image(远程)` 全部失败；`localStorage`/`indexedDB`/`document.cookie` 抛 SecurityError；`window.open`、表单提交、下载被拦；父文档读 `contentDocument` 为 null。§9 现有条目测不到 §7 的任何一条主张。

**[建议] §5.2 块契约应补 opaque origin 禁止项。** 无 `allow-same-origin` 时 `localStorage`/`sessionStorage`/`indexedDB`/`document.cookie` 均抛 SecurityError；模板与契约需明令「状态只放内存变量」，否则最常见的 widget 一上来就白屏。

**[建议] §4.6/§6 未说明大纲在实时追加下的行为。** AGENTS.md 规定「大纲对正文滚动恒跟随（含程序化滚动）」，而每轮新增标题会改变 `headings` 与激活项（`App.tsx:380` `useOutlineSync`）。建议写明预期（跟随到新增标题 / 保持当前项），否则与 §4.6 互相拉扯；另外 §8 应补两行：「自动断开（连续 3 次写入失败）后 sidecar 是否删除、如何恢复」「widget 数量/体积超限时的用户可见反馈」。

---

## 逐项审核结论

1. **占位与歧义**：不通过。无 TBD/TODO 字样（已 grep），但存在三处实质未定义需求：§4.5「可配置规则」（载体与格式全无）、§4.7 sidecar「存活」判定、§3.2 命令参数解析；另有 §3.4 空行约定、§3.4 时间源、§4.1「大写」等 6 处两解表述。
2. **内部一致性**：不通过。§4.1「读 widget `<title>`」⇄ §7 无 `allow-same-origin`（S14）；§4.3「文档切换清空」⇄ §6「热重载不重挂载」（S8）；§4.5「异步复制 + 补在消息后」⇄ §3.4 规则 4「末尾紧跟锚点」（S7）；§4.2 分发假设 ⇄ 实际正则（B1）。§1「非目标：深色模式」与 §4.4 CSP 追加不冲突（此项一致）。
3. **安全模型（§7）**：方向正确且多数主张成立（sandbox 组合、widget CSP 断网、sanitize 规则不变、`resolve_asset` 目录锚定不变、capabilities 无需新增均已核实），但不完整：新命令锚定与 id 熵、错误响应 CSP、图片复制路径/容量、以及「任意 md 即执行 JS」的授权决策缺失（S13、S6、S15）。除 B2（URL 写错导致不可加载）与 S13(b)（handler 未定义路径行为）外，未发现其他直接绕过口。
4. **范围与可实施性**：暂不能直接支撑实现计划。B1/B2/B3 必须改文本；错误恢复（写入失败自动断开后的状态、flush 与 shutdown 竞态）、会话更换（`/new`、`/resume`、`/fork`、`/tree`、崩溃残留）四类行为缺决策。
5. **性能与风格**：§6 的 memo / 懒挂载 / 上限 10 / LRU 64 / clamp / rAF 六条自洽且与代码事实相容；但「热重载管线沿用现状」不成立（S11）、一次性底部跟随违反 AGENTS.md（S10）、2MB 阈值只算文本不算图片 base64（S6）。风格：spec 全文无 emoji（仅 `→ ▼ ├` 制表符号，已 perl 扫描 U+1F000–U+1FAFF / U+2190–U+2BFF 确认）；DESIGN.md 引用色值逐项正确（`#f5f4ed/#faf9f5/#141413/#6b6a64/#1B365D/#dddacc`）、6px 圆角 = `rounded.lg`、inset 1px = 「发丝描边」、无 700+ 字重、无新增色值；`prefers-reduced-motion` 有交代（注意项目里该豁免是按选择器写的：`kami.css:575-579`、`:609-615`、`:1136-1140`，新动画必须自行加入豁免）。

## 已核实事实

**pi 扩展机制（`@earendil-works/pi-coding-agent` v0.85.0）**
- `pi.on("message_end")` 存在，事件 `{ type, message: AgentMessage }`，无 entry id：`docs/extensions.md:615-646`；`dist/core/extensions/types.d.ts:604-606`。
- 持久化晚于扩展事件：`dist/core/agent-session.js:383-399`；文字确认 `dist/core/cache-stats.d.ts:46`。
- `message_end` 对 user/assistant/**toolResult** 均触发：`docs/extensions.md:619`。
- `UserMessage.content` 可为 string：`pi-ai/dist/types.d.ts:302-306`；`AssistantMessage` 无 id：`:307-329`；条目 `id`/`parentId` 在 `SessionEntryBase`：`docs/session-format.md`。
- `tool_execution_end` 存在，`{ toolCallId, toolName, args, result, isError }`：`docs/extensions.md:651-675`、`types.d.ts:623+`；与 `toolResult` 消息事件的相对顺序：`extensions.md:657-661`。
- `session_start` 五值 reason 与 `previousSessionFile`：`docs/extensions.md:393-405`；`session_shutdown` 触发时机：`:516-523`、`:359-361`。
- `pi.registerCommand(name,{description,handler(args,ctx),getArgumentCompletions})` 存在，`args` 为整行剩余字符串，同名命令加 `/cmd:1` 后缀：`docs/extensions.md:1525-1560`、`:1527-1529`。
- `pi.appendEntry(customType,data?)` 存在，写 `custom` 条目、不进 LLM 上下文，恢复范式为遍历 entries：`docs/extensions.md:1471-1489`；`session-format.md`「CustomEntry」。
- `ctx.sessionManager.getBranch(fromId?) → SessionEntry[]` 存在且 root-first：`docs/extensions.md:1008`、`dist/core/session-manager.d.ts:262`、`dist/core/session-manager.js:958-968`；`getLeafId/getEntry/getSessionId/getSessionFile/getEntries` 均在扩展可见的只读白名单内（`session-manager.d.ts:140`）。
- 全局扩展目录 `~/.pi/agent/extensions/<dir>/index.ts` 受支持，`node:*` 内置模块与类型包可用：`docs/extensions.md:7`、`:117-120`、`:138-149`。
- 非交互 e2e 可用 `pi -p` / `--mode json`（`docs/usage.md:174-175`）；`pi -e` 仅快速测试（`:7`）——注意全局扩展与 `-e` 会同时加载，出现两个 mdlog 实例重复写入，测试脚本需隔离配置目录。

**Vellum 代码**
- `pre` 渲染器实际位于 `src/components/MarkdownDocument.tsx:356-383`（spec「约 356-381 行」准确）；正则 `:378`；`extractText(...).replace(/\n$/,"")` `:380`；`CodeBlock` 返回 `:381`。
- 搜索高亮跳过 `pre`/`code`（`:94` `SEARCH_SKIP_TAGS`）→ widget 的 HTML 文本不会被 `<mark>` 拆开，§4.2「从 code 直取文本」安全可行。
- `kamiSchema`（`:162-196`）对全元素放行 `className` → `language-vellum-widget` 类可存活；schema 不含 `iframe` → §4.2「普通 Markdown 里的原始 HTML iframe 仍被剥掉」成立。
- `RAW_HTML_RE` `:222` + `hasRawHtml` `:300`：含注释或 widget 的 mdlog 文档必走 `rehype-raw`。
- `MarkdownImage`：`memo` + `loading="lazy"`（`src/components/MarkdownImage.tsx:14-65`），远程/`data:` 直用，其余走 `resolve_asset` → §4.5「Vellum 渲染侧零改动」成立。
- `resolve_asset` 以 Rust 侧 `AppState.current` 父目录为唯一锚（`src-tauri/src/main.rs:204-216`），并有越界/百分号编码/绝对路径三类拒绝（`document_tests` 的 `resolve_local_asset_path_rejects_*`）→ §4.5「必须复制」推理正确。
- `reloadCurrent`（`src/App.tsx:130-146`）：`invoke("load_document")` → `pendingScrollRef = container.scrollTop`（`:138`）→ `setShowReloadNote(true)`（`:142`）；恢复 effect `:337-345`；`.document-content` 即 `documentContentRef`（`:439`）；滚动 300ms 防抖写 scrollMemory（`:313-322`）；`handleContentRendered` 对同路径直接 return（`:272`）→ §4.6/§4.7 需要新挂点，spec 未指定。
- `load_document` 每次调用都 drop 并重建 watcher（`main.rs:183-195`）→ 实时追加下每 400ms 重建 notify。
- watcher：监听**父目录** NonRecursive（兼容 rename 原子保存），严格等值匹配，单 deadline 合并，到期 `emit("file-changed", ())`（`src-tauri/src/watcher.rs:19-66`；`DEBOUNCE = 400ms` `:9`）→ sidecar 匹配无需新增 watch（spec 正确），但单事件槽是 S12 的根因。
- CSP 现状与 spec §4.4 引用**逐字一致**：`src-tauri/tauri.conf.json:26`；`img-src 'self' data: https: http:` 已放行 data URL 与远程图（与「非目标：远程图片沙箱化」相容）；无 `frame-src`（`default-src 'self'` 会拦子帧）→ spec 追加 frame 来源是必要的。
- capabilities 仅 `core:default` + 插件默认集（`src-tauri/capabilities/default.json`）；应用自定义 `#[tauri::command]` 不经 capability 门禁，且现有代码已成功 `listen("file-changed"/"pending-open-paths")` → §4.4「无需新增权限」成立。
- 设计 token：`--parchment/--ivory/--warm-sand/--near-black/--dark-warm/--olive/--stone/--brand/--border/--border-soft/--hairline` 与 `--serif/--mono` 定义于 `src/styles/kami.css:25-43`；`fresh-ink` 1s（`:508-511`）、`stamp-press` 2.8s（`:542-553`）→ 徽章 1.6s 环境循环与既有先例相容。
- `src/test/setup.ts:3-10` 只 mock `ResizeObserver`（无 `IntersectionObserver`）。
- `docs/preview/mdlog-preview.html`、`docs/preview/fourier-ink.png` 确已存在（§10 标注属实）。
- 基线：`npm test` 17 文件 / 175 用例全绿；`cargo test` 13 + 2 全绿。

**Tauri 2 自定义协议（tauri 2.11.5 / wry 0.55.1 / tauri-utils 2.9.3）**
- `Builder::register_uri_scheme_protocol` 存在：`tauri-2.11.5/src/app.rs:2130`（示例 `:2103`）；插件侧同名 `src/plugin.rs:635`；注册链路 `src/manager/webview.rs:104`、`:235`。
- Windows 上自定义协议的实际 URL 是 `http://<scheme>.localhost/...`，`https` 需显式开启（`wry/src/lib.rs:1866-1870` 默认 false；`tauri/src/manager/webview.rs:245-252`）。
- wry 的 `scheme://localhost → http://scheme.localhost` 改写只作用于导航 URL（`wry/src/webview2/mod.rs:517-523`）；过滤器注册 `:931-947`；回传 Rust handler 前 revert 为 `scheme://…`（`:1094`）→ **Rust 侧 `request.uri()` 看到 `vellum-widget://localhost/<id>`，而 JS 侧必须写 `http://vellum-widget.localhost/<id>`**。
- `is_work_around_uri` 仅做前缀匹配（`custom_protocol_workaround.rs:14-20`）→ `http://vellum-widget.localhost/` 下任意路径都会进 handler（S13(b)）。
- 高版本 WebView2 走 `AddWebResourceRequestedFilterWithRequestSourceKinds(..., KINDS_ALL)`（`webview2/mod.rs:940-945`），wry 注释说明这是为让 **iframe / Shared Worker** 支持自定义协议——但前提仍是使用 `http://<scheme>.localhost` 形式（即 iframe 方案可行，spec 的 scheme 写法不可行）。
- `tauri-utils/src/config.rs:2741`、`:2756` 的 CSP 示例（`connect-src ipc: http://ipc.localhost`）印证：Windows 上 Tauri 各协议在 CSP 里一律以 `http://x.localhost` 出现 → spec 的「三值并列」写法可运行，但理由陈述错误（B2）。

## 复审通过条件

1. 修正 B1/B2/B3 三处，并给出可直接实现的确切文本（正则、URL 生成方、锚点 id 的来源与获取时刻）。
2. §3.4 给出逐字节级空行/分隔约定；补围栏平衡校验与图片行的写入位置（回合级事务）；补会话指纹与「无合法锚点但已有本会话内容」的行为。
3. §7 补：新命令参数与目录锚定、id 熵、错误响应必须带 CSP、图片复制的路径/大小/白名单约束，以及「打开任意 md 即执行 JS」的授权决策（默认占位、按文档开启）。
4. §4.3 改为「仅路径变化才清空」；§4.6 改为带落位守护的跟随并与 `pendingScrollRef` 在同一 effect 内仲裁；§4.6/§6 补热重载副作用抑制与 scrollMemory 降频。
5. §4.5 的「可配置规则」给出配置载体与格式；§4.7 给出 sidecar「存活」判定、stale 视觉态与 watcher 双路防抖的确切方案。
6. §9/§10 更新测试基线数字，补 `src/test/setup.ts`、`src-tauri/src/lib.rs`、`Cargo.toml`、sidecar 解析归属，以及 release 构建下的 CSP/sandbox 验证清单与 kami.css token 审查方案。
