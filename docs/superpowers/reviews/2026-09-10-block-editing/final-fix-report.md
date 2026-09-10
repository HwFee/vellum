# 终审修复波报告（裁定 F37–F43）

- 日期：2026-09-10
- 工作区：`C:\Users\17445\Desktop\Vellum`（master）
- 基线：`05505eb`（全分支终审判「需先修复再合并」）
- 交付：**单次提交 `e57fc13`** —— `fix(edit): 终审修复波（脚注只读、Ctrl+S 去重、切文档清会话、heavyDoc 提示、文档校准）`（12 文件，+440 −41）
- 方式：TDD（每条修复先红后绿）+ 逐条变异注入验证回归用例的判别力；未派发子智能体；未新增依赖；未改 Rust；未改 `.vellum-unit-wrap` 机制；临时探针只落在 `outputs/__audit_scratch/`（收尾已删）。

---

## 0. 收尾验证（本轮实跑，全绿）

| 命令 | 真实输出 |
|---|---|
| `npm test` | `Test Files 31 passed (31)` / `Tests 426 passed (426)`（基线 31/400，本波 +26 用例） |
| `npx tsc --noEmit` | 无输出，`exit=0` |
| `npm run build` | `✓ built in 2.17s`；入口 `dist/assets/index-BAtPp06D.js` = **158,538 B**（收口时 158,080 B，本波 +458 B）；`MarkdownDocument-B2uoy_Ax.js` 262.93 kB；`index-DFZWhdzK.css` 23.54 kB |
| `cd src-tauri && cargo test` | `56 passed; 0 failed` + `7 passed; 0 failed` + `0`（doc-tests）= **63**，与本波前端改动无关（未触碰 `src-tauri/`） |

> 入口 chunk +458 B 归因：脚注下钻分支、提交在途闸门/`resetSession`、重文档轻提示接线；仍远低于 F11 的 20 KB 守门线，退路未触发。数字已同步进 `AGENTS.md` 与验收报告 §11。

---

## 1. F37（Critical，脚注定义绕过结构性只读）

**finding**：`BLOCK_CONTAINERS` 不含 `footnoteDefinition`，脚注定义整体落成 `kind:"other"` / `editable:true`，其中的块级 HTML 与 `vellum-widget` 围栏可点入编辑并改写源码（终审 C1 三条反例）。

**修法**（`src/lib/editUnits.ts`）：
- `BLOCK_CONTAINERS` 加入 `"footnoteDefinition"`（`lockedKindOf` 的下钻清单与可下钻容器清单同源）；
- `collectUnits` 抽出 `drill(container, fallbackKind)`，`list`→`listItem`、`blockquote`→`blockquoteChild`、`footnoteDefinition`→`footnoteChild`；容器子节点若本身是脚注定义（引用/列表内嵌套脚注成立，已用 mdast 探针确认）继续下钻；
- 新增 `EditUnitKind` 成员 `"footnoteChild"`；脚注正文仍逐块可编辑（下钻仍只一层，与 D2 一致）。

**红**（实现前）：`npx vitest run src/lib/editUnits.test.ts` → `Tests 10 failed | 61 passed (71)`：
- 新遍历式用例 8 条红（`脚注定义内` / `脚注定义内引用内` / `引用内脚注定义内` / `列表项内脚注定义内` × `块级 HTML` / `vellum-widget 围栏`），`AssertionError: expected true to be false`；
- 脚注下钻用例红（`expected [ 'paragraph', 'other' ] to equal [ 'paragraph', 'footnoteChild', … ]`）；
- 脚注单块 kind 用例红（`expected 'other' to be 'footnoteChild'`）。

**绿**：`Tests 71 passed (71)`。

**反例复证**（Node 24 类型剥离直接调用交付的纯函数，终审 C1 的三条原始输入）：

```
=== A ===  unit 0 paragraph editable=true
           unit 1 kind=html   editable=false reason=html   src="    <div class=\"payload\">raw</div>"
=== B ===  unit 1 kind=widget editable=false reason=widget src="    ```vellum-widget\n    <b>x</b>\n    ```"
=== C ===  unit 1 kind=html   editable=false reason=html   src="    > <div class=\"x\">raw</div>"
附录 引用内 HTML：kind=html editable=false reason=html   （原有修法未回退）
```

**回归断言改为遍历式**（`src/lib/editUnits.test.ts`）：`LOCKED_INNER_BLOCKS`（块级 HTML / widget 围栏）× `INNER_CONTAINERS`（顶层 / 引用内 / 列表项内 / 脚注定义内 / 脚注定义内引用内 / 引用内脚注定义内 / 列表项内脚注定义内）交叉 14 条用例；每条用 `unitsCovering(markdown, locator)` 按**源码片段定位**找出覆盖该锁定块的**每一个**单元，逐一断言 `editable === false` + `reason` 正确，并断言命中集合非空（避免恒真）。另向区间不变量语料补 4 份脚注文档。

**未解决项**：无。

---

## 2. F38（Critical，`Ctrl+S` 双通道提交）

**finding**：编辑框 `onKeyDown` 对 `Ctrl+S` 只 `preventDefault`（不 `stopPropagation`），事件冒泡到 `window` 后全局处理器**无条件**再调一次 `commitActive`；第一次提交的 `flushSync` 同步把父级 markdown 推前并把 `editorRef` 换成新闭包，第二次调用用「新 markdown 的同索引单元」当原文比对 ⇒ 草稿改变块结构时被再拼一遍 + 二次落盘（终审 C2）。

**修法**（A + B 都做）：
- **A**（`src/App.tsx`）：`handleGlobalShortcut` 开头加 `if (event.defaultPrevented) return;`（修饰键判断之后、任何分支之前）。
- **B**（`src/hooks/useDocumentEditor.ts`）：新增 `committingRef` 在途闸门；`commitActive` 在短路分支之后、任何 splice 之前 `if (committingRef.current) return true;`，并在 `try/finally` 中置位/复位（`finally` 保证落盘失败或异常也不会永久锁死）。

**红**（实现前，App 级接线用例）：`npx vitest run src/App.test.tsx -t F38` →

```
× 编辑框内 Ctrl+S 只提交一次：结构变化草稿不重复拼入、不二次落盘（F38）
AssertionError: expected [ { …(2) }, { …(2) } ] to have a length of 1 but got 2
```

用例按裁定写：`fireEvent.keyDown(textarea, { key: "s", ctrlKey: true })`（打在**编辑框**上，不是 window），草稿为 `"Body text.\n\nNew paragraph."`（补空行再写一句），断言 `save_document` **恰好一次**、载荷逐字符等于 `"# Intro\n\n## Section\n\nBody text.\n\nNew paragraph."` 且 `"New paragraph."` 只出现 **1** 次。

**绿**：`Tests 1 passed | 56 skipped`。

**两处防护的独立判别力（变异注入，均实跑）**：

| 注入 | 期望 | 实测 |
|---|---|---|
| 两处防护都去掉（= 基线） | App 用例红 | ❌ `expected … to have a length of 1 but got 2` |
| 只去掉 A（保留 B 闸门） | App 用例绿（B 单独足够） | ✅ `Tests 1 passed` |
| 只去掉 B（保留 A） | App 用例绿（A 单独足够） | ✅ `Tests 1 passed` |
| 只去掉 B 且跑 hook 级用例 | hook 用例红 | ❌ `AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times` |

hook 级新增用例（`useDocumentEditor.test.ts`）在同一次 `act` 同步派发里连调两次 `commitActive`（复刻真机双通道时序：`flushSync` 已推进父级 markdown、`resetSession` 的 setState 尚未提交），断言 `save` 与 `onMarkdownChange` 各恰好一次、载荷无 `新段。\n\n新段。` 重复；该用例在无闸门时红（上表第 4 行），是**唯一**能单独判定 B 的用例（初次写法用非结构变化草稿，会被前台同文本短路掩盖，已改为结构变化并复验）。

**未解决项**：无。（裁定已明示：极端交错下最多多一次幂等 IPC，本波已用两处闸门把该窗口关掉。）

---

## 3. F39（Important，落盘失败后切换文档带上脏草稿）

**finding**：F24 落盘失败会把活动块 + 草稿留在原地；`loadPath` 无论提交返回值都继续加载新文档，会话无「文档切换即复位」逻辑 ⇒ 新文档同序号块被隐藏、框里是上一份文档的草稿，后续任何提交触发都会把 A 的文字写进 B。

**修法**：
- `useDocumentEditor`：把内部 `closeActive` 提升为对外的 **`resetSession()`**（清 `activeUnitIndex` / `draft` / `initialCaret`，不动 `viewMode`），内部三处调用点与返回对象同步改名；
- `App.loadPath`：在 `isSamePath` 早退分支**之后**、`persistCurrentScroll()` 之前调用 `editorRef.current?.resetSession()`（同路径热重载因此不会丢正在编辑的草稿）。

**红**（去掉 `loadPath` 里的 `resetSession` 调用）：`npx vitest run src/App.test.tsx -t F39` →

```
× 落盘失败后切换文档：上一份文档的草稿不得带进新文档（F39）
AssertionError: expected <textarea …(4)></textarea> to be null
```

用例复现路径：A 提交被拒（只读）→ 会话留在 A 的 2 号块；切到与 A **同构**的 B（`# Other\n\n## Section\n\nBody text elsewhere.`，第 2 块同序号）且落盘继续失败 ⇒ 断言覆盖层清场、B 的正文可见、无 `[data-vellum-unit][style*="visibility"]`；随后放开落盘并按 `Ctrl+S`，断言没有任何 `save_document` 指向 B（且两次失败尝试都只针对 A）。

**绿**：`Tests 1 passed | 56 skipped`。hook 级另有 `resetSession` 单元用例（清三项、视图模式不变）。

**未解决项**：无。（裁定已明示判错代价：切换瞬间丢失未提交草稿 —— 与「已主动切文档」意图一致。）

---

## 4. F40（Important，`heavyDoc` 接到界面）

**finding**：`heavyDoc` 只有状态层（`grep heavyDoc src --include=*.tsx` 零消费点），而 `CHANGELOG.md` 对用户宣告了 >800ms 软提示 ⇒ 声明被代码证伪。

**修法**（不删声明，而是让它成真）：
- `src/App.tsx`：在编辑提示条旁渲染常驻轻提示 `{editor.viewMode === "editing" && editor.heavyDoc ? <div className="editor-hint" role="status">本文档较大，提交可能有不到一秒的停顿</div> : null}`（只在编辑视图，阅读视图 DOM 逐字节不变）；
- `src/styles/kami.css`：编辑态区段新增 `.editor-hint`（`position: fixed; bottom: 26%`，`--tag-bg` 底 + `--near-black` 字，`font: 500 10px/1.5 var(--mono)`，`border-radius: 3px`，`pointer-events: none`，**无动画/无自动消失** —— 与 `.editor-toast`（`bottom: 18%`）同一视觉语汇但不叠字）；
- `CHANGELOG.md`：措辞改为「实测提交耗时 > 800ms 时在编辑视图内挂一条常驻软提示（仅本会话内粘性）」（修后为真）。

**红**：
- App 用例（去掉提示 JSX）：`Unable to find an element with the text: /本文档较大/`；
- CSS 守卫（去掉 `.editor-hint` 规则）：`AssertionError: expected '' not to be ''`。

**绿**：两条恢复后皆通过。
- App 用例用「包装真实 hook、只注入 `heavyCommitMs`」的方式取阈值（`vi.mock` 工厂 + `vi.hoisted` 覆写变量，`beforeEach` 复位为 `undefined` ⇒ 默认 800ms）——**没有** mock 掉 hook 自身，测的仍是交付的会话状态机；断言「提交前不可见 → `heavyCommitMs: 0` 提交后可见且 `class="editor-hint"` → 覆盖层卸载后提示仍在（常驻）」。
- `kami.css.test.ts` 新增设计语言守卫：必须用 `--tag-bg` / `--near-black` / 字重 500 / 圆角 2–6px，且不得出现 `animation` / `fill-mode` / `forwards` / `display: none` / 吞点击。

**未解决项**：阈值仍需真机校准（验收报告手检 #9）；提示位置（`bottom: 26%`）未经真机观感确认 —— 属 F35 的真机项，不得由子智能体代跑。

---

## 5. F41（T7-I1，DOM 层位置守卫）

**finding**：F23 的 `>` 直接子元素选择器只由 `kami.css.test.ts` 锚定 CSS 文本；App 侧用位置无关的 `querySelector`，接线把覆盖层挪走时样式整体失效而测试全绿。

**修法/用例**（`src/App.test.tsx`）：

```ts
expect(document.querySelector(".document-scroll__content--editing > textarea.block-editor__input")).toBe(textarea);
expect(textarea.parentElement).toHaveClass("document-scroll__content--editing");
expect(textarea.closest(".markdown-body")).toBeNull();
```

**判别力证据**（该用例引入时即为绿 —— 现接线正确，属防漂移守卫，故用变异注入证明非恒真）：给覆盖层临时套一层 wrapper `div` 后 →

```
× 覆盖层的直接父元素是 .document-scroll__content--editing（F41：DOM 层位置守卫）
AssertionError: expected null to be <textarea …(4)></textarea>
```

恢复后 `Tests 57 passed (57)`。

**未解决项**：无。

---

## 6. F42 / F43（登记不改）

- **F42**（进/出编辑视图重建全篇 widget iframe）：按裁定**不改**（要动承担载荷的渲染管线与 T2/T3/T7 三方契约）。已作为**已知限制第 10 条**写入验收报告 §8，含下一版方案（`components.pre` 显式交还标记属性、只对数学块保留包裹层）与理由，并在 §10 未解决项第 5 条登记。
- **F43**（非段落块行级落点近似精度更低）：按裁定**登记**。已作为**已知限制第 11 条**写入验收报告 §8（含「高度下限 `Math.max(scrollHeight, lockedHeight)` 兜住、不会高度跳变，真实影响是编辑态字形更小 + 单子块引用容器 5px 缩进差」与手检 #2/#11 指引）。

**未解决项**：F42 的优化本身（下一版）；两条均需真机手检确认观感。

---

## 7. 文档类修正（T8 审查清单 + F40 连带）

| 出处 | 原文 | 现文 |
|---|---|---|
| `CHANGELOG.md:12` | 「实测提交耗时 > 800ms 时挂自适应软提示」（代码证伪） | 「…时在编辑视图内挂一条常驻软提示（仅本会话内粘性）」——**修完为真**，未删声明 |
| `CHANGELOG.md:10` | 「块粒度为顶层节点 + 列表项 + 引用块内直接子块」 | 「…+ 引用/脚注定义内直接子块」（F37 连带，避免新失真） |
| spec `:290`（§14.1） | 交付 `db001e0`（错误哈希） | `e82ba24`（`git log -S notifyInterrupted` 首次出现处；注明后续轮次有修改） |
| 验收报告 `:104` | 「已知代价（§7 第 3 条）」 | 「（§8 第 3 条）」 |
| 验收报告 `:107` | 「当前仅为状态层标记，见 §7 第 2 条」 | 「已接到界面…（终审修复波 F40），见 §11」 |
| 验收报告 `:112` | 「登记项见 §7 第 5 条」 | 「（§8 第 8 条）」 |
| `AGENTS.md:111` | 「（`kami.css.test.ts` 锁死，防接线漂移）」 | 「CSS 侧由 `kami.css.test.ts` 锁死规则文本，DOM 侧由 `App.test.tsx` 断言直接父元素带 `--editing`（终审修复波 F41 补齐，两侧齐备才防接线漂移）」 |
| 验收报告 §1 / §8-2 / §10-2 | 结构性只读「含嵌套在引用/列表内的情形」；`heavyDoc` 无 UI 消费点 | 同步为「含脚注」「已接到界面」；未解决项删去已解决条并入 §11 |

**额外登记（本波新增，属小范围文档补充，已在报告偏离项声明）**：
- 验收报告新增 **§11 终审修复波登记**（F37–F43 落地位置 + 修复波后的基线数字），§2 表内数字保留为 T8 收口时点并注明；
- spec 新增 **§14.9**（D2 粒度、D4 只读覆盖范围、D5 软提示可见与 `Ctrl+S` 单通道三处口径修正）；
- `AGENTS.md` 性能结构约束的编辑面不变量补 3 条（结构性只读必须覆盖全部块级容器 + 遍历式断言；`Ctrl+S` 双通道去重；切换文档必须 `resetSession`），并把入口 chunk 记录更新到 158.53KB。

---

## 8. 硬约束对照

| 约束 | 状态 |
|---|---|
| 不新增依赖 | ✅ `package.json` / `package-lock.json` 零改动 |
| 不改 Rust | ✅ `src-tauri/` 零改动（`cargo test` 63 全绿） |
| 不改 `.vellum-unit-wrap` 机制（F42） | ✅ `rehypeEditUnits.ts` / `MarkdownDocument.tsx` 零改动 |
| 阅读视图 DOM 逐字节一致 | ✅ 新 DOM 仅 `viewMode === "editing" && heavyDoc` 时出现；`MarkdownDocument.test.tsx` 全绿 |
| `MarkdownBody` props 引用稳定 | ✅ 未触碰 `components`/`memo`/回调接线 |
| 覆盖层 `>` 直接子元素关系不变 | ✅ 唯一改动是新增断言（F41） |
| 临时文件只放 `outputs/__audit_scratch/` | ✅ 探针（`probe-footnote.mjs` / `probe-wrap.mjs` / `probe-c1.mjs`）与变异备份均在该目录，收尾 `rm -rf` 已清（`git status` 无残留） |
| 单次提交 | ✅ `e57fc13` |

---

## 9. 改动文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/lib/editUnits.ts` | 修 | F37：`footnoteDefinition` 入块级容器 + `drill()` + `footnoteChild` |
| `src/lib/editUnits.test.ts` | 测 | F37：14 条遍历式用例 + 脚注下钻/kind 用例 + 4 份语料 |
| `src/App.tsx` | 修 | F38-A `event.defaultPrevented` 早退；F39 `loadPath` 调 `resetSession`；F40 渲染 `.editor-hint` |
| `src/hooks/useDocumentEditor.ts` | 修 | F38-B `committingRef` 在途闸门；F39 `resetSession` 对外暴露 |
| `src/hooks/useDocumentEditor.test.ts` | 测 | F38-B 同派发重入用例；F39 `resetSession` 单元用例 |
| `src/App.test.tsx` | 测 | F38/F39/F40/F41 四条接线用例 + `heavyCommitMs` 注入包装 + `saveDocumentCalls()` helper |
| `src/styles/kami.css` | 修 | F40 `.editor-hint`（编辑态区段、首个 `.mdlog-widget` 之前） |
| `src/styles/kami.css.test.ts` | 测 | F40 设计语言守卫（token/字重/圆角/无动画） |
| `CHANGELOG.md` | 文档 | 软提示措辞与块粒度校准 |
| `AGENTS.md` | 文档 | 覆盖层括注修正 + 3 条新不变量 + 入口 chunk 更新 |
| `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md` | 文档 | §14.1 哈希；§14.9 新增 |
| `docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md` | 文档 | 3 处交叉引用 + §1/§8/§10 同步 + §8 新增第 10/11 条 + §11 新增 |

未纳入提交（派发前既有、非本波产生）：`.pi/agents/*`、`docs/superpowers/plans/2026-09-10-vellum-block-editing.md`。

---

## 10. 与 spec / 计划的偏差说明

1. **F38-B 的返回值语义**：裁定/终审建议「在途重入直接返回 `true`」。本波照此实现（`if (committingRef.current) return true;`）。已核对关窗路径不受影响：`commitActive` 的 `resetSession()` 在 `await save` 之前同步执行，关窗处理器开头的 `if (!current?.activeUnit) return;` 已经早退。
2. **F41 用例引入即绿**：现接线本就正确，该用例是防漂移守卫；按 verification 要求用变异注入（插入 wrapper）证明其非恒真，未假装「红→绿」。
3. **AGENTS.md / spec / 验收报告的登记面超出「1 处括注 + 3 处引用 + 2 条限制」**：新增了上述「额外登记」三项 —— 依据是本波的实质变化使旧文失真（结构与操作约束需要留给后续 agent），非功能性扩张。所有内容均已在上文列出，可逐条回退。
4. **`EditUnitKind` 新增 `"footnoteChild"`**：未复用 `blockquoteChild`（语义错误）也未把脚注子块降级为 `kindOf(child)`（会改变引用/列表的既有 kind 契约）。该 kind 在生产代码中只用于 `editable`/`reason` 推导，不参与渲染。
5. **入口 chunk +458 B**：超出「终审只改行为不改体积」的隐性预期，但远低于守门线；已把新数字写进 `AGENTS.md` 与验收报告 §11，未回改 §2/§3 的收口时点记录。

## 11. 未解决项（合并后仍需跟踪）

1. **真机 GUI 手检（F35）仍未执行**：验收报告 §7 的 14 项全部未跑；本波新增关注点 —— #9 阈值校准（`heavyCommitMs = 800` 与新增提示的常驻观感）、#6 与新增 §8 第 10 条（`Ctrl+E` 进出编辑视图的 iframe 重建）对比确认。
2. **F42 的实现（下一版）**：把标记属性交给 `components.pre`、只对数学块保留包裹层；附「切换编辑视图前后 iframe 节点同一性」用例。
3. **F17 畸形围栏 `end` 越界**、**F30 在途窗口**、**关窗处理器异常分支 `try/catch`**、**非段落块度量差异观感**：登记项，未在本波处理（不在 F37–F43 范围）。
4. **重文档提示的视觉位置**（`bottom: 26%`，高于 `.editor-toast` 的 18%）未经真机确认；若与「墨迹未干」印章（22%）在同屏叠字，需要一次纯 CSS 微调。
