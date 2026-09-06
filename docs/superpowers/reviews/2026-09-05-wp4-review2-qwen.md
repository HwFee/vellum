# WP4 复审报告（reviewer-qwen，第二轮 · 含 14791c8 新版式配套）

**审核对象**：`C:\Users\17445\.pi\agent\extensions\mdlog\`（独立 git 仓库，HEAD = `14791c8`，工作树干净）
**复审范围**：两段 diff —（i）`1fa5170..933f616`（fix2 五 commit：sidecar 异常隔离、命令注入、换行归一、图片管线、事务边界、生命周期/类型检查）；（ii）`933f616..14791c8`（书札版式配套：去 H1、`mdlog-who` 助手标签、同角色碎片合并）
**对照依据**：spec `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`；前轮本报告 `2026-09-05-wp4-review-qwen.md`（A1–A4 阻断 + 10 应当修复）；`2026-09-05-wp4-review-gemini.md`（G1 注入）；`2026-09-05-wp4-review2-gemini.md`
**审核方式**：只读静态审读 + 独立探针（全部置于 `Vellum/outputs/__audit_scratch/`，跑完删除）+ 变异测试（把修复改回病态，确认相应用例转红）。本轮所有变异**只作用于 scratch 副本**（`work/mutn/`、`work/g1/copy/`、`work/reconntest/copy/`），被审仓库全程未被写入一个字节，报告交付前 `git status --porcelain` 与 `git diff HEAD` 均为空。
**结论纪律**：不接受实施日志自述，全部判定以本轮实测输出为准；「用例通过」不等于「用例有效」，故每个关键断言都做了变异检验。

## 结论
### **驳回**（限定范围：仅 `933f616..14791c8` 这一段；`1fa5170..933f616` 的修复全部确认有效，无需回退）

**已确认消除**：前轮 4 条阻断（A1 sidecar 异常隔离、A2 写入事务边界、A3 尾部换行归一、A4 e2e 恒绿）与 gemini 阻断 G1（`cmd /c start` 注入）——每条都有「病态基线可复现失败 + 修复版不留痕 + 变异转红」三件套（第一节、第四节）；高风险 5 条（Item 8/9/10/11/15）的实现均经独立探针实测生效，其余 5 条接线项通过（第二、三节）。套件 86 用例 / 85 绿 / 1 跳过 / 7.1s 自然退出、typecheck 零错误（第六节）。`writeChain` 串行性与 `lastBlock` 状态机在单实例内自洽（第七节 C1–C5）。

**驳回理由（本轮新增，全部有实测数据，不是风格意见）**：

1. **[应当修复-1] 合并重写非原子**：`writer.ts:420-427` 用 `writeFileSync` 整文件覆写，2.4MB 日志下并发读者 5s 内 33 万次读到 **6 次 0 字节**（P3）。这是本次 diff **新引入**的倒退——改动前正文路径只有 `appendFileSync`，不存在 truncate 窗口；而同一仓库对 sidecar 与文件头都早已 tmp+rename。宿主 400ms 轮询使该窗口可被真实消费。
2. **[应当修复-2] 断开不取消在途链**：`index.ts:196` 不 await + 链与重试不查 `isDisposed` ⇒ 实测 `discard 后文件仍被写入: true`、`顺序颠倒(W2 先于 W1): true`（P5/P6），直接违反 spec §3.6 的断开语义。同为本次 diff 放大（`lastBlock` 让「迟到的旧批次」会与「新 writer 的全文件重写」互踩）。
3. **[应当修复-3] 字节契约破口**：外部编辑器剥掉尾部换行后，降级追加把 `---` 与 `<p class="mdlog-who">` 黏成同一行（seam 探针），违反 spec §3.4 行 211 的逐字节空行契约。
4. **[应当修复-4/5] 两处独立缺陷**：图片超时定时器不 clear/unref（实测进程多活 5006ms）；`session_start` 自动重连不校验路径（实测把指纹头写进 `.txt`/`.bat`/无扩展名文件）。
5. **[应当修复-6] 规格漂移**：spec §3.4/§3.5 三处仍要求写 `# Pi 对话记录`，与本轮实现相反，且未按本项目「规格先改、代码后动」的纪律同步；README 亦未记录版式与合并重写特征。

**放行条件（最短路径）**：把应当修复-1/-2/-3 落成一个 commit（约 20 行：合并重写改 tmp+rename 并对 EPERM 微重试；链回调/重试前查 `isDisposed` 且 `disconnect` await；降级追加上游统一 `normalizeTrailingNewlines`），并为三者各补一条**变异可红**的用例（现有 86 条用例对这三条路径的变异全部为 GREEN）；同时提交 spec/README 的文档同步（应当修复-6）。-4/-5 可与下一小版本同批，但需在 issue 里挂号。

**探针与清洁性**：本轮全部探针位于 `Vellum/outputs/__audit_scratch/work/`（`probe-a1/a1b/a2/a3/a4/hr3/hr4`、`r2-n3.mjs`、`seam.mjs`、`chain.mjs`、`timer/probe.mjs`、`g1/probe.mjs`、`reconntest/probe.mjs`、`r2-mut.mjs`/`r2-mut2.mjs`/`r2-mut3.mjs` + 副本 `mutn/`），G1 载荷一律静默写 marker，未启动 calc/任何窗口；报告摘录即为其真实输出。按审核规约，交付前已删除 `outputs/__audit_scratch/` 全部内容；被审仓库全程零写入（`git status --porcelain` 空、`git diff HEAD` 空、无 `*.bak` 残留），所有变异与文件操作只发生在 scratch 副本内；scratch 内亦无 marker 残留。

---

## 第一节 阻断项复检 A1–A4

### A1 sidecar 写异常隔离（原阻断 A1）
**判定：已消除。**

证据 1 —— 单元级探针 `work/probe-a1b.mjs`（HEAD = 14791c8 实跑）。两种真实失败形态，且预先断言 `readSidecar` 仍可读，杜绝「因读不到而提前 return」的假绿；`prefix` = `git show 1fa5170:src/sidecar.ts`（病态基线，取回临时目录跑，未改被审仓库）：

```
[A/fixed-ro]          exit=0 out=["READ_OK=true","RAW_RENAME=EPERM","writeSidecar=false","updateHeartbeat=false","ALIVE"]
[A/prefix-ro]         exit=9 out=["READ_OK=true","RAW_RENAME=EPERM","writeSidecar=THROWS:EPERM"]
[B/fixed-rustlock]    exit=0 out=["READ_OK=true","RAW_RENAME=EPERM","writeSidecar=false","updateHeartbeat=false","ALIVE"]
[B/prefix-rustlock]   exit=9 out=["READ_OK=true","RAW_RENAME=EPERM","writeSidecar=THROWS:EPERM"]
[A/fixed-hb-ro]       exit=0 out=["TIMER_ALIVE_20_TICKS"]
[A/prefix-hb-ro]      exit=9 out=["UNCAUGHT:EPERM"]
[B/fixed-hb-rustlock] exit=0 out=["TIMER_ALIVE_20_TICKS"]
[B/prefix-hb-rustlock] exit=9 out=["UNCAUGHT:EPERM"]
```

- 场景 A：sidecar 文件置只读（`chmodSync(p, 0o444)` ≡ `attrib +R`）；
- 场景 B：**与 Vellum Rust `read_mdlog_state` 完全等价的共享句柄**——PowerShell `[System.IO.File]::Open($p,'Open','Read','ReadWrite')`（share 含 Read|Write 而不含 DELETE），即 spec §3.8 认定的常态锁；
- `RAW_RENAME=EPERM` 一行证明底层写路径**确实**失败（不是环境没造出锁的假绿）；`fixed` 版四个 API 全部返回 `false`、进程存活；`prefix` 版 `writeSidecar` 直接抛出，心跳回调内的 `updateHeartbeat` 冒泡出 `setInterval` → `UNCAUGHT:EPERM`。前轮已核实 pi 交互模式对 uncaughtException 的处理是 `console.error` 后 `process.exit(1)`（`dist/modes/interactive/interactive-mode.js` uncaughtCrash），即**原缺陷等于扩展可以杀死宿主会话**。

证据 2 —— 接线级探针 `work/probe-a1.mjs`（sidecar 路径被同名目录永久占用，`LiveLogWriter` 按 `index.ts:89-110` 原样接线）：

```
[S1 blocked-dir]     exit=0 out=["writeSidecar=false","updateHeartbeat=false","updateLastWrite=false","setAnchorLost=false","TIMER_SURVIVED_20_TICKS"] err=[] tmpLeftoversInDir=0
[S2 real-lock]       exit=0 out=["raw-rename-throws=false","writeSidecar=false","updateLastWrite=false","updateHeartbeat=false","STILL-ALIVE"]
[S3 writer-continues] exit=0 out=["APPENDS=3","WRITTENCOUNT=3","SIDECAR-UNTOUCHED=true"]
[S4 mutation=pre-fix sidecar] exit=0 out=["PREFIX-WRITESIDECAR=throws:EPERM","PREFIX-SURVIVED"]
```

`S3` 是关键的「失败降级仍可用」断言：sidecar 完全写不动时正文照常追加 3 条、`writtenCount` 照常增长、无 `.tmp` 残留（`tmpLeftoversInDir=0`）。

代码位置：`src/sidecar.ts:12-34`（`try { writeFileSync + renameSync } catch { 清理 tmp; return false }`）、`:37-77`（read/updateHeartbeat/updateLastWrite/setAnchorLost 各自吞异常）、`:89-103`（timer 回调内再包一层 try + `this.timer.unref()` 在 `:102`）。

变异检验：`prefix` 版（`1fa5170`）在 A/B 两场景 8 例中 4 例直接抛错、4 例进程以 exit=9 结束（等价于宿主会话崩溃）；修复版全部 exit=0。补充变异 `Z1-heartbeat不再unref`（删除 `sidecar.ts:102` 的 `unref()`）见第二节末「套件/变异总表」——该探针同时守护「心跳不得把事件循环钉住」这条测试套件能自然退出的前提。

残余（不阻断）：失败被完全静默，无计数、无 `ui.notify`，Vellum 侧只能靠 400ms 心跳超时判「记录器已掉线」，用户看不到「为什么侧车不更新」。见问题清单 [建议-1]。

### A2 写入事务边界（原阻断 A2）
**判定：已消除（事务边界已收窄到「正文落盘」这一个动作）。**

代码位置：`src/writer.ts:118-167`（`flush` 的链内回调）。结构已改为三段互不污染：

1. `await this.executeBatchWriteWithRetry(...)` 单独包 `try`，**只有它抛错**才 `this.messageQueue.unshift(...batchMessages)` 回灌并累计 `consecutiveBatchFailures`（`:133-141`）；
2. `onWriteSuccess`（内部会写 sidecar）单独 `try { } catch { }`，注释即「sidecar 更新失败单独隔离，不影响正文追加，不回灌队列」（`:146-152`）；
3. `cleanAssetRetention`（会删文件）同样单独吞异常（`:155-166`），并额外受 30s 节流（`lastAssetCleanTime`，Item 20）。

`index.ts:96-104` 的 `onWriteSuccess` 回调里唯一的真实可抛点是 `updateLastWrite`，而它在 `src/sidecar.ts:57-66` 已自带吞异常；探针仍按「回调直接抛」的最坏情况验证，覆盖的是契约而不是当前实现细节。

证据 —— 探针 `work/probe-a2.mjs`（HEAD 14791c8 实跑；`PREFIX` = `git show 1fa5170:src/writer.ts` 覆盖到临时副本，被审仓库未改）：

```
[FIXED/cbthrow]      RESULT A=1 B=1 C=1 anchors=1 fatal=0 cbThrows=3
[PREFIX/cbthrow]     RESULT A=3 B=2 C=1 anchors=6 fatal=0 cbThrows=3
[FIXED/reflow-once]  RESULT jia=1 yi=1 attempts=3 fatal=0
[PREFIX/reflow-once] RESULT jia=1 yi=1 attempts=3 fatal=0
[FIXED/alwayfail]    RESULT fatal=0 appended=0 written=0
[PREFIX/alwayfail]   exit=1  TypeError: w.getWrittenCount is not a function   ← 病态基线无该 API，属探针脚手架差异，非修复失效
[FIXED/orphan]       RESULT orphan-assets=["shot-2.png","shot-3.png","shot.png"]
[PREFIX/orphan]      RESULT orphan-assets=["shot-2.png","shot.png"]
```

`cbthrow` 是核心对照：`onWriteSuccess` 连抛 3 次时，修复版正文 A/B/C 各**只出现一次**、锚点仅 1 枚、`fatal=0`（不误触熔断）；病态基线同一批被追加 3 遍（`A=3`）、产生 6 枚锚点——正是前轮实测的「正文二次/三次追加」缺陷。

仓库内对应用例：`test/writer.test.ts:170`「does not duplicate messages when onWriteSuccess throws error (narrow transaction boundary)」、`:124`「retries up to 3 times … disconnects after 3 failed batches」。

变异检验：`r2-mut.mjs` 条目 `A2-sidecar失败回灌队列`（剥掉 `:146-152` 的 try/catch，让异常冒泡出链回调）→ 该用例是否转红见末节变异总表。

残余（不阻断，但与前轮 Item 15 残留同源）：
- **重试非幂等**：`executeBatchWriteWithRetry`（`:169-188`）把 `writeBatchToDisk` 整体重试，而图片复制就在 `writeBatchToDisk` 内（`:325-340`）。`sharedImageState` 是每次 `writeBatchToDisk` 新建的局部量（`:241-244`），故第 2/3 次重试会重新复制同一张图，`while (fs.existsSync(targetPath) …)` 计数器改名为 `shot-2.png`/`shot-3.png`——`[FIXED/orphan]` 的 3 个孤儿文件即此路径的直接产物（正文引用与磁盘一致，浪费的是磁盘与 IO；最终由 `cleanAssetRetention` 配额兜底）。建议把图片处理提到重试圈外做一次、结果作为参数传入。见 [建议-2]。
- 熔断路径 `onFatalError` → `index.ts:105-108 disconnect()` → `destroy({ discard: true })` 清空队列，故不存在「死批次长期滞留」；但 `disconnect` 对 `destroy` 只 `.catch(() => {})` 不 await，见第七节并发项。

### A3 尾部换行归一（原阻断 A3）
**判定：已消除（三态字节一致，且三条落盘路径都有守卫）。**

规格依据：spec §3.5 步 4b（行 241）「…用户原有内容完整保留在文件头之下，**文末追加两个换行后再写入**当前分支的全量消息」；§3.4（行 211）「`<!-- mdlog:m=... -->` 注释前后均必须有空行；`---` 分隔线前后也必须有空行…杜绝…将段落误解析为 setext H2 下划线」。

实现落点（三条路径全覆盖，前轮缺的正是 4b 之外的两条）：
- `src/writer.ts:443-450` `ensureTrailingNewlinesOnFile()`——`content.length === 0` 直接放过（空文件由 `index.ts:75-78` 写头）、`endsWith("\n\n")` 不动、`endsWith("\n")` 补 1 个、否则补 2 个；由 `firstWriteNormalized`（`:62`）守卫，在 `:385-388` 首批写入前调用一次，覆盖 `append_only` / `increment` 接到用户编辑过的文件尾部这一前轮实测失败场景；
- `src/scan.ts:127-132` `normalizeTrailingNewlines()` + `:134-156` `insertHeaderAtTopAtomic()`——4b 的全量回填路径，tmp+rename 原子重写，先归一旧内容尾部再插指纹头；
- `src/format.ts:6-19`（`extractMessageText` 多段 `

` 拼接）、`:94-99`（`userBody` rstrip）、`:113-115`（`assistantBody` rstrip）——`extractMessageText` 与 `userBody`/`assistantBody` 强制 rstrip 正文尾部空白，避免正文自带尾行破坏 seam。

证据 —— 探针 `work/probe-a3.mjs`（走 `index.ts` 真实接线：`/mdlog <file> --append` 与 `--full`，随后 `message_end` + `session_shutdown`；比较「剥掉旧内容尾部空白后的接缝字节」）：

```
== append_only（--append：走 writer.ensureTrailingNewlinesOnFile）==
  单换行结尾    seam="\n\n> **你** · 11:42\n>\n> A3-新消息\n\n<!-- mdlog:m=e1 -->\n\n"
  无换行结尾    seam="\n\n> **你** · 11:42\n>\n> A3-新消息\n\n<!-- mdlog:m=e1 -->\n\n"
  双换行结尾    seam="\n\n> **你** · 11:42\n>\n> A3-新消息\n\n<!-- mdlog:m=e1 -->\n\n"
  → 前三态接缝字符串完全一致（同一条 JSON 串）
  三换行结尾(额外)  seam="\n\n\n> **你** · …"      ← 已有 ≥2 换行时不再补（幂等，多余空行无害）
  CRLF 结尾(额外)   seam="\r\n\n> **你** · …"      ← 只补 1 个 \n，凑成一个空行，语义正确
  行尾空格(额外)     seam="  \n\n> **你** · …"     ← 判为「不以 \n 结尾」→ 补 \n\n，正确断开
== full（4b：走 scan.insertHeaderAtTopAtomic + normalizeTrailingNewlines）==
  单换行结尾  afterOld="log:v1 s=sess-A3 -->\n\n# 我的旧笔记\n\n> **你** · 11:42\n>\n> A3…"
  无换行结尾  afterOld="log:v1 s=sess-A3 -->\n\n# 我的旧笔记\n\n> **你** · 11:42\n>\n> A3…"
  双换行结尾  afterOld="log:v1 s=sess-A3 -->\n\n# 我的旧笔记\n\n> **你** · 11:42\n>\n> A3…"
```

三态在两条路径下均归一为「旧内容 + 恰好一个空行 + 新块」，前轮实测的 `# 我的旧笔记\n最后一行没有换行符` 与 `> **你** · 19:30` 黏成一行不再可能；旧尾行 + `---` 被解析成 setext H2 的路径也已断掉（`assistantBody` 前必有 `\n\n`）。

仓库内对应用例：`test/writer.test.ts:209`「normalizes existing file lacking double trailing newlines before first append」；`test/scan.test.ts` 的 `normalizeTrailingNewlines` / `insertHeaderAtTopAtomic` 指纹与保留原内容断言。

变异检验（本条目实测输出，`work/r2-mut.mjs`）：

```
A3-writer归一守卫移除    RED ✅  fail=1  red=["normalizes existing file lacking double trailing newlines before first append", …]
```

残余：`firstWriteNormalized` 是**每实例一次**的守卫。若在写入过程中被外部编辑器把文件尾部的换行剥掉，`merge` 分支的降级追加（`writer.ts:419-431`）不再补换行，可能与被改过的尾部黏连——见第五节 N3 探针实测（已升格为 [应当修复-3]）。

### A4 e2e 可失败断言（原阻断 A4）
**判定：已消除（e2e 现为「可失败断言 + 显式 skip 判据」两段式）。**

前轮缺陷：`test/e2e.test.ts` 唯一用例把子进程非零退出与内部两条断言一起吞进 `try/catch` → 恒绿。现状（HEAD 14791c8）：

- `:30-90` 新增**进程内**用例：用 `jiti` 直接 `import("../index.ts")`，断言默认导出是函数、`registerCommand("mdlog")` 被调用、`handler` 是函数、`description` 含 mdlog、五个生命周期事件（`session_start`/`message_end`/`tool_execution_end`/`agent_settled`/`session_shutdown`）均已订阅，并驱动 `status`/`off` 两条分发断言 `notify` 文案——这些断言任何一条被破坏都会红，不依赖外部条件；
- `:113-152` 子进程用例改为**白名单式 skip**：仅当输出包含 `No API key` / `login` / `provider` / `ENOENT` 时才 `t.skip(...)` 并打印原因，其余一律 `assert.fail(全部 stdout+stderr+message)`，且 `execSync` 带 15s 超时。

证据 —— 探针 `work/probe-a4.mjs`（对副本 `work/mutn` 逐条变异跑 `node --test test/e2e.test.ts`；HEAD 实跑）：

```
[1] 基线                                    current            exit=0  pass=1 fail=0 skip=1 red=[]
[2] 病态基线（1fa5170 的 e2e.test.ts）        prefix e2e         exit=0  pass=1 fail=0 skip=0   ← 旧文件确为「恒绿」，与现状形成对照
[3] 变异：去掉 skip 判据                     no-skip            exit=1  pass=0 fail=1          ← 「非跳过即硬断言」分支是活的
[4] 变异：registerCommand 改名               exit=1 fail=1 red=["loads extension in-process with jiti, registers commands and events"]
    变异：agent_settled 订阅改名              exit=1 fail=1（同上）
[5] 变异：status 断言期望值改错               exit=1 fail=1（同上）
[6] 病态子进程：扩展目录内注入 ReferenceError  子进程 exit=SIGNAL(超时)
    含 'Error loading extension'=false | 含 'No API key'=false | 含 'login'=false
    → 当前 skip 判据对真故障的判定: FAIL（不掩盖）
```

即：修复后的 e2e 在「扩展注册被破坏」「事件订阅被破坏」「断言期望值被改错」「环境真实失败」四种情况下都会红；无 API key 时明确 `skip=1` 并给出原因字符串，不再伪装成 pass。当前套件 `ℹ skipped 1` 正是这条子进程用例，与基线口径一致。

残余（不阻断）：
1. 进程内用例只驱动了 `status`/`off` 分发，**未驱动 `connect` 分支**（`connectToFile` 需 `ctx.ui.confirm`/`sessionManager`），也就是「注册了 handler」被验证，「handler 真能连上文件并落盘」在自动化层面仍只由 `test/lifecycle.test.ts` 与 `test/writer.test.ts` 的 mock 接线覆盖。见 [建议-4]。
2. `[6]` 显示 pi 在扩展抛 ReferenceError 时是**挂死**（60s 超时被 kill）而不是打印 `Error loading extension`，所以该断言串在本机环境不会被命中——不影响结论（超时同样落进 `assert.fail` 分支），但意味着「扩展加载错误」这条断言目前只在进程内用例中有效。

---

## 第二节 高风险应当修复 5 条（实测）
**总判定：5 条全部已消除（实现均经真实探针验证生效），但其中 4 条的「修复不被测试守护」——变异仍绿。** 变异表见本节末，完整套件口径（`node --test` 全 9 个测试文件，副本 `work/mutn`）。

### H1 回合图片去重（同一回合多条助手消息不重复复制）— 已消除

实现：`src/writer.ts:241-244` 新建 `sharedImageState`（`realPathMap` + `allocatedNames`），在 `:325-337` 作为第四参传给 `processTurnImages`；未引用图片只在 `i === lastAssistantIdx`（`:352`）追加一次，并用 `referencedCleanNamesAcrossBatch`（`:341-349`）扣掉正文已内联引用的文件。

用例：`test/writer.test.ts:238`「processes turn images once per batch across multiple assistant messages without duplication (spec §4.5, gemini/qwen Item 8)」。

变异：`H1-共享去重状态未传递`（第四参改 `undefined`）→ **RED ✅**（该用例转红）；`H1b-未引用图片每条都追加`（`if (i === lastAssistantIdx)` 改恒真）→ **RED ✅**。判定成立。

### H2 图片-only 批次不丢弃 — 已消除（兄弟分支无测试）

实现：`src/writer.ts:200-205`（当批 0 条消息时把 `imageBatches` `unshift` 回队列，`isDisposed` 时才是真丢弃）；`:236-238`（当批无助手消息但有候选时同样放回，等下一回合助手回复挂载）。

用例：`test/writer.test.ts:288`「does not discard candidate images in an image-only batch」。

变异：`H2-图片only批次直接丢弃` → **RED ✅**；`H2b-用户批不放回候选`（`:236` 判据改恒假）→ **GREEN ❌**（全量套件亦不红）。功能实测该分支是对的：探针 `work/probe-hr3.mjs` (a) —— 「用户批之后 assets=[]（候选仍在排队）」→ 实际输出 `assets=[]`，随后助手批到达时 `assets=["shot.png"] 内联重写=1 追加图片行=0`，即候选确实被保留并正确挂载。缺陷仅剩测试缺口，见 [建议-5]。

### H3 重写单趟化 + realpath 去重 — 已消除（单趟化无回归测试）

实现：`src/image.ts:217-224` 以 `fs.realpathSync` 后的物理路径作去重键（同一文件被不同候选串引用只复制一次）；`:257-284` 正文重写改为「先打 `\u0000MDLOG_TOKEN_n\u0000` 占位、循环结束后统一 `replaceAll` 还原」（`:285-288`），杜绝互为子串的候选（`dup.png` 与 `sub/dup.png`）产生 `mdlog-assets/mdlog-assets/` 双前缀。

探针：`work/probe-hr3.mjs` (b) → `assets=["dup-2.png","dup.png"] 双前缀=false`，重写结果 `"先看 mdlog-assets/dup.png，再看 mdlog-assets/dup-2.png"`（两个不同物理文件各得一份、名字互不污染）。

变异：`H3-realpath去重关闭` → **RED ✅**（`deduplicates identical file referred by different candidate paths using realpath` 转红）；`H3b-重写退回边扫边替换`（去掉 token 中间态，直接就地替换成最终路径）→ **GREEN ❌**（单趟化这条修复目前完全靠探针守护，套件无回归用例）。见 [建议-5]。

### H4 围栏 `fenceChar` / `fenceLength` 补齐 — 已消除（writer→format 接线无用例）

实现：`src/format.ts:42-76` `scanCodeFences` 按 CommonMark 记录开栏字符与长度（`^ {0,3}(`{3,}|~{3,})`），闭栏要求同字符且长度 ≥ 开栏；`:114-121` 补齐时用 `char.repeat(Math.max(3, len))`。

探针：`work/probe-hr4.mjs` F 用例 —— 正文以 `~~~python` 开栏且被截断 → 落盘补齐字符为 `~~~`（不是硬编码的 ```` ``` ````），闭合有效。

变异：`H4-补齐退回固定三反引号` → **RED ✅**（`appends fence completion matching opening fenceChar and fenceLength`）；`H4c-围栏扫描只匹配反引号` → **RED ✅**（`detects tilde fences and checks length match`）；但 `H4b-writer不传fence信息`（删掉 `writer.ts:365-366` 的 `fenceChar`/`fenceLength` 两行）→ **GREEN ❌**：接线层没有断言，一旦有人重构掉这两行，`~~~` 围栏会退回三反引号补齐而套件全绿。见 [建议-5]。

### H5 图片异步化 + 超时 + clamp — 主体已落实，三点残留

落实部分：
- 复制改异步 `await fs.promises.copyFile`（`src/image.ts:229-232`），并与 `Promise.race` 的超时竞争（`:244-249`），`timeoutMs` 由 `processTurnImages` 选项传入（默认 5000），writer 侧从 `flush({ imageTimeoutMs })` 贯穿（`src/writer.ts:118/335`、`index.ts:307` 关档时压到 1000ms）；
- 单图字节上限本地兜底（`:131-135`，非法值回落 20MB）、`maxImageBytes`/`assetRetentionMb` 配置层 clamp（`:45-51`）、`cleanAssetRetention` 的 `safeMaxBytes` 下限（`:312`）；
- `buildImagePathRegex` 由配置驱动扩展名且强制剔除 `svg`（`:6-16`、`:53-58`）；
- 目录锚定：`:171-180` 以 `path.realpathSync(cwd)` 与候选的 realpath 做 `path.relative` 越界判定（`..weird.png` 不误伤，`..` 前缀/绝对化结果一律拒）。

探针实测（`work/probe-hr3.mjs` (c)、`work/probe-hr4.mjs` T）：

```
(c) 48MB timeoutMs=3 等待耗时=8ms 超时占位=true 稍后落盘文件=["big.png"]
(c) 1.5s 后 assets=["big.png"]（出现文件=超时后复制未被取消，正文与磁盘不一致）
T flush耗时=22ms 正文含超时占位=false 正文含正常引用=true 稍后资产=["huge.png"]
T 1.2s 后资产=["huge.png"] 正文引用=["mdlog-assets/huge.png"]
```

残留三点：
1. **超时不取消复制**：`Promise.race` 只是放弃等待，`copyFile` 仍在底层跑完 → 正文写「图片处理失败/跳过」而磁盘上文件迟到出现（或反之，正文引用了尚未落地的文件）。探针 (c) 与 `probe-a2.mjs [FIXED/orphan]` 的 3 个孤儿资产都是这条路径。
2. **定时器未 clear/unref**：`src/image.ts:244-249` 的 `setTimeout` 从不 `clearTimeout`，也不 `unref`。新写探针 `work/timer/probe.mjs` 实测：

```
processTurnImages 完成耗时: 3 ms  copied: ["shot.png"]
进程存活总时长: 5006 ms
```

   即：一张 2KB 图片 3ms 就复制完，进程仍被那张 5s 定时器钉住 5006ms。对常驻交互模式无感，但 `pi -p` 单次运行与测试进程会被拖满 5s/图（与 `737d694` 给心跳 `unref()` 的动机同源，属漏改）。见 [应当修复-4]。
3. **接线无测试**：`H5-timeoutMs未贯穿`（writer 传 `timeoutMs: undefined`）、`H5c-单图字节上限本地clamp移除`、`H5d-assetRetention本地clamp移除`、`H5b-复制退回同步 copyFileSync`（单项文件跑）→ 均 **GREEN ❌**。

### 本节变异检验汇总

| 变异 | 目标用例文件 | 结果 |
|---|---|---|
| A3-writer归一守卫移除 | test/writer.test.ts | RED ✅ |
| H1-共享去重状态未传递 | test/writer.test.ts | RED ✅ |
| H1b-未引用图片每条都追加 | test/writer.test.ts | RED ✅ |
| H2-图片only批次直接丢弃 | test/writer.test.ts | RED ✅ |
| H2b-用户批不放回候选 | 全量套件 | GREEN ❌ |
| H3-realpath去重关闭 | test/image.test.ts | RED ✅ |
| H3b-重写退回边扫边替换 | 全量套件 | GREEN ❌ |
| H4-补齐退回固定三反引号 | test/format.test.ts | RED ✅ |
| H4b-writer不传fence信息 | 全量套件 | GREEN ❌ |
| H4c-围栏扫描只匹配反引号 | test/format.test.ts | RED ✅ |
| H5-timeoutMs未贯穿 | 全量套件 | GREEN ❌ |
| H5b-复制退回同步copyFileSync | test/image.test.ts | GREEN ❌ |
| H5c/H5d-两处本地 clamp 移除 | 全量套件 | GREEN ❌ |
| H5e-svg过滤移除 | test/image.test.ts | RED ✅ |
| A2-sidecar失败回灌队列 | test/writer.test.ts | RED ✅ |
| R3/R3b-anchorLost 判据放宽/禁用 | test/writer.test.ts | RED ✅ |
| N1-formatHeader退回可见H1 | test/format.test.ts | RED ✅ |
| N1b-formatHeader无尾空行 | test/scan.test.ts | RED ✅（2 例） |
| N2-助手标签丢 class | test/format.test.ts | RED ✅（4 例） |
| CONTROL-仅改注释（对照组） | 全量套件 | GREEN（符合预期，证明上表 GREEN 不是假阴） |
| CTRL2-endsWith恒假（对照组） | 全量套件 | RED ✅（证明上表 RED 判定有效） |

探针与脚本：`work/probe-hr3.mjs`、`probe-hr4.mjs`、`r2-mut.mjs`（单文件口径 36 条）、`r2-mut2.mjs`（全量套件口径 14 条，含 2 条对照组）、`r2-mut3.mjs`（两条定点接线复验）、`timer/probe.mjs`（事件循环存活实测）。

## 第三节 其余 5 条应当修复（代码审查）
### R1 status「已写消息」实时增长（Item 12）— 通过

`src/writer.ts:457-459 getWrittenCount()`；`writtenCount` 只在正文与记忆双双落盘成功后自增（`:439`，与 `this.lastBlock = writtenLast` 同一代码块内），并经 `onWriteSuccess(ts, writtenCount)` 回传（`:147`）→ `index.ts:96-104` 写入 `currentState.writtenCount` → `formatStatusOutput`（`src/command.ts:97-110`）显示。

变异检验：`R1-writtenCount不增长`（删掉 `:435`）→ **RED ✅**，全量套件下 `test/lifecycle.test.ts:186`「increments writtenCount on live message events and reflects in status (gemini/qwen Item 12)」与 `:135` 同时转红。

### R2 空文本消息跳过（Item 13）— 通过（但守卫双层冗余，内层无测试）

两层：`index.ts:111-117 isValidMessage` + `:281-287 message_end` 前置过滤；`src/writer.ts:290-292` 再判 `rawText.trim().length === 0`。

变异检验：`R2-空文本不跳过`（writer 内层判据改恒假）→ **GREEN ❌**（全量套件亦不红）。外层有 `test/lifecycle.test.ts:225` 守护，因此行为仍正确；只是内层守卫成了「无测试的防御代码」。见 [建议-5]。

### R3 anchorLost 读回驱动 4a（Item 14）— 行为正确，接线仍零测试

- 判定收窄：`src/writer.ts:375-377` 仅当整批 `batchMessagesWritten > 0 && matchedCount === 0` 才回调 `onAnchorLost`；变异 `R3-anchorLost条件放宽`（去掉 `matchedCount === 0`）与 `R3b-anchorLost从不触发` → 均 **RED ✅**（`test/writer.test.ts:60` 与 `:92` 各守一侧）。
- 读回：`index.ts:45-47` `readSidecar(...)?.anchorLost === true` → `resolveAppendPlan({ anchorLost })` → `src/scan.ts:105-124` 跳过锚点扫描直接进 4a（有 UI `ask_user`、无 UI `append_only`），`test/scan.test.ts:131-137` 覆盖两条分支。
- 缺口：**「sidecar 里的 anchorLost 真被 index.ts 读回并影响决策」这条接线本身仍无测试**（`test/lifecycle.test.ts` 的 7 条用例都不预置 `anchorLost: true` 的 sidecar）。把 `index.ts:47` 改成 `const isAnchorLost = false;` 套件仍会全绿——与 `test/writer.test.ts` 的 mock 接线无关。并入手 [建议-5]。

### R4 其余接线项（Item 6 / 7 / 16 / 17 / 18 / 19 / 20）— 通过

| 项 | 落点 | 守护 |
|---|---|---|
| 6 角色过滤（非 user/assistant 不入队） | `index.ts:111-117`、`src/writer.ts:285-289` | `test/lifecycle.test.ts:135` RED ✅（随 R1 变异同批转红） |
| 7 目标父目录不存在时自动创建 | `index.ts:69-72`、`src/writer.ts:382-384`、`src/sidecar.ts:15-18` | `test/lifecycle.test.ts:171` |
| 16 锚点严格匹配（行级、围栏内不算） | `src/format.ts:4 ANCHOR_RE`、`src/scan.ts:16-79` | `test/scan.test.ts`（围栏区间与伪锚点用例） |
| 17 断开/未连接的提示语义 | `index.ts:186-193`、`src/command.ts:97-101` | `test/lifecycle.test.ts:225`、`test/command.test.ts:68` |
| 18 类型检查 | `tsconfig.json`（`strict: true`、`noEmit`、`include` 覆盖 index/src/test） | `npm run typecheck` 零输出零退出码（第六节） |
| 19 文档 | `README.md`（命令矩阵、`--full/--append/--no-open`、Node ≥ 22.6 的理由、同名命令 `mdlog:1` 冲突说明） | 人工审读；**未同步本轮版式改动**（见 N1） |
| 20 资产配额清理节流 30s | `src/writer.ts:61/155-166`、`_testSetLastAssetCleanTime` | `test/writer.test.ts:330` |

设计语言符合性（DESIGN.md 口径）：本仓库不产出任何 CSS/内联样式，只在 Markdown 里写类名钩子（`mdlog-who`）——检索 `src/format.ts`/`src/writer.ts` 无 `style=`、无 `color`/`font-weight`/`border-radius` 字样；对 7 个源文件做 emoji 码位扫描（`\u{1F000}-\u{1FAFF}`、`\u{2600}-\u{27BF}`、`\u{FE0F}`）结果全部为「无 emoji」，与 kami/DESIGN.md「无 emoji、字重仅 400/500、圆角 6px」约束不冲突（色板与字重由宿主 `src/styles/kami.css:1152-1200` 的 `mdlog` 作用域承担）。

### R5 测试缺口复验（原 SF12）— 部分改善，仍有 8 处「变异不红」

本轮共跑 50 条变异（`r2-mut.mjs` 单文件口径 36 条 + `r2-mut2.mjs` 全量套件口径 14 条，含 2 条对照组）。对照组 `CONTROL-仅改注释` = GREEN、`CTRL2-endsWith恒假` = RED，说明判定方向可信。结论：**21 条被现有用例捕获**（含全部 4 条阻断项与 H1/H2/H3/H4 的主干），以下 8 条为真实缺口（均已在全量套件口径下复核）：

1. `H2b` 用户批图片候选放回（`writer.ts:236-238`）；
2. `H3b` 正文重写单趟化（`image.ts:281-284` token 还原）；
3. `H4b` writer→format 的 `fenceChar/fenceLength` 接线（`writer.ts:365-366`）；
4. `H5` `imageTimeoutMs` 贯穿（`writer.ts:335`）；
5. `H5c/H5d` 两处本地下限 clamp（`image.ts:133-137`、`:312`）；
6. `R2` writer 内层空文本守卫；
7. `N3` 合并块 `head`（时间戳取最早）与 `isEnd` 吸收语义、降级路径的 `lastBlock` 记忆更新（详见第五节 N3）；
8. `Z1` 心跳 `unref()`（`sidecar.ts:102`）——把该行删掉后 `node --test test/sidecar.test.ts` 仍绿；只有整套跑完后的自然退出会暴露挂死，属「靠现象守护、无断言守护」。

判定：这些缺口都不改变「缺陷已修」的结论，但会让后续重构失去保护网。见 [建议-5]。

## 第四节 gemini 阻断 G1：`cmd /c start` 命令注入
**判定：已消除（两层防护各自可验，病态载荷在对照实验中确实可执行）。**

实现变更（`70c2aac`）：`src/command.ts:1` 由 `exec` 改 `spawn`；`:114-146`：

- 第一层：`openInVellum` 入口拒绝含 `"` `\r` `\n` 的路径（`:117-121`），`parseMdlogCommand` 同规则提前返回 error（`:69-76`），`index.ts:226-228` 见 `parsed.error` 即 `notify(error)` 并 return，不进入 `connectToFile`；
- 第二层：`spawn("cmd", ["/c", "start", '""', `"${absPath}"`], { windowsVerbatimArguments: true, stdio: "ignore" })`——不经 shell，路径整块落在**一个 argv 元素**里，且 `windowsVerbatimArguments: true` 保证 Node 不再二次转义（否则 `\"` 会让 cmd 解析错位）。

探针 `work/g1/probe.mjs`（**零窗口**：把被审 `src/command.ts` 复制到 `work/g1/copy/`，仅将其 `node:child_process` 换成记录型 stub（`work/g1/stub.mjs`），因此修复版路径**从不真正启动 cmd**；解析层实证统一把 `start` 换成 `echo`；注入载荷只写 marker 文件，绝不弹 calc/任何窗口）：

```
[1] 合法路径
    result: {"success":true}
    spawn 记录: {"cmd":"cmd","args":["/c","start","\"\"","\"C:\...\g1\tgt\ok-note.md\""],
                 "opts":{"windowsVerbatimArguments":true,"stdio":"ignore"}}
[2] 含双引号的注入载荷（前轮 G1 载荷形态）
    parse: {"action":"connect","error":"文件路径包含非法或危险字符 (引号或换行符)"}
    openInVellum: {"success":false,"error":"路径包含非法或危险字符 (\" \r \n)"}
    spawn 记录（应为空）: []            ← 该载荷连一次 spawn 都没发生
    marker 存在: false
[3] 仅 cmd 元字符（不含双引号）的载荷 X&echo+pwned>meta.marker&Y.md
    parse: {"action":"connect"}（放行，因为不含被禁字符）
    spawn 记录: args 末元素 = "\"C:\...\X&echo+pwned>C:\...\meta.marker&Y.md\""   ← 整条载荷仍在同一个带引号的 argv 元素内
    meta.marker（期望 false）: false
    把同一 argv 用 echo 替换 start 后 cmd 的输出: "start \"\" \"C:\...\X&echo+pwned>C:\...\meta.marker&Y.md\""
    该解析层是否写出 meta.marker（期望 false）: false     ← cmd 把引号内的 & 与 > 当字面量
[4] 病态基线（1fa5170 的 exec 字符串拼接）对照，verb 同样换成 echo
    旧实现构造出的命令行: cmd /c start "" "C:\...\g1\z.md" & node -e "require('fs').writeFileSync(process.env.G1_MK,'1')" & ""
    pwned.marker（病态版必须留痕，否则探针无效）: true    ← 注入真实生效（node -e 被拉起并写文件）
[5] 引号内 %VAR% 展开与 ^ 脱字符（残余面）
    cmd 输出: "\"\" \"C:\...\tgt\P%PATH: =^&echo+pwned^>pct.marker^&Q.md\""   ← 未展开、未拆解
    pct.marker（期望 false）: false
```

关键读法：`[4]` 与 `[3]` 用的是**同一族载荷、同一条 cmd 解析路径**（只把 `start` 换成 `echo` 以免弹窗），病态版留下 `pwned.marker`、修复版不留——即「变异检验：病态红 / 修复绿」成立；`[2]` 进一步证明前轮 G1 的原始载荷形态连 `spawn` 都到不了。

仓库内用例：`test/command.test.ts:45`「rejects path with internal quotes or newline injection attempts」、`:56`「rejects paths containing internal quotes or newline characters without executing」（载荷即 `foo.md" & calc.exe & "bar.md`，只断言拒绝、不真正执行，符合「严禁弹窗」）。变异 `G1-spawn退回exec字符串拼接` → RED ✅（该形态下 `spawn` 第二参非数组会抛，被 `:139` 的 catch 转成 success:false，从而被 `:56` 之外的路径暴露）。

残余面（不阻断，三条）：
1. **正向接线无断言**：套件里没有任何一条用例真的调用合法路径下的 `openInVellum`（`:56` 只测拒绝分支），所以「argv 形状正确 / `windowsVerbatimArguments` 不能被删」完全靠本探针守护。把 `{ windowsVerbatimArguments: true }` 删掉，Node 会自行二次转义 → 真实环境里 `start` 拿到错位参数（Vellum 打不开），套件仍绿。见 [建议-5]。
2. **`connectToFile` 不复核路径合法性**（新发现，与 G1 同源但独立）：`index.ts:35` 直接用 `lastConn.path` 落盘，`.md/.markdown` 与引号校验只在 `parseMdlogCommand` 里做。探针 `work/reconntest/probe.mjs`（同样用 stub，不真启进程）实测三条：

```
[既有 .txt 笔记] 目标: my-notes.txt 扩展名: .txt
      目标文件现在的内容前 60 字节: "<!-- mdlog:v1 s=sess-RECONN -->\n\nIMPORTANT 手工笔记，绝不能被改动\n\n"
      sidecar 是否生成: true
[批处理文件] 目标: payload.bat
      目标文件现在的内容前 60 字节: "<!-- mdlog:v1 s=sess-RECONN -->\n\n@echo off\necho DO-NOT-RUN\n\n"
[无扩展名文件] 目标: README
      目标文件现在的内容前 60 字节: "<!-- mdlog:v1 s=sess-RECONN -->\n\nhello\n\n"
      spawn 记录: (无)     ← session_start 走 noOpen:true，故不会 start 任意类型（该风险面不成立）
```

   即：只要会话档里存在一条 `mdlog:connection` 条目（`pi --resume`/`--session` 载入外部或被人改过的会话档），扩展就会向**任意路径**写文件、把指纹头**前置重写**进非 Markdown 的用户文件并生成 sidecar。`noOpen: true`（`index.ts:267`）确实挡住了「双击打开任意类型文件」这一半，剩下的这一半属任意文件写。见 [应当修复-5]。
3. Windows 短文件名（8.3）与 `%` 未参与校验：本探针 `[5]` 未复现出展开，不构成执行面；仅记录为未覆盖面。

---

## 第五节 新版式改动审读（`933f616..14791c8`）

### N1 formatHeader 只剩指纹行（无 H1）× scan.ts「保留现有内容」
**判定：通过（scan 侧「保留现有内容 + 首行指纹」断言在无 H1 后依然成立），但 spec 未同步修订。**

- `src/format.ts:78-81`：`formatHeader` 现在只返回 `<!-- mdlog:v1 s=${sessionId} -->\n\n`。
- `src/scan.ts:134-156 insertHeaderAtTopAtomic`：先 `extractSessionFingerprint(existing) === sessionId` 则整函数 no-op（防重复回填）；否则 `normalizeTrailingNewlines(existing)` 后 `header + normalizedExisting`，tmp 写 + `renameSync` 原子替换，`finally` 清 tmp。去掉 H1 后该逻辑一行未改，且仍然成立：
  - `test/scan.test.ts:159-163`：`updated.startsWith("<!-- mdlog:v1 s=sess-new-atomic -->\n\n")` **且** `includes("# Existing User Notes\n\nNote line 1.")` —— 「用户原有内容完整保留在文件头之下」（spec §3.5 步 4b）仍被逐字断言；
  - `test/scan.test.ts:177-181`：4b 全串等值断言已随之更新为 `"<!-- mdlog:v1 s=sess-new-4b -->\n\n# 我的旧笔记\n最后一行没有换行符\n\n"`，同时仍断言 `endsWith("\n\n")`。
  - 指纹判定链未受影响：`FINGERPRINT_RE`（`format.ts:3`）与宿主受信门禁（`Vellum/src/components/MarkdownDocument.tsx:307` 与 `:524` 的 `/^\uFEFF?\s*<!--\s*mdlog:v1/`）依旧只依赖首行注释；H1 从来只是给**人**看的标题，删除它不改变任何一条机器判定。
- 变异检验：`N1-formatHeader退回可见H1标题` → **RED ✅**（`outputs byte-exact header with trailing blank line`）；`N1b-formatHeader无尾空行` → **RED ✅ 2 例**（`inserts header at line 1 of foreign non-empty file atomically`、`normalizes non-empty file without trailing newlines to end with double newline (spec §3.5 4b)`）——说明「指纹 + 恰好一个空行」被逐字节锁住。
- **偏差（必须列出）**：spec `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md` 第 128 行（§3.4 模板）、第 183 行（§3.5 步 1）、第 241 行（§3.5 步 4b）**三处仍明文要求写入 `# Pi 对话记录`**。项目侧契约文档 `.pi/skills/vellum-mdlog/SKILL.md:18` 已改为「不写 `# Pi 对话记录` 之类的标题」，即当前实现与**技能文档**一致、与**设计规格**冲突。宿主侧 `91d3925 feat(mdlog): D 书札卷轴版式落地` 已用 `markdown-body--mdlog` 作用域样式接管版式（`Vellum/src/styles/kami.css:1152-1200`），因此实现方向是对的，缺的是把 spec 三处同步掉。见 [应当修复-6]。
- 副作用（如实记录，非缺陷）：日志不再有 H1 ⇒ Vellum 侧栏大纲对纯对话日志一般为空（除非正文里有 `##` 标题），`spec §3.4` 的「文档标题」语义改由宿主窗口标题承担。

### N2 assistantLabel 输出 `<p class="mdlog-who">` 原始 HTML
**判定：通过（原始 HTML 只在「受信 mdlog 文档」里获得视觉语义；不受信时最坏退化为一行普通段落，且不存在样式越界面）。**

产物：`src/format.ts:89-92` `assistantLabel(time)` → `<p class="mdlog-who"><strong>Pi</strong> · HH:MM</p>\n\n`；用户侧仍用 blockquote 首段（`:84-86`），宿主用 `blockquote > p:first-child` 上朱红章点。

逐条核对：

1. **只有受信文件才会被宿主自动挂载**：受信判定是 `Vellum/src/components/MarkdownDocument.tsx:307` / `:524` 的 `^\uFEFF?\s*<!--\s*mdlog:v1`（首行），而扩展保证：新建文件先写指纹（`index.ts:75-78`）、外部文件全量回填走 `insertHeaderAtTopAtomic` 的原子前置（`scan.ts:136-156`）。**指纹始终在该 HTML 段之前**，故 `mdlog-who` 生效的文档必然同时是 `markdown-body--mdlog` 作用域文档（`:529` 的 className 拼接是同一次渲染内的同一个判定）。
2. **sanitize 通配 className 的影响面确实只有样式**：宿主 `kamiSchema`（`MarkdownDocument.tsx:193`）用 `"*": ["className", ...]` 放行类名，`p` 在 `defaultSchema.tagNames` 内 ⇒ 该段原样存活。样式规则全部挂在 `.markdown-body--mdlog` 作用域下（`Vellum/src/styles/kami.css:1152-1200`，含 `p.mdlog-who` 与 `blockquote > p:first-child` 共用的 9px 章点、`hr { display: none }`），非受信文档拿不到这个作用域 ⇒ 外部 md 里手写 `<p class="mdlog-who">` 最多得到一个无样式的空段落，**没有越权样式、更没有脚本面**（`class` 不是事件属性，`on*` 未被放行）。
3. **退化模式可接受**：若将来有人收紧 schema 把 `className` 摘掉，产物退化为 `<p><strong>Pi</strong> · 21:33</p>` —— 说话人仍可读，只是丢掉靛青章点；纯文本查看（GitHub/编辑器）时 `<p>`/`class` 变成噪音，这是本次版式改动换来的代价，且与 spec 建议 1「保持 Markdown 纯文本的高度便携性」的取舍**方向相反**，属于版式决策变更（spec 未同步，见 N1 [应当修复-6]）。
4. **实测产物字节**：`test/format.test.ts:113-135 / :171-185` 对含标签、含围栏补齐、含 `extraImages` 三种形态做了整串等值断言；`test/merge.test.ts:115` 断言落盘文本里出现的是 `<p class="mdlog-who"><strong>Pi</strong>`。变异 `N2-助手标签丢 class`（把标签退回纯 `**Pi** · time`）→ **RED ✅ 4 例**（format 3 条 + 合并/写入侧各若干），说明该形态被逐字节锁死。
5. **宿主侧证据**：`Vellum/outputs/mdlog/acceptance-fixtures/check1/2-3/4-5/6-7/8-*.md` 五个治具的首个助手块就是这一行（第 9 行），且 `5e99f85` 记录「§9.3 沙箱隔离八项验收七项 PASS（用户实测）」；`.markdown-body--mdlog hr { display: none }` 意味着 N3 讨论的 `---` 在 Vellum 内不可见（该点在 N3 的判定里会被再次引用）。

### N3 碎片合并（重点）：lastBlock 跨批次重写
**判定：合并本身正确（批内/跨批次均无正文重复、锚点取舍正确、外部编辑能降级不重复），但这段新逻辑引入了 3 个应当修复问题（落盘原子性、discard 不取消在途链、剥尾换行后的接缝黏连），且 3 处关键语义无测试守护。**

#### 机制（`src/writer.ts:252-278` + `:396-441`）

1. 逐条消息改为先落「片段」：`pushPiece(role, head, body, anchor, isEnd)`——与上一个片段同角色则并入 `bodies[]`、`anchor` 取**新到者**、`isEnd` 取**新到者**；否则开新 `run`。
2. `serializeRun`：user 块 = `head + bodies.join("\n>\n") + "\n\n" + anchor`；assistant 块 = `head + bodies.join("\n\n") + "\n\n" + anchor + (isEnd ? "---\n\n" : "")`。
3. 跨批次：若 `runs[0].role === this.lastBlock.role`，用 `lastBlock.head`（**保留最早时间戳**）+ `[...lastBlock.bodies, ...runs[0].bodies]` 组出 `merged`，`rewriteOld = lastBlock.serialized`、`rewriteNew = serializeRun(merged)`，然后 `content.endsWith(rewriteOld)` 判定 → 整文件 `readFileSync` + `writeFileSync` 重写尾部；判定失败（文件被外部改过）→ 降级 `appendFileSync(standaloneFirst + buffer)` 并把 `lastBlock` 记忆改指向该独立块。

#### 仓库用例与逐条变异（`test/merge.test.ts`，5 条，全绿）

| merge.test 用例 | 断言要点 | 对应变异 | 结果 |
|---|---|---|---|
| 批内合并：三条 assistant 一条 user | 标签数 1、正文 `第一段\n\n第二段\n\n第三段`、中间锚点被吞、保留 `m=e-a2`、末尾仍 `---\n\n` | `N3-批内不合并不分run` | RED ✅ 2 例 |
| 连续 user 合并为单个引用块 | 只有 1 个 `> **你**`、`> 第一句\n>\n> 第二句` | `N3-user引用空行分隔改普通空行`（改 `"\n\n"`） | RED ✅ |
| 跨批次合并 | 标签数 1、`上一批正文\n\n下一批正文`、旧锚点+旧 `---` 被吸收、全文只剩末尾 1 条 `---` | `N3-endsWith判定恒假` | RED ✅ |
| 同上 | 同上 | `N3-endsWith判定恒真` | RED ✅（`降级路径` 用例转红） |
| 同上 | 保留末条锚点 | `N3-锚点取首条而非末条` | RED ✅ |
| 同上 | 正文不重复、外部内容保留、顺序正确、两块各带标签 | `N3-外部编辑仍走重写(正文重复)`（读内容改 `""`） | RED ✅ |
| 角色切换不合并 | 先 `> 问` 后 `答` | — | — |
| （无） | `isEnd` 吸收规则（`isEnd: runs[0].isEnd`） | `N3-isEnd不吸收` | **GREEN ❌** |
| （无） | 合并块 `head` 取最早时间戳 | `N3-合并块head取新批` | **GREEN ❌** |
| （无） | 降级路径必须更新 `lastBlock` 记忆 | `N3-降级路径不更新lastBlock` | **GREEN ❌** |

⇒ 任务书要求的变异探针（`endsWith` 恒真/恒假）双双转红，`isEnd` 的 `---` 吸收、锚点保留末条、外部编辑降级不重复、user 块 `>` 空行分隔四项**均有活断言**（后三项中「isEnd 吸收方向」只在「吸收」这一侧被验证，改回不吸收不会红——即语义被固定但理由没被写进用例）。见 [建议-5]。

#### 本轮独立探针实测（`work/r2-n3.mjs`、`work/seam.mjs`；被审仓库零改动）

```
=== P1 上一批 isEnd 分隔线是否被跨回合合并吃掉 ===
批1末尾分隔线: true
批2后分隔线条数: 1  并入同一块: true
批2后尾部60字节: "rong> · 11:53</p>\n\n回合A正文\n\n回合B正文\n\n<!-- mdlog:m=ea2 -->\n\n---\n\n"

=== P2 外部编辑（尾部换行被删）后降级追加的接缝 ===
第二批正文出现次数: 1  第一批出现次数: 1        ← 无重复正文
（seam.mjs 细查）降级接缝: ":m=s1a -->\n\n---<p class=\"mdlog-who"   ← 旧尾行 --- 与新标签黏成同一行

=== P3 合并重写的原子性：并发读者看到的截断 ===
基线大小: 2412121  读者统计: {"reads":334146,"empty":6,"shorter":0}

=== P4 合并重写写放大（1MB 既有内容，8 次同角色碎片批次） ===
8 批总耗时: 45ms 最终大小: 1002171 标签数: 1  碎片全部并入同一块: true

=== P5 destroy(discard) 之后在途批次是否仍落盘 ===
重试注入次数: 3  discard 后文件仍被写入: true

=== P6 off 后立即 reconnect 同一文件：丢更新/顺序颠倒 ===
W1 落盘: true  W2 落盘: true  顺序颠倒(W2 先于 W1): true

=== P7 全被过滤的空文本批次之后仍可继续合并 ===
标签数: 1  仍并入同一块: true  第一批次数: 1     ← lastBlock 记忆未被空批次清掉

=== P8 writtenCount 与合并块数 ===
回调收到的 writtenCount: 3  getWrittenCount: 3  块数: 1   ← 计数按消息不按块，自洽
```

**应当修复-1（P3，最重）**：`:421-427` 的合并落盘用 `readFileSync` + **`writeFileSync` 整文件覆写**，`writeFileSync` 以 `'w'` 打开 ⇒ 先 truncate 再写。子进程轮询实测 `empty: 6`——5s 内 33 万次读里有 **6 次看到 0 字节文件**。宿主侧 `src-tauri/src/watcher.rs:9` 的 400ms 去抖 + `file-changed`/`mdlog-state-changed` 事件 ⇒ 存在把文档读成空/半截的现实路径（轻则 Vellum 闪一次「空文档」，重则 `insertHeaderAtTopAtomic` 那种「先读后原子重写」的安全假设被绕过）。同文件对 sidecar（`sidecar.ts:12-34`）与对文件头插入（`scan.ts:158-168`）都用了 tmp+rename 原子写，**唯独这条新加的正文字节重写没有**，属明确的自我一致性缺口。修法：把 `merged` 结果写 tmp 再 `renameSync`（Windows 下 `MOVEFILE_REPLACE_EXISTING` 语义 Node 已保证）。

**应当修复-2（P6）**：`index.ts:196` 的 `writer.destroy({ discard: true }).catch(() => {})` 不 await，且 `executeBatchWriteWithRetry`（`writer.ts:169-188`）与链回调（`:118-167`）都不检查 `isDisposed`。实测：`_testInjectAppendFailure` 制造 2 次失败后调用 `destroy({discard:true})`，旧批次仍在 900ms 内落盘（P5：`discard 后文件仍被写入: true`），并且**落在新 writer 之后**（P6：`顺序颠倒(W2 先于 W1): true`）⇒ 与 spec §3.6「主动断开＝取消重试与写入」相悖，`/mdlog off` 紧跟 `/mdlog 同一文件` 时日志会出现顺序倒错。修法：链回调与每次重试前 `if (this.isDisposed) return;`，`destroy` 返回前 `await` 在途链（`session_shutdown` 已是 await 口径，`:196` 是唯一破坏点）。见 [应当修复-2]。

**应当修复-3（P2/seam）**：降级追加路径 `:429`/`:434` 直接 `appendFileSync`，而 `ensureTrailingNewlinesOnFile()` 被 `firstWriteNormalized`（`:62/385-388`）限成**每实例一次**。外部编辑器保存时剥掉尾部换行（VSCode `files.trimFinalNewlines` 就是这个行为）后，实测接缝为 `-->` `\n\n` `---<p class="mdlog-who"` —— 回合分隔线 `---` 与新块标签**同一行**，直接违反 spec §3.4（行 211）「`---` 前后必须有空行」；`---` 后紧跟文本也不再是 thematic break（Vellum 因 `hr{display:none}` 看不出来，纯文本/GitHub 视角则是坏块）。修法：`:429`/`:434` 前统一过一次 `normalizeTrailingNewlines`（或把 `ensureTrailingNewlinesOnFile` 的调用移出 once 守卫）。

**建议（isEnd 语义，P1）**：`isEnd` 取自「是否本批最后一条」（`:317`），不是「是否回合末」。合并时 `isEnd: runs[0].isEnd`（`:404`）会吸收上一批留下的 `---`。同回合被拆成多批的碎片（工具调用后的续写：`[assistant#1]` → `[assistant#2]`）本来**必须**吸收，这正是设计意图（`test/merge.test.ts:71` 用例名即「且不残留 --- 分隔线」）；但当下一回合的 user 消息因**无文本**（纯图片 prompt）被 `:290-292` 过滤掉时，两个不同回合会被并进同一块且分隔线消失（P1 实测：批2 后全文只剩 1 条 `---`，`回合A正文\n\n回合B正文`）。Vellum 里 `hr` 隐藏 ⇒ 无视觉后果；纯 Markdown 消费方会丢一个回合边界。建议改用回合起始信号（`turnStartTime` 变化或 `agent_start` 事件）决定 `isEnd`，而不是批内位置。

**建议（写放大，P4）**：每次跨批次合并都整文件重写。1MB 日志 8 批实测 45ms（约 5.6ms/MB·次），线性外推 10MB 日志 + 200 条同角色碎片 ≈ 11s 累计 IO 与 ~2GB 写入量。与 [应当修复-1] 的 tmp+rename 一并考虑时更要注意：**tmp+rename 会把写入量翻倍**，因此更彻底的做法是把「合并块尾部重写」限制为「块尺寸 < 阈值时才重写，否则降级追加」，或记录 `lastBlock` 的字节偏移用 `fs.openSync(path,'r+')` + `write` 定点覆写（此时必须配 rename 之外的原子性说明）。

#### 小结

- 功能正确性：批内/跨批次合并、锚点保留末条、外部编辑降级不重复、空批次不清记忆、`writtenCount` 语义 —— **全部通过实测**（P1/P2/P7/P8 + 5 条 merge.test 用例）。
- 数据安全：**新增** 1 个非原子覆写风险（P3，实测 6 次读到空文件）+ 1 个断开竞态（P5/P6）+ 1 个字节契约破口（seam）。

---

## 第六节 套件健康
**判定：通过（86 用例 / 85 绿 / 1 跳过，7.1s 自然退出，typecheck 零错误）。**

`cd C:/Users/17445/.pi/agent/extensions/mdlog && npm test`（HEAD `14791c8`，工作树干净）真实输出：

```
✔ LiveLogWriter
  ✔ batches messages with 150ms debounce and matches branch entryId (275.0487ms)
  ✔ handles degraded match when entryId is not found (anchorLost: true) (2.7235ms)
  ✔ does not trigger anchorLost when at least one message matches in the batch (narrowed Y6-e condition) (1.9056ms)
  ✔ retries up to 3 times on simulated file lock and disconnects after 3 failed batches (873.2665ms)
  ✔ does not duplicate messages when onWriteSuccess throws error (narrow transaction boundary) (3.7419ms)
  ✔ normalizes existing file lacking double trailing newlines before first append (2.3162ms)
  ✔ processes turn images once per batch across multiple assistant messages without duplication (spec §4.5, gemini/qwen Item 8) (7.6657ms)
  ✔ does not discard candidate images in an image-only batch (gemini/qwen Item 9) (4.7736ms)
  ✔ throttles cleanAssetRetention to run at most once per 30 seconds (Item 20) (5.063ms)
ℹ tests 86
ℹ suites 28
ℹ pass 85
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 6490.2965

real	0m7.064s
```

- 与要求基线一致：**86 用例、85 绿、1 跳过**；跳过的唯一一条是 `test/e2e.test.ts` 的「runs fake prompt with cli sub-process」，本机无可用模型 key（skip 原因字符串由 `t.skip()` 打印，见 A4）。
- **无挂死**：`node --test` 自然退出（7.064s ≪ 120s），无 `cancelled`。这条前提由两处 `unref` 撑着——`sidecar.ts:102` 心跳 `timer.unref()`（commit `737d694`）与 `command.ts:127` 的 `stdio: "ignore"`；但两者都**没有断言守护**（`Z1-heartbeat不再unref` 变异 → 单文件 GREEN；本轮又实测出 `image.ts:246-249` 的超时定时器未 clear/unref，`work/timer/probe.mjs` 显示一张图可让进程多活 5006ms，见 H5 残留 2 —— 这是当前**唯一还能把套件拖到分钟级**的活体风险，只是现有图片用例的 `timeoutMs` 都足够小或复制足够快而侥幸不显形）。
- `npm run typecheck` → `tsc --noEmit` 零输出、退出码 0（`tsconfig.json` `strict: true`，`include` 覆盖 `index.ts` + `src/**` + `test/**`）。
- 副本可复现性：`git archive`/`tar` 复制出的 `work/mutn` 跑同一条命令得到同样的 `tests 86 / pass 85 / skipped 1`（6397ms），证明变异副本未被上一轮遗留污染。

---

## 第七节 新伤排查：writeChain 串行 × lastBlock 状态（并发 flush / destroy）
**判定：`writeChain` 串行 + `lastBlock` 状态机在单实例内自洽（探针 C1–C5 全通过）；跨实例（`off` → 立即重连）与 `discard` 路径存在真实竞态，已在 N3 记为 [应当修复-2]。**

`work/chain.mjs` 实测（HEAD）：

```
C1 并发 6 次 flush -> 缺失/重复条数: 0  标签数: 6  writtenCount: 6
C2 两条都在: true  顺序正确: true  重复: 1
C3 destroy(await) 后已落盘: true
C4 销毁后写入被拒: true
C5 连续失败 4 批 -> fatal 回调次数: 1  文件字节数: 24
```

逐条结论：

1. **C1（并发 flush）**：`agent_settled` 的 `void writer.flush()`（`index.ts:299-303`）与防抖 `setTimeout` 回调（`writer.ts:103-107`）可同帧触发。`flush()` 采用 `this.writeChain = this.writeChain.then(cb)`（`writer.ts:118`），回调体内才读取 `messageQueue` / `lastBlock`，因此 6 次并发 flush 被压成一条串行队列，**无重复、无丢失、无乱序**；`lastBlock` 因此不需要额外锁。`writtenCount` 恰为 6（按消息计，非按块计）。
2. **C2（链内 await 期间新到消息）**：链回调 `await processTurnImages` 时新 `enqueueMessage` 的消息进入下一格链，落盘顺序与入队顺序一致、不重复。⇒ 「图片异步化 + 串行链」不会把 `lastBlock` 记忆和在途内容错配。
3. **C3/C4（destroy）**：`destroy()` 默认路径 `await this.flush()`（`:473`）⇒ 在途内容落完才返回，`session_shutdown`（`index.ts:305-313`）与该语义匹配；`isDisposed` 之后 `enqueueMessage`/`enqueueImageCandidates` 均直接 return（`:91/:97`），销毁后写入被拒 ✓。
4. **C5（熔断）**：连续 4 批失败只回调 1 次 `onFatalError`（`fatalReported` 闩锁，`:137-141`），文件保持 24 字节（只有头）⇒ 无半成品写入、无 toast 风暴。
5. **破口 1：`disconnect()` 不等在途链**（`index.ts:196`）：`writer.destroy({ discard: true }).catch(() => {})` 不 await，且链与 `executeBatchWriteWithRetry` 都不检查 `isDisposed`。P5/P6 已实测到「discard 后仍落盘」与「新旧 writer 顺序颠倒」。**跨实例还有第二条路径**：`connectToFile` 里 `await writer.destroy()`（`:63-66`）用的是默认（await）口径 ✓，所以唯一破坏点就是 `:196`。
6. **破口 2：合并重写的读-改-写非原子**（`writer.ts:420-427`，P3 实测 `empty: 6`）。这不只是「读者看到半截」，还意味着**同实例内的读-改-写与外部修改者之间没有互斥**：若外部工具在 `readFileSync` 与 `writeFileSync` 之间追加过内容，这段追加会被整文件覆写**丢掉**。扩展自身不感知（无 inode/mtime 校验）。建议 `writeFileSync(tmp) + renameSync`（原子）并可选 `statSync` 版本号比对。见 [应当修复-1]。
7. **`lastBlock` 生命周期**：只在 `writer.ts:438` 整块赋值，且降级分支同步改写记忆（`:430`）；空批次（全被过滤）不会清空记忆（P7 实测 `标签数: 1`）；`image-only` 批次在 `:200-205` 提前 return，同样不动记忆 ⇒ 不会出现「记忆与文件尾不一致导致 `endsWith` 长期失败」的退化锁死。唯一未被测出的破坏是 `N3-降级路径不更新lastBlock`（变异 GREEN），当前实现是正确的。
8. **资源**：`sharedImageState` 的 `realPathMap`/`allocatedNames` 为每批局部量，随批次回收；`imageCandidatesQueue` 在「始终没有助手回复」的极端会话里可无界增长（每条候选只是一个短字符串，且 `tool_execution_end` 频率有限）⇒ 记为可接受，未列问题。心跳定时器 `stop()` 前置 `clearInterval` 且 `start()` 内先 `stop()`（`sidecar.ts:93`）不会叠加。

---

## 第八节 问题清单
### 复检结论汇总（前轮遗留）

| 前轮编号 | 本轮判定 |
|---|---|
| 阻断 A1 sidecar 写异常隔离 | **已消除**（8 例 A/B 场景 + 4 例接线场景全绿，病态基线 exit=9） |
| 阻断 A2 写入事务边界 | **已消除**（`cbthrow` 修复版 A=1/B=1/C=1、病态 A=3；变异 RED） |
| 阻断 A3 尾部换行归一（含 §3.5 步 4b） | **已消除**（三态字节一致；变异 RED；残留破口见应当修复-3） |
| 阻断 A4 e2e 恒绿 | **已消除**（4 类变异全红；真故障不再被 skip 掩盖） |
| 高风险 Item 8/9/10/11/15 | **实现全部落实**（H1–H5 功能探针实测）；Item 15 有两点残留（应当修复-4） |
| Item 12/13/14/16/17/18/19/20 | **通过**（R1–R4；R3/R5 记接线与测试缺口） |
| SF9 + gemini 阻断 G1 `cmd /c start` 注入 | **已消除**（spawn argv + 引号黑名单双层；病态对照留 marker、修复版不留） |

### 本轮新增问题清单

**[应当修复-1] `src/writer.ts:420-427`** — 碎片合并的重写用 `readFileSync` + `writeFileSync` **整文件覆写**，非原子。探针 `work/r2-n3.mjs` P3：2.4MB 日志、8 次合并重写，子进程轮询 334146 次读到 **6 次 0 字节**。宿主 `src-tauri/src/watcher.rs:9` 的 400ms 去抖 + `file-changed` 会把这一瞬间喂给前端；同时这条读-改-写与外部编辑者之间无任何互斥/版本校验，落在窗口内的外部追加会被静默覆盖。同仓库对 sidecar（`sidecar.ts:12-34`）与文件头（`scan.ts:158-168`）都已用 tmp+rename，**唯独产物正文的新写路径倒退**。修法：tmp 写 + `renameSync`，并为 Windows 上偶发 `EPERM`（读者句柄未让出 DELETE）配 1–2 次微重试；同时按建议-3 控制写放大。

**[应当修复-2] `index.ts:196` + `src/writer.ts:169-188`（`executeBatchWriteWithRetry`）/ `:118-167`（链回调）** — `disconnect()` 对 `destroy({ discard: true })` 只 `.catch(() => {})` 不 await，链与每次重试都不检查 `isDisposed`。实测 P5「discard 后文件仍被写入: true」、P6「顺序颠倒(W2 先于 W1): true」⇒ 与 spec §3.6「主动断开＝取消重试与写入」直接相悖，`/mdlog off` 紧接 `/mdlog 同一文件` 会让旧会话内容落到新内容之后（`full` 模式下还会与回填重复）。修法：链回调 + 每次重试前 `if (this.isDisposed) return;`，`destroy({discard})` 也 `await` 在途链（丢弃语义靠标志位而非不等链）。

**[应当修复-3] `src/writer.ts:429` / `:434`（降级追加）+ `:62/:385-388`（`firstWriteNormalized` 每实例一次）** — 外部编辑器保存时剥掉尾部换行（VSCode `files.trimFinalNewlines` 默认行为）后，`content.endsWith(rewriteOld)` 失败 → 直接 `appendFileSync`，实测接缝 `":m=s1a -->\n\n---<p class=\"mdlog-who"` —— 回合分隔线 `---` 与下一个块标签**同行**，违反 spec §3.4（行 211）「`---` 前后必须有空行」；纯 Markdown 消费方会丢回合边界（Vellum 内 `hr{display:none}` 掩盖）。修法：两处 `appendFileSync` 前先 `normalizeTrailingNewlines(content)` 回写，或把归一调用移出 once 守卫（该函数本身幂等）。

**[应当修复-4] `src/image.ts:244-249`** — 图片复制的 `Promise.race` 超时定时器既不 `clearTimeout` 也不 `unref`。探针 `work/timer/probe.mjs`：一张 2KB 图 3ms 复制完成，进程仍存活 **5006ms**。对常驻交互无感，但 `pi -p` 单次运行/测试进程会被拖满 5s/图；且超时只是放弃等待，`copyFile` 仍在底层完成 ⇒ 出现「正文写『图片处理失败』而磁盘上文件迟到」（`probe-hr3` (c)、`probe-a2 [FIXED/orphan]` 的 3 个孤儿资产）。修法：`const t = setTimeout(...)` + `finally { clearTimeout(t); }`，并在超时后对已写出的目标文件做 `unlink` 或改判为「稍后重试」。

**[应当修复-5] `index.ts:267` → `:35`（`connectToFile` 直接 `path.resolve(lastConn.path)`）** — 自动重连路径不复用 `parseMdlogCommand` 的字符与扩展名校验。探针 `work/reconntest/probe.mjs` 实测三条（`spawn` 走记录 stub，未真启进程）：`.txt`、`.bat`、无扩展名文件均被写入指纹头并生成 sidecar，原内容以「指纹 + 原内容」的形式被原子重写。`session_start` 传 `noOpen: true`（`index.ts:267`）确实挡住了「`start` 任意类型文件」，剩下的面是**任意路径写 + 改写用户既有文件**。修法：`connectToFile` 开头复用同一份校验（扩展名 ∈ {md, markdown}、无 `"\r\n`），不合格即 notify 并放弃重连。

**[应当修复-6] 规格/文档漂移** — `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md:128 / :183 / :241` 仍明文要求文件头含 `# Pi 对话记录`，与 `14791c8` 的实现（只写指纹行）冲突；`.pi/skills/vellum-mdlog/SKILL.md:18` 已改为「不写标题」。同时扩展 `README.md` 未记录本轮三项版式改动（无 H1、`mdlog-who` 类名依赖宿主 `kami.css:1152-1200`、同角色碎片合并与其「块重写」IO 特征）。按本项目「规格先改、代码后动」的纪律，属必须补的文档债。

**[建议-1] `src/sidecar.ts:12-34`** — 失败被完全静默（返回 `false`，无计数、无 `notify`）。连续 N 次失败时用户看不到「记录器在写但侧车不更新」的原因；建议累计计数并在阈值处 notify 一次（沿用 `fatalReported` 闩锁风格）。

**[建议-2] `src/writer.ts:169-188`** — 重试整批重跑，`sharedImageState` 是每批局部量 ⇒ 每次重试重复复制图片（`shot-2.png`/`shot-3.png` 孤儿）。把图片处理移到重试圈外做一次、把结果作为参数传入 `writeBatchToDisk`。

**[建议-3] `src/writer.ts:421-427`** — 写放大：每次跨批次合并都整文件重写。1MB 日志 8 批实测 45ms（≈5.6ms/MB·次），10MB 级日志 + 数百条同角色碎片的累计 IO 达 GB 量级（`work/r2-n3.mjs` P4）。可与应当修复-1 一并处理：块超过阈值（如 2MB）时降级为纯追加、不合并。

**[建议-4] `test/e2e.test.ts`** — 进程内用例不驱动 `connect` 分支（见 A4 残余 1）；补一条「`/mdlog <tmp>.md --append` → `message_end` → 文件里出现 `mdlog-who` 与锚点」的最小真接线断言。

**[建议-5] 测试缺口（8 处「变异不红」，全部在全量套件口径下复核）** — `H2b` 用户批候选放回、`H3b` 正文重写单趟化、`H4b` writer→format 的 `fenceChar/fenceLength` 接线、`H5` `imageTimeoutMs` 贯穿、`H5c/H5d` 两处本地 clamp、`R2` writer 内层空文本守卫、`N3` 的 `isEnd` 吸收方向 / 合并块 `head` 取最早 / 降级路径 `lastBlock` 记忆更新，另有两条本轮定点复验（`work/r2-mut3.mjs`，BASELINE exit=0 fail=0）：

```
windowsVerbatimArguments 删除                GREEN ❌（无断言守护） exit=0 fail=0
index.ts anchorLost 读回改恒 false           GREEN ❌（无断言守护） exit=0 fail=0
```

以及 `Z1`（心跳 `unref` 删除后单文件仍绿）。⇒ 当前 86 条用例对**纯函数**侧（format/image/scan/command）覆盖扎实，对**接线与降级分支**侧仍是薄区；这解释了为什么「实现正确」与「实现被守护」必须分开判定。
