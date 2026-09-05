# Spec 复审报告（reviewer-qwen，v2）

- 复审对象：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（v2，662 行）
- 参考：初审 `2026-09-05-spec-review-qwen.md`、并行审核 `2026-09-05-spec-review-gemini.md`、修订说明 `2026-09-05-spec-revision-log.md`
- 审核性质：只读复审。未修改任何文件或代码（唯一写入物为本报告）；bash 仅用于 `npm test` / `cargo test` 与只读检索。
- 缩写：`spec` = 复审对象；`初审` = 我的初审报告。

结论：**驳回（定点修订即可，非结构性返工）**

一句话理由：v2 对初审 3 项阻断的修法本身**技术上全部正确**（B1 正则、B2 URL、B3 锚点时序均已逐条核实，见「阻断项复核」），初审 15 项应当修复有 13 项已实质闭环；但 **sidecar 存活判定（Gemini 阻断 4 / 初审 S9）的修法只闭合了一半**——判定逻辑写清了，触发时机与心跳写入方全部缺失，崩溃后徽章依旧永久常驻（唯一新阻断）；另有 11 项「应当修复」级别的**新引入或未消除**问题，集中在 §4.2 受信判定的闭包陈旧（安全门禁可被绕过）、§3.4/§3.5 字节级拼接与尾向扫描仍有两解、§4.5 图片规则内部冲突、§4.3 状态归属在 Rust 侧不可编译、§9.2 token 断言与 §4.7/DESIGN.md 自相矛盾。上述任一都不需要重新设计，但都会让按字面实现的子智能体产出错误行为。修订量估计 12–18 段文字。

真实测试输出（本次复审现场运行，非引用）：

- `npm test` → `Test Files 17 passed (17)` / `Tests 175 passed (175)`，`Duration 4.16s`，全绿。
- `cd src-tauri && cargo test` → `vellum_lib` `test result: ok. 13 passed; 0 failed`；`unittests src\main.rs` `test result: ok. 2 passed; 0 failed`；`Doc-tests vellum_lib` `0 passed`。
- spec §9.1（第 522-525 行）所写基线 17/175 与 15（13+2）**与实测一致**，初审 G1 指出的过期数字已改正 ✓。
- v2 未改动任何代码文件（初审基线未破坏），`git status` 层面 spec/preview 之外的实现文件与初审时一致。

---

## 阻断项复核

### B1 正则 `/language-([\w-]+)/` —— **已修复，写法与副作用说明均准确**

- spec:296-319（§4.2 第 1、2 点）要求把 `MarkdownDocument.tsx` 的提取正则改为 `/language-([\w-]+)/`，并给出副作用评估。
- 现状核对：`src/components/MarkdownDocument.tsx:378` 确为 `/language-(\w+)/`，`:381` 把 `language` 交给 `CodeBlock`。改后 `class="language-vellum-widget"` → 捕获 `vellum-widget` ✓。
- 副作用主张核对：spec 称「含连字符语言此前被截断（`objective-c`→`objective`），修正后整串传入，未注册语言安全降级为无高亮」——实测成立：
  - `src/components/CodeBlock.tsx:8-51` 仅注册 20 种语言，**注册名全部不含连字符**，故新行为不会把某语言从「能高亮」变成「不能」；
  - `CodeBlock.tsx:61-74` 的 `LANGUAGE_ALIASES` 同样无连字符键；`resolveHighlightLanguage`（`:76-80`）原样透传未知值；
  - 底层降级已核实：`node_modules/react-syntax-highlighter/dist/esm/highlight.js:259` 用 `checkForListedLanguage(astGenerator, language)` 判断，未列出即走纯文本渲染，不抛错（`checkForListedLanguage.js:1-4`）。
  - 附带事实：现状本来就会把 `objective`（未注册）传下去，因此「未注册语言」路径今天已被踩过，回归风险为零。
- 残留问题不在 B1 本身，而在 B1 引出的分发判定式（见新发现 Y1）。

### B2 协议 URL / CSP / handler 截 id —— **已修复，与 wry/tauri 实际行为一致；但由此产生 3 个新的未定义点**

逐条核实（`~/.cargo/registry/src/index.crates.io-*/wry-0.55.1`、`tauri-2.11.5`）：

1. **iframe `src` 必须是 `http://vellum-widget.localhost/<id>`** ✓。
   - 过滤器注册为 `http://<scheme>.*`（`wry/src/webview2/mod.rs:931-947`：`work_around_uri_prefix` + `format!("{work_around_uri}*")`）；
   - `apply_uri_work_around` 只在 `if let Some(mut url) = attributes.url` 的**导航**分支内（同文件 `:516-528`），页内子资源不会被改写 → 前端写 `vellum-widget://` 必失败，spec §4.1:260-262 让 Rust 侧返回真实可加载 URL 且「严禁前端自行拼装 scheme」是正确的。
   - `tauri-2.11.5/src/app.rs:2113-2118` 官方文档注释原文：`Windows and Android: http://<scheme_name>.localhost/<path> by default`，与 spec 表述一致。
2. **CSP 只列 `http://vellum-widget.localhost`** ✓。spec §4.4:350-360 的字符串与现状 `src-tauri/tauri.conf.json:26` 逐项对比后**只新增 `frame-src`，未丢失任何既有 directive**（现状本就没有 `connect-src`，Tauri 会自行注入 IPC 所需来源，故此改动不会打断 `invoke`）✓。初审要求的「删除三值并列的错误心智模型」已落实。
3. **Rust handler 从 revert 后的 URI 末段截 id** ✓ 可实现。
   - `wry/src/webview2/mod.rs:1094-1100`：交给用户 handler 前 `revert_uri_work_around` 把 `http://vellum-widget.` 换回 `vellum-widget://`，故 `request.uri()` 为 `vellum-widget://localhost/<id>`，`uri().path()` = `/<id>`；
   - `tauri-2.11.5/src/app.rs:2103-2120` 的官方示例正是 `request.uri().path()[1..]`（"skip leading `/`"），修订说明 §三.1 担心的「误把 `//localhost` 当路径首段」不成立，但 spec 写成「截取末尾路径段」是安全且更严格（可挡 `/a/b`）✓。
4. **新发现的运行前提未记录**：拦截依赖 `ICoreWebView2_22`（`wry/src/webview2/mod.rs:936-947` 注释明确说明用新 API 是为了「让 iframes 与 Shared Worker 支持自定义协议」，旧 API 为回退）→ WebView2 Runtime 过旧的机器上，iframe 请求可能不进过滤器而走真实网络（`vellum-widget.localhost` DNS 失败 → 空白框）。见 Y11。
5. **B2 修法带出的两个契约缺口**：`register_widget` 只返回 URL，而 `unregister_widget` 需要 id（见 Y3）；响应头清单缺 `Content-Type`（见 Y2）。

### B3 锚点获取时序 —— **机制正确、可编译；但仍有 2 类「拿错/说不清」的场景**

- spec:192-198（§3.5「锚点获取时机」）改为「150ms flush 时刻从 `getBranch()` 尾向用 `entry.message === bufferedMessage` 取 `entry.id`，比对不到降级 `getLeafId()`」。核实为**成立**：
  - `pi-coding-agent/dist/core/agent-session.js:383-399`：`await this._emitExtensionEvent(event)` **在前**，`sessionManager.appendMessage(event.message)` **在后** → `message_end` 内确实拿不到条目；
  - `dist/core/session-manager.js:781-790`：`appendMessage` 构造 `{ type:"message", id: generateId(...), message }`，**message 按引用存入**，不做 clone/序列化 → 尾向引用比对是唯一且正确的定位手段 ✓；
  - `generateId` = `randomUUID().slice(0, 8)`（`session-manager.js:23`）→ 恒为小写十六进制，与 §3.5:199 的扫描正则 `([a-f0-9]+)` **格式一致** ✓（初审未逐字核对，本次补确）。
- **仍存在的场景 1（降级语义不可判定）**：`getLeafId()` 在 flush 时刻可能指向比「本批最后一条已写消息」**更晚**的条目（toolResult / 其他扩展的 custom 条目 / compaction），按 §3.5 第 3 步「把该 entryId 之后的新消息作为增量」的语义，两者之间未被记录过的 user/assistant 条目会被**永久跳过**（静默丢消息）；反之若降级返回 `null`，写出的 `<!-- mdlog:m=null -->` 不匹配 `[a-f0-9]+` → 扫描继续回退 → **重复回填**。spec 必须规定降级时的取舍方向（建议：宁写「本批最后一条已成功按引用命中的 id」，全批都比对不到时**整批不写锚点并在 sidecar 记 `anchorLost: true`**，§3.5 检测到即退化为 4a 询问路径），当前文字无法直接支撑实现。归入 Y6。
- **仍存在的场景 2（伪锚点）**：§3.4 规则 3 助手正文「原样透传」，被记录会话只要复述过一行真实的历史 id（本项目正在写 mdlog，极易发生），§3.5 的尾向扫描会**在围栏内命中它**并把它当作合法锚点（该 id 确实在 branch 中，成员检查通过）→ 该 id 之后的内容被重复回填。v2 只加了「首个 ∈ branch 的锚点」与指纹询问，**没有排除代码围栏内的伪锚点**。由于 §3.4 规则 4 保证写出的文件围栏必定配平，修法很廉：尾向扫描时同步维护围栏奇偶，落在「围栏打开」区域内的锚点行一律忽略。归入 Y6。
- 另：spec:33、:118、:374 把 `agent_settled` 与「150ms 合并防抖 flush」写成「或」的关系，二者触发同一事务时的幂等/去重未定义（见 Y5-c）。

### 图片规则（Gemini 阻断 3）—— **部分闭环：斜杠/大小写/cwd/白名单/载体已补，但存在内部冲突与 2 个致命未定义**

已落实 ✓：全部工具（含 `bash`）扫描（spec:363-365）、相对路径 `path.resolve`（:366）、扩展名白名单且默认排除 `.svg`（:365）、20MB 上限与占位提示（:368）、cwd 限定（:367、:503）、正反斜杠归一化重写（:371）、config.json 载体与格式（:376-383）。Vellum 渲染侧「零改动」的主张也已复核成立：`src-tauri/src/document.rs:103-137` 的 `resolve_local_asset_path` 允许**子目录**（仅要求 canonical 后 `starts_with(anchor_dir)`），故 `mdlog-assets/x.png` 可解析；`document.rs:53-61` 的 50MB 资产上限 > 20MB，不误伤。

未闭环，见新发现 Y7（默认「全部工具」与示例 `toolNames: ["bash","generate_image"]` 直接冲突；无路径提取样式；无「本回合新建/修改」时间窗过滤 → `ls`/`grep`/`read`/`git status` 输出里提到的既有图片会被复制进日志；文件名含空格/非 ASCII 时重写出的目标链接不被 CommonMark 解析；`ctx.cwd` 与 `sessionManager.getCwd()` 混用且两者可不一致）。

### sidecar 存活（Gemini 阻断 4）—— **未修复（新阻断）**

spec:348 与 :403-417 只写清了「**问谁**」（`read_mdlog_state`：`OpenProcess` + `now - lastWriteAt <= 120s`），没有写清「**谁在什么时候问**」与「**心跳由谁发**」。详见下一条 Z1。

---

## 应当修复项复核（对照初审「复审通过条件」6 条）

| # | 初审通过条件 | 判定 | 证据与缺口 |
|---|---|---|---|
| 1 | 修正 B1/B2/B3，给出可直接实现的确切文本（正则、URL 生成方、锚点来源与时刻） | **通过** | B1 §4.2:296-319；B2 §4.1:260-262 + §4.3:330-346 + §4.4:350-356；B3 §3.5:192-198。三处文字均为可照抄的确切规范，技术事实全部核实为真（见上）。 |
| 2 | §3.4 逐字节空行/分隔约定；围栏补齐与图片行写入位置（回合事务）；会话指纹与「无合法锚点但已有本会话内容」行为 | **不通过** | 模板与红线俱在（§3.4:182-188、§4.5:374、§3.5:203-209），但仍是「两解文本」：`写入 \n<!-- … -->\n\n`（:183/:187）在正文不以 `\n` 结尾时**不产生空行**，与 :188 红线冲突；规则 2 与规则 6 对同一条锚点各写一次（用户消息会被写出两遍）；示例模板 :160 的 ``助手部分内容```ts`` 本身违反规则 4。→ Y5、Y6。 |
| 3 | §7 补：新命令锚定与 id 熵、错误响应必带 CSP、图片路径/大小/白名单、「打开任意 md 即执行 JS」授权决策 | **部分通过** | id 熵（§4.3:340）、无参命令锚定（:348 + §7.1:488）、错误响应带 CSP（:333-337）、图片约束（§7.3）均已写入 ✓；但 §7.1:484-486 的「绝对断网」主张不成立（子帧可自行导航，见 Y4），且 §7.2 的「受信门禁」判据是**可被文件内容伪造的字符串**（:497-499，见 Y11-b），两条都需要如实改写。 |
| 4 | §4.3 改为「仅路径变化才清空」；§4.6 带落位守护 + 与 `pendingScrollRef` 同 effect 仲裁；§4.6/§6 补副作用抑制与 scrollMemory 降频 | **通过（附 1 处文字订正）** | §4.3:343 ✓；§4.6:388-395 ✓（且技术上可复用：`src/lib/scrollRestore.ts:107-160` 传 `{ratio:1}` 且无 anchorId 时 `computeTarget` 落到 `max` = 底部，`ResizeObserver` 会持续重锚，满足「贴底守护」）；§4.6:396-400 三项抑制与 §6:473 ✓。scrollMemory 的「关窗丢位」担忧被现有兜底覆盖：`src/App.tsx:323` `beforeunload → persistCurrentScroll()`。残留：:393 写「用户主动滚动、**点击**或 5 秒超时」，而实现（`scrollRestore.ts:145-152`）只监听 `wheel/touchstart/keydown`，**无 click**；照文字实现要么改公共函数（影响既有恢复行为与测试），要么写出不存在的解除条件 → Y9-c。 |
| 5 | §4.5 配置载体与格式；§4.7 sidecar「存活」判定、stale 视觉态、watcher 双路防抖的确切方案 | **不通过** | 配置载体 ✓；双路防抖 ✓（§4.7:405-409，结构上可实现：现 `src-tauri/src/watcher.rs:33-66` 单 `deadline`，改为两路取 `recv_timeout` 的 min 即可，且 `:54` 的严格等值匹配天然区分 `.md` 与 `.md.mdlog`，父目录 NonRecursive 监听已覆盖 sidecar，无需新增 watch）；**sidecar 存活判定不完整 → Z1（阻断）**。 |
| 6 | §9/§10 更新基线数字，补 setup.ts / lib.rs / Cargo.toml / sidecar 归属，补 release CSP 清单与 kami token 审查方案 | **部分通过** | 数字 ✓（实测一致）；§10:569-593 清单已补 `src/test/setup.ts`、`src-tauri/src/lib.rs`、`Cargo.toml`、`widgetRegistry.ts` ✓（初审建议 2 全采纳）；`windows-sys 0.61` **已在 `src-tauri/Cargo.toml:26-31` 且已含 `Win32_Foundation` + `Win32_System_Threading`**，`OpenProcess` 无需新增依赖（spec 未写但也不需要）✓。缺口：§9.3 清单**只有负向隔离用例，没有一条正向「widget 能加载渲染」**（Y11）；§9.2:537-540 的 token 断言与既有文件、与 §4.7 徽章设计直接矛盾（Y10）。 |

**初审 15 项 S 的处置核对（抽查）**：S1 ✓（§3.3:110）、S2 ✓（:104 五 reason 全覆盖）、S3 ◐（指纹+询问已加，伪锚点与降级方向仍缺 → Y6）、S4 ✓ 字节规范 + §6:479 如实记录 rehype-raw 代价、S5 ✓ 但扫描算法未定义（Y5-b）、S6 ◐（载体/大小/白名单 ✓，工具范围与文件名规范化 ✗ → Y7）、S7 ✓ 但 await 位置会阻塞 pi 事件链（Y5-c）、S8 ✓（:343）、S9 ✗（→ Z1）、S10 ✓（:388-395，含 Y9-c 订正）、S11 ✓（:396-400）、S12 ✓（:405-409）、S13 ✓（:340-348，含 Y2/Y8 缺口）、S14 ✓（:266-270 已删 `contentDocument.title`，改 postMessage + `event.source` 校验）、S15 ◐（门禁已立，但判据可伪造且实现有陈旧闭包 → Y1/Y11-b）。

---

## 新发现问题

> 编号沿用 Y（应当修复）/ Z（阻断）/ P（建议）。行号均为 spec v2 行号。

### [阻断] Z1 §4.3:348 + §4.7:411 + §3.7:234 —— sidecar 存活判定缺「心跳写入方」与「复查调度器」，崩溃后徽章仍永久常驻（Gemini 阻断 4 未真正闭环）

- **判据无复查触发**。§4.7:411 规定前端只在「文档初次加载后」和收到 `mdlog-state-changed` 时调用 `read_mdlog_state`。而 pi 崩溃/强退后**不再产生任何文件事件** → `mdlog-state-changed` 永不到达 → 没有任何代码路径去重新求值 `now - lastWriteAt > 120s`。结果：徽章按 §4.3 的正确判据被算成「死」，但**没有人再去算第二次**，UI 与 §8:514「超限则静默隐藏徽章」在真实崩溃场景下依然不成立。这正是初审 S9 / Gemini 阻断 4 的原始症候，修法只补了「怎么判」，没补「什么时候判」。
  → 必须写明：`read_mdlog_state` 返回结果时附带 `expiresAt = lastWriteAt + 120_000`，前端 `useEffect` 用 `setTimeout` 在该时刻自动复查（并在 `read` 失败/`None` 时解除计时器），或明确「每 15s 轮询直至徽章卸载」。
- **`lastWriteAt` 不是心跳**。§3.7:234 只在「回合内容成功写入日志文件后」更新它，§4.3:348 却按「120s 心跳超时」判活。长回合（一次 `npm run build`、一次子智能体长时间跑工具、或用户只是读完一条回复后停顿 2 分钟）在 pi 会话中极为常见，此时**进程活着、连接正常**，却被判为失效 → 徽章静默消失，且因上一条缺复查，它会一直错到下一次写入才闪回。
  → 必须二选一并写进 §3.7：(a) 扩展侧在连接期间用 `setInterval` 每 30s 刷新 sidecar（真正的 `heartbeatAt`，与 `lastWriteAt` 分字段）；(b) 把阈值提高到 ≥ 300s 并把字段语义改名为 `lastWriteAt`（不是心跳）。建议 (a)，并在 §9.2 增加「空闲 200s 仍判活」的用例。
- **残留覆盖语义清楚 ✓**（§3.7:236「扩展下次重新连接该文件时直接用新进程信息覆盖 stale sidecar」，§4.3:348 明确 Rust 侧**不删磁盘文件**，责任单一，无两解）——这一半是好的。
- 另附：`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` 对「已结束但句柄未回收」或「更高完整性级别」的进程可能失败 → 误判为死；建议 spec 规定「OpenProcess 失败后追加 `GetExitCodeProcess` 判定，仍失败则只依据 `lastWriteAt`」，避免把权限问题当进程死亡。

### 应当修复

**[应当修复] Y1 §4.2:318 + §7.2:497 —— 受信判定读 `markdown` 会造成 `components` 陈旧闭包，最坏情形下非受信文档自动挂载 iframe**
`pre` 渲染器位于 `src/components/MarkdownDocument.tsx:356-383`，包在 `components = useMemo(..., [resolveHeadingId])`（:318、:389）里，而 `resolveHeadingId = useHeadingIdResolver(headings)`（:296）只随 **headings** 变化。spec:318 让渲染器读 `markdown.startsWith(...)` 却完全没提依赖数组：照抄 → 闭包捕获的是「上次 headings 变化时」的那份 markdown 字符串。`MarkdownBody` 的 props 中 `markdown` 每次热重载都变，但 headings 可能不变（连续追加若干条不含标题的短消息），**切换文档时若两篇文档的 headings 都为空/相同**，`components` 不重建 → `isTrustedMdlog` 沿用上一篇文档的值：刚看过一份 mdlog 日志，再打开一份第三方 `.md`，其中 ` ```vellum-widget ` 围栏会**不经点击直接自动挂载执行**，§7.2 的门禁被实现细节打掉。
→ spec 必须写成：在 `MarkdownBody` 内 `const isTrustedMdlog = useMemo(() => /^\uFEFF?\s*<!--\s*mdlog:v1/.test(markdown), [markdown])`（布尔原始值，引用恒稳定），并把该布尔加入 `components` 的依赖数组；同时说明「加进依赖不会破坏 memo，因为 `components` 只在 `MarkdownBody` 内部使用，而 `MarkdownBody` 本身仍以 `markdown` 为 memo 边界（:295），AGENTS.md「props 必须引用稳定」不受伤」。

**[应当修复] Y2 §4.3:333-337 —— 强制响应头清单缺 `Content-Type: text/html; charset=utf-8`，配合 `nosniff` 会让 widget 变空白或中文乱码**
清单只列 CSP / `X-Content-Type-Options: nosniff` / `Cache-Control: no-store`。wry 把用户响应的 header 原样拼成字符串交给 `CreateWebResourceResponse`（`wry/src/webview2/mod.rs:1114-1126`），**不会补 MIME 类型**；`nosniff` 明确关闭 MIME 嗅探 → 无 `Content-Type` 的文档不会被当作 HTML 渲染（子帧空白）。即使侥幸渲染，缺 `charset=utf-8` 时中文标题/正文按错误编码解码 → 乱码，而 widget 恰恰是 kami 纸墨中文界面。
→ 三条改为四条，增补 `Content-Type: text/html; charset=utf-8`，并在 §9.2 的协议单测里断言 200 响应同时含 CSP 与正确 `Content-Type`。

**[应当修复] Y3 §4.1:260-262 + §4.3:344-346 —— `register_widget` 只返回 URL，`unregister_widget` 却要 id；id 的取回路径未定义**
D2 的修法定的是「Rust 返回完整 URL、前端不得拼 scheme」，但卸载时 `invoke("unregister_widget", { id })` 需要裸 id，前端只能对 URL 做 `lastIndexOf('/')` 反向解析——又变回「前端自行解析平台 URL 结构」，与 :262「严禁前端自行拼装 scheme」的精神冲突，且 id 是 UUID（含 `-`，不含 `/`），字符串切法平台相关。
→ 明确 `register_widget -> RegisterResult { id: String, url: String }`（serde 驼峰），前端存 `id` 于 ref、只用 `url`；§9.2 增加对应断言。

**[应当修复] Y4 §7.1:484-486 + §7.2:500 + §1:20 —— 「绝对断网/从协议层切断所有对外请求」被高估：沙箱子帧可自行导航到外部 http(s)**
`sandbox="allow-scripts"` 只约束**顶层**导航（无 `allow-top-navigation` 时禁止改写 top），不禁止子帧导航**自身**；CSP 侧对应的 `navigate-to` 至今无浏览器实现，`form-action` 管不到 `location`。因此沙箱内 `location.href = "https://…"` 可把该子帧变成外部站点（我们的 CSP 随原离开该文档而失效）。这既推翻 §7.1 的「彻底切断所有向外部网络发起的请求」，也削弱 §7.2.4 用它来背书的风险接受结论（点击授权后可在本机 WebView2 里开外网站，成为嵌入式浏览面/驱动下载提示面）。
→ 三处措辞改为「禁止 fetch/XHR/img/font/websocket 等**取数型**请求（由 CSP 保证）；沙箱子帧可自行导航至远程地址（sandbox 不约束自身导航，`navigate-to` 无实现），该子帧此后不受本应用 CSP 约束」，并在 §9.3 表格**新增一行**实测 `location.href = "https://example.com"`；若实测确实放行，则在 §7.2.4 记为明确的已接受残余风险（可另提「widget 只用于讲解事实、受信文档由本项目自有扩展生成」作为缓解）。

**[应当修复] Y5 §3.4:182-188 —— 逐字节规范仍有 off-by-one 换行、锚点重复输出与示例自相矛盾，§9.2 的格式测试无法唯一断言**
(a) 规则 2（:183）与规则 6（:187）对**同一条用户消息**各写一次 `\n<!-- mdlog:m=… -->\n\n`，按序执行会输出两遍锚点；规则 6 本意是总述，须改为「规则 2/3 的正文与图片行写完后统一执行」或删掉规则 2 的后半句。(b) `\n<!--` 只贡献一个换行：若正文（或图片行）不以 `\n` 结尾，锚点前**没有空行**，直接违反 :188 的「关键排版红线」。规范缺一条「正文/图片行结尾换行规范化」规则（建议：写入前 `text.replace(/\s+$/,"")` 再固定拼 `\n\n<!-- …`）。(c) §3.4 规则 4 的「扫描反引号围栏开闭」未给算法：按 CommonMark，围栏行需满足「行首 ≤3 空格 + ≥3 个同种反引号，闭组长 ≥ 开组长」，且 `~~~` 也是围栏；把「行内含 ``` 的内联代码」当围栏会**误判未闭合**，反而补出一个真的未闭合围栏（把好事办坏）。(d) 示例模板 :160 ``助手部分内容```ts`` 把开栏符黏在正文同一行，本身不是合法围栏行，与规则 4 的补齐形态（`\n```\n`）互相打脸，作为 §9.2 逐字节测试的参照样例必出事。
→ 每条模板给出**唯一的字符串拼接公式**（含 rstrip 与 `\n\n` 的数量），并在 :184 增补一句 CommonMark 围栏扫描定义。

**[应当修复] Y6 §3.5:199-209 —— 尾向扫描语义两解、4b 分支破坏「首行指纹」前提、`s=` 提取式未定义、伪锚点无防御**
(a) :199 说「寻找**第一个符合正则**的有效锚点」，:201 说「若该 id ∈ branch 才增量」，:202 又说「或扫描出的锚点**均**不属于当前分支」——「首个正则命中即停止」与「回退直到成员检查通过」是两种实现，必须明确为后者并写成「继续向前，直到命中或到达文件开头」。(b) :208 的 4b 分支要求「保留文件原有开头内容，在文末追加两个换行后写入文件头与全量消息」，于是文件头落在**文件中段**，而 :203 的指纹提取规定读「**文件第一行**」→ 一份由 4b 建立的合法 mdlog，在锚点断裂后被重连时取不到指纹 → 又落到 4b → **再回填一份全量历史**：初审 S3 的重复回填路径未封死。同时 4b 落地的文件 `markdown.startsWith("<!-- mdlog:v1")` 为 false（§4.2:318/§7.2:497）→ 这份自产日志里的 widget 全部退化为占位块，与 §1:18「受信文件自动懒挂载」矛盾。→ 指纹改为「全文件扫描首个 `mdlog:v1` 注释」或 4b 直接把头写到文件最前面（用一次性原子重写而非追加）。(c) `sessionId` 是完整 `randomUUID()`（含 4 个 `-`）；若实现照 :199 的形状写 `/s=([a-f0-9]+)/` 就永远取不到 → 同 (b) 的后果。必须给出 `mdlog:v1\s+s=([^\s>]+)` 这类明确正则。(d) 伪锚点（B3 场景 2）：结合 §3.4 规则 4 保证的围栏配平，扫描时同步维护奇偶、忽略「围栏打开态」里的锚点行。(e) 未规定 §3.5 扫描在**静默重连（§3.3:107）**时是否执行、无 UI 时 `ctx.ui.confirm` 的判据应写 `ctx.hasUI`（`extensions/types.d.ts:214`）。

**[应当修复] Y7 §4.5:363-383 —— 图片规则内部冲突 + 3 项实质未定义，会误复制既有图片、重写后链接失效**
(a) :364 说「默认规则**全面覆盖所有工具调用**」，:379 的示例 `config.json` 默认值却是 `["bash","generate_image"]` —— 默认集到底是「全部」还是「两个」两解。(b) 未给路径提取样式（在 bash 任意输出里怎么认出「这是个图片路径」：引号内？`/`/`\` 开头？行首 `Saved to ` 之后？），而 §9.2:556 声称要为「相对路径解析、归一化替换、容量过滤」写单测 → 无判据。(c) **无「本回合内新建/修改」过滤**：`ls -R`、`grep -r`、`read` 一个已有 `.md`、`git status` 都会把仓库里既有的图片路径打进工具输出 → 被复制进 `mdlog-assets/` 并永久留存，既是隐私面也是体积面（§7.3 的 cwd 限定挡不住「cwd 内的既有敏感图」）。→ 规定 `stat.mtime >= 回合开始时间 - 容差` 才复制。(d) 重写出的目标未做 URL 编码：`![](...)` 目的地含空格/中文/括号时 CommonMark 直接解析失败（空格截断），而 `document.rs:111-121` 会先 `urlencoding::decode` 再拼路径 → 必须规定「写出的图片目的地一律 percent-encode（空格→`%20`）」或「复制时把文件名净化为 `[A-Za-z0-9._-]`」。(e) 基准目录混用：`ctx.cwd`（`extensions/types.d.ts:218`，当前进程 cwd）与 `sessionManager.getCwd()`（:205，会话头记录 cwd，`resume`/`--cwd`/跨目录时会不同）被分别用于「resolve」（:366）与「包含性校验」（:367、:503）→ 二者不一致时图片被静默丢弃。必须指定同一基准。(f) 补偿行只写单数一张（:372 规则、§3.4:5 模板），多张图/同名去重后 `-2` 名字与重写替换的关系未定义（应替换为**最终落盘名**）。

**[应当修复] Y8 §4.3:347-348 + §10:569-593 —— `read_mdlog_state(State<AppState>)` 放在 `src-tauri/src/widget.rs` 里无法编译；AppState 归属与 §10 清单缺失该改动**
`AppState` 现在定义在**二进制 crate** 里（`src-tauri/src/main.rs:166-170`，含 `current: Mutex<Option<PathBuf>>` 与 `watcher`），而 `lib.rs:1-7` 只声明 `association/document/watcher` + `document_tests`。spec 要求 `widget.rs`（属 `vellum_lib`）里的命令签名 `State<AppState>`，同时 §9.2:546 要求为它写 cargo 单测——lib  crate 无法引用 bin crate 的类型，照抄即编译失败。
→ spec 必须补一句：「`AppState` 迁移到 `vellum_lib`（建议 `document.rs` 新增 `pub struct AppState`，main.rs `use vellum_lib::document::AppState`），并在 §10 修改清单补上 `src-tauri/src/document.rs` 与 `src-tauri/src/main.rs` 的该职责变更」。同时 `WidgetState` 需 `.manage()`，§10:592 对 main.rs 的描述应一并写明（注册协议、注册命令、manage 状态、把 `load_document` 内的路径比对挂到注册表清空钩子）。

**[应当修复] Y9 §4.3:339 + §4.1:256-258 + §4.6:393 —— 三处「按字面实现会分叉」的架构契约缺失**
(a) 注册表访问方式两解：§4.3:339 写「全局互斥锁 `Arc<Mutex<WidgetRegistry>>`」，:344-346 的命令签名又用 `State<WidgetState>`。二者可并存（State 包一层），但文字未定；协议 handler 取状态的路径也只说了一半——`UriSchemeContext` 仅暴露 `app_handle()`/`webview_label()`（`tauri-2.11.5/src/app.rs:2469-2484`），故 handler 必须走 `ctx.app_handle().state::<WidgetState>()`。建议统一为「仅 managed `State<WidgetState(Mutex<Registry>)>`，不留全局 static」，这样 §9.2:544 的「512KB/64 条/清空时机」单测才能脱离 App 直接构造 Registry 断言。(b) `src/lib/widgetRegistry.ts` 只有职责描述（§4.1:256-259），**公共 API 与状态归属全无**：谁是休眠/激活态的真源（registry 还是组件 `useState`）、以什么为键（实例序号？entryId？）、可见性如何上报（每个组件自带 IO 还是 registry 统一观察）、LRU「最久未出现在视口」的排序键由谁更新。而 §9.2:535 要求为「LRU 淘汰与休眠状态切换」写单测 → API 未定即无法先写失败测试（违反 §11:606 的 TDD 纪律）。→ 补 6~8 行 API 签名（例如 `register(handle)/release(id)/markVisible(id)/activate(id): boolean` + `onDormant` 回调）并规定「休眠/激活为 registry 状态，组件仅订阅」。(c) §4.6:393 的守护解除条件含「点击」，但被复用的实现只监听 `wheel/touchstart/keydown`（`src/lib/scrollRestore.ts:145-152`），文字与代码不一致，改公共函数会连带影响既有位置恢复语义与测试。

**[应当修复] Y10 §9.2:536-540 —— CSS token 审查断言若按字面作用于整个 kami.css 必定失败，且允许集合与 §4.7/DESIGN.md 的徽章设计直接矛盾**
- 现文件存在越界项：`src/styles/kami.css:300`、`:367` 为 `border-radius: 1px`，`:1018`、`:1028` 为 `border-radius: 0`（均不在 :538 允许的 `{2,3,4,6}px`）；`:178-184` 有 `:root` 之外的原始十六进制（`#c42b1c`/`#fff`/`#a12014`，危险色），直接违反 :540「严禁引入任何未在 `:root` 声明的原始十六进制或 RGB 颜色」。若该测试遍历全文件，§9.1 的「175 用例必须 100% 全绿」当场破功。
- 更关键：§4.7:416 要求的「前置 5×5px 靛青微方块」在权威预览里就是 `border-radius: 1px`（`docs/preview/mdlog-preview.html:59`），而 DESIGN.md:177 明文「装饰性小方块（目录 header 的 6px 章点）用 1px 微圆」。即 :538 的允许集合把**本特性自己的设计**判为违规。
→ §9.2 该条改写为两条：①作用域限定为新增的 `.mdlog-widget / .mdlog-widget__bar / .mdlog-widget__frame / .mdlog-live(::before)` 规则块（沿用 `kami.css.test.ts` 现有的按选择器正则取块写法，见 `src/styles/kami.css.test.ts:10-20`）；②允许集合订正为 `{0, 1px, 2px, 3px, 4px, 6px}` 并注明 1px/0 的依据是 DESIGN.md:177；③原始色值断言只禁「新增块内出现未声明色值」。

**[应当修复] Y11 §9.3:557-567 —— 验证清单只有负向隔离，缺 B2/D2 修法的正向验收，且未记录 WebView2 运行前提；§7.2 的「受信门禁」判据可被内容伪造**
- §9.2 的前端测试里 `invoke` 必然被 mock（jsdom 无 Tauri），§9.3 六行全是「应该失败的东西确实失败了」。于是**整条链路唯一能证明 B2 修法正确的用例（iframe 真的加载出 HTML、内联脚本执行、中文不乱码、postMessage 回传高度/标题并被采纳）在 v2 中不存在**。若某台机器的 WebView2 Runtime 不支持 `ICoreWebView2_22`（wry 的回退分支 `webview2/mod.rs:946-947` 不能稳定拦截 iframe 子帧请求），表现是「空白框」，而现有清单量不出「空白框」。
→ §9.3 增补两行正路径用例（dev 与 release 各验一次：widget 渲染成功 + resize/title 生效），并在 §4.3 或 §7 记一句运行前提「Windows 需 WebView2 Runtime 支持 `ICoreWebView2_22`（iframe 自定义协议拦截），低版本回退路径下 widget 可能空白，应用侧行为=降级为占位块且不报错」。
- 顺带（同一处文字问题）：§7.2:497-499 把「文档以 `<!-- mdlog:v1` 开头」称作安全门禁，但它是**纯内容判据**——任何第三方 `.md` 只要首行写这串注释即可免点击自动挂载任意 JS。该结论对「降低误触」有效、对「对抗恶意文件」无效。→ 删改「安全」措辞为「意图标识（heuristic）」并如实写明可伪造；若要真验，须换成非内容信号（如「同目录存在存活 sidecar」或「按 canonical 路径记忆的用户授权」）。

**[应当修复] Y12 §4.5:374 + §3.3:118 —— 回合级事务的 5s 等待若落在 `agent_settled`/`message_end` 回调内会阻塞 pi 的扩展事件链，与 §6:468「不阻塞 CLI 主线程」冲突**
`agent-session.js:347-354` 的 `_emitAgentSettled()` 是 `await this._extensionRunner.emit({type:"agent_settled"})` → 之后才 `_emit` 并向 `finally` 里 `_resolveIdleWaitIfIdle()`；`message_end` 同理 `:384` 被 await。扩展 handler 内 await 5 秒 ⇒ **agent 空闲信号、idle 等待方（`-p` 退出、`/reload`、队列处理）整体停 5 秒**。
→ §4.5/§3.3 必须明写硬约束：事件 handler 一律「登记 + `setTimeout` 调度」，**不得 await 复制/写入事务**；事务在 timer 回调里跑；`session_shutdown` 的兜底 flush 允许同步落盘文本，但图片等待上限降为 1s（并写明该上限）。

### 建议

- **[建议] §4.1:268-292 的 CSS 与权威预览 `docs/preview/mdlog-preview.html` 有 5 处分歧**：`margin 16px`(spec:280) vs `17px`(preview:33)；`padding 6px 12px`(spec:285) vs `7px 14px`(preview:39)；`font-size 11px`(spec:289) vs `10px`(preview:42)；spec 给 bar 加 `border-bottom: 1px solid var(--hairline)`(:294) 而 preview 给 frame 加 `border-top`(preview:27)（两者同时落地会出现双线）；preview 的 frame 有 `min-height:120px`、spec 无。§10:588-589 把预览列为已就绪的设计依据，须指定唯一真源。另：DESIGN.md 的 spacing 标度是 4/8/14/22（DESIGN.md:59-64 邻近段落），16px 与 17px 都越界，1.2px 字距也不在既有标度（0.4px / 4–5px，DESIGN.md:25、:148）内——建议统一到 14px 或 22px、字距取 0.4px 或 4px，或在 DESIGN.md 增补 token 后引用。
- **[建议] §4.1:264 的休眠/重激活与 §6:471 的「IPC 风暴」缓解没有闭环**。修订说明 §三.3 声称「组件由 `React.memo` 保护」即可避免振荡，但快速滚动时的挂载/卸载是 registry 决策、与 memo 无关；spec 只写了「等待用户显式点击或稳定停止滚动后重新激活」（:258），未给「稳定停止滚动」的判据（建议：滚动停止 400ms 后才允许 LRU 淘汰式重挂载，且被淘汰项在重新进入视口时不自动复活，需点击）。
- **[建议] §8:516 的「widget 超过 512KB 或注册失败 → 降级为 CodeBlock」责任方未指明**。`WidgetSandbox` 不 import `CodeBlock`（且会形成新的耦合/chunk 关系）；建议在 `MarkdownDocument` 的 `pre` 渲染器里以 `fallback` render prop 传入，或直接在上层判定长度。文字未定的话包 2 与包 3 会各写一种。
- **[建议] §6:479 的 2MB 分卷阈值只计文本**。mdlog 会把最大 20MB 的本地图以 data URL 内联进 DOM（`document.rs:139-160` base64，膨胀约 1.37×），并叠加 §6:479 承认的「`rehype-raw` 恒走 + 每 400ms 整篇重解析」。建议同时给出 `mdlog-assets/` 总量上限与**清理策略**（初审 S6 明确要过、v2 仍缺：删除日志时是否连带删图、或提供 `--no-assets`），并把阈值改为「文本 + 已内联图像」的合计。
- **[建议] §3.4:160 的示例正文若本身包含 ` ``` ` 会截断 widget 围栏**（自包含 HTML 里极少见但非零）。技能 §5.1:438-441 应加一条「正文含三反引号时外层围栏用 4 个反引号」，或让扩展在写围栏时对内部 ``` 做提示性告警。
- **[建议] §3.4:128 文件头与 §4.2:318 判定应显式容忍 BOM 与前导空白**（用户在编辑器里另存可能引入 `\uFEFF`），否则自产日志退化为「需点击」文档；判定式建议统一为 `/^\uFEFF?\s*<!--\s*mdlog:v1/`，并让 §3.5:203 的首行指纹提取使用同一宽松度。
- **[建议] §10:594 计划修改 AGENTS.md，但漏了两件与本 spec 直接相关的规约订正**：①AGENTS.md 命令段的「14 测试文件，142 用例」已过期（实测 17/175），与 §9.1 的新基线不一致；②AGENTS.md「技能安装流程」明文「每个项目通过符号链接引用仓库中的技能，**不拷贝**」，而 §1:21/§5:417 决定把 `vellum-mdlog` 作为**项目内真实目录**（现场核对：`.pi/skills/` 下现有 6 项**全部是 JUNCTION**）→ 必须在 AGENTS.md 增补该例外及其理由（项目专属技能、需随仓库版本化），否则后续 Agent 会按「不拷贝」规约把它移进全局仓库。
- **[建议] §4.2:320-322 关于「不经过 rehype-sanitize」的说明可再精确一点**：围栏**文本**不经 sanitize（它是 `<code>` 的文本节点，`:94` 的 `SEARCH_SKIP_TAGS` 也保证搜索高亮不拆它），但整份文档仍走 sanitize；建议明确「围栏文本作为字符串原样交付给 WidgetSandbox，容器内文档由协议响应 CSP 单独约束」，以免实现者误以为要新增 sanitize 例外。
- **[建议] §9.2:543-548 的 Rust 测试需可注入性说明**：`read_mdlog_state` 的存活判定应抽成 `fn pid_alive(pid: u32) -> bool` 与 `fn judge(&MdlogState, now, alive: &dyn Fn(u32)->bool)`，否则单测无法稳定覆盖「pid 死/超时」组合；协议 handler 同理需纯函数 `fn build_response(method, uri, registry)` 以便测 404/CSP/Content-Type（当前 wry 路径无法在无 webview 环境测试）。
- **[建议] §4.3:330-336 可补一句 wry 前缀匹配的既成事实**：`is_work_around_uri` 只做前缀判定（`custom_protocol_workaround.rs:11-20`），因此 `http://vellum-widget.<任意域>` 也会进本 handler（并因未知 id 被 404）——写明可避免实现者困惑，也顺带说明「外部同名主机名请求会被本地吞掉」不是漏洞。

---

## 已核实事实（本轮新增/补确）

**pi（`@earendil-works/pi-coding-agent`）**
- `agent_settled` 事件与 handler 注册存在：`dist/core/extensions/types.d.ts:560-562`、`:926`；`agent_settled` 的发出被 await：`dist/core/agent-session.js:347-354`（随后才 `_emit` 与 `_resolveIdleWaitIfIdle`）。
- `message_end` → 先 `_emitExtensionEvent` 后 `appendMessage`：`agent-session.js:383-399`；`appendMessage` 以**引用**保存 message 并返回 entry id：`session-manager.js:781-790`。
- entry id 形态 = `randomUUID().slice(0,8)`（`session-manager.js:23`）→ 恒 `[a-f0-9]{8}`；sessionId = 完整 `randomUUID()`（含 `-`，`session-manager.js:28`）。
- `SessionMessageEntry { id, parentId, timestamp, message }`、`CustomEntry { type:"custom", customType, data }`、`SessionEntry` 联合含两者：`dist/core/session-manager.d.ts:16-27`、`:69`、`:105`；`getBranch(fromId?)`/`getLeafId()`/`getCwd()`/`getSessionId()` 均在扩展可见白名单：`:140`、`:205`、`:208`、`:240`、`:262`。
- `ExtensionContext` 同时有 `cwd: string`（`:218`）与 `sessionManager.getCwd()`（`session-manager.d.ts:205`）——**两个不同来源**（进程 cwd vs 会话头 cwd）；`hasUI: boolean`（`:214`）、`mode: "tui"|"rpc"|"json"|"print"`（`:211`）。
- `ui.confirm(title, message, opts?) → Promise<boolean>`、`ui.notify(message, type?)`：`extensions/types.d.ts:71-76`；`session_start.reason` 五值确认：`:419`；`pi.appendEntry(customType, data?)`：`:985`。

**Vellum**
- `src/components/MarkdownDocument.tsx:378` 正则现状；`:318`+`:389` `components` 的 useMemo deps 为 `[resolveHeadingId]`；`:296` `useHeadingIdResolver(headings)`；`:295` `MarkdownBody = memo(...)`；`:222` `RAW_HTML_RE = /<\/?[a-zA-Z!?]/`（`<!--` 命中，故 §6:479 的代价陈述**正确**）。
- `src/components/CodeBlock.tsx:8-51`（20 种注册语言，无连字符键）、`:61-80`（别名表与 `resolveHighlightLanguage`）；`react-syntax-highlighter/dist/esm/highlight.js:259` + `checkForListedLanguage.js:1-4`（未注册语言纯文本降级）。
- `src/App.tsx:130-146` `reloadCurrent`（`pendingScrollRef` 于 :137、`setShowReloadNote(true)` 于 :142）；`:338-345` 位置恢复 effect 的依赖是 `[activeDocument?.markdown]` 且为 **`useEffect`（非 layout）**——§4.6 要求「收敛至同一个 layout effect」意味着**迁移 hook 类型**，spec 应点明这一点及其与 `MarkdownDocument` 内部 `useLayoutEffect`（搜索滚动）的先后关系；`:349-360` fresh-ink/reload-note 卸载计时；`:311-323` 300ms 防抖写 scrollMemory + `beforeunload` 兜底；`:104-108` 切文档时 `persistCurrentScroll()` 与 `restoreCancelRef`。
- `src/lib/scrollRestore.ts:4-6`（`SETTLE_GUARD_MS = 5000`、`REANCHOR_MIN_INTERVAL_MS = 120`）、`:107-160`（`restoreScrollPosition(container, contentEl, record, headings)`，无 anchor 时走 `ratio × max`，`ResizeObserver` 重锚，解除条件为 wheel/touchstart/keydown/超时/取消函数）→ 传 `{ratio:1}` 即可实现贴底守护，**复用可行** ✓。
- `src-tauri/src/watcher.rs:9`（`DEBOUNCE=400ms`）、`:19-33`（监听父目录 NonRecursive）、`:54`（严格等值路径匹配）、`:57-65`（单 deadline）→ §4.7 双路 deadline 可行且无需新增 watch ✓；`src-tauri/src/main.rs:173-200`（`load_document` 每次重建 watcher 并存 canonical 路径，`document.rs:64-65` `dunce::canonicalize`）→ §4.3「仅 canonical 路径变化才清空」有明确挂载点 ✓；`main.rs:166-170` `AppState` 位于 **bin crate**（→ Y8）。
- `src-tauri/src/document.rs:103-137`（子目录允许、越界/百分号拒绝）、`:53-61`（50MB）；`src-tauri/Cargo.toml:26-31` `windows-sys 0.61` 已含 `Win32_Foundation` + `Win32_System_Threading` → `OpenProcess` 无需新增依赖 ✓；`src-tauri/tauri.conf.json:26` CSP 现状（无 `connect-src`/`frame-src`）→ §4.4 的新字符串不丢任何既有 directive ✓。
- `src/test/setup.ts` 仅 mock `ResizeObserver` 与 `scrollIntoView`（§10 要求补 `IntersectionObserver` ✓ 必要）；`src/styles/kami.css:26-36` kami 变量表（spec §5.1 引用的 8 个色值全部与之一致 ✓）；`:1045-1048` `.code-block__lang` = mono/11px/uppercase/0.3px（初审建议 4 已被采纳为 11px ✓，但字距另造 1.2px，见建议）。

**Tauri/wry（本轮补充）**
- `wry/src/custom_protocol_workaround.rs:11-20`（前缀匹配）、`:24-38`（apply/revert 字符串互换）；`wry/src/webview2/mod.rs:931-947`（`http://<scheme>.*` 过滤器，新 API 为支持 iframe/Worker）、`:1040-1101`（`prepare_request`，`:1094-1100` revert 后 `request.uri(&path)`）、`:1104-1127`（响应头逐条拼字符串交给 `CreateWebResourceResponse`，**不补 MIME**）。
- `tauri-2.11.5/src/app.rs:2103-2130`（注册与 `uri().path()[1..]` 示例、Windows/Android URL 形态文档）、`:2469-2484`（`UriSchemeContext` 只给 `app_handle()`/`webview_label()`）。

**测试基线**：`npm test` 17 files / 175 tests 全绿（4.16s）；`cargo test` 13 + 2 全绿。

---

## 下一版复审通过条件（最小集）

1. **Z1**：§3.7/§4.3/§4.7 补「心跳由扩展每 30s 写 `heartbeatAt`（与 `lastWriteAt` 分字段）+ 前端按 `expiresAt` 自设复查定时器」，并在 §9.2 增「空闲 200s 仍判活」「崩溃后无事件也能自动隐藏」两条用例。
2. **Y1/Y11-b**：§4.2 判定式改为独立 `useMemo` 布尔并声明依赖数组；§7.2 去掉「安全」措辞、如实写明内容判据可伪造（或换成 sidecar 存活/按路径记忆授权的非内容信号）。
3. **Y2/Y3**：响应头补 `Content-Type: text/html; charset=utf-8`；`register_widget` 返回 `{ id, url }`。
4. **Y4**：§7.1/§7.2.4 的断网主张订正为「取数型请求被 CSP 阻断，子帧可自行导航」，§9.3 增该行实测。
5. **Y5/Y6**：§3.4 每条消息给出唯一字符串拼接公式（含 rstrip 与空行数量）+ CommonMark 围栏扫描定义 + 修正 :160 示例；§3.5 明确「回退直到 id ∈ branch」、指纹提取正则、4b 的文件头落点（或全文件扫描指纹）、降级方向、伪锚点（围栏态）过滤、静默重连是否跑扫描。
6. **Y7**：§4.5 统一默认工具集（文字与示例一致）、给路径提取样式、加 mtime 回合窗过滤、规定目的地 percent-encode 或文件名净化、指定单一 cwd 基准、明确多张图/去重名的替换规则。
7. **Y8/Y9**：§4.3 把 `AppState` 迁入 lib 并同步 §10 清单；注册表访问单一化（managed State + `ctx.app_handle().state()`）；补 `widgetRegistry.ts` 公共 API 签名与休眠态真源；§4.6:393 的解除条件与 `scrollRestore.ts` 实际对齐。
8. **Y10**：§9.2 CSS 断言限定作用域，圆角允许集合订正（含 1px），原始色值断言只作用于新增规则块。
9. **Y11**：§9.3 增「widget 正向加载渲染」验收行（dev/release 各一次）+ 记录 WebView2 `ICoreWebView2_22` 运行前提与空白回退行为。
10. **Y12**：§3.3/§4.5 写死「事件 handler 不得 await 写入事务」与 shutdown 同步 flush 的图片等待上限。
11. 建议项按 §10 顺带吸收（预览页真源、AGENTS.md 基线数字与技能 junction 例外、`mdlog-assets` 清理策略）。

满足第 1 条 + 第 2~7 条即可通过复审（其余为文字与测试补齐，可与工作包并行）。
