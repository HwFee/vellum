# Task 1 审查 — 块单元纯函数 `editUnits`（848899c..2e2c11c）

**规格符合结论：基本符合，但两条硬约束未守住 —— ❌ 区间互不重叠（可复现反例）、❌ HTML/widget「结构性只读」在 list/blockquote 内可绕过。判定 Needs fixes。**

被审对象：`src/lib/editUnits.ts`（156 行）、`src/lib/editUnits.test.ts`（15 用例）、`package.json`/`package-lock.json`（依赖提升）、`docs/superpowers/plans/2026-09-10-vellum-block-editing.md`（计划文本同步）。实施报告见 `task-1-report.md`。

---

## Spec Compliance

### ✅ 通过

- ✅ **交付物与接口逐字对齐**：`src/lib/editUnits.ts:15-34`（`EditUnitKind` 11 个成员、`EditUnit` 六字段 + `reason?: "html" | "widget" | "unmapped"`）、`:98` `buildEditUnits`、`:130-137` `findUnitForRange`、`:140-143` `spliceUnit`、`:147` `caretOffsetForRatio` 与 brief `Interfaces` 完全一致（签名、返回类型、顺序）。
- ✅ **不新增运行时依赖（唯一例外已登记）**：diff 仅新增 `mdast-util-math` / `micromark-extension-math` 两条直接依赖，`package-lock.json` 只改根依赖清单（`+2` 行、无任何新 `node_modules/*` 条目）→ 确属「提升传递依赖、不增安装」。`npm ls mdast-util-math micromark-extension-math remark-math` 实测：`remark-math@6.0.0 → mdast-util-math@3.0.0 deduped / micromark-extension-math@3.1.0 deduped`，与 `editUnits` 用的是**同一份实例、同一版本**（避开了 AGENTS.md 记录的 katex 式版本漂移坑）。
- ✅ **解析配置与渲染管线一致（块级）**：`editUnits.ts:11-12` 挂 `gfm()` + `math()`，与 `MarkdownDocument.tsx:220-226` 的 `remarkGfm` / `remarkMath` 对应。我核对了渲染管线多出的三个插件：`remark-cjk-friendly*` 只改强调定界符判定、`remarkMathCurrencyGuard`（`MarkdownDocument.tsx:54-84`）只把 `inlineMath` 节点替换为 `text` 节点，**都不改动块级 position** → 块级区间当前确实一致（见 Minor-6：这个前提没有测试锁定）。
- ✅ **提交规范**：diff 提交清单仅 1 条 `2e2c11c feat(edit): 块单元切分纯函数（…）`，符合 `feat(scope): 中文描述`、一次任务一次提交。
- ✅ **门禁命令**（我只跑了需要的部分，未重跑全量）：
  - `npx vitest run src/lib/editUnits.test.ts` → `Test Files 1 passed (1) / Tests 15 passed (15)`（实施报告称 15 用例，实测一致；`grep -c "  it(" src/lib/editUnits.test.ts` = 15）。
  - `npx tsc --noEmit` → 无输出，`tsc exit=0`。
  - 未重跑 `npm test`（按要求）。报告称 27 文件 / 295 用例，与 AGENTS.md 基线 26 / 280 + 本任务 1 / 15 算术自洽，无矛盾。
- ✅ **CRLF 区间按原文偏移计算**（任务书第 3 问，实测）：`# 标题\r\n\r\n正文\r\n` → `paragraph [8,16)` slice=`"正文"`；多行 CRLF 段落 `甲\r\n乙\r\n丙\r\n` → `[0,7)` slice=`"甲\r\n乙\r\n丙"`；CRLF 代码围栏 → `[20,44)` slice=`"```ts\r\nconst a = 1;\r\n```"`；CRLF `$$` 块 → `[0,13)` slice=`"$$\r\na = b\r\n$$"`。`\r` 计入偏移，切片逐字节等于原文。
- ✅ **`$$` 块可编辑且区间含定界符**：`$$\na = b\n$$\n` → `math [0,11)` slice=`"$$\na = b\n$$"` → 编辑不会丢 `$$`。
- ✅ **list / blockquote 下钻规则与计划一致（只下钻一层、不深钻）**（任务书第 2 问，实测确认确定行为）：
  - `- 一\n- 二\n- 三\n` → 3×`listItem`；`> 第一段\n>\n> 第二段\n` → 2×`blockquoteChild`；`> - 一\n> - 二\n` → 1×`blockquoteChild`（list 在引用内不再下钻，符合 brief 断言）。
  - 嵌套确定：`- 项\n\n  > 引用\n` → 1×`listItem [0,11)`（list 内 blockquote 不再下钻）；`> - 一\n>   - 嵌套\n` → 1×`blockquoteChild [2,14)`；`> > 深一层引用\n` → 1×`blockquoteChild [2,9)` slice=`"> 深一层引用"`（引用内引用不再下钻）。行为确定、无歧义，且与计划文本一致。
- ✅ **空文档**：`buildEditUnits("")` / `"\n\n  \n"` → `[]`（`editUnits.ts:99`，测试覆盖）。
- ✅ **区间排序 / 在文档内 / 非空**：4000 次随机拼接 fuzz（含畸形拼接）实测 `oob=0, empty=0`，`spliceUnit(md, u, md.slice(u.start,u.end)) === md` 恒成立（幂等 100%）。

### ❌ 不通过 / ⚠️ 待定

- ❌ **「区间互不重叠」不成立，且只被单文档用例碰巧覆盖**（任务书第 1 问）→ 见 Critical-1。
- ❌ **「HTML 与交互块结构性只读」在 list/blockquote 内被绕过** → 见 Important-2。
- ⚠️ **`blockquoteChild` / `listItem` 的区间不含首行标记、却含后续行标记**，与 `caretOffsetForRatio` 的原始切片语义叠加后，多行编辑会改结构 → 见 Important-3（跨任务，需计划层定调）。
- ⚠️ **`reason: "unmapped"` 永不产出**：`editUnits.ts:34` 声明了这个联合成员，但 `:112-113` 对无 position 的节点是**跳过**而非产出 `unmapped` 单元 → 类型与实现不一致；实测 7 类文档（段落/标题/引用/列表/围栏/公式/表格）解析后**无 position 的节点数 = 0**，该分支在当前解析器下不可达、无测试。方向安全（不提供编辑入口、无静默数据损失），但属于死值 + 死分支（Minor-4）。
- ⚠️ 报告自认的「解析失败返回空数组」兜底（`:104-108`）同样不可达且无测试（Minor-5）。
- ⚠️ 计划文档漂移（`as const`、`17 用例`、`git add` 清单）→ Minor-6。

---

## Strengths

- **依赖提升精准**：只把渲染管线已用的 math 解析器提为直接依赖，`npm ls` 证明与 `remark-math@6.0.0` 嵌套依赖 **deduped 同版**（3.0.0 / 3.1.0），这正是 AGENTS.md 里 katex 版本漂移那类事故的预防点，做对了。
- **CRLF 语义正确**：区间是原始偏移（含 `\r`），`caretOffsetForRatio` 对含 `\r` 的文本也返回与原始切片一致的偏移（`editUnits.ts:147-161` 用 `lines[i].length + 1` 而非假设 LF）。任务书第 3 问的答案是「是」。
- **`$$` 与代码围栏切片的保真性**：实测 slice 含定界符、含缩进代码块的前导空格，`spliceUnit` 幂等，块间空白逐字节保留。
- **接口非死代码**：`findUnitForRange` 已被下游实际复用（`src/lib/rehypeEditUnits.ts:1,51`，工作区已有 Task 2 代码），接口设计与消费方一致。
- **可读性**：`kindOf` / `collectUnits` / `rangeOf` 职责单一；`editUnits.ts:8-9,76,98,130,140` 的注释解释「为什么」（为什么挂 math、为什么只下钻一层），不读下游就能理解契约。

---

## Issues

### Critical (Must Fix)

**1. 区间互不重叠的不变量不成立（反例可复现），且无任何归一化/断言**
`src/lib/editUnits.ts:124-125`（`units.sort` 后直接返回，不校验不重叠）；测试仅在 `src/lib/editUnits.test.ts:11-15` 对**一个**文档断言 `units[i].start >= units[i-1].end`。

- **反例 A（合法 Markdown，无需畸形语法）**：`"[ref]: http://x\n正文段落。\n---"`（链接引用定义 + setext 标题，中间无空行）
  mdast 原始子节点：`definition [0,15)`、`heading [0,25)` → `buildEditUnits` 产出 `#0 other [0,15) edit=true` 与 `#1 heading [0,25) edit=true`，**完全重叠**（heading 的 slice 把 definition 整行都含进去）。
- **反例 B（关闭围栏同行尾随文字）**：`"- a\n\n  ```\n  x\n  ```- b\n- c\n"` → `#0 listItem [0,26)` slice=`"- a\n\n  ```\n  x\n  ```- b\n- "`、`#1 listItem [24,27)` slice=`"- c"` → **重叠 2 字节**，且 #0 的切片以半个列表标记 `"- "` 结尾（draft 本身就是截断的 token）。同类最小例：`"- a\n  ```\n  b\n  ```c\n- d\n"`。

**为何要紧**：计划 Global Constraints 把「区间必须排序、互不重叠、并集 ⊆ [0, len)」列为硬约束；不重叠一旦破了，`spliceUnit`（`:141-143`）会跨块写字节——反例 B 中用户在 textarea 里删掉那个看似坏掉的尾部 `"- "`，就会连带改掉 `#1` 的字节；`findUnitForRange`（`:132-137`）在重叠区返回「第一个包含者」，含义不再唯一。实现把不变量完全托付给解析器，属于「没有结构性保证」。

**如何修**：排序后加一次归一化（保留靠前的单元，丢弃或把 `start` 夹紧到前一块 `end` 的单元），无重叠才返回；补两条回归用例（上面两个输入 + 对全部用例统一断言 `start >= prev.end`）。

### Important (Should Fix)

**2. `editable=false` 的结构性只读在 list/blockquote 内可绕过**
`src/lib/editUnits.ts:79-90`（下钻时**强制** `kind` 为 `listItem` / `blockquoteChild`，不再调用 `kindOf`）→ `:115` 的 `locked = kind === "html" || kind === "widget"` 因此对下钻子节点永久为 false。

- 实测绕过路径（三条都可复现）：
  - `"> <div class=\"x\">hi</div>\n"` → `#0 blockquoteChild [2,25) edit=true`，slice=`"<div class=\"x\">hi</div>"`（块级 HTML 可编辑）。
  - `"> ```vellum-widget\n> <div>x</div>\n> ```\n"` → `#0 blockquoteChild [2,39) edit=true`，slice 含整段 `vellum-widget` 围栏。
  - `"- 项\n\n  ```vellum-widget\n  <div>y</div>\n  ```\n"` → `#0 listItem [0,45) edit=true`，slice 含 widget 围栏；`"- [ ] 待办\n\n  <div>raw</div>\n"` 同理（HTML 可编辑）。
- **为何要紧**：计划 Goal（计划文本第 6 行）明确「HTML 与交互块结构性只读」，Task 2 的 `onLockedUnitClick` 也只为 `"html" | "widget"` 设计；绕过后用户可以在 textarea 里改 iframe 沙箱承载的 widget HTML，`reason` 也不会上报。现有测试只覆盖顶层 HTML/widget（`editUnits.test.ts:36-55`），把「只读」误当成结构性保证。
- **如何修**：下钻时用「子节点自身的锁定类型」覆盖 kind（html 子节点 → `html`、`lang==="vellum-widget"` 的 code 子节点 → `widget`）或对下钻节点子树扫描锁定节点；补三条嵌套用例。若计划层决定「嵌套 HTML/widget 允许编辑」，那也必须**显式登记**在计划里并加测试（当前报告/计划均未提及，属未登记的偏差）。
- 附注：`> 深一层引用`（`#0 blockquoteChild slice="> 深一层引用"`）这类内部嵌套引用不受影响，问题只出在 html/widget 判定被 kind 覆盖。

**3. 单元区间与「可编辑文本」不对称：`blockquoteChild` 不含首行 `> `、却含后续行 `> `；`listItem` 含 `- ` 标记**
`src/lib/editUnits.ts:79-90`（区间直接取 mdast `position.offset`）。实测：

- `"> 行一\n> 行二\n"` → slice=`"行一\n> 行二"`：第 1 行的 `> ` 在区间外，第 2 行的 `> ` 在区间内。
- `"> - 一\n> - 二\n"` → slice=`"- 一\n> - 二"`：这不是一份自洽的列表源码。
- `"- 项\n\n  > 引用\n"` → slice 含 `"  > 引用"`；`"> > 深一层引用\n"` → slice=`"> 深一层引用"`。

**为何要紧**：下游（`docs/superpowers/plans/2026-09-10-vellum-block-editing.md:1029,1047`：`setDraft(markdown.slice(unit.start, unit.end))`；:543 `caretOffsetForRatio(source, ratio)`）把这段原始切片直接塞进 textarea。用户若整段重打（最常见：全选覆盖），引用第 2 行起会**逃出引用块**、列表项会**变成段落**——不是数据丢失，但是静默的结构改变，且 `spliceUnit` 不会报错。计划里没有任何地方登记「draft = 原始源码，标记需用户自行保留」，也没写「Task 5 负责按行补 `> `/缩进」。
**如何修**：要么在计划里显式登记该语义并让 Task 5 提交时按原前缀回填（或至少给用户可见提示），要么统一标记归属（例如 `blockquoteChild` 区间从 `>` 起算，与 `listItem` 含 `- ` 保持一致），并在 Task 1 加多行引用的回归用例。

### Minor (Nice to Have)

**4. `reason: "unmapped"` 是死值，跳过分支无测试** — `editUnits.ts:34` vs `:112-113`。实测 7 类文档无 position 节点数 = 0，与 `fromMarkdown` 行为一致（不可达）。修：删掉该联合成员，或改为产出 `{editable:false, reason:"unmapped"}` 单元使其可达（并可被 Task 2 的 `onLockedUnitClick` 兜底），二者取其一，别留死值。

**5. 解析失败兜底无测试且不可达** — `editUnits.ts:104-108`。方向安全（不提供编辑入口），但没有用户可见提示（报告已自认）。建议注释为防御性代码，或删掉 try/catch（`fromMarkdown` 实际上不抛）。

**6. 计划文档与实现/实际提交漂移（同一次提交内改了计划）** —
`docs/superpowers/plans/2026-09-10-vellum-block-editing.md:188-191` 计划仍写 `} as const;`，实现（`editUnits.ts:10-13`）已去掉（去掉是对的：`mdast-util-from-markdown` 的 `mdastExtensions?: Array<Extension | Array<Extension>>`（`node_modules/mdast-util-from-markdown/lib/types.d.ts:278`）是可变数组，`readonly` 元组会 tsc 报错）；`:308` 计划写「PASS（17 用例）」实际 15；`:316` 的 `git add` 未含 `package.json` / `package-lock.json`，而本次提交实际改了 5 个文件。都不影响运行，但计划文本已不再可作为可执行步骤。
（`caretOffsetForRatio` 的语义修改 `expect(...).toBe(10)` → `8` 属**已登记**的偏差：原文行首偏移只有 0/4/8/12，10 不存在，旧断言本身自相矛盾；实现同时在 `:149-150` 补了「尾随空行不计」的理由，方向正确——`lines.length > 1` 的守卫也处理了 `text=""` 的边界。）

**7. CRLF 文档的初始光标会偏（跨任务）** — Task 1 自身正确；但下游 `plan:1047` 把含 `\r\n` 的切片塞进 textarea（HTML 会把 value 归一为 LF），`plan:543` 用**含 `\r` 的原始切片**算出的 caret 偏移会被 `setSelectionRange` 用在 LF 文本上 → 多行 CRLF 块的落点偏「光标前 `\r` 的个数」。修在下游（算 ratio 前先归一化切片，或减去前置 `\r` 数），这里登记以免被漏掉。

**8. 「解析配置一致」靠注释维持，无测试锁定** — `editUnits.ts:8-9` 的断言（必须与渲染管线一致）目前靠人工核对：我确认 `remarkMathCurrencyGuard`（`MarkdownDocument.tsx:54-84`）只替换 `inlineMath` 节点、不动块级 position，所以当前一致；但将来渲染侧加任何**块级**插件都会静默错位。建议在 Task 2 加一条「同文档 `buildEditUnits` 区间与渲染树块级 position 对齐」的回归。

**9. 体积口径（⚠️ 留给 Task 5）** — 计划 Global Constraints 说 math 依赖「不增体积」。事实：`remark-math` 只被 lazy chunk 引用（`src/App.tsx:29` `lazy(() => import("./components/MarkdownDocument"))`），`micromark-extension-math` 目前不在入口 chunk（入口 chunk 只经 `src/lib/outline.ts:3-6` 拿到 `mdast-util-from-markdown` + gfm）。Task 5 若把 `editUnits` 接入 App 侧（`useDocumentEditor`），math 解析器会进入口 chunk。Task 1 本身不改 chunk 组成，故只登记。

**10. 测试覆盖缺口（非放水，属未覆盖）** — `editUnits.test.ts` 未覆盖：`table` / `thematicBreak` / `other`（definition、footnoteDefinition）kind、嵌套下钻（list 内 blockquote、引用内引用）、`caretOffsetForRatio` 的越界/NaN 与 `text=""`、`findUnitForRange` 的部分重叠与跨界区间、以及上面 Critical-1 的两条反例。另：`:52` 用 `(node as { lang?: string })` 而非 `node.type === "code"` 的类型窄化（mdast 的 `Code` 已有 `lang`），断言掩盖了类型信息。

---

## 我实际跑过的命令与输出摘要

| 命令 | 输出 |
|---|---|
| `npx vitest run src/lib/editUnits.test.ts` | `Test Files 1 passed (1) / Tests 15 passed (15)`，1.24s |
| `npx tsc --noEmit` | 无输出，`tsc exit=0` |
| `grep -c "  it(" src/lib/editUnits.test.ts` | `15` |
| `npm ls mdast-util-math micromark-extension-math remark-math` | `mdast-util-math@3.0.0` / `micromark-extension-math@3.1.0` / `remark-math@6.0.0` → 嵌套两条均 `deduped` |
| `node --input-type=module`（逐字复刻 diff 中 `buildEditUnits` 逻辑，直接调用 node_modules 里的 `mdast-util-from-markdown` + gfm/math 扩展） | 20+ 组样例：CRLF 段落/围栏/`$$` 切片逐字节正确；`$$` 含定界符；`listItem`/`blockquoteChild` 下钻行为与计划一致；**发现 2 类区间重叠**（见 Critical-1）；块级 HTML/注释、widget 顶层 locked 正确 |
| 同上（fuzz：4000 × 随机拼接 / 6000 × 仅 `\n\n` / 6000 × 仅 `\n` / 6000 × `\n`+`\n\n`，片段池含列表/引用/围栏/widget/公式/表格/HTML/定义/脚注/task list） | `oob=0, empty=0, nonIdem=0`；重叠：畸形拼接 7/4000、仅 `\n` 2/6000（`definition` + setext `heading` 同起点，见 Critical-1 反例 A）、仅 `\n\n` 0/6000 |
| `grep -rn "unmapped" src/` | 仅 `src/lib/editUnits.ts:34`（无产出点） |
| `grep`（渲染管线/`language === "vellum-widget"`/`remark-math` 引用者/`MarkdownDocument` 是否 lazy） | `MarkdownDocument.tsx:220-226` 插件表；`MarkdownDocument.tsx:405` widget 判定与 `editUnits.ts:51-52` 的 `lang === "vellum-widget"` 同为大小写敏感 → 顶层判定一致；`App.tsx:29` lazy |
| 只读计划文本 `docs/superpowers/plans/2026-09-10-vellum-block-editing.md:41-56,132-165,188-191,298-318,330-345,477,520-547,1000-1090,1280-1305` | 用于核对接口、`spliceUnit`/`caretOffsetForRatio` 的消费方式与 CRLF 归一策略（Important-3、Minor-6/7/9 的证据来源） |

未做：未重跑 `npm test` 全量（按要求）、未重跑 git 命令、未运行 `npm run build`（会写 `dist/`）、未修改任何文件。

---

## Assessment

**Task quality: Needs fixes**

**Reasoning:** 纯函数骨架、CRLF 偏移语义、math 依赖提升与下钻规则都做对了（fuzz 下排序/范围/幂等全绿）；但计划列为硬约束的「区间互不重叠」在合法 Markdown（`[ref]: …` + setext 标题）与畸形围栏上都会破，实现没有归一化也没有统一断言，`spliceUnit` 因此可能跨块写字节；同时 `editable=false` 的 HTML/widget 只读在 list/blockquote 内被 kind 覆盖绕过，与计划 Goal 不符。两条都不是难修的改动（各加一段归一化/锁定判定 + 回归用例），修完即可通过。
