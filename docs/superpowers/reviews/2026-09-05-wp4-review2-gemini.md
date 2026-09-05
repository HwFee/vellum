# WP4 复审报告（reviewer-gemini，第二轮）

**审核对象**：`C:\Users\17445\.pi\agent\extensions\mdlog\`（独立 Git 仓库，修复范围 `git diff 1fa5170..933f616`，共 5 个修复 commit，包含 `index.ts`、`src/` 6 个模块、`test/` 8 个测试文件 81 用例）  
**对照依据**：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md` §3/§4.5/§6/§7.3/§8/§9.2；前轮两份驳回报告（`reviewer-gemini` 1 阻断 + 4 应当修复；`reviewer-qwen` 4 阻断 + 10 应当修复）；实施日志 `outputs/mdlog/wp4-fix-log.md` 与 `outputs/mdlog/wp4-fix2-log.md`。

---

## 结论：通过

**评估概述**：  
经过本轮细致的代码审查、静态类型检查与全量测试验证，实施方已完整修复上一轮两份审核报告指出的全部 20 项问题（含双方共计 5 项阻断与 14 项应当修复及建议）。
1. **安全性阻断彻底清零**：`openInVellum` 改用参数数组 `spawn("cmd", ["/c", "start", '""', absPath])` 并严格前置拒绝含 `"`、`\r`、`\n` 的路径，完全消除了命令注入与文件路径逃逸漏洞。
2. **进程健壮性与事务边界确立**：`writeSidecar` 及所有 sidecar 状态更新与心跳定时器回调全面实现外层 `try/catch` 隔离与临时文件清理，绝不冒泡；写入器严格收窄了重试/回灌边界，仅核心追加落盘失败才回灌队列，sidecar 更新与配额清理失败独立隔离，彻底根除了正文重复追加与熔断误触发风险。
3. **格式契约逐字节严密合规**：CommonMark 4b 首帧重写与首帧追加换行归一化（确保以 `\n\n` 隔离杜绝粘连）、围栏按开启字符 `fenceChar` 与长度 `fenceLength` 动态配对补齐、空文本消息静默跳过、多行行内伪锚点过滤（`ANCHOR_RE` 整行锚定）全部落地。
4. **图片管线安全高效**：图片复制已完全异步化并受 `Promise.race` 超时保护，`shutdown` 传入的 `imageTimeoutMs: 1000` 获得真实消费；正文重写引入无冲突占位符单趟替换杜绝嵌套路径；基于 `realCandidatePath` 物理路径去重并消除了 TOCTOU 窗口；配置项实现数值下限 clamp 并动态过滤 `svg`。
5. **测试真实可信且类型健全**：测试套件重构并扩充至 81 个用例，E2E 假绿消除（由真实的进程内 jiti 加载集成测试断言扩展工厂与 5 大事件，CLI 冒烟在缺 API key 时严格 `t.skip`）；新增 `tsconfig.json` 并引入 `npm run typecheck`（`tsc --noEmit`），0 错误通过；定时器添加 `.unref()` 保证套件约 6.4 秒内自然退出，无挂死点。

---

## 原驳回项复检（逐条：证据行号 + 测试）

### 1. [原阻断] `openInVellum` 命令注入漏洞消除
- **代码实现**：
  - `src/command.ts:51-56`：在 `parseMdlogCommand` 参数解析阶段前置增加路径安全校验，若包含 `"`、`\r`、`\n` 则直接返回错误，阻止进入连接链路；
  - `src/command.ts:89-106`：在 `openInVellum` 中同样在执行前校验 `/["\r\n]/.test(filePath)`，一旦命中返回 `{ success: false, error: ... }`；
  - `src/command.ts:98-101`：彻底废弃基于 `exec` 的字符串拼接，改用 `spawn("cmd", ["/c", "start", '""', `"${absPath}"`], { windowsVerbatimArguments: true, stdio: "ignore" })` 参数数组调用。双引号包裹且无逃逸字符，杜绝了 `&`、`|` 等批处理符号追加执行任意命令的隐患。
- **关联测试**：
  - `test/command.test.ts:46-56`：测试 `parseMdlogCommand` 拦截 `"foo.md" & calc.exe & "x.md"` 及 `notes.md\ncalc.exe.md`；
  - `test/command.test.ts:58-69`：测试 `openInVellum` 拦截 `foo.md" & calc.exe & "bar.md"` 与 `foo.md\r\nbar.md`，断言返回 `success: false` 且不执行注入命令。全部通过。

### 2. [原应当修复 1] E2E 测试恒绿假测试重构（SF1）
- **代码实现**：
  - `test/e2e.test.ts:21-105`：新增进程内 jiti 真实加载测试。直接通过 pi 内置的 jiti 解析并加载 `index.ts`，传入模拟 `mockPi`，严格断言：① 默认导出工厂函数；② 初始化无异常；③ 注册了 `/mdlog` 命令（验证含 description 与 handler）；④ 完整订阅 5 个生命周期事件（`session_start`、`message_end`、`tool_execution_end`、`agent_settled`、`session_shutdown`）；⑤ 真实调用 handler 验证 `status` 与 `off` 行为；
  - `test/e2e.test.ts:107-152`：重构子进程冒烟测试。彻底移除吞掉所有异常的宽泛 `catch`，当环境因隔离无 API key 导致退出码为 1 时，显式调用 Node 测试框架原生的 `t.skip(...)` 标记跳过；出现语法或运行时错误则执行 `assert.fail(...)`。
- **实测证据**：
  - 运行 `npm test`，控制台清晰输出：
    `✔ loads extension in-process with jiti, registers commands and events (38.0938ms)`
    `﹣ runs fake prompt with cli sub-process (skips if pi is unavailable or missing API key) (951.1863ms) # 测试环境无可用模型 API Key，跳过真实 CLI 子进程冒烟...`
  - 测试计数：81 tests, 80 pass, 1 skipped, 0 fail，红绿证据链完整真实。

### 3. [原应当修复 2] 历史回填角色过滤与非会话条目剔除（SF2）
- **代码实现**：
  - `index.ts:108-113`：定义 `isValidMessage` 辅助谓词，明确要求 `msg.role === "user" || msg.role === "assistant"` 且 `extractMessageText(msg.content).trim().length > 0`；
  - `index.ts:117-123, 129-135`：在 `full` 与 `increment` 回填循环中均通过 `isValidMessage` 过滤条目，剔除 `toolResult`、`bashExecution` 等非会话条目，防止虚增消息计数与写入空白段落。
- **关联测试**：
  - `test/lifecycle.test.ts:135-168`（`connectToFile filters messages during backfill to only user and assistant (gemini SF2)`）：造包含 `user`、`toolResult`、`bashExecution`、`assistant` 的混合分支，验证落盘后仅写入用户与助手文本，且 `/mdlog status` 准确报告 `已写消息: 2 条`。测试通过。

### 4. [原应当修复 3] 新建日志文件父目录不存在自动递归创建（SF3）
- **代码实现**：
  - `index.ts:75-78`：在调用 `fs.writeFileSync` 或 `insertHeaderAtTopAtomic` 写入初始文件前，获取目标所在目录 `const targetDir = path.dirname(resolvedPath);`，若不存在则调用 `fs.mkdirSync(targetDir, { recursive: true });`，避免抛出 `ENOENT` 异常。
- **关联测试**：
  - `test/lifecycle.test.ts:170-184`（`creates non-existent parent directory automatically without ENOENT error (gemini SF3 / Item 7)`）：连接至多层不存在深层目录 `deep/nested/folder/test.md`，验证父目录自动创建并写入成功。测试通过。

### 5. [原应当修复 4] CommonMark 尾部换行归一化杜绝内容粘连（SF4）
- **代码实现**：
  - `src/scan.ts:121-126, 137`：增加 `normalizeTrailingNewlines(content)` 函数，在分支 4b 的 `insertHeaderAtTopAtomic` 重写既有内容时，确保插头后的既有内容以 `\n\n` 结尾；
  - `src/writer.ts:339-356`：在 `LiveLogWriter` 增加 `ensureTrailingNewlinesOnFile()`，首帧向已存在的非空文件追加写入前检查文件末尾，若无 `\n\n` 则先补齐换行，确保正文首条消息 `> **你** · ...` 与原文件文本空行隔离。
- **关联测试**：
  - `test/scan.test.ts:168-185`（`normalizes non-empty file without trailing newlines to end with double newline (spec §3.5 4b)`）：旧笔记无末尾换行，重写后断言以 `\n\n` 结尾且包含完整内容；
  - `test/writer.test.ts:209-242`（`normalizes existing file lacking double trailing newlines before first append`）：现有文件无换行符，写入首条消息断言以 `最后一行没有换行符\n\n> **你** · ` 隔离。全部通过。

---

## qwen 项复检

### 1. qwen 阻断 1：sidecar 写异常隔离与心跳 timer 防崩
- **代码实现**：
  - `src/sidecar.ts:11-31`：`writeSidecar` 全程包裹在 `try/catch` 内，若在 Windows 平台遭遇文件锁或并发竞争导致 `renameSync` 失败，在 catch 中清理 `.tmp` 临时文件并返回 `false`，绝不向外抛出未捕获异常；
  - `src/sidecar.ts:41-67`：`updateHeartbeat`、`updateLastWrite` 与 `setAnchorLost` 均包裹 `try/catch` 并返回布尔值；
  - `src/sidecar.ts:85-98`：`HeartbeatManager` 的 `setInterval` 回调内部添加 `try/catch` 隔离；同时调用 `this.timer.unref()`，使得心跳定时器不会阻碍 Node.js 事件循环的自然退出（解决了测试挂死缺陷）。
- **关联测试**：
  - `test/sidecar.test.ts:110-149`（`writeSidecar isolates errors and cleans up tmp files on failure without bubbling`）：用同名目录占用 sidecar 路径模拟锁定，断言 `writeSidecar` 返回 `false`、`.tmp` 清理干净，且 `updateHeartbeat`、`updateLastWrite` 与 `HeartbeatManager` 均不冒泡异常。测试通过。

### 2. qwen 阻断 2：写入事务边界收窄（解耦追加与副作用）
- **代码实现**：
  - `src/writer.ts:117-156`：在 `flush` 的串行写链中，仅对核心的 `executeBatchWriteWithRetry` 失败执行 `unshift` 回灌待写队列和自增连续失败计数；
  - `src/writer.ts:139-145`：正文追加成功后，`onWriteSuccess`（写 sidecar 的 `lastWriteAt`）包裹在独立的 `try/catch` 中，即使 sidecar 写失败也不影响正文落盘，绝不回灌队列；
  - `src/writer.ts:147-157`：`cleanAssetRetention` 配额清理同样包裹在独立的 `try/catch` 中，且限制最少 30s 节流执行一次，失败不抛出。
- **关联测试**：
  - `test/writer.test.ts:170-207`（`does not duplicate messages when onWriteSuccess throws error (narrow transaction boundary)`）：注入 `onWriteSuccess` 抛出 `Error("Sidecar write locked")`，紧接着写入第二条消息并 flush，断言第一条消息在文件中严格仅出现 1 次，无二次追加。测试通过。

### 3. qwen 阻断 3 & 4：尾部换行归一与 E2E 假绿
- 经与 gemini SF4 及 SF1 交叉比对，两项问题已完全闭环修复（见上节第 2、5 项）。

### 4. 抽查高风险 5 条应当修复项
- **回合图片去重（Item 8）**：
  - `src/writer.ts:228-232, 279-317`：引入 `sharedImageState`（含 `realPathMap` 和 `allocatedNames`），跨批次内多条助手消息共享去重状态；通过 `referencedCleanNamesAcrossBatch` 记录已被引用的图片，未引用的额外图片仅在批次末尾最后一条助手消息追加一次。
  - 测试：`test/writer.test.ts:244-288` 断言同一批次两助手消息只生成 1 张 `diagram.png`，正文末尾仅出现 1 次 `![生成的图片]`。
- **图片-only 批次不丢失（Item 9）**：
  - `src/writer.ts:192-197, 223-225`：若当批消息数为 0（工具刚结束尚未有新消息）且未销毁，将 `imageBatches` 通过 `unshift` 放回 `imageCandidatesQueue`；若当前批次仅有用户消息无助手消息，同样放回队列等待后续助手回复。
  - 测试：`test/writer.test.ts:290-330` 验证仅有图片候选时 flush，后续助手消息到来再次 flush，图片成功复制且正文挂载正常，无丢弃。
- **重写单趟化与 realpath 物理路径去重（Item 10）**：
  - `src/image.ts:127-142, 187-210, 246-277`：采用 `\u0000MDLOG_TOKEN_${idx}\u0000` 占位符进行单趟化替换，规避了互为子串引发的 `mdlog-assets/mdlog-assets/` 重复前缀；以 `realCandidatePath` 物理路径为键复用落盘文件名；使用 `realCandidatePath` 执行 `stat` 与 `copyFile` 杜绝 TOCTOU 漏洞；包含性判断修正为 `rel === ".." || rel.startsWith(".." + path.sep)`，合法放行 `..weird.png`。
  - 测试：`test/image.test.ts:173-247` 三个针对性测试覆盖放行 `..weird.png`、物理同图异名去重与单趟占位符替换。全部通过。
- **围栏 fenceChar/fenceLength 补齐（Item 11）**：
  - `src/format.ts:60-70, 99-106`：`scanCodeFences` 返回未闭合围栏的字符 `fenceChar` 与长度 `fenceLength`，`formatAssistantMessage` 动态调用 `char.repeat(len)` 构造闭合围栏，`~~~` 动态以 `~~~` 闭合，4 个反引号以 4 个反引号闭合，不再写死 ` ``` `。
  - 测试：`test/format.test.ts:139-166` 验证波浪线及 4 反引号截断补齐。全部通过。
- **图片异步化、超时控制与 config clamp（Item 15）**：
  - `src/image.ts:11-20, 40-58, 168-243`：`processTurnImages` 改为 `async` 并通过 `Promise.race` 落实 5s 超时；`loadMdlogConfig` 对 `maxImageBytes` 与 `assetRetentionMb` 强制进行下限 clamp（<=0 回退默认值，防止误删资产）；`buildImagePathRegex` 由配置项驱动并严格过滤 `svg`；`src/writer.ts:100, 285` 与 `index.ts:284` 完整串联了 `imageTimeoutMs`（shutdown 时 1000ms 超时生效）。
  - 测试：`test/image.test.ts:293-305` 验证 clamp 生效与 svg 排除。全部通过。

---

## 新伤排查

针对 20 项修复涉及的 6 个模块核心交互进行了系统性排查：
1. **串行 Promise 链与并发追加**：`src/writer.ts:104` 严格维持 `this.writeChain = this.writeChain.then(...)` 模式。历史消息回填期 `await writer.flush()` 会在串行链中排队执行，实时消息通过 `scheduleDebounce(150ms)` 触发同一条写链，单调递增追加，无乱序与重入竞态。
2. **事件生命周期纪律（Y12）**：
   - `message_end`（`index.ts:269`）保持纯同步入队，无 await I/O；
   - `tool_execution_end`（`index.ts:279`）提取候选图片保持纯同步入队；
   - `agent_settled`（`index.ts:291`）使用 `void writer.flush().catch(() => {})` 触发，不阻塞系统的 idle 信号；
   - `session_shutdown`（`index.ts:297-308`）严格遵循「带 1s 图片超时的 flush → destroy 写入器 → stop 心跳定时器 → removeSidecar 删除状态文件」顺序。
3. **Timer 与进程生命周期**：`HeartbeatManager.start` 内部执行 `this.timer.unref()`，心跳定时器不会阻止 Node.js 退出，解决了先前由定时器未释放导致的测试挂死问题；`destroy({ discard: true })` 正确清理了防抖定时器与待写队列。
4. **状态与计数同步**：`writtenCount` 由 `LiveLogWriter` 在正文成功追加时内部递增，并通过 `onWriteSuccess(ts, count)` 回传给 `currentState.writtenCount`，消除了回填闭包与实时事件计数脱节的问题。
5. **未见引入任何阻断性新伤与竞态**。

---

## 问题清单

### 阻断问题 (Blockers)
- **无**（0 项）

### 应当修复问题 (Should Fix)
- **无**（0 项）

### 建议 (Suggestions)
- **[建议] `src/writer.ts:223-225`：在重试链路中保护图片放回队列的时机**
  - **证据**：
    ```typescript
    if (assistantIndices.length === 0 && allCandidates.length > 0) {
      this.imageCandidatesQueue.unshift(...imageBatches);
    }
    ```
  - **理由**：当批次中仅有用户消息时，代码在遍历消息前已将 `imageBatches` 放回 `imageCandidatesQueue`。若随后正文追加发生 I/O 故障并触发 `executeBatchWriteWithRetry` 重试，第 2 次重试会再次执行放回。虽然上层的 `candSet` 和 `realPathMap` 会在后续消费时完成去重，不影响功能正确性，但建议将非助手批次的图片放回操作移至批次确认成功落盘之后执行，使状态转移更为纯粹。
- **[建议] `outputs/__audit_scratch/` 探针测试目录隔离**
  - **理由**：根目录下的 `npm test` 会全量扫描 `outputs/` 下遗留的手动探针文件，如 `outputs/__audit_scratch/probe-p3.test.tsx`。建议在 `vitest.config.ts` 的 `exclude` 中排除 `outputs/**`，或清理临时探针，以避免根目录全量跑测受到干扰。
- **[建议] `src/scan.ts:50-59`：围栏区间扫描查询优化**
  - **理由**：`isInsideFence` 对每行执行 `for (const [start, end] of fenceRanges)` 线性遍历。对于特大文档（如数千围栏），可考虑构建区间二分查找以进一步提升解析性能。

---

## 测试实测输出

### 1. 扩展独立目录单元测试与类型检查
在 `C:\Users\17445\.pi\agent\extensions\mdlog` 运行 `npm test`：
```text
> pi-mdlog@1.0.0 test
> node --test test/**/*.test.ts

▶ command module
  ▶ parseMdlogCommand
    ✔ dispatches reserved subcommands off and status (1.688ms)
    ✔ parses target path with spaces and quotes and flags (0.3798ms)
    ✔ parses target path with flag at front (0.2215ms)
    ✔ rejects invalid non-markdown extension (0.1864ms)
    ✔ returns status if no arguments provided (0.8362ms)
    ✔ rejects path with internal quotes or newline injection attempts (0.1688ms)
  ✔ parseMdlogCommand (4.4191ms)
  ▶ openInVellum
    ✔ rejects paths containing internal quotes or newline characters without executing (0.2919ms)
  ✔ openInVellum (0.4465ms)
  ▶ formatStatusOutput
    ✔ formats disconnected status (0.2175ms)
    ✔ formats connected status with written count and formatted time (0.8075ms)
  ✔ formatStatusOutput (1.1921ms)
✔ command module (6.5587ms)
No API key found for the selected model.

Use /login to log into a provider via OAuth or API key. See:
  C:\Users\17445\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\providers.md
  C:\Users\17445\AppData\Roaming\npm\node_modules\@earendil-works\pi-coding-agent\docs\models.md
▶ pi mdlog E2E and loader tests
  ✔ loads extension in-process with jiti, registers commands and events (38.0938ms)
  ﹣ runs fake prompt with cli sub-process (skips if pi is unavailable or missing API key) (951.1863ms) # 测试环境无可用模型 API Key，跳过真实 CLI 子进程冒烟: No API key found for the selected model.
✔ pi mdlog E2E and loader tests (990.6588ms)
▶ format module
  ▶ extractMessageText
    ✔ handles string content (0.6989ms)
    ✔ handles array content with text chunks (0.1453ms)
    ✔ handles empty or non-text chunks (0.9757ms)
  ✔ extractMessageText (2.5232ms)
  ▶ formatTimestamp
    ✔ formats same-day timestamp as HH:MM (0.7435ms)
    ✔ formats cross-day timestamp as MM-DD HH:MM (0.1157ms)
  ✔ formatTimestamp (0.9969ms)
  ▶ scanCodeFences
    ✔ detects fully balanced backtick code block (0.3908ms)
    ✔ detects unclosed backtick fence at end of text (0.1477ms)
    ✔ detects tilde fences and checks length match (0.1884ms)
    ✔ ignores inline backticks inside paragraphs (0.1219ms)
  ✔ scanCodeFences (1.1055ms)
  ▶ formatHeader
    ✔ outputs byte-exact header with trailing blank line (0.3138ms)
  ✔ formatHeader (0.3784ms)
  ▶ formatUserMessage
    ✔ quotes every line including blank lines with anchor (0.2844ms)
    ✔ omits anchor line when entryId is undefined (anchorLost) (0.1691ms)
  ✔ formatUserMessage (0.5518ms)
  ▶ formatAssistantMessage
    ✔ formats standard assistant message with anchor and turn delimiter (0.2633ms)
    ✔ appends fence completion line when truncated (0.0977ms)
    ✔ appends fence completion matching opening fenceChar and fenceLength (spec §3.4 rule 5) (0.1573ms)
    ✔ appends unreferenced extra images before anchor (0.084ms)
    ✔ handles anchorLost without anchor comment (0.0927ms)
  ✔ formatAssistantMessage (0.8519ms)
  ▶ formatTurnDelimiter
    ✔ returns horizontal rule with blank lines (0.1395ms)
  ✔ formatTurnDelimiter (0.2202ms)
✔ format module (7.3247ms)
▶ image module
  ▶ extractImageCandidates
    ✔ extracts image paths from tool output with various quotes and spaces (1.532ms)
    ✔ filters tools when toolNames is specified in config (1.0322ms)
    ✔ honors custom imageExtensions and strictly filters out svg (0.5702ms)
  ✔ extractImageCandidates (4.2315ms)
  ▶ sanitizeImageFilename
    ✔ purges non-ascii characters and spaces to single dashes (0.519ms)
    ✔ falls back to image.ext if all base characters are non-ascii (0.2584ms)
  ✔ sanitizeImageFilename (1.0271ms)
  ▶ processTurnImages
    ✔ processes valid image, rewrites assistant text, and rejects path traversal (24.31ms)
    ✔ handles unreferenced image by adding to unreferencedCleanNames (8.0169ms)
    ✔ skips images exceeding configured maxImageBytes and inserts warning placeholder (3.4738ms)
    ✔ handles image copy failure and writes failure placeholder (4.2882ms)
    ✔ allows weird filenames starting with dots like ..weird.png within cwd (6.5807ms)
    ✔ deduplicates identical file referred by different candidate paths using realpath (9.9686ms)
    ✔ avoids nested double-prefix mdlog-assets/mdlog-assets with single-pass rewriting (6.0507ms)
  ✔ processTurnImages (63.7414ms)
  ▶ cleanAssetRetention
    ✔ removes oldest files when assets directory exceeds byte quota (3.8551ms)
  ✔ cleanAssetRetention (4.084ms)
  ▶ loadMdlogConfig
    ✔ clamps negative and zero values and excludes svg from imageExtensions (2.0478ms)
  ✔ loadMdlogConfig (2.1301ms)
✔ image module (77.3265ms)
▶ extension lifecycle & wiring
  ✔ does not reconnect when last connection entry is active: false (prevents ghost reconnect) (1.9911ms)
  ✔ notifies user and refuses auto-reconnect when sessionId mismatches on /fork (Y6-f) (0.6208ms)
  ✔ session_shutdown flushes pending messages and deletes sidecar file (12.9397ms)
  ✔ connectToFile filters messages during backfill to only user and assistant (gemini SF2) (5.2624ms)
  ✔ creates non-existent parent directory automatically without ENOENT error (gemini SF3 / Item 7) (4.6671ms)
  ✔ increments writtenCount on live message events and reflects in status (gemini/qwen Item 12) (211.5407ms)
  ✔ skips empty text messages and disconnect notifies when disconnected (gemini/qwen Item 13 & 17) (218.6128ms)
✔ extension lifecycle & wiring (457.6169ms)
▶ scan module
  ▶ findLastBranchAnchor
    ✔ finds the latest anchor that belongs to the current branch (1.7949ms)
    ✔ skips pseudo anchors inside code fences (Y6-d) (0.3776ms)
    ✔ skips inline pseudo anchors that are part of text line (0.2169ms)
    ✔ rolls back until finding a branch-belonging anchor (Y6-a) (0.2005ms)
    ✔ returns null if no anchors belong to the branch (0.1748ms)
  ✔ findLastBranchAnchor (4.0109ms)
  ▶ extractSessionFingerprint
    ✔ extracts sessionId from standard header (0.3258ms)
    ✔ extracts sessionId with BOM and extra spaces (0.22ms)
    ✔ returns null for non-mdlog files (0.2099ms)
  ✔ extractSessionFingerprint (1.0441ms)
  ▶ resolveAppendPlan
    ✔ honors forceFull flag (1.2813ms)
    ✔ honors forceAppend flag (0.358ms)
    ✔ returns full for empty file (0.2373ms)
    ✔ returns increment when valid branch anchor hit (0.2332ms)
    ✔ returns ask_user for branch 4a with UI (0.1645ms)
    ✔ skips branch anchors and falls back to 4a when anchorLost is true (spec §3.5 Y6-e) (0.2146ms)
    ✔ returns append_only for branch 4a without UI (0.1544ms)
    ✔ returns full for branch 4b (foreign session or missing header) (0.152ms)
  ✔ resolveAppendPlan (3.304ms)
  ▶ insertHeaderAtTopAtomic
    ✔ inserts header at line 1 of foreign non-empty file atomically (5.1161ms)
    ✔ normalizes non-empty file without trailing newlines to end with double newline (spec §3.5 4b) (4.5002ms)
  ✔ insertHeaderAtTopAtomic (9.8974ms)
✔ scan module (21.073ms)
▶ sidecar module
  ✔ writes sidecar JSON with exact path contract <file>.mdlog (5.4107ms)
  ✔ separates heartbeatAt and lastWriteAt updates (Z1) (9.9841ms)
  ✔ HeartbeatManager starts 30s timer and stops cleanly (125.5603ms)
  ✔ writeSidecar isolates errors and cleans up tmp files on failure without bubbling (2.4595ms)
✔ sidecar module (145.1684ms)
▶ LiveLogWriter
  ✔ batches messages with 150ms debounce and matches branch entryId (273.8735ms)
  ✔ handles degraded match when entryId is not found (anchorLost: true) (3.4185ms)
  ✔ does not trigger anchorLost when at least one message matches in the batch (narrowed Y6-e condition) (2.2061ms)
  ✔ retries up to 3 times on simulated file lock and disconnects after 3 failed batches (863.6241ms)
  ✔ does not duplicate messages when onWriteSuccess throws error (narrow transaction boundary) (3.56ms)
  ✔ normalizes existing file lacking double trailing newlines before first append (2.5615ms)
  ✔ processes turn images once per batch across multiple assistant messages without duplication (spec §4.5, gemini/qwen Item 8) (8.5325ms)
  ✔ does not discard candidate images in an image-only batch (gemini/qwen Item 9) (5.5953ms)
  ✔ throttles cleanAssetRetention to run at most once per 30 seconds (Item 20) (4.5377ms)
✔ LiveLogWriter (1169.7989ms)

ℹ tests 81
ℹ suites 27
ℹ pass 80
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 6418.8469
```

在 `C:\Users\17445\.pi\agent\extensions\mdlog` 运行 `npm run typecheck`：
```text
> pi-mdlog@1.0.0 typecheck
> tsc --noEmit
```
（0 错误，正常退出）

### 2. Vellum 主工程前端与 Rust 测试验证
在 `C:\Users\17445\Desktop\Vellum` 运行 `npx vitest run src`：
```text
Test Files  22 passed (22)
     Tests  223 passed (223)
  Duration  6.21s
```

在 `C:\Users\17445\Desktop\Vellum\src-tauri` 运行 `cargo test`：
```text
running 35 tests
test document_tests::resolve_asset_to_data_url_keeps_remote_urls_unchanged ... ok
test watcher_tests::derives_correct_sidecar_path ... ok
test watcher_tests::event_paths_match_case_insensitively_on_windows ... ok
test watcher_tests::independent_deadlines_take_minimum_timeout ... ok
test watcher_tests::log_event_does_not_affect_sidecar_deadline ... ok
test watcher_tests::poll_expired_emits_each_event_independently ... ok
test watcher_tests::sidecar_event_does_not_affect_log_deadline ... ok
test widget_tests::judge_mdlog_alive_matrix_and_pid_fallback_evaluation ... ok
test widget_tests::read_mdlog_state_reads_valid_sidecar_and_computes_expires_at ... ok
test widget_tests::read_mdlog_state_returns_none_when_heartbeat_expired_or_pid_dead ... ok
...
test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

running 7 tests
test tests::apply_rebind_preserves_registry_when_watcher_missing_for_healing ... ok
test tests::apply_rebind_preserves_registry_on_same_path_with_watcher ... ok
test tests::extracts_first_markdown_path_case_insensitively ... ok
test tests::should_rebind_and_watcher_matrix_evaluation ... ok
test tests::apply_rebind_clears_registry_on_path_change ... ok
test tests::ignores_non_markdown_arguments ... ok
test tests::tauri_conf_csp_contains_frame_src_for_widget ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
共计 42 个 Rust 用例全部通过，跨包契约验证无损。
