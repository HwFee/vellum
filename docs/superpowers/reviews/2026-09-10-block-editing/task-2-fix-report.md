# Task 2 修复轮 1 报告 — rehype 块标记插件 + 点击解析（C1 / I1 / I2 / I3 / I4 / M1 / M4）

- **状态**：DONE（审查清单 7 项全部落实，红→绿证据齐备）
- **提交**：`1b64c53` — `fix(edit): caret 归一与包裹层测量盒 + 补齐标记测试覆盖（审查轮 1）`（单次提交，3 文件，+150/−5）
- **分支**：master（基于 `3017ac3` = Task 1 修复轮后状态）
- **基线 → 现状**：`npm test` 28 文件 / 341 用例 → **28 文件 / 345 用例全绿**（新增 4 个用例）；`npx tsc --noEmit` 退出码 0
- **范围**：未改 `src/lib/editUnits.ts`；未触碰 Task 3+ 任何文件；未新增依赖；零 Rust 改动（`cargo test` 与应用面无关，未跑）

---

## 1. 变更文件清单

| 文件 | 变更 |
|---|---|
| `src/components/MarkdownDocument.tsx` | `handleClick`：`Number.isInteger` 守卫（M4）、测量盒回退 `firstElementChild`（I1）、caret 切片先 `replace(/\r\n/g,"\n")` 归一（C1，裁定 F9b） |
| `src/lib/rehypeEditUnits.ts` | `tag()` 上方补 4 行注释，显式声明「标记可能出现在任意嵌套元素上 / 内层 `<pre>` 标记是死负载」（M1） |
| `src/components/MarkdownDocument.test.tsx` | 新增 `stubRects` 辅助 + 4 个用例；改写 raw HTML 端到端用例（I2/I3/I4） |

---

## 2. 逐条：审查缺陷 → 修法 → 红/绿证据

### C1（Critical，裁定 F9b）caret 用含 `\r` 的原始切片

- **修法**：`const source = markdown.slice(unit.start, unit.end).replace(/\r\n/g, "\n");`（`MarkdownDocument.tsx:643`）。附注释说明消费端 textarea 用的是 LF 归一文本，原始切片里行尾 `\r` 会被 `caretOffsetForRatio` 计入行宽、每行偏 +1。
- **新测试**（`MarkdownDocument.test.tsx`，用例「点击可编辑块得到精确 caret 偏移（LF 与 CRLF 均按归一文本计算）」）：块源码 `"alpha\nbeta\ngamma"`（行首偏移 0 / 6 / 11），stub 测量盒 `top=100 / height=100`，`clientY` 100 / 150 / 200 对应比率 0 / 0.5 / 1，对（块首/块中/块尾）×（LF/CRLF）6 组断言**精确 offset**。
- **红证据**（实现前，`npx vitest run src/components/MarkdownDocument.test.tsx`，13:02:55）：
  ```
  AssertionError: CRLF 块中: expected "vi.fn()" to be called with arguments: [ +0, 6 ]
    1st vi.fn() call:
      [ 0, -6, +7 ]
  ```
  （`slice = "alpha\r\nbeta\r\ngamma"` → 行宽含 `\r` → 落点 7；LF 侧 6/11 全对，即缺陷只在 CRLF 文档上暴露）
- **绿证据**（实现后，13:03:12）：`src/lib/rehypeEditUnits.test.ts + src/components/MarkdownDocument.test.tsx` → `Test Files 2 passed (2) / Tests 59 passed (59)`；全量 `npm test` → `28 passed / 345 passed`。

### I1（Important，与裁定 F12/T7 的交互）包裹层 `display: contents` ⇒ 比率恒为 0

- **修法**：
  ```ts
  const measured =
    target.getBoundingClientRect().height > 0 ? target : target.firstElementChild ?? target;
  const rect = measured.getBoundingClientRect();
  ```
  按简报要求**仅在前者不可用时**回退（普通 `<p>` 首个子元素可能是行内 `<strong>`/`<code>`，无条件用会算错盒）；注释写明 T7 的 `display: contents` 与 Chromium 返回全 0 的关系。
- **新测试**（用例「包裹层自身无布局盒（display: contents）时回退到首个元素子节点测量」）：` ```ts ` 围栏文档 → 点 `.vellum-unit-wrap` 的首个元素子节点（`.code-block`）内、`clientY=150`；stub 包裹层 `height=0`、子节点 `top=100/height=100` ⇒ 断言 caret 恰好 12（`"```ts\nalpha\nbeta\ngamma\n```"` 第 3 行行首）。
- **红证据**（实现前，13:02:55）：
  ```
  AssertionError: expected "vi.fn()" to be called with arguments: [ +0, 12 ]
    1st vi.fn() call: [ 0, -12, +0 ]
  ```
  （比率恒 0 ⇒ 不论点哪里都落在块首）
- **绿证据**：同上一并跑绿（59 passed）；全量 345 passed。

### I2（Important）阅读视图缺 `<pre>` 覆盖路径的断言

- **修法**：新增用例「阅读视图（含代码块与 widget 围栏）不产生包裹层，也没有任何块标记」：文档含 ` ```ts ` 与 ` ```vellum-widget ` 两个围栏 + 普通段落，断言 `container.querySelector(".vellum-unit-wrap") === null`、`container.querySelectorAll("[data-vellum-unit]").length === 0`（并确认代码块本身已渲染）。
- **证据**：该用例在实现前后均通过（锁定的是既有正确行为，属覆盖补齐而非缺陷修复）；全量不再存在「阅读视图零泄漏只靠推理」的空隙。

### I3（Important）caret 行为零真实断言

- **修法**：`stubRects` 辅助（按元素实例指定测量盒）替代 jsdom 的全 0 rect，使 caret 数值可精确断言；覆盖 2×2 场景（±块首/块中）+ 块尾 = 6 组，并新增用例「键盘触发点击（clientY 为 0，在块上方）时比率被钳制，光标落在块首」（块 `top=400`、`clientY=0` ⇒ 比率 −4 ⇒ 钳制后 caret 0）。原 `expect.any(Number)` 用例保留（它验证的是回调索引与 locked 分支，不重复）。
- **红/绿**：CRLF 的块中/块尾两组在实现前失败（见 C1 红证据，即 I3 要求的 CRLF 分支）；钳制用例前后均通过——它补的是分支覆盖，不掩盖任何缺陷，此处如实标注。

### I4（Important）raw HTML 相对/绝对偏移无法区分

- **修法**：改写原用例为「点击文档中部的原始 HTML 只读块回调 html 原因，锁定标记落在该 div 上」，文档由 `<div class="x">原始块</div>\n` 改为 `'前段\n\n<div class="x">原始块</div>\n'`，新增断言：`[data-vellum-locked="html"]` 的 `tagName === "DIV"`、`data-vellum-unit="1"`，且 `[data-vellum-unit="0"]` 是 `P`；随后点击该 div 断言 `onLockedUnitClick("html")` 且未触发激活。
- **证据**：用例通过 ⇒ hast position 是绝对文档偏移这一前提被测试锁定（此前只靠审查者的探针结论）。

### M1（Minor）标记可能出现在任意嵌套元素上

- **修法**：`rehypeEditUnits.ts` 的 `tag()` 上方加注释：`querySelectorAll("[data-vellum-unit]").length` 一般不等于单元数（段落内行内 `<code>`、表格内 `<tr>` 也带标记），取块索引必须用 `closest()`；并声明外层 `<pre>` 的标记是死负载（`components.pre` 不透传属性，DOM 里不存在），契约由外包容器承载。纯注释，无行为变更。

### M4（Minor）`Number(getAttribute())` 的隐式数字假设

- **修法**：两者都做了——`if (!Number.isInteger(index)) return;` 守卫 + 不变量注释（来源：`closest` 已保证属性存在、`data*` 不经 sanitize，故不可达；守卫只是显式阻断 `Number(null) === 0`）。

---

## 3. 验证命令与真实输出（提交后全新运行，13:04）

| # | 命令 | 输出 |
|---|---|---|
| 1 | `npx vitest run src/lib/rehypeEditUnits.test.ts src/components/MarkdownDocument.test.tsx` | `Test Files 2 passed (2)` / `Tests 59 passed (59)` |
| 2 | `npm test` | `Test Files 28 passed (28)` / `Tests 345 passed (345)`，`Duration 7.05s` |
| 3 | `npx tsc --noEmit` | 无输出，`TSC_EXIT=0` |
| 4 | `git status --short` | 仅剩任务开始前就存在的并发会话改动（`.pi/agents/*`、`docs/...plan.md`，未由本任务改动、未提交）；本任务 3 个文件已提交 |
| 5 | `ls outputs/__audit_scratch` | `No such file or directory`（探针目录已整体 `rm -rf`，无残留） |

红→绿证据序列（同一份最终测试文件）：

| 时点 | 命令 | 结果 |
|---|---|---|
| 13:02:55（实现前） | `npx vitest run src/components/MarkdownDocument.test.tsx` | `Tests 2 failed \| 52 passed (54)`：`CRLF 块中 expected 6 received 7`（C1）、`包裹层 expected 12 received 0`（I1） |
| 13:03:12（实现后） | 同上 2 文件 | `Tests 59 passed (59)` |

---

## 4. 与简报 / 计划的偏差说明

1. **测试桩打在元素实例上，而非 `Element.prototype`**（`stubRects`）。原因：`MarkdownDocument.test.tsx` 中已有 4 处用例（约 `:457`、`:523`、`:571`、`:627`）对 `HTMLElement.prototype.getBoundingClientRect` 打桩后**只还原 rAF spy、未还原 rect spy**，泄漏的桩会遮住 `Element.prototype` 级别的新桩，使断言结果随文件内测试顺序漂移（全量跑时 C1 用例被误报成 `LF 块中 expected 6 received 11`）。修法是让本任务的桩更具体（实例属性覆盖原型链），**未去改那些既有用例**——它们与本任务范围无关（YAGNI），但已作为关注点上报。
2. **I2/I3 钳制用例/改写的 I4 用例在实现前后均通过**：它们是覆盖补齐项（审查判定的「测试放水/空隙」），不是缺陷修复，故没有红证据；真实缺陷的红证据只有 C1 与 I1 两条，已在第 3 节给出。
3. **未跑 `cargo test`**：本任务零 Rust 改动，与简报「涉及 Rust 时」的条件不符。
4. 未派发任何子智能体；未新增依赖；`editUnits.ts` 逐字节未改（其上 T1 修复轮的 `start` 对齐行首 / 重叠归一 / 下钻锁定类型 / 无 `"unmapped"` 全部保持，且在 345 用例下全绿）。

---

## 5. 未解决项 / 关注点

1. **既有测试的 spy 泄漏（非本任务引入，但会影响后续 caret 类断言）**：`MarkdownDocument.test.tsx:457/523/571/627` 的 `HTMLElement.prototype.getBoundingClientRect` 桩未还原。本次通过实例级桩规避；若 T3 也要在 jsdom 里断言 rect 相关行为，建议由控制器决定是否单独清理（改动面小但属别的任务的文件）。
2. **包裹层 rect 行为仍需真机确认**：本修复对 `display: contents` 返回全 0 的情形做了回退，但「WebView2 下包裹层是否返回全 0」无法在 jsdom 验证；集成验证由 T7 提供 CSS 后在 T3 的编辑视图接线用例中观察（若 T7 未提供 `display: contents`，回退分支不会被触发，行为等价安全）。
3. **T7 的 `display: contents` 仍未落地**（`.vellum-unit-wrap` 目前无任何样式），编辑视图尚未接入 App，故本次修复在真机端的最终形态待 T3/T7 联调确认。
4. 审查报告 M2（`unitMarkProps` 与 `needsWrapper` 分居两文件）、M3（点链接同时触发 `openUrl` 与激活、可交互 widget 的 iframe 吸收点击）**本轮未处理**——简报只指派了 M1/M4 加小处修改，且 M3 明确交 T3/T6 决策。
