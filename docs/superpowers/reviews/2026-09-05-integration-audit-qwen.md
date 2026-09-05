# 集成审计报告（reviewer-qwen）

- **审计对象**：`HEAD = 0a149c1`（即 `git diff 4a32de0..HEAD` 三包合并态：WP1 Rust 后端 / WP2 widget 前端渲染 / WP3 App 实时行为）
- **审计性质**：跨包集成对抗审计（只读；除本报告外未修改任何仓库文件）
- **审计时间**：2026-09-05 20:33–20:50（+0800）
- **方法**：现状代码逐条红线核对 + 6 组对抗场景探针（Vitest/jsdom 真实渲染，探针文件临时置于 `outputs/__audit_scratch/`，**运行后已全部删除，`git status` 已复核无残留**）+ 全量 `npm test` / `cargo test` 实跑

> **并发写入告知**：审计期间（20:41 / 20:42）有另一进程在工作区修改了 `src/App.tsx` 与 `src/App.test.tsx`（未提交）。本报告所有行号与结论**以 HEAD 提交态为准**；涉及在途改动的地方已单独标注。

---

## 结论：**驳回**

发现 **1 项阻断**、**4 项应当修复**、若干建议。核心问题是一个**只有跨包视角才能看到的接缝缺陷**：WP2 的「iframe 跨热重载存活」契约建立在「`components` 引用稳定」之上，而 App 的真实接线（`headings` 随 markdown 重算）使该引用**每次热重载都变化**——WP2 自带的回归测试因未传 `headings` 而**假性通过**。该缺陷同时**掩盖**了第二个缺陷（实例复用导致的授权跨文档残留与内容串档），因此两项必须同一批修复。

---

## 1. 红线核查表（AGENTS.md / DESIGN.md，逐条对照现状代码）

| # | 红线 | 判定 | 证据 |
|---|------|------|------|
| R1 | `components` prop 必须是 `useMemo` 结果 | **形式合规 / 实质违规** | `MarkdownDocument.tsx:324,414` 确为 useMemo，但依赖 `resolveHeadingId`，后者 `useCallback` 依赖 `[headings]`（`MarkdownDocument.tsx:233,271`）；App 侧 `headings` 在 markdown 变化时必然重建（`App.tsx:498-501`）→ 每次热重载 `components` 及其内部 `pre/h1/img` 函数**引用全变** → React 判定类型变更 → 整棵渲染子树重挂载。实测见探针 B |
| R2 | memo 化 `MarkdownBody` 的 props 引用稳定 | 合规（但被 R1 连带击穿） | `MarkdownDocument.tsx:296-303`；`markdown/headings/searchQuery` 仅在真正需要重解析时变化 |
| R3 | `search-match--current` 由 layout effect 操作 DOM 维护，不放回 rehype 参数 | 合规 | `MarkdownDocument.tsx:98,456,469,508`；探针 F 证实搜索切换不重挂载 widget |
| R4 | katex 位于 rehype 管线末尾（sanitize、高亮之后） | 合规 | `MarkdownDocument.tsx:311 sanitize → 315 search → 318 katex`，注释齐全 |
| R5 | 搜索删除 300ms debounce + 视口内不滚动；`searchQueryPending` 门禁 | 合规（三包均未触碰） | `MarkdownDocument.tsx:462-505` |
| R6 | 大纲对所有正文滚动始终跟随，不得增设门禁 | 合规 | `useOutlineSync.ts` 未改动（diff 未含 `src/hooks/`）；WP3 未加门禁；贴底走 `animateScrollTo` 同一套缓动 |
| R7 | 阅读位置记忆＝锚点+偏移+比例兜底；不得改回一次性 ratio×scrollHeight；落位守护不得弱化 | **合规但被复用为两把刀** | `scrollRestore.ts` 未改；`App.tsx:403-411` 贴底守护复用同一 `restoreScrollPosition({ratio:1})`，事件集（wheel/touchstart/keydown/5s/取消函数）与 spec §4.6 逐字对齐；但见 J2/S5：同一 `restoreCancelRef` 存在两条写入路径的仲裁窗口 |
| R8 | `CodeBlock` 必须 `PrismLight`，禁切 `PrismAsyncLight` | 合规 | `CodeBlock.tsx` 未改动；`language-([\w-]+)` 放宽后未注册语言仍走安全降级（测试 `MarkdownDocument.test.tsx` objective-c 用例通过） |
| R9 | 侧栏布局：搜索框在滚动区外 | 合规 | `OutlinePanel.tsx` 未改动 |
| R10 | 无 emoji（全 src 扫描） | 合规 | 以 `\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}` 区间脚本扫描 `src/`、`src-tauri/src/` → **0 命中**；新增文案「记录中 · PI」「交互内容 · 点击加载」「交互已休眠 · 点击查看」「沙箱中运行」「准备中」「交互准备中…」均无 emoji（`…` 与既有 `寻章…` 一致） |
| R11 | DESIGN.md 色板 / 字重 / 圆角 | **规则文本合规，实际呈现违规** | `kami.css:1155-1235` 新增块全部只用 `var(--*)`，圆角 ∈ {6px, 1px}，无 `font-weight > 500`，`prefers-reduced-motion` 豁免到位（`.mdlog-live::before`）；但见 **P3**：`.markdown-body button`（`kami.css:837`）以更高特异性压制 `.mdlog-widget__placeholder`（`kami.css:1184`），实际渲染成 32px 高的 warm-sand 凸起卡片，而非设计真源的 120px 发丝线纸带 |

---

## 2. 接缝场景推演（构造 → 实测/推演 → 结论）

### J1 【热重载 × components 重建】iframe 是否被重挂载？——**会被重挂载（实测）**

- **构造**：模拟 App 真实接线（`<MarkdownDocument markdown headings>`，`headings = useMemo(extractOutline, [markdown])`），受信任 mdlog 文档内放 1 个 `vellum-widget`，触发 3 次 append-only 热重载；对 `register_widget/unregister_widget` 计数。
- **实测（探针 A/B）**：
  - **B（App 现状接线）**：`sameContainer: false, sameIframe: false, register: 4, unregister: 3`（3 次追加）——**每次热重载 widget 容器与 iframe 全部销毁重建**，状态栏回到「准备中」再回到「沙箱中运行」。
  - **A（唯一变量：`headings` 引用恒定）`: sameIframe: true, register: 1`** —— 证明致因就是 `headings` 引用经 `resolveHeadingId` 传导进 `components`。
  - **对照组（WP2 自带测试写法，不传 `headings`）：`sameIframe: true, register: 1`** —— 解释了 `MarkdownDocument.test.tsx:678` 为何假性通过（该测试不传 `headings`，与生产接线不一致）。
- **结论**：**违反 spec §4.1 与 §6 的硬承诺**（「已有 iframe 保持位置稳定，不发生重载与交互状态丢失」）。生产后果：活跃会话中每 ~400ms–2s 一次追加就打断一次交互（用户在 widget 里拖过的滑块/填过的表单/播放中的动画全部复位），并产生持续的 `register_widget`/`unregister_widget` IPC churn 与 UUID 抖动。
- **附带事实（供定位）**：`hast-util-to-jsx-runtime` 的 key 是 `tagName-count`（`node_modules/hast-util-to-jsx-runtime/lib/index.js:549-565`，react-markdown 10.1.0 设 `passKeys: true`，`node_modules/react-markdown/lib/index.js:354`）。实测三篇结构不同文档的 key 序列：`pre-0` 在不同文档间**完全相同** → 一旦 `components` 引用稳定，跨文档实例复用必然发生（见 J3）。

### J2 【贴底跟随 × 阅读位置恢复】同一 layout effect 的仲裁顺序

- **构造**：打开「有记忆位置的旧文档」且它恰是活跃 mdlog（pi 正在写）。
- **推演（HEAD `App.tsx`）**：
  1. 首次打开：`loadPath` 显式 `shouldStickToBottomRef.current = false`（`App.tsx:144`）→ 贴底分支不进 → `handleContentRendered`（`App.tsx:325-341`）走 `restoreScrollPosition(record)`。**记忆位置赢**。
  2. 热重载：`reloadCurrent`（`App.tsx:186-189`）按当前几何判定贴底 → layout effect（`App.tsx:391-418`）先取消旧守护（`restoreCancelRef.current?.()`）再建 `{ratio:1}` 守护。**贴底赢**。
- **结论**：**仲裁语义正确且符合 spec §4.6**（贴底只属于热重载路径，首次打开以阅读位置记忆为准；两者不会同时争抢同一帧）。
- **残留竞态（建议级，见 P6）**：`handleContentRendered` 的 `loadScrollPosition(path).then(...)` 是异步的（`App.tsx:333-341`）。若在「首次打开 → promise resolve」窗口内到达一次 `file-changed`，layout effect 先建立贴底守护，随后 `.then` 回调会 `restoreCancelRef.current?.()` 把贴底守护**取消并替换为记忆位置守护**，页面回跳到旧位置。方向上仍属「记忆优先」，不致数据损坏，但会表现为「打开活跃日志时先掉到底部再弹回」的一次抖动。

### J3 【实例复用 × 授权门禁】切文档会不会串档 / 免点击挂载？——**当前被 J1 掩盖，修好 J1 后立刻显性化（实测）**

- **构造（探针 D，模拟「`components` 已引用稳定」的世界）**：非受信文档 X（含 widget）→ 点击「交互内容 · 点击加载」授权 → 切到另一篇非受信文档 Y（同结构）。
- **实测**：`yHasPlaceholder: null`、`yIframeSrc: "http://vellum-widget.localhost/id-X-c"`、`yBarText: "…沙箱中运行"`、`register: 1, unregister: 0`。
  → **Y 未出现任何授权占位块，直接以「沙箱中运行」姿态显示了 X 文档的 widget 内容**（授权状态 `isUserActivated` 与 `widgetUrl` 随实例残留；Y 自己的 html 从未注册）。这违反 spec §7.2「只有用户明确信任**该文档**并主动点击后才 `register_widget`」。
- **对照（探针 E）**：受信 A → 非受信 B 时，因 `isTrustedMdlog` 布尔翻转使 `components` 重算 → 重挂载 → B 正确回落占位块。即「受信→非受信」方向目前安全，**纯属 J1 副作用的巧合**。
- **结论**：J1 与 J3 是**耦合缺陷**——只修 J1（稳定引用）而不给 WidgetSandbox 加「`html` 变化 / `autoMount` 翻 false 时释放并清零状态」的逻辑，会**当场把一个性能缺陷升级成安全门禁缺陷**。

### J4 【休眠 → 唤醒】是否重新注册？Rust 侧条目是否释放？——**两者都不（实测）**

- **构造（探针 C）**：挂载 → 用 11 个其他条目挤爆 LRU → 400ms 后淘汰休眠 → 点击「交互已休眠 · 点击查看」唤醒。
- **实测**：`dormantText: "交互已休眠 · 点击查看"`；唤醒后 `sameUrl: true`、`register: 1`（未新增）、**`unregisterWhileDormant: 0`**。
- **推演后果**：
  1. 休眠期间 Rust 条目（`widget.rs:19 MAX_REGISTRY_CAPACITY = 64`，单条 ≤512KB）持续占用 → 最坏 64×512KB ≈ 32MB 常驻内存不回收；
  2. 一旦累计注册数越过 64 触发 Rust LRU 淘汰，被淘汰的休眠项被唤醒后仍指向**旧 URL**（`WidgetSandbox.tsx:88` 因 `widgetUrl` 非空直接早退，不重新注册），而协议侧此时返回 404 → 子帧显示 "Not Found" 白屏，且**用户无论怎么点都无法恢复**（除非切文档）。
  3. WP2 现有测试 `WidgetSandbox.test.tsx:"renders dormant placeholder and reactivates upon click"` 只断言 iframe 重新出现，且 invoke 是 mock（同一 URL 恒定有效），**结构上无法发现该缺陷**。

### J5 【Rust 注册表清空 × 前端 iframe 存活】切文档时序

- **推演**：`loadPath(B)` → `load_document`（`main.rs:157-183`）在 `current→watcher→widget` 单临界区内判 `should_rebind` → 路径变化才 `registry.clear()` → 返回 B → React 提交新树 → 旧 WidgetSandbox 卸载并 `unregister_widget(旧 id)`（对已清空表为幂等 no-op）。旧 iframe 在「清空之后、卸载之前」仍持有**已加载的文档**（已渲染帧不会自行重取 URL），故**不会出现 404 白屏闪跳**；`register_widget` 的响应若在卸载后才到达，`isCancelled` 分支会补发 `unregister_widget`（`WidgetSandbox.tsx:96-104`），无孤儿条目。**该接缝本身成立**。
- **但两个前提值得记下**：
  1. 该「不闪白」依赖 J1 的重挂载；若按建议修好 J1，则必须同时修 J3/J4，否则变成「B 文档显示 A 的 widget」的内容串档（比白屏更糟）。
  2. `load_document` 的 `should_rebind` 含 `|| !has_watcher`（`main.rs:223-227`）：**若某次 `watch_file` 失败**（`main.rs:176-179` 仅 `eprintln!`），后续**同文档热重载**会被判为 rebind → **清空注册表**，与「同文档热重载绝不清空」的 spec §4.3 承诺相反，存活 iframe 的 URL 全部失效。属自愈逻辑的副作用，建议把「watcher 缺失自愈」与「registry 清空」解耦（见 P8）。

### J6 【徽章复查调度】计时器泄漏猎捕

- **卸载**：`App.tsx:448-476` 的 effect cleanup 清 `recheckTimerRef` ✓（HEAD 缺的是 `restoreCancelRef` 的卸载清理，见 P7——工作区在途改动已补）。
- **快速连切两个 mdlog 文档**：`loadPath` 开头清计时器 + `setMdlogState(null)` + `shouldStickToBottomRef=false`（`App.tsx:135-147`）✓；`scheduleRecheck` 自身先 clear 再 arm（`App.tsx:104-111`）→ 全局恒仅 1 枚计时器 ✓。
- **在途回调跨越切档**（HEAD）：计时器回调内的 `await read_mdlog_state` 不校验路径（`App.tsx:112-123`）→ 可能把**后一篇文档**的状态写给前一篇的调度链。因为命令以 `AppState.current` 为唯一锚（无前端参数），**不会读出串档数据**，只是多一次等价写入；工作区在途改动已补 `expectedPath` 校验。
- **mdlog 记录中直接关窗**：`beforeunload → persistCurrentScroll()`（`App.tsx:377`，未被 mdlog 门禁拦截）✓；Rust 侧靠 pid+心跳仲裁残局 ✓。
- **忙轮询风险**：`computeRecheckDelay` 已 clamp 到 `2^31-1`（`mdlogState.ts:12-16`），且 Some 分支恒有 `expiresAt > now`（`widget.rs: judge_mdlog_alive` 要求 `heartbeat_at <= now`），**不存在 0 延时空转** ✓。
- **结论**：计时器面**合规、无泄漏**；仅 J2 的守护取消竞态与「reloadTick 早退导致印章可能常驻」两处建议（P5/P6）。

---

## 3. 安全模型核查（spec §7 逐条 + 绕过路径搜索）

| 条款 | 判定 | 证据 |
|------|------|------|
| `sandbox="allow-scripts"`，绝不含 `allow-same-origin` | 合规 | `WidgetSandbox.tsx:216` |
| `referrerpolicy="no-referrer"` | 合规 | `WidgetSandbox.tsx:217`（测试断言属性名小写生效） |
| 协议四条强制响应头，200/404/非 GET 全覆盖 | 合规 | `widget.rs:122-135 apply_security_headers`，`137-160` 三个分支全部经它；`widget_tests.rs` 四条断言实跑通过 |
| 仅 GET；未知 id / 越界 / 带查询串一律 404（fail-closed） | 合规 | `widget.rs:98-120 extract_widget_id`（含 `//` 分支与「故意不剥 `?`」注释）；错误体为固定字面量，无 id 反射 → 无 XSS 面 |
| 128-bit 高熵 UUID，不可遍历 | 合规 | `widget.rs:270 uuid::Uuid::new_v4()`；`widget_tests::uuid_generation_entropy_and_format_check` |
| 前端不得反推 URL 得 id | 合规 | `WidgetSandbox.tsx:99-101` 仅存 `res.id` 于 `idRef`，`src` 只用 `res.url` |
| postMessage 来源严格校验 + [80,2000] clamp + rAF 节流 | 合规 | `WidgetSandbox.tsx:122-152`；`event.source !== iframe.contentWindow` 直接 return；rAF 前 `cancelAnimationFrame` 去抖；卸载时清 rAF ✓ |
| 严禁读 `iframe.contentDocument.title` | 合规 | 全文无 `contentDocument` 访问，标题只来自 `data.title` |
| `read_mdlog_state` 无前端入参、锚定 `AppState.current` | 合规 | `widget.rs:305-330`；无任何路径参数可达 |
| 资源目录锚定（`resolve_asset` 以当前文档父目录为锚，拒绝越界/百分号编码越界） | 合规 | `main.rs:196-213` + `document_tests`（4 项越界用例实跑通过） |
| CSP `frame-src http://vellum-widget.localhost` 精确单值 | 合规 | `tauri.conf.json:26`，并由 `main.rs` 内 `tauri_conf_csp_contains_frame_src_for_widget` 逐字断言（防漂移，做得好） |
| `rehype-sanitize` 不为 widget 开任何标签例外 | 合规 | `kamiSchema` 无新增；`pre` 分支把 html 当**字符串**传下去（`MarkdownDocument.tsx:388-399`） |
| **非受信文档必须逐文档显式点击授权** | **存在绕过路径** | 见 J3（探针 D）：授权态 `isUserActivated` 与 `widgetUrl` 挂在组件实例上，而实例复用仅靠 `components` 引用不稳定「偶然」被阻止 → 修 J1 时必须一并加「`html`/`autoMount` 变化即释放并回到未授权态」 |
| 子帧自导航残余风险 | 合规（spec §7.1 明确接受） | 无额外实现 |
| 意图标识可被伪造 | 合规（spec §7.2 明确接受为 heuristic） | `MarkdownDocument.tsx:299-303` 与 spec 正则逐字一致（含 BOM/前导空白容忍） |
| **协议响应体不受任何长度约束** | 提示 | 单条 ≤512KB 已在注册侧限死，`build_widget_response` 每次 `html.as_bytes().to_vec()` 复制一份 → 10 个 iframe 并发首取时瞬时峰值 ≈ 5MB 级别，可接受 |

---

## 4. 规格偏差清单（实现 vs spec 字面）

| spec 条款 | 实现 | 判定 |
|-----------|------|------|
| §4.1 `WidgetRegistry.subscribe(id, onDormant)` / `activate(id): boolean` | `subscribe(cb)`、`activate(id): void`（`widgetRegistry.ts:6-8`） | 偏差（功能等价且更合理，建议回写 spec 或注释说明） |
| §4.2 超限降级 `<CodeBlock language="html">`；IPC 失败降级渲染 `fallback` prop | `language=""`（实际标签显示 `text`，`MarkdownDocument.tsx:390`）；IPC 失败内部渲染 `language="xml"`（`WidgetSandbox.tsx:155-157`） | 偏差 + **两条同义降级路径标签不一致**（`""` vs `xml`），建议统一为 `html` |
| §4.2 长度预检 `code.length > 524288` | 改为字节数 `new TextEncoder().encode(code).length`（`MarkdownDocument.tsx:389`） | 偏差但**更正确**（与 Rust `html.len()` 字节判定对齐）；代价见 P9 |
| §4.3 `OpenProcess` 失败时「调用 `GetExitCodeProcess` 二次复核」 | 仅在 `OpenProcess` **成功**后调用 `GetExitCodeProcess`；失败时按 `ERROR_ACCESS_DENIED/SHARING_VIOLATION` 降级为 true，其余 false（`widget.rs:172-200`） | 语义偏差（实现更符合 G2 意图且 fail-closed 更严，WP1-fix 已在注释中声明 A1 决议）→ 记为已记录偏差，建议在 spec 回写 |
| §4.3 「注册表仅当 canonical 路径改变时清空」 | `should_rebind` 额外含 `!has_watcher` | 见 J5-2（P8） |
| §9.1 基线「17 文件 / 175 用例」「15 个 cargo 用例」 | 实测 22 文件 / 211 用例；cargo 41 用例 | 超出计划（非违规）；但 `AGENTS.md` 仍写「14 测试文件，142 用例」——spec §10 要求的基线订正**未做**（属 WP5，见 P10） |
| §5 `.pi/skills/vellum-mdlog/` | 目录不存在（`.pi/skills/` 下无该项） | WP5 交付缺口（不在本次三包范围，登记提醒） |
| §7/§4.6 全部落实项 | 心跳/双路防抖/CloseHandle/CSP/无参锚定/守护事件集 | 逐条核对**已落实** |

---

## 5. 问题清单（按严重度）

### 阻断

- **[阻断] P1 `src/components/MarkdownDocument.tsx:414`（配合 `:233,271`）+ `src/App.tsx:498-501`**
  `components` 的 `useMemo` 依赖 `resolveHeadingId`，而后者依赖 `headings` 数组引用；App 每次 markdown 变化都重算 `headings` → `components` 及其中的 `pre/h1/img/code` 函数**每帧新引用** → React 判为组件类型变更 → **WidgetSandbox 连同 iframe 在每次热重载被强制销毁重建**（探针 B：`sameIframe:false`、3 次追加引发 `register×4 / unregister×3`）。
  **理由**：直接推翻 spec §4.1/§6 的「append-only 期间 iframe 实例与交互状态完全保留」承诺，使 mdlog 交互块在实际使用中不可用；同时违反 AGENTS.md 性能死规则中「`components` prop 必须保持引用稳定」的**本意**（不只是形式）。修复方向：`useHeadingIdResolver` 改为经 ref 读取 `headings`（`useCallback(…, [])`），或让 App 的 `headings` 在大纲内容未变时保持引用（两者可同时做，前者更稳）。**必须与 P2/P4 同批处理**（见 J3）。

### 应当修复

- **[应当修复] P2 `src/components/WidgetSandbox.tsx:85-116,155-199`**
  组件状态（`widgetUrl`/`idRef`/`isUserActivated`/`isDormant`）跨 `html` 与 `autoMount` 变化存活：
  (a) `html` 就地被改写时 `:88` 因 `widgetUrl` 非空**直接早退，永不重新注册** → iframe 永远显示旧内容（探针：`src1 === src2`）；
  (b) `isUserActivated` 跨文档残留 → 非受信文档可**免点击自动挂载**且显示上一篇文档的 widget（探针 D，`yIframeSrc` 仍是 X 的 URL、`register:1`）——spec §7.2 授权门禁被绕过。
  **理由**：当前被 P1 的重挂载偶然掩盖；修 P1 后即刻显性化。修法：`html` 或 `autoMount` 变化时 `invoke("unregister_widget", 旧 id)` + `setWidgetUrl(null)` + （`autoMount === false` 时）`setIsUserActivated(false)`；或在 `<WidgetSandbox key>` 上绑定 `html` 的稳定散列以显式声明「内容变即换实例」。

- **[应当修复] P3 `src/styles/kami.css:1184-1204` 被 `kami.css:837-858` 级联压制**
  占位块是 `.markdown-body` 内的 `<button>`，`.markdown-body button`（特异性 0,1,1）在 `min-height/padding/background/box-shadow/border-radius/color/transition` 上全部胜过 `.mdlog-widget__placeholder`（0,1,0）；`:hover` 同理（0,2,1 > 0,2,0）。实际渲染为 **32px 高、warm-sand 底、内描边、按下下沉 1px 的凸起按钮**，而非设计真源（`docs/preview/mdlog-preview.html`）的 120px 发丝线纸带；`border-top: 1px solid var(--hairline)` 也被 `border: 0` 吃掉。
  **理由**：这是 widget 唯一的**授权入口**，视觉与设计语言双双失守；且 `kami.css.test.ts:155-182` 只断言规则文本，**结构上无法发现级联冲突**（解释了单包审核为何漏过）。修法沿用仓库既有惯例：`.markdown-body .mdlog-widget__placeholder { … }`（对照 `.code-block .code-block__copy` 的同型处理，`kami.css:1051`）。

- **[应当修复] P4 `src/components/WidgetSandbox.tsx:163-179` + `src-tauri/src/widget.rs:19`**
  LRU 休眠时不 `unregister_widget`、唤醒时不重新 `register_widget`（探针 C：`unregisterWhileDormant: 0`、`register` 总数仍为 1、URL 原样复用）。
  **理由**：① 休眠项在 Rust 侧持续占内存（最坏 64×512KB）；② 一旦被 Rust 64 条 LRU 淘汰，唤醒后 iframe 指向已 404 的 URL → 白屏且不可恢复；③ `requestMount` 失败（dormant 门禁，`widgetRegistry.ts:112-116`）时 `activate` 已把 `mounted` 置真，活跃计数被虚占。修法：进入休眠即 `unregister` 并清 `widgetUrl`；唤醒走完整注册流程（顺带解决 P2 的一半）。

### 建议

- **[建议] P5 `src/App.tsx:420-433`（HEAD）** 当 `isMdlogActive` 为真时 `[reloadTick]` effect 提前 `return`，既不清 `fresh-ink` 也不注册 2800ms 的 `setShowReloadNote(false)` 计时器；若印章正显示时 mdlog 变为活跃（下一次 `reloadTick` 变化会 clearTimeout 旧计时器后又早退），「墨迹未干」将常驻。修法：早退前 `setShowReloadNote(false)`。
- **[建议] P6 `src/App.tsx:333-341` vs `:396-411`** 记忆恢复的异步 `.then` 可覆盖并取消刚建立的贴底守护（J2 残留竞态）。修法：`.then` 内先判 `shouldStickToBottomRef`/本轮是否已发生贴底仲裁，或给两条守护加来源标记。
- **[建议] P7 `src/App.tsx:52,336,404`（HEAD）** `restoreCancelRef` 无组件卸载清理（ResizeObserver + window `keydown` 监听在 App 生命周期内不回收）。**注**：工作区未提交改动（20:41）已加 `useEffect(() => () => restoreCancelRef.current?.(), [])`，请以该版本为准复核。
- **[建议] P8 `src-tauri/src/main.rs:223-227`** `should_rebind` 把「watcher 缺失」与「路径变化」并列为清空注册表的条件，与 spec §4.3 字面不符（J5-2）。修法：拆分两个判定，watcher 自愈不动 registry。
- **[建议] P9 `src/components/MarkdownDocument.tsx:389`** 每个 widget 块**每次渲染**都做一次 `TextEncoder().encode(整段 html)`；长会话（数十个 widget）下每轮热重载的开销与总 widget 字节数线性相关。修法：先 `code.length > 524288` 短路（字符数超必超），仅在临界区间才编码。
- **[建议] P10 `AGENTS.md:12`（"14 测试文件，142 用例"）与 `AGENTS.md` 性能结构约束段** 未按 spec §10 更新为实测基线，也未登记「WidgetSandbox memo/LRU 不可破坏」「连字符语言提取」两条新死规则；同时本次 P1 的教训（**「components 引用稳定」必须由生产接线测试保证，不能只测组件内**）值得写进死规则。属 WP5 交付项，登记提醒。
- **[建议] P11 `src/lib/widgetRegistry.ts:88`** 工厂函数每次调用都在 `window` 上挂一枚永久 `scroll` 监听且无解绑出口；单例运行无碍，但测试里反复 `createWidgetRegistry()` 会累积监听器与计时器（`__clear` 只清计时器）。建议提供 `dispose()`。
- **[建议] P12 `src/components/WidgetSandbox.tsx:165-175,186-198`** 授权/唤醒占位块是纯 `<button>` 但新增 CSS 无 `:focus-visible` 规则（仓库惯例是逐个补，见 `kami.css:187,226,342,1080`）。这是**键盘用户唯一能给出的授权动作**，建议按 kami 语言补 2px `--brand` 描边。
- **[建议] P13 贴底守护事件集（`scrollRestore.ts:220-224`，spec §4.6 字面如此）** 只认 `wheel/touchstart/keydown`，**不认自定义滚动条拖拽**（`CustomScrollbar` 用 mouse 事件直接写 `scrollTop`）。活跃 mdlog 下守护每轮重载重新 arm，等价于「拖滚动条上翻时，一旦有新消息就被拽回底部」。建议把 `pointerdown`（或滚动条拖拽开始）纳入解除条件——需同步更新 spec。

---

## 6. 实测记录

| 命令 | 对象 | 结果 |
|------|------|------|
| `npm test` | **HEAD `0a149c1`**（20:36，工作区尚干净） | `Test Files 22 passed (22)` / `Tests 211 passed (211)`，7.80s，**全绿** |
| `cd src-tauri && cargo test` | 工作区（Rust 侧无未提交改动） | `vellum_lib` **35 passed**、`main.rs` **6 passed**、doc-tests 0；**41/41 全绿**，无 warning 中断 |
| `npm test` | 含 20:41/20:42 未提交在途改动的工作区（20:48） | `22 files / 216 tests passed`（在途新增 5 例） |
| `npx tsc --noEmit` | 同上工作区 | **1 error**：`src/App.test.tsx(971,31)` `storeGet.mockImplementation` 返回 `Promise<{ratio:number}>` 与推断的 `(key:string)=>Promise<string\|undefined>` 不兼容 → **当前工作区 `npm run build`（tsc 步骤）会失败**。HEAD 版本无此代码（`git show HEAD:src/App.test.tsx` 无 `storeGet.mockImplementation`），属在途未提交改动引入 |
| emoji 扫描（`src/`、`src-tauri/src/`） | 现状 | 0 命中 |
| react-markdown key 生成实测（`hast-util-to-jsx-runtime` + 自造 jsx 记录器） | node | 三篇结构不同文档 → key 序列 `[h1-0, pre-0(code-0), p-0] / [h1-0, p-0, pre-0(code-0)] / [h1-0, pre-0, pre-1]`，证实 **key 与内容无关、跨文档同名同位必复用** |
| 探针 A/B（`components` 引用稳定性 ↔ iframe 存活） | jsdom + `createRoot` | B（App 接线）`sameIframe:false, register:4, unregister:3`；A（headings 引用恒定）`sameIframe:true, register:1` |
| 探针 C（LRU 休眠→唤醒） | jsdom | `sameUrl:true, register:1, unregisterWhileDormant:0` |
| 探针 D/E（跨文档实例复用 × 授权门禁） | jsdom | D：`yHasPlaceholder:null, yIframeSrc:<X 的 URL>, register:1`；E：`bHasPlaceholder:"交互内容 · 点击加载"`（当前仅因重挂载而安全） |
| 探针 F（搜索高亮切换 × iframe 存活） | jsdom | `sameIframe:true, marks:3, current:1, register:1` → **R3/R5 红线未被 WP2/WP3 破坏** |
| `npm run dev` / release 包 §9.3 人工核验 | — | **未执行**。原因：① 审计期间有并发进程正在编辑 `src/App.tsx`，启停 dev server / 写 `dist/` 会干扰其在途工作；② §9.3 属 WP5 交付且要求 release 产物 GUI 手工核验，超出只读审计边界。**本报告结论不覆盖 release CSP 实测**（该清单仍为未勾状态，不可视为已过） |

探针文件位于仓库外的推理与 `outputs/__audit_scratch/` 临时目录，**运行完毕已全部删除**；`git status --porcelain | grep -v '^?? '` 复核仅剩并发进程对 `src/App.tsx`、`src/App.test.tsx` 的 ` M` 记录，非本审计产生。

---

## 7. 建议的修复顺序（含耦合关系）

1. **P1 + P2 + P4 必须同一批**（否则修 P1 立刻打开 P2 的安全门禁绕过；P4 是 P2 的半解）：
   - `useHeadingIdResolver` 改经 ref 读 `headings`，`resolveHeadingId` 引用恒定；
   - `WidgetSandbox`：`html` 变化 / `autoMount` 翻 false → 释放旧 id、清 `widgetUrl`、回到未授权态；进入休眠 → `unregister_widget` + 清 `widgetUrl`，唤醒走完整注册；
   - 新增**生产接线级**回归测试：由 `App` 传 `headings`（而非省略），断言 append-only 热重载前后 `iframe` 为同一 DOM 节点、`register_widget` 仅 1 次——现有 `MarkdownDocument.test.tsx:678` 的假性通过应同步改造。
2. **P3 + P12**（同一批 CSS/可达性修复），并在 `kami.css.test.ts` 增加**级联断言**（对 `.markdown-body button` vs `.mdlog-widget__placeholder` 的胜出方做显式文本断言，堵住只测规则文本的盲区）。
3. **P5/P6/P7/P8/P9** 逐项小修；P7 以工作区在途版本复核后为准。
4. **P10/P11/P13 + §4 偏差表** 回写 spec / AGENTS.md，使「文档即真相」不因实现漂移而失真。
5. 复审门槛：`npm test`、`cargo test` 全绿 **且 `npx tsc --noEmit` 零错误**（当前工作区不满足）；P1/P2/P4 的生产接线级测试落地。
