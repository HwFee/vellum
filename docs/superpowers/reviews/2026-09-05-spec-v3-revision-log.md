# Pi 对话实时记录（mdlog）与沙箱交互块 · 设计文档 v3 修订日志

- **修订日期**：2026-09-05
- **修订对象**：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（v2 → v3，原地定点修订）
- **修订性质**：纯文档定点修订（未修改任何代码文件，未引入任何新架构；测试基线 100% 保持全绿）
- **输入依据**：
  1. 复审报告 A：`docs/superpowers/reviews/2026-09-05-spec-review2-qwen.md`（驳回：Z1 阻断项 + Y1～Y12 修复项 + 9 项建议）
  2. 复审报告 B：`docs/superpowers/reviews/2026-09-05-spec-review2-gemini.md`（通过：G1、G2 修复项 + G3 建议项）
  3. 项目技术与设计规范：根目录 `AGENTS.md`、`DESIGN.md`、`docs/preview/mdlog-preview.html`

---

## 一、修订总览

本次定点修订将设计文档升级至 **v3**，全量闭环了第二轮双审阅指出的所有阻断项（Z1）、应当修复项（Y1～Y12、G1～G2）及建议项。所有修改均使 spec 严密对齐代码事实与底层平台协议（Tauri 2 / wry / WebView2 / Win32 / CommonMark / pi 扩展运行时），达到「实施智能体严格照字面实现即完全正确」的工程确定性。

---

## 二、定点修订逐条落实清单

### 1. 【Z1 阻断】sidecar 心跳机制与徽章自动复查调度
- **§3.7**：在 sidecar 文件中新增 `heartbeatAt` 字段，与 `lastWriteAt` 彻底解耦。连接建立期间由扩展通过 `setInterval` 每 30s 定时刷新 `heartbeatAt` 并写盘；连接断开（`/mdlog off` 或 `session_shutdown`）时调用 `clearInterval`；`lastWriteAt` 仅表示最近一次内容写入。长回合（高耗时构建/工具长时间运行/用户阅读停顿）期间 `heartbeatAt` 正常刷新，徽章不再误失效。
- **§4.3 / §4.7**：后端存活判据重构为：pid 存活（`OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` 校验；若失败则以 `GetExitCodeProcess` 复核；仍失败降级为仅依据心跳判活；获取句柄后必须显式调用 `CloseHandle`，闭环 G2）**且** `now - heartbeatAt <= 120_000`；`read_mdlog_state` 命令返回 `{ lastWriteAt, heartbeatAt, expiresAt }`（其中 `expiresAt = heartbeatAt + 120_000`）。
- **前端调度**：前端渲染徽章期间，通过 `setTimeout` 在 `expiresAt` 时刻自动重新发起 `read_mdlog_state` 复查（若后端返回 `None` 则立即静默隐藏徽章并清除定时器）；收到 `mdlog-state-changed` 事件时重查并重置计时器。
- **§9.2 单测用例**：新增「空闲 200s（无内容写入）徽章仍存活」与「pid 死亡且无新事件，expiresAt 到达后徽章自动隐藏」两条自动化测试断言。

### 2. 【Y1 + G3】受信判定闭包与 memo 引用稳定性
- **§4.2**：在 `MarkdownBody` 内部通过 `const isTrustedMdlog = useMemo(() => /^\uFEFF?\s*<!--\s*mdlog:v1/.test(markdown), [markdown])` 提取布尔原始值，并将其加入 `components` 的 `useMemo` 依赖数组（`[resolveHeadingId, isTrustedMdlog]`）。
- **架构约束闭环**：由于 `isTrustedMdlog` 是布尔原始值，同文档持续追加写入时恒为 `true`，`components` 对象引用 100% 保持稳定，杜绝了换文档或空标题时沿用陈旧闭包导致外部非受信文档自动挂载 iframe 的安全隐患；同时完全遵守 `AGENTS.md` 对 memo 结构与引用稳定的死规则。
- **BOM 防御（G3）**：正则统一采用 `/^\uFEFF?\s*<!--\s*mdlog:v1/`，显式兼容 UTF-8 BOM 与首行前导空白。

### 3. 【Y2】协议响应强制头清单补全 Content-Type
- **§4.3**：将强制响应头由 3 条扩充为 4 条，补充 `Content-Type: text/html; charset=utf-8`。明确记录 wry 绝不自动为自定义协议补充 MIME，在 `X-Content-Type-Options: nosniff` 下若缺 Content-Type 将导致 WebView2 拒绝作为 HTML 渲染或中文乱码。
- **§9.2**：后端单测增加断言：200 响应必须同时包含严苛 CSP 与 `Content-Type: text/html; charset=utf-8`。

### 4. 【Y3】`register_widget` 契约与 ID 安全封装
- **§4.1 / §4.3**：`register_widget` 返回类型规定为 `RegisterResult { id: string, url: string }`（Rust 结构体配置 `#[serde(rename_all = "camelCase")]`）。
- **前端契约**：前端组件将 `id` 保存于 `useRef` 中（仅用于组件卸载时调用 `unregister_widget({ id })`），沙箱 iframe 的 `src` 属性仅使用返回的 `url`；严禁前端尝试解析 URL 字符串反推 id。

### 5. 【Y4】沙箱断网措辞订正与子帧自导航残余风险
- **§7.1 / §7.2.4 / §1**：订正「绝对断网」表述为「彻底切断所有取数型对外请求（fetch/XHR/img/font/websocket）」。
- **残余风险接受**：明确记录在 `sandbox="allow-scripts"` 且无 `navigate-to` 浏览器实现下，子帧可通过 `location.href` 导航自身；子帧一旦离开当前域即脱离本应用 CSP。记录为已知且接受的残余风险（widget 仅用于讲解客观事实，受信文档由本项目扩展生成，主应用进程受零 IPC 隔离保护）。
- **§9.3**：人工核验清单新增一行实测 `location.href = "https://example.com"`，验证沙箱跳转行为符合预期。

### 6. 【Y5】§3.4 逐字节排版规范与唯一字符串公式
- **唯一公式**：写入前所有用户与助手正文统一执行 `rstrip`（`text.replace(/\s+$/, "")`）；锚点行前后固定拼接 `\n\n`；分隔线 `---` 前后固定拼接 `\n\n`。
- **规则收拢**：删除原规则 2 与规则 6 的重复锚点写出表述，统一收拢为一条规则（消息正文/图片处理完毕后输出 `\n\n<!-- mdlog:m=${entryId} -->\n\n`）。
- **围栏扫描定义**：补齐 CommonMark 围栏算法标准（行首 ≤3 个空格缩进，连续 ≥3 个同种反引号或波浪线；闭合行字符与起始行相同且长度 ≥ 起始行；行内内联代码反引号不计入围栏开闭状态）。
- **示例纠正**：修正原第 160 行示例中 ``助手部分内容```ts`` 黏在同一行的非法围栏格式，改为合法的多行围栏样例。

### 7. 【Y6】§3.5 智能追加尾向扫描算法与降级方向定稿
- **扫描语义**：明确为「从文件末尾向前逐行回退，直到命中第一个 `entryId` 属于当前分支 `ctx.sessionManager.getBranch()` 的有效锚点，或到达文件开头」，绝非首个正则命中即停。
- **会话指纹正则**：写死为 `/^\uFEFF?\s*<!--\s*mdlog:v1\s+s=([^\s>]+)/`（准确提取包含连字符的完整 UUID `sessionId`）。
- **4b 原子重写**：4b 分支改为执行一次性原子重写，将文件头 `<!-- mdlog:v1 s=<sessionId> -->\n\n# Pi 对话记录\n\n` 插入至**文件最顶部（第 1 行）**，原有内容保留在其下，使文件首行恒为指纹，与受信门禁（首行判定）完全一致，杜绝二次重连时的指纹丢失与重复回填。
- **伪锚点防御**：扫描时同步维护围栏开闭状态，凡是落在未闭合或已闭合围栏内部的锚点行一律作为普通正文忽略。
- **降级方向明确**：比对整批消息时，写出「本批最后一条成功命中的 entryId」；若全批未命中，本批不写锚点注释，并在 sidecar 中记录 `anchorLost: true`，下次重连直接走指纹确认路径。
- **静默重连**：`session_start` 静默恢复同样执行本扫描；交互询问确认判据写为 `ctx.hasUI && ctx.ui.confirm`。

### 8. 【Y7】§4.5 图片管线规则与边界定稿
- **默认工具集**：文字与配置完全统一——默认全面扫描所有工具输出；`config.json` 中的 `toolNames` 语义明确为「可选收窄白名单」（未配置或为空时扫描全部工具）。
- **路径提取正则**：明确正则样式：`/(?:["']|^|\s)([A-Za-z0-9_.\-\\/]+?\.(?:png|jpg|jpeg|gif|webp|bmp))(?=["']|$|\s)/gi`。
- **mtime 过滤**：增加 `stat.mtimeMs >= turnStartTime - 5000` 时间窗过滤，杜绝 `ls`/`grep`/`read`/`git status` 等输出中的既有历史图片被误复制。
- **文件名净化**：复制时文件名严格净化为 `[A-Za-z0-9._-]`（其余字符替换为短横线 `-`），彻底杜绝 CommonMark 解析空格截断与 URL 编码问题。
- **统一基准**：相对路径解析与安全包含性校验统一使用 `ctx.sessionManager.getCwd()`。
- **多图与替换**：多张图片各自独立成行，重名追加 `-2`、`-3` 后缀，正文中的路径比对替换统一替换为**最终落盘的净文件名**。

### 9. 【Y8】AppState 迁移与模块编译解耦
- **§4.3 / §10**：新建 `src-tauri/src/state.rs`（置于 `vellum_lib` crate 中），定义 `pub struct AppState { pub current: Mutex<Option<PathBuf>>, pub watcher: Mutex<Option<RecommendedWatcher>> }`。
- **引用解耦**：`src-tauri/src/lib.rs` 追加 `pub mod state;`；`main.rs` 改为 `use vellum_lib::state::AppState;`；`widget.rs` 可直接编译引用 `State<'_, AppState>`。
- **清单同步**：在 §10 文件改动清单中补齐 `src-tauri/src/state.rs` 新建与 `main.rs` 的职责变更。

### 10. 【Y9】注册表单一托管与 widgetRegistry API 契约
- **Rust 状态访问**：去除全局 static 互斥锁，仅使用 Tauri managed `State<WidgetState>`（内部封装 `Mutex<WidgetRegistry>`）；协议 handler 通过 `ctx.app_handle().state::<WidgetState>()` 访问；单元测试可脱离 AppHandle 直接实例化 `WidgetRegistry`。
- **前端 registry 契约**：在 §4.1 给出 `src/lib/widgetRegistry.ts` 公共 API 签名（`register` / `release` / `markVisible` / `activate` / `requestMount` / `subscribe`）；明确 registry 单例为休眠/激活状态的唯一真源，LRU 排序键为最近 `markVisible` 时间戳。
- **滚动守护对齐**：§4.6 守护解除条件删去「点击」，严格与 `src/lib/scrollRestore.ts:145-152` 真实实现对齐（监听 `wheel`、`touchstart`、`keydown`、取消函数调用与 5 秒超时）。

### 11. 【Y10】CSS token 自动化审查断言作用域与圆角订正
- **§9.2**：将 CSS token 审查断言的作用域严格限定在新增的 `.mdlog-widget`、`.mdlog-widget__bar`、`.mdlog-widget__frame`、`.mdlog-live` 与 `.mdlog-live::before` 规则块（沿用 `kami.css.test.ts` 既有的按选择器取块方式）。
- **允许圆角集合**：订正为 `{0, 1px, 2px, 3px, 4px, 6px}`，注明 1px 依据 DESIGN.md 章点微圆惯例（5×5px 微方块使用 1px 圆角）；原始色值断言仅禁止新增规则块内使用未声明色值。

### 12. 【Y11】正路径加载渲染验收与运行前提记录
- **§9.3**：在验证清单中增补正向功能验收行（在 dev 与 release 环境各执行一次）：验证 widget 真实加载渲染、内联 JavaScript 正常执行、postMessage 准确调整高度与标题、中文字符不乱码。
- **§4.3**：明确记录运行前提：依赖 Windows WebView2 Runtime 支持 `ICoreWebView2_22`（iframe 自定义协议拦截）。在低版本回退路径下 iframe 可能为空白，应用侧行为定义为降级渲染占位块且不报错。
- **§7.2**：将门禁措辞更正为「意图标识（heuristic）」，如实记录其为纯内容特征判据、可被恶意文件伪造的性质。

### 13. 【Y12】扩展事件链非阻塞调度禁令
- **§3.3 / §4.5**：明令禁止在 `message_end`、`tool_execution_end` 与 `agent_settled` handler 内 await 磁盘追加或图片复制；所有 handler 仅同步登记并由 `setTimeout` 调度后台异步处理，杜绝阻塞 pi 的 CLI 交互主线程、idle 信号与 `-p` 退出。
- **串行 Promise 链**：落盘事务在 timer 回调中以严格串行的 Promise 链执行，确保文件追加顺序严格单调递增。
- **shutdown 超时收紧**：`session_shutdown` 同步落盘时若有未完成的图片复制，等待超时上限从 5s 降为 1s。

### 14. 【G1】watcher 重建守卫
- **§4.7 / §10**：在 `load_document` 中增加规范化路径守卫：**仅当 `state.current` 记录的 canonical 绝对路径发生改变时（用户切换至另一个文档），才 drop 旧 watcher 并重建新 watcher**。同一文档的热重载保持现有 watcher 持续存活，彻底杜绝 `sidecar_deadline` 被意外扼杀以及 Windows 操作系统目录变更句柄频繁重建的资源震荡。

### 15. 【G2】Win32 进程句柄 CloseHandle 释放
- **§4.3**：明确规定 `read_mdlog_state` 在 Windows 下调用 `OpenProcess` 判定存活获取非零句柄后，必须在判定完成后立即调用 `windows_sys::Win32::Foundation::CloseHandle(handle)` 释放内核对象，彻底杜绝句柄泄漏。

### 16. 【建议项吸收】
- **权威预览页唯一真源**：§4.1 样式数值完全以 `docs/preview/mdlog-preview.html` 为准（margin 17px 0、bar padding 7px 14px、mono 10px、描边仅在 frame border-top、frame min-height 120px），删除 spec 中与预览冲突的旧数值表。
- **滚动稳定防抖**：§4.1 补充「稳定停止滚动 400ms 后才允许 LRU 淘汰挂载；被淘汰项重新进入视口时不自动复活，必须点击」。
- **降级责任分工**：§4.1 与 §8 明确划分：`MarkdownDocument` pre 渲染器负责 512KB 长度预检并降级为 CodeBlock；`WidgetSandbox` 负责捕获 invoke 失败并渲染 fallback。
- **资产清理策略**：§4.5 `config.json` 增加 `assetRetentionMb` 配置（默认 200MB），超出时按文件 `mtime` 最旧优先删除历史图片。
- **三反引号外层防截断**：§5.1 技能契约补充：正文含三反引号时，外层交互围栏必须使用四个反引号。
- **AGENTS.md 规约订正**：§10 改动清单补入 AGENTS.md 订正：测试基线更新为 17 文件 / 175 用例；技能安装流程增补项目专属技能真实目录例外与版本化理由。
- **Rust 测试可注入性**：§9.2 将存活判定抽离为纯函数 `judge_mdlog_alive`（注入 pid_alive 函数指针），协议处理抽离为纯函数 `build_widget_response`，脱离 GUI/OS 环境可完整单测。
- **wry 前缀匹配说明**：§4.3 补充说明 wry 前缀匹配机制使外部同名主机名请求安全进入本地 handler 并返回 404。
- **精确化 rehype-sanitize 描述**：§4.2 明确围栏源码作为字符串原样交付给沙箱，整篇文档依然受完整 sanitize 保护，Unified 管线不新增任何标签例外。

---

## 三、文件修改清单

| 文件路径 | 修改性质 | 变更说明 |
|----------|----------|----------|
| `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md` | 原地定点修订 | 全量升级至 v3，逐条落实 Z1、Y1～Y12、G1～G2 及 9 项建议 |
| `docs/superpowers/reviews/2026-09-05-spec-v3-revision-log.md` | 新建 | 本修订记录交付物 |

> **红线核查**：本次任务严格遵守工作准则，**未改动任何代码文件（`src/` 与 `src-tauri/` 保持 100% 原始未改状态）**。

---

## 四、测试基线实测摘要

在文档修订完成后，执行完整测试套件以验证开发环境基线状态：

1. **前端测试（Vitest）**：
   ```
   > npm test
   Test Files  17 passed (17)
        Tests  175 passed (175)
     Duration  4.15s
   ```
   测试基线 100% 保持全绿。

2. **后端测试（Cargo）**：
   ```
   > cd src-tauri && cargo test
   running 13 tests (vellum_lib) ... ok. 13 passed; 0 failed
   running 2 tests (main.rs unittests) ... ok. 2 passed; 0 failed
   Doc-tests vellum_lib ... 0 passed
   ```
   全部 15 个用例 100% 保持全绿。

---

## 五、与 Spec 的偏差说明

**零偏差（No Deviations）**。本轮定点修订 100% 逐字逐句落实了复审报告 A、复审报告 B 与用户任务指令中的全部要求，所有技术事实均经代码库与底层依赖核验，完全支撑直接进入实施阶段。
