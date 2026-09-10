# Task 8 审查报告 — 全量回归、文档同步、验收报告（收口声明的真实性核对）

- 审查者：独立审查智能体（只读；未修改任何项目文件，未派发子智能体）
- 审查对象：`ef696af` → `05505eb`（`review-ef696af..05505eb.diff`，532 行）
- 依据：`task-8-brief.md`、`rulings.md` 的 F11 / F17 / F26 / F34 / F35、`AGENTS.md`、`DESIGN.md`
- 日期：2026-09-10

---

## Spec Compliance

| # | 核查项 | 结论 |
|---|---|---|
| 1 | 全量回归数字（`npm test` / `tsc` / `cargo test` / 构建产物） | ✅ 通过（构建用产物核对，未重跑构建，见 §证据 4） |
| 2 | F34 修复的真实性（两条新用例是否真有判别力、变异证据是否成立） | ✅ 通过（判别力由代码路径逐行论证，变异注入按只读约束未复现，推理链见下） |
| 3 | 文档声明与代码事实逐条一致 | ⚠️ 部分通过（3 处失真，见 Important-1 / Minor-1~3） |
| 4 | F35：真机手检项必须标为未执行、不得伪造 | ✅ 通过 |
| 5 | 未改功能代码（仅测试 + 文档） | ✅ 通过 |
| 6 | F11：入口 chunk 实测与 20KB 守门线 | ✅ 通过（当前值亲验；基线值有旁证，见下） |
| 7 | F17 / F26 已登记为已知限制 | ✅ 通过 |
| 8 | `AGENTS.md` 六条不变量与代码事实相符 | ⚠️ 五条精确、一条括注偏强（Minor-2） |
| 9 | 规约符合（`AGENTS.md` 死规则、`DESIGN.md` 设计语言） | ✅ 通过（PrismLight 未破、单高亮 chunk；无新增 UI/emoji） |
| 10 | 测试真实性（有无放水/跳过/空断言） | ✅ 通过 |

**总体：⚠️** —— 所有可跑的数字（用例数、tsc、cargo、chunk 字节）**逐项亲验属实**，F34/F35 处置合规；扣分点全部在「文档措辞的精度」上，其中 **Important-1（CHANGELOG 对用户宣告了一个用户看不见的功能）** 属本次任务的核心风险面。

---

## Strengths

1. **数字全是真的。** 报告里最容易被伪造的四类数字（用例数、tsc、cargo、chunk 字节）我逐条实测一致：
   - `npm test` → `Test Files 31 passed (31)` / `Tests 400 passed (400)`；
   - `npx vitest run src/App.test.tsx` → `Tests 53 passed (53)`，且 `git show ef696af:src/App.test.tsx | grep -cE "^\s*(test|it)\("` = **52** ⇒ 「52 − 1 + 2 = 53」自洽，全量 399 → 400 自洽；
   - `npx tsc --noEmit` → `exit=0`；
   - `cd src-tauri && cargo test` → `56 passed` + `7 passed` + `0` = **63**，与报告逐字一致；
   - `dist/assets/index-Coyz_cau.js` = **158,080 B**，`dist/index.html` 确实指向它（`src="/assets/index-Coyz_cau.js"`），`dist/` 文件时间戳 `Sep 10 14:20` 与报告声称的构建时刻吻合。
2. **F34 不是「改名应付」，而是真的补回了判别力。** 两条用例的断言读下来确实靠不同机制区分（见 §F34 论证），且保留了同名原命题，符合 F34 的「不得删除了事」。
3. **F35 执行得干净。** 验收报告 §7 全 14 项只有「步骤 + 预期」两列，**没有**任何状态列；`grep "已通过\|已手检\|手检通过\|已真机"` 在两份交付里 **零命中**（exit=1）。§10 再次把 14 项列为未解决项。
4. **收口 diff 干净。** `git diff --stat ef696af 05505eb` 只有 5 个文件，其中唯一代码文件是 `src/App.test.tsx`；`src-tauri/`、`kami.css`、`vite.config.ts`、`package.json` 零改动（依赖也只新增 `mdast-util-math` / `micromark-extension-math` 两项，`git diff d9f8523 05505eb -- package.json`）。
5. **未留变异注入残渣。** `git status --short` 中 `src/` 无任何未提交改动，与报告「备份还原 + `git status --short src/App.tsx` 无输出」的说法一致。
6. **已知限制登记诚实。** §8 主动写了 9 条（含 F17、F26 + 无 UI 消费点、F30 在途窗口、关窗异常分支、F15 链接双触发），没有把未完成项包装成「已完成」。

---

## Issues

### Critical (Must Fix)

无。

### Important (Should Fix)

**I-1 `CHANGELOG.md:12` 向用户宣告了一个「用户看不见」的功能，且与本提交内另一份文档自相矛盾。**

- 原文：「……不设体积硬阈值，**实测提交耗时 > 800ms 时挂自适应软提示**」。
- 代码事实：`src/hooks/useDocumentEditor.ts:150` 只做 `if (renderMs > heavyCommitMs) setHeavyDoc(true);`；`heavyDoc` 仅出现在 `useDocumentEditor.ts:44/150/217`（state、注释、return），`grep -rn "heavyDoc" src/App.tsx src/components/*.tsx src/styles/kami.css` **零命中** ⇒ 没有任何 UI 消费者，用户看不到任何提示。
- 同一提交里的验收报告自己承认这点：`docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md:119`「**改「>800ms 挂软提示」（spec D5）当前只到状态层**，用户看不到提示」。
- 理由：`CHANGELOG.md` 是发行面文档，读者据此预期「重文档会出现提示」。同一提交内「CHANGELOG 说有 / 验收报告说看不见」是本次收口任务最不该出现的声明冲突。建议改为「实测提交耗时并在超阈值时置重文档标记（UI 提示待接线）」或直接删去该分句。

### Minor (Nice to Have)

**M-1 `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md:290` 的交付 commit 归属错误。**

- 原文：`### 14.1 … → 中断路径（已交付 `db001e0`）`。
- 事实：`git log --oneline -S "notifyInterrupted" -- src/hooks/useDocumentEditor.ts` → 首次出现于 **`e82ba24`**（Task 4 交付，同提交也改了 spec §6.4），`db001e0`（审查轮 1）只是后续修改。`task-4-report.md:105` 亦记 `git show --stat e82ba24` 含 spec 的 §6.4 修订。属登记史上的错误哈希，结论（偏差存在且已交付）不受影响。

**M-2 `AGENTS.md:111` 的括注「（`kami.css.test.ts` 锁死，防接线漂移）」把守卫说强了。**

- `src/styles/kami.css.test.ts:334-340` 锁的是 **CSS 规则文本**（选择器存在、不含 `.markdown-body …` 后代写法），它无法发现 App 接线把覆盖层挪进 `.markdown-body` 的漂移——这正是 T7 审查的 Important-1（裁定 F36：无 DOM 层守卫，并入终审修复波）。
- 建议改为「CSS 侧由 `kami.css.test.ts` 锁死；DOM 侧守卫待终审修复波（F36）」。

**M-3 验收报告 §7 表格内三处交叉引用指向错节。**

- `acceptance.md:104`「属已知代价（**§7 第 3 条**）」（§7 是 14 项手检清单，已知限制在 §8 第 3 条）；
- `acceptance.md:107`「见 **§7 第 2 条**」（应为 §8 第 2 条）；
- `acceptance.md:112`「登记项见 **§7 第 5 条**」（应为 §8 第 8 条——「编辑视图 + 无活动块时 mdlog 变活跃无提示」）。
- 对照 `acceptance.md:142/145` 用的是正确的「§8 第 2 条 / §8 第 9 条」，说明是笔误而非体系错误。用户按清单手检时会被指错节。

**M-4 验收报告 §2 用「阅读视图 DOM 逐字节一致」指称 `MarkdownDocument.test.tsx` 的覆盖。**

- 实据 `src/components/MarkdownDocument.test.tsx:1074-1087` 断言的是「阅读视图无 `data-vellum-unit`、无 `markdown-body--editing` 类」，并无外层 HTML 逐字节比对（`grep outerHTML` 零命中）。
- 「逐字节一致」是**机制性结论**（标记插件在 `editable=false` 时不入管线，`MarkdownDocument.tsx:353`），写进 `AGENTS.md` 成立；但把它说成某条测试的覆盖内容略有拔高。

**M-5 F11 基线 143,766 B 未被我独立复现（旁证充分，非阻断）。**

- 亲验：当前 `dist/assets/index-Coyz_cau.js` = 158,080 B；入口 chunk 内确实含 `mathFlow` / `mathText` / `mathFlowFenceMeta` 等 micromark-math 符号（`grep -o` 命中），与「math 解析器进入口 chunk」的归因一致（两个包源码合计 23,580 B，量级相符）。
- 旁证：`.superpowers/.../task-6-report.md:192` 独立记录「接线前 `index-*.js = 144.35 kB`、接线后 157.75 kB ⇒ +13.40 kB，低于 F11 的 20KB 阈值」。以任一基线计（+13.40 或 +14.32 kB）都远在 20 KB 守门线内，**F11 结论稳固**。
- 未复现原因：`git worktree list` 中已无 `vellum-baseline-wt`（实施者已 `worktree remove`），而复现需要新建工作树/重跑构建，超出只读授权（报告已如实说明工作树被移除）。

**M-6 报告 §2 「`cargo test` 无 `warning: unused` 类新增告警」不可核对。** 我跑的两次 `cargo test` 均为增量编译，本来就无编译告警输出；该断言的证据强度有限，属无伤大雅的表述。

---

## 关键项逐条取证

### 1. 回归数字（真跑）

```
$ npx vitest run src/App.test.tsx
 Test Files  1 passed (1)
      Tests  53 passed (53)          ← 报告称「52 − 1 + 2 = 53」，一致

$ npm test
 Test Files  31 passed (31)
      Tests  400 passed (400)        ← 报告称 31/400，一致

$ npx tsc --noEmit
tsc exit=0                           ← 报告称 exit 0，一致

$ cd src-tauri && cargo test | grep "^test result"
test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; ...
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; ...
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; ...
                                     ← 56+7+0 = 63，与报告一致

$ git show ef696af:src/App.test.tsx | grep -cE "^\s*(test|it)\("   → 52
$ grep -cE "^\s*(test|it)\(" src/App.test.tsx                      → 53
                                     ← 文件级 ±1 与「1 条拆 2 条」自洽

$ ls -l dist/assets/index-Coyz_cau.js → 158080
$ grep -o 'src="[^"]*index[^"]*\.js"' dist/index.html → src="/assets/index-Coyz_cau.js"
$ ls dist/assets/*.js → 6 个 chunk（无 270+ 语言 chunk，PrismLight 红线未破；
                        syntax-highlighter-CUlFCbOG.js 117,470 B 单 chunk）
```

> 未重跑 `npm run build`：它会覆写 `dist/` 下的文件，超出「绝不修改任何文件」的只读授权。改为核对实施者构建产物本身（字节数、chunk 名、入口 html 指向、chunk 内容特征、时间戳），如上。

### 2. F34 修复的真实性（读断言 + 代码路径论证）

- **新用例 A**（`src/App.test.tsx:1257-1297`）断言三件事：`load_document` 恰被调用 **2** 次（防「处理器没跑」的假绿）、`scrollTop` 仍为 **380**（此刻距底 `1000−380−600 = 20px ≤ 80`，若仲裁执行必被写成 `scrollHeight`）、`.reload-note` 为 null。它测的是**早退本身**，不是「滚动没发生」这种弱断言。
- **新用例 B**（`src/App.test.tsx:1299-1348`）改走同路径重开（`open` 第二次返回同一路径 ⇒ `App.tsx:224` `isSamePath` ⇒ `reloadCurrent()` ⇒ `App.tsx:318` `setReloadTick(t+1)`）。`markdown` 字符串逐字符相同 ⇒ React 依赖 `Object.is` 判等为未变 ⇒ **唯一**能驱动 `App.tsx:628-673` 布局 effect 的就是 `reloadTick`。
- **「无仲裁时它不会假绿」的论证**（只读约束下未做变异注入，按代码路径逐行推）：
  - 全仓 `scrollTop =` 赋值点只有 5 处：`App.tsx:549`（受 `lastRestoredPathRef !== path` 保护，同路径重开必然早退，不会写 0）、`App.tsx:643`（贴底分支）、`App.tsx:670`（`pendingScrollRef` 分支）、`CustomScrollbar.tsx:158`、`smoothScroll.ts:49`（缓动，测试已断 rAF）。因此 `scrollTop === 1000` 只可能来自 `App.tsx:641-643`，而该分支的入口条件 `shouldStickToBottomRef` 只在 `reloadCurrent()`（`App.tsx:310-314`）里被置位。
  - 去掉 `reloadTick` 依赖 ⇒ effect 不跑 ⇒ 停在 380（与报告的红跑输出同向）；去掉贴底分支 ⇒ 走 `pendingScrollRef` 写回 380 或 anchor 分支，同样非 1000。
  - 旧用例在此两变异下仍绿也成立：旧用例把 `scrollTop` 先设 250、距底 150px > 80 ⇒ 即便 `reloadCurrent` 跑了，`pendingScrollRef` 记录的正是 250，写回后断言 `toBe(250)` 依旧成立；变异 A 下 effect 干脆不跑。与报告 §3.2 的两段输出一致。
- 结论：**两条用例的判别力来自不同机制，命名与断言相符，不是名字游戏**。（变异注入我只做静态论证，未实际改文件；报告自称实跑并已还原，工作树无残渣可佐证还原步骤。）

### 3. `AGENTS.md` 六条不变量核对（`AGENTS.md:108-113`）

| 条 | 断言 | 代码事实 | 判 |
|---|---|---|---|
| ① | 编辑面沿用 `.document-scroll`、不得新建内层滚动系统 | `App.tsx:894-951` 覆盖层是 `.document-scroll__content` 的直接子元素；`BlockEditor.tsx:150-173` 仅一个 `overflow:hidden` 的自增高 textarea，编辑态 CSS 区段（`kami.css:1235-1312`）无任何滚动容器 | ✅ |
| ② | 提交不递增 `reloadTick` / 不播印章 / 不做滚动补偿；回声由「磁盘 vs 内存（LF 归一）」抑制 | `useDocumentEditor.ts:124-176` `commitActive` 只经 `onMarkdownChange`（`App.tsx:489-495` 仅 setState）；`showReloadNote` 只在 `reloadCurrent`（`App.tsx:319-321`）置位；回声比对在 `App.tsx:455-461` | ✅ |
| ③ | `.vellum-unit-wrap` 必须 `display: contents`，操作必须落在 `resolveTarget()` 的首个有布局盒元素 | `kami.css:1274-1276` `display: contents`；`BlockEditor.tsx:15-41` `resolveTarget()`（类名首选 + 「高 0 且子节点自身有布局盒」兜底）；`kami.css.test.ts:346-355` 锁死包裹层不得声明尺寸/边框/内外边距 | ✅ |
| ④ | 覆盖层选择器与「非 `.markdown-body` 后代」 | `kami.css:1248`；`App.tsx:938-951`（覆盖层与 `.document-content` 并列）；`kami.css.test.ts:334-343` 断言选择器与非后代 | ✅（括注偏强见 M-2） |
| ⑤ | mdlog 三重门禁 | 入口：`useDocumentEditor.ts:93`（`activateUnit`）、`:189-192`（`toggleView`）、`App.tsx:853`（`canEdit={!isMdlogActive}` → `TopBar.tsx:86 disabled`）；提交口：`useDocumentEditor.ts:131-134`；Rust：`main.rs:217-230` + `document.rs:182-184` | ✅ |
| ⑥ | 入口 chunk 实测增量与 F11 退路 | 见 M-5；当前值亲验 | ✅（基线为旁证） |

其余文档断言抽样核对：`rehypeEditUnits` 位置（sanitize 之后、katex 之前，`MarkdownDocument.tsx:350-366`）、包裹层是 `div`（`rehypeEditUnits.ts:61-62`）、`TOAST_DURATION_MS = 2400`（`useDocumentEditor.ts:21`）、`heavyCommitMs = 800`（`:17`）、`display: contents` 包裹前的 `data*` 作废（`MarkdownDocument.tsx:171` 未见 `'data*'` 通配追加）、落盘四闸门（`document.rs:35-45 / 212-218` 扩展名与 50MB，`check_save_gates` 现行路径 + mdlog）、原子写与唯一临时名（`document.rs:192-199, 226-247`）、BOM 保真（`document_tests.rs:261-265` 有断言）——**均与文档一致**。

### 4. F35 / F17 / F26

- F35：`acceptance.md:96-113`（§7）声明「以下各条**均未执行**」，14 行只有步骤与预期；`grep "已通过\|已手检"` 零命中；§10 第 1 条再次列明未执行。✅
- F17：`acceptance.md:118`（§8 第 1 条）复述准确（畸形围栏、`end` 跨过 `- `、提交会把下一列表项降级为段落、不修理由、fuzz 数据），与 `rulings.md:186-192` 一致。✅
- F26：`acceptance.md:119`（§8 第 2 条）写明「粘性不回退（文档规模属性）」+「无 UI 消费点」，并在 §14.7/`AGENTS` 侧有对应登记。✅

### 5. 未改功能代码

```
$ git diff --stat ef696af 05505eb
 AGENTS.md                                          |  17 ++-
 CHANGELOG.md                                       |  10 ++
 .../reviews/2026-09-10-block-editing-acceptance.md | 145 +++++++++++++++++++++
 .../2026-09-10-vellum-block-editing-design.md      |  46 ++++++-
 src/App.test.tsx                                   |  71 +++++++++-
 5 files changed, 277 insertions(+), 12 deletions(-)

$ git show --stat --oneline 05505eb  → 同 5 文件（单次提交，信息与简报 Step 3 一致）
$ git status --short → 仅 .pi/agents/*（派发前既有）与 docs/superpowers/plans/*.md（控制器 F7–F10 修订登记）
```

`docs/superpowers/plans/2026-09-10-vellum-block-editing.md` 的未提交改动内容为控制器对计划正文的修订登记（`git diff` 显示 `normalizeOverlaps`、用例数 17→15 等），与 T8 无关，报告「未纳入提交」的说法成立。`.superpowers/sdd/` 由自身 `.gitignore`（`.superpowers/sdd/.gitignore:1 *`）忽略，故过程报告不入库，验收报告入库——与报告一致。

### 6. 规约符合（`AGENTS.md` 死规则 / `DESIGN.md`）

- `CodeBlock.tsx` 仍为 `PrismLight`：`dist/assets/` 中高亮仍是单 chunk `syntax-highlighter-CUlFCbOG.js`（117,470 B），无语言 chunk 爆炸。✅
- 本任务未改 CSS/UI，`DESIGN.md` 的编辑态 token（`block-editor` 2px 左轨、`editor-toast` 3px 圆角、`edit-source` 14px/1.55 等宽）在 T7 已落地，本次仅引用，未产生新的设计语言偏差。✅
- 新增文档中的 ✅/❌ 属仓库既有评审文档惯例（`docs/superpowers/reviews/*.md` 多篇已用），非产品 UI 文案，不触犯「无 emoji」的产品规则。✅

---

## Assessment

**Task quality:** Needs fixes

**Reasoning:** 可跑的数字与结构性事实（400/63 用例、tsc、cargo、chunk 字节、F34 判别力、F35 不伪造、功能代码零改动）**全部亲验属实**，F34/F35/F11/F17/F26 的裁定均被合规执行，这是本次收口任务的主体，质量在合格线以上；但 `CHANGELOG.md:12` 对用户宣告的「>800ms 挂自适应软提示」在代码里没有任何 UI 消费者（且被同一提交的验收报告自认「用户看不到」），这份提交唯一的价值就是「声明可信」，故不予直接放行。修复面极小：1 行 CHANGELOG 措辞 + spec 一处 commit 哈希 + 验收报告 3 处交叉引用 + 1 处 AGENTS 括注，代码与测试无需任何改动。

### 实际跑过的命令与输出摘要

| 命令 | 输出摘要 |
|---|---|
| `git diff --stat ef696af 05505eb` | 5 文件，+277 −12（唯一代码文件 `src/App.test.tsx`） |
| `git show --stat --oneline 05505eb` | 同 5 文件，提交信息与简报 Step 3 一致 |
| `npx vitest run src/App.test.tsx` | `Test Files 1 passed (1)` / `Tests 53 passed (53)` |
| `npx vitest run src/App.test.tsx --reporter=verbose \| grep -c ✓` | 53 |
| `npm test` | `Test Files 31 passed (31)` / `Tests 400 passed (400)`（7.82s） |
| `npx tsc --noEmit` | 无输出，`exit=0` |
| `cd src-tauri && cargo test` | `56 passed; 0 failed` + `7 passed; 0 failed` + `0`（doc-tests） |
| `git show ef696af:src/App.test.tsx \| grep -cE "^\s*(test\|it)\("` | 52（现 53） |
| `ls -l dist/assets/*.js` / `grep -o 'src="…index….js"' dist/index.html` | `index-Coyz_cau.js` = 158,080 B，html 指向它；6 个 chunk，无语言 chunk |
| `grep -o "math[A-Za-z]*" dist/assets/index-Coyz_cau.js` | `mathFlow` / `mathText` / `mathFlowFenceMeta` … ⇒ math 解析器确在入口 chunk |
| `grep -rn "heavyDoc" src/App.tsx src/components/*.tsx src/styles/kami.css` | 零命中（仅 hook 内部 state） |
| `grep -rn "scrollTop =" src/ --include=*.ts --include=*.tsx`（去测试） | 5 处，唯一能写 `scrollHeight` 的是 `App.tsx:643` |
| `git log --oneline -S "notifyInterrupted" -- src/hooks/useDocumentEditor.ts` | `e82ba24`（T4 交付）→ `db001e0`（后继修改） |
| `grep "已通过\|已手检\|手检通过\|已真机" 验收报告 + T8 报告` | exit=1（零命中） |
| `git status --short` / `git worktree list` | `src/` 无残留改动；`vellum-baseline-wt` 已移除（另一个 `Vellum-edit` worktree 标 prunable，与本任务无关） |

**只读边界声明**：未运行 `npm run build`（会覆写 `dist/`）、未注入变异（会改 `src/App.tsx`）、未新建工作树复现 F11 基线——三处均以产物/代码路径论证代替，已在 M-5 与第 2 节中逐处标明证据强度。
