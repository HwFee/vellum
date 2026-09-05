# Spec 复审报告（reviewer-gemini，v2）

结论：**通过**

---

## 一、审核概况与测试基线

- **审核对象**：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（v2 修订版，637 行）
- **复审依据**：初审报告 A（Qwen）、初审报告 B（Gemini）、修订说明（`spec-revision-log.md` 含 D1～D20 裁决）、项目设计语言规范（`DESIGN.md`）、架构与性能红线（`AGENTS.md`）、代码实现事实（`src/`、`src-tauri/`、`@earendil-works/pi-coding-agent`）。
- **实测测试基线**（只读运行，验证通过）：
  - 前端 Vitest：`npm test` 真实输出为 **17 测试文件全部通过，175 用例全部通过**（耗时 4.18s）。
  - 后端 Cargo：`cd src-tauri && cargo test` 真实输出为 **15 用例全部通过**（`vellum_lib` 13 个，`main.rs` 2 个，耗时 0.40s）。

---

## 二、阻断项复核（1～5）

| 阻断编号与内容 | 复核结果 | 事实与代码证据 |
|---|---|---|
| **阻断 1：连字符正则导致分发永远无法命中**（初审 B1 / Gemini 阻断 1） | **已修复** | **证据**：§4.2 明确将 `MarkdownDocument.tsx:378` 的提取正则修改为 `/language-([\w-]+)/`；实测 `exec("language-vellum-widget")[1]` 正确捕获 `"vellum-widget"`。同时详尽评估了副作用：包含连字符的语言（如 `objective-c`）此前被截断为 `objective`，修正后整串传入 `CodeBlock`，经 `CodeBlock.tsx` 实测未注册语言安全降级为普通代码块，现有高亮与阅读器降级路径完全不受影响。 |
| **阻断 2：锚点时序颠倒（`message_end` 早于持久化导致 `entryId` 不可得）**（初审 B3 / Gemini 阻断 2） | **已修复** | **证据**：§3.4 与 §3.5 将锚点获取时机重构至 **150ms 合并防抖的 `flush`（落盘）时刻**。核查 pi 源码（`agent-session.js:398` 与 `session-manager.js:781-789`）：`appendMessage(message)` 在持久化时保持原始消息对象引用不变（`entry.message = message`）。在 flush 时刻通过 `ctx.sessionManager.getBranch()` 从尾向前进行 `entry.message === bufferedMessage` 引用比对，能够 100% 准确获取真实 `entry.id`；极端场景下提供 `getLeafId()` 兜底；并在文件头引入 `<!-- mdlog:v1 s=<sessionId> -->` 作为会话指纹。 |
| **阻断 3：图片识别规则与项目真实 `imagen2` 严重不符及路径缺陷**（Gemini 阻断 3） | **已修复** | **证据**：§4.5 修正为全面扫描包含 `bash`、`node` 在内的所有 `tool_execution_end` 工具结果文本；提取到的相对路径以 `ctx.sessionManager.getCwd()` 进行 `path.resolve` 解析；正反斜杠统一进行归一化替换；加入安全容量与作用域约束（仅允许 `ctx.cwd` 之下的常规文件，单文件 <= 20MB，默认严格排除 `.svg` 防注入）；并在 `~/.pi/agent/extensions/mdlog/config.json` 提供了可选配置载体。 |
| **阻断 4：异常强退导致 sidecar 残留与徽章长期说谎**（Gemini 阻断 4 / Qwen S9） | **已修复** | **证据**：§3.7、§4.3 与 §4.7 建立了闭环存活判定。sidecar 写入字段包含 `pid` 与 `lastWriteAt`。Rust 侧 `read_mdlog_state` 命令基于 Windows 系统底层 API `windows_sys::Win32::System::Threading::OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)` 校验进程是否活跃，并断言 `now - lastWriteAt <= 120s`。若进程死亡或心跳超时，直接返回 `Ok(None)` 静默隐藏徽章；下次扩展重连时直接覆盖 stale sidecar。 |
| **阻断 5：Windows / WebView2 下自定义协议 URL 映射与 iframe 加载冲突**（初审 B2 / Gemini 阻断 5） | **已修复** | **证据**：§4.1、§4.3、§4.4 彻底纠正了协议心智模型。Tauri 命令 `register_widget` 在 Windows 下直接向前端返回真实可加载 URL `http://vellum-widget.localhost/<id>`；前端直接赋给 `iframe.src`，严禁拼接 scheme；`tauri.conf.json` 中 CSP `frame-src` 仅声明平台唯一生效的 `http://vellum-widget.localhost`；Rust 侧 URI 协议 handler 依 wry 规则从 `request.uri()`（还原后的 `vellum-widget://localhost/<id>`）中截取末尾 id 解析。 |

---

## 三、应当修复项复核（初审报告中 Gemini 的 4 项核心修复）

1. **`/fork` 与 `/mdlog off` 状态同步缺陷（幽灵重连与重复全量回填）**：
   - **复核结果**：**已修复**。
   - **证据**：§3.6 规定 `/mdlog off` 必须向会话追加 `{ active: false }` 的 connection entry，`session_start` 恢复时以当前分支最后一条 entry 状态为准，彻底根除幽灵重连；§3.3 规定 `session_start` 时若 connection entry 的 `sessionId` 与当前会话不一致（`/fork` 分支），严禁自动重连原文件，仅做 notify 提示；§3.5 细分 4a/4b 分支，基于文件头会话指纹 `s=<sessionId>` 进行锚点失效仲裁，杜绝会话分裂时的无序重复追加。
2. **Windows 文件占用引发单次写入失败丢消息**：
   - **复核结果**：**已修复**。
   - **证据**：§3.8 引入单次追加发生 I/O 错误时的 3 次指数退避微重试（50ms、150ms、300ms），平滑度过杀软或重载读取产生的短暂锁竞争；微重试耗尽放回待写入队列；连续 3 批次完全失败才判定通道不可用并自动断开报警。
3. **未闭合 Markdown 围栏吞噬后续所有消息**：
   - **复核结果**：**已修复**。
   - **证据**：§3.4 规则 4 规定写入前扫描助手消息正文的反引号围栏平衡性，检测到未闭合时自动补齐闭合串 `\n```\n`，并在其后追加可见说明行 `*(本条消息被截断，已自动补齐代码围栏)*`，彻底避免后续对话和隐藏锚点被吞入代码块。
4. **全文档最多 10 个存活 iframe LRU 休眠机制缺乏前端架构定义**：
   - **复核结果**：**已修复**。
   - **证据**：§4.1 引入模块级单例 `src/lib/widgetRegistry.ts`，维护全局已挂载 widget 的 LRU 引用队列；第 11 个进入视口申请挂载时触发最久未在视口中出现的 widget 卸载底层 iframe，优雅退化为「交互已休眠 · 点击查看」占位按钮；§10 清单补入该文件及单元测试。

---

## 四、深度推演记录

针对 v2 引入的 5 项核心新机制，分别构造最可能击穿它的边界场景进行极端压力推演：

### 1. 回合级事务（`agent_settled` 等待图片复制 5s 超时）
- **击穿场景构造**：Agent 回复后调用 bash 执行生图，由于网络阻塞导致图片异步复制挂起持续 5 秒。在这 5 秒等待期间，用户在 pi CLI 中紧接着敲入了下一轮提问（产生新的 `user` 消息）；或者当前回合包含多个连续工具调用（tool_call 1 → toolResult 1 → tool_call 2 → toolResult 2）。
- **推演分析**：
  - 若扩展内部写入队列没有做串行互斥调度，第一回合的异步落盘（等待 5s 后）可能会与第二回合用户消息的落盘发生并发穿插，导致「第二回合用户提问跑到了第一回合助手回复前面」的时序错乱；
  - 若在多工具调用过程中 150ms 合并防抖提前触发并执行 flush，会将未完结的回合提前打上 `---` 分隔线，导致同一个回合被割裂成多份。
- **推演结论**：
  - v2 spec 规定「以 `agent_settled` 为准的回合级事务」在架构方向上是完全正确的（只有在回合真正 settled 时才落盘图片补偿行与 `---`）。
  - **实施防范点**：在工作包 4（pi 扩展）实现时，扩展内部的落盘事务必须由**严格串行的异步锁/Promise 链**调度；当上一回合的落盘事务在等待图片复制（5s 超时）时，新进入的提问必须排在事务链之后，保证文件追加顺序严格单调递增。

### 2. 受信门禁（`mdlog:v1` 头）
- **击穿场景构造**：攻击者制作一份恶意 Markdown 文件，在首行伪造 `<!-- mdlog:v1 s=fake -->`，正文包含恶意的 ` ```vellum-widget ```` 脚本。受害者用 Vellum 打开该文件，`markdown.startsWith("<!-- mdlog:v1")` 判定为 `true`，触发自动挂载。
- **推演分析**：
  - 恶意 iframe 是否能够突破沙箱渗透到用户本地系统？
  - 核查沙箱环境多层纵深防御：
    1. `iframe` 配置 `sandbox="allow-scripts"`，无 `allow-same-origin`，处于 opaque origin；
    2. 协议 Response 响应强制注入严苛 CSP：`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`；
    3. iframe 内部绝对断网（无法向外发起 fetch、XHR、WebSocket，无法加载远程资源）；
    4. 访问 `localStorage`/`indexedDB`/`document.cookie` 直接抛出 `SecurityError`；
    5. 无 Tauri IPC 脚本注入，无法调用任何桌面系统 API；
    6. `window.parent.postMessage` 仅向上报告 `{ type: "vellum-widget:resize", height, title }`，主应用严格断言 `event.source` 并对高度实施 [80, 2000]px clamp。
- **推演结论**：
  - **防线未被穿透**。即使伪造文件头绕过「点击授权」门禁，沙箱内部的零特权环境与 CSP 仍然能彻底封死数据泄露与本地攻击面。残余风险仅限于视觉仿冒与 CPU 密集计算，属于 §7.2 明确接受的已知风险。

### 3. 双 deadline watcher
- **击穿场景构造**：扩展追加写入对话文件后，相隔不到 1ms 立即写入 `.mdlog` sidecar 文件更新心跳。`log_deadline` 与 `sidecar_deadline` 同时被激活，400ms 到期后 `file-changed` 触发前端 `reloadCurrent`。`reloadCurrent` 立即调用 `load_document`。
- **推演分析**：
  - 核查现有 `src-tauri/src/main.rs:183-195` 发现：现有 `load_document` 在加载文档时，会无条件执行 `*watcher_lock = None`，将旧 watcher drop 掉并重新创建！
  - 若 `file-changed` 先发导致 `load_document` 执行，drop watcher 会导致旧线程中的 `rx` 断开并退出循环，**此时与它相差几毫秒的 `sidecar_deadline` 会随着旧线程的被 drop 而瞬间夭折**！
- **推演结论**：
  - **发现重要实现细节矛盾**：同文件热重载时不应重建 watcher！详见下文「新发现问题」。

### 4. 底部跟随与 `pendingScrollRef` 同 effect 仲裁
- **击穿场景构造**：用户正在贴底阅读（`isAtBottom = true`），新消息追加进入，Markdown 渲染后高度暴增，且新消息中包含需要异步加载的本地图片（`MarkdownImage` 走 `resolve_asset` 异步转 base64）和需要 postMessage 异步计算高度的 widget 沙箱。
- **推演分析**：
  - 初次渲染完成的瞬间，图片与沙箱高度尚未就绪，`container.scrollTop = container.scrollHeight` 落在一个较矮的高度上；
  - 100~300ms 后，图片 base64 返回、iframe 高度通过 postMessage 回传，文档被持续撑高几百像素；
  - 若仅做一次性赋值，页面会脱离底部，用户必须手动拖动滚动条；若此时又有新消息进来，`isAtBottom` 判定将为 `false`，导致后续自动跟随永久失效。
- **推演结论**：
  - v2 引入的 **ResizeObserver 5 秒落位守护机制**能够完美接管该场景：在尺寸撑大时持续调用平滑落底，且用户主动向上滚动或 5s 超时后自动解除守护，彻底化解了异步撑高漂移问题。

### 5. LRU 10 个 iframe 与懒挂载
- **击穿场景构造**：文档包含 15 个 widget，用户快速按 PageDown 或拖拽滚动条穿过文档，多个 widget 在几十毫秒内相继触发进入与离开视口。
- **推演分析**：
  - 若每个进入视口的 widget 都立即调用 `invoke("register_widget")`，且被淘汰的 widget 立即调用 `unregister_widget`，会引发密集的 IPC 调用与组件状态重建。
  - v2 规定：当第 11 个 widget 申请挂载时，最久离开视口的 widget 卸载其底层 iframe 并**退化为休眠占位块（「交互已休眠 · 点击查看」按钮）**。
  - **关键防线**：当用户往回滚动时，该休眠占位块**不会**再次自动挂载，必须等待用户显式点击按钮才重新激活并刷新 LRU。
- **推演结论**：
  - 必须点击激活的策略彻底切断了快速穿梭滚动时的「挂载 ⇄ 卸载 ⇄ 重新挂载」无限震荡循环，IPC 频率完全受控。

---

## 五、新发现问题清单

### [应当修复] §4.3 / §4.7 / §10：同文件热重载（`load_document`）时不应 drop 并重建 `AppState.watcher`
- **位置**：`src-tauri/src/main.rs:183-195`、spec §4.3、§4.7 与 §10。
- **理由**：
  现有 `src-tauri/src/main.rs:183-195` 在 `load_document` 中写道：
  ```rust
  let mut watcher_lock = state.watcher.lock()...;
  *watcher_lock = None;
  match watcher::watch_file(app_handle.clone(), canonical.clone()) {
      Ok(w) => *watcher_lock = Some(w),
      ...
  }
  ```
  在普通阅读场景下，每次重载重建 watcher 影响不大；但在 mdlog 高频追加场景下，每 400ms 触发一次 `reloadCurrent`。如果每次都无条件 drop 旧 watcher 并重新向操作系统注册目录监听：
  1. 旧 watcher 线程被 drop 时，信道断开，正在内部计时的 `sidecar_deadline` 会被意外杀死，导致徽章状态变更事件丢失；
  2. Windows 操作系统底层的目录变更通知句柄每几秒被频繁创建与销毁，存在资源震荡隐患。
  §4.3 已经对注册表做出了「仅当规范化 canonical 路径改变时才清空」的英明决议（D14）。
- **修法建议**：在 `main.rs` 的 `load_document` 中，对 watcher 的重建增加相同的路径守卫：**仅当 `state.current` 记录的路径发生改变时（切换到新文档），才重建 watcher**；同一文档的热重载保持现有 watcher 持续运行。

### [应当修复] §4.3：`read_mdlog_state` 使用 Win32 `OpenProcess` 后需显式调用 `CloseHandle` 释放句柄
- **位置**：spec §4.3。
- **理由**：
  在 Windows 平台下，调用 `windows_sys::Win32::System::Threading::OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)` 时，若目标进程存在且权限允许，OS 内核会创建一个进程内核对象句柄并返回非零 `HANDLE`。
  根据 Win32 编程规范，使用者必须在完成状态检测后调用 `windows_sys::Win32::Foundation::CloseHandle(handle)` 释放句柄。否则，前端每收到一次 `mdlog-state-changed` 调用一次 `read_mdlog_state`，Vellum 进程就会在操作系统内核中永久泄漏一个进程句柄。
- **修法建议**：在 §4.3 与实现包 1 中明确写明：检测到有效句柄后，使用 `CloseHandle` 及时关闭。

### [建议] §4.2：受信标识判定应防御 UTF-8 BOM 与首行空白，且维持 `components` 的 memo 稳定性
- **位置**：spec §4.2 与 `src/components/MarkdownDocument.tsx:395`。
- **理由**：
  1. **BOM 防御**：Windows 记事本等编辑器保存的 UTF-8 文件可能包含 Byte Order Mark（`\uFEFF`），或者文件头存在空行。若简单采用 `markdown.startsWith("<!-- mdlog:v1")`，带 BOM 的正版 mdlog 文件会被误判为非受信文档，导致 widget 全被降级为占位块。建议使用 `markdown.trimStart().startsWith("<!-- mdlog:v1")` 或 `/^\uFEFF?<!--\s*mdlog:v1/.test(markdown)`。
  2. **Memo 稳定性**：在 `MarkdownDocument.tsx` 中，`components` 对象由 `useMemo` 保护（依据 `AGENTS.md`「`components` prop 必须是 useMemo 结果」）。若直接在 `pre` 渲染器中闭包读取 `markdown`，若将 `markdown` 放入 `components` 的依赖项，则每次新消息追加（`markdown` 字符串改变）都会导致 `components` 重新分配对象引用，违背 memo 初衷。建议将 `isTrustedMdlog` 提取为外层布尔值，`components` 仅依赖 `[resolveHeadingId, isTrustedMdlog]`，在整个日志追加期间保持对象引用 100% 恒定。

---

## 六、一致性与合规性审查

1. **`DESIGN.md` 合规性**：
   - 颜色：采用单一靛蓝品牌色 `#1B365D`（主应用变量 `--brand`），无第二种强调色。
   - 底色与文字：象牙卡片 `--ivory`（`#faf9f5`）、暖纸底 `--parchment`（`#f5f4ed`）、深暖底 `--warm-sand`（`#e8e6dc`）、墨色文字 `--near-black`（`#141413`）、弱化字 `--stone`（`#6b6a64`），逐一与 `:root` 吻合。
   - 字重与圆角：无 >500 字重（仅 400 与 500）；圆角 6px 对齐 `rounded.lg`，边框使用 inset 1px 发丝描边。
   - 图标：全链路**严禁使用 emoji**（已通过制表符与字符集核验）；徽章呼吸动画具备 `prefers-reduced-motion` 豁免。
2. **`AGENTS.md` 架构与性能约束**：
   - `CodeBlock` 严格保持 `PrismLight`，禁止切回 `PrismAsyncLight`。
   - 大纲跟随保持平滑缓动同步，无额外门禁阻断。
   - `rehype-raw` 优化代价已在 §6 如实记录为既定代价并给出 2MB 分卷建议。
   - 复用 `restoreScrollPosition` 的 5 秒落位守护机制，彻底根除异步漂移。
3. **文件与预览一致性**：
   - `docs/preview/mdlog-preview.html` 中的 CSS 类命名（`.mdlog-widget`、`.mdlog-widget__bar`、`.mdlog-widget__frame`、`.mdlog-live`）与 spec 完全一致。

---

## 七、可实施性终审结论

修订后的 v2 设计文档条理清晰、技术事实扎实，逐字节格式与平台底层协议细节完备，阻断性与应当修复项已全部闭环。

**最终结论：通过（Approved）**。

本设计文档已完全具备直接指导进入 `subagent-driven-development` 实施计划的条件。在拆解工作包 1～5 时，将上述「同文件热重载不重建 watcher」、「Win32 句柄 CloseHandle」及「BOM 兼容与 components 稳定引用」作为具体实施指导要点写入相应工作包即可。
