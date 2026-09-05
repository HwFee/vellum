# Pi 对话实时记录（mdlog）与沙箱交互块 · 设计文档

- 日期：2026-09-05
- 版本：v3（经第二轮双审阅定点修订）
- 状态：已通过第二轮双审阅（reviewer-qwen & reviewer-gemini），全量落实 Z1 阻断项、Y1~Y12 修复项、G1~G2 修复项及各项建议，精确至「照字面实现即正确」，可直接支撑实现计划拆包与子智能体实施
- 范围：Vellum 桌面应用改造 + pi 全局扩展 `mdlog` + 项目内技能 `vellum-mdlog`

## 1. 背景与目标

用户在 pi（编码 Agent CLI）中与 Agent 对话时，希望把整个对话过程实时同步到一个 Markdown 文档，并由 Vellum（素笺）渲染为「纸墨风格」的可读记录。除纯文字对话外，Agent 还可以在文档中输出**自包含 HTML 交互块**（用于讲解事实的可视化演示），Vellum 在**沙箱**中渲染它们；Agent 生成的**图片**也要自动出现在记录里。

已确认的关键决策（来自需求澄清与审阅决议）：

| 决策点 | 结论 |
|--------|------|
| 传输通道 | pi 扩展追加写 MD 文件；Vellum 复用现有文件监听 + 静默热重载管线 |
| 连接时历史处理 | 智能追加（基于尾向扫描与会话条目比对增量续写，会话指纹兜底，见 §3.5）；`--full` / `--append` 强制覆盖 |
| 记录范围 | 仅用户与助手的文字消息；工具调用不入文档（图片产物除外，见 §4.5） |
| 交互块形态 | 任意自包含 HTML/JS，沙箱 iframe 渲染，绝对断网；受信文件自动懒挂载，非受信文件需用户点击授权（见 §7） |
| 风格 | 全链路遵守 DESIGN.md（kami 纸墨），无 emoji |
| 技能安放 | 项目内 `.pi/skills/vellum-mdlog/`（真实目录，非全局仓库联接） |
| 研发模式 | 实现按工作包派子智能体完成，主 Agent 任审核与顾问 |

非目标（YAGNI）：逐字流式渲染；工具调用折叠块；多文件同时连接；远程图片沙箱化；深色模式。

## 2. 总体架构与数据流

```
pi 进程（全局扩展 mdlog）
  ├─ message_end 事件       → 登记 + setTimeout 调度（严禁 await）；缓冲用户/助手文本
  ├─ tool_execution_end     → 登记待复制图片，仅复制 mtime >= 回合-5s 且在 session cwd 下的文件
  │                            复制至 <对话>.md 同级 mdlog-assets/（文件名净化为 [A-Za-z0-9._-]）
  ├─ agent_settled / flush  → 串行 Promise 链事务：反查 entryId（或降级记录 anchorLost）
  │                            校验并补齐围栏 → 原子追加写入 <对话>.md（消息正文 rstrip + 锚点 \n\n）
  └─ 连接状态                → 维护 sidecar <对话>.md.mdlog：每 30s 刷新 heartbeatAt，写内容刷 lastWriteAt
                                      │ 文件系统
Vellum 进程                 ▼
  ├─ watcher.rs             → 双路独立 400ms 防抖；仅规范化路径改变时重建 watcher（同文件重载不重建）
  │                            - 目标日志文件变动 → emit file-changed → 前端静默热重载
  │                            - <日志>.mdlog 变动 → emit mdlog-state-changed → 徽章状态复查
  ├─ read_mdlog_state       → 无参系统命令（锚定当前文件）：OpenProcess + GetExitCodeProcess 校验 pid 存活
  │                            （成功后 CloseHandle）且 now - heartbeatAt ≤ 120s 判活；返回 { lastWriteAt, heartbeatAt, expiresAt }
  ├─ MarkdownDocument       → isTrustedMdlog 布尔经 useMemo 传入 components 依赖，保持引用恒稳定；
  │                            正则 /language-([\w-]+)/ 分发：受信任 vellum-widget → WidgetSandbox，否则占位块
  ├─ WidgetSandbox          → 由单例 widgetRegistry（上限 10）协调 LRU 挂载/休眠，停止滚动 400ms 后才淘汰；
  │                            invoke("register_widget") 返回 { id, url }，只用 url 加载到沙箱 iframe
  ├─ reloadCurrent          → 热重载副作用抑制（跳过印章、跳过 fresh-ink 全文模糊、暂停 scrollMemory 写盘）
  │                            单 layout effect 仲裁：若贴底则执行 ResizeObserver 落位守护防漂移
  └─ 文档尾部 chrome         → sidecar 存活 → 渲染「记录中 · PI」徽章；按 expiresAt 设 setTimeout 自动复查隐藏
```

设计要点：**MD 文件即真相**。扩展只做「让文件与会话保持一致」；Vellum 不与 pi 建立任何进程间长连接，所有实时性来自文件监听管线。对话记录脱离 Vellum 也是一份干净规范的 Markdown。

## 3. pi 扩展 `mdlog`

### 3.1 安装与文件布局

```
~/.pi/agent/extensions/mdlog/
├── index.ts        # 扩展入口（默认导出工厂函数）
├── config.json     # 可选全局配置文件（图片提取与容量白名单）
└── README.md       # 用法说明与安全约定
```

全局安装（对所有项目生效），运行依赖仅用 Node.js 内置模块（`node:fs`、`node:path` 等）与 `@earendil-works/pi-coding-agent` 类型定义。

### 3.2 命令

扩展注册顶级命令 `/mdlog`：

| 命令 | 行为 |
|------|------|
| `/mdlog <路径>` | 连接到指定 .md 文件（不存在则创建并写入文件头）；默认随后唤起系统关联程序打开该文件 |
| `/mdlog off` | 断开连接：向会话追加断开标记，删除 sidecar，停止写入 |
| `/mdlog status` | 显示当前连接状态、已写入消息数、最近写入时间 |

命令参数解析规则：

1. `handler(args, ctx)` 接收的 `args` 为整行输入字符串。
2. 修饰符（flags）仅识别首尾独立 token：`--full`（强制回填全量历史）、`--append`（强制仅追加连接后新消息）、`--no-open`（不唤起外部打开）。
3. 路径提取：剥离已知 flags 后的剩余字符串执行 `trim()`，并剥离成对的首尾双引号或单引号（支持含空格的 Windows 路径如 `C:\My Notes\session.md`）。
4. 保留子命令：`off` 与 `status` 为系统保留字，当作为唯一非 flag 参数时优先按子命令分发，不得被解释为文件名。
5. 同名提示：若 pi 环境已加载同名命令，系统将追加 `/mdlog:1` 等后缀，扩展注册时需提示用户支持别名。
6. `status` 输出格式：
   - 已连接时：
     ```
     连接文件: C:\workspace\notes\session.md
     已写消息: 14 条
     最近写入: 2026-09-05 14:32:05
     会话标识: a1b2c3d4e5f6
     ```
   - 未连接时：
     ```
     当前未连接任何文件。使用 /mdlog <文件路径> 开始记录。
     ```

系统关联程序唤起策略：
连接建立后（未传 `--no-open`），扩展通过 `node:child_process` 执行 `cmd /c start "" "<文件绝对路径>"`。若执行抛错或用户系统未将 `.md` 关联到 Vellum，扩展通过 `ctx.ui.notify` 给出温和提示：「已建立记录连接。如未自动在 Vellum 中打开，请手动在 Vellum 中打开该文件。」

### 3.3 事件接线与生命周期

扩展挂载以下核心生命周期与事件处理：

- **`session_start`（reason 覆盖 `startup`、`reload`、`new`、`resume`、`fork` 全部 5 种）**：
  - 遍历当前分支 `ctx.sessionManager.getBranch()`，找到最后一条 `type === "custom"` 且 `customType === "mdlog:connection"` 的条目。
  - 若最后一条 connection 条目的 `active === false`（此前已执行 `/mdlog off`），则不进行恢复。
  - 若 connection 条目的 `sessionId` 与当前会话 `ctx.sessionManager.getSessionId()` 不一致（例如通过 `/fork` 创建的新会话分支）：**绝对不自动重连原文件**，避免新分支内容污染破坏父会话日志；通过 `ctx.ui.notify` 提示「检测到历史记录配置，如需记录请执行 `/mdlog <文件>` 手动连接」。
  - 若 `active === true` 且 `sessionId` 一致：执行静默重连，校验目标文件，启动 30s 心跳定时器重建 sidecar 文件。**静默重连同样执行 §3.5 智能追加扫描算法（Y6-f）**；交互询问确认判据为 `ctx.hasUI && ctx.ui.confirm`。
- **`message_end`**：
  - 拦截 `event.message`，仅处理 `role === "user" | "assistant"` 的消息。
  - **消息内容双形态处理**：`UserMessage.content` 与 `AssistantMessage.content` 既可能为 `string`，也可能为 `(TextContent | ImageContent)[]`。若为数组，提取所有 `type === "text"` 的项并以 `\n\n` 拼接；若为纯 `string` 则直接使用；若均无文本则跳过。
  - **时间源**：统一取 `message.timestamp`（Unix 毫秒时间戳），本地化格式化为 `HH:MM`；若该消息日期与前一条消息跨天，则格式化为 `MM-DD HH:MM`。
  - **事件链非阻塞调度（Y12）**：handler 仅同步暂存消息至待写入内存缓冲区，并调度单定时器事务（`setTimeout`）；**严禁在 `message_end` handler 内 `await` 磁盘写入或异步图片复制事务**（避免阻塞 pi 的 CLI 交互主线程、idle 信号与 `-p` 模式退出）。
- **`tool_execution_end`**：
  - 扫描工具执行结果，识别图片文件并推入待复制队列，同样由 `setTimeout` 异步调度，**严禁在 handler 内 `await`**（见 §4.5）。
- **`agent_settled`（或 150ms 合并防抖 flush）**：
  - 写入事务触发点：所有写入事务在 timer 回调中通过**严格串行的 Promise 链**互斥执行，确保文件追加顺序严格单调递增，杜绝多工具调用或连续提问时的并发穿插与乱序。在 flush 时刻反查真实条目 ID，补齐代码围栏，一次性原子落盘。
- **`session_shutdown`**：
  - 必须**先强制执行 flush** 将所有未落盘的缓冲消息写入文件（允许同步落盘文本；若有进行中的图片复制，等待超时上限缩减为 1s，见 Y12），随后调用 `clearInterval` 清除心跳定时器，再执行 `fs.unlinkSync` 删除 sidecar 文件，杜绝退出时丢失末尾消息。

### 3.4 逐字节级 Markdown 日志格式规范

文件头（创建文件或回填空文件时写入一次）：

```markdown
<!-- mdlog:v1 s=<sessionId> -->

# Pi 对话记录

```

用户消息模板（必须严格遵守空行分布）：

```markdown
> **你** · 14:32
>
> 用户第一行输入
> 用户第二行输入

<!-- mdlog:m=<entryId> -->

```

助手消息模板（标准）：

```markdown
**Pi** · 14:32

助手正文内容（支持标准 Markdown 与 ```vellum-widget 围栏块）

<!-- mdlog:m=<entryId> -->

```

助手消息模板（含图片与截断修复）：

```markdown
**Pi** · 14:32

助手正文片段：
```ts
console.log("未闭合代码");
```
*(本条消息被截断，已自动补齐代码围栏)*

![生成的图片](mdlog-assets/diagram.png)

<!-- mdlog:m=<entryId> -->

---

```

回合结束分隔线模板：

```markdown
---

```

逐字节格式规则（消除任何解析歧义）：

1. **文件头**：首行写入 `<!-- mdlog:v1 s=<sessionId> -->\n\n# Pi 对话记录\n\n`。注释后必须保留一个空行，防止 CommonMark 将 `#` 标题吞入 HTML block。
2. **正文规整与空行约定（唯一字符串拼接公式，Y5）**：
   - 写入前对用户正文与助手正文统一执行尾部空白字符剥离（`rstrip`）：`content = text.replace(/\s+$/, "")`；
   - 锚点行 `<!-- mdlog:m=<entryId> -->` 前固定拼接 `\n\n`，后固定拼接 `\n\n`；
   - 分隔线 `---` 前固定拼接 `\n\n`，后固定拼接 `\n\n`。
3. **用户消息拼接公式（Y5）**：
   - 发言者行：`> **你** · <时间>\n`；
   - 每一行正文（含空行）前置引用符：非空行写作 `> <内容>`，纯空行写作 `>`；
   - 正文处理与锚点输出收拢为唯一公式（删除原规则 2 与规则 6 重复写出锚点的歧义）：
     ```ts
     const clean = userText.replace(/\s+$/, "");
     const lines = clean.split("\n");
     const quoted = lines.map(line => line.length > 0 ? `> ${line}` : ">").join("\n");
     const chunk = `> **你** · ${time}\n>\n${quoted}\n\n<!-- mdlog:m=${entryId} -->\n\n`;
     ```
4. **助手消息拼接公式（Y5）**：
   - 发言者行：`**Pi** · <时间>\n\n`；
   - 正文：`assistantText.replace(/\s+$/, "")`；
   - 若围栏未闭合，正文后追加补齐行：`\n```\n*(本条消息被截断，已自动补齐代码围栏)*`；
   - 若当前回合生成了图片且助手正文未引用，追加补偿图片行：`\n\n![生成的图片](mdlog-assets/${finalCleanFileName})`；
   - 锚点行收拢至统一公式：在正文（及围栏补齐行、补偿图片行）后，固定追加 `\n\n<!-- mdlog:m=${entryId} -->\n\n`；
   - 若当前消息为一个应答回合的终点（助手消息），紧接追加 `---\n\n`。
5. **CommonMark 围栏平衡扫描定义（Y5-c）**：
   - 围栏起始行：行首允许 0~3 个空格缩进，紧接连续 ≥3 个同种字符（反引号 `` ` `` 或波浪线 `~`），后面可跟可选的语言标识符；
   - 围栏闭合行：行首允许 0~3 个空格缩进，必须使用与起始行相同的围栏字符，且字符长度必须 ≥ 起始行的字符长度，行尾除空白字符外不得有任何其他字符；
   - 行内的内联代码反引号（例如 `` `code` `` 或 ` ```inline``` ` 但不在独立行）不计入围栏开闭状态；
   - 扫描算法必须逐行遍历正文，维护围栏开闭栈及当前生效的围栏字符与长度；在正文结尾若围栏仍处于打开状态，即判定为未闭合并执行自动补齐。
6. **关键排版红线**：
   - `<!-- mdlog:m=... -->` 注释前后均必须有空行（固定前后 `\n\n`）；`---` 分隔线前后也必须有空行（固定前后 `\n\n`）。严禁注释行与 `---` 紧挨，彻底杜绝 CommonMark HTML block 吞并分隔线或将段落误解析为 setext H2 下划线。

### 3.5 智能追加与扫描算法

锚点获取时机与降级取舍约定：
由于 pi 扩展框架中 `message_end` 事件触发严格早于会话持久化（`AgentSession._emitExtensionEvent` 先于 `sessionManager.appendMessage`），`event.message` 对象本身无 `id`。
因此，真实 `entryId` 统一在 **150ms 合并防抖的 flush 时刻**获取：调用 `ctx.sessionManager.getBranch()`，从末尾向前扫描，通过对象全等引用比对 `entry.message === bufferedMessage` 获取条目的 `entry.id`。

**比对失败降级方向（Y6-e）**：
- 若本批包含多条消息，部分消息比对成功：写出「本批最后一条成功按引用命中的 entryId」；
- 若整批消息均比对不到（如极端外部改写或条目脱节）：**本批绝对不写锚点注释**（严禁写出空值或无法解析的伪锚点），并在 sidecar 中记录 `anchorLost: true`；扩展下次连接时检测到 `anchorLost: true`，直接退化进入 4a 会话指纹确认路径。

智能追加扫描算法：

1. 打开目标日志文件。若文件不存在或为空，先写入文件头，随后全量回填会话当前分支的所有历史消息。
2. 若文件存在内容，从文件末尾向前逐行扫描回退：
   - **伪锚点防御（Y6-d）**：扫描时同步维护围栏开闭状态（或预先正向扫描标记代码围栏行号区间），**凡是落在未闭合或已闭合围栏代码块内部的锚点行一律忽略**，不作为合法锚点候选；
   - **回退直到命中（Y6-a）**：从文件末尾向前逐行回退，**直到找到第一个其 `entryId` 属于当前分支 `ctx.sessionManager.getBranch()` 的有效锚点，或到达文件开头**。绝非「首个正则命中即停」。
3. 若在回退过程中找到属于当前分支的有效锚点：
   - 定位该 `entryId` 在当前分支中的位置，将其后续产生的新消息作为增量，按格式规范追加到文件末尾。
4. 若扫描至文件开头均未命中任何属于当前分支的锚点：
   - **会话指纹提取正则（Y6-b）**：提取文件首行的会话指纹，正则写死为：
     ```ts
     const FINGERPRINT_RE = /^\uFEFF?\s*<!--\s*mdlog:v1\s+s=([^\s>]+)/;
     ```
     （准确匹配包含连字符的完整 UUID `sessionId`，显式容忍 UTF-8 BOM 与前导空白）。
   - **分支 4a（文件指纹等于当前 sessionId）**：说明文件属于当前会话，但由于分支移动、历史压缩或用户编辑导致锚点断裂。
     - 若处于可交互环境（`ctx.hasUI && ctx.ui.confirm` 可用），弹窗询问用户：「检测到该文件属于当前会话，但未找到匹配的续写锚点：[回填全量] 还是 [仅记新消息]？」。
     - 若处于无交互环境（`!ctx.hasUI`，如 `-p`、RPC 或无 UI 批处理模式），默认选择「仅记新消息」，防止重复回填。
   - **分支 4b（文件指纹不同，或文件无指纹头）**：说明该文件是新指定的文件、外部文件或其他会话生成的文件。
     - **一次性原子重写（Y6-c）**：执行一次性原子文件重写，把文件头 `<!-- mdlog:v1 s=<sessionId> -->\n\n# Pi 对话记录\n\n` 插入到**文件最顶部（第 1 行）**，用户原有内容完整保留在文件头之下，文末追加两个换行后再写入当前分支的全量消息。由此保证文件首行恒为合法指纹，与 Vellum 受信门禁的首行判定完全一致，杜绝指纹丢失与二次重连时的重复回填。
5. 命令行修饰符优先级与静默重连（Y6-f）：`--full` 强制跳过锚点检查回填全量；`--append` 强制跳过回填仅监听新消息；`session_start` 静默恢复同样执行本扫描算法。

### 3.6 状态持久化与断开

- **连接建立**：调用 `pi.appendEntry("mdlog:connection", { active: true, path: targetPath, sessionId: ctx.sessionManager.getSessionId(), timestamp: Date.now() })` 写入会话历史。
- **主动断开（`/mdlog off`）**：
  - 必须调用 `pi.appendEntry("mdlog:connection", { active: false, timestamp: Date.now() })`。后续会话启动或重载时，以当前分支上**最后一条** connection 条目为准，检测到 `active === false` 则绝不自动重连，彻底消灭幽灵重连。
  - 删除 `<文件>.mdlog` sidecar 文件。
  - 清空内存中未写入的待处理队列，取消所有防抖计时器。

### 3.7 sidecar 状态文件与进程存活

路径：`<对话>.md.mdlog`（与日志文件同目录同基名）。结构：

```json
{
  "version": 1,
  "sessionId": "<pi session id>",
  "pid": 12345,
  "connectedAt": 1757000000000,
  "lastWriteAt": 1757000000000,
  "heartbeatAt": 1757000000000,
  "anchorLost": false
}
```

生命周期、心跳写入方与覆盖（Z1）：
- **`heartbeatAt` 心跳刷新**：扩展在连接建立期间通过 `setInterval` 每 30s 刷新一次 `heartbeatAt` 并写盘 sidecar；连接断开（`/mdlog off` 或 `session_shutdown`）时调用 `clearInterval`。
- **`lastWriteAt` 写入记录**：仅在回合内容成功追加写入日志文件后更新 `lastWriteAt` 并落盘。
- **两字段语义明确分离**：空闲长回合（如耗时命令执行、工具长时间运行或用户长时阅读思考）无内容写入时，`lastWriteAt` 保持不变，但 `heartbeatAt` 持续每 30s 刷新；Vellum 后端依 `heartbeatAt` 判活，徽章绝不误失效。
- 正常退出时由 `session_shutdown` 钩子删除 sidecar 文件。
- 若终端被强制关闭、断电或进程崩溃，残留的 sidecar 文件由 Vellum 后端通过 pid 和超时阈值进行存活仲裁（见 §4.3 与 §4.7）。扩展下次重新连接该文件时，直接用新进程信息覆盖已存在的 stale sidecar，无需用户手动清理。

### 3.8 写入失败与指数退避重试

Windows 环境下由于杀毒软件、索引器或 Vellum 重载读取可能引发短暂文件锁竞争（`EBUSY`/`EPERM`）。扩展写入模块采取以下防护：
- 单次追加 I/O 出错时，就地执行 3 次指数退避微重试（延迟依次为 50ms、150ms、300ms）。
- 若微重试后仍失败，将本批内容放回待写入队列，等待下一个合并周期重试。
- 若连续 3 批次写入均完全失败，判定磁盘通道不可恢复：自动断开连接，调用 `fs.unlinkSync` 删除 sidecar 文件，并通过 `ctx.ui.notify` 弹出系统警告通知用户。

## 4. Vellum 改造

### 4.1 WidgetSandbox 组件（新增 `src/components/WidgetSandbox.tsx`）

职责：把一段自包含 HTML 字符串安全地渲染为沙箱 iframe。

- **Props**：`{ html: string, autoMount?: boolean }`。
- **Memo 与位置稳定**：组件本体使用 `React.memo`（以 `html` 字符串为浅比对依据）。在 append-only 的日志追加模式下，已有 widget 在 DOM 树中的相对位置保持稳定，命中 memo 时跳过重渲染，iframe 实例与内部交互状态完全保留。若用户手动编辑文档中段导致 widget 移位，发生重新挂载属可接受的非核心场景代价。
- **懒挂载与占位状态**：
  - 若 `autoMount === false`（非受信文档，见 §7）：初始渲染为占位块「交互内容 · 点击加载」，用户点击后才触发挂载。
  - 若 `autoMount === true`（受信 mdlog 文档）：由 `IntersectionObserver`（rootMargin 200px）监听进入视口后触发挂载。
- **全局存活 iframe 上限 10 机制与 widgetRegistry（Y9）**：
  - 引入模块级单例 `src/lib/widgetRegistry.ts`，维护全局已挂载 widget 的 LRU 引用列表。
  - **公共 API 签名**：
    ```ts
    export interface WidgetRegistry {
      register(id: string): void;
      release(id: string): void;
      markVisible(id: string): void;
      activate(id: string): boolean;
      requestMount(id: string): boolean;
      subscribe(id: string, onDormant: () => void): () => void;
    }
    ```
  - **状态真源与排序键**：休眠/激活状态真源完全在 `widgetRegistry` 单例中，组件仅订阅 `onDormant` 回调同步 UI 状态；LRU 排序键为最近一次 `markVisible(id)` 的时间戳。
  - **滚动抑制防抖**：滚动期间暂停淘汰；**仅在稳定停止滚动 400ms 之后**才允许执行 LRU 淘汰挂载。
  - **唤醒门禁**：被淘汰项重新进入视口时**绝对不自动复活**，退化为休眠占位块（「交互已休眠 · 点击查看」按钮），必须由用户显式点击才调用 `activate(id)` 重新激活并刷新 LRU。
- **降级责任明确分工**：
  - `MarkdownDocument` 的 `pre` 渲染器：负责长度预检（超过 512KB 直接交由普通 `CodeBlock` 渲染，不触发 widget 注册）；
  - `WidgetSandbox`：负责 IPC 级容灾（当 `invoke("register_widget")` 失败或协议加载异常时，在自身内部降级渲染传入的 fallback 普通代码块，不抛出未捕获错误）。
- **注册与 URL 加载（Y3）**：
  - 挂载时调用 Tauri 命令：`invoke<RegisterResult>("register_widget", { html })`。
  - `register_widget` 返回 `{ id: string, url: string }`（serde camelCase）。Rust 侧按平台直接返回安全可加载的 URL（Windows 平台下固定为 `http://vellum-widget.localhost/<id>`）。
  - 前端将 `id` 保存于 `useRef` 中，iframe 的 `src` 仅使用 `url`；**严禁前端解析 URL 字符串反推 id**。
  - 卸载时调用 `invoke("unregister_widget", { id })`。
- **Iframe 属性沙箱约束**：
  - `sandbox="allow-scripts"`（**绝对严禁**添加 `allow-same-origin`）。
  - `referrerpolicy="no-referrer"`。
- **高度与标题通信契约**：
  - 监听 `window.addEventListener("message", ...)`。
  - **来源严格校验**：必须断言 `event.source === iframeRef.current.contentWindow`，拒绝任何伪造广播。
  - 消息载荷格式：`{ type: "vellum-widget:resize", height: number, title?: string }`。
  - 标题更新：若收到有效的 `title` 字段，更新外层顶栏显示；若未上报或为空，顶栏标题默认回退为「交互演示」。**严禁从父文档直接读取 `iframe.contentDocument.title`**（因 opaque origin 跨域限制，读取该属性恒为 null）。
  - 高度更新：高度值经过 `Math.min(2000, Math.max(80, data.height))` clamp 约束，通过 `requestAnimationFrame` 节流写入容器样式。默认高度设为 240px。
- **样式与容器结构**（以 `docs/preview/mdlog-preview.html` 为**唯一真源**，追加至 `src/styles/kami.css`）：

```css
.mdlog-widget {
  margin: 17px 0;
  background: var(--ivory);
  box-shadow: inset 0 0 0 1px var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.mdlog-widget__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 14px;
  font: 10px/1.5 var(--mono);
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--stone);
}

.mdlog-widget__bar .state {
  letter-spacing: 0.5px;
  text-transform: none;
}

.mdlog-widget__frame {
  display: block;
  width: 100%;
  min-height: 120px;
  border: 0;
  border-top: 1px solid var(--hairline);
  background: var(--parchment);
}
```

### 4.2 MarkdownDocument 分发点

修改 `src/components/MarkdownDocument.tsx` 现有 `pre` 渲染器：

1. **语言提取正则修改**：
   将原有 `const match = /language-(\w+)/.exec(className);` 修改为：
   ```ts
   const match = /language-([\w-]+)/.exec(className);
   ```
   **副作用评估**：此前包含连字符的语言标识符（如 `objective-c`）会被错误截断为 `objective`；修改后整串 `objective-c` 完整传入 `CodeBlock`。由于 PrismLight 注册表若无该语言会自动安全降级为普通无高亮代码块，现有降级路径与高亮行为完全不受损害。
2. **受信判定与受控分发（Y1, G3）**：
   在 `MarkdownBody` 内部：
   ```tsx
   const isTrustedMdlog = useMemo(
     () => /^\uFEFF?\s*<!--\s*mdlog:v1/.test(markdown),
     [markdown]
   );
   ```
   将布尔原始值 `isTrustedMdlog` 加入 `components` 的 `useMemo` 依赖数组：`[resolveHeadingId, isTrustedMdlog]`。
   **引用稳定约束说明**：`isTrustedMdlog` 是布尔原始值（boolean）。在日志持续追加消息期间，其值恒为 `true`，`components` 对象的引用保持 100% 恒定；仅当文档在普通文档与 mdlog 之间切换时布尔值才变化。`components` 只在 `MarkdownBody` 内部消费，而 `MarkdownBody` 本身已以 `markdown` 为 memo 边界，完全不破坏 `AGENTS.md` 对 memo 结构与引用稳定的死规则。
   
   分发受控逻辑：
   ```tsx
   if (language === "vellum-widget") {
     // 长度预检拦截超限 widget
     if (code.length > 524288) {
       return <CodeBlock code={code} language="html" />;
     }
     return (
       <WidgetSandbox
         html={code}
         autoMount={isTrustedMdlog}
         fallback={<CodeBlock code={code} language="html" />}
       />
     );
   }
   return <CodeBlock code={code} language={language} />;
   ```
   **精确化 Sanitize 边界说明**：widget 的 HTML 源码作为字符串由 React props 原样直接交由 `WidgetSandbox` 渲染，整份 Markdown 文档依然完整通过 `rehype-sanitize` 保护。容器子帧内部的隔离由独立的协议响应 CSP 与 `sandbox` 属性强制保证，**Unified 管线中不为 rehype-sanitize 开放任何新的 HTML 标签例外**。

### 4.3 Rust 侧：自定义协议与注册表（`src-tauri/src/widget.rs`）

新增模块并在 `src-tauri/src/lib.rs` 中声明 `pub mod widget;`：

- **`AppState` 迁移（Y8）**：
  新建 `src-tauri/src/state.rs`（置于 `vellum_lib` crate 中），定义：
  ```rust
  use std::path::PathBuf;
  use std::sync::Mutex;
  use notify::RecommendedWatcher;

  #[derive(Debug, Default)]
  pub struct AppState {
      pub current: Mutex<Option<PathBuf>>,
      pub watcher: Mutex<Option<RecommendedWatcher>>,
  }
  ```
  在 `src-tauri/src/lib.rs` 中声明 `pub mod state;`；`main.rs` 改为 `use vellum_lib::state::AppState;`。由此 `widget.rs` 的命令可无缝引用 `State<'_, AppState>`，保证可编译。
- **协议注册与前缀匹配**：
  调用 `tauri::Builder::register_uri_scheme_protocol("vellum-widget", ...)`。
  - 请求路径解析：Windows WebView2 底层由 wry 处理后，回传给 Rust handler 的 `request.uri()` 格式为 `vellum-widget://localhost/<id>`。handler 截取末尾路径段作为 `id`。
  - 前缀匹配说明：wry 的 `is_work_around_uri` 是前缀匹配机制，`http://vellum-widget.<任意域>` 均会进入本 handler；非预期的未知请求一律返回 404。
  - 路径与方法安全校验：仅接受 GET 请求；对未知 `id`、格式非法或越界路径返回 HTTP 404。
  - **核心安全防线：强制响应头四条（Y2）**。无论是 200 正常响应还是 404/403 错误响应，返回的 Response 头部一律强制包含：
    1. `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`
    2. `Content-Type: text/html; charset=utf-8`（wry 不自动补充 MIME，结合 nosniff 必须显式声明，否则页面空白或中文乱码）
    3. `X-Content-Type-Options: nosniff`
    4. `Cache-Control: no-store`
  - **WebView2 运行前提记录（Y11）**：Windows 需 WebView2 Runtime 支持 `ICoreWebView2_22`（iframe 自定义协议拦截）。在低版本回退路径下 iframe 可能为空白，应用侧行为定义为降级渲染占位块且不报错。
- **注册表设计与单一化托管（Y9）**：
  - 注册表状态由 Tauri 统一托管：`pub struct WidgetState(pub Mutex<WidgetRegistry>);`，无全局 static 互斥锁。协议 handler 经 `ctx.app_handle().state::<WidgetState>()` 访问。
  - `id` 生成：必须使用 128-bit 高熵随机串（引入 `uuid` crate 生成标准 UUID v4 字符串），严禁使用自增或可预测 ID。
  - 注册约束：单条 HTML 字符长度上限 512KB（超过则直接拒绝注册并返回错误）；注册表最大保留 64 条，按 LRU 顺序淘汰最旧条目。
  - **清空时机**：注册表**仅当文档 canonical 绝对路径发生改变时才清空**。在同一文档的热重载过程中（`reloadCurrent`），绝对不清空注册表，确保已有 iframe 不会产生 URL 失效空白。
- **Tauri 命令**：
  - `register_widget(state: State<WidgetState>, html: String) -> Result<RegisterResult, String>`（Y3）：
    校验大小与数量上限，写入注册表。返回结构体 `RegisterResult { id: String, url: String }`（`#[serde(rename_all = "camelCase")]`）。Windows 下 `url` 拼接为 `http://vellum-widget.localhost/<id>`。
  - `unregister_widget(state: State<WidgetState>, id: String) -> Result<(), String>`。
  - `read_mdlog_state(state: State<AppState>) -> Result<Option<MdlogStateResponse>, String>`（Z1, G2）：
    **无前端输入参数**。严格以 Rust 侧 `AppState.current` 记录的当前激活文档绝对路径为基准，将其基名拼接 `.mdlog` 解析同级 sidecar 文件。
    - **存活判据**：
      1. 检查目标 pid 存活：在 Windows 下调用 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)`。
         - **若成功获取非零句柄，在判定后必须显式调用 `CloseHandle(handle)` 释放内核对象（G2，防止句柄泄漏）**；
         - 若 `OpenProcess` 失败（权限不足或进程句柄未清理），调用 `GetExitCodeProcess` 二次复核；
         - 若仍失败，降级为仅依据心跳时间判定（防止权限降权导致误判为死）；
      2. 断言心跳未超时：`now - heartbeatAt <= 120_000`（120 秒心跳容差窗口）。
    - 返回字段：`Ok(Some(MdlogStateResponse { lastWriteAt, heartbeatAt, expiresAt }))`（其中 `expiresAt = heartbeatAt + 120_000`）；若进程已死、心跳超时或文件不存在，一律返回 `Ok(None)`（不删除磁盘文件）。

### 4.4 CSP 与 capabilities 配置

修改 `src-tauri/tauri.conf.json`：
追加 `frame-src` 配置，仅指定平台真实拦截源：

```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: http:; font-src 'self' data:; frame-src http://vellum-widget.localhost"
```

（说明：删去原 spec 中三值并列的模糊陈述。在 Windows/WebView2 下，Tauri 资源过滤器唯一生效且准确的子帧源即为 `http://vellum-widget.localhost`）。现有的 default capabilities 默认放行应用自定义命令与原生监听，无需新增权限配置。

### 4.5 图片管线（扩展侧为主，Vellum 零改动）

- **工具输出扫描与正则样式（Y7-a, Y7-b）**：
  监听 `tool_execution_end` 事件。
  - **默认工具范围**：默认全面扫描所有工具调用（重点包含 `bash`、`node`、`generate_image` 等全部工具输出）。可选配置文件 `config.json` 中的 `toolNames` 语义为「显式收窄白名单」；若未配置或为空数组，一律扫描全部工具。
  - **路径提取正则样式**：匹配由空白或可选单双引号包裹、以图片白名单扩展名结尾的类路径 token：
    ```ts
    const IMAGE_PATH_RE = /(?:["']|^|\s)([A-Za-z0-9_.\-\\/]+?\.(?:png|jpg|jpeg|gif|webp|bmp))(?=["']|$|\s)/gi;
    ```
  - **扩展名白名单**：限制为 `png`、`jpg`、`jpeg`、`gif`、`webp`、`bmp`（**默认严格排除 `.svg`**，杜绝外部 XML/脚本注入矢量图）。
- **路径解析与包含性约束（Y7-e）**：
  - 相对路径解析 `path.resolve` 与安全边界校验**统一以 `ctx.sessionManager.getCwd()` 为唯一基准**。
  - 路径合法性约束：仅复制位于 `ctx.sessionManager.getCwd()` 之下的常规文件；严禁跨目录抓取用户私有目录（如 `.ssh`、凭证文件）下的图片。
- **时间戳 mtime 过滤与容量保护（Y7-c）**：
  - **mtime 过滤**：提取路径后调用 `fs.stat`：**仅复制 `stat.mtimeMs >= turnStartTime - 5000`（回合开始前 5 秒内及之后创建或修改）的文件**。彻底杜绝在 `ls`、`grep`、`read`、`git status` 等输出中提到的既有历史图片被误复制。
  - 容量保护：单张图片文件尺寸超过 20MB 时跳过复制，并在日志中写入占位提示行 `*(图片过大超过20MB，已跳过同步：<原路径>)*`。
- **文件名净化、复制与重写（Y7-d, Y7-f）**：
  - **文件名净化**：复制进 `mdlog-assets/` 时，目标文件名净化为 `[A-Za-z0-9._-]`（其余字符，包括中文、空格、特殊符号全部替换为短横线 `-`）。彻底从源头避免 CommonMark 在 `![](...)` 中解析空格截断与 URL 编码问题。
  - 复制目标：`<日志目录>/mdlog-assets/<净文件名>`（重名则追加 `-2`、`-3` 等后缀）。
  - 路径归一化替换：正文中的原路径比对替换时，统一替换为**最终落盘的净文件名**相对路径 `mdlog-assets/<finalCleanName>`。
  - 缺省补偿：若当前回合成功产生了图片（可包含多张），但助手正文中未引用，在回合结束前对每张图片各自独立成行追加 `![生成的图片](mdlog-assets/<finalCleanName>)`。
- **回合级写入事务与非阻塞调度（Y12）**：
  图片复制与写入事务严禁在事件 handler 内 await；handler 仅将任务推入内存队列并通过 `setTimeout` 调度后台异步处理。在 timer 回调中以严格串行的 Promise 链执行，保证落盘单调递增。`session_shutdown` 时若有未完成的图片复制，最多等待 1s 即强制落盘文本。
- **可选配置载体与资产清理策略（Y7-a, 建议）**：
  若存在 `~/.pi/agent/extensions/mdlog/config.json`，支持用户覆盖默认规则与设置资产保留配额：
  ```json
  {
    "toolNames": [],
    "imageExtensions": ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
    "maxImageBytes": 20971520,
    "assetRetentionMb": 200
  }
  ```
  `assetRetentionMb` 默认 200MB；当 `mdlog-assets/` 目录总容量超过该阈值时，写入器按文件的 `mtime` 最旧优先删除超出配额的历史图片。

### 4.6 底部跟随与热重载副作用抑制

- **单 Layout Effect 滚动仲裁与落位守护**：
  在 `src/App.tsx` 中，将跟随仲裁与既有的 `pendingScrollRef` 恢复逻辑收敛至**同一个 layout effect** 内处理：
  1. 热重载触发前计算判据：`const isAtBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) <= 80;`。
  2. 新文档 Markdown 渲染后，在 layout effect 中：
     - 若 `isAtBottom === true`：**跳过** `pendingScrollRef` 的旧位置恢复，直接将 `container.scrollTop` 设为 `container.scrollHeight`。
     - **ResizeObserver 落位守护**：由于新增的内容可能包含懒加载图片（`loading="lazy"`）或异步通过 postMessage 调整高度的 widget 沙箱，高度会在随后的 100~500ms 内被逐步撑大。此时复用 `restoreScrollPosition` 的落位守护机制，启动一个短期 ResizeObserver，在尺寸变动时持续将容器拉至最新底部；**当用户产生主动滚动或键盘交互（监听 `wheel`、`touchstart`、`keydown` 事件，与 scrollRestore.ts 严格对齐，Y9-c）、调用返回的取消函数，或 5 秒超时后自动解除守护**，彻底根除异步撑高导致的漂移。
     - 若 `isAtBottom === false`：按原逻辑恢复至重载前的 `pendingScrollRef` 位置。
- **热重载副作用抑制**：
  当处于 mdlog 活跃记录状态时（`isMdlogActive === true`）：
  - `reloadCurrent` 抑制 `setShowReloadNote(true)` 调用，不挂载右侧页边印章组件。
  - 跳过 `.document-content` 上的 `fresh-ink` 全文虚化落墨动画，杜绝高频刷新时的持续视觉模糊。
  - 暂停高频触发的 `scrollMemory` 磁盘写入（避免每 400ms 刷盘一次），转为在文档切换或连接断开时集中补写一次。
- **大纲平滑跟随**：
  根据 AGENTS.md 约束，大纲列表对所有正文滚动（包括贴底跟随滚动）保持平滑缓动同步。新增段落的标题自动加入大纲，高亮激活项平滑移动到文档最新末尾标题，不增设人为门禁。

### 4.7 「记录中」徽章、watcher 重建守卫与复查调度

- **watcher 重建守卫（G1）**：
  在 `src-tauri/src/main.rs` 的 `load_document` 中增加规范化路径守卫：**仅当 `state.current` 记录的 canonical 绝对路径发生改变时（用户切换至另一个文档），才 drop 旧 watcher 并重建新 watcher**。同一文档的热重载保持现有 watcher 持续存活，彻底杜绝 `sidecar_deadline` 被意外扼杀以及 Windows 操作系统目录变更句柄频繁重建的资源震荡。
- **`src-tauri/src/watcher.rs` 双路独立防抖**：
  监听目标父目录保持不变，内部事件循环拆分为两个相互独立的防抖时间戳：
  - `log_deadline: Option<Instant>`：命中目标 `.md` 文件变动时刷新，400ms 到期后触发 `app_handle.emit("file-changed", ())`。
  - `sidecar_deadline: Option<Instant>`：命中 `<目标文件>.mdlog` 变动时刷新，400ms 到期后触发 `app_handle.emit("mdlog-state-changed", ())`。
  两路防抖独立计时，互不顶替、互不合并。
- **徽章渲染与自动复查调度（Z1）**：
  前端监听 `mdlog-state-changed` 事件并在文档初次加载后调用 `read_mdlog_state`。
  - 若返回有效存活状态（`{ lastWriteAt, heartbeatAt, expiresAt }`），在 `.document-content` 尾部（`MarkdownDocument` 之后）渲染徽章：
    ```html
    <div class="mdlog-live">记录中 · PI</div>
    ```
  - **自动复查调度（Z1）**：徽章显示期间，前端计算 `delay = Math.max(0, expiresAt - Date.now())` 并通过 `setTimeout` 在 `expiresAt` 时刻自动复查 `read_mdlog_state`。若复查返回 `None`（pid 死亡或心跳超时），立即静默隐藏徽章并清除定时器；当收到新的 `mdlog-state-changed` 事件时，重查状态并重置复查定时器。
  - 样式规范（严格遵守 kami，与权威预览 `docs/preview/mdlog-preview.html` 保持一致）：右对齐，字体 `var(--mono)` 10px，字距 2px，颜色 `var(--stone)`；前置 5×5px 靛青（`var(--brand)` 即 `#1B365D`）微方块（圆角 1px，依 DESIGN.md 章点微圆惯例），带有 1.6s 呼吸脉冲动画（支持 `prefers-reduced-motion` 豁免关停动画）。心跳超时或进程退出后静默卸载。

## 5. 技能 `vellum-mdlog`（项目内 `.pi/skills/vellum-mdlog/`）

真实目录（非符号联接），提供给在 Vellum 项目内工作的 Agent：

```
.pi/skills/vellum-mdlog/
├── SKILL.md
└── assets/
    └── widget-template.html    # 交互块标准骨架
```

### 5.1 SKILL.md 规范要点

frontmatter 包含 name 与 description（含关键词：`对话记录`、`vellum`、`mdlog`、`交互块`、`可视化讲解`）。核心正文规则：

1. **何时输出交互块**：仅当需要通过图表、动态演练、参数调节控件等手段讲解客观事实或复杂算法时输出；纯文本能清晰表述的内容严禁滥用 widget；单次回复内至多输出 1 个 widget。
2. **块契约与沙箱环境约束**：
   - 使用 ` ```vellum-widget ` 围栏，内部必须是一个完整的、符合 HTML5 标准的自包含文档。
   - **绝对断网**：严禁引用任何外部 CDN 资源、外部样式表、外部脚本或远程图片。
   - **Opaque Origin 严格禁止项**：由于沙箱未授予 `allow-same-origin`，所有本地持久化与存储 API（包括 `localStorage`、`sessionStorage`、`indexedDB`、`document.cookie`）在调用时均会直接抛出浏览器的 `SecurityError`！技能必须明确警告 Agent：**所有交互状态必须且仅能保存在 JavaScript 内存变量中**，严禁使用本地存储。
   - **颜色变量硬编码**：必须直接采用 kami 纸墨基准色值：
     - 暖纸底 parchment: `#f5f4ed`，象牙卡片 ivory: `#faf9f5`，深暖底 warm-sand: `#e8e6dc`
     - 浓墨 near-black: `#141413`，暗暖字 dark-warm: `#3d3d3a`，弱化字 stone: `#6b6a64`
     - 单一靛青品牌色: `#1B365D`（对应主应用变量 `--brand`，非 `--primary`）
     - 发丝线 hairline: `#dddacc`，浅边框 border: `#e8e6dc`
   - **字体栈与 CJK 衬线回退**：
     - 衬线文本：`"TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif`
     - 等宽代码：`"JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02", "Source Han Serif SC", monospace`
     - 说明：沙箱内无法访问主应用的本地字体文件，中文字符将优雅回退至系统内置衬线体（宋体/思源宋体），保持优雅纸墨质感。
   - **设计纪律**：**严禁使用 emoji**；圆角限制在 2~6px 之间；字重最高不超过 500；必须支持 `@media (prefers-reduced-motion)` 动画豁免。正文若包含三反引号（`` ` ``），外层交互围栏必须使用四个反引号（```` ```` ```` ````）；以此类推，确保外层围栏长于内部最大反引号组长。
3. **高度自适应上报脚本**：
   必须包含模板中的 ResizeObserver 与 load 事件通信脚本：
   ```html
   <script>
     (function() {
       function report() {
         const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
         window.parent.postMessage({ type: "vellum-widget:resize", height: h, title: document.title }, "*");
       }
       window.addEventListener("load", report);
       if (window.ResizeObserver) {
         new ResizeObserver(report).observe(document.body);
       }
     })();
   </script>
   ```
4. **图片生成惯例**：
   生成图片时（如调用 imagen2），只需在正文正常输出 Markdown 引用即可；扩展会自动将其归一化并复制进 `mdlog-assets/`，Agent 无需操心文件重命名与路径改写。

## 6. 性能设计（专项）

写入端性能约束：
- 150ms 写入合并防抖，纯文件末尾追加写入，杜绝反复读写全量文件。
- 图片复制完全异步化，5 秒超时保护，不阻塞 CLI 交互主线程。

渲染端性能约束：
- `WidgetSandbox` 组件全面实施 `React.memo`，在追加写入触发的整篇重载中，已有 iframe 保持位置稳定，不发生重载与交互状态丢失。
- 实施视口懒挂载与**全局最多 10 个存活 iframe LRU 休眠机制**，彻底切断 DOM 节点与 WebView 子帧随对话长度线性暴涨的隐患。
- postMessage 高度同步实施 `requestAnimationFrame` 节流与 [80, 2000]px clamp。
- 底部跟随单 layout effect 仲裁并复用 ResizeObserver 落位守护。
- 热重载副作用全面抑制：跳过印章组件、跳过 `fresh-ink` 模糊重绘、暂停 `scrollMemory` 刷盘。
- **已知架构代价声明**：
  由于 mdlog 格式在每条消息尾部均嵌入了隐藏注释 `<!-- mdlog:m=... -->`，日志文件的内容必然命中 `MarkdownDocument.tsx` 中的 `RAW_HTML_RE` 正则。因此，AGENTS.md 中记录的「无原始 HTML 时跳过 rehype-raw」的优化旁路在 mdlog 文件中**永久失效**，`rehype-raw` 将恒常执行。当聊天记录体积超过约 2MB（约数万字对话）后，整篇重解析耗时将会有所上升，推荐用户届时另起新日志文件记录。

## 7. 安全模型与威胁评估

### 7.1 沙箱与权限控制
- iframe 仅配置 `sandbox="allow-scripts"`：彻底剥夺同源访问权（无 same-origin）、禁止表单自动提交、禁止弹出窗口（无 popups）、禁止静默下载。
- 自定义协议响应强制注入严苛 CSP：`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`。从协议层切断所有向外部网络发起的**取数型**请求（fetch/XHR/img/font/websocket 等，Y4）。
- **子帧自导航残余风险说明（Y4）**：`sandbox="allow-scripts"` 且无 `allow-top-navigation` 时，禁止修改顶层窗口，但不禁止子帧自身导航（`location.href`；且 CSP 的 `navigate-to` 指令至今无主流浏览器实现支持）。若子帧自行导航至远程地址，该子帧在离开本应用域后将脱离本应用 CSP 约束。此项作为明确记录并接受的残余风险（缓解因素：widget 仅用于讲解事实、受信文档由本项目扩展生成，且沙箱仍无同源与 IPC 权限）。
- 错误响应（404/403）强制注入相同 CSP 与 Content-Type，杜绝空壳域逃逸。
- 协议端点分配 128-bit 高熵 UUID，无法遍历猜测。
- `read_mdlog_state` 仅以系统内部当前打开文件的路径为唯一锚点，禁止前端自由传递路径参数，防范任意文件探测。

### 7.2 打开任意第三方 Markdown 文件的执行 JS 威胁决策

- **威胁场景分析**：
  Vellum 是通用 Markdown 阅读器并在 Windows 注册了 `.md` 文件关联。用户从网络下载第三方 Markdown 文件双击打开时，如果文件中包含恶意构造的 ` ```vellum-widget ```` 围栏，由于 WebView2 支持脚本执行，可能面临两类残余风险：
  1. 视觉伪装与钓鱼 UI（在沙箱内仿造系统对话框或假报错欺骗用户）；
  2. 构造死循环脚本消耗系统渲染进程 CPU/内存资源。
- **授权门禁决策（Y11-b）**：
  1. **意图标识检查（Heuristic）**：Vellum 在渲染时检查文档开头是否含有 `<!-- mdlog:v1` 注释标识。**注意：这属于内容特征判据（意图标识），可被恶意第三方文件故意构造伪造**；真正的强授权信号（如 sidecar 存活或用户按路径持久化显式授权）留待未来扩展，本期明确接受该意图标识的设计定位。
  2. **非受信文档降级为占位块**：对于所有不含 `<!-- mdlog:v1 -->` 头的通用 Markdown 文档，正文中出现的任何 `vellum-widget` 交互围栏**一律不自动加载 iframe**，强制渲染为占位块：「交互内容 · 点击加载」（样式同 `.mdlog-widget` 容器）。
  3. **显式点击授权**：只有在用户明确信任该文档并主动点击占位块后，才调用 `register_widget` 挂载 iframe。
  4. **残余风险接受声明（Y4）**：在用户主动点击加载后，沙箱依然处于严格断网（取数型请求阻断）、无本地存储（opaque origin）、无 Tauri IPC 访问权的状态，无法窃取本机数据。沙箱内部执行脚本与可能的子帧自导航风险作为核心交互讲解能力的固有代价予以明确记录并接受。

### 7.3 图片复制安全约束
- 图片复制源路径必须位于工作区 `ctx.sessionManager.getCwd()` 之下，严禁跨目录抓取。
- 仅允许常规文件，单文件上限 20MB。
- 严格限制图片扩展名白名单（默认排除 `.svg`）。

## 8. 错误处理与容灾恢复

| 场景 | 责任方与行为 |
|------|--------------|
| 目标文件被其他进程锁死 | 扩展侧就地 50ms/150ms/300ms 指数退避重试；连续 3 批失败自动断开连接并 notify 报警，删除 sidecar |
| 会话分叉（`/fork`） | 扩展侧检测到 sessionId 不一致，不自动重连原文件，notify 提示手动连接 |
| 用户显式断开（`/mdlog off`） | 扩展侧追加 `{ active: false }` connection entry，删除 sidecar，永久切断幽灵重连 |
| pi 进程被强退或崩溃（Z1） | sidecar 记录 pid 与 30s heartbeatAt；Vellum 校验 pid 存活与 120s 心跳超时；前端徽章按 expiresAt 自动复查静默隐藏；下次连接时直接覆盖 |
| 扩展关闭退出（`shutdown`） | 必须先强制执行未落盘缓冲区 flush（图片等待上限 1s，Y12），清除心跳定时器，再删除 sidecar，保证最后一条消息完整性 |
| widget 超过 512KB | MarkdownDocument pre 渲染器预检拦截，降级渲染为标准普通代码块（CodeBlock），不触发 widget 注册 |
| widget 注册或 IPC 失败 | WidgetSandbox 内部捕获异常并降级渲染 fallback 传入的普通代码块，页面排版不中断且不报错 |
| 图片复制失败或超过 20MB | 正文中插入提示占位行 `*(图片处理失败：<原因>)*`，记录不中断 |
| 异步写入与多工具并发（Y12） | 事件 handler 仅同步登记与 timer 调度；写入事务在 timer 回调中以串行 Promise 链单调递增执行，杜绝时序倒挂与 CLI 阻塞 |
| 非 Markdown 后缀文件 | `/mdlog` 命令校验后缀，非 `.md/.markdown` 拒绝连接并提示 |

## 9. 测试策略与基线

### 9.1 实测测试基线（必须 100% 保持全绿）
- 前端 Vitest：现有 **17 个测试文件全部通过，175 个用例全部通过**。
- 后端 Cargo：现有 **15 个用例全部通过**（`vellum_lib` 13 个，`main.rs` 2 个）。

### 9.2 新增自动化测试覆盖

1. **前端单元测试（Vitest）**：
   - `src/components/MarkdownDocument.tsx`：
     - 验证 `/language-([\w-]+)/` 分发逻辑（`vellum-widget` 命中沙箱分发；`objective-c` 等含连字符语言完整传入 CodeBlock；未注册语言平滑降级）；
     - 受信判定 `isTrustedMdlog` 布尔值在追加内容时保持引用稳定，不破坏 components memo 结构（Y1, G3）；
     - 超过 512KB 的 widget 在 pre 渲染器被拦截降级为 CodeBlock。
   - `src/components/WidgetSandbox.test.tsx`：
     - 受信文档自动懒挂载 vs 非受信文档占位块渲染及点击激活；
     - postMessage 消息源校验（非法 source 忽略、非法 payload 忽略）；
     - 高度 [80, 2000]px clamp 逻辑与 rAF 节流；
     - 标题提取与兜底回退「交互演示」；
     - IPC 失败时优雅渲染 fallback 块。
   - `src/lib/widgetRegistry.test.ts`：
     - 全局存活 iframe 上限 10 的 LRU 淘汰与休眠状态切换；
     - 滚动停止 400ms 后才触发淘汰；休眠占位块重新入视口不自动复活（Y9）。
   - `src/App.test.tsx` / 徽章调度测试（Z1）：
     - 空闲 200s（无内容写入，但 heartbeatAt 持续刷新）徽章仍存活；
     - pid 死亡且无新事件产生，`expiresAt` 到达后徽章定时器自动触发复查并隐藏。
   - `src/styles/kami.css.test.ts`（Y10）：
     - **作用域约束**：仅针对新增的 `.mdlog-widget`、`.mdlog-widget__bar`、`.mdlog-widget__frame`、`.mdlog-live` 与 `.mdlog-live::before` 规则块进行审查；
     - **圆角集合断言**：新增块内使用的圆角属性严格 ∈ `{0, 1px, 2px, 3px, 4px, 6px}`（注明 1px 为微方块/章点惯例，0 为重置）；
     - **字重断言**：`font-weight` 属性严格 ≤ `500`；
     - **颜色断言**：新增块内严禁出现未在 `:root` 声明的原始十六进制或 RGB 颜色。
2. **后端单元测试（Cargo）**：
   - `src-tauri/src/widget.rs`（含架构可注入性抽离，Y2, 建议）：
     - 注册表 512KB 单条容量限制与 64 条 LRU 淘汰；
     - 路径切换时清空注册表 vs 同路径热重载保留注册表；
     - 128-bit UUID 高熵生成测试；
     - `judge_mdlog_alive` 抽离纯函数，注入 pid_alive 函数指针测试：模拟 pid 存活且心跳正常、pid 存活但心跳超时（>120s）、pid 死亡但心跳未超时等矩阵；
     - 协议响应构建抽离纯函数 `build_widget_response` 测试：断言未知 id 返回 404，有效 id 返回 200；且 200 响应同时包含严苛 CSP 与 `Content-Type: text/html; charset=utf-8`（Y2）。
   - `src-tauri/src/watcher.rs`：
     - 日志文件变动与 sidecar 文件变动的双路独立 400ms 防抖隔离测试。
3. **扩展端单测与集成测试**：
   - 消息双形态规整与 `rstrip` 尾部空白剥离；
   - 逐字节空行规范（锚点前后 `\n\n`、`---` 前后 `\n\n`）；
   - CommonMark 围栏平衡扫描与补齐说明行；
   - 智能追加扫描回退至 branch 有效锚点与会话指纹比对算法；
   - 图片 mtime 回合窗过滤（`>= turnStartTime - 5000`）、文件名净化为 `[A-Za-z0-9._-]`、正文净文件名替换与去重；
   - 事件 handler 非阻塞登记与串行 Promise 链调度。

### 9.3 Release 构建下的沙箱与 CSP 人工验证清单
（由于开发环境 devUrl 使用 http 端口，CSP 隔离与同源限制必须在 release 打包产物下进行最终核验；正向渲染验收在 dev 与 release 各执行一次）：

| 验证项 | 验证操作 | 预期结果 |
|--------|----------|----------|
| 正向功能渲染（Y11） | 打开含受信任 widget 的 mdlog 日志（dev 与 release 各一次） | widget 真实加载渲染、内联 JS 正常执行、postMessage 正确调整高度与标题、中文不乱码 |
| 网络断开隔离 | 在 widget 内执行 `fetch("https://example.com")` 或 `new XMLHttpRequest()` | 控制台报错 `Content Security Policy` 违规，取数型网络请求立即被拦截 |
| 远程图片隔离 | 在 widget 内执行 `new Image().src = "https://example.com/test.png"` | 控制台报错 CSP 违规，图片无法加载 |
| 本地存储隔离 | 在 widget 内执行 `localStorage.setItem("k", "v")` 或 `sessionStorage.getItem("k")` | 浏览器直接抛出 `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.` |
| Cookie/DB 隔离 | 在 widget 内执行 `document.cookie` 或 `indexedDB.open("test")` | 抛出 `SecurityError` 或访问返回空/受阻 |
| 导航弹窗隔离 | 在 widget 内调用 `window.open("https://example.com")` 或提交带 action 的表单 | 调用被沙箱无条件忽略或拦截，不弹出任何窗口 |
| 子帧自导航实测（Y4） | 在 widget 内执行 `location.href = "https://example.com"` | 子帧自身导航跳转至该地址；确认顶层应用窗口不受影响，记录为已知残余风险 |
| DOM 防穿透 | 在主应用尝试访问 `iframe.contentDocument`；在沙箱尝试访问 `parent.document` | 前者恒为 `null`，后者抛出跨域 DOM 访问违规异常 |

## 10. 文件改动清单（供实现计划引用）

新增文件：
- `~/.pi/agent/extensions/mdlog/index.ts`、`README.md`（仓库外，全局扩展目录）
- `src/components/WidgetSandbox.tsx`
- `src/components/WidgetSandbox.test.tsx`
- `src/lib/widgetRegistry.ts`
- `src/lib/widgetRegistry.test.ts`
- `src-tauri/src/state.rs`（声明 `AppState` 结构体，供 main 与 widget 共享，Y8）
- `src-tauri/src/widget.rs`
- `.pi/skills/vellum-mdlog/SKILL.md`
- `.pi/skills/vellum-mdlog/assets/widget-template.html`
- `docs/preview/mdlog-preview.html`、`docs/preview/fourier-ink.png`（设计预览，已就绪）

修改文件：
- `src/components/MarkdownDocument.tsx`（pre 正则修改为 `/language-([\w-]+)/`；isTrustedMdlog 布尔加入 components useMemo 依赖；受控分发 WidgetSandbox 与长度预检降级）
- `src/App.tsx`（单 layout effect 贴底仲裁 + ResizeObserver 落位守护；徽章 expiresAt 定时器复查；热重载副作用抑制）
- `src/styles/kami.css`（以 preview 为唯一真源追加 `.mdlog-widget*`、`.mdlog-live` 样式）
- `src/styles/kami.css.test.ts`（扩展 kami 设计 token 自动化审查断言，限定新增选择器作用域与圆角集合）
- `src/test/setup.ts`（补充 `IntersectionObserver` 的全局 mock）
- `src-tauri/src/lib.rs`（声明 `pub mod state;` 与 `pub mod widget;` 模块）
- `src-tauri/src/main.rs`（迁移 `AppState` 到 `vellum_lib::state::AppState`；`load_document` 增加 canonical 路径守卫避免热重载重建 watcher；注册协议与管理 `WidgetState`）
- `src-tauri/src/watcher.rs`（拆分双路独立防抖 deadline）
- `src-tauri/Cargo.toml`（添加 `uuid = { version = "1", features = ["v4"] }` 依赖）
- `src-tauri/tauri.conf.json`（CSP 配置 `frame-src http://vellum-widget.localhost`）
- `AGENTS.md`（更新测试基线为 17 文件 / 175 用例；技能安装流程增补项目专属技能真实目录例外与理由；性能死规则补充：WidgetSandbox memo/LRU 约束不可破坏、连字符语言提取）

## 11. 实现组织

根据工程要求严格采用 subagent-driven-development 模式推进：
1. **工作包切分**：
   - **包 1（后端基础）**：`src-tauri` 协议注册、注册表与 sidecar 校验命令（`widget.rs`、`lib.rs`、`Cargo.toml`、`tauri.conf.json`）、`watcher.rs` 双路独立防抖。
   - **包 2（前端组件与布局）**：`setup.ts`（mock）、`src/lib/widgetRegistry.ts`、`WidgetSandbox.tsx`、`MarkdownDocument.tsx` 分发、`kami.css` 及 `kami.css.test.ts`。
   - **包 3（主窗口装配与生命周期）**：`App.tsx`（贴底仲裁与 ResizeObserver 守护、热重载副作用抑制、徽章渲染与监听）。
   - **包 4（pi 扩展）**：`~/.pi/agent/extensions/mdlog/` 扩展实现、事件接线、格式化与围栏补齐、图片复制与智能追加。
   - **包 5（项目技能与验证）**：`.pi/skills/vellum-mdlog/` 技能文件、测试用例回归与 release CSP 核验。
2. **执行规则**：每个工作包必须先编写失败测试再编写实现代码（TDD）；完成后必须通过 `npm test` 与 `cargo test` 验证方可结项；禁止任何超出本设计文档范围的过度设计（YAGNI）。

---

## 12. 修订记录

### v2（2026-09-05）

本版本全面吸收并解决了审核报告 A（`spec-review-qwen.md`）与审核报告 B（`spec-review-gemini.md`）提出的全部阻断与应当修复项，并根据主 Agent 裁决（D1～D20）落地执行。具体处置对照表如下：

#### 1. 审核报告 A（reviewer-qwen）处置对照

| 编号 | 类别 | 原始问题摘要 | 处置方式 | 对应决议与落地章节 |
|------|------|-------------|---------|-------------------|
| **B1** | 阻断 | `pre` 分发正则 `/language-(\w+)/` 无法命中含连字符的 `vellum-widget` | **已修复** | 采用 D1。正则改为 `/language-([\w-]+)/`，并详述副作用（§4.2） |
| **B2** | 阻断 | Windows/WebView2 下 iframe `src` 不能写 `vellum-widget://` scheme | **已修复** | 采用 D2。Rust 端直接返回 `http://vellum-widget.localhost/<id>`，CSP 仅列该源（§4.1, §4.3, §4.4） |
| **B3** | 阻断 | `message_end` 早于持久化，消息无 `id`，锚点不可得 | **已修复** | 采用 D3。改为在 150ms flush 时刻从 `getBranch()` 反查对象引用提取 entryId，文件头加会话指纹（§3.4, §3.5） |
| **S1** | 应当修复 | `UserMessage.content` 可能为纯字符串或对象数组 | **已修复** | 采用 D6。支持双形态解析，文本块按 `\n\n` 拼接（§3.3） |
| **S2** | 应当修复 | `session_start` 漏了 `"startup"`，启动不会恢复连接 | **已修复** | 采用 D5。生命周期覆盖 `startup/reload/new/resume/fork` 全部 5 种（§3.3） |
| **S3** | 应当修复 | 锚点扫描规则在最后一个锚点不合法时产生重复回填；会话结构变化未定义 | **已修复** | 采用 D4、D5。尾向扫描匹配 branch，未匹配时按指纹提示确认或仅记新消息（§3.5） |
| **S4** | 应当修复 | `---` 与隐藏注释之间的空行未定义导致解析错误；`RAW_HTML_RE` 恒真 | **已修复** | 采用 D8。定义逐字节空行规范；并在 §6 如实记录 `rehype-raw` 恒走代价（§3.4, §6） |
| **S5** | 应当修复 | 写入侧对反引号代码围栏未闭合零防御 | **已修复** | 采用 D7。写入前校验配对，未闭合自动补齐 `\n```\n` 并加可见说明（§3.4） |
| **S6** | 应当修复 | 图片规则缺少配置载体与 cwd 路径/容量/白名单安全约束 | **已修复** | 采用 D9。限定 cwd 目录、常规文件、<=20MB、排除 svg，提供可选 config.json（§4.5） |
| **S7** | 应当修复 | 图片异步复制与 150ms 文本 flush 顺序未定义；shutdown 竞态丢消息 | **已修复** | 采用 D10。以 agent_settled 为准的回合级事务；shutdown 先落盘再删 sidecar（§3.3, §4.5） |
| **S8** | 应当修复 | `load_document` 时清空注册表会把热重载误判为切换文档 | **已修复** | 采用 D14。改为仅当规范化 canonical 路径改变时才清空注册表（§4.3） |
| **S9** | 应当修复 | sidecar 存活定义缺失，崩溃后徽章长期常驻说谎 | **已修复** | 采用 D11。Rust 侧基于 OpenProcess 校验 pid 存活并结合 120s 心跳超时判定（§4.3, §4.7） |
| **S10** | 应当修复 | 一次性 `scrollTop = scrollHeight` 违反约束，且与 pendingScrollRef 冲突 | **已修复** | 采用 D13。单 layout effect 仲裁，复用 ResizeObserver 5s 落位守护（§4.6） |
| **S11** | 应当修复 | 热重载副作用（reload-note 印章、fresh-ink 虚化、scrollMemory 刷盘）被高频放大 | **已修复** | 采用 D12。mdlog 连接期间全面抑制印章与虚化动画，暂停 scrollMemory 写盘（§4.6） |
| **S12** | 应当修复 | watcher 单事件槽导致日志文件与 sidecar 事件相互顶槽 | **已修复** | 采用 D11。watcher 拆分为独立双 deadline，互不干扰（§4.7） |
| **S13** | 应当修复 | 注册表与 sidecar 安全契约不完整（ID 碰撞、无参路径锚定、错误响应缺 CSP） | **已修复** | 采用 D14。128-bit 高熵 UUID、错误响应带完整 CSP、命令以 AppState 为唯一锚（§4.3） |
| **S14** | 应当修复 | opaque origin 沙箱下读取 iframe contentDocument.title 为 null | **已修复** | 采用 D16。删除直接读取属性表述，改为 postMessage 携带上报（§4.1） |
| **S15** | 应当修复 | 缺少「打开任意 md 即执行 JS」的威胁评估与安全授权决策 | **已修复** | 采用 D15。仅含 `<!-- mdlog:v1 -->` 头自动挂载，其他必须显式点击占位块授权（§4.2, §7.2） |
| 建议 1 | 建议 | 测试基线数字更新（17/175 与 15）；CSS token 审查测试 | **采纳** | 采用 D20。更新基线数据，并在 `kami.css.test.ts` 中增加 token 审查断言（§9.1, §9.2） |
| 建议 2 | 建议 | §10 改动清单补充 setup.ts、lib.rs、Cargo.toml、widgetRegistry.ts 等 | **采纳** | 清单完整补充上述全部缺失文件（§10） |
| 建议 3 | 建议 | 字体栈与 `--brand` 变量名校正，CJK 衬线回退说明 | **采纳** | 纠正变量名为 `--brand`，补充完整字体回退说明（§5.1） |
| 建议 4 | 建议 | 顶栏样式描述对齐 `.code-block` 规范 | **采纳** | 明确 11px 等宽大写字距 1.2px，使用标准 CSS 类说明（§4.1） |
| 建议 5 | 建议 | React key 稳定表述规范化（append-only 隐式匹配） | **采纳** | 采用 D17。注明 append-only 稳定，手动编辑移位属可接受代价（§4.1, §6） |
| 建议 6 | 建议 | 系统关联程序非 Vellum 时的温和提示 | **采纳** | 补充唤起异常与非 Vellum 关联时的 UI 提示说明（§3.2） |
| 建议 7 | 建议 | 命令解析规则与 `status` 格式详细定义 | **采纳** | 采用 D19。详细定义参数剥离、去引号与 status 输出格式（§3.2） |
| 建议 8 | 建议 | 消息时间源统一采用 `message.timestamp` | **采纳** | 采用 D6。明确时间源与跨天显示格式（§3.3, §3.4） |
| 建议 9 | 建议 | 增加沙箱/CSP 在 release 构建下的人工核验清单 | **采纳** | 补充涵盖网络、存储、Cookie、DOM 穿透的核验表格（§9.3） |
| 建议 10 | 建议 | 技能块契约补充 opaque origin 本地存储禁止项 | **采纳** | 明确禁止 localStorage 等 API，状态仅限保存在内存变量中（§5.1） |
| 建议 11 | 建议 | 澄清大纲平滑跟随行为；补充错误处理矩阵 | **采纳** | 明确大纲无门禁跟随；补充重试耗尽断开与超限反馈（§4.6, §8） |

#### 2. 审核报告 B（reviewer-gemini）处置对照

| 编号 | 类别 | 原始问题摘要 | 处置方式 | 对应决议与落地章节 |
|------|------|-------------|---------|-------------------|
| **阻断 1** | 阻断 | `MarkdownDocument.tsx` 现有正则提取不支持连字符 | **已修复** | 采用 D1。正则改为 `/language-([\w-]+)/`（§4.2） |
| **阻断 2** | 阻断 | `message_end` 无法直接取得 `entryId` 且早于持久化 | **已修复** | 采用 D3。改为在 150ms 合并 flush 时刻反查 entryId（§3.4, §3.5） |
| **阻断 3** | 阻断 | 图片识别规则与真实 `imagen2`（bash 产物、相对路径、反斜杠）不匹配 | **已修复** | 采用 D9。扫描 bash 在内的全部工具输出，支持相对路径解析与斜杠归一化（§4.5） |
| **阻断 4** | 阻断 | pi 强退或崩溃时 sidecar 残留导致徽章永久常驻 | **已修复** | 采用 D11。Rust 侧系统级校验 pid 存活与 120s 心跳超时判定（§4.3, §4.7） |
| **阻断 5** | 阻断 | Windows/WebView2 下自定义协议映射与 iframe 加载 URL 冲突 | **已修复** | 采用 D2。Rust 端返回 `http://vellum-widget.localhost/<id>`（§4.1, §4.3） |
| **修复 1** | 应当修复 | `/fork` 与 `/mdlog off` 状态同步缺陷导致幽灵重连或重复回填 | **已修复** | 采用 D5。off 追加 active:false 记录，fork 分支校验 sessionId（§3.3, §3.6） |
| **修复 2** | 应当修复 | Windows 文件锁冲突导致单次写入失败丢消息 | **已修复** | 采用 D18。实施 50/150/300ms 指数退避微重试，耗尽后入队列缓冲（§3.8） |
| **修复 3** | 应当修复 | 未闭合 Markdown 围栏吞噬后续所有消息 | **已修复** | 采用 D7。写入前校验围栏配对，未闭合自动补齐 `\n```\n`（§3.4） |
| **修复 4** | 应当修复 | 全局最多 10 个存活 iframe LRU 机制缺乏架构定义 | **已修复** | 采用 D17。引入单例 `widgetRegistry.ts` 集中管理挂载/休眠（§4.1） |
| 建议 1 | 建议 | 助手正文中的 `---` 与回合分隔线 `---` 视觉混淆，建议换用 div | **不采纳** | **理由**：为保持 Markdown 纯文本的高度便携性与可打印性，坚决不引入非标准 HTML 结构；且本规范已严格规定回合分隔线紧随隐藏锚点及其空行之后，结合正文排版足以清晰区分，无需改用 div。 |
| 建议 2 | 建议 | 热重载贴底滚动需防范异步撑开后漂移 | **采纳** | 采用 D13。复用 ResizeObserver 5 秒落位守护机制（§4.6） |

### v3（2026-09-05）

本版本全面落地第二轮双审阅（复审 A `spec-review2-qwen.md` 与复审 B `spec-review2-gemini.md`）提出的全部阻断项、修复项与建议项。本轮修订将规范精确至「照字面实现即正确」，确保实施子智能体零二义性。处置对照表如下：

| 编号 | 类别 | 来源与原始问题摘要 | 处置方式与定点落地章节 |
|------|------|-------------------|----------------------|
| **Z1** | **阻断** | 复审 A / sidecar 存活判定缺心跳写入方与复查调度器，崩溃后徽章永久常驻；长回合无内容写入时徽章误失效 | **已修复**。§3.7 引入独立 `heartbeatAt` 字段（与 `lastWriteAt` 彻底分离），扩展每 30s 定时刷新；§4.3 `read_mdlog_state` 结合 pid 存活与 `now - heartbeatAt <= 120s` 判活，返回 `{ lastWriteAt, heartbeatAt, expiresAt }`；§4.7 前端在 `expiresAt` 时刻自设 `setTimeout` 自动复查，失效时隐藏徽章；§9.2 增补空闲 200s 判活与崩溃无事件自动隐藏两条自动化单测。 |
| **Y1** | 应当修复 | 复审 A / 受信判定读取 `markdown` 引发 `components` 陈旧闭包，非受信文档可能自动挂载 iframe | **已修复**。§4.2 规定 `isTrustedMdlog = useMemo(() => /^\uFEFF?\s*<!--\s*mdlog:v1/.test(markdown), [markdown])`，以稳定布尔原始值传入 `components` 的 useMemo 依赖；说明该修改不破坏 `AGENTS.md` 的引用稳定约束（布尔恒稳定，MarkdownBody 以 markdown 为 memo 边界）。 |
| **Y2** | 应当修复 | 复审 A / 协议响应强制头清单缺 `Content-Type: text/html; charset=utf-8`，wry 不补 MIME 结合 nosniff 导致空白或乱码 | **已修复**。§4.3 响应头清单由三条增至四条，明确写入 `Content-Type: text/html; charset=utf-8`；§9.2 后端单测增加对 200 响应同时包含 CSP 与正确 Content-Type 的断言。 |
| **Y3** | 应当修复 | 复审 A / `register_widget` 仅返回 URL，`unregister_widget` 需裸 id，前端反推 id 破坏封装且平台相关 | **已修复**。§4.1 与 §4.3 明确 `register_widget` 返回 `RegisterResult { id: string, url: string }`（serde camelCase），前端以 ref 保存 id、只用 url，严禁前端解析 URL 字符串反推 id。 |
| **Y4** | 应当修复 | 复审 A / 沙箱「绝对断网」表述被高估，子帧可自行导航（`location.href`）脱离本应用 CSP | **已修复**。§7.1 与 §7.2 修正措辞为「阻断所有取数型对外请求（fetch/XHR/img/font/websocket）」，明确记录子帧自导航为已接受的残余风险；§9.3 人工核验清单补充 `location.href` 实测行。 |
| **Y5** | 应当修复 | 复审 A / 逐字节规范仍有换行 off-by-one、规则 2 与规则 6 锚点重复、示例黏连反引号、CommonMark 围栏无算法 | **已修复**。§3.4 给出每条消息的唯一字符串拼接公式（正文强制 rstrip、锚点固定前后 `\n\n`、分隔线固定前后 `\n\n`）；合并规则 2 与规则 6 的锚点输出；§3.4 补充 CommonMark 围栏定义（行首 ≤3 空格、≥3 个同字符、闭长 ≥ 开长）；修正第 160 行错误示例。 |
| **Y6** | 应当修复 | 复审 A / 尾向扫描首命中即停与分支检查冲突、4b 分支破坏首行指纹前提、伪锚点无防御、降级方向未定 | **已修复**。§3.5 明确扫描「回退直到命中 id ∈ branch 的锚点或到达文件头」；指纹提取正则写死 `/^\uFEFF?\s*<!--\s*mdlog:v1\s+s=([^\s>]+)/`；4b 分支改为一次性原子重写将文件头插入最顶部；扫描同步维护围栏开闭状态忽略围栏内伪锚点；全批未命中降级为不写锚点并记 `anchorLost: true`；静默重连同样执行扫描；询问判据采用 `ctx.hasUI && ctx.ui.confirm`。 |
| **Y7** | 应当修复 | 复审 A / 图片默认工具集与配置冲突、无路径正则样式、无回合 mtime 过滤导致误复制既有图、文件名未净化导致链接解析失效 | **已修复**。§4.5 统一默认扫描全部工具输出（`toolNames` 语义为收窄白名单）；给出 `IMAGE_PATH_RE` 样式；增加 `stat.mtimeMs >= turnStartTime - 5000` 过滤；复制时文件名净化为 `[A-Za-z0-9._-]`；统一基准为 `ctx.sessionManager.getCwd()`；明确多图各自成行、去重 `-2` 后缀及最终落盘名重写。 |
| **Y8** | 应当修复 | 复审 A / `AppState` 位于 bin crate，lib crate 下的 `widget.rs` 引用 `State<AppState>` 无法编译 | **已修复**。§4.3 与 §10 明确将 `AppState` 迁移至新建的 `src-tauri/src/state.rs`（属 `vellum_lib`），`main.rs` 改为 `use vellum_lib::state::AppState;`，并在 §10 补齐两文件改动职责。 |
| **Y9** | 应当修复 | 复审 A / 注册表访问两解（static 还是 managed State）、`widgetRegistry.ts` 缺公共 API 签名、滚动守护解除条件含「点击」与代码不符 | **已修复**。§4.3 统一为仅托管 `State<WidgetState>`，协议 handler 走 `ctx.app_handle().state::<WidgetState>()`，不留全局 static；§4.1 补充 `widgetRegistry.ts` 6 行标准 API 签名，确定 registry 为状态真源，LRU 键为最近 `markVisible` 时间；§4.6 守护解除条件删去「点击」，严格对齐 `scrollRestore.ts` 既有事件（wheel/touchstart/keydown/超时/取消函数）。 |
| **Y10** | 应当修复 | 复审 A / CSS token 审查断言若遍历全文件会因既有样式与 5×5px 微方块 1px 圆角而误报失败 | **已修复**。§9.2 审查断言作用域严格限定在新增的 `.mdlog-widget*`、`.mdlog-live*` 规则块；允许圆角集合订正为 `{0, 1px, 2px, 3px, 4px, 6px}`（注明 1px 依据 DESIGN.md 章点惯例）；原始色值断言仅禁止新增块内使用未声明色值。 |
| **Y11** | 应当修复 | 复审 A / 验证清单全为负向隔离，缺正向加载渲染验收；未记录 WebView2 运行前提；受信门禁判据为纯内容可被伪造 | **已修复**。§9.3 增加正向加载渲染验收行（dev 与 release 各一次：真实挂载、内联脚本执行、postMessage 调高与标题采纳、中文不乱码）；§4.3 记录依赖 `ICoreWebView2_22` 前提及低版本空白降级占位块；§7.2 将门禁措辞更正为「意图标识（heuristic）」，如实记录可被伪造的风险定位。 |
| **Y12** | 应当修复 | 复审 A / 回合级事务若在 `message_end` / `tool_execution_end` / `agent_settled` 内 await 会阻塞 pi 扩展事件链与 idle 信号 | **已修复**。§3.3 与 §4.5 明令禁止在事件 handler 内 await 磁盘写入与图片复制；统一由 handler 同步登记并由 `setTimeout` 调度后台事务，在 timer 回调中以串行 Promise 链单调落盘；`session_shutdown` 同步落盘时图片等待上限从 5s 降为 1s。 |
| **G1** | 应当修复 | 复审 B / `load_document` 无条件 drop 并重建 watcher，同文件热重载导致 `sidecar_deadline` 被杀且 Windows 句柄震荡 | **已修复**。§4.7 与 §10 增加 canonical 路径守卫：仅当规范化路径改变时才重建 watcher，同一文档热重载保持 watcher 存活。 |
| **G2** | 应当修复 | 复审 B / `read_mdlog_state` 调用 Win32 `OpenProcess` 成功后未调用 `CloseHandle` 导致句柄泄漏 | **已修复**。§4.3 明确规定在进程存活判定完成获取有效句柄后，必须显式调用 `windows_sys::Win32::Foundation::CloseHandle(handle)` 释放内核对象。 |
| **G3** | 建议 | 复审 B / 受信判定需兼容 UTF-8 BOM 与空白，且维持 `components` 的 memo 稳定引用 | **已采纳**。与 Y1 协同闭环：判定式使用宽松正则 `/^\uFEFF?\s*<!--\s*mdlog:v1/`，提取布尔值进入 `components` 的 useMemo 依赖（§4.2）。 |
| **建议 1** | 建议 | 复审 A / §4.1 CSS 数值与权威预览页 `mdlog-preview.html` 存在分歧 | **已采纳**。§4.1 删除冲突的旧数值表，明确以 `docs/preview/mdlog-preview.html` 为唯一真源（margin 17px 0、padding 7px 14px、font 10px、frame border-top、frame min-height 120px）。 |
| **建议 2** | 建议 | 复审 A / LRU 快速滚动时的挂载震荡，缺少「稳定停止滚动」判据 | **已采纳**。§4.1 规定仅在稳定停止滚动 400ms 后才允许执行 LRU 淘汰；被淘汰为休眠态的 widget 重新入视口不自动复活，必须显式点击唤醒。 |
| **建议 3** | 建议 | 复审 A / widget 超过 512KB 或注册失败的降级责任主体未定 | **已采纳**。§4.1 与 §8 明确责任划分：`MarkdownDocument` pre 渲染器负责 512KB 长度预检并降级，`WidgetSandbox` 负责捕获 invoke 失败并渲染 fallback。 |
| **建议 4** | 建议 | 复审 A / `mdlog-assets/` 缺少容量上限与清理策略 | **已采纳**。§4.5 `config.json` 增加 `assetRetentionMb`（默认 200MB），超出时按文件 `mtime` 最旧优先删除历史图片。 |
| **建议 5** | 建议 | 复审 A / 示例正文若含三反引号会截断围栏 | **已采纳**。§5.1 技能契约补充：正文含三反引号时，外层交互围栏必须使用四个反引号。 |
| **建议 6** | 建议 | 复审 A / AGENTS.md 测试基线过期（14/142）且未记录技能项目内真实目录例外 | **已采纳**。§10 改动清单补入 AGENTS.md 规约订正：更新为 17 文件 / 175 用例；增加项目专属技能放于项目内真实目录的例外及版本化理由。 |
| **建议 7** | 建议 | 复审 A / Rust 侧存活判定与协议响应测试需具备可注入性 | **已采纳**。§9.2 规定将存活判定抽象为纯函数 `judge_mdlog_alive`（注入 pid_alive 函数指针），协议处理抽象为纯函数 `build_widget_response`，脱离 GUI/OS 环境可测。 |
| **建议 8** | 建议 | 复审 A / 补充 wry 前缀匹配说明 | **已采纳**。§4.3 补充说明 wry 前缀匹配机制使外部同名主机名请求安全进入本地 handler 并返回 404。 |
| **建议 9** | 建议 | 复审 A / 精确化 rehype-sanitize 描述 | **已采纳**。§4.2 明确围栏源码作为字符串原样传给沙箱，文档整体依然经由 sanitize 保护，Unified 管线不新增任何标签例外。 |

---

## 附录：实现勘误与对齐（v3 落地后补记，2026-09-05）

实施与两轮集成审核（`docs/superpowers/reviews/2026-09-05-integration-audit-qwen.md`、`2026-09-05-intfix-review-{qwen,gemini}.md`）后，以下实现细节与正文存在偏差，以此附录为准：

| 节 | 正文设计 | 落地实现 | 理由 |
|---|---|---|---|
| §4.1 | `widgetRegistry.subscribe(id, onDormant)` 带 widgetId 过滤 | `subscribe(cb)` 无过滤，订阅方自行比对 | 实现更简单；休眠判定只发生在 WidgetSandbox 内部，过滤无收益 |
| §4.2 | `register_widget` 长度预检按字符 | 按字节（Rust `String::len()` 即字节数，> 512×1024 拒绝） | Rust 语义即字节；CJK 内容更早触发预检属保守方向 |
| §4.3 | pid 存活判定（未定实现） | `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `GetExitCodeProcess`（`STILL_ACTIVE=259` 为存活，API 失败视为死亡）+ `CloseHandle` | Windows 标准做法；纯函数 `judge_mdlog_alive` 注入 pid_alive 便于测试 |
| §4.4 | `should_rebind` 统一重绑判定 | 拆分为：watcher 解码失败自清 watcher；注册表清理由 `should_clear_registry` 判定；尾款轮进一步删除兼容包装 `should_rebind`，`apply_rebind` 直接收「路径是否变更」布尔 | 消除「清了 watcher 却没清表」分叉风险；消除死代码警告 |
| §7.2 | 授权按「该文档」语义 | 门禁以 widget `html` 字符串为键：**同一份 widget 内容只需授权一次**，跨文档逐字节相同内容不复位、不重复要求点击 | 内容相同即无串档风险；避免重复打扰 |
| §4.1/§8 | 降级渲染语言未统一 | 统一为 `language="markup"`（PrismLight 已注册；`xml` 别名未注册，写了也无高亮） | 两条同义降级路径（512KB 预检 / IPC 失败 fallback）行为一致 |
| §9.2 | 测试基线 17 文件 / 175 用例、后端 37 | 见 `AGENTS.md` 命令节终值（前端 22 文件 / 223+ 用例、后端 cargo 42：lib 35 + main 7） | WP3 修复、集成修复批与尾款轮持续补测；AGENTS.md 为测试基线唯一真源 |
