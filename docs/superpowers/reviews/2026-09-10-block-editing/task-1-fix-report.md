# Task 1 修复轮 1/5 报告 — 块单元纯函数 `editUnits`

**状态：DONE_WITH_CONCERNS**（见「未解决项」：计划文档 Task 1 代码块未同步 F7–F10；F9a 使单子块引用容器与子块区间重合而一并被打标，属预期副作用但改变了 Task 2 一条夹具的前提）
**被修对象**：`src/lib/editUnits.ts`（commit `2e2c11c`）+ 审查报告 `task-1-review.md`
**提交**：`3017ac3` `fix(edit): 块单元区间归一化与嵌套锁定类型（审查轮 1）`（单次提交，3 文件）
**基线**：修复前 `npm test` = 28 文件 / 304 用例全绿；修复后 = 28 文件 / **341 用例**全绿（net +37，全部来自 `src/lib/editUnits.test.ts` 15 → 52）

---

## 逐条修复

### 1. Critical-1 → 裁定 F7：区间重叠归一化

**修法**（`src/lib/editUnits.ts`）：
- 新增 `normalizeOverlaps(markdown, sorted)`：排序后（`start` 升序、并列时 `end` 升序）逐块检查，若 `unit.start < previous.end` 则把 `start` 推到 `Math.max(previous.end, lineStartOnOrAfter(markdown, previous.end))`；推完 `start >= end` 就**丢弃**该单元。
- 新增 `lineStartOnOrAfter(markdown, offset)`：取不小于 offset 的最近行首。之所以要「对齐行首」而不是直接夹到 `previous.end`：`previous.end` 常落在行中（如 definition 行的行尾、`- ` 标记之后），直接夹紧会让该单元的切片从半行开始，**破坏 F9a 刚建立的「切片以行首起算、自包含」语义**。裁定 F7 括号内的「夹紧」允许此细化，且比「一律丢弃」多保住了一个真实块（反例 A 的 setext 标题）。
- 反例 A：definition 与 setext heading 同起点 → 前一单元保留，heading 夹到下一行行首，切片恢复为有意义的 `"正文段落。\n---"`。
- 反例 B（及最小例）：闭合围栏同行的尾随文字 → 重叠单元的起点在行中，夹到下一行行首后越界，**丢弃**（裁定 F7 的首选方向「宁可少一个编辑入口，也不跨块写字节」）。

**红证据**（先写测试，未改实现）：
```
$ npx vitest run src/lib/editUnits.test.ts
Tests  10 failed | 41 passed (51)
 FAIL  …区间不变量（多文档集合） > 定义 + setext 标题（同起点重叠）：有序、互不重叠、非空且都在文档界内
 FAIL  …区间不变量（多文档集合） > 闭合围栏同行尾随文字（重叠）：有序、互不重叠、非空且都在文档界内
 FAIL  …区间不变量（多文档集合） > 闭合围栏同行尾随文字（最小例）：有序、互不重叠、非空且都在文档界内
 FAIL  …定义与 setext 标题同起点时归一化：保留靠前单元，后一单元夹紧到行首
   AssertionError: expected '[ref]: http://x\n正文段落。\n---' to be '正文段落。\n---'
 FAIL  …闭合围栏同行尾随文字：夹紧后落在行中的尾随单元被丢弃，不留重叠
   AssertionError: expected [ [ +0, 26 ], [ 24, 27 ] ] to deeply equal [ [ +0, 26 ] ]
```
**绿证据**：`Tests  51 passed (51)`（加入 fuzz 后为 52）。
**归一化本身被 fuzz 单独守住**（临时把 `normalizeOverlaps` 换回直接返回，验证 fuzz 是真门禁，随后恢复）：
```
$ npx vitest run src/lib/editUnits.test.ts   # 临时去掉归一化
Tests  6 failed | 46 passed (52)
 FAIL  …区间不变量（确定性 fuzz） > 任意片段拼接下都无重叠/越界/空区间，且原样回填幂等
$ npx vitest run src/lib/editUnits.test.ts   # 恢复后
Tests  52 passed (52)
```
**覆盖**：`MARKDOWN_CORPUS`（24 份文档，含两条反例 + 最小例）逐份断言「有序 / 互不重叠 / `end > start` / 在 `[0, len]` 内」；另加确定性伪随机 fuzz（固定种子 `20260910`，300 份 × 5~10 片段拼接）断言同样的不变量 + `spliceUnit` 原样回填幂等，覆盖**全部**用例文档（含所有旧用例文档）。

### 2. Important-2 → 裁定 F8：嵌套不覆盖锁定类型

**修法**：新增 `lockedKindOf(node)`，在下钻（list → listItem、blockquote → 直接子块）时优先取锁定类型，`null` 才回落到容器类型 `listItem` / `blockquoteChild`。判定规则：
- 节点自身 `type === "html"` ⇒ `"html"`；自身是 `lang === "vellum-widget"` 的 `code` ⇒ `"widget"`；
- 仅在 `list` / `listItem` / `blockquote` 这些**块级容器**里继续下钻（覆盖「列表项内嵌 widget 围栏」这类需要往子树看的情形）；
- 在 `paragraph` / `heading` / `tableCell` 处**停止**下钻 —— 那里的 `html` 是行内 HTML，不能把「带 `<span>` 的段落」误判为只读（旧用例「行内 HTML 归属所在段落，段落整体可编辑」因此仍然绿）。

**红证据**（同一次红跑，三条嵌套用例全红）：
```
 FAIL  buildEditUnits > 引用内的块级 HTML 仍结构性只读
 FAIL  buildEditUnits > 引用内的 vellum-widget 围栏仍结构性只读
 FAIL  buildEditUnits > 列表项内的原始 HTML 与 widget 围栏仍结构性只读
```
**绿证据**：52 用例全绿；三条用例分别断言 `kind` 覆盖为 `html` / `widget` / `widget`，`editable === false`，`reason` 对应。另补正向用例「列表项内只有普通块时仍按 listItem 可编辑」（`- 项\n\n  > 引用\n` → `listItem` / `editable=true`），确保没有过度锁定。

### 3. Important-3 → 裁定 F9a：区间从行首起算

**修法**：产生单元时 `start = lineStartOf(markdown, range.start)`（`markdown.lastIndexOf("\n", offset - 1) + 1`），`end` 不动。因此 `blockquoteChild` 含首行 `> `，多行引用切片自包含；`listItem` 行为不变（其 mdast 起点本来就在行首）。

**红证据**：
```
 FAIL  buildEditUnits > 多行引用单元的切片从行首起算，自包含（含首行 > 标记）
   （实测旧切片 "行一\n> 行二" ≠ 期望 "> 行一\n> 行二"）
 FAIL  buildEditUnits > 引用内引用的单元同样从行首起算
   （实测 units[0].start === 2 ≠ 0）
```
**绿证据**：`"> 行一\n> 行二\n"` 的 `blockquoteChild` 切片逐字节等于 `"> 行一\n> 行二"`；`"> > 深一层引用\n"` 的切片等于 `"> > 深一层引用"`（start=0）。

### 4. Minor-4 → 裁定 F10：删除死值 `"unmapped"`

**修法**：`EditUnit["reason"]` 改为 `"html" | "widget"`（`src/lib/editUnits.ts:34`），并加注释说明据 F10 删除。`grep -rn "unmapped" src/` 现在只剩实现里那条说明注释（计划文档仍有旧文本，见未解决项）。

### 5. Minor-5 → 裁定 F10：`try/catch` 保留为防御性代码

**修法**：注释改为「防御性代码（裁定 F10）：`fromMarkdown` 对任意字符串都能产出树、实际不抛，这里只兜住将来解析器行为变化；该分支不可达、不写测试」。分支行为（返回 `[]`）未变，未为其补测试。

### 6. Minor-10：覆盖缺口 + 类型窄化

**修法/新增用例**：
- `table` / `thematicBreak` / `other`（`definition` + `footnoteDefinition`）kind 各自断言；
- 嵌套下钻只做一层：`- 项\n\n  > 引用\n` → 仅 `listItem`；`> > 深一层引用\n` → 仅 `blockquoteChild`；
- `caretOffsetForRatio`：越界比率（`-1` → 0、`2` → 末行行首 8）、`text === ""` → 0、单行文本 → 0；
- `findUnitForRange`：部分重叠（起点在块内、终点越界）→ `undefined`；跨界区间（横跨两块）→ `undefined`；恰为块区间 → 命中；
- 类型窄化：不再使用 `(node as { lang?: string })`，改为显式守卫 `isCode(node): node is Code` / `isBlockContainer(node): node is Parent`（mdast 的 `Node` 是非联合接口、`type: string`，TS 不会按 `type` 自动窄化，故必须显式守卫）。

**这些用例的红/绿**：kind 与 `caretOffsetForRatio`/`findUnitForRange` 的新增断言在旧实现下本就通过（属覆盖缺口补齐，非缺陷修复）；`isCode`/`isBlockContainer` 的改动由 `npx tsc --noEmit` 守住：
```
$ npx tsc --noEmit          # 中间态：仓促用 `node as Parent`/裸断言导致编译不过
src/lib/editUnits.ts(1,21): error TS6196: 'Parent' is declared but never used.
src/lib/editUnits.ts(56,36): error TS2339: Property 'lang' does not exist on type 'Node'.
src/lib/editUnits.ts(58,30): error TS2339: Property 'children' does not exist on type 'Node'.
…
$ npx tsc --noEmit          # 改用类型守卫后
tsc exit=0
```
（提醒：`vitest` 走 esbuild、**不做类型检查**，本轮 6 条类型错误只有 `tsc` 能发现。）

### 附：Task 2 夹具调整（`src/lib/rehypeEditUnits.test.ts`，非 Task 2 源码）

F9a 生效后，`> 引用\n` 这类**单子块**引用的容器区间与子块区间恰好重合（旧语义下子块从 `> ` 之后起算才不重合），插件因此（正确地）给容器也打上 `data-vellum-unit="0"`。Task 2 那条用例的**断言（跨多块区间的容器不打标）没变**，只是夹具必须换成含两个子块的引用，否则它不再满足「容器跨多个块区间」的前提。

**红→绿证据**：
```
$ npm test        # F9a 实现后、夹具未改
 Test Files  1 failed | 27 passed (28)
      Tests  1 failed | 339 passed (340)
 FAIL  src/lib/rehypeEditUnits.test.ts > 跨多个块区间的容器不被打标，其内部的子块照常打标
 AssertionError: expected +0 to be undefined
$ npx vitest run src/lib/rehypeEditUnits.test.ts   # 夹具改为两子块引用后
 Test Files  1 passed (1) / Tests  5 passed (5)
```
未改 `src/lib/rehypeEditUnits.ts`、未改 `src/components/MarkdownDocument.tsx`（其块索引断言 `[data-vellum-unit="0"]`=H1、`"1"`=P、计数 2 在改动后仍全绿，常见文档块索引未变）。

---

## 验证（提交后重跑，均为新鲜输出）

| 命令 | 输出 |
|---|---|
| `npx vitest run src/lib/editUnits.test.ts` | `Test Files 1 passed (1)` / `Tests 52 passed (52)` |
| `npm test` | `Test Files 28 passed (28)` / `Tests 341 passed (341)` |
| `npx tsc --noEmit` | 无输出，`tsc exit=0` |
| `git log --oneline -1` | `3017ac3 fix(edit): 块单元区间归一化与嵌套锁定类型（审查轮 1）` |

未跑 `cd src-tauri && cargo test`：本任务未触碰任何 Rust 代码。

## 变更文件清单

| 文件 | 变更 |
|---|---|
| `src/lib/editUnits.ts` | `reason` 删除 `"unmapped"`；新增 `isCode`/`isBlockContainer` 类型守卫；新增 `lockedKindOf`（F8）；新增 `lineStartOf`（F9a）、`lineStartOnOrAfter` + `normalizeOverlaps`（F7）；`try/catch` 注释（F10）。`spliceUnit` / `caretOffsetForRatio` / `findUnitForRange` / `buildEditUnits` **公开签名未变** |
| `src/lib/editUnits.test.ts` | 15 → 52 用例：24 文档不变量集合、确定性 fuzz、三条嵌套锁定、F9a 多行引用、F7 两条回归、kind 覆盖缺口、`caretOffsetForRatio` 越界/空文本、`findUnitForRange` 部分重叠/跨界 |
| `src/lib/rehypeEditUnits.test.ts` | 仅「跨多块区间的容器不被打标」的**夹具**改为两子块引用（断言与强度不变） |

未改：`package.json` / `package-lock.json`、`src/lib/rehypeEditUnits.ts`、`src/components/MarkdownDocument.tsx`、`spliceUnit` / `caretOffsetForRatio` 公开签名。

## 与 spec / 计划的偏差

1. **F7 归一化取「夹紧到最近行首」而非「一律丢弃」**（裁定允许二者）。理由见上：保持 F9a 的切片自包含，且不丢失反例 A 中真实存在的 setext 标题编辑入口；越界时仍按裁定丢弃。
2. **F8 判定会下钻块级子树**（`list`/`listItem`/`blockquote`），因为「列表项内嵌 widget 围栏」的 listItem 节点自身既不是 `html` 也不是 `code`，只看自身无法满足裁定要求的三条用例；下钻在 `paragraph`/`heading`/`tableCell` 处停止以保护行内 HTML。
3. **改动 Task 2 的测试文件**（仅夹具，非源码）：F9a 必然使单子块引用容器与子块区间重合，旧夹具不再满足用例前提。
4. **未同步计划文档**（见未解决项）。

## 未解决项

1. **计划文档 Task 1 代码块已过时**（`docs/superpowers/plans/2026-09-10-vellum-block-editing.md`）：仍写 `reason?: … | "unmapped"`、旧下钻逻辑、旧 `caretOffsetForRatio` 文档与「PASS（15 用例）」（现为 52）。本轮未改：该文件工作区已有控制器/上一轮的未提交改动（F12/F13 等），且同步计划不在本轮修复清单内 —— 建议由计划所有者统一同步或标注「Task 1 代码块以裁定 F7–F10 为准」。
2. **F9a 的副作用**：可编辑视图下，**单子块**引用的 `<blockquote>` 容器会与子块单元区间重合，因此容器元素也会带 `data-vellum-unit`（同索引，点击映射结果不变，阅读视图无标记）。无已提交测试断言相反行为；若 Task 3 的覆盖层定位对「容器与子块同索引」敏感，需要在那里显式取最内层块。
3. **F9b（草稿/光标按 LF 归一）未在本任务落地**：按裁定属跨 T2/T4 的调用方职责（`markdown.slice(...).replace(/\r\n/g, "\n")` 两处必须一致），Task 1 只保证区间是原始偏移。
4. **审查 Minor-7 / Minor-8 / Minor-9 仍开放**（均为下游项）：CRLF 切片的 caret 偏移归一（T2/T4）；「`buildEditUnits` 区间与渲染树块级 position 对齐」的回归锁定（T2）；入口 chunk 因 `useDocumentEditor` 引入 math 解析器的体积实测（T8，裁定 F11）。
5. **反例 B / 最小例的尾随块被丢弃**（不可编辑）：这是裁定 F7「保留靠前单元」的既定取舍（安全方向、可逆）。
