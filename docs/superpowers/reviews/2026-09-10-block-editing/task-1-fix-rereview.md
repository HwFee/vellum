# Task 1 修复轮 1 重审（限定范围）— `review-3ad0f80..3017ac3.diff`

**范围**：只判定 `task-1-review.md` 的待判定清单 + 裁定 F7/F8/F9a/F10 是否落地，以及本 diff 是否引入新破坏。
**被审**：`3017ac3`（base `3ad0f80`），3 文件：`src/lib/editUnits.ts`(+97/-?)、`src/lib/editUnits.test.ts`(15→52 用例)、`src/lib/rehypeEditUnits.test.ts`（仅夹具，16 行）。
**只读确认**：`git diff --stat HEAD -- src/lib/editUnits.ts src/lib/editUnits.test.ts` → 空（被审两文件与 HEAD 逐字节一致，我的实测即被审代码）。探针脚本一律放在系统临时目录（`%TEMP%\vellumprobe`），未改动仓库任何文件，事后已删除（含 `mklink /J` 联接，用 `rmdir` 只删链接）。

---

## 逐条判定

### 1 — Critical-1 → 裁定 F7（区间重叠归一化）— **ADDRESSED**

| 判定点 | 结论 | 证据 |
|---|---|---|
| 排序后是否真做了归一化 | 是 | `src/lib/editUnits.ts:141-156` `normalizeOverlaps`，调用点 `:187-188`（`:187` 排序 `start` 升序/并列 `end` 升序，`:188` 归一化）；逐条对 `kept` 栈顶比较 `:144-147`，夹紧 `Math.max(previous.end, lineStartOnOrAfter(...))` `:149`，夹空则 `continue` 丢弃 `:150` |
| 两个反例是否进测试 | 是（+最小例） | `src/lib/editUnits.test.ts:22`（`"[ref]: http://x\n正文段落。\n---"`）、`:23`（围栏尾随文字）、`:24`（最小例）；专项断言 `:227-236`、`:238-244` |
| 是否对全部用例加不变量断言 | 是 | `:35-48` `it.each(MARKDOWN_CORPUS)`（24 份，断言 `start>=0` / `end>start` / `end<=len` / `start>=prev.end`）；`:77-96` 确定性 fuzz（固定种子 `20260910`，300 次，含 `spliceUnit` 原样回填幂等）；`:282-288` corpus 全集回填幂等 |
| 归一化后是否可能产生空切片 | 否 | 构造期 `start = lineStartOf(range.start) <= range.start < range.end`（`:179-180`；`rangeOf` `:37-43` 保证 `end>start`），夹紧分支又有 `:150` 守卫 → 任何入栈单元恒有 `start<end`。实测 2951 份 fuzz 拼接 + 124 份仓库真实 `.md`（共 7987 单元）`empty=0` |

**红→绿真实性（我独立复跑旧实现 `git show 2e2c11c:src/lib/editUnits.ts`）**：
```
反例 A  旧: [0,15) other | [0,25) heading  ← OVERLAP      新: [0,15) other | [16,25) heading
反例 B  旧: [0,26) listItem | [24,27) listItem ← OVERLAP  新: [0,26) listItem（后者丢弃）
```
→ 两条回归用例确为真红→绿。
**我的命令输出**：`npx vitest run src/lib/editUnits.test.ts` → `Test Files 1 passed (1) / Tests 52 passed (52)`。

### 2 — Important-2 → 裁定 F8（嵌套 HTML/widget 仍结构性只读）— **ADDRESSED**

- 实现：`lockedKindOf(node)` `src/lib/editUnits.ts:67-77`；下钻时 `kind: lockedKindOf(child) ?? fallbackKind` `:111-114`（不再无条件用容器类型）。下钻白名单 `BLOCK_CONTAINERS = list/listItem/blockquote` `:58`，在 `paragraph`/`heading`/`tableCell` 停（`:59-61` 只认容器）。
- 三条嵌套用例（`:170-176` 引用内 HTML、`:178-184` 引用内 widget、`:186-198` 列表项内 HTML+widget）均断言 `kind` / `editable === false` / `reason`。
- **我实测新旧对比**（真实模块 vs `/tmp` 内旧实现）：

| 文档 | 旧实现 | 新实现 |
|---|---|---|
| `> <div class="x">hi</div>` | `blockquoteChild editable=true` | `html editable=false reason=html` |
| `> ```vellum-widget…` | `blockquoteChild editable=true` | `widget editable=false reason=widget` |
| `- [ ] 待办\n\n  <div>raw</div>` | `listItem editable=true` | `html editable=false reason=html` |
| `- 项\n\n  ```vellum-widget…` | `listItem editable=true` | `widget editable=false reason=widget` |

- 无过度锁定（我实测）：`带 <span>行内</span> 标签的段落。` → `paragraph editable=true`；`- 项\n\n  > 引用\n` → `listItem editable=true`；`> - 一\n> - 二\n` → `blockquoteChild`（`list` 内无 HTML/widget，回落容器类型）。

### 3 — Important-3 → 裁定 F9a（行首起算）— **ADDRESSED**

- 实现 `lineStartOf` `:125-127`，应用 `:179`。
- `"> 行一\n> 行二\n"` 实测：unit `[0,9)`，切片逐字节 `"> 行一\n> 行二"`（`:209-215` 用例同断言）；旧实现是 `[2,9)` / `"行一\n> 行二"`。`"> > 深一层引用\n"` 实测 `[0,9)` / `"> > 深一层引用"`（`:217-225`）。
- **行首对齐 × 归一化的相互作用安全性**：lineStartOf 只把 `start` 左移，确实可能与前一块重叠，但归一化在**其之后**执行（`:187-188`）并把 `start` 右移夹到「≥ 前一块 end 的最近行首」，且 `lineStartOnOrAfter` `:130-137` 只返回行首 → 不会出现半行起点。我用「逐字复刻私有逻辑」的探针在 3000 份 fuzz 文档上与真实模块输出比对 **`mismatch=0`**，并统计：**由对齐新引入的 overlap = 0**，原始就重叠的 5 处全部被归一化消解。故相互作用安全。

### 4 — Minor-4/5 → 裁定 F10 — **ADDRESSED**

- `src/lib/editUnits.ts:35`：`reason?: "html" | "widget";`（已删 `"unmapped"`）；`grep -rn "unmapped" src/` 仅剩 `:34` 的说明注释，无任何产出点/消费点（`npx tsc --noEmit` exit=0）。
- `try/catch` 保留并注明防御性：`:164-170`，注释 `:166`「防御性代码（裁定 F10）… 该分支不可达、不写测试」→ 与裁定「不为其补测试」一致。

### 5 — Minor-10 覆盖缺口 — **ADDRESSED**

| 缺口 | 补齐处 |
|---|---|
| `table`/`thematicBreak`/`other`(definition+footnoteDefinition) | `src/lib/editUnits.test.ts:246-266` |
| 嵌套下钻（list 内 blockquote、引用内引用、引用内 list 不下钻） | `:115-119`、`:200-207`、`:217-225` |
| `caretOffsetForRatio` 的 `text=""` / 越界比率 | `:303-308`（`-1→0`、`2→8`、`""→0`、单行→0） |
| `findUnitForRange` 部分重叠 / 跨界 / 恰好包含 | `:319-330` |
| 类型窄化（去 `as { lang?: string }`） | `isCode` `:52-54`、`isBlockContainer` `:59-61`；由 `npx tsc --noEmit` exit=0 守住（vitest 走 esbuild 不做类型检查） |

### 6 — 新破坏检查（仅限本修复 diff）

| 检查项 | 结论 | 证据 |
|---|---|---|
| `spliceUnit`/`caretOffsetForRatio`/`findUnitForRange`/`buildEditUnits` 公开签名未变 | ✅ 未变 | `git diff 3ad0f80..3017ac3 -- src/lib/editUnits.ts \| grep -E "^[+-].*(export function\|export type)"` → 无输出（exit 1）；两版 `grep -n "^export function"` 逐字一致。唯一公共类型变更是 F10 裁定的 `reason` 联合删 `"unmapped"`（`:35`） |
| `"# 标题\n\n正文\n"` 块索引未变 | ✅ 未变 | 实测 `#0 heading [0,4)`、`#1 paragraph [6,8)`，与旧实现逐字一致；HEAD 的 `src/components/MarkdownDocument.test.tsx:1052-1055`（`length===2`、`"0"`→H1、`"1"`→P）仍在（我跑该文件 50 passed，但注意工作区含并发未提交 T2 改动，见「范围外观察 6」） |
| F9a 是否让引用子块与引用容器重合、影响 T2 包含判定 | ⚠️ **存在，严重程度：低** | 最小反例 `"> 引用\n"`：mdast `blockquote [0,4)`、子段落 `[2,4)`；F9a 对齐后子块 `[0,4)` ⇒ `findUnitForRange(units,0,4)` 命中该子块 ⇒ 编辑视图里 **`<blockquote>` 容器也被打上 `data-vellum-unit="0"`**（旧夹具正是断言「容器不打标」，故必须换夹具，实施者已在提交内把 `src/lib/rehypeEditUnits.test.ts` 夹具改为两子块引用、断言强度不降，并在报告「未解决项 2」登记）。不阻断：索引与内层 `<p>` 相同，`src/components/MarkdownDocument.tsx:617-624` 的 `closest("[data-vellum-unit]")` 在文本点击取内层、容器空白处取容器但索引与锁定原因一致；仅编辑视图 |
| 归一化是否可能把相邻两块合并/吞掉 | ❌ 不会合并；丢弃只在畸形输入 | 归一化只右移 `start`、从不改 `end`（`:141-156`），不存在合并路径。**124 份仓库真实 `.md`（7987 单元）新旧实现单元数 `dropped=0`、不变量违规 `bad=0`**；2951 份 fuzz 仅 3 份出现丢弃，全部含畸形片段 `"  ```\n  y\n  ```tail\n"`（裁定 F7 明示的取舍方向） |

**残余（建议级，非本 diff 新引入）**：反例 B 中被保留的 `[0,26)` 单元，其 `end` 仍伸进被丢弃项的字节（切片尾 `"- "`），实测：
```
md = "- a\n\n  ```\n  x\n  ```- b\n- c\n"
units = [0,26) listItem
spliceUnit(md, units[0], "NEW") → "NEWc\n"      // 第二项 "- c" 丢掉了 "- "
```
即裁定 F7 理由里的「不跨块写字节」在 **end 侧**并未完全成立；但 F7 只裁定夹 `start`/丢弃，实现与裁定一致，且旧实现同样从未处理 `end`（旧实现只会更糟：该项原本重叠可编辑）。

---

### 新破坏

**无。** 唯一行为变化是上面第 6 条的低严重度项（单子块引用的容器元素在编辑视图多带一个同索引 `data-vellum-unit`），已由实施者在修复报告中披露，且点击映射/锁定语义不变。

### 范围外观察

1. **反例 B 的 end 侧残余**（见上）：`end` 未被夹紧，畸形输入下编辑保留单元仍会改写被丢弃项的字节；若要彻底兑现「不跨块写字节」，需对邻接的丢弃块把 `end` 回退到上一行行尾。仅畸形输入（围栏关闭行尾随文字），登记不延长循环。
2. **计划文档 Task 1 代码块未同步**：`docs/superpowers/plans/2026-09-10-vellum-block-editing.md:188-191` 仍写 `} as const;`、旧下钻逻辑与 `reason?: … | "unmapped"`，`:308` 仍写「PASS（15 用例）」。该文件在工作区另有未提交改动（F12/F13），修复报告「未解决项 1」已登记。
3. **F9b（草稿/光标按 LF 归一）未在本任务落地**：`src/components/MarkdownDocument.tsx:631` 仍 `caretOffsetForRatio(source, ratio)` 用含 `\r` 的原始切片。按 F9b/F14 属 T2/T4 调用面。
4. **修复报告一处表述不准**：fuzz 实为 300 次 × **1~6** 片段（`src/lib/editUnits.test.ts:81` `1 + Math.floor(random() * 6)`），报告写「300 份 × 5~10 片段」。门禁强度不受影响。
5. Minor-8（`buildEditUnits` 区间与渲染树块级 position 对齐的回归锁定）、Minor-9/F11（入口 chunk 体积实测）仍开放，属 T2/T8。
6. **工作区存在并发未提交改动**（`src/components/MarkdownDocument.tsx`、`src/components/MarkdownDocument.test.tsx`、`src/lib/rehypeEditUnits.ts`，均非本 diff），疑似另一任务的实施者正在同仓改动。被审的两个 T1 文件与 HEAD 逐字节一致（`git diff --stat HEAD` 为空），故上述判定不受影响；我跑的 `MarkdownDocument.test.tsx`（50 passed）是在含并发改动的树上执行，仅作旁证。

---

## 我实际跑过的命令与输出摘要

| 命令 | 真实输出 |
|---|---|
| `npx vitest run src/lib/editUnits.test.ts` | `Test Files 1 passed (1) / Tests 52 passed (52)` |
| `npx vitest run src/lib/editUnits.test.ts src/lib/rehypeEditUnits.test.ts` | `Test Files 2 passed (2) / Tests 57 passed (57)` |
| `npx vitest run src/components/MarkdownDocument.test.tsx` | `Test Files 1 passed (1) / Tests 50 passed (50)`（含并发未提交改动，仅旁证） |
| `npx tsc --noEmit` | 无输出，`tsc exit=0` |
| `grep -rn "unmapped" src/` | 仅 `src/lib/editUnits.ts:34`（注释） |
| `git diff 3ad0f80..3017ac3 -- src/lib/editUnits.ts \| grep -E "^[+-].*(export function\|export type)"` | 无输出（exit 1）→ 公开签名未动 |
| `git diff 3ad0f80..3017ac3 --name-only` | `src/lib/editUnits.test.ts` / `src/lib/editUnits.ts` / `src/lib/rehypeEditUnits.test.ts`（3 文件，无 T2 源码） |
| `git diff --stat HEAD -- src/lib/editUnits.ts src/lib/editUnits.test.ts src/lib/rehypeEditUnits.test.ts` | 前两者为空；`rehypeEditUnits.test.ts` 为空（被审代码 == HEAD） |
| node 探针（真实模块 `src/lib/editUnits.ts`，14 份代表性文档 + 10 份对抗样例） | 全部满足不变量；对抗样例 `bad=0`；引用内 HTML/widget → `html`/`widget` locked；`> 行一\n> 行二` → `[0,9)` slice `"> 行一\n> 行二"` |
| node 探针（旧实现 `git show 2e2c11c` 逐字复刻） | 反例 A `[0,15)`+`[0,25)` OVERLAP、反例 B `[0,26)`+`[24,27)` OVERLAP、三条嵌套绕过 `editable=true` → 回归用例真红→绿 |
| node 探针（新旧实现 fuzz 对比，2951 份随机拼接，种子 12345） | `newOverlap=0, newEmpty=0, newOob=0`；`dropsTotal=3`（全部含畸形 ` ```tail ` 片段） |
| node 探针（仓库全部 124 份 `.md`，7987 单元） | `bad=0, dropped=0`（无重叠/空切片/越界，无单元被吞） |
| node 探针（逐字复刻私有逻辑 vs 真实模块，3000 份 fuzz） | `mismatch=0`；对齐新引入 overlap `alignOverlaps=0`；原始 overlap 5 处全被消解 |
| `git log --oneline -5` | `3017ac3 fix(edit): 块单元区间归一化与嵌套锁定类型（审查轮 1）` ← head 一致 |
| diff emoji 扫描（code point > U+2190 的非汉字符） | 仅 `⊆`，无 emoji |

未做：未重跑 `npm test` 全量（按要求）、未跑 `cargo test`（本任务无 Rust 改动）、未修改任何仓库文件。

---

## 结论

**All findings addressed:** Yes

**Reasoning:** F7/F8/F9a/F10 四条裁定逐条落地且有我亲自复现的红→绿证据（旧实现确实重叠、确实可绕过只读、确实从行中起算；新实现在 2951 份 fuzz + 124 份真实文档上不变量全绿、三条嵌套用例锁定、切片从行首起算）；公开签名与常见文档块索引未变，归一化不会合并相邻块。唯一遗留是「单子块引用容器被打上同索引标记」的低严重度行为变化，已由实施者披露且不影响点击/锁定语义，加上 end 侧在畸形输入下的残余（裁定允许的取舍），均不构成阻断。
