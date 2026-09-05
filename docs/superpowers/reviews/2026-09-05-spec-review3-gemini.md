# Spec 复核报告（reviewer-gemini，v3）

结论：**通过**

---

## 一、审核概况与实测测试基线

- **审核对象**：`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（v3 定点修订版，835 行）
- **复核依据**：
  1. 上一轮驳回报告：`docs/superpowers/reviews/2026-09-05-spec-review2-qwen.md`（Z1 阻断 + Y1～Y12 + 建议项）
  2. 上一轮报告：`docs/superpowers/reviews/2026-09-05-spec-review2-gemini.md`（G1～G3）
  3. v3 修订日志：`docs/superpowers/reviews/2026-09-05-spec-v3-revision-log.md`
  4. 项目设计与性能规范：`DESIGN.md`、`AGENTS.md`、`docs/preview/mdlog-preview.html`
  5. 代码与依赖实现事实：`src/`、`src-tauri/`、`@earendil-works/pi-coding-agent`
- **审核性质**：只读复核（未修改任何源码或测试代码，唯一写入物为本复核报告）。

### 实测测试基线真实输出（只读验证）

1. **前端测试（Vitest）**：
   ```
   > vellum@1.4.0 test
   > vitest run

   Test Files  17 passed (17)
        Tests  175 passed (175)
     Duration  4.10s (transform 3.03s, setup 2.36s, import 7.49s, tests 3.70s, environment 21.34s)
   ```
   17 测试文件全部通过，175 用例全部通过，基线保持 100% 全绿。

2. **后端测试（Cargo）**：
   ```
   > cd src-tauri && cargo test
        Running unittests src\lib.rs
   test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

        Running unittests src\main.rs
   test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

      Doc-tests vellum_lib
   running 0 tests
   test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
   ```
   全部 15 个 Rust 用例（13 + 2）全部通过，基线保持 100% 全绿。

---

## 二、Z1 复核（唯一阻断项）

- **复核结论**：**完全闭环，通过**。
- **逐项核实与代码/协议证据**：
  1. **心跳字段与 30s 写入方解耦**（§3.7）：
     - sidecar 文件明确新增 `heartbeatAt` 字段，与 `lastWriteAt` 语义彻底分离；
     - 扩展在连接建立期间通过 `setInterval` 每 30s 定时刷新 `heartbeatAt` 并写盘，连接断开（`/mdlog off` 或 `session_shutdown`）时调用 `clearInterval`；
     - `lastWriteAt` 仅在内容追加落盘后刷新。耗时构建、长任务运行或用户长时阅读停顿时，`heartbeatAt` 持续刷新，徽章不再误失效。
  2. **`read_mdlog_state` 返回 `expiresAt`**（§4.3）：
     - 返回结构体声明 `MdlogStateResponse { lastWriteAt, heartbeatAt, expiresAt }`，其中 `expiresAt = heartbeatAt + 120_000`；若判死或超时一律返回 `Ok(None)`。
  3. **前端 `setTimeout` 到期自动复查**（§4.7）：
     - 前端徽章挂载期间，根据 `delay = Math.max(0, expiresAt - Date.now())` 设置 `setTimeout`；
     - 在 `expiresAt` 到期时刻自动调用 `read_mdlog_state` 复查；若返回 `None` 则立即静默隐藏徽章并清除计时器；收到 `mdlog-state-changed` 事件时重新查询并重置定时器。
  4. **Win32 `OpenProcess` 失败回退与句柄释放**（§4.3）：
     - 调用 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)`；
     - 成功获取非零句柄后，立即显式调用 `windows_sys::Win32::Foundation::CloseHandle(handle)` 释放内核句柄，杜绝泄漏；
     - 若 `OpenProcess` 失败，追加 `GetExitCodeProcess` 复核；仍失败则安全降级为仅依心跳时间判定，避免权限降权误判进程死亡。
  5. **自动化单测覆盖**（§9.2）：
     - 明确要求并设计了两条新用例：
       - 空闲 200s（无内容写入但心跳刷新）徽章保持存活；
       - pid 死亡且无新事件，`expiresAt` 到达后徽章定时器自动触发复查并静默隐藏。

---

## 三、Y1-Y12 逐条复核

| 编号 | 判定 | 证据与落实说明 |
|---|---|---|
| **Y1** | **已修复** | §4.2 在 `MarkdownBody` 内通过 `useMemo` 将受信判定计算为原始布尔值 `isTrustedMdlog = useMemo(() => /^\uFEFF?\s*<!--\s*mdlog:v1/.test(markdown), [markdown])`，并将其加入 `components` 依赖 `[resolveHeadingId, isTrustedMdlog]`；杜绝陈旧闭包导致外部文件误挂载 iframe，同时布尔值在日志追加模式下恒为 `true`，`components` 引用 100% 恒定，严格遵守 `AGENTS.md` 性能红线。 |
| **Y2** | **已修复** | §4.3 协议强制响应头由 3 条增至 4 条，补充 `Content-Type: text/html; charset=utf-8`，明确说明 wry 不自动补充 MIME 及在 `nosniff` 下若缺会导致 WebView2 拒绝渲染或中文乱码；并在 §9.2 单测中明确断言 200 响应同时包含 CSP 与正确 Content-Type。 |
| **Y3** | **已修复** | §4.1 与 §4.3 明确 `register_widget` 返回类型为 `RegisterResult { id: String, url: String }`（serde camelCase），前端以 ref 保存 id、只用 url 作为 `iframe.src`，严禁前端反向解析 URL 字符串反推 id。 |
| **Y4** | **已修复** | §7.1 与 §7.2.4 将「绝对断网」订正为「阻断所有取数型对外请求（fetch/XHR/img/font/websocket）」，在 §7.1 与 §7.2.4 如实记录子帧通过 `location.href` 自导航为已知且接受的残余风险，并在 §9.3 人工核验清单补充了该项实测行。 |
| **Y5** | **已修复** | §3.4 给出每条消息的唯一字符串拼接公式（正文统一强制 `rstrip`、锚点前后各固定 `\n\n`、`---` 分隔线前后各固定 `\n\n`），合并收拢规则 2 与规则 6 的锚点输出；§3.4 补充 CommonMark 围栏算法标准定义（行首 ≤3 空格、≥3 个同字符、闭长 ≥ 开长、忽略行内代码）；纠正了原示例中反引号与正文黏连的语法错误。 |
| **Y6** | **已修复** | §3.5 明确扫描为「向前回退直到命中 entryId 属于当前分支或到达文件头」；会话指纹正则写死 `/^\uFEFF?\s*<!--\s*mdlog:v1\s+s=([^\s>]+)/`；4b 分支改为一次性原子重写将文件头插入最顶部；扫描同步维护围栏开闭状态过滤伪锚点；全批未命中降级为不写锚点并记 `anchorLost: true`；静默重连同样执行扫描且交互判据采用 `ctx.hasUI && ctx.ui.confirm`。 |
| **Y7** | **已修复** | §4.5 统一默认全面扫描所有工具输出（`toolNames` 为可选收窄白名单）；给出 `IMAGE_PATH_RE` 样式；增加 `stat.mtimeMs >= turnStartTime - 5000` 过滤；文件名净化为 `[A-Za-z0-9._-]`；统一基准目录为 `ctx.sessionManager.getCwd()`；明确多图各自独立成行与最终落盘名替换。 |
| **Y8** | **已修复** | §4.3 与 §10 明确新建 `src-tauri/src/state.rs`（属于 `vellum_lib` crate）声明 `pub struct AppState`，`main.rs` 改为 `use vellum_lib::state::AppState;`，`widget.rs` 可无缝引用 `State<'_, AppState>` 编译，并在 §10 补齐两文件职责改动。 |
| **Y9** | **已修复** | §4.3 统一为 managed `State<WidgetState>`，协议 handler 走 `ctx.app_handle().state::<WidgetState>()`，去除全局 static；§4.1 给出 `widgetRegistry.ts` 6 项标准公共 API 签名并确立 registry 为真源；§4.6 滚动守护解除条件删去「点击」，与 `scrollRestore.ts` 既有的 `wheel/touchstart/keydown/超时/取消函数` 严格对齐。 |
| **Y10** | **已修复** | §9.2 将 kami CSS token 审查断言的作用域严格限定在新增的 `.mdlog-widget*` 与 `.mdlog-live*` 规则块，允许圆角集合订正为 `{0, 1px, 2px, 3px, 4px, 6px}`（注明 1px 依据 DESIGN.md:177 微方块/章点惯例，0 为重置），原始色值断言仅禁止新增块内使用未声明色值。 |
| **Y11** | **已修复** | §9.3 增补正向功能加载渲染验收行（dev 与 release 各一次：真实挂载、内联脚本执行、postMessage 调高与标题采纳、中文不乱码）；§4.3 记录依赖 `ICoreWebView2_22` 前提及低版本空白降级占位块行为；§7.2 将门禁更正为「意图标识（heuristic）」，如实记录可被内容特征伪造的定位。 |
| **Y12** | **已修复** | §3.3 与 §4.5 明令禁止在事件 handler 内 await 磁盘写入或异步图片复制事务，所有 handler 仅同步登记并由 `setTimeout` 调度后台异步处理；在 timer 回调中以串行 Promise 链单调落盘；`session_shutdown` 同步落盘时图片等待上限从 5s 收紧为 1s。 |

---

## 四、G1-G3 复核

1. **G1（`load_document` watcher 重建路径守卫）**：
   - **复核结论**：**已修复**。
   - **证据**：§4.7 与 §10 明确在 `src-tauri/src/main.rs` 的 `load_document` 中增加 canonical 路径守卫：**仅当 `state.current` 记录的规范化绝对路径发生改变时（切换到新文档），才 drop 旧 watcher 并重建新 watcher**；同一文档的热重载保持现有 watcher 持续存活，彻底消除了 `sidecar_deadline` 被意外扼杀以及 Windows 操作系统目录变更句柄频繁重建的资源震荡。

2. **G2（Win32 `OpenProcess` 句柄释放 `CloseHandle`）**：
   - **复核结论**：**已修复**。
   - **证据**：§4.3 与 §4.7 明确规定在 Windows 平台下调用 `OpenProcess` 判定存活获取非零句柄后，必须在判定完成后立即调用 `windows_sys::Win32::Foundation::CloseHandle(handle)` 释放内核对象，彻底消除了进程句柄泄漏隐患。

3. **G3（BOM 容忍与 components memo 稳定性）**：
   - **复核结论**：**已修复**。
   - **证据**：§4.2 统一采用宽松正则 `/^\uFEFF?\s*<!--\s*mdlog:v1/` 兼容 UTF-8 BOM 与前导空白；§3.5 的指纹提取同样使用包含 BOM 容忍的正则；且布尔原始值进入 `components` 依赖数组，在保证安全边界的同时，追加消息期间对象引用 100% 稳定。

---

## 五、建议项吸收复核

1. **权威预览页为 CSS 唯一真源**：
   - **已吸收**。§4.1 彻底删去与预览冲突的旧数值表，完全以 `docs/preview/mdlog-preview.html` 为唯一真源（`margin: 17px 0`、`padding: 7px 14px`、`font: 10px/1.5 var(--mono)`、描边仅在 frame 的 `border-top`、`min-height: 120px`），两处样式完全一致。
2. **400ms 滚动稳定判据**：
   - **已吸收**。§4.1 补充「滚动期间暂停淘汰；仅在稳定停止滚动 400ms 后才允许执行 LRU 淘汰挂载；被淘汰项重新进入视口时绝对不自动复活，必须显式点击唤醒」，彻底根治挂载/卸载震荡。
3. **降级责任主体分工**：
   - **已吸收**。§4.1 与 §8 明确划分：`MarkdownDocument` 的 `pre` 渲染器负责 512KB 长度预检并降级为普通 `CodeBlock`；`WidgetSandbox` 负责捕获 `invoke("register_widget")` 异常并渲染 fallback 传入的代码块。
4. **`mdlog-assets/` 资产清理策略**：
   - **已吸收**。§4.5 在 `config.json` 中增加 `assetRetentionMb: 200` 配置（默认 200MB），超出配额时写入器按文件的 `mtime` 最旧优先删除超出部分的历史图片。
5. **四反引号外层防截断**：
   - **已吸收**。§5.1 技能契约补充：正文若包含三反引号（`` ` ``），外层交互围栏必须使用四个反引号（```` ```` ```` ````），防止围栏意外截断。
6. **AGENTS.md 两处规约订正**：
   - **已吸收**。§10 改动清单补入 AGENTS.md 订正项：测试基线更新为 17 文件 / 175 用例；在「技能安装流程」中增补项目专属技能放置在项目内真实目录的例外与随仓库版本化理由。
7. **Rust 测试可注入性说明**：
   - **已吸收**。§9.2 将存活判定抽离为纯函数 `judge_mdlog_alive`（可注入 `pid_alive` 函数指针），协议响应构建抽离为纯函数 `build_widget_response`，支持无 GUI/OS 环境下对 404/200/CSP/Content-Type 的完整覆盖单测。
8. **wry 前缀匹配说明**：
   - **已吸收**。§4.3 补充说明 wry 的 `is_work_around_uri` 前缀匹配机制，使实现者明确外部同名主机名请求安全进入本地 handler 并返回 404 的原理。
9. **精确化 rehype-sanitize 描述**：
   - **已吸收**。§4.2 明确围栏 HTML 源码作为字符串原样交给沙箱渲染，整篇文档依然受完整的 sanitize 保护，Unified 管线不新增任何标签例外。

---

## 六、新发现问题与实施备忘

本轮定点复核中**未发现任何阻断（Blocker）或应当修复（Should-fix）问题**。设计规范 v3 在技术事实、平台边界与代码库现状上已高度自洽。

以下列出两点**实施注意事项（建议级 / Implementation Notes）**，供工作包 1～5 的子智能体直接参考：

1. **[实施提示] `App.tsx` 文档切换时的徽章清理与定时器重置**（建议级）：
   - **说明**：当用户从一份活跃 mdlog 切换至另一份普通文档（或切换至另一份尚未开始记录的 mdlog）时，`App.tsx` 应当主动清除前一份文档设置的 `expiresAt` 定时器并将 `isMdlogActive` 置为 `false`。spec §4.3 与 §4.7 已经确立了 Rust 侧注册表及存活状态与文档路径绑定的原则，在实现工作包 3 时，确保在 `loadPath` 切换文档成功的回调中重置相关定时器引用即可。
2. **[实施提示] Windows 平台 `OpenProcess` 权限位常量**（建议级）：
   - **说明**：Windows 平台下的 `PROCESS_QUERY_LIMITED_INFORMATION`（值 `0x1000`）已包含在 `windows-sys` 的 `Win32_System_Threading` 特性中（本项目 `Cargo.toml` 已引入）。在编写纯函数 `judge_mdlog_alive` 与系统调用绑定时，优先编写纯函数单元测试矩阵，确保覆盖进程存活、心跳超时、死亡回退等全部分支。

---

## 七、终审判定

`docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（v3）已全面、彻底地闭环了历史两轮审查提出的所有技术分歧与细节盲区。规范文字清晰严谨，排版公式与底层协议细节具备极高的工程确定性，完全符合「严格照字面实现即完全正确」的标准。

**终审判定：通过（Approved）**。

无需再进行文档层面的修改，可以直接作为输入进入实施阶段（工作包 1～5 的任务拆解与子智能体派发）。
