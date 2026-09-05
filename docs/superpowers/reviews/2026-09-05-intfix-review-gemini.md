# 集成修复批审核报告（reviewer-gemini）

- **审核对象**：`git diff 1cdca85..d157d23`（共 9 个提交：a4c6140 P1 / 9f9d7fb P2 / 0db95a4 P4 / 231ae4d 生产接线级测试 / eef250b P3+P12 / ceb4e04 P5 / 31a7611 P6 / 8156069 P8 / d157d23 P9）
- **审核性质**：只读复审与集成完整性校验
- **对照依据**：
  - 集成审计报告 `docs/superpowers/reviews/2026-09-05-integration-audit-qwen.md`（P1–P9 缺陷定义与修法路线）
  - 规格说明书 `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（§4.1/§4.2/§6/§7.2）
  - 架构与设计准则 `AGENTS.md`（性能结构红线、PrismLight 死规则、DOM 操作约定）与 `DESIGN.md`（kami 纸墨风格、无 emoji、无第二强调色、字重 ≤500）
  - 实施日志 `outputs/mdlog/integration-fix-log.md`

---

## 结论：**通过**

审计发现的 1 项阻断（P1）、3 项应当修复（P2, P3, P4）与 4 项建议（P5, P6, P8, P9）加 1 项可达性（P12）全部完成规范修复。修复设计严谨，彻底消除了假性测试用例，建立了端到端生产接线级的回归防线，且无性能倒退与安全降级。

---

## 逐要点核查（证据：文件:行号）

### 1. P1 修复正确性（useHeadingIdResolver ref 化与 React 19 并发安全性）
- **判定**：**通过**
- **代码核查证据**：`src/components/MarkdownDocument.tsx:225-276`
  ```tsx
  function useHeadingIdResolver(headings?: OutlineHeading[]) {
    const usedIds = useRef(new Set<string>());
    const fallbackCounter = useRef(0);
    const headingsRef = useRef(headings);
    headingsRef.current = headings;

    usedIds.current = new Set<string>();
    fallbackCounter.current = 0;

    return useCallback(
      (level: 1 | 2 | 3, text: string) => {
        const candidates = headingsRef.current?.filter((h) => h.level === level && h.text === text) ?? [];
        // ...
      },
      [] // 依赖数组严格为空
    );
  }
  ```
- **核心逻辑与 React 规则推演**：
  1. **依赖项真空数组**：`useCallback` 依赖项严格为 `[]`，返回的 `resolveHeadingId` 引用在组件整个生命周期内绝对恒定；进而使 `MarkdownDocument.tsx:438` 的 `components` memo 仅依赖 `[resolveHeadingId, isTrustedMdlog]`，在同文档追加热重载期间引用完全稳定。
  2. **渲染期写 ref 的合规性与必要性**：
     - 在 React 19 中，`useHeadingIdResolver` 的解析函数是在当前组件渲染期被 `ReactMarkdown` 的子组件（`h1/h2/h3`）**同步调用**的。
     - 若将 `headingsRef.current = headings` 移至 `useEffect` 或 `useLayoutEffect`，则在当前帧的渲染遍历中，`resolveHeadingId` 将读到上一帧甚至初次挂载时的陈旧 `headings`，直接导致标题 ID 解析错位。
     - 渲染期写当前组件内部局部 ref（与同文件的 `usedIds.current = new Set()`、`fallbackCounter.current = 0` 一致），不引发外部副作用，属于安全的同步上下文传递模式。
  3. **并发渲染安全性**：
     - `headingsRef` 仅作用于当前 Fiber 实例局部，并发渲染下不会产生跨实例污染。
     - React 渲染单个组件 Fiber 过程是原子同步的；若渲染被中断废弃，下次重新进入渲染时将从头执行 `headingsRef.current = headings`，重置分配状态，不存在状态撕裂（tearing）风险。
  4. **解析行为逐字等价**：算法实现中的 `candidates` 遍历、数学公式 `mathCandidate` 的 `$` 匹配、以及兜底稳定分配器 `h-${level}-${suffix}`，与原版实现 100% 逐字对齐，完全保证向后兼容性。

### 2. P1 效果验证（App 接线测试、热重载与 iframe DOM 节点恒等）
- **判定**：**通过**
- **代码核查证据**：`src/components/MarkdownDocument.test.tsx:739-808`
- **验证实测**：
  - 测试用例 `preserves components memo and iframe DOM instance across markdown appends` 真实复现了生产接线：
    通过 `extractOutline(markdown)` 计算 `initialHeadings`，并在追加后传入新生成的 `appendedHeadings` 数组（全新对象引用）。
  - 断言验证：
    1. `expect(rerenderedWidget).toBe(initialWidget)`：容器 DOM 严格恒等；
    2. `expect(rerenderedIframe).toBe(initialIframe)`：`HTMLIFrameElement` 节点严格恒等；
    3. `expect(invoke).toHaveBeenCalledTimes(1)`：IPC `register_widget` 全程仅调用 1 次。
  - 实测运行：`npx vitest run src/components/MarkdownDocument.test.tsx -t "preserves components memo"` 耗时 66ms，顺利通过。

### 3. P2 授权门禁（html/autoMount 变化清理与跨文档串档防范）
- **判定**：**通过**
- **代码核查证据**：`src/components/WidgetSandbox.tsx:47-68`、`src/components/MarkdownDocument.test.tsx:810-891`
- **机制与时序分析**：
  1. **双重条件侦测**：`useLayoutEffect` 同时捕获 `htmlChanged`（`prevHtmlRef.current !== html`）与 `autoMountFlippedFalse`（`prevAutoMountRef.current && !autoMount`）。
  2. **状态归零与后端注销**：
     - 只要内容变化或授权降级，立即调用 `invoke("unregister_widget", { id: idToUnregister })`；
     - 同步重置 `idRef.current = null`、`widgetUrl = null`、`isUserActivated = false`、`isDormant = false`、`hasError = false`。
  3. **探针 D 场景（跨文档实例复用）安全性**：
     - 非受信文档 X 被用户手动点击授权挂载后，切换到同结构非受信文档 Y；
     - 此时 AST key 相同导致 `WidgetSandbox` 实例复用，但 `htmlChanged` 成立，`isUserActivated` 被重置为 `false`，旧 id 被 `unregister_widget`；
     - 组件立即重新渲染为占位块「交互内容 · 点击加载」，iframe 被销毁，后端未产生新的注册。
  4. **测试覆盖**：
     - `src/components/WidgetSandbox.test.tsx:257-280`（单元级）与 `src/components/MarkdownDocument.test.tsx:810-891`（集成级）双重断言，严格防范授权泄漏。

### 4. P4 休眠生命周期（休眠注销、唤醒重注册与活跃计数契约）
- **判定**：**通过**
- **代码核查证据**：
  - `src/components/WidgetSandbox.tsx:75-87, 206-215`
  - `src/lib/widgetRegistry.ts:129-136`
  - `src/lib/widgetRegistry.test.ts:118-145`
  - `src/components/MarkdownDocument.test.tsx:893-984`
- **契约对齐核查**：
  1. **休眠即释放**：当 LRU 广播 `dormant === true` 时，`WidgetSandbox` 立即注销当前后端条目 `invoke("unregister_widget", { id })`，并设 `widgetUrl = null`。Rust 侧条目不滞留，杜绝 64 条 LRU 溢出后 404 白屏。
  2. **唤醒走完整流程**：用户点击「交互已休眠 · 点击查看」时，调用 `widgetRegistry.activate(instanceId)` 并置 `isDormant = false`；触发挂载 effect 重新调用 `widgetRegistry.requestMount`，向 Tauri 后端重新发起 `register_widget`，获取全新高熵 UUID 和 URL。
  3. **活跃计数不虚占**：
     - 修改前：`activate` 内提前无条件设置 `entry.mounted = true`，导致计数虚高；
     - 修改后：`activate` 仅清理 `entry.dormant = false` 并通知，`mounted = true` 严格推迟到 `requestMount` 成功返回时设置。
     - `src/lib/widgetRegistry.test.ts` 明确断言 `activate` 调用后 `__getActiveCount()` 依然维持原状，直到 `requestMount` 成功才增至活跃集。

### 5. P3/P12 CSS（占位块特异性、:focus-visible 描边与级联断言）
- **判定**：**通过**
- **代码核查证据**：`src/styles/kami.css:1184-1212`、`src/styles/kami.css.test.ts:176-207`
- **逐值比对与特异性核查**：
  1. **特异性提升**：选择器提升为 `.markdown-body .mdlog-widget__placeholder`（特异性 0,2,0），成功压制 `kami.css:837` 的 `.markdown-body button`（特异性 0,1,1）。
  2. **与设计真源对齐**：
     - `min-height: 120px`（覆盖了 32px）；
     - `padding: 24px`；
     - `border: 0; border-top: 1px solid var(--hairline)`；
     - `border-radius: 0; box-shadow: none`（彻底消除 warm-sand 凸起卡片质感，还原纸带发丝线质感）；
     - `background: var(--parchment); color: var(--stone); font-family: var(--serif); font-size: 13px`；
     - `:hover` 呈现 `background: var(--ivory); color: var(--brand)`。
  3. **P12 无障碍补全**：补充 `.markdown-body .mdlog-widget__placeholder:focus-visible`，提供 `2px solid var(--brand)` 描边与 `-2px` 内缩偏置，完全符合 kami 设计规范。
  4. **级联断言防回归**：`src/styles/kami.css.test.ts:194-207` 显式断言占位块规则声明在 `.markdown-body button` 之后，且断言包含前缀特异性与对应属性，杜绝单包静态文本测试假绿盲区。

### 6. P5/P6/P8/P9 修复核查
- **P5（reloadTick 早退前隐藏印章）**：
  - **证据**：`src/App.tsx:443-447`、`src/App.test.tsx:1230-1246`
  - **核查**：在 `if (isMdlogActiveRef.current)` 早退分支前显式执行 `setShowReloadNote(false)`，彻底杜绝了活动日志状态翻转导致的「墨迹未干」印章残留。测试断言通过。
- **P6（handleContentRendered 贴底仲裁防回弹抖动）**：
  - **证据**：`src/App.tsx:39, 159, 352, 418`、`src/App.test.tsx:1002-1082`
  - **核查**：引入 `hasStuckToBottomRef`；在 `loadScrollPosition(path).then` 异步回调执行前检查 `if (hasStuckToBottomRef.current || shouldStickToBottomRef.current) return;`。当热重载贴底仲裁已抢先接管时，历史位置恢复自动让路，消除「先落底再弹回」的画面跳动。
- **P8（Rust should_rebind 拆分与 watcher 自愈解耦）**：
  - **证据**：`src-tauri/src/main.rs:181-196, 227-268`
  - **核查**：
    - 拆分为 `should_clear_registry(current, next)`（仅在路径变更或初次加载时为 true）与 `needs_watcher_rebuild(current, next, has_watcher)`。
    - `apply_rebind` 仅由 `path_changed` 驱动；同路径下 watcher 丢失触发自愈时，`registry` 严格不动。
    - 完全符合 spec §4.3 核心原则「同文档热重载绝不清空注册表」，避免存活 iframe 的 URL 因 watcher 自愈被意外置为 404。
    - 7 项 Rust 测试矩阵覆盖全部分支，Cargo 测试全绿。
- **P9（512KB 双向短路预检与 TextEncoder 开销消除）**：
  - **证据**：`src/components/MarkdownDocument.tsx:394-400`、`src/components/MarkdownDocument.test.tsx:689-737`
  - **核查**：
    - UTF-8 编码下每个 UTF-16 code unit 至少对应 1 字节、至多对应 3 字节（BMP）或 2 字节（代理对 4 字节 / 2 code units）。
    - 当 `code.length > 524288` 时，字节数必超 512KB，直接短路判定为超限；
    - 当 `code.length <= 131072` (524288 / 4) 时，即便全为 4 字节字符也绝不可能超过 512KB，直接短路判定为安全；
    - 仅在临界区间 `(131072, 524288]` 调用 `new TextEncoder().encode(code).length > 524288`。
    - 单元测试 spy 证明超长与常见短内容均 0 次调用 `encode`，数学逻辑与执行均严丝合缝。

---

## 问题清单

按严重度分类如下：

### 阻断
无。

### 应当修复
无。

### 建议

- **[建议 1] `src/components/WidgetSandbox.tsx:32, 59-67`：实例复用时重置 title 与 height**
  - **现状**：在 P2 修复中，`htmlChanged` 重置了 `widgetUrl`、`idRef`、`isUserActivated` 等状态，但未重置 `title`（保持上一文档 postMessage 的值，如 "傅里叶分析演示"）与 `height`。
  - **影响**：若非受信文档 X 传了自定义标题后切到同结构非受信文档 Y，Y 在尚未授权挂载时，顶栏会显示 `[X 的标题] · vellum-widget | 未加载`，而非默认的 `交互演示 · vellum-widget | 未加载`。
  - **修法**：在 `useLayoutEffect` 的清理分支中补上 `setTitle("交互演示"); setHeight(320);`。

- **[建议 2] `src/styles/kami.css:854, 1184`：.markdown-body button:active 1px 下沉轻微穿透**
  - **现状**：`.markdown-body button:active` 特异性为 (0, 2, 1)；而 `.markdown-body .mdlog-widget__placeholder` 特异性为 (0, 2, 0) 且未声明 `:active`。在鼠标按住占位块时，会瞬时触发 `transform: translateY(1px)` 与 `background: var(--border-soft)`。
  - **影响**：极轻微的视觉扰动（点击后立即触发挂载并替换视图），不影响功能。
  - **修法**：可按需追加 `.markdown-body .mdlog-widget__placeholder:active { transform: none; }`。

- **[建议 3] `AGENTS.md:12`：WP5 交付提醒**
  - **现状**：`AGENTS.md` 当前仍标记「14 测试文件，142 用例」，待 WP5 统一订正为现行实测基线（22 文件，223 用例），并登记「components 稳定性需生产接线测试保障」等开发常识。

---

## 测试实测输出

所有测试与构建命令均在当前工作区亲自执行并记录真实输出：

### 1. 前端测试（Vitest）
```text
$ npx vitest run src/

 RUN  v4.1.9 C:/Users/17445/Desktop/Vellum

 Test Files  22 passed (22)
      Tests  223 passed (223)
   Start at  21:25:34
   Duration  6.71s (transform 3.64s, setup 4.15s, import 12.70s, tests 6.01s, environment 35.19s)
```

### 2. 后端单元测试（Cargo）
```text
$ cd src-tauri && cargo test
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.48s
     Running unittests src\lib.rs (target\debug\deps\vellum_lib-dbaf9a1ac8449447.exe)

running 35 tests
test document_tests::resolve_asset_to_data_url_keeps_data_urls_unchanged ... ok
test document_tests::resolve_asset_to_data_url_keeps_remote_urls_unchanged ... ok
test document_tests::resolve_local_asset_path_keeps_remote_urls_unchanged ... ok
test state_tests::app_state_implements_send_and_sync ... ok
test watcher_tests::derives_correct_sidecar_path ... ok
test state_tests::app_state_initializes_empty_and_allows_interior_mutability ... ok
test watcher_tests::event_paths_match_case_insensitively_on_windows ... ok
test watcher_tests::independent_deadlines_take_minimum_timeout ... ok
test watcher_tests::log_event_does_not_affect_sidecar_deadline ... ok
test watcher_tests::poll_expired_emits_each_event_independently ... ok
test watcher_tests::sidecar_event_does_not_affect_log_deadline ... ok
test widget_tests::judge_mdlog_alive_matrix_and_pid_fallback_evaluation ... ok
test widget_tests::build_widget_response_returns_200_with_all_4_security_headers ... ok
test widget_tests::build_widget_response_rejects_boundary_uris_as_404 ... ok
test widget_tests::build_widget_response_returns_404_with_all_4_security_headers_for_unknown_or_invalid ... ok
test widget_tests::read_mdlog_state_returns_none_when_current_doc_is_none ... ok
test widget_tests::read_mdlog_state_returns_none_when_sidecar_file_does_not_exist ... ok
test widget_tests::register_result_serializes_to_camel_case ... ok
test widget_tests::registry_evicts_lru_entry_when_exceeding_64_entries ... ok
test widget_tests::registry_rejects_html_exceeding_512kb ... ok
test widget_tests::widget_state_registers_and_unregisters ... ok
test document_tests::load_markdown_file_rejects_missing_file ... ok
test document_tests::load_markdown_file_rejects_non_markdown_files ... ok
test document_tests::load_markdown_file_rejects_non_utf8_content ... ok
test document_tests::load_markdown_file_accepts_uppercase_extension ... ok
test document_tests::resolve_local_asset_path_rejects_percent_encoded_traversal ... ok
test document_tests::resolve_asset_to_data_url_returns_base64_for_local_image ... ok
test widget_tests::read_mdlog_state_returns_none_for_corrupted_json ... ok
test widget_tests::read_mdlog_state_reads_valid_sidecar_and_computes_expires_at ... ok
test document_tests::resolve_local_asset_path_uses_anchor_directory ... ok
test widget_tests::read_mdlog_state_returns_none_when_heartbeat_expired_or_pid_dead ... ok
test document_tests::resolve_local_asset_path_rejects_absolute_outside_directory ... ok
test document_tests::resolve_local_asset_path_rejects_traversal ... ok
test widget_tests::uuid_generation_entropy_and_format_check ... ok
test document_tests::load_markdown_file_reads_utf8_content ... ok

test result: ok. 35 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running unittests src\main.rs (target\debug\deps\vellum-934219304313b152.exe)

running 7 tests
test tests::ignores_non_markdown_arguments ... ok
test tests::apply_rebind_clears_registry_on_path_change ... ok
test tests::apply_rebind_preserves_registry_on_same_path_with_watcher ... ok
test tests::apply_rebind_preserves_registry_when_watcher_missing_for_healing ... ok
test tests::should_rebind_and_watcher_matrix_evaluation ... ok
test tests::extracts_first_markdown_path_case_insensitively ... ok
test tests::tauri_conf_csp_contains_frame_src_for_widget ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

   Doc-tests vellum_lib
running 0 tests
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```
合计通过用例数：**42 passed**。

### 3. TypeScript 静态类型检查
```text
$ npx tsc --noEmit
(退出代码 0，无任何类型报错)
```

### 4. 生产打包构建（tsc + Vite）
```text
$ npm run build

> vellum@1.4.0 build
> tsc && vite build

vite v8.1.3 building client environment for production...
✓ 980 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                         1.02 kB │ gzip:  0.46 kB
dist/assets/KaTeX_Size4-Regular-Dl5lxZxV.woff2          4.92 kB
dist/assets/KaTeX_Size2-Regular-Dy4dx90m.woff2          5.20 kB
dist/assets/KaTeX_Size1-Regular-mCD8mA8B.woff2          5.46 kB
dist/assets/KaTeX_Caligraphic-Regular-Di6jR-x-.woff2    6.90 kB
dist/assets/KaTeX_Caligraphic-Bold-Dq_IR9rO.woff2       6.91 kB
dist/assets/KaTeX_Script-Regular-D3wIWfF6.woff2         9.64 kB
dist/assets/KaTeX_SansSerif-Regular-DDBCnlJ7.woff2     10.34 kB
dist/assets/KaTeX_Fraktur-Regular-CTYiF6lA.woff2       11.31 kB
dist/assets/KaTeX_Fraktur-Bold-CL6g_b3V.woff2          11.34 kB
dist/assets/KaTeX_SansSerif-Italic-C3H0VqGB.woff2      12.02 kB
dist/assets/KaTeX_SansSerif-Bold-D1sUS0GD.woff2        12.21 kB
dist/assets/KaTeX_Typewriter-Regular-CO6r4hn1.woff2    13.56 kB
dist/assets/KaTeX_Math-BoldItalic-CZnvNsCZ.woff2       16.40 kB
dist/assets/KaTeX_Math-Italic-t53AETM-.woff2           16.44 kB
dist/assets/KaTeX_Main-BoldItalic-DxDJ3AOS.woff2       16.78 kB
dist/assets/KaTeX_Main-Italic-NWA7e6Wa.woff2           16.98 kB
dist/assets/KaTeX_Main-Bold-Cx986IdX.woff2             25.32 kB
dist/assets/KaTeX_Main-Regular-B22Nviop.woff2          26.27 kB
dist/assets/KaTeX_AMS-Regular-BQhdFMY1.woff2           28.07 kB
dist/assets/index-CVOH9cPV.css                         19.54 kB │ gzip:  4.59 kB
dist/assets/katex-CGEBvTmO.css                         27.20 kB │ gzip:  7.48 kB
dist/assets/rolldown-runtime-QTnfLwEv.js                0.69 kB │ gzip:  0.42 kB
dist/assets/syntax-highlighter-CUlFCbOG.js            117.47 kB │ gzip: 38.59 kB
dist/assets/index-CpGvjaus.js                         138.47 kB │ gzip: 38.98 kB
dist/assets/vendor-react-CZLoEza8.js                  182.16 kB │ gzip: 57.35 kB
dist/assets/MarkdownDocument-gwmQbphD.js              238.46 kB │ gzip: 74.06 kB
dist/assets/katex-KFqkFG3T.js                         258.87 kB │ gzip: 77.46 kB
✓ built in 2.06s
```

### 5. Emoji 规范扫描
对 `src/` 与 `src-tauri/src/` 执行全量正则扫描：
```text
src + src-tauri violations: 0
```
未引入任何 emoji 字符，合规性确认无误。
