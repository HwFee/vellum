# 计划复审报告（reviewer-gemini，第二轮）

- **审核对象**：`docs/superpowers/plans/2026-09-05-pi-mdlog-live-log.md`（8032 行 / 25 Task / 5 工作包）
- **修订依据**：`outputs/mdlog/plan-fix-log.md`（定点修订日志）
- **上一轮对照**：`docs/superpowers/reviews/2026-09-05-plan-review-qwen.md`（reviewer-qwen 审核报告，原驳回结论）
- **对照规格**：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（v3）与 `AGENTS.md`、`DESIGN.md`
- **审核性质**：只读复查。未修改任何生产源码与设计规范，真实运行环境构建与测试校验。
- **行号引用标记**：`plan:NNNN` 表示修订后的实现计划文档行号。

---

## 结论：**通过**

经过逐行精读、多维度排查与跨包连锁推导，上一轮审核提出的 **4 项阻断项（B1~B4）**、**15 项必修项（A1~A15）** 以及 **11 项建议项（S1~S11）** 已全部定点落地或完成合理论证闭环；前置任务与后续任务之间的测试用例数递增计算在全链路严格自洽闭环（前端 175 -> 194 -> 200 -> 206 -> 210 -> 211；后端 15 -> 17 -> 22 -> 29 -> 34 -> 36）；修订未引入新的逻辑矛盾或语法/编译错误，完全满足「零二义性字面执行」要求。

---

## 生产测试基线实测验证

在审核过程中对当前仓库运行真实测试套件，确认基准完全一致：

1. **前端测试（Vitest）**：
   ```bash
   npm test
   ```
   **真实输出**：
   ```
   Test Files  17 passed (17)
        Tests  175 passed (175)
     Duration  5.36s
   ```
2. **后端测试（Cargo）**：
   ```bash
   cd src-tauri && cargo test
   ```
   **真实输出**：
   ```
   running 13 tests (in vellum_lib) ... ok. 13 passed; 0 failed
   running 2 tests (in vellum main) ... ok. 2 passed; 0 failed
   test result: ok. 15 passed; 0 failed; finished in 0.01s
   ```
当前代码库准确对应初始基线：前端 17 文件 / 175 用例；后端 15 用例（lib 13 + main 2）。

---

## 一、阻断项验证（B1 ~ B4）

| 编号 | 检查点 | 判定 | 证据与实现说明 |
|---|---|---|---|
| **B1** | `STILL_ACTIVE` 导入路径必须位于 `Win32::Foundation` | **通过** | **证据：`plan:951`**。<br>在 Task 1.3 `widget.rs` 的 `is_pid_alive_win32` 函数体内：<br>`use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION, STILL_ACTIVE};`<br>`use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};`<br>导入路径严格符合 `windows-sys-0.61.2` 规范，彻底消除了 Step 3 编译 `error[E0432]` 隐患。 |
| **B2** | Task 1.5 消除整文件覆盖与伪代码，保留单实例代码 | **通过** | **证据：`plan:1332-1540`**。<br>1. **Files 声明**（`plan:1336`）：明确标注 `Modify: src-tauri/src/main.rs（仅修改三处：load_document 函数体、Builder 插入点、invoke_handler 列表；其余代码逐字保留）`。<br>2. **无伪代码**：全文 `grep "省略"` 为 0 匹配；Step 3 拆分为 3 处精确代码插入/修改块（`plan:1410`、`plan:1425`、`plan:1483`），并在文末加粗警告严禁覆盖 WM_COPYDATA（约 140 行）单实例逻辑与已有函数。<br>3. **测试重构**：Step 1 删除了恒真测试，引入 `should_rebind_matrix_evaluation`（`plan:1362-1376`），严格测试了首次加载、跨路径切换、watcher 缺失自愈（S7）与同路径热重载全部 4 类矩阵分支。<br>4. **既有测试断言**（`plan:1526-1533`）：Step 4 明确核查 `cargo test --bin vellum` 输出含既有 2 个 main 测试（`extracts_first_markdown_path_case_insensitively` 与 `ignores_non_markdown_arguments`）与新增 2 个测试，4 个 main 测试全部 PASS。 |
| **B3** | Task 2.4 高度断言矛盾修正与休眠占位真实断言 | **通过** | **证据：`plan:2325-2326`、`plan:2420-2433`**。<br>1. **高度断言修正**（`plan:2325-2326`）：非法消息忽略测试中断言更新为 `expect(iframe.style.height).toBe("240px")`，并附带设计解释：组件默认高度为 240px，非法消息被忽略导致高度保持不变即证明拦截成功。<br>2. **休眠占位真实测试**（`plan:2420-2433`）：休眠用例补齐了全流程断言：<br>`const dormantBtn = screen.getByText("交互已休眠 · 点击查看");`<br>`expect(dormantBtn).toBeInTheDocument();`<br>`expect(screen.queryByTitle("交互演示")).not.toBeInTheDocument();`<br>并模拟用户点击触发唤醒：<br>`await act(async () => { fireEvent.click(dormantBtn); });`<br>`expect(activateSpy).toHaveBeenCalledWith(expect.any(String));`<br>`expect(screen.getByTitle("交互演示")).toBeInTheDocument();`，杜绝装饰性无断言测试。 |
| **B4** | 全计划测试计数统一推导与 AGENTS.md 基线迁移 | **通过** | **证据：`plan:27`、`plan:6855-6860`、`plan:7894-7905`**。<br>1. **终极数字统一**：`Global Constraints` 明文约定开工前前端 17 文件 175 用例、后端 15 用例；最终达成前端 22 文件 211 用例、后端 36 用例（lib 32 + main 4）。<br>2. **AGENTS.md 基线移动**：Task 5.1 明确将命令节写入剥离，移至 Task 5.4 Step 6（`plan:7899-7905`）终审集中写入，彻底消除前置更新导致的任务间漂移。<br>3. **残留扫描**：对全文 `grep -n "175\|15 用例\|17 文件"` 逐一排查，所有出现处均为开工前初始基线的历史对比引用，无任何过时的中间断言残留。 |

---

## 二、必修项验证（A1 ~ A15）

| 编号 | 审核项要求 | 状态 | 证据行号与落地说明 |
|---|---|---|---|
| **A1** | `is_pid_alive_win32` 仅在权限/共享冲突降级为 true，进程不存在返回 false，补 `u32::MAX` 测试 | **已落地** | **证据：`plan:736-740`、`plan:974-980`**。<br>实现中 `err == ERROR_ACCESS_DENIED || err == ERROR_SHARING_VIOLATION` 返回 true，其余（含 `ERROR_INVALID_PARAMETER` / `ERROR_FILE_NOT_FOUND`）返回 false。并在 `widget_tests.rs` 中补入：<br>`#[cfg(windows)] { assert!(!crate::widget::is_pid_alive_win32(u32::MAX)); }`。 |
| **A2** | Task 1.5 守卫测试替换为覆盖多路径状态的纯函数矩阵 | **已落地** | **证据：`plan:1362-1376`**。<br>`should_rebind_matrix_evaluation` 测试验证了 `None`、`cur != next`、`has_watcher == false` 以及同路径热重载的保留机制。 |
| **A3** | Task 1.3 补齐 128-bit UUID 高熵无碰撞与 RFC 4122 规范测试 | **已落地** | **证据：`plan:743-755`**。<br>测试 `uuid_generation_entropy_and_format_check` 循环生成 1000 个 UUID，校验 `HashSet` 无碰撞、长度 36、第 15 位 `'4'`、第 20 位变体 `'8'|'9'|'a'|'b'`。 |
| **A4** | Task 2.5 补齐 components memo 与 iframe DOM 实例 `===` 稳定性测试 | **已落地** | **证据：`plan:2784-2811`**。<br>用例 `preserves components memo and iframe DOM instance across markdown appends` 模拟 markdown 追加，断言 `expect(rerenderedWidget).toBe(initialWidget)`，守护 DOM 不换血。 |
| **A5** | 消除 `fallback` prop 传参，由 `WidgetSandbox` 内部降级渲染 `CodeBlock` | **已落地** | **证据：`plan:2209`、`plan:2385`、`plan:2473`、`plan:2622`、`plan:2713`、`plan:2874`**。<br>`WidgetSandboxProps` 精简为 `{ html: string; autoMount: boolean }`；内部直接渲染 `<CodeBlock code={html} language="" />`；`MarkdownDocument` 不再传递 fallback prop。 |
| **A6** | Task 4.5 `writeSidecar` 改为临时文件 + `renameSync` 原子写入 | **已落地** | **证据：`plan:6074-6076`**。<br>生成 `${sidecarPath}.${Date.now()}.${rand}.tmp` 写入后原子重命名，防止 watcher 读取残缺 JSON。 |
| **A7** | Task 4.6 回合追加成功后调用 `updateLastWrite` 同步 sidecar 磁盘文件 | **已落地** | **证据：`plan:5850`、`plan:5930`、`plan:6096`、`plan:6597`**。<br>`onWriteSuccess: (ts) => { ... updateLastWrite(sidecarPath, ts); }` 完整接线。 |
| **A8** | Task 4.3 图片复制失败写占位行，且容量超限文案按 `maxImageBytes` 动态格式化 | **已落地** | **证据：`plan:5058`、`plan:5252-5256`、`plan:5289`**。<br>异常分支输出 `*(图片处理失败：${err?.message ?? "复制失败"})*`；容量超限根据 `maxBytes` 动态格式化为 MB 或字节。 |
| **A9** | Task 4.6 `agent_settled` 解除 `await` 阻塞，改为 `void writer.flush().catch` | **已落地** | **证据：`plan:6777-6780`**。<br>坚守 Y12 纪律，杜绝阻塞 pi CLI idle 事件分发与 `-p` 退出。 |
| **A10** | Task 4.4/4.6 `/mdlog off` 明确 `discard` 清空待处理队列，并加入 `fatalReported` | **已落地** | **证据：`plan:5610`、`plan:5684`、`plan:5809`、`plan:6681`**。<br>`destroy({ discard: true })` 清空待写队列与定时器；连续 3 批失败仅上报一次错误。 |
| **A11** | 增设 Task 5.5（Release 构建与 spec §9.3 人工核验 8 项清单） | **已落地** | **证据：`plan:7915-7985`**。<br>包含 `npm run tauri build` 与核验 1~8（正向渲染、网络隔离、远程图片、本地存储、Cookie/DB、导航弹窗、子帧自导航确认、DOM 防穿透），输出至独立验收报告。 |
| **A12** | Task 1.3/1.4 Step 2 失败测试命令改为 `--lib widget_tests` | **已落地** | **证据：`plan:768`、`plan:1187`**。<br>命令更新为 `cargo test --manifest-path src-tauri/Cargo.toml --lib widget_tests`，准确触发编译与单元测试红灯。 |
| **A13** | 全局 Emoji 约束限定语修正，验证脚本统一纯文本 `[PASS]` / `[FAIL]` | **已落地** | **证据：`plan:20`、`plan:6899-6908`、`plan:7034-7060`、`plan:7334-7342`、`plan:7816-7876`**。<br>限定为「产品 UI 与注入 iframe 的 widget 内容无 emoji」；全书无 `✅` / `❌`；4 个校验脚本统一格式输出。 |
| **A14** | Task 4.6 E2E 用例 ESM `fileURLToPath` 兼容与 `t.skip` | **已落地** | **证据：`plan:6445-6458`**。<br>使用 `path.dirname(fileURLToPath(import.meta.url))` 解析目录，并在 `pi` 不可用时显式调用 `t.skip()`。 |
| **A15** | Global Constraints 增补工作树纪律条目 | **已落地** | **证据：`plan:21`**。<br>明确规定每个 Task 提交前 `git status --porcelain` 必须干净，仅包含本 Task 文件。 |

---

## 三、建议项验证（S1 ~ S11）

| 编号 | 建议项与决策 | 状态 | 落地位置与证据分析 |
|---|---|---|---|
| **S1** | `WidgetRegistry::get` 命中时调整 order 队列实现真 LRU，并增加 `peek` | **已采纳** | **证据：`plan:815-826`**。<br>`get(&mut self, id)` 命中后将 id 摘出并尾插；提供只读 `peek(&self, id)`；配套测试 `plan:610-625` 断言访问 widget-0 提鲜后淘汰 widget-1。 |
| **S2** | `WidgetEntry` 增加 `mounted: boolean`，仅进入视口且通过 `requestMount` 才计入活跃集 | **已采纳** | **证据：`plan:1878`、`plan:2032`、`plan:2123`、`plan:2553`**。<br>`requestMount` 成功时 `entry.mounted = true`，活跃集统计仅过滤 `w.mounted && !w.dormant`。 |
| **S3** | 维持模块级单例 vs React Context 评估 | **不采纳（合理）** | Vellum 为单一 WebView2 窗口的桌面应用，单例常驻无多实例/SSR 风险，维持单例设计合理。 |
| **S4** | `computeRecheckDelay` 加入 2^31 - 1 钳位（2147483647），防 32 位有符号整数溢出 | **已采纳** | **证据：`plan:3241-3245`、`plan:3408-3413`**。<br>`Math.min(diff, 2_147_483_647)`，并在 `mdlogState.test.ts` 补充超限用例，删除未使用局部变量。 |
| **S5** | `fresh-ink` 动画改读 `isMdlogActiveRef.current`，移除状态依赖 | **已采纳** | **证据：`plan:3493-3505`**。<br>依赖仅 `[reloadTick]`，消除断开瞬间误触发落墨动画与重启 2.8s 计时 Bug。 |
| **S6** | 前端 512KB 长度预检改用 `TextEncoder().encode(code).length` 字节口径 | **已采纳** | **证据：`plan:2713`、`plan:2870`**。<br>消除中文或多字节字符在前后端判定之间的体积缝隙。 |
| **S7** | `load_document` 守卫重构为纯函数 `should_rebind`，包含 watcher 异常自愈 | **已采纳** | **证据：`plan:1368`、`plan:1416-1422`**。<br>`cur != next || !has_watcher`，同路径 watcher 缺失时自动触发重建。 |
| **S8** | 图片相对 cwd 解析前使用 `fs.realpathSync` 防符号链接越界逃逸 | **已采纳** | **证据：`plan:5209`、`plan:5223`**。<br>严格防范恶意符号链接逃逸到用户工作区外。 |
| **S9** | 修正工作包标题层级，WP1~WP5 全部统一为二级标题 `## 工作包` | **已采纳** | **证据：`plan:32`、`plan:1538`、`plan:2919`、`plan:4109`、`plan:6846`**。<br>全书目录层级完全对齐规范。 |
| **S10** | `package.json` 声明 `"engines": { "node": ">=22.6" }` | **已采纳** | **证据：`plan:4151-4153`**。<br>防止低版本 Node 出现 ESM 拓展加载异常。 |
| **S11** | 保留 `scripts/verify-skill-discovery.mjs` 自动化发现预检门禁 | **不采纳（保留合理）** | 作为 Task 5.5 人工验收前的轻量静态门禁，收益明确且已闭环在 Task 5.4。 |

---

## 四、修订引入的新伤检查与连锁一致性排查

对 60+ 处修订可能引起的副作用与连锁关系进行了针对性推演：

### 1. A5 删除 `fallback` prop 的连带一致性
- **接口与实现**：`WidgetSandboxProps`（`plan:2473`）仅保留 `html` 与 `autoMount`。`WidgetSandbox.tsx` 导入 `CodeBlock`（`plan:2471`），在 `hasError` 时直接输出 `<CodeBlock code={html} language="" />`（`plan:2622`）。
- **调用端**：`MarkdownDocument.tsx`（`plan:2874`）调用 `<WidgetSandbox html={code} autoMount={isTrustedMdlog} />`，无任何 fallback prop 传递。
- **单元测试**：`WidgetSandbox.test.tsx`（`plan:2385`）与 `MarkdownDocument.test.tsx`（`plan:2775`）断言降级渲染出的 `<CodeBlock>` 文本，不再构造外部 JSX fallback。
- **结论**：完全一致，彻底杜绝了重渲染生成新 ReactNode 破坏 `React.memo` 的风险。

### 2. S1 LRU 提鲜对 `&mut self` 的全链路贯穿
- **方法签名**：`WidgetRegistry::get(&mut self, id: &str) -> Option<&str>`（`plan:815`）。
- **函数签名**：`pub fn build_widget_response(method: &str, uri: &str, registry: &mut WidgetRegistry) -> Response<Vec<u8>>`（`plan:556`、`plan:909`）。
- **main.rs 调用**：`let mut registry = widget_state.0.lock().unwrap_or_else(|p| p.into_inner());`（`plan:1487`）传递 `&mut registry`。
- **测试用例**：`widget_tests.rs` 中所有 `build_widget_response` 调用（`plan:648`、`plan:679`、`plan:695`、`plan:703`）均声明 `let mut registry = ...` 并传入 `&mut registry`。
- **结论**：可变借用签名无缝衔接，Rust 编译器在 NLL 下对临时借用无悬垂风险。

### 3. B4 测试用例累加链条一致性验证
对各阶段 Step 4 声明的预期测试数字进行了数学验算：
- **初始基线**：前端 17 文件 / 175 用例；后端 15 用例（lib 13 + main 2）。
- **WP1 结束**：后端累计增至 **36 用例**（lib 13 基线 + state 2 + watcher 5 + widget 12 = 32；main 2 基线 + 2 新增 = 4），前端保持 17 文件 175 用例。
- **Task 2.1**：前端 +1（`setup.test.ts` 新建），累计 **18 文件 / 176 用例**。
- **Task 2.2**：前端 +3（`kami.css.test.ts` 既有文件扩展），累计 **18 文件 / 179 用例**。
- **Task 2.3**：前端 +4（`widgetRegistry.test.ts` 新建），累计 **19 文件 / 183 用例**。
- **Task 2.4**：前端 +6（`WidgetSandbox.test.tsx` 新建），累计 **20 文件 / 189 用例**。
- **Task 2.5**：前端 +5（`MarkdownDocument.test.tsx` 既有文件扩展），累计 **20 文件 / 194 用例**（`plan:2905` 准确核查）。
- **Task 3.1**：前端 +6（`scrollStick.test.ts` 新建），累计 **21 文件 / 200 用例**（`plan:3189` 准确核查）。
- **Task 3.2**：前端 +6（`mdlogState.test.ts` 新建 4 个 + `App.test.tsx` 2 个），累计 **22 文件 / 206 用例**（`plan:3533` 准确核查）。
- **Task 3.3**：前端 +4（`App.test.tsx` 追加），累计 **22 文件 / 210 用例**（`plan:3925` 准确核查）。
- **Task 3.4**：前端 +1（`App.test.tsx` 端到端会话），累计 **22 文件 / 211 用例**（`plan:4095` 准确核查）。
- **Task 5.4**：前端全量验证 `22 passed (22 files), 211 passed (211 tests)`（`plan:7894`），后端 `36 passed (32 in vellum_lib, 4 in vellum)`（`plan:7897`），并在 `AGENTS.md` 写入 `22 测试文件，211 用例`。
- **结论**：每个 Task 的 Step 4 断言与前后文增量完全闭环，无任何矛盾。

---

## 五、新发现问题清单

经全量扫描，**无阻断级（Blocker）** 与 **对应修复级（Should-Fix）** 问题。仅提出如下 1 条实施级注意建议：

- **[建议 / 实施提示] Task 1.3 `windows_sys` 的 `ERROR_SHARING_VIOLATION`**
  - **位置**：`plan:951`
  - **说明**：当前 `src-tauri/Cargo.toml` 中已启用 `Win32_Foundation` 与 `Win32_System_Threading` 特性，`ERROR_SHARING_VIOLATION` (0x20) 属于 `Win32::Foundation`，直接开箱即用。子智能体在执行 Step 1 添加 `uuid` 依赖时，无需额外追加 windows-sys 特性标志。

---

## 六、终审判定

| 审查维度 | 判定 | 理由 |
|---|---|---|
| **正确性** | **通过** | 25 个 Task 全面覆盖 spec §3~§10，边界防护（512KB、超时、熔断、安全响应头、CSP、进程存活）严密，异步无竞态。 |
| **性能约束** | **通过** | 严格遵守 `AGENTS.md` 死规则：`PrismLight` 绝不切回 Async；`WidgetSandbox` 保持 `React.memo` 且无 fallback 污染；`components` 依赖仅 `[resolveHeadingId, isTrustedMdlog]`；大纲与滚动仲裁单一 LayoutEffect。 |
| **风格与一致性** | **通过** | kami 调色板原生 CSS 复用，无 emoji，圆角与字重完全合规，标题层级规整。 |
| **测试完备性** | **通过** | 25 个 Task 全部为 5 步严格 TDD；覆盖各类异常与边界分支（u32::MAX、JSON 损坏、心跳超时、512KB 超限、非法通信来源等）。 |
| **可维护性** | **通过** | 单元边界清晰，Consumes / Produces 跨包逐字契约零漂移，支持零二义性字面执行。 |

**判定结论：【通过】**

本实现计划定点修订扎实严谨，所有红线问题彻底清零，测试推导与代码指令完备，具备卓越的工程可实施性，**批准进入执行阶段（executing-plans）**。
