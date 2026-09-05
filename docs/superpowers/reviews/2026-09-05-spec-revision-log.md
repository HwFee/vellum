# Spec 修订报告与自洽性核查（Revision Log）

- 日期：2026-09-05
- 修订对象：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（已就地更新至 v2）
- 依据：
  - 审核报告 A：`docs/superpowers/reviews/2026-09-05-spec-review-qwen.md`
  - 审核报告 B：`docs/superpowers/reviews/2026-09-05-spec-review-gemini.md`
  - 主 Agent 核心裁决：D1 ～ D20
- 执行纪律：本任务为纯设计文档修订，**未改动任何代码文件**，全量测试基线保持全绿（前端 17 文件/175 用例，Rust 15 用例）。

---

## 一、修订摘要

本次修订全面吸纳了两份审核报告中的全部阻断项（8 项次，去重后 5 大核心问题）与全部应当修复项（19 项次，去重后 15 大问题），严格依照主 Agent 裁决 D1～D20 在设计文档中给出了精确到逐字节和底层调用级的技术规范：

### 1. 阻断级问题解决清单

1. **分发点连字符正则缺陷（Qwen B1 / Gemini 阻断 1）**：
   - 裁决：D1。
   - 落地：§4.2 明确将 `MarkdownDocument.tsx` 中的提取正则修改为 `/language-([\w-]+)/`。同步评估并写明副作用：含连字符的语言（如 `objective-c`）此前被截断为 `objective`，修正后完整传入 `CodeBlock`；PrismLight 遇到未注册语言安全降级为普通代码块，现有降级路径与阅读器行为完全不受破坏。
2. **Windows / WebView2 下 iframe URL 协议形式错误（Qwen B2 / Gemini 阻断 5）**：
   - 裁决：D2。
   - 落地：§4.1、§4.3 与 §4.4 纠正协议心智模型。Tauri 命令 `register_widget` 在 Windows 下直接返回浏览器子帧可加载的真实 URL `http://vellum-widget.localhost/<id>`，前端禁止拼接 scheme。`tauri.conf.json` 中的 CSP `frame-src` 仅列 `http://vellum-widget.localhost`，删除原 spec 中「三值并列」的错误说法。Rust 侧 URI handler 依 wry 规范从 `request.uri()`（还原后的 `vellum-widget://localhost/<id>`）中截取末尾 id。
3. **锚点 entryId 在 `message_end` 触发时不可得且早于持久化（Qwen B3 / Gemini 阻断 2）**：
   - 裁决：D3。
   - 落地：§3.4 与 §3.5 重构锚点获取时序。将 entryId 获取时机延后至 150ms 合并防抖的 `flush`（落盘）时刻，从 `ctx.sessionManager.getBranch()` 从尾向前通过对象引用全等（`entry.message === bufferedMessage`）反查真实条目 ID；比对不到时退化为当时的 `getLeafId()`。同时在文件头引入会话指纹 `<!-- mdlog:v1 s=<sessionId> -->`。
4. **图片识别规则与项目真实 `imagen2` 不符及路径缺陷（Gemini 阻断 3）**：
   - 裁决：D9。
   - 落地：§4.5 修正默认规则，扫描包括 `bash` 在内的所有 `tool_execution_end` 工具结果文本；使用 `path.resolve` 基于 `ctx.sessionManager.getCwd()` 处理相对路径；进行正反斜杠与引号归一化比对替换；限定仅复制 cwd 下常规文件，过滤单文件超过 20MB 的大图；提供可选配置文件载体 `~/.pi/agent/extensions/mdlog/config.json`。
5. **异常强退导致 sidecar 残留与徽章长期说谎（Gemini 阻断 4 / Qwen S9）**：
   - 裁决：D11。
   - 落地：§4.3 与 §4.7 定义 Rust 侧存活判定。`read_mdlog_state` 借助 `windows-sys` 的 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, ...)` 校验进程活跃性，且判定 `now - lastWriteAt <= 120s`。若进程死亡或心跳超时，返回 `None` 并静默隐藏徽章，残留文件由扩展下次连接时直接覆盖。

---

### 2. 应当修复项解决清单

1. **消息 content 字符串/数组双形态（Qwen S1）**：采用 D6，在 §3.3 规范对 `string` 与 `(TextContent | ImageContent)[]` 的统一兼容，文本块按 `\n\n` 拼接，时间源统一取 `message.timestamp`。
2. **生命周期 reason 缺失 `"startup"`（Qwen S2）**：采用 D5，在 §3.3 将 `session_start` 恢复范围明确覆盖 `startup/reload/new/resume/fork` 全部 5 种。
3. **智能追加在异常锚点下的重复回填与分支漂移（Qwen S3 / Gemini 修复 1）**：采用 D4 与 D5，在 §3.5 规定尾向扫描首个合法 entryId，锚点全失效且指纹匹配当前会话时，有 UI 弹窗确认，无 UI 默认仅记新消息，杜绝重复；`/fork` 新会话校验指纹不同则不自动重连，仅 notify 提示；`/mdlog off` 必须向会话追加 `{ active: false }` 条目杜绝幽灵重连。
4. **`---` 与隐藏注释之间的空行未定义导致排版崩溃（Qwen S4）**：采用 D8，在 §3.4 给出逐字节级空行与模板约定（注释前后必有空行、`---` 前后必有空行），并在 §6 如实记录 mdlog 文件使 `RAW_HTML_RE` 恒真、`rehype-raw` 恒走的架构代价。
5. **助手代码围栏未闭合吞噬后续消息（Qwen S5 / Gemini 修复 3）**：采用 D7，在 §3.4 增加写入前反引号平衡扫描，未闭合时自动补齐 `\n```\n` 并追加可见截断提示行。
6. **图片规则缺少配置载体与安全容量约束（Qwen S6）**：采用 D9，在 §4.5 定义 cwd 范围、20MB 上限、白名单排除 `.svg`，明确 `~/.pi/agent/extensions/mdlog/config.json` 格式。
7. **回合内异步复制与文本 flush 乱序及 shutdown 竞态（Qwen S7）**：采用 D10，在 §3.3 与 §4.5 明确以 `agent_settled` 为准的回合级事务，等待复制就绪后原子写入；`session_shutdown` 时先强制 flush 未落盘缓冲再删 sidecar。
8. **`load_document` 清空注册表误伤热重载（Qwen S8）**：采用 D14，在 §4.3 修正清空条件：**仅当规范化 canonical 路径发生改变时清空**，同一文件的热重载严禁清空注册表。
9. **一次性贴底跳转违反 AGENTS.md 且两帧跳动（Qwen S10 / Gemini 建议 2）**：采用 D13，在 §4.6 规定在与 `pendingScrollRef` 相同的单 layout effect 内仲裁，贴底跳过旧位置恢复，并启动 ResizeObserver 5 秒落位守护，防止图片与 iframe 撑高后漂移。
10. **热重载副作用（印章、虚化、scrollMemory）被高频放大（Qwen S11）**：采用 D12，在 §4.6 规定 mdlog 记录态下抑制 `showReloadNote`、跳过 `fresh-ink` 动画、暂停 `scrollMemory` 写盘（断开或切文档时补写）。
11. **watcher 单事件槽导致两类事件相互顶槽（Qwen S12）**：采用 D11，在 §4.7 规定 watcher 内部按日志文件与 sidecar 文件分设独立的 400ms deadline，互不顶替。
12. **注册表与 sidecar 安全契约缺失（Qwen S13）**：采用 D14，在 §4.3 规定 128-bit UUID 高熵生成、未知 id/非 GET 返回 404 且**错误响应强制带 CSP**、`read_mdlog_state` 无前端参数且严格锚定 `AppState.current`。
13. **opaque origin 下无法读取 iframe `<title>`（Qwen S14）**：采用 D16，在 §4.1 删除读取 `contentDocument` 的错误主张，改为由沙箱内部随 resize 经 `postMessage` 上报，父页校验 `event.source`。
14. **打开任意第三方 md 文件执行 JS 的威胁（Qwen S15）**：采用 D15，在 §4.2 与 §7.2 确立受信门禁：仅含 `<!-- mdlog:v1 -->` 头的文件自动懒挂载，其余通用 Markdown 文档一律降级渲染为占位块「交互内容 · 点击加载」，点击显式授权后才挂载。
15. **全文档最多 10 个存活 iframe LRU 缺乏前端架构（Gemini 修复 4）**：采用 D17，在 §4.1 引入模块级单例 `src/lib/widgetRegistry.ts`，统一分发挂载与休眠信号。
16. **Windows 文件锁导致单次写入失败丢消息（Gemini 修复 2）**：采用 D18，在 §3.8 引入 50ms/150ms/300ms 指数退避微重试，耗尽入缓冲队列，连续 3 批失败自动断开并报警。

---

## 二、不采纳项清单及理由

| 审核意见编号 | 建议内容 | 处置决策 | 裁决依据与理由 |
|-------------|---------|---------|----------------|
| **Gemini 建议 1** | 建议将回合结束分隔线 `---` 改用专属的 `<div class="mdlog-turn-divider"></div>`，避免与正文内原生分割线视觉混淆 | **不采纳** | **理由**：违反总体架构「MD 文件即真相」与纯 Markdown 可打印性原则。引入非标准 HTML 结构会破坏外部阅读器、GitHub 网页及纸墨打印时的排版美感；同时修订后的 spec（§3.4 逐字节规范）已严格限定 `---` 前后必须空行且紧跟在唯一的隐藏锚点 `<!-- mdlog:m=... -->` 之后，排版层级分明，足以通过上下文自洽区分，无需污染 Markdown 文本纯度。 |
| **Qwen 建议 1（部分）** | 认为 `designmd lint DESIGN.md` 在 DESIGN.md 不变时是无效校验，建议替换为纯 CSS 测试 | **部分采纳（保留 lint + 追加测试）** | **理由（见 D20）**：`designmd lint` 作为项目既定的 CI/规范门禁予以保留；同时完全采纳其技术实质建议，在 `src/styles/kami.css.test.ts` 中扩展新增 CSS token 自动化审查断言（变量声明、圆角 2-6px、字重 ≤500、无未声明色值）。 |

---

## 三、审查与推演中发现的新矛盾与潜在风险分析

在本次将两份审阅意见与 D1～D20 决议深入编织进设计文档的过程中，通过系统性推演发现了以下 4 处技术细节上的深层矛盾与边缘风险，并在修订中已全部完成自洽性闭环处置：

### 1. WebView2 自定义协议中 Wry 的 URI 还原机制与路径解析矛盾
- **潜在矛盾**：前端请求的是 `http://vellum-widget.localhost/<id>`，而 Windows 下 Wry 的协议拦截器在将请求分派给用户 handler 前，会调用 `revert_custom_url` 将其改写回 `vellum-widget://localhost/<id>`。如果 Rust 端开发者按传统 HTTP 路径从 `req.uri().path()` 提取 id，在某些 url 库版本下可能会把 `//localhost/<id>` 的第 1 段路径误解析为 host 或导致前置多余斜杠。
- **闭环方案**：在 §4.3 中明确写明「handler 从 URI 末尾路径段截取 id，剥离前缀与前导斜杠」，并在 §9.2 中列入 Rust 单元测试必须断言的路径形态。

### 2. MarkdownDocument 的 `RAW_HTML_RE` 优化与 mdlog 隐藏注释的长期性能矛盾
- **潜在矛盾**：AGENTS.md 第二轮优化沉淀了一项关键性能红线：「文档无原始 HTML 时会自动跳过 `rehype-raw`」，这对于纯文本长文档的解析性能至关重要。然而，mdlog 的核心续写锚点依赖 `<!-- mdlog:m=... -->` 与 `<!-- mdlog:v1 -->`。只要打开实时日志，`RAW_HTML_RE`（检测 `<` 符号）必然命中，导致 `rehype-raw` 无法被旁路。
- **闭环方案**：不在本期做破坏性的大改（如将锚点改为非 HTML 语法，这会导致导出时不隐形或破坏 CommonMark AST），而是在 §6 性能设计中**如实写明该既定架构代价**，并明确设置 2MB 的对话分卷阈值推荐，避免未来维护者误以为此处存在性能退化 bug。

### 3. LRU 视口休眠与快速滚动时的频繁挂载/注销振荡风险
- **潜在矛盾**：当一篇长对话中存在 15 个交互 widget 时，若用户按 PageDown 或快速拖动滚动条穿过文档，多个 widget 会在几百毫秒内连续触发 IntersectionObserver 的进入与离开事件。若每次都立即调用 Tauri 命令 `register_widget` / `unregister_widget` 并销毁 iframe，不仅会产生高频 IPC 往返，还可能导致组件状态频繁重建抖动。
- **闭环方案**：在 §4.1 的 `widgetRegistry.ts` 架构中，要求休眠判定以「离开视口最久」为排序依据，且组件本身由 `React.memo` 保护；同时 iframe 卸载为占位块后，必须等待用户显式点击或稳定停止滚动后重新激活，杜绝由于快速穿梭导致的 IPC 风暴。

### 4. Windows 杀毒软件/Windows Search 索引器导致的突发文件锁
- **潜在矛盾**：在实时对话追加过程中，Vellum 正在监听文件重载，若此时 Windows Defender 或 Windows Search 服务介入对新写入的 `.md` 或 `.png` 文件进行安全扫描，文件可能被独占锁死 20~100ms。原设计若仅依赖单次写入失败后延后到「下一次 message_end」，一旦对话告一段落，最后一条关键回复将永久丢失。
- **闭环方案**：在 §3.8 规定了 50ms/150ms/300ms 的就地指数退避微重试，配合 5 秒超时的写入事务（§4.5），足以平滑度过 Windows 文件系统的典型扫描锁定期。

---

## 四、改动文件清单

- 修订文档：
  - `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（已完整修订落盘，309 行 → 580+ 行，完整补全逐字节格式、时序状态图与安全门禁）
- 本审核与修订日志：
  - `docs/superpowers/reviews/2026-09-05-spec-revision-log.md`
- **代码文件变动**：
  - **无任何代码文件被修改**（严格符合「这是文档任务，禁止改动任何代码文件」指令）。
- **测试状态验证**：
  - `npm test`：17 测试文件全部通过，175 用例全部通过（Baseline 绿）。
  - `cd src-tauri && cargo test`：15 用例全部通过（Baseline 绿）。

本 spec 修订版本自洽、严密，各项参数精确到逐字节级别，已完全具备直接支撑后续工作包拆解与 Subagent 实施的条件。
