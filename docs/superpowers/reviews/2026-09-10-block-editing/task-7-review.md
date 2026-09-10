# Task 7 审查报告 — 编辑态样式与设计语言

审查范围：`46ed156..ef696af`（3 文件 / +160 行）。只读审查，未修改任何文件、未重跑 git 命令、未重跑全量测试。

---

### Spec Compliance

- ✅ **区段位置（硬指标 1，独立核实）**：`src/styles/kami.css:1236` 为 `/* ===== 编辑视图（块级就地编辑） ===== */`，`.block-editor__input` 首次出现于 `src/styles/kami.css:1248`；编辑态区段结束于 1312 行，`/* ===== Pi 对话记录与沙箱交互块 ===== */` 在 `src/styles/kami.css:1314`，**首个 `.mdlog-widget` 在 `src/styles/kami.css:1375`**（`grep -n -m1 "\.mdlog-widget"` 实测；1384/1527 行的 `.mdlog-widget` 只出现在注释里，且在 1375 之后）。1236–1312 区间内 `grep mdlog` 无任何命中——**区段在首个 `.mdlog-widget` 之前，且不含该字样**，满足绑定硬约束。
- ✅ **覆盖层特异度（硬指标 2，独立计算）**：`.markdown-body textarea`（`src/styles/kami.css:883`）= 1 class + 1 type = **(0,1,1)**；`.document-scroll__content--editing > .block-editor__input`（`src/styles/kami.css:1248`）= 2 class = **(0,2,0)**。逐位比较 `0=0, 2>1` ⇒ 覆盖层胜出，**F23 满足**（且覆盖层本就不在 `.markdown-body` 内，见 `src/App.tsx:904-928`，该优势属保险余量）。
- ✅ **F12/F18/F20 前提**：`.markdown-body--editing .vellum-unit-wrap { display: contents }` 在 `src/styles/kami.css:1274`，规则内**只有**这一条声明；并且我用 `grep -n "vellum-unit-wrap" src/styles/kami.css` 确认**全文件仅此一处**规则 ⇒ 包裹层在任何地方都没有尺寸/边框/内外边距声明。`markdown-body--editing` 类确实由上游落在 `<article>` 上（`src/components/MarkdownDocument.tsx:653`），规则不是死代码。
- ✅ **F31**：`.editor-toast`（`src/styles/kami.css:1282`）无 `animation-fill-mode`/`forwards`/基础态 `opacity:0`/`display:none`，只有 0.18s 纯 opacity 淡入（`1286`、`1298-1306`），消失仍归 hook 的 2.4s 定时器，未把 CSS 变成消失机制。
- ✅ **设计语言**：新 CSS 的颜色全部走 token（`var(--brand)` K:1253、`var(--near-black)` K:1256/1291、`var(--tag-bg)` K:1290），`sed -n '1236,1315p' | grep '#[0-9a-f]|rgba(|gradient|box-shadow'` 唯一命中是 `box-shadow: none`；`font-weight` 仅 500（K:1292）；圆角 2px（K:1255）/3px（K:1289），落在 2–6px；无 emoji（perl 扫 U+1F300–1FAFF / U+2600–27BF / U+FE0F 无命中）。
- ✅ **不变约束**：未新增依赖（diff 不含 `package.json`/`package-lock.json`）、未改任何 `.tsx`/`.ts` 逻辑文件（第三文件是测试 `src/styles/kami.css.test.ts`，简报明确允许）。
- ✅ **`DESIGN.md` 同步 + lint 真跑了**：我自己执行 `npx -p @google/design.md designmd lint DESIGN.md` → `errors: 0, warnings: 4, infos: 1`（4 条均为既有 orphaned colors：`brand-tint`/`border`/`border-soft`/`hairline`），与报告数字一致；新增 `typography.edit-source`、`typography.ui-mono`、`components.block-editor`、`components.editor-toast`（D.md:56-66、132-144）**与 CSS 逐值对得上**（14px/1.55；10px/500/1.5/0.4px=0.04em；`rounded.xs`=2px=K:1255；`rounded.sm`=3px=K:1289；padding `0px 2px`/`6px 14px` 与 K:1251、K:1288 一致）。
- ✅ **偏差登记**：简报计划代码里的 `var(--accent, #4a5b8c)` / `var(--ink, #2f2f2c)` 在本仓库**不存在**（`grep -rn -- "--ink:\|--accent:" src/` 零命中），改用 `--brand`/`--near-black` 是唯一不引入第二强调色又不硬编码的选择；`0.95rem/1.7 → 14px/1.55` 与正文实际值（K:63-64）一致，正是简报「核对正文实际值」的要求；spec §9 明确「编辑面字体用既有 `--mono`」（`docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md:196`），故字族与正文不同属**规范指定**。上述 D1–D8 全部在报告 §3 登记，**未发现未登记的实现侧偏差**（但见 Important-2 的"未登记影响面"）。
- ⚠️ **无法仅凭 diff/只读验证**：真机观感（覆盖层与下方内容是否错位、长段落推流、提示条 2.4s 消失、`>` 规则在真实 WebView2 下的匹配）——留给 T8 手检；报告 §5 已把这些列为待检项，属诚实登记。
- ⚠️ **报告自证不实一处**：报告「行尾一致性自查」称 `kami.css` CRLF 1534 / bare LF 0、`kami.css.test.ts` CRLF 369，但实测三文件 CR 计数全为 0（`grep -c $'\r'` → `kami.css:0`、`kami.css.test.ts:0`、`DESIGN.md:0`，且仓库无 `.gitattributes`）。数字不可复现；这属于报告可信度问题，不是代码缺陷（工作树三文件行尾内部一致，无混行尾）。

### Strengths

- 硬指标不是靠断言存在性糊过去的：区段位置、不含 `.mdlog-widget`、包裹层"全文件仅一处规则"这些真结论我都独立跑出来了，实现本身站得住。
- `.vellum-unit-wrap` 全文件只有一条 `display: contents` 规则（K:1274），没有别处偷偷给它尺寸——F18 担心的"包裹层带盒"在源码层确实不存在。
- 覆盖层刻意与正文并列（`src/App.tsx:911-916` 有锁定注释），使 F23 的冲突面根本不存在，特异度提升只是第二道保险。
- 新增的 5 条用例中，`display: contents` 那条用**属性缺席**（width/height/margin/padding/border/min-height/max-height 全禁）来锁 F18，是真实约束而非字符串复读；`border: 0 / background: transparent / box-shadow: none / border-radius: 2px` 四条覆写也把"未来接线漂移"的四个具体属性钉死了。
- D3（`border-radius: 2px` 而非 0）与 D6（显式 `box-shadow: none`）是有洞察力的加法：分别防住"撞 2–6px 死规则"和 focus 双光晕。

### Issues

#### Critical (Must Fix)

无。

#### Important (Should Fix)

1. **`>` 直接子元素是覆盖层 100% 样式的唯一载体，但没有任何 DOM 层测试守住这个位置（F23 的"防接线漂移"只落在源码字符串上）。**
   - `src/styles/kami.css:1248` 用 `>` 连接；一旦有人在 `src/App.tsx:918` 的 `<BlockEditor />` 外多包一层 `<div>`（或把它挪进 `.document-content`），该规则**整体不匹配**，覆盖层退化为浏览器默认 textarea（透明/定位/字号/左边轨全丢），而现有测试**全部照绿**：`src/App.test.tsx:1672` 用 `document.querySelector("textarea.block-editor__input")`（位置无关），`src/App.test.tsx:1714` 只查宿主类名是否存在，我在 `src/` 内 grep 未发现任何 `:scope >` / `parentElement` / `.document-scroll__content--editing > .block-editor__input` 位置断言。
   - 严重度理由：失败模式是"静默、整特性、无测试信号"，正是 F23 要防的漂移；修法极廉价（把 `src/App.test.tsx:1672` 的查询换成 `document.querySelector(".document-scroll__content--editing > textarea.block-editor__input")`，或在 `kami.css.test.ts` 里补一条 jsdom 定位断言——该文件已有 `getComputedStyle` 先例，见 `src/styles/kami.css.test.ts:230-258`）。
   - 注：F23 字面要求（选择器形状 + 一条"不是 `.markdown-body` 后代"断言）已履行，报告 §5-1 也主动披露了该风险——所以这不算规格违背，算"关口没关严"。

2. **统一 14px/1.55 对"非段落块"的度量错位未登记（尤其标题，误差最大）。**
   - 覆盖层对**所有**可编辑单元用同一字号（`src/styles/kami.css:1262-1263`），而可编辑单元包含 `heading`（`src/lib/editUnits.ts:17,86`）。渲染态 h1 = 30px/1.2（K:805-807）、h2 = 21px/1.25（K:812-814）、h3 = 17px/1.3（K:819-821）、代码块 = 12px/1.5（K:1096-1097）。
   - 可复现影响：激活 `# 标题` 时框内文字从 30px 变 14px；更实际的是**首个按键**会把高度从"锁定的原块高（`src/components/BlockEditor.tsx:108`）"改写为 `scrollHeight`（`src/components/BlockEditor.tsx:69-70`），而 scrollHeight 是按 14px/1.55 算的 ⇒ 标题块高度在一键之后跳变、下方内容跟着抽动。
   - 报告 §5-3 只登记了代码块（"可选优化"），**标题未登记**；DESIGN.md 新增文案（D.md:172）也只声明"与正文同尺度"，未声明"与块同尺度"。属"合理但未登记"的偏差（计划本身就选了统一字号，且按 kind 分档需要新的 DOM 属性，超出本任务"不改 `.tsx`"的授权）——最低要求是把它写进 T8 手检清单并注明"标题/代码块/表格单元已知不等于渲染态尺度"。

#### Minor (Nice to Have)

3. **覆盖层内容相对被编辑块右移 4px**：`border-left: 2px`（K:1253）+ `padding: 0 2px`（K:1251）+ 全局 `box-sizing: border-box`（K:47）⇒ 外框宽度与目标块一致（不会溢出），但内容区比渲染态窄 4px、文字左缘右移 4px——激活瞬间正文有一次 4px 位移，且长行可能提前换行。这两条声明直接抄自简报计划代码，不算实现偏差，但简报"覆盖层与下方内容错位"的顾虑恰恰没覆盖这一项；若 T8 手检觉得跳，去掉右 padding 或对 padding-left 做负补偿即可。

4. **`.document-scroll__content--editing { position: relative }`（K:1239）是冗余规则**：`.document-scroll__content` 本身已有 `position: relative`（K:711）。保留无害（自文档化 + 用例 `src/styles/kami.css.test.ts:334` 锁定），但"宿主提供定位上下文"这条测试的真实性有限——它验证的规则即使删掉也不改变行为。建议在注释里点明"与 K:711 同源，仅作意图声明"。

5. **5 条新用例全部是源码字符串断言，没有一条跑真实层叠/计算样式**，而本文件已有能力（`src/styles/kami.css.test.ts:230-258` 用 jsdom `getComputedStyle`）。F23 的实际结论（覆盖层压过 `.markdown-body textarea`）目前**只由我这次人工算术验证**，没有测试兜底。建议补一条"注入两条规则 + getComputedStyle 断言 `border-radius` 为 2px、`background` 为 transparent"的用例，把"谁赢"变成可执行断言。

6. **左边轨（`border-left: 2px solid var(--brand)`）只在 DESIGN.md 正文描述里**（D.md:221），未进 `components.block-editor` 的 token 块（报告称首轮试写的 `railColor` 被 lint 判 broken-ref 后删除）。lint 干净是事实，但机器可校验的组件契约缺了这条最显眼的视觉规则；若 design.md schema 允许，可登记为 `border`/`borderColor` 之类合法子键。

7. **报告可信度**：见 Spec Compliance 末条——行尾自查数字（CRLF 1534/369）不可复现。建议后续报告只写"我实际跑过的输出"，避免把推定值写成实测值。

### Assessment

**Task quality:** Approved

**Reasoning:** 两条硬指标（区段在首个 `.mdlog-widget` 之前且不含该字样；覆盖层特异度 (0,2,0) > (0,1,1)）经我独立计算与 grep 验证均成立，度量与正文逐项对得上（14px/1.55/继承 0.3pt 字距），设计语言与 DESIGN.md 同步且 lint 干净（errors 0），未新增依赖、未改逻辑文件；两条 Important 项（`>` 位置无 DOM 层守卫、非段落块度量错位未登记）都不构成本任务规格违背，可并入 T8 手检/后续任务，故不阻断。

### 验证命令与输出

| 命令 | 真实输出摘要 |
|---|---|
| `grep -n "编辑视图\|\.mdlog-widget" src/styles/kami.css` / `grep -n -m1 "\.mdlog-widget"` | 编辑视图头 `1236`；首个 `.mdlog-widget` = `1375`；mdlog 区段头 `1314`；编辑态规则 `1239/1248/1274/1282/1298/1308` |
| `grep -n "vellum-unit-wrap" src/styles/kami.css` | 仅 `1274` 一处 |
| `sed -n '1236,1312p' src/styles/kami.css \| grep mdlog` | 无输出（区段内无 mdlog 字样） |
| `grep -rn -- "--ink:\|--accent:" src/` | 无输出（两个 token 均不存在，D1 成立） |
| `grep -n "letter-spacing\|font-size:\s*14px\|line-height:\s*1.55" src/styles/kami.css` | 正文 `body { font-size: 14px; line-height: 1.55; letter-spacing: 0.3pt }`（K:63-65）；覆盖层 `14px`（K:1262）/`1.55`（K:1263），未覆写字距 |
| `grep -rn "markdown-body--editing" src/` | `MarkdownDocument.tsx:653` 挂类；`MarkdownDocument.test.tsx:1074-1086`、`App.test.tsx:1713/1752/2022` 锁定（F2 已交付，本任务 CSS 非死代码） |
| `grep -rn "document-scroll__content--editing\|block-editor__input" src/` | 无任何位置（直接子元素）断言——Important-1 的证据 |
| `npx vitest run src/styles/kami.css.test.ts` | `Test Files 1 passed (1)` / `Tests 32 passed (32)` / `Duration 1.12s` |
| `npx -p @google/design.md designmd lint DESIGN.md` | `"errors": 0, "warnings": 4, "infos": 1`（warning 全为既有 orphaned colors） |
| `grep -c $'\r' src/styles/kami.css src/styles/kami.css.test.ts DESIGN.md` | `0 / 0 / 0`（报告所称 CRLF 1534/369 不可复现） |
| Emoji 扫描（perl，U+1F300–1FAFF/U+2600–27BF/U+FE0F） | 新 CSS 区段与 DESIGN.md 新增段落均无命中 |

未运行：`npm test`（按指示不重跑全量；本任务只改 CSS + 测试文件，TS 逻辑零改动）、`cargo test`（无 Rust 改动）、`git` 命令（按指示不重跑）。
