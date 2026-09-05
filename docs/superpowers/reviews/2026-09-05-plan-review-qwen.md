# 计划审核报告（reviewer-qwen）

- **审核对象**：`docs/superpowers/plans/2026-09-05-pi-mdlog-live-log.md`（7794 行 / 24 Task / 5 工作包）
- **对照规格**：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（v3，825 行）
- **审核性质**：只读审核。未修改任何被审文件（计划、spec、src、src-tauri 全部原样）。
- **引用记法**：`plan:NNNN` = 计划文档行号；`spec:NNNN` = 设计文档行号；`src/...:NN` = 仓库现状行号。

---

## 结论：**驳回**

计划的**跨包契约一致性、spec 覆盖度、TDD 骨架完整度**都是高水准的（24/24 Task 具备 Files + 五步 TDD + commit；逐字契约 11 项零漂移；§3–§10 机制逐条可定位）。但存在 **4 条阻断项**：其中 1 条是**确定性的 Rust 编译错误**（已对着本地 `windows-sys-0.61.2` 源码核实），1 条是**字面执行会静默删除约 150 行生产代码**（main.rs 单实例 IPC），2 条是**TDD 绿灯门禁自相矛盾/最终验收数字不可能达成**。这些问题都会让"零二义性字面执行"的子智能体卡死或做出破坏性猜测，必须先修再跑。

另有 15 条应当修复（含 4 处 spec 实质偏差、3 处 spec §9.2 强制测试缺失、1 处 memo 死规则破坏、1 处 sidecar 写入竞态、1 处整节验收遗漏（§9.3）、1 处版本控制前置条件缺失）。

---

## 结构与覆盖核对

### 1. 结构完整性 — **通过**

| 检查项 | 结果 | 证据 |
|---|---|---|
| Task 总数 | 24 ✓ | `^### Task` 命中 24：1.1(37) 1.2(184) 1.3(523) 1.4(996) 1.5(1295) / 2.1(1550) 2.2(1657) 2.3(1872) 2.4(2184) 2.5(2688) / 3.1(2879) 3.2(3150) 3.3(3496) 3.4(3883) / 4.1(4065) 4.2(4467) 4.3(4804) 4.4(5276) 4.5(5723) 4.6(6159) / 5.1(6722) 5.2(6850) 5.3(7158) 5.4(7657) |
| `**Files:**` 块 | 24/24 ✓ | 逐 Task 命中（39,186,525,998,1297,1552,1659,1874,2186,2690,2881,3152,3498,3885,4067,4469,4806,5278,5725,6161,6724,6852,7160,7659） |
| `**Interfaces:**`（Consumes/Produces） | 24/24 ✓ | 抽查 1.3/1.4/2.3/2.4/4.5/4.6 均含完整签名与"邻包依赖"声明 |
| TDD 五步（失败测试→跑挂→最小实现→跑绿→commit） | 24/24 ✓ | 每 Task 恰 5 个 Step（4.x 的 Step 措辞为中文「运行测试验证失败/全绿」「验证并记录检查点」，见 plan:4277/4453/4461）；`git commit` 每 Task 1 次 |
| 分片与合并文件同步 | ✓ | `cat parts/*.md` 与合并文件 `diff` **IDENTICAL**（30+1513+1329+1181+2662+1079=7794），无分片漂移 |
| 标题层级 | **不一致** | WP1/WP2/WP4 用 `##`（plan:31,1544,4054），WP3/WP5 用 `#`（plan:2873,6716）→ 见建议 S7 |

### 2. spec 覆盖核对（逐节）

| spec 章节 | 对应 Task | 判定 |
|---|---|---|
| §3.1 安装与文件布局（index.ts/config.json/README.md） | 4.1（package.json+src）、4.3（config.json）、4.6（README） | ✓ 路径写为绝对 `C:\Users\17445\.pi\agent\extensions\mdlog\`，与仓库外约定一致（plan:4056） |
| §3.2 命令（`/mdlog <路径>`、off、status、4 个修饰符、引号剥离、保留字、`cmd /c start`） | 4.5 | ✓ `--full/--append/--no-open`（5 处）、`off/status` 保留字、`parseMdlogCommand`（5960+）、`formatStatusOutput`（6115-6120）、非 `.md/.markdown` 拒绝（6095-6102，覆盖 §8 末行） |
| §3.3 事件接线与生命周期（5 种 reason / 双形态 content / 非阻塞 / shutdown 先落盘） | 4.6 | ✓ `session_start`(6599)、`message_end`(6629 无 await)、`tool_execution_end`(6638)、`agent_settled`(6651)、`session_shutdown`(6658)；sessionId 不一致拒绝重连(6616-6621)；**但 `agent_settled` 内 `await` 与 Y12 冲突**，见 A9 |
| §3.4 逐字节格式（指纹头 / 锚点 `\n\n` / `---` / 围栏补齐） | 4.1 | ✓ `formatHeader`(4411)、`formatUserMessage`(4414-4421 逐字节 `> ` 引用 + 锚点)、`formatAssistantMessage`(4423-4451 含"已自动补齐代码围栏") |
| §3.5 智能追加与逆向扫描（Y6-a~f） | 4.2 | ✓ `findLastBranchAnchor`(4664-4723) 尾向回退 + 围栏区间过滤(Y6-d) + `extractSessionFingerprint` + `insertHeaderAtTopAtomic`(4786 `renameSync`，Y6-c) |
| §3.6 状态持久化与断开 | 4.6 | ✓ `pi.appendEntry("mdlog:connection", {active:true/false})`(6544,6559)、`removeSidecar`；**但 off 时队列"清空"语义被 `destroy()→flush()` 改写**，见 A10 |
| §3.7 sidecar 结构与心跳 | 4.5 | ✓ 字段名/单位与 Rust 侧逐字一致；**`lastWriteAt` 落盘更新缺失**，见 A7 |
| §3.8 写入失败与退避（50/150/300 + 连续 3 批熔断删 sidecar） | 4.4 | ✓ `delays=[50,150,300]`(5593)、`consecutiveBatchFailures>=3`(5580)→`onFatalError`→`disconnect()`(6475-6478)→停心跳+删 sidecar |
| §4.1 WidgetSandbox | 2.4 | ✓（详见抽查记录） |
| §4.2 MarkdownDocument 分发点（`[\w-]+` / 受信门禁 / 512KB 预检） | 2.5 | ✓ plan:2814 正则、2818-2831 分发，与现状 `src/components/MarkdownDocument.tsx:378` 的 `/language-(\w+)/` 精确对应 |
| §4.3 Rust 协议与注册表 | 1.3 / 1.4 / 1.5 | ✓ 512KB/64 条/UUID/4 条响应头/404 同 CSP/`judge_mdlog_alive` 注入/`sidecar_path_for` 单一来源 |
| §4.4 CSP 与 capabilities（spec:459 明确"现有 capabilities 默认可用，无需新增权限"） | 1.5 | ✓ 仅追加 `frame-src`；**无 capability 改动是符合 spec 的**，非遗漏 |
| §4.5 图片管线（正则/mtime/20MB/净化/配额清理/config.json） | 4.3 | ✓ `IMAGE_PATH_RE`、`mtimeMs >= turnStartTime-5000`(5156)、20MB 占位行(5162-5169)、`sanitizeImageFilename`、`-2/-3` 去重(5178-5184)、`cleanAssetRetention`(5291+)；**复制失败占位行未实现**，见 A8 |
| §4.6 底部跟随与副作用抑制 | 3.1 / 3.2 | ✓ 单 `useLayoutEffect` 仲裁(3103-3130) 复用 `restoreScrollPosition`（签名与 `src/lib/scrollRestore.ts:107-112` 一致，已核对）；印章/fresh-ink/scrollMemory 三路抑制(3435-3478) |
| §4.7 徽章 + watcher 守卫 + 复查调度 | 1.5 / 3.3 | ✓ `.mdlog-live` 于 `.document-content` 尾部(3854)、`computeRecheckDelay`(3356)、`expiresAt` 自动复查(3741-3752)；G1 守卫(1391-1432) **但测试恒真**，见 A2 |
| §5 技能 `vellum-mdlog` | 5.2 / 5.3 | ✓ SKILL.md 六节（6967-7156）+ widget-template.html 真实骨架（7241-7640） |
| §6 性能数值 | Global Constraints(18-30) + 各 Task | ✓ 512KB/64/10/[80,2000]/200px/400ms/150ms/30s/120s/5-20MB/50-5000ms 全部逐字落地；rehype-raw 恒走代价已在 spec:594 声明，计划未违反 AGENTS 死规则（`components` 依赖仅 `[resolveHeadingId, isTrustedMdlog]`，plan:2843） |
| §9.1/9.2 测试 | 各 Task Step 1 | **部分缺失**：spec §9.2 强制的 3 项测试未落实——①128-bit UUID 高熵测试（全文 0 处）②路径切换清空 vs 热重载保留注册表（仅恒真断言，plan:1333-1343）③`isTrustedMdlog` 追加时引用稳定/components memo 不破坏（全文无对应用例）。见 A2/A3/A4 |
| **§9.3 Release 构建沙箱与 CSP 人工验证清单（8 项）** | **无对应 Task** | **✗ 遗漏**：全文无 `tauri build`/`npm run tauri build`/人工验证清单/`localStorage`·`indexedDB`·`document.cookie`·`window.open`·`location.href` 实测步骤（相关关键词仅出现在 SKILL.md 的"禁止清单"文案里，plan:7014-7018）。spec §11 要求"每包必须通过验证方可结项"，Y11 的 dev+release 正向渲染验收同样无处落地。见 A11 |
| §10 文件清单 | 全部 24 Task 的 Files 汇总 | ✓ 逐项比对：12 个新增文件 + 11 个修改文件全部有归属 Task；`docs/preview/*`（已就绪）被 2.2 作为唯一真源引用（plan:1665,1761）✓。额外产出 `scripts/verify-skill-discovery.mjs`(7657+) 不在 spec §10 清单内 → 见建议 S11 |

### 3. 占位符扫描 — **通过（1 处例外）**

`grep -n "TBD|TODO|待定|稍后实现|待补充|省略"` 结果：
- 无 TBD/TODO/占位符式遗漏 ✓；plan:6959、plan:7241 甚至明文"禁止占位符，字面落地"。
- 唯一例外：plan:1387、plan:1456 的 `// ... 省略 ... 原代码 ...` —— 见阻断 B2。

### 4. 现状兼容性抽查（3 处，全部命中）— **通过**

| # | 计划引用 | 仓库现状 | 判定 |
|---|---|---|---|
| 1 | plan:2896「`src/App.tsx:337-345` 当前使用 `useEffect` 恢复 `pendingScrollRef`」 | `src/App.tsx:337-345` 确为该 `useEffect`（含 `[activeDocument?.markdown]` 依赖） | ✓ 行号精确 |
| 2 | plan:2814 现有 `pre` 渲染器正则为 `/language-(\w+)/`；`extractText`、`isValidElement` 分支结构 | `src/components/MarkdownDocument.tsx:378` = `/language-(\w+)/`；:274 `extractText`；:356 `pre:` | ✓ |
| 3 | plan:3386-3404（Task 3.2 步骤 7）引用 `persistCurrentScroll()`、`scrollSaveTimerRef` 与 300ms 防抖 | `src/App.tsx:40` `scrollSaveTimerRef`；:313-320 `handleScroll` 内部即调用 `persistCurrentScroll()`（同名函数真实存在，plan:3460/3468/3756 引用有效） | ✓ |
| 附 | plan:1328 期望的现有 CSP 字符串 | `src-tauri/tauri.conf.json:26` 逐字相同 | ✓ |
| 附 | plan:349-357 `sidecar_path_for` 与 watcher 现状（父目录 NonRecursive 监听） | `src-tauri/src/watcher.rs:27-30` 同款；`parent()` 取法一致 → 后创建的 sidecar 事件可被捕获 | ✓ 无"文件不存在无法 watch"隐患 |
| 附 | plan:5900-5940 pi 扩展 API | 对照 pi 文档：`pi.on("session_start"/"message_end"/"tool_execution_end"/"agent_settled"/"session_shutdown")`、`event.toolCallId/toolName/result/isError`、`pi.registerCommand(name,{description,handler(args,ctx)})`、`pi.appendEntry(customType,data)`、分支 `type:"custom"+customType` 全部真实存在 | ✓ 无臆造 API |

---

## 契约一致性核对

**结论：11 组跨包逐字契约全部一致，未发现拼写/形状漂移。**（这是本计划最强的部分。）

| 契约 | 出现处（抽样） | 判定 |
|---|---|---|
| 命令名 `register_widget` / `unregister_widget` / `read_mdlog_state` | Rust 签名 plan:1019-1040、实现 plan:1216/1238/1247、注册 plan:1503-1505、前端 `invoke<>` plan:2193-2194 / 2535 / 2492、徽章 plan:3504 | ✓ 三处拼写与入参名（`{ html }`、`{ id }`、无参）完全一致 |
| 返回形状 `{ id, url }` | `RegisterResult`(plan:543/819/2453) + camelCase serde + 序列化断言(plan:626-632) + TS interface(plan:2453) | ✓ |
| 返回形状 `{ lastWriteAt, heartbeatAt, expiresAt }` | `MdlogStateResponse`(plan:1013-1015/1180-1182) + `MdlogState` TS(plan:3164/3347-3349) + 测试 JSON(plan:1087-1089) | ✓（Rust 蛇形字段 + `rename_all="camelCase"`，序列化后一致） |
| 事件 `file-changed` | `emit` plan:488、`listen` plan:2994/3005/3250/3960 | ✓ |
| 事件 `mdlog-state-changed` | `emit` plan:491、`listen` plan:3412/3808、断言 plan:3316/3633/3989 | ✓ |
| postMessage `vellum-widget:resize` | 前端校验 plan:2562、测试 plan:2310/2325/2337/2348、SKILL 契约 plan:6859/6890/7057/7070/7119/7137、模板校验 plan:7195/7488/7748 | ✓ 逐字一致，含 `[80, 2000]` 上下限（2571 `Math.min(2000, Math.max(80, …))`） |
| sidecar 字段 `heartbeatAt` / `anchorLost`（+version/sessionId/pid/connectedAt/lastWriteAt） | 扩展 TS(plan:4297/5784/5984-5988) ↔ Rust `MdlogSidecarData`(plan:834-839) ↔ 测试(plan:1089) | ✓ 命名/可选性（Rust 侧 `#[serde(default)]`）匹配 |
| 锚点注释 `mdlog:m=` | `ANCHOR_RE`(plan:4336)、写入(plan:4418/4442)、扫描(plan:4718)、测试(plan:4200-4256, 5348-5383)、"严禁空锚点"断言(plan:5383) | ✓ |
| 指纹正则 `mdlog:v1` | `FINGERPRINT_RE = /^\uFEFF?\s*<!--\s*mdlog:v1\s+s=([^\s>]+)/`(plan:4335) 与前端受信门禁 `/^\uFEFF?\s*<!--\s*mdlog:v1/`(plan:2788) 与 spec:241/Y6-b 逐字同源 | ✓（前端为首串前缀判定，扩展为提取 sessionId，二者不冲突） |
| 围栏语言名 `vellum-widget` | plan:23（全局约束）、2814-2817（分发）、2718-2760（测试）、6859/7167/7669/7748（技能与模板校验） | ✓ 与 `className` 提取正则 `[\w-]+` 兼容（连字符可命中） |
| CSS 类 `.mdlog-widget*` / `.mdlog-live` | 产出声明 plan:1665、规约断言 plan:1674-1720、样式实现 plan:1765-1856、组件使用 plan:2595-2667、徽章 plan:3854 | ✓ BEM 命名一致；DESIGN.md 合规（圆角 6px/1px ∈ 集合、无 font-weight>500、仅用 `--ivory/--parchment/--stone/--brand/--border/--hairline/--mono/--serif`，均在 `src/styles/kami.css:26-42` 已声明） |
| `widgetRegistry` API（register/release/markVisible/requestMount/activate/subscribe） | 接口 plan:1881-1886 与 2020-2029、实现 plan:2092-2167、消费 plan:2488/2521-2524/2530、测试 plan:1891-2007 | ✓ 6 方法逐字一致（`__clear/__getActiveCount` 为可选测试钩子，测试侧用 `"__clear" in` 守卫 ✓） |

**唯一契约相关缺陷**：plan:23 与 spec §9.2 声称的"注册表 64 条 **LRU**"与实现不符——`WidgetRegistry::get()`（plan:791）不刷新 `order`，实际是 FIFO（测试名 `evicts_oldest_entry…` 反而如实描述了 FIFO）。归入建议 S1。

---

## 问题清单

### 阻断（4）

**[阻断] Task 1.3 — Rust 代码不能编译：`STILL_ACTIVE` 导入路径错误**
`plan:918-919` 从 `windows_sys::Win32::System::Threading::{… STILL_ACTIVE}` 导入。已核实本机 crate 源码：`windows-sys-0.61.2/src/Windows/Win32/Foundation/mod.rs:9431` 才是 `pub const STILL_ACTIVE: NTSTATUS`，`System/Threading` 下无此常量（`OpenProcess`/`GetExitCodeProcess`/`PROCESS_QUERY_LIMITED_INFORMATION` 确在 Threading，`CloseHandle`/`GetLastError`/`ERROR_ACCESS_DENIED` 确在 Foundation）。Step 3 写完后 Step 4 必然 `error[E0432]`，Task 1.3/1.4/1.5 全线卡住。
**修法**：`use windows_sys::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED, GetLastError, STILL_ACTIVE};` + `use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};`。
**附带**：`Cargo.toml` 现有 `windows-sys` features 已含 `Win32_Foundation`、`Win32_System_Threading`（`src-tauri/Cargo.toml:26-31`），Step 1 只需加 `uuid` ✓ 无缺 feature（此点计划正确）。

**[阻断] Task 1.5 — `main.rs` 以"整文件"形态给出却内含两处 `省略` 段，字面执行将删除生产代码**
`plan:1299` 声明 `Modify: src-tauri/src/main.rs:1-320`（真实文件 309 行），`plan:1300-1520` 从 `#![cfg_attr…]` 一直写到 `fn main()` 结尾，看起来就是整文件替换；但 `plan:1387`「// ... 省略 early_single_instance、first_markdown_arg、PendingOpenPaths、drain_pending_open_paths 原代码 ...」与 `plan:1456`「// ... 省略 first_markdown_arg 与 tests ...」明确缺失：`early_single_instance`（真实 `src-tauri/src/main.rs:11-150`，约 140 行 WM_COPYDATA + mutex 重试逻辑）、`PendingOpenPaths`、`drain_pending_open_paths`(:153)、`first_markdown_from_args`(:222+) 与既有 2 个测试。
子智能体按"零二义性字面执行"覆盖写文件即可造成**跨实例打开 .md 静默失效 + 测试数减少**，而 Step 4 的期望是"34+ 用例全部 ok"（`plan:1530`）——恰好无法区分"实现正确"与"代码被删"。
**修法**：改为显式 diff 语义（"仅替换 `load_document` 函数体 + 在 Builder 上插入 3 处"），或补齐完整文件；并在 Step 4 用 `cargo test --bin vellum` 断言"既有 2 个 main 测试仍在"。
**同 Task 另一处**：`plan:1333-1343` 的 `load_document_guard_detects_same_canonical_path` 只是 `Some(x) == Some(x)` 局部变量比较，**完全不调用生产代码**，属恒真测试（见 A2）。

**[阻断] Task 2.4 — Step 4 声称"6 用例全绿"，但用例 3 的断言与实现互相矛盾，绿灯不可达**
`plan:2314`：`expect(iframe.style.height).toBe("")`（意图验证"非法来源消息被忽略"）。而实现 `plan:2469` 的 `height` state 默认值为 `240`，`plan:2661` 渲染 `style={{ height: \`${height}px\` }}`；iframe 能存在即意味着已挂载，此时 `style.height === "240px"` 恒成立 → 该断言必红，`plan:2676`「Expected: PASS，6 个测试用例全部通过」不可能达成，执行者只能猜改哪一侧（猜错即弱化 source 校验或去掉默认高度）。
**修法**：断言改为 `expect(iframe.style.height).toBe("240px")`（并补一句"值未变化 ⇒ 消息被忽略"的等价断言）。
**同 Task**：`plan:2394-2404` 的 "renders dormant placeholder and reactivates upon click" **没有任何 expect**（末行仅注释「验证休眠文字渲染（点击即可唤醒）」），是装饰性用例；spec §9.2 明确要求覆盖"休眠占位块重新入视口不自动复活（Y9）"→ （Y9 的「不自动复活」在 Task 2.3 已有用例 `plan:1957-1988`，本用例至少应补齐占位文案与 `activate()` 后重挂载的断言）。

**[阻断] Task 5.4 — 最终验收数字与计划自身新增的测试相矛盾，DoD 门禁不可能通过**
`plan:7778`「npm test → 17 passed (17 files), 175 passed (175 tests)」与 `plan:7783`「cargo test → 15 passed (13 + 2)」是**开工前基线**（我实测吻合，见抽查记录），但计划本身新增：
- 前端测试文件 +5：`src/test/setup.test.ts`(plan:1557)、`src/lib/widgetRegistry.test.ts`(1876)、`src/components/WidgetSandbox.test.tsx`(2188)、`src/lib/scrollStick.test.ts`(2883)、`src/lib/mdlogState.test.ts`(3154) → 最终应为 **22 文件 / 用例数远大于 175**；
- 后端用例 +21（state 2、watcher 5、widget 12、main 2）→ 最终应为 **lib 32 + main 4 = 36**。
把 175/15 写进最后一个 Task 的"必须 100% 保持全绿"，会让执行者**删测试以凑数**或误判任务失败。同类不一致散见于：`plan:2859`（"18 个测试文件"，实际该点已 20）、`plan:3139`（"17 个测试文件全绿"，实际 21）、`plan:1531`（"17 文件/175 用例" 出现在 WP1 末尾，此时前端尚未新增任何测试文件，属巧合正确但语义误导）。
**连带**：Task 5.1（`plan:6748-6749`）把 `AGENTS.md` 基线更新为"17 测试文件，175 用例"——它是 WP5 的第一个 Task，晚于 WP2/WP3 的 +5 测试文件，写完后 `AGENTS.md` 立刻再次过期（现状 `AGENTS.md:5` 记的"14 文件/142 用例"正是同类漂移）。建议将基线订正移到 WP5 末尾，并按实测真实数字写入。

### 应当修复（15）

**[应当修复 A1] Task 1.3 — `is_pid_alive_win32` 的兜底方向使 pid 检活形同虚设**
`plan:939-945`：`OpenProcess` 返回空句柄时，仅 `ERROR_ACCESS_DENIED` 视为"无法判定→返回 true"，**其余错误码（进程不存在时的 `ERROR_INVALID_PARAMETER`/`ERROR_FILE_NOT_FOUND`）也走到末尾 `true`**（`plan:946`）。pi 进程崩溃后 pid 通常已不存在 → `OpenProcess` 失败 → 判"存活" → 徽章只能靠 120s 心跳超时兜底，spec D11/S9（`spec:793`）的"崩溃后快速摘徽章"目标打折。且 `judge_mdlog_alive` 的矩阵测试注入的是桩 `pid_alive`（`plan:700-723`），**永远测不到这条兜底**。
**修法**：`ERROR_INVALID_PARAMETER`/`ERROR_FILE_NOT_FOUND` → `false`；仅 `ERROR_ACCESS_DENIED`（及 `ERROR_SHARING_VIOLATION`）降级为 `true`；为该函数补一个"不存在的 pid（如 u32::MAX）返回 false"的平台条件测试。

**[应当修复 A2] Task 1.5 — spec §9.2 强制的"路径切换清空注册表 vs 同路径热重载保留注册表"测试实质缺失**
`plan:1333-1343` 恒真（见 B2）。生产守卫（`plan:1398-1432`）依赖 `state.current` 与 `doc.path`（后者由 `dunce::canonicalize` 产生，见 `src-tauri/src/document.rs:63-65`，等值判断大小写安全 ✓），但**无任何测试覆盖**：`registry.clear()` 是否被调用、watcher 是否被 drop。建议把守卫抽成 `fn should_rebind(current: Option<&PathBuf>, next: &Path) -> bool` 纯函数并对 `WidgetRegistry::clear` 写行为测试（spec §9.2 后端条目②）。

**[应当修复 A3] Task 1.3 — spec §9.2 要求的"128-bit UUID 高熵生成测试"完全缺失**
全文仅 `plan:1214` 注释与 `plan:1224` 实现，无对应用例（"生成 1000 个 id 无碰撞 / 长度 36 / 解析为 v4"任一即可）。

**[应当修复 A4] Task 2.5 — spec §9.2 要求的"`isTrustedMdlog` 追加时引用稳定、不破坏 components memo"测试缺失**
`plan:2702-2780` 的 4 个用例只覆盖正则/门禁/降级。布尔原始值本身引用恒定，真正的回归风险是 `components` useMemo 结果在追加前后是否同一实例——必须显式断言（可用两次 render 后比较 `iframe` DOM 节点 `===` 同一实例，即"不重挂载"），否则 Y1/G3 无防线。

**[应当修复 A5] Task 2.5 — `fallback={<CodeBlock …/>}` 每次渲染新建元素，破坏 `WidgetSandbox` 的 `React.memo`（违反 AGENTS.md 死规则 + spec §6）**
`plan:2831`。`memo` 做浅比较，JSX 元素每次新引用 → 追加写入触发整篇重载时该 widget 每次必然重渲染，正是 `AGENTS.md` "传给它的 props 必须保持引用稳定" 与 spec §6 "已有 iframe 保持位置稳定" 明令禁止的形态。虽然 iframe 不重挂载（DOM 位置稳定、`html` 字符串相等），但 10 个存活沙箱 + 长文档下每次热重载都会重跑渲染函数。
**修法**：不传 `fallback` 元素，改由 `WidgetSandbox` 内部渲染降级 `<CodeBlock code={html} language="" />`（或传 `fallbackCode: string`，在组件内部 memo 化）。

**[应当修复 A6] Task 4.5 — `writeSidecar` 非原子写，与 Vellum 的读取构成竞态（同一计划内 `insertHeaderAtTopAtomic` 已示范正确做法）**
`plan:5956-5958` 直接 `fs.writeFileSync(sidecarPath, JSON.stringify(…))`。sidecar 每 30s 心跳重写会触发 `mdlog-state-changed`（Task 1.2 双路防抖），Rust 侧 `read_mdlog_state_from_path`（`plan:1198-1200`）此刻读到半截 JSON → `serde_json::from_str(...).ok()?` → **返回 `None` → 徽章静默熄灭**，下一次心跳才恢复。spec §9.2 把"损坏 JSON → None"当成正确行为来测，但没有规定"允许生产端写出损坏 JSON"。
**修法**：写临时文件 + `fs.renameSync`（与 `plan:4786` 一致），或写失败时保留旧值。

**[应当修复 A7] Task 4.6 — sidecar 的 `lastWriteAt` 从未更新，违反 spec §3.7 明文**
`spec:271`「**`lastWriteAt` 仅在回合内容成功追加写入日志文件后更新并落盘**」。计划把 `onWriteSuccess`（`plan:6469-6474`）只写进内存 `currentState.lastWriteAt`，`updateLastWrite`（`plan:5977`，且 5763 被 import）**在全部生产路径零调用**，sidecar 的 `lastWriteAt` 永远停在连接时刻（`plan:6509`）→ `read_mdlog_state` 返回的 `lastWriteAt` 说谎（前端 `MdlogState.lastWriteAt` 类型即 spec §4.7 契约字段）。要么在 `onWriteSuccess` 里调用 `updateLastWrite(sidecarPath, ts)`（并让 `disconnect` 后不再触发），要么删除该导出并在计划中记录偏差。

**[应当修复 A8] Task 4.3 — 图片复制失败静默丢弃，未按 spec §8 写占位行**
`plan:5192-5194`：`try { copyFileSync } catch { continue; }`。`spec:632` 要求「图片复制失败或超过 20MB → 正文插入 `*(图片处理失败：<原因>)*`，记录不中断」。20MB 分支已实现（`plan:5163`），失败分支完全缺失。
**附带**：20MB 提示文案把 "20MB" 写死，而阈值来自可配置的 `maxImageBytes`（`plan:5161`）→ 用户改配置后文案失真。

**[应当修复 A9] Task 4.6 — `agent_settled` handler 内 `await writer.flush()` 与 Y12 非阻塞纪律冲突**
`plan:6651-6654`。`spec:594`/Global Constraints（`plan:25`）规定「事件 handler 内严禁 await 写入/复制（登记 + setTimeout 调度 + 串行 Promise 链）」，理由是"避免阻塞 pi 的 CLI 主线程、**idle 信号**与 `-p` 模式退出"；`agent_settled` 正是 idle 信号点，`flush()` 内含串行链 + `cleanAssetRetention` 目录遍历（`plan:5570-5573`）+ 最多 3×(50/150/300ms) 重试。
**修法**：`void writer.flush().catch(() => {})`（或仅 `writer.scheduleDebounce()`），把 await 留给 `session_shutdown`。

**[应当修复 A10] Task 4.4/4.6 — `/mdlog off` 语义与 spec §3.6 不一致，且熔断路径会重复报错**
`plan:6553-6556` `disconnect()` 调 `writer.destroy()`，而 `destroy()`（`plan:5698-5705`）先 `await this.flush()`；`flush()` 无 `isDisposed` 门禁（`plan:5547-5575`）→
① `spec:250` 要求主动断开「**清空**内存中未写入的待处理队列，取消所有防抖计时器」，计划实际是"再写一遍"（含把刚 `unshift` 回队列的失败批次再重试一次，`plan:5576-5578`）；
② 熔断（连续 3 批失败）路径：批次被放回队列 → `onFatalError` → `disconnect` → `destroy→flush` → 再次失败 → `consecutiveBatchFailures=4` → **再次 `onFatalError`** → 用户看到两条"已自动断开"错误 toast（`currentState` 已被置 null，故第二次 `disconnect` 无副作用，不会无限递归，但重复通知是真实缺陷）。
**修法**：`destroy(options?: { discard?: boolean })`，`/mdlog off` 走 `discard`；熔断触发后置 `fatalReported` 标志去重。

**[应当修复 A11] 全局 — spec §9.3「Release 构建下的沙箱与 CSP 人工验证清单」无任何对应 Task**
`spec:685-697` 的 8 项验收（release 打包下的 CSP / localStorage / cookie / window.open / 子帧自导航 / iframe DOM 防穿透，以及 dev·release 各一次正向渲染 Y11）在 24 个 Task 中**没有落点**：全文无 `npm run tauri build`、无人工验证步骤、无验收清单（相关关键词仅作为 SKILL.md 的"禁止 API"文案出现，`plan:7014-7018`）。spec §11 明文"每包完成必须通过验证方可结项"，而 CSP 与 `frame-src` 是否真生效只能在 release 产物下核验（`spec:685` 自己已声明 dev 用 http 端口）。这是覆盖面上唯一一处整节空缺。
**修法**：在 WP5 增设 Task 5.5（或并入 5.4 Step 之后）：构建 release 产物 → 逐条执行 §9.3 的 8 项并记录实测结果（含"子帧自导航"这一已知残余风险的确认）→ 结论写入独立验收报告。
**[应当修复 A12] Task 1.3/1.4 — Step 2 的失败测试命令指向不存在的 target**
`plan:745`、`plan:1150`：`cargo test --manifest-path src-tauri/Cargo.toml --test widget_tests`。`widget_tests` 是 `#[cfg(test)] mod widget_tests;`（`plan:770-776` 声明在 `lib.rs` 内，与现状 `src-tauri/src/lib.rs:5-6` 的 `document_tests` 同构），并非 `tests/` 集成测试；cargo 会报 `no test target named 'widget_tests'`，与计划写的"预期 error[E0432]"完全不符（E0432 只在 `cargo test` 全量编译时出现）。
**修法**：改为 `cargo test --manifest-path src-tauri/Cargo.toml` 或 `cargo test --lib widget_tests`。

**[应当修复 A13] 全局 — Global Constraints 声称"全链路无 emoji"，WP5 交付内容却大量使用 emoji**
`plan:20` 的硬约束 vs `plan:6979`（`### ✅ 适用场景`）、`plan:6984`（`### ❌ 严禁滥用场景`）以及 5 个校验脚本里的 `✅/❌/✨`（`plan:6772/6775/6783/6874/6919/6947/7229/7690/7758`）。`DESIGN.md` 的"无 emoji"约束对象是产品视觉面（本计划的应用侧新增文案确实干净：`记录中 · PI`、`交互内容 · 点击加载`、`已休眠`，抽查 `plan:2597/2600/3854` 无 emoji ✓），但计划把它写成"全链路"并自我违反。
**修法**：把约束限定为"产品 UI 与注入到 iframe 的 widget 内容无 emoji"，或把 SKILL.md 标题/脚本输出改为 `[PASS]/[FAIL]`（同文件 `plan:7690/7786` 已经在用 `[PASS]` 纯文本风格，两种风格混用本身也是不一致）。

**[应当修复 A14] Task 4.6 — E2E 用例在 ESM 下会抛 `ReferenceError`，且失败被 try/catch 吞成恒真**
`plan:6338`（`const extDir = path.resolve(__dirname, "..")`）位于 `"type": "module"` 包（`plan:4118`）→ `__dirname` 不存在 → 该用例**必然红**（不在 `try` 内，见 `plan:6332-6345` 结构）；而 `pi` 不可用时 `return`（`plan:6330-6335`）、异常时 `assert.ok(!e.stderr?.includes("SyntaxError"))` 在 `e.stderr` 为 undefined 时恒真（`plan:6358-6360`）→ 即使跑通也是装饰性验证。
**修法**：`const extDir = path.dirname(fileURLToPath(import.meta.url))`；"优雅跳过"改用 `t.skip()` 并断言真实产物（如 `-e` 加载后 `session_start` 不报错）。

**[应当修复 A15] 全局 — 计划未要求"工作树干净"，而当前工作树正带着 +495 行未提交的无关改动**
实测 `git status --porcelain` 显示 10 个文件处于 modified 状态（KaTeX 数学公式特性：`AGENTS.md`、`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src/components/MarkdownDocument.tsx`(+82)、`src/components/MarkdownDocument.test.tsx`(+80)、`src/styles/kami.css`、`vite.config.ts`），最后一次提交是 `47b1e55 docs: … spec v3`。这些文件与 mdlog 的 Task 1.3（Cargo.toml）、1.5（tauri.conf.json）、2.2（kami.css）、2.5（MarkdownDocument.tsx）、5.1（AGENTS.md）**完全重叠**，而每个 Task 的 Step 5 都用 `git add <具体文件>` 直接提交 → 无关的 KaTeX 改动会被裹进 mdlog 的功能提交里，事后无法分离回滚（也解释了为何 spec §9.1 的"175 用例"基线本身就含这些未提交测试）。
**修法**：在 WP0/Task 1.1 之前增加一个前置 Task：「按 `using-git-worktrees` 技能建立隔离工作树或先把在途改动独立提交」，并在 Global Constraints 补一条"每个 Task 提交前 `git status --porcelain` 必须只含本 Task 触及的文件"。

### 建议（11）

**[建议] Task 1.3 (S1)** `WidgetRegistry::get()`（`plan:791`）不更新 `order`，实为 FIFO；spec §9.2/AGENTS 文案称"LRU"。要么 `get` 时 `position→push_back` 提鲜，要么把文档措辞改为"插入序淘汰"。当前实现的 64×512KB=32MB 上限可接受。

**[建议] Task 2.3 (S2)** `register()` 即计入 `activeList`（`plan:2092-2100`, `plan:2121-2125`），意味着**从未进入视口**的 widget 也会占用 10 个存活名额并在首次 `markVisible` 时被淘汰，长文档中"下滚必须先点一次唤醒"。spec §6 的语义是"最多 10 个**存活 iframe**"，建议仅在 `requestMount` 通过时计入活跃集。

**[建议] Task 2.3 (S3)** 模块级单例在 import 时 `window.addEventListener("scroll", handleScroll, {capture:true})`（`plan:2074-2082`）且 `__clear()` 不移除监听；`createWidgetRegistry()` 多次调用（未来若做 SSR/多实例测试）会叠加监听。建议把滚动信号改由 App 的既有滚动 effect 转发，或提供 `destroy()`。

**[建议] Task 3.3 (S4)** `computeRecheckDelay`（`plan:3356-3358`）无上限 clamp：若 sidecar `heartbeatAt` 因时钟异常落在未来，`delay` 可能超过 `2^31-1`（setTimeout 溢出→立即触发→忙轮询）。建议 `Math.min(delay, 2_147_483_647)` 并加"delay>2^31 时截为 24h"用例。另外 `plan:3742-3744` 读取 `const path = currentPathRef.current; if (!path) return;` 后未使用 `path`（`read_mdlog_state` 设计上无参），建议删掉误导性变量或加注释。

**[建议] Task 3.2 (S5)** `plan:3434-3446` 把 `isMdlogActive` 加进 `fresh-ink` effect 的依赖数组，导致 `isMdlogActive` 由 true→false（记录刚断开）时 effect 重跑，**在断开瞬间凭空补放一次"落墨"动画并重启 2.8s 印章计时**。建议用 `lastHandledReloadTickRef` 守卫，或改读 `isMdlogActiveRef.current`（ref 已存在，`plan:3371-3372`）。

**[建议] Task 2.5 (S6)** 前端 512KB 预检用 `code.length`（UTF-16 长度，`plan:2824`），Rust 用 `html.len()`（字节，`plan:1220`）。中文正文 widget 在两处门禁间存在 3 倍缝隙（前端放行、后端拒绝）。当前有 `fallback` 兜底不致命，但建议统一为 `new TextEncoder().encode(code).length`，并在 spec §4.2 补一句"以字节为准"。

**[建议] Task 1.5 (S7)** 守卫的副作用：若首次 `watch_file` 失败（`plan:1420-1423` 仅 `eprintln!`），用户**重开同一文件**时 `is_same_doc===true` 会跳过重建 → 该文档永远无热重载直到切换文档。建议守卫条件为 `!is_same_doc || state.watcher.lock()?.is_none()`。

**[建议] Task 4.3 (S8)** cwd 包含性用 `path.relative` 判断（`plan:5134-5137`），未 `realpath`：cwd 内的符号链接指向外部 `.png` 仍可被复制（白名单排除了 svg，风险有限，但 spec §7.3「严禁跨目录抓取」的字面强度更高）。建议 `fs.realpathSync` 后再判定。

**[建议] 文档结构 (S9)** `# 工作包 3`（`plan:2873`）、`# 工作包 5`（`plan:6716`）应为 `##`，与其余三包一致，否则任何按 `^## 工作包` 生成目录/做包级校验的脚本会漏两包。

**[建议] Task 4.1 (S10)** 扩展包未声明 `engines`：`node --test test/**/*.test.ts` 直跑 `.ts` 依赖 Node ≥22.6 的类型剥离（实测本机 v24.16.0 可跑，见抽查记录）。建议 `package.json` 加 `"engines": { "node": ">=22.6" }`，并在 README.md 写明，避免低版本 Node 用户拿到 `ERR_UNKNOWN_FILE_EXTENSION`。

**[建议] Task 5.4 (S11)** `scripts/verify-skill-discovery.mjs` 不在 spec §10 文件清单内（属超出设计范围的额外产出，spec §11 明文禁止过度设计）。若保留，请在计划里注明它是"§9.3 人工验证缺失期间的自动化替身"——这也正提示：本审核 A11（§9.3 无人对应 Task）需要补齐。

---

## 抽查记录

### A. 测试基线实测（计划所依据的数字与真实输出）

```
$ npm test                (Vitest 4.1.9, jsdom)
 Test Files  17 passed (17)
      Tests  175 passed (175)
   Duration  4.87s

$ cargo test --manifest-path src-tauri/Cargo.toml
 running 13 tests  (vellum_lib, document_tests::*)
 test result: ok. 13 passed; 0 failed; 0 ignored
 running 2 tests   (unittests src\main.rs)
 test result: ok. 2 passed; 0 failed; 0 ignored
```
→ 计划与 spec §9.1 声称的基线 **17 文件/175 用例、后端 15 用例（13+2）完全属实** ✓；`AGENTS.md` 现记的"14 测试文件，142 用例"确已过期，Task 5.1 的订正方向正确（但见 B4/阻断项：订正目标数字在计划自身新增测试后再次过期）。
→ 新增逻辑均有对应用例（除本报告中点名的 3 项 spec §9.2 缺口）：Task 2.1 的 IntersectionObserver mock 有 `src/test/setup.test.ts`；Task 1.2 双路防抖有 5 个纯函数用例（含"互不顶槽"）；Task 4.x 六个模块各自配套 `.test.ts`。

### B. Task 1.3 精读（plan:523-993，471 行）

- TDD 闭环：**完整**。Step1 建 `Cargo.toml` uuid 依赖 + 6 个真实测试 → Step2 跑挂（但命令参数错，见 A12）→ Step3 实现 → Step4 跑绿（预期 26 passed，与"lib 目标 13+2+5+6"自洽 ✓）→ Step5 commit ✓。
- 代码真实性：**可编译**（除 `STILL_ACTIVE` 一处），非伪代码：`WidgetRegistry` 用 `HashMap+VecDeque` 实现容量与淘汰；`build_widget_response` 4 条安全头逐字与 spec §4.1/§7.1 一致；404 同样带头；非 GET → 404；多段路径 → 404（`extract_widget_id` 对 `/id/extra/path` 返回 None，`plan:846-859`）✓ 越权路径防御到位；`judge_mdlog_alive` 以 `&dyn Fn(u32)->bool` 注入 ✓ 可测性符合 spec Y2。
- 边界/资源：`registry.insert` 对已存在 id 先摘位再尾插（不重复计数）✓；`remove` 同步清 `order` ✓；`Mutex` 中毒统一 `unwrap_or_else(|p| p.into_inner())`（`plan:1474`）或 `map_err` ✓ 无 panic 传播；`is_pid_alive_win32` 成功取句柄后**必 `CloseHandle`**（`plan:929`，G2 落实）✓；`STILL_ACTIVE(259)` 误判（进程真实退出码恰为 259）为 Win32 固有已知误差，可接受，建议注释标注。
- 弱点：兜底方向（A1）、无 UUID 熵测试（A3）、`--test` 参数错（A12）、LRU 名不副实（S1）。

### C. Task 2.4 精读（plan:2184-2684，501 行）

- TDD 闭环：结构完整（Red→Green→Commit），但**绿灯门禁不可达**（阻断 B3）；6 用例中 1 个无断言（装饰性）。
- 代码真实性：高。沙箱属性 `sandbox="allow-scripts"` + `referrerPolicy="no-referrer"`（`plan:2655-2658`）✓ 无 `allow-same-origin` ✓ 满足 spec §7.1；`event.source !== iframeRef.current.contentWindow` 的来源校验（`plan:2557-2559`）比 spec 要求的 origin 比对更强 ✓；payload 类型/数值双重守卫 + `Number.isNaN` ✓；rAF 节流带 `cancelAnimationFrame` 覆盖 + 卸载时清理（`plan:2572-2577`, `2582-2585`）✓ 无泄漏。
- 竞态/泄漏核查：**通过**。①`register_widget` 在途卸载 → `isCancelled` + 补发 `unregister_widget`（`plan:2534-2540`）✓；②卸载统一回收后端注册（`plan:2486-2493`）✓；③`subscribe` 返回的退订在 effect 清理中调用 ✓；④`widgetRegistry.release` 只删条目，不动 iframe 后端条目（已被①②回收）✓。
- 遗留：`fallback` 新元素破坏 memo（A5）；休眠态仅隐藏 iframe、不通知后端释放 HTML（有界，64 条，可接受）；`isDormant` 时 `widgetUrl` 保留 → 唤醒后复用同一 id（安全，因为 id 从未被 unregister）✓ 设计自洽。

### D. Task 4.6 精读（plan:6159-6670，512 行）

- TDD 闭环：Step1 两份测试（lifecycle 3 用例 + e2e 1 用例）→ Step2 `ERR_MODULE_NOT_FOUND` ✓ 真实可达 → Step3 index.ts + README → Step4 全绿 → Step5 commit ✓（Step5 为「验证并记录检查点」样式，与 4.x 其他 Task 一致）。
- 代码真实性：`index.ts` 380 行为**可直接落地的真实实现**（连接/断开/命令/5 类事件接线/回填模式分支/full-increment 逻辑完整，非伪代码）；pi API 用法逐条对照官方文档核实为真（见"现状兼容性抽查"附表）✓。
- 弱点：e2e 用例 ESM `__dirname` 崩溃 + 恒真兜底（A14）；`agent_settled` await（A9）；`disconnect`/`destroy` 语义与 spec §3.6 偏差 + 重复通知（A10）；`lastWriteAt` 未回写（A7）；`session_start` 未按 `event.reason` 分支（注释声称覆盖 5 种 → 事实等价，但建议补一条"reason=reload 亦恢复"用例，把注释的承诺变成断言）。
- 亮点：`connectToFile` 在 sessionId 不一致时**先 notify 再 return**，与 `spec:807` 的幽灵重连/污染防护决议一致；`active:false` 条目缺 `path` 字段时提前返回（`plan:6608-6611`）✓ 无 `undefined` 解引用。

### E. 契约一致性抽查方法（记录）

采用 `grep` 全量取词 + 逐处对读（非通读）：`register_widget|unregister_widget|read_mdlog_state`（40 处）、`lastWriteAt|heartbeatAt|expiresAt|anchorLost`（90 处）、`file-changed|mdlog-state-changed`（40 处）、`vellum-widget:resize`（17 处）、`mdlog:m=`（17 处）、`mdlog:v1`（16 处）、`vellum-widget`（80+ 处）、`.mdlog-widget|.mdlog-live`（30 处）、`register|release|markVisible|requestMount|activate|subscribe`（63 处）。结论：**无一处拼写或形状漂移**；计划把逐字契约同时写进 Global Constraints（`plan:18-30`）与各 Task 的 Interfaces/校验脚本（`plan:7748`）双保险，是本计划最可取的结构设计。

---

## 复核要求（复审通过的最小条件）

1. 修掉 4 条阻断：B1（`STILL_ACTIVE` 导入）、B2（main.rs 改显式 diff + 断言既有测试仍存）、B3（`height` 初值断言 + 补休眠用例断言）、B4（全计划测试计数按"最终 22 文件 / 36 用例"重算，并把 AGENTS.md 基线订正移到最后一个改测试的 Task 之后）。
2. A1–A14 中至少完成：A1（pid 检活兜底方向）、A2/A3/A4（三项 spec §9.2 强制测试）、A5（fallback 引用稳定）、A6（sidecar 原子写）、A7（`lastWriteAt` 回写）、A8（图片失败占位行）、A9/A10（扩展端阻塞与断开语义）、A11（**补一个覆盖 spec §9.3 的 Release/CSP 人工验证 Task**）、A13（emoji 自相矛盾）、A14（E2E 用例恒真）。
3. 修订后需重新逐条核对 Global Constraints 与交付内容关于 emoji 的自我矛盾（A13），并补齐 A15 的版本控制前置条件（当前工作树带 +495 行无关未提交改动），其余项可归入实现期跟随。
