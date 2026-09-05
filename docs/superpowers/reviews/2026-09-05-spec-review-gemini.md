# Spec 审核报告（reviewer-gemini）

结论：**驳回**

---

## 问题清单

### 1. 阻断性问题（Must Fix Before Implementation）

- **[阻断] §4.2：现有 `MarkdownDocument.tsx` 的代码语言提取正则不支持连字符，`vellum-widget` 永远无法命中分发**
  - **位置**：`src/components/MarkdownDocument.tsx:368` 与 spec §4.2。
  - **理由**：`MarkdownDocument.tsx` 现有 pre/code 渲染器中提取语言的代码为：
    ```ts
    const match = /language-(\w+)/.exec(className);
    const language = match?.[1] ?? "";
    ```
    正则表达式 `\w` 仅匹配 `[a-zA-Z0-9_]`，**不包含连字符 `-`**。当输入类名为 `language-vellum-widget` 时，`/language-(\w+)/.exec("language-vellum-widget")[1]` 的结果为 `"vellum"` 而非 `"vellum-widget"`。若按 spec §4.2 仅做 `if (language === "vellum-widget")` 判断，该分支条件永远为 `false`，交互块会被直接降级回传给 `<CodeBlock code={code} language="vellum" />` 渲染，导致核心特性完全失效。
  - **修复要求**：spec §4.2 必须明确修改该正则为 `/language-([\w-]+)/` 或 `/language-([^\s]+)/`。

- **[阻断] §3.3 & §3.4：pi 扩展在 `message_end` 时无法从事件中直接取得 `entryId`，且该事件早于持久化**
  - **位置**：spec §3.3、§3.4，及 `@earendil-works/pi-coding-agent` 的 `dist/core/agent-session.js:384-398`、`dist/core/extensions/types.d.ts:604`、`@earendil-works/pi-ai/dist/types.d.ts:285-300`。
  - **理由**：
    1. 在 pi 的类型定义中，`MessageEndEvent.message` 为 `AgentMessage`（即 `UserMessage` / `AssistantMessage`），其消息对象本身**没有** `id` 属性；
    2. 在 `AgentSession` 内部实现中，`await this._emitExtensionEvent(event)`（触发 `message_end`）在 `this.sessionManager.appendMessage(event.message)` **之前**执行。这意味着在 `message_end` 回调执行的同步瞬间，该消息尚未被写入 `SessionManager`，条目 ID 还未生成，`ctx.sessionManager.getLeafId()` 仍指向上一条消息；
    3. spec 称「每条消息末尾紧跟隐藏注释 `<!-- mdlog:m=<entryId> -->`，`entryId` 取自 pi 会话条目 ID」。若扩展实现者试图直接读取 `(event.message as any).id` 或在 `message_end` 触发时同步读取 `leafId`，取得的值将为 `undefined` 或错误的旧 ID，写入日志的将是 `<!-- mdlog:m=undefined -->`，直接破坏续写锚点与幂等性校验。
  - **修复要求**：spec 需明确说明：写入文件前必须在持久化之后（例如在 spec 规划的 150ms 防抖合并落盘执行时，或微任务/次轮事件循环中）通过 `ctx.sessionManager.getBranch()`，通过对象引用比对 `entry.message === message` 或取最新 branch leaf 获取真实 `entry.id`。

- **[阻断] §4.5：图片识别规则与项目真实技能 `imagen2` 不匹配，且未规范相对路径与 Windows 路径转换**
  - **位置**：spec §4.5 与 `.pi/agent/skills/imagen2/SKILL.md:9-10`。
  - **理由**：
    1. spec §4.5 规定「默认匹配 `generate_image`、`imagen2` 类工具名 + 结果文本中的绝对路径」；
    2. 核查项目中已安装的 `imagen2` 技能发现，图片生成是 AI 通过调用内置工具 `bash` 执行 `node scripts/imagen2.mjs generate ...` 完成的。`tool_execution_end` 事件捕获到的 `toolName` 实际上是 `"bash"`，绝非 `"imagen2"`。若按工具名白名单过滤，将完全遗漏生图结果；
    3. `imagen2.mjs` 默认落盘至当前项目的相对路径 `generated-images/`（而非绝对路径）。如果只匹配绝对路径，将无法提取文件；
    4. 在 Windows 平台上，路径可能包含反斜杠 `\`、空格或引号，而 Markdown 引用常常被 AI 写成正斜杠 `/`。若不显式规定「在 cwd 下解析为绝对路径后复制」与「正反斜杠归一化比对替换」，绝对路径重写为 `mdlog-assets/<文件名>` 的字符串替换将频繁失效。
  - **修复要求**：spec 需将规则修订为：支持从 `bash` 工具输出中提取图片文件特征（或扩展配置增加 `toolNames: ["bash", "imagen2", ...]`），支持相对路径相对 `ctx.cwd` 进行 `path.resolve`，并在正文重写时归一化处理正反斜杠与引号。

- **[阻断] §3.7 & §4.7：pi 异常崩溃/杀死时 sidecar 文件残留，导致 Vellum「记录中」徽章永久常驻**
  - **位置**：spec §3.7、§4.7 与 `src-tauri/src/watcher.rs`。
  - **理由**：
    1. spec §3.3 仅在 `session_shutdown` 钩子里删除 sidecar。当用户直接关闭终端窗口、Ctrl+C 强退、进程崩溃或系统断电时，Node.js 的正常退出钩子不会执行，`<对话>.md.mdlog` 会永久残留在磁盘上；
    2. spec §4.7 中，Vellum 端 Rust 命令仅定义为 `read_mdlog_state() -> Option<{ lastWriteAt: number }>`，只判断文件是否存在与是否能反序列化，**完全未校验 sidecar 中的 `pid` 是否真实存活**；
    3. 结果是：只要发生一次终端强退，用户再次打开该 Markdown 文件时，Vellum 将永远显示「记录中 · PI」呼吸徽章，严重违反真实状态指示语义。
  - **修复要求**：
    1. sidecar 中已包含 `pid`（spec §3.7 已设计该字段）；
    2. Rust 端 `read_mdlog_state` 必须在 Windows 下利用系统 API（如 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, ...)`）校验对应 `pid` 进程是否存在且为活跃进程；
    3. 若进程已死或 `lastWriteAt` 超过心跳超时时间（如无心跳超限），自动视为未连接，并在 Rust 端静默清理残留 sidecar 或由前端隐藏徽章。

- **[阻断] §4.1：Windows / WebView2 下自定义协议 URL 映射与 iframe 加载 URL 不一致**
  - **位置**：spec §4.1、§4.3、§4.4，及 Tauri 2 运行时源码 `wry-0.55.1/src/custom_protocol_workaround.rs` 与 `tauri-2.11.5/src/app.rs:2184`。
  - **理由**：
    1. spec §4.1 规定 `invoke("register_widget", { html })` 返回 `vellum-widget://localhost/<id>` 并赋给 iframe `src`；
    2. 但在 Tauri 2 的 Windows (WebView2) 底层实现中，由于 WebView2 对非标准 URI Scheme 的限制，Tauri (wry) 内部通过 `AddWebResourceRequestedFilter` 监听的是 `http://<scheme>.localhost/*` 模式的请求（见 `wry::custom_protocol_workaround`）；
    3. Tauri 官方文档明确说明：*Windows and Android: `http://<scheme_name>.localhost/<path>` by default*；
    4. 如果 Rust 端 `register_widget` 命令返回 `vellum-widget://localhost/<id>`，WebView2 将因未注册原生 OS scheme 而无法通过 HTTP filter 拦截，iframe 页面将出现空白或协议导航错误。
  - **修复要求**：spec §4.1 与 §4.3 需明确统一 URL 格式：在 Windows 平台下，Rust 命令 `register_widget` 必须返回 `http://vellum-widget.localhost/<id>`，与 `tauri.conf.json` 中配置的 CSP `frame-src http://vellum-widget.localhost` 保持严格对应。

---

### 2. 应当修复的问题（Should Fix）

- **[应当修复] §3.5 & §3.6：会话分支（`/fork`）与断开（`/mdlog off`）状态同步缺陷，引发重复全量回填或幽灵重连**
  - **位置**：spec §3.2、§3.5、§3.6。
  - **理由**：
    1. 当用户在 pi 中使用 `/fork` 创建新分支时，新会话会克隆父会话的所有 entry，因而新会话也会包含 `mdlog:connection` custom entry；
    2. 新会话如果自动重连原文件，但原文件的最后一个锚点是原会话更深分支上的 entryId（在当前分支的 `getBranch()` 中不存在），根据 spec §3.5 规则 4，会直接判定为「标记不属于本会话」，从而**触发全量历史消息回填**，导致同一个 Markdown 文件内重复追加一整份完整的历史记录；
    3. 当用户执行 `/mdlog off` 断开连接时，spec 仅写了「删除 sidecar，停止写入」，未向会话追加断开标记。由于 pi 的 session entry 是只追加不可删除的，下次 `/reload` 或 resume 时，`session_start` 依然会读到历史上的 `mdlog:connection` 导致**自动幽灵重连**。
  - **修复要求**：
    1. `/mdlog off` 必须追加 `{ active: false }` 的自定义 entry，`session_start` 恢复时以 branch 上的最新一条 connection entry 为准；
    2. `/fork` 生成的新会话不得自动静默继承写向同一个已存在的 mdlog 文件，需校验 session id 或要求用户重新显式绑定。

- **[应当修复] §8：Windows 文件占用下的重试策略不可靠，会导致消息丢失**
  - **位置**：spec §8。
  - **理由**：spec §8 规定「写入中途失败：保留连接，下一次 message_end 重试；连续 3 次失败则断开并 notify」。在 Windows 系统中，当 Vellum 监听文件变动触发重载读取，或 Windows Search 索引器、杀毒软件扫描文件时，极易产生几十毫秒的文件锁竞争（`EBUSY` / `EPERM`）。如果把重试推迟到「下一次 message_end」：若当前消息是对话的最后一条（用户不再提问），下一次 `message_end` 可能几小时后甚至永远不会到来，导致本条助手消息在磁盘上直接丢失。
  - **修复要求**：写入模块应在单次追加发生 I/O 错误时，就地进行 3 次指数退避微重试（例如 50ms、150ms、300ms），只有连续重试耗尽才判定写入失败并暂存入待写入队列。

- **[应当修复] §3.4：未闭合的 Markdown 围栏块（代码块/widget）会吞噬后续所有消息**
  - **位置**：spec §3.4。
  - **理由**：当助手回复因上下文长度用尽（`stopReason === "length"`）、网络中断或用户主动按 Escape 中断（`stopReason === "aborted"`）时，回复文本中可能残留未闭合的反引号围栏（例如输出了 ```` ```vellum-widget ```` 或 ```` ```ts ```` 但尚未输出结尾闭合符）。若扩展按 spec 原样透传正文并在文末直接追加 `<!-- mdlog:m=... -->` 和 `---`，随后产生的所有后续用户和助手消息都会被 CommonMark 解析器当作未闭合代码块的内部纯文本，导致整个 Markdown 文件的后续排版彻底崩塌。
  - **修复要求**：扩展端格式化模块在写入前，必须计算反引号围栏的开闭对称性，若存在未闭合的 block code fence，必须在末尾自动补齐闭合标记 `\n```\n` 后再追加元数据锚点与分隔线。

- **[应当修复] §4.1：全文档最多 10 个存活 iframe 的 LRU 休眠机制缺乏前端架构定义**
  - **位置**：spec §4.1。
  - **理由**：Markdown 正文中的每一个 `WidgetSandbox` 是独立挂载的 React 组件。当文档中第 11 个交互块进入视口时，独立组件无法得知全局有哪些 iframe 存活，也无法直接通知最先离开视口的组件退化为「占位块」。
  - **修复要求**：spec 应明确其状态管理模式（例如定义一个模块级轻量单例 store `activeWidgetRegistry` 或全局状态管理器），统一分发各个 widget 的挂载与休眠信号。

---

### 3. 建议优化（Suggestions）

- **[建议] §3.4：助手正文中的 `---` 与回合分隔线 `---` 视觉混淆**
  - **位置**：spec §3.4。
  - **理由**：助手在普通技术讨论中经常使用 Markdown 水平分割线 `---`。在 Vellum 现有的 kami 纸墨主题下，所有的 `---` 均渲染为相同样式的发丝分割线，导致读者难以分辨「这是助手回答内部的段落分隔」还是「一轮问答的结束」。
  - **建议**：回合结束的分隔线可考虑采用具有结构语义的包裹或微弱区别的标记（例如专门的 `<div class="mdlog-turn-divider"></div>`），保证与正文内原生分割线有所区分。

- **[建议] §4.6：热重载贴底滚动需防范图片与沙箱高度撑开后的漂移**
  - **位置**：spec §4.6 与 `AGENTS.md`。
  - **理由**：`AGENTS.md` 中特别强调过图片加载撑开 `scrollHeight` 会导致阅读位置漂移，因而设计了落位守护（ResizeObserver）。spec §4.6 仅在 `reloadCurrent` 的瞬时执行 `scrollTop = scrollHeight`；若新追加的内容包含图片（需异步加载）或 widget 沙箱（异步 postMessage 调整高度），初次渲染瞬间的高度较小，图片加载和 iframe resize 会在 100~300ms 后把高度撑大，导致用户脱离贴底状态。
  - **建议**：跟随贴底可复用已有的短期 ResizeObserver 守护窗口（如 500ms），在尺寸变动时保持贴底。

---

## 已核实事实

1. **测试基线状态核实**：
   - 前端 Vitest：运行 `npm test`，真实输出为 **17 个测试文件全部通过，175 个用例全部通过**（耗时 5.53s）。
   - 后端 Cargo：运行 `cd src-tauri && cargo test`，真实输出为 **15 个用例全部通过（lib 13 个，main 2 个）**，编译无 warning。

2. **pi 扩展事件与数据结构核实**：
   - 依据 `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:384-398`：`_emitExtensionEvent(event)`（触发 `message_end`）在 `this.sessionManager.appendMessage(event.message)` 之前调用。
   - 依据 `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:604`：`MessageEndEvent` 包含 `message: AgentMessage`。
   - 依据 `node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/types.d.ts:285-320`：`UserMessage` 与 `AssistantMessage` 均无 `id` 属性，只有 `role`, `content`, `timestamp` 等。

3. **Vellum Markdown 渲染器实现核实**：
   - 依据 `src/components/MarkdownDocument.tsx:368`：`const match = /language-(\w+)/.exec(className);`，实测执行 `node -e 'console.log(/language-(\w+)/.exec("language-vellum-widget")[1])'` 输出为 `"vellum"`。

4. **Tauri 2 / WebView2 自定义协议与 CSP 核实**：
   - 依据 `tauri-2.11.5/src/app.rs:2184` 官方说明：Windows 平台下自定义协议默认被映射为 `http://<scheme>.localhost/<path>`。
   - 依据 `wry-0.55.1/src/custom_protocol_workaround.rs:1-35`：Windows WebView2 的非标准协议拦截是通过前缀替换为 `http://{protocol}.` 实施 HTTP 拦截过滤的。
   - 依据 Web 标准及 Chromium 实现：顶层主应用 CSP 的 `script-src 'self'` 不会跨文档作用到具有独立 URI 的沙箱 iframe 内部。带 `sandbox="allow-scripts"` 的沙箱 iframe 在拥有独立 URI Scheme 响应返回的 CSP 头时，受自身响应的 CSP 约束；其通过 `parent.postMessage` 与父级通信不受 CSP 阻止；父级通过 `event.source === iframeRef.current.contentWindow` 进行源校验完全成立。

5. **项目内图片技能调用方式核实**：
   - 依据 `C:\Users\17445\.pi\agent\skills\imagen2\SKILL.md:9-10, 48-56`：`imagen2` 技能指示 Agent 运行 `node scripts/imagen2.mjs generate ...`，其作为 `bash` 工具执行，产物生成在当前工作目录的相对路径下（默认 `generated-images/`）。

6. **设计规范与 UI 预览核实**：
   - 依据 `DESIGN.md:9, 137-142`：主色为单一靛青 `#1B365D`，无 emoji，字重最高 500。
   - 依据 `src/styles/kami.css:33`：`--brand: #1B365D` 已在全局 CSS 变量中声明。
   - 依据 `docs/preview/mdlog-preview.html:42-62`：`.mdlog-widget` 与 `.mdlog-live` 的 CSS 命名、圆角 6px、呼吸点 5×5px 动画均符合 `DESIGN.md` 规范。
