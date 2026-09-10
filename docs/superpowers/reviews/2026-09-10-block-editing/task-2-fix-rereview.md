# Task 2 修复轮 1 — 限定范围重审（base `3017ac3` → head `1b64c53`）

审查者：独立复核（只读，未修改任何文件；未派发子智能体）。
重审范围：上一轮报告的 C1 / I1 / I2 / I3 / I4 / M1 / M4 + 本修复 diff 是否引入新破坏。已通过的代码不再重开。

工作区状态：`git rev-parse HEAD` = `1b64c53`，`src/**` 三文件工作区与提交一致（`git status --short` 无 src 改动）⇒ 我读到的磁盘源码即被审 diff 的代码。

---

## 逐条判定

### 1. C1 / 裁定 F9b — **ADDRESSED**

- **代码**：`src/components/MarkdownDocument.tsx:644`
  ```ts
  const source = markdown.slice(unit.start, unit.end).replace(/\r\n/g, "\n");
  ```
  在 `caretOffsetForRatio` 之前归一，与裁定 F9b「T2 的点击回调算 caret 前先归一」一致。归一发生在**切片之后、算偏移之前**，位置正确。
- **新增用例断言的是精确 offset，不是 `expect.any(Number)`**：`src/components/MarkdownDocument.test.tsx:1170-1175` 六组 `expected`（LF/CRLF × 块首/中/尾）为字面量 `0 / 6 / 11`；断言在 `:1187-1188`。
- **我自己的验算（用真实模块跑出，不是照抄报告）**：
  ```
  node --input-type=module -e "import('./src/lib/editUnits.ts') ..."
  "alpha\r\nbeta\r\ngamma\r\n\r\nend\r\n"  unit0 0 18  raw="alpha\r\nbeta\r\ngamma"  norm="alpha\nbeta\ngamma"
     ratio 0   raw->0   norm->0
     ratio 0.5 raw->7   norm->6      ← 测试期望 6
     ratio 1   raw->13  norm->11     ← 测试期望 11
  "alpha\nbeta\ngamma\n\nend\n"  unit0 0 16
     ratio 0/0.5/1 → 0/6/11         ← 与测试期望一致
  ```
  即：**去掉 `.replace(/\r\n/g,"\n")` 后块中/块尾必然得 7/13，测试必红**；块首 0 在两侧相同（该项是补位，不是鉴别项，但无害）。裁定里点名要求的首/中/尾三种位置均已覆盖，CRLF 的三组期望值与归一后文本的真实行首偏移（0/6/11）完全吻合。

### 2. I1 — **ADDRESSED**

- **代码**：`src/components/MarkdownDocument.tsx:637-639`
  ```ts
  const measured =
    target.getBoundingClientRect().height > 0 ? target : target.firstElementChild ?? target;
  const rect = measured.getBoundingClientRect();
  ```
  ⇒ 回退**只在** `target` 自身 rect 高度为 0 时发生，**不是**无条件用首子元素。这正是审查要求的形状。
- **「可编辑段落含行内 `<strong>`/`<code>` 会不会算错盒」**：段落自身 rect 高度 > 0（真机可见块恒成立），走 `? target` 分支，测的是段落盒 ⇒ 不会因为首子元素是行内元素而算错盒。只有段落 rect 为 0 的极端布局才走回退，见「新破坏」第 2 条。
- **新增用例**：`MarkdownDocument.test.tsx:1213-1239`（包裹层 stub `height=0`、首子节点 stub `top=100/height=100`、`clientY=150` ⇒ 期望 caret 12）。去掉回退时 `measured = target`（height 0）⇒ `rect.height > 0 ? ... : 0` ⇒ caret 0 ≠ 12，**该用例对回退有鉴别力**。
- 我用真实模块核过期望值：`` md = "```ts\nalpha\nbeta\ngamma\n```\n" `` → unit0 `0..26`，`caretOffsetForRatio(text, 0.5)` = 12（行首依次 0/6/12/17/23，与用例注释一致）。

### 3. I2 — **ADDRESSED**

- `MarkdownDocument.test.tsx:1145-1164`：文档含普通段落 + ` ```ts ` 围栏 + ` ```vellum-widget ` 围栏（`:1146-1155`），断言
  `container.querySelector(".vellum-unit-wrap")` → `toBeNull()`（`:1161`）、
  `container.querySelectorAll("[data-vellum-unit]").length` → `toBe(0)`（`:1162`），
  并附 `.code-block` 存在性断言（`:1163`）证明代码块确实渲染过（防止「文档没解析出围栏」的假绿）。
- 即审查要求的「含 `<pre>` 覆盖路径 + 两个负向断言」已落实（阅读视图零泄漏不再只靠推理）。

### 4. I3 — **ADDRESSED**

- 精确 caret 断言：`MarkdownDocument.test.tsx:1166-1194`（stubRects 打桩 `:1185`，断言 `:1188`），覆盖块首/中/尾 × LF/CRLF 共 6 组。
- 钳制：`MarkdownDocument.test.tsx:1196-1211`，块 `top=400`、`clientY=0` ⇒ 比率 −4，断言落点 `0`（`:1206-1207`）。
- 测量盒分支的真实性由 `stubRects`（`:32-49`）保证：按**元素实例**指定 `top/height`，绕过 jsdom 全 0 rect，使「点击高度 → 比率 → 源码偏移」成为可断言的真实通路。原 `expect.any(Number)` 用例保留（`:1105`，验证索引与 locked 分支，不与新用例重复）。

### 5. I4 — **ADDRESSED**

- `MarkdownDocument.test.tsx:1110-1133`：文档改为 `'前段\n\n<div class="x">原始块</div>\n'`（`:1117`，offset ≠ 0），断言
  锁定元素 `tagName === "DIV"`（`:1125`）、`data-vellum-unit="1"`（`:1126`）、前置块 `[data-vellum-unit="0"]` 是 `P`（`:1128`）。
- 该用例对「hast position 是相对还是绝对」有鉴别力：若为块内相对偏移，`findUnitForRange` 会命中 0 号段落 ⇒ `[data-vellum-locked="html"]` 查不到（`locked.tagName` 直接抛错），断言必红。此前只靠审查探针的结论现在被测试锁定。

### 6. M1 / M4 — **ADDRESSED**

- **M1 / 裁定 F16（打标口径注释）**：`src/lib/rehypeEditUnits.ts:29-33` 显式声明「任意嵌套元素都会被打标 ⇒ `querySelectorAll("[data-vellum-unit]").length` 一般不等于单元数、计数必须改用 `buildEditUnits(markdown).length`、取索引必须用 `closest()`」，并声明 `<pre>` 自身标记是死负载、契约由外包容器承载。纯注释、零行为变更（`git show --stat 1b64c53` 该文件 +5/−0）。
- **M4（`Number(...)` 守卫 + 不变量注释）**：`src/components/MarkdownDocument.tsx:621-624`
  ```ts
  // 不变量：closest 已保证属性存在、且 data* 不经 sanitize（标记插件在 sanitize 之后）…
  if (!Number.isInteger(index)) return;
  ```
  守卫 + 注释都有，来源也说清了。`units.find(c => c.index === index)`（`:625`）紧随其后，语义可读。

### 7. 新破坏检查（仅限本 diff）

- **`stubRects` 是否泄漏到其他用例** — **不泄漏**，证据三条：
  1. 三处调用点全部 `try/finally` + `spy.mockRestore()`（`:1186-1191`、`:1204-1210`、`:1228-1238`）；CRLF 循环内还在 finally 里 `unmount()`（`:1190`）。
  2. 桩打在**元素实例**上；`node_modules/@vitest/spy/dist/index.js:236-241` 的 `restore()` 对「方法定义在原型上」的情形执行 `Reflect.deleteProperty(object, key)` ⇒ 实例恢复后连自有属性一起删掉，不回写、不影响其他元素与其他用例。
  3. 隔离运行新用例同样通过（无「靠前面用例的桩才绿」）：
     `npx vitest run src/components/MarkdownDocument.test.tsx -t "caret 偏移"` / `-t "包裹层自身无布局盒"` / `-t "键盘触发点击"` → 各 `1 passed | 53 skipped`。
- **`measured` 回退链是否改变未包裹普通块的 caret 语义** — **有理论上的行为变化，但无可达回归**：
  仅当 `target` 自身 rect 高度为 0 且其 `firstElementChild` 存在且高度 > 0 时才与旧行为分叉（旧：比率恒 0 ⇒ 落块首；新：在该子元素盒上算比率）。
  - 空段落 / 纯文本段落：`firstElementChild === null` ⇒ `?? target` ⇒ 与旧行为逐字节等价（比率 0）。
  - 可点击的可见块在真机上 rect 高度 > 0 ⇒ 不分叉。
  - 与键鼠触发无关：`clientY=0` 的键盘触发用例（`:1196`）在 rect 高度 > 0 时行为不变。
  ⇒ 判为**非阻断**，但回退的可达面确实比「仅包裹层」宽，建议见下（建议 1）。
- **是否存在「写早就绿」的用例（放水）** — 逐条判定：
  - `:1145-1164`（I2 阅读视图）、`:1196-1211`（I3 钳制）、`:1110-1133`（I4 改写）在修复前后均绿 —— 报告第 4.2 条已主动如实标注。
  - 是否属放水：**否**。三者都断言真实行为且对各自风险面有鉴别力（I4 对相对/绝对偏移、钳制对 `Math.max(0, ratio)`、I2 对阅读视图泄漏）；它们补的是覆盖空隙（上一轮判定的 I2/I3/I4 正是「测试放水/空隙」），不是假修复。
  - 真正红→绿的两条为 `:1166-1194`（C1）与 `:1213-1239`（I1）；红的方向我已用真实模块验算（见第 1、2 条），非采信报告。
  - 唯一「理论上被削弱」的分支：`rect.height > 0 ? ... : 0` 的 **else 侧**（measured 高度仍为 0）在包裹路径上基本不可达，没有直接用例；不属要求覆盖项，仅为观察。

### 规约符合（本 diff 范围）

- 依赖：`git show --stat 1b64c53` 仅 3 个文件（+150/−5），无 `package.json` 改动 ⇒ 未新增依赖。
- 死规则/性能结构：未触碰 `CodeBlock.tsx`/`PrismLight`、搜索高亮与 layout effect、`WidgetSandbox`、`animateScrollTo`、`units`/`editUnitOptions`/`rehypePlugins` 的 memo 依赖（`MarkdownDocument.tsx:613`、`:348`、`:350-366` 未变）⇒ 无热重载整篇重解析风险引入。
- `DESIGN.md`：diff 不涉 CSS/色板/字重/圆角，不改任何 UI 文案，无 emoji（注释里的 `⇒` 是箭头符号，项目注释既有用法）⇒ 符合。

---

## 新破坏

**无阻断级新破坏。** 唯一需要点名的形状变化是「回退链的可达面宽于包裹层」，理由与建议如下（不阻断）：

- `src/components/MarkdownDocument.tsx:637-639`：回退条件是「自身 rect 高度为 0」，因此理论上对**未包裹**的块也生效（例如某块 rect 高 0 但首子元素有高度）。真机可见块不受影响，空段落因 `?? target` 与旧行为等价，故不构成回归；但更精确、更省一次 rect 读数的写法是把回退限定在已知容器上，例如
  ```ts
  const targetRect = target.getBoundingClientRect();
  const rect = targetRect.height > 0
    ? targetRect
    : (target.classList.contains("vellum-unit-wrap") ? target.firstElementChild : null)?.getBoundingClientRect() ?? targetRect;
  ```
  或 `target.matches(".vellum-unit-wrap")` 分支。这同时消掉常见路径上对同一元素的第二次 `getBoundingClientRect()`。
  （当前实现的第二次调用只是重复读布局，无写入插入，不构成布局抖动；属**建议**而非缺陷。）

---

## 范围外观察（只登记，不延长循环）

1. **既有用例的 rect 桩未还原**（非本 diff 引入）：`MarkdownDocument.test.tsx:457`、`:523`、`:571`、`:627` 对 `HTMLElement.prototype.getBoundingClientRect` 打桩后未 `mockRestore`（vitest 配置未开 `restoreMocks`，`vite.config.ts:66-73`）。本修复用**实例级**桩绕开（`stubRects` 注释 `:29-31` 已说明），但该泄漏仍是本文件后续任何 rect 类断言的隐患；清理属别的任务面的改动。
2. **「最内层标记元素」当测量盒**（本 diff 未改变该语义）：`rehypeEditUnits.ts:41-63` 会给区间内任意嵌套元素打标（行内 `<strong>`/`<code>` 等；`components.a` 因不透传属性反而不会拿到标记），而 `handleClick` 用 `closest("[data-vellum-unit]")`（`MarkdownDocument.tsx:620`）取**最近**元素，故点行内加粗/行内代码时测量盒是该行内元素自身的盒（只在某一行），比率到源码行的映射会偏。修复前行为相同（旧代码也测 `target`），非本 diff 引入；裁定 F16 只锁了「索引语义」，未涉及测量盒精度。若后续 T3 真机联调发现光标落点不满，这是一处候选修法（改用块级标记/向外的块元素作测量盒）。
3. **换行归一的口径**（T4 必须对齐）：本 diff 与裁定 F9b 一致只归一 `\r\n`（`MarkdownDocument.tsx:644`）。纯 `\r` 行尾文档不受此归一影响（`caretOffsetForRatio` 按 `\n` 切行，纯 CR 文档不论点击何处都落块首），属既有缺口，非本任务范围；T4 归一必须用**同一表达式**，否则两处口径会重新分叉。
4. **并发工作区**：本次全量 `npm test` 为 `29 files / 347 passed`，比修复报告声称的 `28 / 345` 多出 `src/components/BlockEditor.test.tsx`、`src/lib/editorGeometry.ts(+test)` 等**未跟踪**文件（`git status --short --ignored src` 显示 `??`），由并发的 Task 3 会话写入；与 `1b64c53` 无关，重审按要求未重跑整套之外的额外组合。
5. **报告细节误差（无实质影响）**：修复报告写 C1 修法在 `MarkdownDocument.tsx:643`，实际为 `:644`；`rehypeEditUnits.ts:32` 注释里「外层 `<pre>`」的措辞与「包裹层在外、`<pre>` 在内」的树结构相反（意思可读，纯文案）。

---

## 我实际跑过的命令与输出摘要

| # | 命令 | 输出 |
|---|---|---|
| 1 | `npx vitest run src/lib/rehypeEditUnits.test.ts src/components/MarkdownDocument.test.tsx` | `Test Files 2 passed (2)` / `Tests 59 passed (59)`，`Duration 3.11s`（13:06:05） |
| 2 | `npm test` | `Test Files 29 passed (29)` / `Tests 347 passed (347)`，`Duration 8.87s`（13:06:35；多出的文件见范围外观察 4） |
| 3 | `npx tsc --noEmit` | 无输出，`TSC_EXIT=0` |
| 4 | `npx vitest run src/components/MarkdownDocument.test.tsx -t "caret 偏移"` / `-t "包裹层自身无布局盒"` / `-t "键盘触发点击"` | 各 `1 passed | 53 skipped (54)` ⇒ 新用例不依赖文件内测试顺序，无桩泄漏依赖 |
| 5 | `node --input-type=module` + `import('./src/lib/editUnits.ts')`（真实模块，非转写） | CRLF 原始切片 `0.5/1 → 7/13` vs 归一后 `6/11`；` ```ts ` 块 `0.5 → 12` ⇒ C1、I1 用例的期望值与鉴别力均成立 |
| 6 | `git rev-parse HEAD` / `git status --short` / `git status --short --ignored src` / `git show --stat 1b64c53` | HEAD=`1b64c53`；src 三文件与提交一致；未跟踪的 Task 3 文件见观察 4；修复提交 3 文件 +150/−5 |
| 7 | `grep -n "getBoundingClientRect" src/components/MarkdownDocument.test.tsx` + 读 `node_modules/@vitest/spy/dist/index.js:215-243` | 既有原型级桩位于 `:457/:523/:571/:627`（未还原）；spy restore 对原型方法执行 `Reflect.deleteProperty` ⇒ `stubRects` 无泄漏 |

（未重跑 pre-fix 代码以取「红」实况：那需要修改工作区文件，超出只读授权；红方向改由第 5 条的真实模块验算证明——原始切片得 7/13 ≠ 期望 6/11、无回退时比率恒 0 ≠ 期望 12。）

---

## 结论

**All findings addressed: Yes**

**Reasoning:** C1（`MarkdownDocument.tsx:644` 归一）与 I1（`:637-639` 仅高度为 0 时回退首子元素）都在正确的代码位置上，其新增用例断言精确 offset 且经验算确有红→绿鉴别力；I2/I3/I4 的空隙已按裁决要求补齐（含围栏的阅读视图零泄漏、钳制与块首/中/尾、offset≠0 的 raw HTML），M1/M4 的注释与守卫已落地；`stubRects` 三处调用均 restore、隔离运行亦通过，回退链未对未包裹块产生可达回归。仅剩两条建议级改进（回退限定到 `.vellum-unit-wrap`、最内层标记元素当测量盒的固有精度）与若干范围外观察，不构成驳回理由。
