# 集成修复批审核报告（reviewer-qwen）

- **审核对象**：`git diff 1cdca85..d157d23`（9 commit：a4c6140 P1 / 9f9d7fb P2 / 0db95a4 P4 / 231ae4d 生产接线级测试 / eef250b P3+P12 / ceb4e04 P5 / 31a7611 P6 / 8156069 P8 / d157d23 P9）
- **原始发现**：`docs/superpowers/reviews/2026-09-05-integration-audit-qwen.md`（P1–P13）
- **审核性质**：只读复检。除本报告外未修改任何仓库文件；探针全部置于 `outputs/__audit_scratch/`，**运行完毕已删除并复核 `git status --porcelain` 无 ` M`/`A`/`D` 记录**
- **审核时间**：2026-09-05 21:22–21:50（+0800）

> **在途变更告知（重要）**：审核进行中（21:33:08）又有第 10 个 commit `3ae47d1`（"集成审核建议——实例复用时复位 widget 标题/高度；占位块 :active 防下沉穿透"）落入 HEAD。本报告中 `WidgetSandbox.tsx:64-66`、`kami.css:1215-1219` 的证据均以 **HEAD=3ae47d1** 为准，其余以 `d157d23` 为准；所有测试实跑结论已在 3ae47d1 上重跑复核（见「测试实测输出」）。

---

## 结论：**通过**（附 3 项「应当修复」尾款，均不阻断）

原审计的 **1 项阻断（P1）与 4 项应当修复（P2/P3/P4）全部真实消除**，不是换一种形式掩盖。判据不是看实现日志怎么写，而是：

1. **病灶复现即测试有效**——我把 P1/P2 的修复分别改回病态（mutant 组件，`resolveHeadingId` 依赖 `[headings]`；`WidgetSandbox` 删掉 P2 复位块），用同一套探针重跑，**精确复现了原审计的数字**：P1 mutant `sameIframe:false, register:4, unregister:3`、P2 mutant `iframe 保留 X 的 URL、无占位块`。修复后同探针为 `sameIframe:true, register:1, unregister:0` / `占位块回归、register 不新增、旧 id 注销`。
2. **安全门禁在四个方向都实测过**（非受信→非受信、非受信→受信、受信→非受信、受信→受信），无免点击挂载、无内容串档。
3. **级联问题用真级联引擎（jsdom computed style）复测**，不再依赖规则文本断言。

残留问题集中在**复位时机**（useLayoutEffect 而非渲染期）导致的一条可复现 IPC 越权注册窗口、以及**新落地守卫缺断言**、**Rust 侧死代码警告**。

| 原编号 | 判定 | 关键证据（探针） |
|--------|------|------------------|
| P1 阻断 | **已消除** | `P1: {"sameContainer":true,"sameIframe":true,"register":1,"unregister":0}`（3 次追加 + 生产接线） |
| P2 应当 | **已消除主病灶，留一处竞态尾洞** | `P2-D`/`P2-AA`/`P2-AB` 全绿；`P2-race` 显示越权注册 |
| P3 应当 | **已消除** | jsdom computed：`minHeight:120px, borderRadius:0px, boxShadow:none, background:var(--parchment)` |
| P4 应当 | **已消除** | `P4-dormant: unregister:["p4-1"], active:10` → `P4-wake: register:2, url p4-1→p4-2` |
| P5 建议 | **已消除** | `App.tsx:441-447` + e2e 断言（推演基线必红） |
| P6 建议 | **已消除** | `hasStuckToBottomRef` 三处写入路径闭合，P6 测试真实覆盖 `.then` 窗口 |
| P7 建议 | **已消除**（基线 1cdca85 已含卸载清理） | 本批未触碰，`App.test.tsx:"cleans up active scroll restore settle guard when App unmounts"` 实跑绿 |
| P8 建议 | **已消除，但引入 dead_code 警告** | `apply_rebind_preserves_registry_when_watcher_missing_for_healing` 绿；`cargo check` 1 warning |
| P9 建议 | **已消除且语义逐字节等价** | 边界 24 组 + 4000 组随机多字节串：短路与全编码判定 **0 处分歧** |
| P10 建议 | **未处理**（不属本批，仍开放） | `AGENTS.md:20` 仍写「14 测试文件，142 用例」（实测 22/223） |
| P11 建议 | **未处理** | `widgetRegistry.ts:84-86` 仍无 dispose |
| P12 建议 | **已消除** | `kami.css:1209-1211` `:focus-visible` 2px `--brand`，`outline-offset:-2px` |
| P13 建议 | **未处理**（需同步 spec，登记提醒） | `scrollRestore.ts` 本批未改 |

---

## 逐 P 复检（探针证据）

### P1（原阻断）：`components` 引用稳定 → iframe 存活 —— **通过**

**实现**：`MarkdownDocument.tsx:228-229` 新增 `headingsRef` 并在渲染期赋值，`:237,249` 改读 ref，`:273` 依赖数组清空为 `[]` → `resolveHeadingId` 引用恒定 → `components`（`:421` 依赖 `[resolveHeadingId, isTrustedMdlog]`）在 `isTrustedMdlog` 不变时恒定。

**探针 1（复刻原探针 B，逐 prop 对齐 `App.tsx:603-610` 的真实接线：`markdown/headings/onRendered/searchQuery/searchQueryPending/activeMatchIndex/onMatchCountChange`，`headings = useMemo(extractOutline, [markdown])`）**：

| 场景 | 结果 |
|------|------|
| 受信 mdlog + 1 widget + **3 次 append**（含中间插入 `## sub heading` 改变文档结构） | `{"sameContainer":true,"sameIframe":true,"register":1,"unregister":0}` |
| 两 widget 文档 append 一次 | 两个 iframe 的 `src` 完全不变（`probe-1`/`probe-2`），`register:2, unregister:0` |
| widget 被 pi 从文档中删除 | `iframe` 消失 + `unregister:1`（无孤儿条目） |
| **mutant（改回 `[headings]`）** | `{"sameIframe":false,"register":4,"unregister":3}` —— 与原审计病灶数字**逐位一致** |

结论：spec §4.1/§6 的「append-only 期间 iframe 实例与交互状态完全保留」在生产接线下成立。修复方向选择（组件内 ref 化而非 App 侧 deep-compare）也成立：`MarkdownBody` 的 `memo` 在 `headings` 引用变化时会重渲染，但 react-markdown 10 **不做内部 memo**（`node_modules/react-markdown/lib/index.js:175-178` 每次 render 都 `processor.runSync`），而 App 的 `headings` 只在 markdown 变化时变化 → 重解析本就是必需的，无额外开销（但见 C6 的护栏提醒）。

**React 19 并发安全性专项结论（协议要求给出判定）**：**可接受，不阻断，但必须补注释**。理由分三层：

1. **React 官方文档并不认可"渲染期写 ref"**。`react.dev/reference/react/useRef` 明确「Never read or write refs during rendering」，唯一豁免是首渲染惰性初始化；官方为「永远读最新值」提供的 sanctioned 机制是 `useSyncExternalStore`（渲染期读）与实验性 `useEffectEvent`（effect 内读，内部用 `useInsertionEffect` 写入——**因此它根本不能在渲染期读**）。所以本写法属「常见习语（ahooks `useLatest` 同款）」而非「文档许可模式」，不能声称它合规于 React 规范。
2. **在本文件中它不产生可观测的 tearing**：`resolveHeadingId` 的唯一调用点是 `components.h1/h2/h3`（`:328-330`），即**写在同一次 render pass 内、读在之后**——被放弃/重放的渲染会重新执行函数体并重新写入，任何提交帧读到的都是本帧自己写入的 `headings`；`usedIds`/`fallbackCounter` 也在每次 `MarkdownBody` render 重置（`:232-233`），不存在跨 pass 累积。并发交叠（App 的 `useDeferredValue` 输入）只会出现「pass A 写 A → 中断 → pass B 写 B → 提交 B」，B 读 B，正确。
3. **真正的风险是未来被误用**：一旦有人把这个稳定回调放进事件处理器、effect 或 `setTimeout`（此时读到的就是「最后一次 render attempt 的 headings」，可能是未提交帧），tearing 立刻变可观测。仓库同型写法已有三处（`App.tsx:34`、`App.tsx:531`、`MarkdownDocument.tsx:229`），**没有任何一处写明这个不变量**。→ 见问题清单 C5。

**标题 id 完整性专项（P1 的下游风险，探针另测）**：`# 第一章 / ## 重复标题 ×2 / ## 复杂度 $O(n)$ 分析 / ### 深层 needle 标题` 文档，DOM 解析结果与 `extractOutline` **逐项全等**：
`["H1#第一章","H2#重复标题","H2#重复标题-1","H2#复杂度-on-分析","H3#深层-needle-标题"]`；append 同名标题后新 id 为 `H2#重复标题-2`、全集无重复；搜索词 `needle → ""` 往返后 id 序列**不变**。→ R6（大纲跟随）与 R7（阅读位置锚点）未被 P1 破坏。

### P2（安全门禁）：跨文档授权残留 —— **主病灶消除，留一处竞态尾洞**

**实现**：`WidgetSandbox.tsx:41-42` `prevHtmlRef/prevAutoMountRef`，`:47-71` `useLayoutEffect` 检测 `html` 变化或 `autoMount` 翻 false → `unregister_widget(旧 id)` + 清 `widgetUrl/isDormant/isUserActivated/hasError`（3ae47d1 又补 `title/height`）。

**四方向实测（探针 2，全部走 `MarkdownDocument` 生产接线，实例复用真实发生）**：

| 场景 | 期望 | 实测 |
|------|------|------|
| 非受信 X（点击授权）→ 非受信 Y（不同 html） | Y 出占位块、不新增 register、X 的 id 注销 | `{"register":1,"unregister":1,"unregisterIds":["p2-1"],"url":null,"ph":"交互内容 · 点击加载"}` ✅ |
| 受信 A → 受信 A'（都是 mdlog，widget html 不同） | 必须重新注册**新内容**，不误伤 | `register:2`、`registerHtml:["<div>a-one</div>","<div>a-two</div>"]`、`unregister:["p2-1"]`、iframe src 换新、无占位块 ✅ |
| 受信 A → 非受信 B | 回落未授权占位块 | `{"register":1,"unregister":1,"iframe":false,"ph":"交互内容 · 点击加载"}` ✅（原审计指出这只是"巧合安全"，现在是**设计安全**） |
| 非受信 X（授权）→ 非受信 Y（**html 逐字节相同**） | —— | `{"register":1,"unregister":0,"iframe":X 的 URL,"ph":null}` ⚠ 门禁以**内容**为键而非文档；内容相同故无串档，但与 §7.2「该文档」字面有差（见 C1） |
| **`register_widget` 在途时切文档**（IPC 延迟 50ms） | Y 不得在用户点击前进入后端注册表 | ❌ `{"register":2,"unregister":2,"unregisterIds":["p2-1","p2-2"],"registerHtml":["<div>x1</div>","<div>y1</div>"]}` —— **Y 的 html 被越权注册了一次**（数十毫秒后补发 unregister） |

**根因（已定位）**：复位发生在 `useLayoutEffect`（提交**之后**、passive effect **之前**），而挂载仲裁 effect（`:127-134`）读取的是**提交帧上的旧闭包**：`shouldMount = (autoMount || isUserActivated)` 仍是 `true`、`widgetUrl` 仍是提交前的 `null`（注册未回）→ 两个守卫同时放行 → 以新 `html`（`html` 在 `:158` 依赖里）直接 `requestMount` + `invoke("register_widget", {html: Y})`。注册回来后 `isCancelled` 补发 unregister，所以**不会有 iframe 被挂载**（`widgetUrl` 已被复位清空，探针确认 `ph:"交互内容 · 点击加载"`）。
快速路径之所以没暴露这个问题，是**恰好**被 `:130` 的 `widgetUrl` 非空守卫挡住（旧注册已回）——即"快的时候被意外保护、慢的时候才漏"，属典型竞态而非稳定行为。
同根因的第二个表现（DOM 侧）：我在 `onRendered`（父级 layout effect，晚于子级复位）采样提交帧，得到
`commit(doc#1) iframe=http://vellum-widget.localhost/s-1 ph="-"` —— **markdown 已是 Y 的那一次提交，DOM 里仍挂着 X 的 iframe**，随后才被复位提交移除。同任务内完成、不会进入绘制，但浏览器对"带 src 的 iframe 插入"会立即发起导航，等于多一次无谓的协议请求（见 A1 修法一并解决）。
反向验证：把复位块整体删除成 mutant，同探针 → `{"register":1,"unregister":0,"iframe":X 的 URL,"ph":null}`，与**原审计探针 D 完全一致** → 说明 shipped 测试确实是有效防线，不是装饰。

**另一个"看起来会漏其实不漏"的路径**（我专门测了，结论是安全，但值得写进注释）：非受信 X 授权 → 休眠（`widgetUrl` 被 P4 清空、`isUserActivated` 仍 true）→ 切 Y。直觉上正是 A1 的触发条件，实测 `registerHtml` 只有 `["<div>x-race</div>"]`、Y 出占位块 —— 因为休眠时 `isDormant=true` 让 `shouldMount` 提前为 false。这是**第二道守卫巧合兜住**，不是设计兜住。

### P4（资源回收 + 唤醒）：休眠注销 / 唤醒重注册 —— **通过**

**实现**：`:74-96` 订阅回调中 `dormant===true` → `unregister_widget(idRef)` + `idRef=null` + `setWidgetUrl(null)`；`:211-216` 唤醒点击 → `activate` + `setIsDormant(false)` → effect 3 重走完整注册；`widgetRegistry.ts:129-136` 移除 `activate` 内的 `entry.mounted = true; scheduleEviction()`。

**探针 3（LRU 真实淘汰，11 个竞争条目 + `advanceTimersByTime(400)`）**：

```
P4-dormant: {"register":1,"unregister":1,"unregisterIds":["p4-1"],"active":10,"iframe":false,"ph":"交互已休眠 · 点击查看"}
P4-wake:    {"register":2,"unregister":1,"registerHtml":["<div>sleepy</div>","<div>sleepy</div>"],
             "url1":"http://vellum-widget.localhost/p4-1","url2":"http://vellum-widget.localhost/p4-2","active":11}
```

逐条对齐原审计的三个后果：① 休眠期不再占 Rust 内存（unregister 实发）；② 唤醒拿到**全新 id/URL**，即使 Rust 侧 64 条 LRU 已把旧条目挤掉也**不可能 404 白屏**（这是结构性消除，不是缓解）；③ `activate` 不再虚占活跃计数——`__getActiveCount()` 在休眠态恒为 10、唤醒后 11（用户显式动作可短暂超限，下一次淘汰收敛）。原审计探针 C 的 `{"sameUrl":true,"register":1,"unregisterWhileDormant":0}` 已完全反转。
附带核对：`widget.rs:287-292 unregister_widget` 对不存在/已 clear 的 id 幂等返回 Ok；协议层 GET-only、高熵 id、四条安全头本批未触碰（`grep sandbox=` → `:259-260` 仍为 `allow-scripts` + `no-referrer`，无 `allow-same-origin`）。

### P3 / P12（级联与设计语言）—— **通过**（断言判别力有短板）

**实现**：`kami.css:1184`（`.markdown-body .mdlog-widget__placeholder`，+`border-radius:0`/`box-shadow:none`）、`:1203`（`:hover` + `box-shadow:none`）、`:1209`（`:focus-visible`）、`:1215`（3ae47d1 补 `:active` 抵消下沉）。

**真级联实测**（把整份 `kami.css` 注入 jsdom `<style>`，渲染真实 `WidgetSandbox`，读 `getComputedStyle`）：

```json
{"minHeight":"120px","padding":"24px","width":"100%","borderRadius":"0px","boxShadow":"none",
 "background":"var(--parchment)","color":"var(--stone)","display":"flex","fontSize":"13px","cursor":"pointer"}
```
→ 原审计的「32px 高 / warm-sand 底 / 内描边 / 6px 圆角凸起按钮」**全部消失**（`min-height` 不再是 32px、`box-shadow` 不含 inset、`border-radius` 为 0）。`font-weight` 仍为 `500`（继承 `.markdown-body button`，占位块未声明）——DESIGN.md:205 明确 500 是上限，**不算违规**，仅记录。

**级联断言判别力（协议要求"试着把选择器改回弱特异性验证测试红"）**：我在内存中把三处强选择器削弱回 `.mdlog-widget__placeholder`，复刻 `kami.css.test.ts` 的断言：

```json
{"buttonIndex":17469,"placeholderIndex":24084,"orderOk":true,
 "hasPrefix":false,"hasHover":false,"hasFocus":false,
 "declaresBoxShadowNone":true,"declaresRadius0":true}
```
→ **特异性前缀 / `:hover` / `:focus-visible` 三条正则断言确实变红**（有效）；但 `placeholderIndex > buttonIndex` 的**顺序断言在弱化后仍为真**（`orderOk:true`）——"仅靠后但特异性更弱"的回归不会被它抓到。jsdom 侧的 computed-style 断言是可行且更硬的替代（实测 min-height/border-radius/box-shadow/font-weight 都可断；`border-top` 因 jsdom 不处理 `border` 简写→longhand 归一，**不能**作为 jsdom 断言目标，会假红）。见 C3。

### P5 / P6（App 时序）—— **通过**

- **P5**（`App.tsx:441-447`）：早退前 `setShowReloadNote(false)`。核对无副作用：`:211-212` 已保证活跃期不置 true；重复写 `false` 命中 React eager-state bail-out（值同一 → 不额外渲染）。测试落在 e2e 生命周期用例中段（`App.test.tsx` P5 段），推演基线必红（旧代码早退且 cleanup 已 clearTimeout → 印章常驻）。**判定：真实修复。**
- **P6**（`App.tsx:36,157-159,348-352,415-418`）：`hasStuckToBottomRef` 写入（贴底分支）/重置（`loadPath`）/消费（`.then`）三点闭合；与 `lastRestoredPathRef` 的组合无过度抑制——同文档内 `handleContentRendered` 本就早退，跨文档由 `loadPath` 复位。测试用可控未 resolve 的 `storeGet` Promise 精确构造「异步窗口内发生贴底仲裁」，并断言 `restoreScrollPosition` 调用数不增。基线下该断言必红（`.then` 会用 `{ratio:0.3}` 覆盖并取消贴底守护）。**判定：真实修复。**
- 顺带核对：R7 落位守护的事件集未被改动；`reloadCurrent` 不经 `loading` 帧 → 热重载不会卸载 Suspense 子树（这是 iframe 存活在 App 层成立的必要前提，本批未破坏；但见 C7 的同路径 re-open 死角）。

### P8（Rust 注册表解耦）—— **通过，但引入构建警告**

`main.rs:229-247` 拆成 `should_clear_registry`（仅路径变更/首次）+ `needs_watcher_rebuild`（路径变更或 watcher 丢失），`:181-192` 两条分支各自独立；`apply_rebind` 只在 `path_changed` 时清表。矩阵测试新增「同路径 + watcher 缺失 → 清表 false / 重建 true」，实跑 7/7 绿。spec §4.3 的字面偏差已在实施日志 §5.1 登记，判定合理（更符合「同文档热重载绝不清空」的核心承诺）。

**新问题**：`fn should_rebind`（`main.rs:242`）被保留为"向后兼容同名包装"，但生产路径**零调用者**（grep：只有 `main.rs:344,350,356,361` 四处测试在用）→ `cargo check`（非 test profile）报：

```
warning: function `should_rebind` is never used
   --> src\main.rs:242:4
```
详见 A2。

### P9（512KB 预检短路）—— **通过**

`MarkdownDocument.tsx:394-396`：`code.length > 524288 || (code.length > 131072 && encode(...).length > 524288)`。
**等价性实测**（不是推理）：以 `encode(code).length > 524288` 为真值，对 `len ∈ {131071,131072,131073,524287,524288,524289} × ch ∈ {a, é, 字, 😀}` 共 24 组边界 + 4000 组随机混合多字节串做双向对比 → **divergences: 0**。与 Rust 侧 `html.len() > MAX_WIDGET_HTML_BYTES`（`widget.rs:23`）字节语义严格一致；`>` 与 `=` 的边界（131072×4B = 524288B 恰好放行）两侧同判。
测试（`MarkdownDocument.test.tsx` P9 用例）用 `TextEncoder.prototype.encode` spy 断言"短内容不编码"，三条分支都覆盖，且第 3 条用 200,000 个汉字（600,000 字节 > 512KB）真实走临界区间 → 有效。**判定：真实优化，语义零漂移。**

### 231ae4d（生产接线级测试）—— **基本达成，两点命名与覆盖不符**

- ✅ 原假性通过的 `preserves components memo and iframe DOM instance across markdown appends` 已改为**传入 `headings`** 并新增 `expect(rerenderedIframe).toBe(initialIframe)` + `expect(invoke).toHaveBeenCalledTimes(1)`——正是原审计要求的"由 App 语义传入大纲"。
- ⚠ 但"生产接线级"是**在 `MarkdownDocument` 层复刻接线**（headings 派生 + 断言），并未渲染真实 `<App/>`：`grep -n "iframe\|mdlog-widget" src/App.test.tsx` → **0 命中**。App 层的 Suspense/`loading` 帧/`React.lazy` 边界对 widget 存活的影响没有测试锁定（我的探针 1 已代为验证行为正确，但仓库里没有这条回归）。
- ⚠ `WidgetSandbox.test.tsx:257` 的用例名声称覆盖 "html changes **or autoMount flips to false**"，实际只 rerender 了 `html`（全仓无 `autoMount` true→false 的 rerender 用例）——该分支只有我这次的探针 P2-AB 覆盖到。

---

## 新伤排查

| 红线/接缝 | 判定 | 证据 |
|-----------|------|------|
| **R3** `search-match--current` 由 layout effect 维护、未回填 rehype | **未被破坏** | `MarkdownDocument.tsx:456-508` 本批未改；探针：`searchQuery` 走 `needle→needl→n→needle→""` 全循环后 `sameIframe:true, marks:3, register:1, unregister:0`（R5 的 300ms/视口门禁代码零改动） |
| **R6** 大纲对所有正文滚动始终跟随、无新增门禁 | **未被破坏** | `git diff --name-only 1cdca85..HEAD` 不含 `src/hooks/`；`useOutlineSync` 未改 |
| **R7** 阅读位置锚点+偏移+比例兜底；落位守护不得弱化 | **未被破坏，且新增依赖已验证** | `scrollRestore.ts` 未改；P6 只在 `.then` 前加门禁，未触碰守护本体；P1 的 ref 化会让 `headings` 与 DOM id 的对应关系成为锚点恢复的关键——已用探针专测（ids 与 `extractOutline` **逐项全等**、跨 append/search 稳定、去重后缀正确） |
| **R1/R2** `components` memo + `MarkdownBody` props 引用稳定 | **R1 从"形式合规"转为实质合规** | `components` 现只依赖 `[resolveHeadingId(恒定), isTrustedMdlog]`；R2 字面仍不满足（`headings` 引用不稳 → `MarkdownBody` 必重渲染 → react-markdown 无内部 memo → 全篇重解析），但当前 App 派生关系下 `headings` 变化 ⟺ `markdown` 变化，重解析本就必需 → 无实际开销。护栏缺失见 C6 |
| **实例复用 × UI 状态串档**（P1 修好后新暴露的面） | **已由 3ae47d1 消除，但无断言** | 探针：`REUSE-before bar="甲的私密标题..." h=900px` → `REUSE-after sameWrapper:true, mark:"survivor", bar="交互演示", h=240px` —— 证明是**同一 fiber/同一 DOM 节点被复用**且 state 被显式复位。但仓库内没有任何测试先 postMessage 设标题再改 `html`（grep `交互演示` 全部是默认态 `getByTitle`）→ A3 |
| **休眠 × 唤醒 × 淘汰收敛** | **无抖动** | `activate` 刷新 `lastVisible` → 唤醒项是最新，`evictIfNecessary` 升序取尾不会立刻自我再次休眠；探针唤醒后稳定停在 `register:2 / unregister:1`，无循环 |
| **卸载清理** | **无泄漏** | 组件卸载 effect（`:98-107`）+ P2/P4 均以 `idRef.current = null` 先置空再发 IPC，无双发；`widgetRegistry` 订阅与 IntersectionObserver 各自 disconnect |
| **计时器/IPC churn** | **消除** | 原 P1 的「每次热重载 register+unregister 一对」实测降为 0；徽章 `computeRecheckDelay` 路径本批未改 |
| 代码质量小面 | 4 处重复的 `void Promise.resolve(invoke("unregister_widget", …)).catch(() => {})` 片段（`:56-60`、`:80-85`、`:100-105`、`:142-146`），`Promise.resolve` 对已是 Promise 的 `invoke` 冗余 → 建议抽 `releaseBackend(id)` | `WidgetSandbox.tsx` |

---

## 问题清单

### 应当修复

- **[应当修复] A1 `src/components/WidgetSandbox.tsx:47-71` 与 `:127-134`**
  P2 复位放在 `useLayoutEffect`（提交后）里，而挂载仲裁 effect 读的是**提交帧上的旧 state 闭包**（`isUserActivated` 仍 true、`widgetUrl` 已为 null），导致 `register_widget` 的 IPC 有延迟时，**下一文档的 widget html 在用户未点击授权的情况下被注册进后端注册表**（实测 `register:2 / registerHtml 含 Y / unregister:["p2-1","p2-2"]`，Y 的条目存活一个 IPC RTT）。同一根因在 DOM 侧表现为"markdown 已是 Y 的那一帧仍挂着 X 的 iframe"（实测 `commit(doc#1) iframe=<X 的 URL>`），同任务内被移除不进入绘制，但浏览器会为该插入发起一次真实的子帧导航。
  **理由**：spec §7.2 字面要求「只有在用户**明确信任该文档并主动点击**占位块后，才调用 `register_widget`」，本窗口违反该字面；且它属"快的时候被别的守卫巧合挡住、慢的时候才漏"的竞态，不是稳定行为——正是本批要根除的那类接缝缺陷。
  **修法（二选一，都消除 A1 与 B1）**：(a) 改用 React 官方认可的"渲染期随 props 调整 state"：把 `prevHtml/prevAutoMount` 收进一个 state，`if (s.prev.html !== html || …) { setS(...); setWidgetUrl(null); … }` 在函数体内执行，使**同一提交帧**的 `shouldMount` 就为 false（副作用侧的 unregister IPC 仍留在 effect 里，避免渲染期发 IPC）；或 (b) 给"授权"绑定内容键：`activatedForHtmlRef.current = html`（点击/autoMount 时写入），仲裁条件改为 `autoMount || activatedForHtmlRef.current === html`——ref 在 effect 执行期读取，天然不受提交帧闭包影响。

- **[应当修复] A2 `src-tauri/src/main.rs:242`**
  `should_rebind` 沦为「只为矩阵测试存在的向后兼容包装」，生产路径零调用 → `cargo check` 真实报 `warning: function should_rebind is never used`（已附完整输出）。
  **理由**：本批其余改动都保持了"无新增构建警告"的水准（`cargo test` 输出干净），这是 P8 拆分时新引入的唯一回归；一旦 CI 或 `tauri build` 采用 `-D warnings`，或后续再拆一次同类判定，这个只被测试引用的生产 API 会持续误导读者以为它参与仲裁。
  **修法**：删除 `should_rebind`，把 `main.rs:344,350,356,361` 四处断言直接指向 `should_clear_registry`（语义本来就同源）。

- **[应当修复] A3 `src/components/WidgetSandbox.tsx:64-66`（commit 3ae47d1）**
  新增的「实例复用时复位 `title`/`height`」是防跨文档串档的守卫，但**没有任何测试断言它**：全仓 `grep 交互演示 src/components/*.test.tsx` 的 8 处命中全部是默认态 `getByTitle`，没有一处「先 postMessage 设标题 → 再改 `html` → 断言标题回到默认」。同理 `kami.css:1215-1219` 的 `:active` 规则也未进 `kami.css.test.ts` 的规则断言。
  **理由**：守卫无断言 = 下一次重构会静默消失；本批 P2/P3/P4 的教训正是"守卫与其测试必须同批落地"（本条我自己也是靠探针才发现的）。修法：在 `WidgetSandbox.test.tsx` 的 P2 用例里补 3 行（postMessage title → rerender 新 html → `expect(screen.getByText("交互演示 · vellum-widget"))` 或 `getByTitle("交互演示")`），`kami.css.test.ts` 补一条 `:active` 规则文本断言。

### 建议

- **[建议] B1 `src/components/WidgetSandbox.tsx:47`**：与 A1 同根的 DOM 陈旧帧问题；若采纳 A1(a) 则自动消失，无需单独修。
- **[建议] C1 `src/components/WidgetSandbox.tsx:48`**：门禁以 `html` 字符串为键——非受信 X 授权后切到含**逐字节相同** widget 的非受信 Y，实例不会复位（实测 `iframe` 保留、无占位块）。内容相同 ⇒ 无串档，但与 §7.2「该文档」的逐文档语义有差。请在注释或 spec 里明确「同一份 widget 内容只需授权一次」，否则后续审核者会反复判为绕过。
- **[建议] C2 `src/styles/kami.css:1184,1203` + `src/components/WidgetSandbox.tsx:264`**：`交互准备中…` 的**非交互 `<div>`** 与可点 `<button>` 共用 `.mdlog-widget__placeholder`，于是它继承了 `cursor:pointer` + `:hover` 变 `--ivory/--brand`——不可点的东西长得像可点。建议另给 loading 态一个类（或 `button.mdlog-widget__placeholder` 限定），把 affordance 语义还给"点击才加载"。
- **[建议] C3 `src/styles/kami.css.test.ts:196-206`**：级联断言中的顺序项（`placeholderIndex > buttonIndex`）无判别力（弱化后仍 true，实测 `orderOk:true`）。建议补一条 **jsdom computed-style 断言**（探针证明 `minHeight/borderRadius/boxShadow/font-weight/width/padding` 在 jsdom 下都可断），把"文本断言"升级为"级联结果断言"；注意 `border-top` 在 jsdom 会假红（`"medium none"`），只能断规则文本。
- **[建议] C4 `src/components/WidgetSandbox.test.tsx:257`**：用例名承诺 `or autoMount flips to false`，实际无该分支用例（全仓无 `autoMount` true→false rerender）。实测行为正确（P2-AB），请补齐名实相符。
- **[建议] C5 `src/components/MarkdownDocument.tsx:228-229,273`（并波及 `src/App.tsx:34,531`）**：为"渲染期写 ref + 恒定回调"补一行不变量注释：**`resolveHeadingId` 只允许在渲染期调用**（一旦进事件/effect，读到的可能是未提交帧的 headings）。仓库现有 4 处同型写法全部无注释——这是本次 React 19 并发合规判定为"可接受"的**唯一前提条件**，值得写死。
- **[建议] C6 `src/components/MarkdownDocument.tsx:290-303`**：`headings` 仍是 `MarkdownBody` 的 memo prop，而 react-markdown 10 内部无 memo（`lib/index.js:175-178` 每次 render 全量 `runSync`）。今天 App 的派生关系下无代价，但任何人把 `headings` 接到别的源（如滚动时增量更新的大纲缓存）就会**静默把每次更新变成整篇重解析**。既然 `resolveHeadingId` 已经不吃引用，建议把 `headings` 也 ref 化出 `MarkdownBodyProps`，让 R2 从"实质豁免"变成"结构成立"。
- **[建议] C7 `src/App.tsx:164-166`（配合 `:593-596`）**：同路径 re-open（第二实例深链 → `drain_pending_open_paths` → `loadPath`）会先 `setState({status:"loading"})`，`ready` 分支整体卸载 → **所有 iframe 销毁**。P1 之后这是 §4.1/§6「交互状态不丢」承诺**唯一剩余的破坏路径**。修法：`path === currentPathRef.current` 时改走 `reloadCurrent()`，或同路径时跳过 loading 帧。
- **[建议] C8 `src-tauri/src/main.rs:181-186` + `:250-262`**：`path_changed` 在调用点与 `apply_rebind` 内部各算一次同一谓词；两处分叉会静默不一致（清了 watcher 却没清表）。建议 `apply_rebind` 直接收 `bool` 或让调用点不再预判。
- **[建议] C9 `outputs/mdlog/integration-fix-log.md` §3/§4**：日志的 diffstat（`11 files, 539 insertions(+), 62 deletions(-)`，`src/App.tsx 28`）与实际 `git diff --stat 1cdca85..d157d23`（`11 files, 630 insertions(+), 48 deletions(-)`，`src/App.tsx 11`）不符（记录的是中间态），且 §1 提交清单未包含在途追加的 `3ae47d1`；§2 各条 Red 追溯为过程性描述、不可外部复核。请订正，保持"文档即真相"。
- **[登记未处理] P10 / P11 / P13**：`AGENTS.md:20` 仍写「14 测试文件，142 用例」（实测 22 文件 / 223 用例）；spec §10 要求的两条新死规则（WidgetSandbox memo/LRU 不可破坏、`components` 引用稳定必须由**生产接线级**测试保证）仍未写入 AGENTS.md；`widgetRegistry.ts:84-86` 的永久 `scroll` 监听仍无 `dispose()`；`scrollRestore.ts` 守护事件集仍不认自定义滚动条拖拽。另 §4.2 的两条同义降级路径标签仍不一致（`MarkdownDocument.tsx:398` `language=""` vs `WidgetSandbox.tsx:198` `language="xml"`）。均不属本批 9 commit 范围。
- **未覆盖声明**：与上次审计一致，本次仍未执行 `npm run dev` / release 包 GUI 手工核验，**spec §9.3 与 §7 的 release CSP 实测清单仍为未勾状态，本报告不覆盖**。§9.3 属 WP5 交付。

---

## 测试实测输出

**全部在当前 HEAD=`3ae47d1` 上重跑**（审核期间 HEAD 从 d157d23 前移，d157d23 上的首轮结果一并保留）。

| 命令 | 结果 |
|------|------|
| `npx vitest run src/` | `Test Files 22 passed (22)` / `Tests 223 passed (223)`，7.82s —— 与实施日志 §4.1 声明一致 |
| `npm test`（默认 include） | `28 files / 241 tests`，其中 **1 failed 为本次审核探针自身**（`outputs/__audit_scratch/probe-p3.test.tsx` 的 `font-weight ≠ 500` 断言过严，DESIGN.md:205 允许 500）；删除探针目录后为 22/223 全绿 |
| `cd src-tauri && cargo test` | `vellum_lib 35 passed` + `main.rs 7 passed` + doc-tests 0 = **42/42 全绿** —— 与实施日志 §4.4 一致 |
| `cargo check`（非 test profile） | **1 warning**：`function should_rebind is never  used --> src\main.rs:242:4`（→ A2） |
| `npx tsc --noEmit` | **exit 0，0 error**（原审计在途工作区的那处 `App.test.tsx(971,31)` 类型错误已不存在） |
| emoji 扫描（`src/`、`src-tauri/src/`，区间 `1F000-1FAFF / 2600-27BF / 2B00-2BFF / FE0F`） | **0 命中**（另有 17 处 U+2192 箭头，属正常排版，非 emoji） |

### 探针清单（`outputs/__audit_scratch/`，已全部删除）

| 探针 | 用途 | 关键输出 |
|------|------|----------|
| `probe-p1.test.tsx` | 生产接线 iframe 存活（4 例：3 次 append / search 往返 / 双 widget / widget 被删） | `{"sameContainer":true,"sameIframe":true,"register":1,"unregister":0}`；`P1-search {"sameIframe":true,"marks":3}`；`P1-two frames 不变`；`P1-remove {"unregisterIds":["probe-1"]}` |
| `probe-p2.test.tsx` | 授权门禁 5 场景（D 复刻 / A→A' / A→B / 同内容 / 在途注册竞态） | 前四场景 ✅；`P2-race {"register":2,"registerHtml":["x1","y1"],"unregisterIds":["p2-1","p2-2"]}` ❌ → A1 |
| `probe-p4.test.tsx` | 休眠注销/唤醒重注册 + 休眠后切档 | `P4-dormant/ P4-wake`（见上）；`P4-dormant-switch` 无越权注册 |
| `probe-p3.test.tsx` | jsdom 真级联 + 选择器弱化变异 | `P3-COMPUTED {minHeight:"120px",borderRadius:"0px",boxShadow:"none",background:"var(--parchment)"}`；`MUTATE {orderOk:true, hasPrefix:false, hasHover:false, hasFocus:false}` |
| `probe-ids.test.tsx` | P1 下游：标题 id 与大纲/锚点一致性 | `dom === outline` 逐项全等，search 往返不变，全集唯一 |
| `probe-residue/reuse/title.test.tsx` | 实例复用下的 title/height 串档与陈旧 postMessage 注入 | 复位生效（`sameWrapper:true` + bar 回到默认）；旧帧延迟消息被 `event.source` 校验拒掉（bar 仍默认） |
| `probe-stale.test.tsx` | 提交帧是否出现陈旧 iframe | `commit(doc#1) iframe=http://vellum-widget.localhost/s-1` → B1 |
| `Mutant*.tsx` + `probe-mut` | 变异检验（去掉 P1/P2 修复） | `MUT-P1-churn {"sameIframe":false,"register":4,"unregister":3}`；`MUT-P2 {"iframe":X URL,"ph":null}` —— 证明 shipped 测试有牙 |

### 收尾核对

```
$ rm -rf outputs/__audit_scratch
$ git status --porcelain | grep -E "^ M|^A|^D"     # 无输出（tracked 文件零改动）
$ ls outputs/                                       # 仅剩既有交付物，无探针残留
```
