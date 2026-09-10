# 终审修复波 · 限定范围重审报告（`05505eb` → `e57fc13`）

- 审查对象：**仅** `review-05505eb..e57fc13.diff`（单提交 `e57fc13`，12 文件 / +440 −41），内容与磁盘工作树 `HEAD` 一致（见「命令与输出」）。
- 判定范围：终审报告待判定清单 **C1 / C2 / I1 / I2 / I3**（裁定 F37–F42）＋ T7 两条 Important（F43）＋ T8 文档类四处 ＋ **本波是否引入新破坏**。未改动代码上的新问题一律不入「问题清单」，只归「范围外观察」。
- 方式：只读。**未修改仓库任何文件**（探针一律落在 `%TEMP%`，见「命令与输出」尾部声明），未派发子智能体。
- 独立证据（不采信修复报告的自述）：
  1. **Node 24 类型剥离直接 import 交付的 `src/lib/editUnits.ts`**，跑终审 C1 的三条原始输入 + 不变量/性能探针；
  2. **仓库外变异注入**：在 `%TEMP%\mut\vitest.config.mts` 写了一个只做字符串替换的 Vite 插件（`root` 指向仓库，`node_modules` 走联接），**在内存里**删掉某个修复点后跑交付测试，用来证明回归用例真有判别力 —— 磁盘文件全程未动（`git status` 复核见文末）；
  3. 聚焦测试实跑（`src/lib/editUnits.test.ts` / `src/App.test.tsx` / `src/hooks/useDocumentEditor.test.ts` / `src/styles/kami.css.test.ts`），共 **181 用例全绿**；按指令**未重跑整套**。

---

## 逐条判定

### 1. F37（终审 C1，脚注定义绕过结构性只读）— **ADDRESSED**

**代码事实**

- `footnoteDefinition` 已进块级容器白名单：`src/lib/editUnits.ts:60`（`new Set(["list","listItem","blockquote","footnoteDefinition"])`），锁定判定因此会下钻脚注子树（`:68-78`）。
- 收集侧加了 `drill()` 并给出三条下钻入口（顶层 list / blockquote / footnoteDefinition，`src/lib/editUnits.ts:115-120`、`:134-137`），脚注正文按块成单元（新 kind `footnoteChild`，`:20`）；容器子节点若是嵌套脚注定义继续下钻（`:117-119`）。

**三条原始反例（我自己实跑，非引用报告）** —— `node` 直接 import 交付文件：

```
=== A ===  unit 0 paragraph editable=true  | unit 1 kind=html   editable=false reason=html   src="    <div class=\"payload\">raw</div>"
=== B ===  unit 0 paragraph editable=true  | unit 1 kind=widget editable=false reason=widget src="    ```vellum-widget\n    <b>x</b>\n    ```"
=== C ===  unit 0 paragraph editable=true  | unit 1 kind=html   editable=false reason=html   src="    > <div class=\"x\">raw</div>"
对照：顶层/引用/列表内 HTML 仍 html:false:html（F8 未回退）；脚注内引用内亦 html:false
```

三条输入现在都产出 `editable=false` 且 `reason` 正确（A/C=`html`、B=`widget`），与终审判定一致。

**遍历式断言是真的遍历，不是补例子**

- `src/lib/editUnits.test.ts:229-279`：`LOCKED_INNER_BLOCKS`（块级 HTML / `vellum-widget` 围栏）× `INNER_CONTAINERS`（顶层 / 引用内 / 列表项内 / 脚注定义内 / 脚注定义内引用内 / 引用内脚注定义内 / 列表项内脚注定义内）= **14 条**，每条用 `unitsCovering()` 按**源码片段**定位并断言**每一个**覆盖单元 `editable===false` + `reason` 正确，且先断言命中集合非空（防恒真）。verbose 实跑确认 14 条都在且全绿。
- **判别力（我做的变异注入）**：在内存中删掉 `editUnits.ts` 顶层的 `footnoteDefinition` 下钻分支 → `Tests 6 failed | 65 passed (71)`，红的是：
  `脚注定义的正文按块下钻…`、`脚注定义内的块级 HTML结构性只读`、`脚注定义内的 vellum-widget 围栏结构性只读`、`脚注定义内引用内的块级 HTML/围栏结构性只读`、`表格/分隔线/定义各自成块…`（最后一条只是 kind 断言）。即 **C1 的原始形态（顶层脚注定义内 HTML/widget）确实被这套断言抓住**。
- 区间不变量语料补了 4 份脚注文档（`:31-34`），28 条不变量用例全绿。

**新增破坏检查（脚注下钻的代价）** —— 我实跑：

```
300 个双段脚注（18,660 B）→ units=900，bad/overlap/oob = 0/0/0，
  解析耗时（3 轮）50–80ms（同规模纯段落文档 16,092 B → 900 units，25–38ms）
splice 脚注子块 → 结果仍完整留在脚注内（缩进与围栏未逃逸）
```

单元数只是「脚注定义 1 块 → 其子块若干块」的线性展开，无重叠、无越界（F7 不变量守住）；耗时差来自 GFM 脚注解析本身，且 `buildEditUnits` 只在提交/加载时跑（打字只改草稿），并有 `heavyDoc` 提示兜底。**不构成破坏**。

### 2. F38（终审 C2，`Ctrl+S` 双通道提交）— **ADDRESSED**

**A/B 两处都在**

- A：`src/App.tsx:148` `if (event.defaultPrevented) return;`（在修饰键判断之后、任何分支之前）；编辑框侧仍是只 `preventDefault`、不 `stopPropagation`（`src/components/BlockEditor.tsx:176-183`），与 `AGENTS.md:112` 的登记一致。
- B：hook 在途闸门 `committingRef`（`src/hooks/useDocumentEditor.ts:54`），在 mdlog 门禁之后的短路处命中即返回（`:149`），置位于 splice 之前、`flushSync` 之前（`:161`），**`finally` 复位**（`:185`）。

**回归用例是否按裁定写**（`src/App.test.tsx:1902-1923`）：`fireEvent.keyDown(textarea, …)` 打在**编辑框**上；草稿 `"Body text.\n\nNew paragraph."`（补空行 = 结构变化）；断言 `saveDocumentCalls()` **恰为 1**、载荷逐字符等于预期、`"New paragraph."` 只出现 1 次；另加一轮 `await act` 给第二次提交留出发生窗口。✓ 与裁定逐条吻合。

**时序推演（为什么现在不会重复）**

1. 编辑框 `onKeyDown` 先 `preventDefault()` 再 `requestCommit()`（组件侧 `committedRef` 只拦自己那条通道）；
2. 事件继续冒泡到 React 根容器再上 `window`，`App.tsx:148` 看到 `defaultPrevented=true` 直接返回（A）；
3. 即使漏了 A：第一次 `commitActive` 在 `flushSync` **之前**同步写了 `committingRef=true`；`flushSync` 虽把 App 重渲染并让 `editorRef.current` 换成捕获了「新 markdown + 旧 activeIndex」的新闭包，但 ref 对象共享，第二次调用（无论走新闭包与否）在 `:149` 就被挡住，**在 `spliceUnit` / `onMarkdownChange` / `save` 之前返回**（B）；
4. `finally` 复位闸门 → 落盘失败后的重试不受影响（见第 8 条）。

**判别力（我做的变异注入，与修复报告 §2 的表逐格复核）**

| 注入 | 期望 | 我实测 |
|---|---|---|
| 去掉 A（保留 B） | 绿（B 单独足够） | ✅ `Tests 1 passed | 56 skipped` |
| 去掉 B（保留 A） | 绿（A 单独足够） | ✅ `Tests 1 passed | 56 skipped` |
| A、B 都去掉（= 基线） | 红 | ❌ `Tests 1 failed`，卡在 `App.test.tsx:1915` 的 `expect(saveDocumentCalls()).toHaveLength(1)` |

另外用 jsdom 直接验证了 A 依赖的事件语义（不作为孤立旁证，仅确认测试环境不空转）：

```
descendant 调 preventDefault → root 监听 defaultPrevented=true → window 监听 defaultPrevented=true（final=true）
```

### 3. F39（终审 I1，落盘失败后切换文档带上脏草稿）— **ADDRESSED**（附一条覆盖缺口，见下）

- `resetSession()` 已从内部 `closeActive` 提升为对外接口（`src/hooks/useDocumentEditor.ts:97-101`，返回对象 `:196`；内部三处调用点同步改名 `:126/:152/:171`）。
- `App.loadPath` 的调用点在 **`isSamePath` 早退之后**（`src/App.tsx:228-231` 早退 → `:236` `editorRef.current?.resetSession()`），即**只有确认切换文档才清会话**。
- 判别力（我做的变异注入）：内存里删掉 `App.tsx` 的 `editorRef.current?.resetSession();` → `App.test.tsx -t "F39"` 红：`AssertionError: expected <textarea …(4)></textarea> to be null`。用例本身是端到端复现终审 I1 的路径（A 提交被拒 → 切到同构 B → 覆盖层清场、无隐藏块、后续 `Ctrl+S` 不写 B、两次失败尝试都只针对 A），并断言 `save_document` 的**载荷**含旧草稿只写在 A 上。✓ 非恒真。

**会不会误伤同路径重开（热重载）** —— 不会，且是结构性保证：`isSamePath` 分支在 `resetSession` 之前 `return`（`App.tsx:228-231`）。但我要指出一个**覆盖缺口**（不是缺陷）：我用变异注入**把 `resetSession` 挪到同路径早退之前**（等价于「热重载也清会话」），`src/App.test.tsx` **57 条全绿** —— 说明「同路径重开不得丢正在编辑的草稿」这条语义**没有任何用例守着**，目前只靠代码顺序与 `AGENTS.md:113` 的登记。建议补一条「编辑会话存在时同路径重开，草稿仍在」的接线用例（1 条即可）。

### 4. F40（终审 I3 / T8 I-1，`heavyDoc` 接到界面）— **ADDRESSED**

- 渲染条件正确：`src/App.tsx:883-887` `editor.viewMode === "editing" && editor.heavyDoc` 才渲染 `.editor-hint`；触发源是真实提交耗时（`src/hooks/useDocumentEditor.ts:164-169`，`renderMs > heavyCommitMs → setHeavyDoc(true)`），不是体积启发式。
- **阅读视图不受影响**：`viewMode` 门禁在前；且 `editor-hint` 由 App 层渲染在 `.app-shell__body` 内（与 `.markdown-body` 无关），不触碰「阅读视图 DOM 逐字节一致」。
- 用例真验（`src/App.test.tsx:1991-2007`）：提交前 `queryByText(/本文档较大/)` **为 null**（排除「恒存在」的假绿）→ 注入 `heavyCommitMs: 0` 提交 → `findByText` + `toHaveClass("editor-hint")` → 覆盖层卸载后提示**仍在**（常驻）。测试用 `vi.mock` **包装真实 hook、只覆盖阈值**（`:150-160`），未 mock 掉被测状态机。
- 判别力（我做的变异注入）：内存里删掉提示 JSX → 红：`Unable to find an element with the text: /本文档较大/`；删掉 `.editor-hint` 规则（该项因 CSS 测试从磁盘读文件，内存变换不生效，故以读测试代替）→ `kami.css.test.ts:370-382` 断言 `rule !== ""` 且 token/字重/圆角/无 `animation`/`pointer-events: none`，规则缺一即红。样式在 `kami.css:1282`（编辑态区段，位于首个 `.mdlog-widget`（1394）之前、不含 mdlog 字样，区段扫描约束仍满足）。

### 5. F41（T7-I1，覆盖层 DOM 层位置守卫）— **ADDRESSED**

- 用例 `src/App.test.tsx:1926-1937` 断言的正是裁定要求的**直接父元素**：
  `querySelector(".document-scroll__content--editing > textarea.block-editor__input")` **`toBe(textarea)`**、`textarea.parentElement` 带 `--editing`、`closest(".markdown-body")` 为 null。
- 报告声称「引入即绿、用变异注入证明非恒真」——**描述与断言一致，我复现了该变异**：在内存里给覆盖层多包一层 `div.mut-wrapper` →

```
× 覆盖层的直接父元素是 .document-scroll__content--editing（F41：DOM 层位置守卫）
AssertionError: expected null to be <textarea …(4)></textarea> // Object.is equality
```

与修复报告 §5 给出的红跑输出**逐字一致**（位置无关的 `querySelector` 发现不了这种漂移，这条断言能）。

### 6. F42 / F43（登记不改：iframe 重建 / 非段落块度量）— **ADDRESSED（且未越权实现）**

- 验收报告已知限制第 10、11 条已写入：`docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md:127`（F42，含下一版方案与「本次不改」的理由）、`:128`（F43，含 `Math.max(scrollHeight, lockedHeight)` 兜底与手检指引）；未解决项 `:147` 也指到 §8 第 10 条。
- **没有对 F42 做实际实现改动**：`git diff --stat 05505eb e57fc13` 不含 `src/lib/rehypeEditUnits.ts` / `src/components/MarkdownDocument.tsx`（文件清单只有 12 个，其中渲染管线两文件零改动），`.vellum-unit-wrap` 机制与 `components.pre` 均未触碰 —— 与裁定「登记不改」一致，不构成偏离。

### 7. 文档类（T8 审查四处 + CHANGELOG 声明是否为真）— **ADDRESSED**

| 项 | 现状 | 我的核实方式 |
|---|---|---|
| CHANGELOG 软提示 | `CHANGELOG.md:12`「实测提交耗时 > 800ms 时在编辑视图内挂一条常驻软提示（仅本会话内粘性）」 | **修后为真**（代码见第 4 条；不是把文案改弱，而是接线实现）。另核 `CHANGELOG.md:11` 的「引用/脚注定义内直接子块」也与 `editUnits.ts:60/134` 一致 |
| spec 哈希 | `…design.md:290` → `已交付 e82ba24；后续轮次有修改` | `git log -S "notifyInterrupted" -- src/hooks/useDocumentEditor.ts` → **`e82ba24` 首次出现**，`db001e0` 为其后修改 ⇒ 哈希正确 |
| 验收报告交叉引用 | `acceptance.md:104`→「§8 第 3 条」、`:107`→「见 §11」、`:112`→「§8 第 8 条」 | 三处逐条核对；全文档已无残留 `§7 第N条` 错引（`grep "§7 第" → exit=1`） |
| AGENTS 括注 | `AGENTS.md:111` 改为「CSS 侧由 `kami.css.test.ts` 锁死规则文本，DOM 侧由 `App.test.tsx` 断言直接父元素带 `--editing`（F41 补齐，两侧齐备才防接线漂移）」 | 与 `kami.css.test.ts:334-343` + `App.test.tsx:1926-1937` 两侧事实相符 |

另有连带校准（`AGENTS.md:112/113/114` 三条新不变量、`:116` 入口 chunk 158.53KB；`spec §14.9:324`；`acceptance §11:149`）。这些**超出**「1 处括注 + 3 处引用 + 2 条限制」的字面范围，但修复报告 §10.3 已主动声明，且内容是「让旧文档不再失真」（结构约束需要留给后续 agent），属**合理且已登记的偏差**，无回退风险。

### 8. 新破坏检查（仅限本修复 diff）

**(a) `footnoteDefinition` 下钻 → 单元数暴增 / 重叠（F7 不变量）** — 无破坏。见第 1 条探针：300 脚注 → 900 单元、0 重叠/0 越界、splice 不出脚注；28 条区间不变量用例（含 4 份脚注语料）全绿。

**(b) `heavyDoc` 新 UI 泄漏进阅读视图** — 无泄漏。`:883` 的 `viewMode === "editing"` 门禁；元素挂在 `.app-shell__body`（非 `.markdown-body`），阅读视图 DOM 不变。相关渲染管线测试未受影响。

**(c) `commitActive` 在途闸门会不会把落盘失败的重试也拦死** — **不会（重点结论）**。闸门复位在 `finally`（`useDocumentEditor.ts:185`），成功/失败/抛异常三条路径都会释放；我实跑了两条既有的 F24 重试用例（`:250`「保存失败后再次提交：只落盘一次且内容不重复」、`:279`「同内容重试仍会重新落盘」）—— `save` 在重试时确实第二次被调用（`toHaveBeenCalledTimes(2)`），并与新闸门共存通过。**这一条不构成阻断。**

---

## 新破坏

**未发现阻断级或应当修复级的新破坏。** 仅一条极窄的并发副作用（建议级），列为跟踪项：

### 【建议】F38-B 的「在途即返回 true」与 F39 的 `resetSession` 存在一个毫秒级交叉窗口

- 位置：`src/hooks/useDocumentEditor.ts:149`（在途返回 `true`）＋ `src/App.tsx:223`（`loadPath` 开头的尽力提交）＋ `:236`（`resetSession`）＋ `:180-186`（F24 失败重激活）。
- 时序：一次提交已进入 `await save`（内存已推前、`resetSession` 的 setState 已排队） → 此刻 `loadPath` 被触发 → 其 `await commitActive()` 因闸门**立刻返回 true** → `resetSession()` 清会话、开始加载新文档 → 随后那次 `save` **失败** → catch 分支 `flushSync(onMarkdownChange(旧 markdown))` + 重新激活旧块/旧草稿 ⇒ 在 `resetSession` **之后**落回一个「旧文档草稿 + 新文档路径」的会话，即终审 I1 的一种残余形态。
- 可达性：需要「提交在途（IPC 往返，几毫秒~数十毫秒）」与「切换文档」落在同一窗口。正常 UI 路径要先过系统「打开文件」对话框（秒级），故基本不可达；可达的是第二实例深链/`drain_pending_open_paths` 之类的程序化切换，仍要求毫秒级撞车。裁定 F38 的判错代价已声明「极端交错下最多多一次 IPC」，但未覆盖与本条（重激活晚于 `resetSession`）的交叉。
- 处置建议（下一版，1 处小改）：把在途闸门从「返回 true」改成「返回在途那次提交的 promise」（`committingRef` 同时持 promise），或在 `loadPath` 里于 `resetSession` 之前 `await` 到该 promise 落定再清会话。
- 我未在任何测试中发现能覆盖该窗口的用例（既有的失败重试用例走的是「上一次提交已结束」的路径）。

## 范围外观察（未改动代码 / 不在本 diff 范围，不计入判定）

1. **`toggleView` 在途提交的边沿**：`Ctrl+E` 在一次提交在途时按下，`commitActive` 因闸门立即返回 `true`，`setViewMode("reading")` 照常执行；若那次提交随后失败，F24 会重激活会话而视图已在阅读态（草稿保留、覆盖层不挂）。这与 `App.tsx:956-962` 注释里说的 T4-I3 是同一状态，且**验收报告 §8 未登记**（我 grep 未找到对应条目）——本波只是让它更难触发（不再二次落盘），未改变性质。
2. **`heavyDoc` 的度量口径**：`useDocumentEditor.ts:164-169` 量的是 `flushSync` 渲染段（整篇重解析），不含落盘 IPC。与 spec D5「实测提交耗时」的粒度略有出入，但正是「重文档」要表达的量，且阈值待真机校准（手检 #9）已登记。
3. **F39 的判错代价未写进验收报告**：裁定明示「切换瞬间丢失未提交草稿」可接受，修复报告 §3 也写了，但验收报告 §8/§11 未单列；若读者只看验收报告会以为失败草稿总能保留。
4. **脚注重度文档的解析成本**：同规模下 ~1.5–2× 纯段落（第 1 条数据）。仅提交/加载时付出，非缺陷，供后续若按 F11 退路迁移时参考。
5. **遍历清单的组合完整性**：`INNER_CONTAINERS` 覆盖了**全部四种** `BLOCK_CONTAINERS` 类型及含脚注的 7 种嵌套，但未枚举 `blockquote>list>listItem`、`listItem>blockquote` 等组合（这些路径由 `lockedKindOf` 的递归覆盖，探针确认锁定成立）。属测法边界，不是缺陷。
6. **`committingRef` 的冗余部分**：`BLOCK_CONTAINERS` 里的 `footnoteDefinition` 对 `lockedKindOf` 而言在现调用图下已被 `drill` 分流覆盖，保留它是纵深防御（我删掉顶层 `drill` 分支时它并未救场）——无风险，仅记录。

## 结论

**All findings addressed:** Yes

**Reasoning:** F37（C1）、F38（C2）、F39（I1）、F40（I3）、F41（T7-I1）五条修复均在交付代码中就位，我用「交付纯函数探针 + 仓库外内存变异注入 + 聚焦实跑」独立复现了其判别力（含 A/B 两处防护各自单独足够、同时去掉才红的完整矩阵），F42/F43 严格「登记不改」且渲染管线零改动，T8 的四处文档失真逐条修到且 CHANGELOG 的软提示声明**修后为真**；本波未引入阻断/应修级新破坏 —— 唯一的在途闸门 × `resetSession` 毫秒级交叉窗口属建议级跟踪项，落盘失败的重试路径经实跑确认**未被拦死**（`finally` 复位）。

---

## 我实际跑过的命令与输出摘要

| 命令 | 真实输出 |
|---|---|
| `git log --oneline -5` / `git diff --stat 05505eb e57fc13` | HEAD=`e57fc13`；12 文件 +440 −41（与 diff 文件一致，无未登记改动） |
| `node -e "import('file:///…/src/lib/editUnits.ts')"`（Node 24 类型剥离，直接调用交付代码） | C1 三条反例→`html:false:html` / `widget:false:widget` / `html:false:html`；顶层/引用/列表对照仍锁定 |
| 同上：300 双段脚注（18.6KB） | `units=900，bad/overlap/oob = 0/0/0`；耗时 50–80ms（同规模纯段落 25–38ms）；splice 结果不出脚注 |
| `npx vitest run src/lib/editUnits.test.ts` | `Tests 71 passed (71)`（含 14 条「容器 × 锁定块」遍历用例；verbose 确认全在、无 skip） |
| `npx vitest run src/hooks/useDocumentEditor.test.ts` | `Tests 20 passed (20)`（含 F38-B 在途重入、`resetSession` 单元用例、F24 两条重试用例） |
| `npx vitest run src/App.test.tsx -t "F38" / "F39" / "重文档"` | 各 `Tests 1 passed | 56 skipped (57)` |
| `npx vitest run src/styles/kami.css.test.ts` | `Tests 33 passed (33)` |
| **仓库外变异注入**（`%TEMP%\mut\vitest.config.mts`，内存 transform，磁盘零改动） | A 去掉→F38 绿；B 去掉→F38 绿；**A+B 去掉→F38 红**（`App.test.tsx:1915` 断言 1 次实得更多）；C（覆盖层包 wrapper）→F41 红 `expected null to be <textarea …(4)></textarea>`；E（删脚注顶层下钻）→editUnits `6 failed | 65 passed`；F（删 `resetSession` 调用）→F39 红 `expected <textarea…> to be null`；G（删提示 JSX）→F40 红 `Unable to find…/本文档较大/`；I（把 `resetSession` 挪到同路径早退之前）→**App 57 条仍全绿**（⇒ 该语义无测试守护） |
| jsdom 事件语义探针 | 后代 `preventDefault` ⇒ window 监听 `defaultPrevented=true`（guard A 的机制在测试环境成立） |
| `dist/assets` 产物核对（只读） | `index-BAtPp06D.js` = **158,538 B**、`MarkdownDocument-B2uoy_Ax.js` 262,935 B、`index-DFZWhdzK.css` 23,549 B，`dist/index.html` 指向该入口 —— 与 `AGENTS.md:116` 的 158.53KB 记账一致 |
| `git log -S notifyInterrupted -- src/hooks/useDocumentEditor.ts` | `db001e0`、`e82ba24` → 首次为 `e82ba24`（spec §14.1 的更正正确） |
| `grep "§7 第" 验收报告` / 四条交叉引用 / `AGENTS.md:111-116` | 无残留错引；四处文档修正逐条落实 |
| `git status --short`（收尾复核） | 与审查开始前完全相同（仅派发前既有的 `.pi/agents/*`、`docs/.../plans/*.md`），**本次审查未修改仓库任何文件** |

**未做**（遵守范围与只读约束）：未跑 `npm test` 全量（按指令「不要重跑整套」；修复报告声称的 31 文件/426 用例我未复验，但按各文件增量 +26 与 400 的算术一致：editUnits +19[14 遍历+1 下钻+4 语料]、App +4、hook +2、css +1）；未跑 `npm run build`（会覆写 `dist/`）；未跑 `cargo test`（本波未触碰 `src-tauri/`，diff 文件清单可证）；未做真机 GUI 手检（裁定 F35，红线仍应由用户在 WebView2 环境完成）。
