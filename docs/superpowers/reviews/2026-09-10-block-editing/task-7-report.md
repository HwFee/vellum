# Task 7 报告 — 编辑态样式与设计语言

- 状态：**完成**（红→绿闭合，全量验证通过，已提交）
- 提交：`ef696af` `feat(edit): 编辑视图样式与设计语言同步（区段置于 mdlog 之前、display:contents 数学块容器）`（单次提交，只含本任务 3 个文件）
- 基线：31 文件 / 394 用例 → 现 **31 文件 / 399 用例全绿**（新增 5 条 CSS 契约用例）

---

## 1. 改动文件清单

| 文件 | 改动 | 说明 |
|---|---|---|
| `src/styles/kami.css` | +78 行 | 新增「编辑视图（块级就地编辑）」区段，插在 `/* ===== Pi 对话记录与沙箱交互块 ===== */` **之前**（原第 1233 行处，现区段起于 1236 行，首个 `.mdlog-widget` 现于 ~1375 行） |
| `src/styles/kami.css.test.ts` | +57 行 | 新增 `describe("kami.css editing view (block-level inline editing)")` 5 条用例 |
| `DESIGN.md` | +25 行 | frontmatter 加 2 个 typography token + 2 个 component；正文 Typography / Components 各补描述 |

```
DESIGN.md                   | 25 +++++++++++++++
src/styles/kami.css         | 78 +++++++++++++++++++++++++++++++++++++++++++++
src/styles/kami.css.test.ts | 57 +++++++++++++++++++++++++++++++++++++++++
3 files changed, 160 insertions(+)
```

未改任何 `.tsx` / `.ts` 逻辑文件，未新增依赖，未动 Rust。工作区里既有的无关改动（`.pi/agents/*`、`docs/superpowers/plans/...`）未纳入本次提交。

### 新增 CSS（要点摘录）

```css
/* ===== 编辑视图（块级就地编辑） ===== */
.document-scroll__content--editing { position: relative; }

.document-scroll__content--editing > .block-editor__input {
  position: absolute; z-index: 30; margin: 0; padding: 0 2px;
  border: 0; border-left: 2px solid var(--brand);
  border-radius: 2px; background: transparent; box-shadow: none;
  color: var(--near-black); font: inherit; font-family: var(--mono);
  font-size: 14px; line-height: 1.55;
  resize: none; overflow: hidden; outline: none;
  white-space: pre-wrap; word-break: break-word;
}

.markdown-body--editing .vellum-unit-wrap { display: contents; }   /* 仅此一条声明 */

.editor-toast { position: fixed; left: 50%; bottom: 18%; transform: translateX(-50%);
  z-index: 40; padding: 6px 14px; border-radius: 3px;
  background: var(--tag-bg); color: var(--near-black);
  font: 500 10px/1.5 var(--mono); letter-spacing: 0.04em;
  pointer-events: none; animation: editor-toast-in 0.18s ease-out; }

@keyframes editor-toast-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .editor-toast { animation: none; } }
```

---

## 2. 逐条红→绿证据

### 2.1 首次 RED（先写测试，样式未加）

```
$ npx vitest run src/styles/kami.css.test.ts
 ❯ src/styles/kami.css.test.ts (32 tests | 5 failed)
     × 编辑态区段位于首个 .mdlog-widget 之前，且自身不含该字样 3ms
     × 编辑态宿主提供定位上下文 3ms
     × F23：覆盖层写成直接子元素选择器，不依赖 .markdown-body 后代选择器 1ms
     × F12/F18：包裹层 display: contents 且不带任何尺寸/边框/内外边距 1ms
     × F31：提示条只做视觉淡入，消失机制不写在 CSS 里 1ms

AssertionError: expected -1 to be greater than -1      ← css.indexOf(".block-editor__input") === -1（计划预期）
AssertionError: expected '@font-face {\r\n ...' to match /\.document-scroll__content--editing\s*\{.../
 Test Files  1 failed (1)
      Tests  5 failed | 27 passed (32)                ← 27 条既有用例保持通过（无回归噪声）
```
（其余 3 条 RED 均为 `expected '' to match ...` —— 规则尚不存在。）

### 2.2 GREEN（加样式后）

```
$ npx vitest run src/styles/kami.css.test.ts
 Test Files  1 passed (1)
      Tests  32 passed (32)
```

### 2.3 提交后再次做「回退修复 → 必须失败 → 还原 → 通过」闭环（最终测试集口径）

```
$ git checkout HEAD~1 -- src/styles/kami.css        # 暂时撤掉编辑态区段
$ npx vitest run src/styles/kami.css.test.ts
     × 编辑态区段位于首个 .mdlog-widget 之前，且自身不含该字样
     × 编辑态宿主提供定位上下文
     × F23：覆盖层写成直接子元素选择器，不依赖 .markdown-body 后代选择器
     × F12/F18：包裹层 display: contents 且不带任何尺寸/边框/内外边距
     × F31：提示条只做视觉淡入，消失机制不写在 CSS 里
      Tests  5 failed | 27 passed (32)
$ git checkout HEAD -- src/styles/kami.css          # 还原
$ npx vitest run src/styles/kami.css.test.ts
 Test Files  1 passed (1)
      Tests  32 passed (32)
```

### 2.4 5 条用例分别锁住什么

| 用例 | 锁定的契约 | 关联裁定 |
|---|---|---|
| 编辑态区段位于首个 `.mdlog-widget` 之前，且自身不含该字样 | `css.indexOf(".block-editor__input") < css.indexOf(".mdlog-widget")`，且 `/* ===== 编辑视图` 到首个 `.mdlog-widget` 之间不含 `.mdlog-widget` 字样 | 项目硬约束（mdlog 约束用例从首个 `.mdlog-widget` 扫到文件尾） |
| 编辑态宿主提供定位上下文 | `.document-scroll__content--editing { position: relative }`、`.block-editor__input { position: absolute }` | F4（覆盖层以该容器为基准） |
| F23：覆盖层写成直接子元素选择器，不依赖 `.markdown-body` 后代选择器 | 必须命中 `.document-scroll__content--editing > .block-editor__input {`；`css` 整体不得出现 `.markdown-body … .block-editor__input`；规则内 `border: 0` / `background: transparent` / `box-shadow: none` / `border-radius: 2px`（覆写阅读态输入控件的 1px 描边、ivory 底、6px 圆角、focus 光晕） | **F23（必做）** |
| F12/F18：包裹层 `display: contents` 且不带任何尺寸/边框/内外边距 | 规则须含 `display: contents`，且**不得**声明 `width/height/margin/padding/border/min-height/max-height` 任一属性 | **F12 / F18 / F20** |
| F31：提示条只做视觉淡入，消失机制不写在 CSS 里 | 规则内 `pointer-events: none`，且不含 `fill-mode` / `forwards` / 基础态 `opacity: 0;` / `display: none` | **F31 / F2** |

> F2（`markdown-body--editing` 已由 Task 2 挂在 `<article>` 上）已在 `MarkdownDocument.test.tsx` 中锁定；本任务只消费该类名，未重复断言。

### 2.5 真机语义探针（jsdom，草稿置于 `outputs/__audit_scratch/`，跑完即删）

按真实 DOM 形状（覆盖层是 `.document-scroll__content--editing` 的直接子元素）核对计算样式：

```
overlay(direct)  position: absolute | font-size: 14px | padding: 0px 2px
                 border-radius: 2px | box-shadow: none | z-index: 30
wrap             display: contents
toast            position: fixed | radius: 3px | pointer-events: none
```
探针另证实一条边界（见 §4 关注点）：若把覆盖层塞进 `.markdown-body` 内部，`>` 选择器**整体不匹配**（不是"输给 0,1,1"而是"不生效"），样式静默全丢。

---

## 3. 与简报 / 计划的偏差（均已在报告说明，无隐藏偏离）

| # | 计划/简报原文 | 实际实现 | 原因 |
|---|---|---|---|
| D1 | `border-left: 2px solid var(--accent, #4a5b8c)`；`color: var(--ink, #2f2f2c)` | `var(--brand)`；`var(--near-black)` | kami.css 与 DESIGN.md **都没有** `--accent` / `--ink` / `--paper`。按「优先复用既有 token + 单一靛青点缀（占比 ≤5%）」裁定，左侧轨用唯一的强调色 `--brand`（#1B365D），文字用墨色 `--near-black`（#141413）。**不新增 `--accent`/`--ink` 别名 token**（重复语义，YAGNI；DESIGN.md 明令不得引入第二种强调色），改为在 DESIGN.md 正文写明轨色 = `colors.primary`。 |
| D2 | `font-size: 0.95rem; line-height: 1.7` | `font-size: 14px; line-height: 1.55` | 简报要求「核对 `.markdown-body` 实际值，不匹配就改」。实际值 = body 14px / 1.55（`0.95rem` 在 `html` 无 font-size 声明时等于 16px 的 0.95 = 15.2px，两者都不匹配）。`letter-spacing` 不覆写、由正文继承 0.3pt，故覆盖层与渲染态正文**同字号、同行高、同字距**，只换字族（`--mono`，spec §9 指定）。 |
| D3 | `border-radius: 0`（计划的隐含行为：…） | `border-radius: 2px` | 计划代码没写 `border-radius`，但必须显式覆写 `.markdown-body textarea` 的 6px。写 0 会撞项目死规则「圆角 2–6px」；2px 正是 DESIGN.md 给「激活指示条端头」的尺度（`rounded.xs`），语义与左边轨一致。 |
| D4 | `font: 500 10px/1 var(--mono)`（提示条） | `font: 500 10px/1.5 var(--mono)` | 文案最长 15 个汉字，1.5 行高保证换行时不叠行；视觉语言与 `.mdlog-live` / `.mdlog-widget__bar` 的 10px 等宽小字一致。 |
| D5 | 计划未提动画 | 增 `editor-toast-in` 0.18s 纯 opacity 淡入 + reduced-motion 关闭 | 对齐 DESIGN.md「动画 150–250ms、尊重 `prefers-reduced-motion`」；**无** `animation-fill-mode`，消失仍由 hook 的 2.4s 定时器负责（F31） |
| D6 | 计划 step 3 未写 `box-shadow: none` | 增写 | `.markdown-body textarea:focus` 会带 `box-shadow: 0 0 0 2px` 靛青光晕；覆盖层已 `outline: none`，显式归零可防止未来接线漂移时出现双光晕 |
| D7 | 计划 step 4「token 表补三项」 | 未补 `--accent`；`--tag-bg` / `--mono` 复用；另加 `edit-source` / `ui-mono` 两个 typography token + `block-editor` / `editor-toast` 两个 component | 三项中两项已存在（仅需文档描述），第三项经裁定复用 `--brand`；但编辑面确实需要一对**新的字号/行高尺度**（等宽 14px/1.55 与既有一切 typography token 都不同），故登记为 token 而非硬编码，避免 DESIGN.md 与 CSS 脱节 |
| D8 | 计划未提 reduced-motion 块 | 新增 `@media (prefers-reduced-motion: reduce) { .editor-toast { animation: none } }` | 与 `reload-note` / `code-block__copy` / `outline-sidebar` 的既有处理一致 |

**首轮 DESIGN.md 试写被 lint 拦下的问题（已修）**：`components.block-editor.railColor` 不是合法子 token，lint 报 `broken-ref` 警告 → 删除该键，轨色改写进正文描述。

---

## 4. 验证命令与真实输出

| 命令 | 输出摘要 | 结论 |
|---|---|---|
| `npx vitest run src/styles/kami.css.test.ts` | `Test Files 1 passed (1)` / `Tests 32 passed (32)` | ✅ |
| `npm test` | `Test Files 31 passed (31)` / `Tests 399 passed (399)`（基线 31/394，+5 全为本次新增） | ✅ 全绿 |
| `npx tsc --noEmit` | 无输出，`tsc exit=0` | ✅ |
| `npm run build` | `✓ built in 2.19s`；产物断言：`dist/assets/index-*.css` 内含 `document-scroll__content--editing{position:relative}`、`document-scroll__content--editing>.block-editor__input{…position:absolute…font-size:14px;line-height:1.55…}`、`vellum-unit-wrap{display:contents}` | ✅ |
| `npx -p @google/design.md designmd lint DESIGN.md` | `"errors": 0, "warnings": 4, "infos": 1`（改动前 `errors: 0, warnings: 5`；警告数**下降 1**，因 `colors.tag-bg` 现被 `editor-toast` 引用；剩余 4 条为既有 orphaned-tokens：`brand-tint`/`border`/`border-soft`/`hairline`） | ✅ 无新告警、无错误 |
| 行尾一致性自查 | `kami.css` CRLF 1534 / bare LF 0（共 1535 行）；`kami.css.test.ts` CRLF 369 / bare LF 0（共 370 行）；`DESIGN.md` 0 / 241（原本即 LF，共 242 行） | ✅ 无混行尾 |
| `git status --short`（提交后） | 只剩提交前就存在的无关改动（`.pi/agents/*`、`docs/superpowers/plans/...`）；本任务 3 个文件干净 | ✅ |
| `cd src-tauri && cargo test` | 未运行 | 本任务未触碰任何 Rust 文件（无新增/修改 `.rs`、`Cargo.toml`），按规约不触发 |
| 临时文件 | `outputs/__audit_scratch/`（probe.mjs、probe2.mjs）已 `rm -rf` | ✅ |

---

## 5. 未解决项 / 关注点（留给 Task 8 或后续）

1. **`>` 选择器是"位置强制"而非"深度无关的压过"**：F23 的裁定示例即 `.document-scroll__content--editing > .block-editor__input`，本任务照此实现并以测试锁定。探针证实：一旦有人把覆盖层挪进 `.markdown-body`（或中间插一层容器），该规则**整体不匹配**，覆盖层样式会静默全丢（表现为普通流 textarea）。缓解：`App.tsx` 已写明"必须是 `.document-scroll__content` 的直接子元素"、`kami.css.test.ts` 新增用例锁定该形态、`BlockEditor.test.tsx`/`App.test.tsx` 锁定渲染位置。**若 Task 8 手检发现覆盖层样式消失，第一嫌疑就是位置漂移，而不是特异度**。
2. **覆盖层字族为等宽**：DESIGN.md 有「不要把等宽用于正文阅读」的戒律，此处是**源码编辑面**（spec §9 明确指定 `--mono`），且 CJK 字形实际回退到今楷（JetBrains Mono 无中文字形），故视觉上仍是纸面楷体。已在 DESIGN.md 正文写明理由，避免后续被当作违规。
3. **`0.95rem` / `1.7` 的源起未追**：简报里的这两个值既非正文（14px/1.55）也非代码块（12px/1.5）度量，已按简报要求改为正文真实值；若后续有人手检觉得编辑字偏小，可考虑给代码块类单元单独 12px/1.5（当前 v1 统一 14px/1.55，简化），记为可选优化而非缺陷。
4. **未加 `field-sizing: content`**：裁定 F19 说它"可选、不得成为唯一机制"。组件已显式写 `scrollHeight`（F19 的主机制），加它只会引入两种高度机制的竞争，故**不加**，保持单一真相源。
5. **真机手检项（Task 8）**：编辑态覆盖层与下方内容是否错位、left 轨是否对齐块左缘、长段落编辑时下方内容是否被推下去（jsdom 看不见高度推流，属已知盲区）、提示条 2.4s 是否真的消失（CSS 只做淡入，消失由 hook 定时器负责）。
