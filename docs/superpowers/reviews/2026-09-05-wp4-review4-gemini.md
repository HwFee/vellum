# WP4 第四轮 · 最终增量短复审报告（`6f91102..6a7628e`）

**审核对象**：`C:\Users\17445\.pi\agent\extensions\mdlog\`，HEAD = `6a7628e`  
**审核范围**：**仅** `git diff 6f91102..6a7628e`（共两个 commit：`2443443` 唤起直连与 `6a7628e` 放行条件整改）。第三轮已放行项不重审，仅做回归与新伤排查。  
**对照依据**：第三轮报告 `2026-09-05-wp4-review3-qwen.md` 之「放行条件 ①-⑥」；spec `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`。  
**审核原则**：只读静态审 + scratch 探针 + 变异检验；全程零弹窗（静默 marker）。被审仓库全程零写入。

---

## 结论

### **通过（放行）**

第三轮终审报告 `2026-09-05-wp4-review3-qwen.md` 提出的放行条件 ①-⑥ 已全部达成，实测证据完备且均有变异转红验证：

1. **放行条件 ① `destroy(discard)` 真等链**：`writer.ts:519` discard 分支加入 `await this.writeChain.catch(() => {})`。在途链挂起实测表明，`destroy({ discard: true })` 返回瞬间在途链已真正 settle，临时文件 `.tmp` 零残留，且第二批新正文未迟到写入。配套用例 A 通过，去链变异后精确转红。
2. **放行条件 ② 退避窗后第二道 `isDisposed` 闸**：`writer.ts:468` 在 `await sleep(delay)` 后、`fs.renameSync` 前补设第二道 `isDisposed` 门禁。配套用例 B 通过，删闸变异后精确定位到断开后 rename 迟到落盘转红。
3. **放行条件 ③ 两条降级追加路径的门禁**：`writer.ts:431`（`!ok` 分支）与 `:438`（尾块不符分支）均在前置位补齐 `if (this.isDisposed) return;`。配套用例 C 通过，删门禁变异后精确定位到降级追加迟到写盘转红。
4. **放行条件 ④ / 应当修复-新2 `disconnect` 尾链 catch 兜底**：`index.ts:204-213` 将 promise 结构改造为后置 `.then(() => { ... }).catch(() => {})`。P11 探针复测（同名目录引发 3 批连败熔断 + 模拟 ctx 失效 `appendEntry` 抛错）证实：HEAD（`6a7628e`）进程存活 exit=0，而未兜底的变异版本（`6f91102` 结构）必定发生未捕获 rejection 导致 exit=1 崩溃。
5. **放行条件 ⑤⑥ 规格注释与用例收口**：注释与实现严格对齐，`test/merge.test.ts` 新增用例 A、B、C 真实有效且具备变异可红守护。
6. **唤起直连（commit `2443443`）**：`src/command.ts` `openInVellum` 候选优先级（`config.vellumPath` → `MDLOG_VELLUM_PATH` → `%LOCALAPPDATA%` 安装位 → 系统关联 `cmd /c start` 兜底）实现规范；危险字符闸（`"`、`\r`、`\n`）保持严密；子进程均配置 `detached: true` 与 `child.unref()`，生命周期与宿主完全解耦，Node 事件循环排空仅耗时 8ms。

**建议挂号（非阻断）**：
- `config.json:12` 中提交的 `"vellumPath"` 存在 Windows 反斜杠转义破损（`\174` 转为 `|`、`\v` 转为 `\u000b`），导致默认配置路径失配。因代码有 `fs.existsSync` 容错判定并自动优雅回退，不影响功能与安全性，建议下个版本修饰反斜杠转义。

---

## 第一节 放行条件 ①：`destroy(discard)` 真等链（`await this.writeChain`）

### 1.1 代码审读

`src/writer.ts:515-524`：
```ts
    if (options?.discard) {
      this.isDisposed = true;
      // A10 / spec §3.6: /mdlog off 主动断开清空内存待处理队列，取消重试与写入
      this.messageQueue = [];
      this.imageCandidatesQueue = [];
      // 必须等链：丢弃语义由 isDisposed 门禁保证，await 保证断开返回后在途写盘已 settle
      await this.writeChain.catch(() => {});
      return;
    }
```
实施逻辑与第三轮建议严格一致：
- 丢弃语义由 `isDisposed = true` 配合后续门禁执行；
- `destroy` 不再立即 return，而是真正 `await this.writeChain.catch(() => {})`；
- 无论在途链是正常完成还是被门禁短路，`destroy` 返回时事件循环上的在途文件 IO 均已 settle。

### 1.2 用例 A 复核

`test/merge.test.ts:232-255`：
- 用例设计：首批写入后注入 `_testInjectRenameFailure` 模拟重试挂起，触发第二批正文写入，在阶梯退避中途（30ms）调用 `await writer.destroy({ discard: true })`；
- 断言：`destroy` 返回瞬间，立即断言目录内无任何 `.tmp` 临时文件。
- 原生执行结果：PASS（耗时 66.1ms）。

### 1.3 探针实测（在途链挂起时 discard 返回瞬间是否 settle / 有无 tmp 残留）

探针脚本模拟重试挂起并监测返回瞬间状态：
```
destroyDuration: 32ms
chainSettledImmediatelyAfter: true
tmpFilesCount: 0 []
containsSecondBatch: false
```
实测表明：`destroy({ discard: true })` 耗时 32ms，返回瞬间链已完全 settle（`chainSettledImmediatelyAfter: true`），目录内 0 个 `.tmp` 残留，第二批在途正文完全未落盘。

### 1.4 变异检验（去掉 `await this.writeChain`）

在 scratch 副本中将 `await this.writeChain.catch(() => {});` 替换为注释（模拟 `6f91102` 不等链形态）：
```
▶ 复审应当修复项回归（原子重写 / 断开取消 / 接缝契约）
  [FAIL] A: destroy(discard) 返回时在途链必须已 settle（无 tmp 残留；变异：去掉 await writeChain 则变红） (36.0154ms)
[FAIL] 复审应当修复项回归（原子重写 / 断开取消 / 接缝契约） (37.5151ms)
AssertionError [ERR_ASSERTION]: destroy 返回时无 tmp 残留
    at TestContext.<anonymous> (.../mut_a/test.ts:252:12)
  actual: false
  expected: true
```
变异后用例精确转红，证实用例 A 对「真等链」具备 100% 的有效守护。

### 1.5 判定

**通过**。

---

## 第二节 放行条件 ②：`atomicReplaceFile` 退避窗后第二道 `isDisposed` 闸

### 2.1 代码审读

`src/writer.ts:463-475`：
```ts
    for (const delay of [0, 60, 120, 200]) {
      if (this.isDisposed) { try { fs.unlinkSync(tempPath); } catch { /* 忽略 */ } return false; }
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      // 退避窗内被 dispose 也不得落盘（rename 会整文件替换，迟到一格会吞掉第三方追加）
      if (this.isDisposed) { try { fs.unlinkSync(tempPath); } catch { /* 忽略 */ } return false; }
      try {
        if (this._testInjectRenameFailure) this._testInjectRenameFailure();
        fs.renameSync(tempPath, this.filePath);
        return true;
      } catch {
        // Windows 上文件被微秒级占用（如宿主瞬时读）时可能 EPERM，退避微重试
      }
    }
```
第二道闸精准设在 `await new Promise(...)` 之后、`fs.renameSync` 之前。若在退避等待的 60ms 窗口期内调用了 `destroy({ discard: true })`，唤醒后立即感知 `isDisposed`，及时 unlink `.tmp` 并退出，彻底封死迟到 rename 覆盖第三方追加的问题。

### 2.2 用例 B 复核

`test/merge.test.ts:257-283`：
- 用例设计：首批写入后，模拟首次 rename 失败进入 60ms 退避窗口；在 30ms 处调用 `writer.destroy({ discard: true })`；
- 断言：断开后等待 300ms，断言文件内容与断开前完全一致（`fs.readFileSync(logFile, "utf8") === before`），rename 未落盘。
- 原生执行结果：PASS（耗时 387.9ms）。

### 2.3 变异检验（删去退避后 `isDisposed` 检查）

在 scratch 副本中删除该行检查（保留前置检查与等链）：
```
▶ 复审应当修复项回归（原子重写 / 断开取消 / 接缝契约）
  [FAIL] B: 退避窗内 dispose 不得落盘 rename（变异：删掉退避后 isDisposed 检查则变红） (392.6773ms)
AssertionError [ERR_ASSERTION]: dispose 后 rename 未落盘
+ actual - expected
  '<p class="mdlog-who"><strong>Pi</strong> · 13:36</p>\n\n第一批正文\n\n' +
+ '第二批正文\n\n' +
+ '<!-- mdlog:m=b-2 -->\n\n---\n\n'
```
变异后用例精确转红，清晰捕获到第二批正文在退避窗后被迟到 rename 写盘。证实用例 B 的守护真实有效。

### 2.4 判定

**通过**。

---

## 第三节 放行条件 ③：两条降级追加路径的 `isDisposed` 门禁

### 3.1 代码审读

`src/writer.ts:427-444`：
```ts
          const ok = await this.atomicReplaceFile(
            content.slice(0, content.length - rewriteOld.length) + rewriteNew + buffer
          );
          if (!ok) {
            if (this.isDisposed) return;
            this.ensureTrailingNewlinesOnFile();
            fs.appendFileSync(this.filePath, standaloneFirst + buffer, "utf8");
            if (runs.length === 1) writtenLast = { ...runs[0], serialized: standaloneFirst };
          }
        } else {
          // 尾部与记忆不符（文件被外部编辑过）：先归一尾部空行再降级追加，保证块间空行契约
          if (this.isDisposed) return;
          this.ensureTrailingNewlinesOnFile();
          fs.appendFileSync(this.filePath, standaloneFirst + buffer, "utf8");
          if (runs.length === 1) writtenLast = { ...runs[0], serialized: standaloneFirst };
        }
```
两条路径（`!ok` rename 最终失败降级、以及外部编辑导致尾块不符降级）均在前置点检查 `if (this.isDisposed) return;`，防止降级追加成为绕过取消的旁路。

### 3.2 用例 C 复核

`test/merge.test.ts:285-312`：
- 用例设计：模拟 rename 持续失败（四级退避全败触发降级），在阶梯中段（120ms）触发 `destroy({ discard: true })`；
- 断言：等待 400ms，断言文件内容保持为旧批次，降级追加未写盘且正文不包含第二批内容。
- 原生执行结果：PASS（耗时 611.9ms）。

### 3.3 变异检验（删去 `!ok` 与尾块不符降级门禁）

在 scratch 副本中删除 `if (!ok)` 内的 `if (this.isDisposed) return;`：
```
▶ 复审应当修复项回归（原子重写 / 断开取消 / 接缝契约）
  [FAIL] C: dispose 后降级追加分支不得写盘（变异：删掉 !ok 分支 isDisposed 门禁则变红） (605.5652ms)
AssertionError [ERR_ASSERTION]: dispose 后降级追加未写盘
+ actual - expected
  '<!-- mdlog:m=c-1 -->\n\n---\n' +
+ '\n<p class="mdlog-who"><strong>Pi</strong> · 13:36</p>\n\n第二批正文\n\n<!-- mdlog:m=c-2 -->\n\n---\n\n'
```
变异后用例精确转红，证实无门禁时降级追加仍会迟到落盘。独立探针亦验证了「尾块不符」分支门禁在外部编辑竞争时的截断有效性（`tail mismatch gate check passed: true`）。

### 3.4 判定

**通过**。

---

## 第四节 放行条件 ④ / 应当修复-新2：`disconnect` 尾链 catch 兜底

### 4.1 代码审读

`index.ts:201-214`：
```ts
        // 必须等待销毁完成——在途链带 isDisposed 门禁，await 保证断开返回后不再有迟到写盘
        const w = writer;
        writer = null;
        return w.destroy({ discard: true }).then(() => {
          pi.appendEntry("mdlog:connection", {
            active: false,
            timestamp: Date.now(),
          });
          currentState = null;
          ctx.ui.notify("mdlog: 对话记录已断开连接", "info");
        }).catch(() => {
          // 宿主 ctx 已失效时 appendEntry/notify 会抛——吞掉，断开动作本身已完成
        });
```
针对第三轮指出的回归（`.catch` 位于 `.then` 之前导致尾巴抛错成为 floating rejection 触发 Node 致命退出）：
- 本轮重构将 `.catch(() => {})` 移至 `.then()` 之后作为整条 Promise 链的最终兜底；
- 当上下文失效（如 session reload / replacement）导致 `pi.appendEntry` 抛出 `STALE-CTX` 异常时，错误被尾部 catch 安全吸收，不再向 Node 事件循环抛出 `unhandledRejection`。

### 4.2 探针 P11 复跑（同名目录熔断 + appendEntry 抛错模拟 ctx 失效）

在独立子进程中构建复现环境：
1. 建立同名目录破坏日志文件，导致 3 批写入连败触发熔断（`onFatalError` 同步触发 `disconnect(ctx)`）；
2. Mock `pi.appendEntry`：当写入 `active: false` 时主动抛出 `Error: STALE-CTX`，模拟 ctx 失效；
3. 观察子进程退出状态与事件循环存活情况。

**实测对比输出**：
```
--- 6a7628e (HEAD) ---
exit code: 0
stdout: P11_SURVIVED_SUCCESS
stderr: 

--- 6f91102 (Buggy Mutation: .catch().then()) ---
exit code: 1
stdout: 
stderr: Error: STALE-CTX: This extension ctx is stale after session replacement or reload.
    at Object.appendEntry (.../p11_mut.mjs:23:13)
    at file:///.../mut_p11/index.ts:205:14
```
实测证据确凿：
- HEAD（`6a7628e`）的整改让子进程在熔断且 ctx 失效的严苛极端场景下安然存活，exit code 为 0；
- 保持 `6f91102` 结构的副本则因未捕获异常精准崩在 `index.ts:205:14`，exit code 为 1。

### 4.3 判定

**通过**。

---

## 第五节 放行条件 ⑤⑥：规格注释与测试用例收口

### 5.1 规格注释与文档一致性

- `index.ts:201` 注释：「必须等待销毁完成——在途链带 isDisposed 门禁，await 保证断开返回后不再有迟到写盘」已由第一节至第三节的实现与实测完全支撑，文档与实现严密契合，不再存在「文档超前于实现」的问题。
- `src/writer.ts:467`「退避窗内被 dispose 也不得落盘（rename 会整文件替换，迟到一格会吞掉第三方追加）」与 `:518`「必须等链：丢弃语义由 isDisposed 门禁保证，await 保证断开返回后在途写盘已 settle」注释清晰准确。

### 5.2 A/B/C 三条变异可红用例覆盖度

| 用例名称 | 覆盖目标 | 变异手法 | 变异检验结果 |
|---|---|---|---|
| 用例 A (`test/merge.test.ts:232`) | `destroy(discard)` 真等链 | 移除 `await this.writeChain` | **RED [PASS]** (`destroy 返回时无 tmp 残留`) |
| 用例 B (`test/merge.test.ts:257`) | 退避窗内二道门禁 | 移除退避后的 `isDisposed` 门禁 | **RED [PASS]** (`dispose 后 rename 未落盘`) |
| 用例 C (`test/merge.test.ts:285`) | `!ok` 降级追加门禁 | 移除降级追加前的 `isDisposed` 门禁 | **RED [PASS]** (`dispose 后降级追加未写盘`) |

三条用例全部满足放行条件 ⑥ 要求，变异检验全部变红，守护成立。

### 5.3 判定

**通过**。

---

## 第六节 commit `2443443` 唤起直连

### 6.1 候选顺序与分层逻辑静态审

`src/command.ts:125-144`：
```ts
    const candidates = [
      config?.vellumPath,
      process.env.MDLOG_VELLUM_PATH,
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Vellum", "vellum.exe") : undefined,
    ].filter((c): c is string => typeof c === "string" && c.length > 0);
    const exe = candidates.find((c) => {
      try { return fs.existsSync(c); } catch { return false; }
    });
```
候选探测顺序设计合理：
1. `config?.vellumPath`：显式用户配置优先；
2. `process.env.MDLOG_VELLUM_PATH`：开发/CI 环境变量次之；
3. `%LOCALAPPDATA%\Programs\Vellum\vellum.exe`：标准 NSIS 默认安装位探测；
4. 全未命中时自然退回 `spawn("cmd", ["/c", "start", '""', absPath])` 利用系统关联打开。

### 6.2 危险字符安全闸与进程生命周期

- **安全闸**：行 118 `if (/["\r\n]/.test(filePath))` 依然位于函数首行，对于含有双引号、回车、换行的路径一律拒绝派发，防止命令注入与参数走逸；
- **生命周期**：
  - 直连分支：`spawn(exe, [absPath], { stdio: "ignore", detached: true })`；
  - 关联分支：`spawn("cmd", ["/c", "start", '""', absPath], { windowsVerbatimArguments: true, stdio: "ignore", detached: true })`；
  - 两条分支均调用 `child.unref()`。实测子进程派发后 Node 事件循环仅 8ms 即排空退出，完全不阻塞扩展宿主进程。

### 6.3 探针实测（候选路径不存在时优雅回退系统关联）

对 `openInVellum` 执行 6 组边界探针实测（通过 mock `spawn` 记录派发参数，全静默零弹窗）：
```
Case 1 (config.vellumPath invalid -> fallback cmd):
  {"cmd":"cmd","args":["/c","start","\"\"","\"D:\\notes\\log.md\""],"opts":{"windowsVerbatimArguments":true,"stdio":"ignore","detached":true}}
  res: { success: true }
Case 2 (config.vellumPath valid -> direct spawn):
  {"cmd":"C:\\Program Files\\nodejs\\node.exe","args":["D:\\notes\\log.md"],"opts":{"stdio":"ignore","detached":true}}
  res: { success: true }
Case 3 (env MDLOG_VELLUM_PATH valid -> direct spawn):
  {"cmd":"C:\\Program Files\\nodejs\\node.exe","args":["D:\\notes\\log.md"],"opts":{"stdio":"ignore","detached":true}}
  res: { success: true }
Case 4 (LOCALAPPDATA valid -> direct spawn):
  {"cmd":"...\\Programs\\Vellum\\vellum.exe","args":["D:\\notes\\log.md"],"opts":{"stdio":"ignore","detached":true}}
  res: { success: true }
Case 5 (dangerous quote -> rejected):
  success: false, error: "路径包含非法或危险字符 (\" \\r \\n)", calls count: 0
Case 6 (dangerous newline -> rejected):
  success: false, error: "路径包含非法或危险字符 (\" \\r \\n)", calls count: 0
```
实测证实：当 `config.vellumPath` 指向不存在文件时，安全平滑地退回至 `cmd /c start` 分支，没有任何未捕获异常。

### 6.4 判定

**通过**。

---

## 第七节 套件健康

### 7.1 扩展套件测试与类型检查

在 `C:\Users\17445\.pi\agent\extensions\mdlog` 目录下执行：
- `npm test`：
  ```
  ℹ tests 92
  ℹ suites 29
  ℹ pass 91
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 1
  ℹ todo 0
  ℹ duration_ms 2264.1597
  ```
  92 项用例中 91 项通过，1 项自然跳过（CLI 子进程冒烟在无模型 API key 时跳过，属预期设计）。
- `npx tsc --noEmit`：退出码 0，零类型错误。

### 7.2 Vellum 宿主测试

在 `C:\Users\17445\Desktop\Vellum` 目录下执行：
- `npm test`（Vitest 前端测试）：
  ```
  Test Files  22 passed (22)
       Tests  237 passed (237)
  ```
- `cargo test`（Tauri 后端测试）：
  ```
  running 35 tests in vellum_lib ... ok. 35 passed; 0 failed
  running 7 tests in vellum binary ... ok. 7 passed; 0 failed
  ```
两端全量用例全部通过。

### 7.3 进程自然退出耗时与资源泄漏排查

- `npm test` 墙钟时间：2.799 秒（远优于 2 分钟红线），无悬挂 timer，无未关闭句柄；
- 探针运行后事件循环自然清空。

### 7.4 判定

**通过**。

---

## 第八节 新伤排查

### 8.1 前三轮已确认项回归检查

- **原子重写**：`test/merge.test.ts` 中原有原子替换与重写用例持续全绿；
- **图片处理与定时器**：14 项图片模块用例保持绿色，执行耗时 55ms，图片超时定时器 unref 机制未受损；
- **重连扩展名白名单**：全仓写盘前扩展名闸与 parser 闸运行正常；
- **Sidecar 心跳与生命周期**：Sidecar 写入与隔离机制保持完好。

### 8.2 新增代码副作用排查（含 config.json 转义分析）

在 commit `2443443` 中，`config.json` 发生变更：
```json
{
  "toolNames": [],
  "imageExtensions": [
    "png", "jpg", "jpeg", "gif", "webp", "bmp"
  ],
  "maxImageBytes": 20971520,
  "assetRetentionMb": 200,
  "vellumPath": "C:Users|45DesktopVellumsrc-tauri\target\release\u000bellum.exe"
}
```
**分析结论**：
1. `config.json` 第 12 行在提交时疑似漏写双反斜杠转义，导致 `\174` 被解析为 `|`，`\v` 被解析为 `\u000b`，`\t` 被解析为制表符，使得解析出的字符串为 `C:Users|45DesktopVellumsrc-tauri\target\release\x0Bellum.exe`；
2. 由于 `openInVellum` 中存在严格的 `try { return fs.existsSync(c); } catch { return false; }` 保护，该非法路径在探测时直接返回 `false`，随后平滑回退至后续候选乃至系统关联；
3. 因此该问题**不造成任何运行时崩溃或安全降级**，但导致该字段对于开箱即用的直连失效，建议后续规范转义为 `"C:\\Users\\17445\\Desktop\\Vellum\\src-tauri\\target\\release\\vellum.exe"` 或留空。

### 8.3 判定

**通过**（无功能性新伤与退化；附带配置文件转义问题列入建议项）。

---

## 第九节 变异检验汇总表

| # | 变异目标 | 变异代码内容 | 作用范围 | 期望结局 | 实测输出 | 结论 |
|---|---|---|---|---|---|---|
| M-A | `destroy(discard)` 真等链 | 移除 `writer.ts:519` 的 `await this.writeChain.catch(()=>{})` | `test/merge.test.ts` | **RED** | `AssertionError [ERR_ASSERTION]: destroy 返回时无 tmp 残留` | **有效守护 [PASS]** |
| M-B | 退避窗后第二道 `isDisposed` 闸 | 移除 `writer.ts:468` 的退避后 `isDisposed` 检查 | `test/merge.test.ts` | **RED** | `AssertionError [ERR_ASSERTION]: dispose 后 rename 未落盘` (正文捕获新批落盘) | **有效守护 [PASS]** |
| M-C | 降级追加 `isDisposed` 门禁 | 移除 `writer.ts:431` 的 `if (this.isDisposed) return;` | `test/merge.test.ts` | **RED** | `AssertionError [ERR_ASSERTION]: dispose 后降级追加未写盘` (降级块迟到写入) | **有效守护 [PASS]** |
| M-P11 | `disconnect` 兜底 catch | 将后置 `.then().catch()` 退回为 `6f91102` 的 `.catch().then()` | `probe_p11` 熔断与失效 ctx | **CRASH (exit=1)** | `Error: STALE-CTX` 成为未捕获 rejection 导致进程 exit=1 (HEAD 为 exit=0) | **有效守护 [PASS]** |

---

## 第十节 问题清单

### 阻断 (Blocker)
无。

### 应当修复 (Should Fix)
无。

### 建议 (Suggestions)

1. **`config.json:12` 反斜杠转义规范化**  
   `config.json` 中的 `"vellumPath": "C:Users|45DesktopVellumsrc-tauri\target\release\u000bellum.exe"` 因反斜杠未双写转义导致字符串受损。建议修正为正斜杠或双反斜杠形式，或在不指定时缺省移除该字段，交由环境变量与 `%LOCALAPPDATA%` 自动探测。
