# Task 8 报告 — 全量回归、文档与验收报告

- 日期：2026-09-10
- 工作目录：`C:\Users\17445\Desktop\Vellum`，分支 `master`，起点 HEAD `ef696af`
- 使用的技能：`superpowers/executing-plans`（按 bite-sized 步骤执行）、`superpowers/verification-before-completion`（先跑命令取证据再下结论）
- 交付物：`docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md`（用户面验收报告）+ 本文件（过程证据）

---

## 0. 结论摘要

| 项 | 结果 |
|---|---|
| 全量回归 | `npm test` 31 文件 / **400 用例全绿**；`npx tsc --noEmit` exit 0；`npm run build` 成功；`cargo test` 56+7=**63 用例全绿** |
| F34（恒真用例修复） | **已修复**：拆为「F30 早退」+「同路径重开驱动的滚动仲裁」两条具判别力用例；两次变异注入各红一次，旧用例在同一变异下仍绿（判别力证据见 §3） |
| F11（入口 chunk） | **+14.32 kB**（143,766 B → 158,080 B；gzip +4.57 kB），**未超 20KB 守门线**，回退方案未触发（§4） |
| F17 / F26 | 已写入验收报告「已知限制」（畸形围栏 `end` 越界；`heavyDoc` 粘性 + 无 UI 消费点） |
| F35（真机手检） | **未执行**，14 项逐条写成含步骤与预期的未勾选清单（§7）；本报告不伪造任何手检结论 |
| 功能代码改动 | 无（唯一例外：`src/App.test.tsx` 的 F34 测试修复） |
| 依赖变更 | 无 |

---

## 1. 全量回归（含基线）

### 1.1 基线（本任务改动之前，同一工作树）

```
$ npm test
 Test Files  31 passed (31)
      Tests  399 passed (399)
   Start at  14:12:30
   Duration  8.25s

$ npx tsc --noEmit
（无输出）
tsc exit: 0
```

基线提交状态：`git log --oneline -1` → `ef696af feat(edit): 编辑视图样式与设计语言同步（区段置于 mdlog 之前、display:contents 数学块容器）`；`git status --short` 中 `src/` 无改动（仅 `.pi/agents/*`、`docs/superpowers/plans/*.md` 的派发前既有改动）。

### 1.2 收口后（最终改动全部落地、提交前的最后一次复核）

```
$ npm test
> vellum@1.5.0 test
> vitest run

 RUN  v4.1.9 C:/Users/17445/Desktop/Vellum

 Test Files  31 passed (31)
      Tests  400 passed (400)
   Start at  14:20:16
   Duration  7.93s (transform 4.18s, setup 4.70s, import 14.44s, tests 9.96s, environment 43.43s)

$ npx tsc --noEmit
（无输出）
tsc exit=0

$ npm run build
（前略：KaTeX woff2 字体与 CSS 产物）
dist/assets/index-ieLhwIgY.css                         23.30 kB │ gzip:  5.28 kB
dist/assets/rolldown-runtime-QTnfLwEv.js                0.69 kB │ gzip:  0.42 kB
dist/assets/syntax-highlighter-CUlFCbOG.js            117.47 kB │ gzip: 38.59 kB
dist/assets/index-Coyz_cau.js                         158.08 kB │ gzip: 45.05 kB
dist/assets/vendor-react-b08XxTfu.js                  182.17 kB │ gzip: 57.35 kB
dist/assets/MarkdownDocument-CWsRmz5x.js              262.93 kB │ gzip: 82.06 kB
✓ built in 2.20s

$ cd src-tauri && cargo test
test result: ok. 56 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

> 同一条链路在 14:17:46 与 14:20:16 各跑一次，结果逐项一致（400 / exit 0 / 158.08 kB / 56+7）。上一轮 `cargo test` 首跑含 `Compiling vellum v1.5.0`（增量编译）；无 `warning: unused` 类新增告警。

用例数变化说明：399 → 400 = F34 把 1 条恒真用例拆成 2 条（净 +1）。

---

## 2. 文档同步（三份文件 + 验收报告）

### 2.1 `CHANGELOG.md`

新增 `## [未发布]` → `### 新增`，5 条要点：块级就地编辑手感（含行级光标落点的说明）、提交即落盘（原子写 + EOL/BOM 保真 + 三重闸门 + 失败回退 + 800ms 自适应软提示）、结构性只读与 mdlog 三重门禁、外部变更分流与回声抑制、包裹层与阅读视图零回归。

用 `## [未发布]` 而非 `## [1.6.0]` 的理由：`v1.5.0` 已有 tag，`package.json` / `Cargo.toml` / `tauri.conf.json` 三处版本仍为 `1.5.0`，本仓库版本号由独立的 `release: vX.Y.Z` 提交统一 bump（见 `036c792 release: v1.5.0`、`ed5a9c2 release: v1.4.0`）；本任务不做版本发布，预声明 1.6.0 会与版本号文件不一致。文件头已声明格式基于 Keep a Changelog，`[未发布]` 是该格式的标准写法。

### 2.2 `AGENTS.md`

| 位置 | 改动 |
|---|---|
| `性能结构约束` | 新增「**块级就地编辑（2026-09-10 新增）不变量**」六条子项：① 编辑面沿用 `.document-scroll`、不得新建内层滚动系统；② 提交不递增 `reloadTick`／不闪「墨迹未干」／不做滚动补偿，回声由「磁盘 vs 内存 markdown（LF 归一）」抑制；③ `.vellum-unit-wrap` 必须 `display: contents`，故操作必须落在 `resolveTarget()` 选出的「首个有布局盒元素」上；④ 覆盖层选择器必须是 `.document-scroll__content--editing > .block-editor__input` 且不是 `.markdown-body` 后代（`kami.css.test.ts` 锁死）；⑤ mdlog 门禁三重（入口 + 提交口 + Rust）；⑥ 入口 chunk 实测增量与 F11 退路 |
| `文件索引` | 补 5 行：`App.tsx`（职责扩写）、`BlockEditor.tsx`、`useDocumentEditor.ts`、`editUnits.ts`、`rehypeEditUnits.ts` |
| `命令` | `npm test` 注释由「26 测试文件，280 用例」更正为「31 测试文件，400 用例」 |
| `注意事项` | 首条「纯阅读器，无编辑功能」→「阅读器 + 块级就地编辑（`Ctrl+E` / 顶栏按钮进编辑视图；mdlog 记录中禁止编辑）」 |

（后三条属简报字面要求之外的事实更正：本功能已使这三处表述失真，一并修正并在验收报告 §9.8 登记。）

### 2.3 `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md`

- 头部状态：`待评审` → `已实施并收口（2026-09-10，Task 8；实施期修订见 §14）`
- §4 表格行、§5.3 条目：就地划去「`kamiSchema` 追加 `data*`」并指向 §14.2
- §7.2：回声判据正文改为「与**当前内存 markdown**」并指向 §14.4
- 新增 **§14 实施期修订登记**：14.1 §6.4 二选一横幅 → 中断路径（Task 4 已登记，补 commit `db001e0`）；14.2 计划步骤 5.4 作废（不得给 `kamiSchema` 加 `data*`，裁定 F13）；14.3 `<pre>` 一律外包 `.vellum-unit-wrap`、`h1/h2/h3` 交还标记属性（F12）；14.4 回声判据改为内存比对（F30，`46ed156`）；14.5 覆盖层定位基准 / 操作目标解析 / 自增高显式写高（F4/F18/F19/F20/F27）；14.6 toast 2.4s 自动消失已落地（F31）；14.7 其余裁定落地位置（F7–F9 / F17 / F26 / F28–F29 / F33）；14.8 §10 回归基线实测数字更正（本功能前 31 文件 399 用例 → 收口后 400；`cargo test` 63）

---

## 3. F34：退化为恒真的既有用例已修复（红→绿证据）

### 3.1 原用例为何恒真

`src/App.test.tsx`（改动前 `:1257-1290`）用 `file-changed` + 磁盘内容与内存一致来触发 `reloadTick`，并断言 `container.scrollTop === 250`（而 `reloadCurrent` 记录的 `pendingScrollRef.current` 恰好也是 250）。Task 6 修复轮按裁定 F30 给 `reloadApp` 加了「磁盘 == 内存 ⇒ 整体早退」后，该场景不再产生 `reloadTick`、布局 effect 不运行，`scrollTop` 自然保持原值 ⇒ 断言恒真。

### 3.2 变异性实证（旧用例在同一变异下仍绿）

**变异 A：布局 effect 依赖去掉 `reloadTick`**（`App.tsx:673` → `}, [activeDocument?.markdown]);`）

```
$ npx vitest run src/App.test.tsx -t "layout effect arbitrates scroll on hot reload even when markdown content is unchanged"
 Test Files  1 passed (1)
      Tests  1 passed | 51 skipped (52)
```

→ 旧用例**通过**：它无法区分「有/无 reloadTick 驱动滚动仲裁」。

**变异 B：关掉 F30 早退**（`App.tsx:458` → `if (false) {`）

```
$ npx vitest run src/App.test.tsx -t "layout effect arbitrates scroll on hot reload even when markdown content is unchanged"
 Test Files  1 passed (1)
      Tests  1 passed | 51 skipped (52)
```

→ 旧用例**通过**：它也无法区分「有/无滚动仲裁」。

两次变异均以备份文件全量还原（`diff` 逐字节校验 + `git status --short src/App.tsx` 无输出）。

### 3.3 修复后的两条用例与红跑证据

**用例 1（新）**：`hot reload with unchanged content is a no-op: no reloadTick, no scroll arbitration (F30 早退)` —— 断言早退本身：`file-changed` 注入「磁盘 == 内存」，容器处于贴底区间（距底 20px ≤ 80，若仲裁执行必被写成 `scrollHeight = 1000`），断言 `scrollTop` 仍 380、`.reload-note` 为 null，并断言 `load_document` 被调用 2 次（防「处理器没跑」的假绿）。

**用例 2（保留原名的真实路径）**：`layout effect arbitrates scroll on hot reload even when markdown content is unchanged (via reloadTick)` —— 改走**同路径重开**（`loadPath` → `isSamePath` → `reloadCurrent`，即系统关联/第二实例深链的真实入口）。markdown 字符串逐字符相同 ⇒ React 认为 `markdown` 依赖未变，唯一能驱动布局 effect 的就是 `reloadTick`；断掉 `rAF` 使缓动不覆盖，断言贴底仲裁写入 `scrollTop = scrollHeight = 1000` + `restoreScrollPosition` 收到 `{ ratio: 1 }` + 出现「墨迹未干」印章。

**红跑（变异 A：去掉 `reloadTick` 依赖）**

```
FAIL  src/App.test.tsx > layout effect arbitrates scroll on hot reload even when markdown content is unchanged (via reloadTick)
AssertionError: expected 380 to be 1000 // Object.is equality

- Expected
+ Received

- 1000
+ 380

 ❯ src/App.test.tsx:1340:31
    1338|   // 贴底仲裁写入 scrollHeight（rAF 已断，缓动不会覆盖它）：
    1339|   // 去掉 reloadTick 依赖或删掉贴底分支，这里都会停在 380
    1340|   expect(container.scrollTop).toBe(1000);
      |                               ^
 Test Files  1 failed (1)
      Tests  1 failed | 52 skipped (53)
```

**红跑（变异 B：关掉 F30 早退）**

```
FAIL  src/App.test.tsx > hot reload with unchanged content is a no-op: no reloadTick, no scroll arbitration (F30 早退)
AssertionError: expected 1000 to be 380 // Object.is equality

- Expected
+ Received

- 380
+ 1000

 ❯ src/App.test.tsx:1295:31
    1293|   ).toHaveLength(2);
    1294|   // 判据：内容未变 ⇒ 无 reloadTick ⇒ 布局 effect 不跑 ⇒ 位置与印章都不动
    1295|   expect(container.scrollTop).toBe(380);
      |                               ^
 Test Files  1 failed (1)
      Tests  1 failed | 52 skipped (53)
```

**绿跑（还原后）**

```
$ npx vitest run src/App.test.tsx
 Test Files  1 passed (1)
      Tests  53 passed (53)
   Start at  14:15:49
   Duration  5.36s
```

（该文件改动前 52 条用例，现在 53 条 = 52 − 1 + 2。）

---

## 4. 入口 chunk 体积实测（F11）

方法：`git worktree add --detach /c/Users/17445/Desktop/vellum-baseline-wt d9f8523`（本功能之前：计划与代码首次落库 `2e2c11c` 之前一个提交），用 `mklink /J` 把主工作树 `node_modules` 挂入该工作树，两侧各跑一次 `npm run build`，取 `dist/index.html` 中 `<script type="module">` 指向的入口 chunk。

| 侧 | 提交 | vite 报数 | 真实字节（`ls -l`） | gzip |
|---|---|---|---|---|
| 之前 | `d9f8523` | `assets/index-B5tOYCci.js 143.76 kB` | 143,766 B | 40.48 kB |
| 之后 | `ef696af` + 本任务改动 | `assets/index-Coyz_cau.js 158.08 kB` | 158,080 B | 45.05 kB |
| **增量** | | **+14.32 kB** | **+14,314 B** | **+4.57 kB** |

```
$ ls -l dist/assets/index-Coyz_cau.js /c/Users/17445/Desktop/vellum-baseline-wt/dist/assets/index-B5tOYCci.js
-rw-r--r-- 1 17445 197609 143766 Sep 10 14:13 /c/Users/17445/Desktop/vellum-baseline-wt/dist/assets/index-B5tOYCci.js
-rw-r--r-- 1 17445 197609 158080 Sep 10 14:12 dist/assets/index-Coyz_cau.js
```

旁证（同一对构建）：

| 产物 | 之前 | 之后 | Δ |
|---|---|---|---|
| `MarkdownDocument-*.js`（懒加载） | 266.59 kB | 262.93 kB | −3.66 kB（单元代码移到入口侧） |
| `syntax-highlighter-*.js` | 117.47 kB | 117.47 kB | 0 |
| `rolldown-runtime-*.js` | 0.69 kB | 0.69 kB | 0 |
| `vendor-react-*.js` | 182.16 kB | 182.17 kB | +0.01 kB（噪声） |
| `index-*.css` | 22.41 kB | 23.30 kB | +0.89 kB（T7 编辑态区段；与 JS 入口无关，单列） |

结论：**+14.32 kB ≤ 20 kB 守门线**，裁定 F11 的回退方案（把单元计算留在 `MarkdownDocument`（lazy 侧）并用 props 上传）**不触发**；增量归因已写入 `AGENTS.md`（`useDocumentEditor` import `buildEditUnits` ⇒ `micromark-extension-math` 进入口 chunk）。工作树随后以 `git worktree remove --force` + 手工删除残留的 `node_modules` 联接移除，`git worktree list` 中不再出现。

---

## 5. 改动文件清单

| # | 路径 | 类型 | 说明 |
|---|---|---|---|
| 1 | `src/App.test.tsx` | 修改（+57 −34 附近） | F34：1 条恒真用例 → 2 条具判别力用例（本任务唯一允许的代码改动） |
| 2 | `CHANGELOG.md` | 修改 | 新增 `## [未发布]` / `### 新增`（5 条） |
| 3 | `AGENTS.md` | 修改 | 性能结构约束补记 6 条 + 文件索引 5 行 + 2 处事实更正 |
| 4 | `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md` | 修改 | 状态更新 + §4/§5.3/§7.2 就地修订 + 新增 §14 修订登记（8 小节） |
| 5 | `docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md` | 新增 | 验收报告（功能概述 / 验证结果表 / chunk 实测 / 已知限制 / 真机手检清单 14 项未执行） |
| 6 | `.superpowers/sdd/2026-09-10-vellum-block-editing/task-8-report.md` | 新增 | 本文件 |

未改动：任何 `.tsx` / `.ts` 逻辑、`src-tauri/`、`src/styles/kami.css`、`vite.config.ts`、`package.json`（无新增依赖）。工作树中 `.pi/agents/*` 与 `docs/superpowers/plans/2026-09-10-vellum-block-editing.md` 的未提交改动为派发前既有，**未纳入本次提交**。

提交：`05505eb docs(edit): 块级就地编辑收口（更新日志、性能约束补记、spec 修订登记、验收报告）`（单次提交，5 文件 / +277 −12，含 F34 的测试修复）。

> `.superpowers/` 被 `.gitignore` 忽略（历次任务报告同样不入库），故本报告与 `docs/superpowers/reviews/` 下的验收报告不同：前者不入库，后者随本次提交入库。

---

## 6. 与 spec / 计划的偏差

1. **提交信息为 `docs(edit)` 但含一条测试改动**（F34 要求）：控制器要求单次提交，故把 `src/App.test.tsx` 一并纳入该提交；若需严格分离可拆为 `test(edit): 修复 reloadTick 滚动仲裁用例的判别力`。已在验收报告 §9 登记。
2. **`CHANGELOG.md` 用 `## [未发布]`** 而非预声明 `1.6.0`（理由见 §2.1）；简报未规定版本号。
3. **`AGENTS.md` 额外做了 3 处事实更正**（测试用例数、文件索引、注意事项首条「纯阅读器」）——超出「补记性能约束」的字面范围，但属本功能导致的文档失真。
4. **除简报列出的 4 条登记外，spec §14 还登记了 14.5 / 14.6 / 14.7 / 14.8**（定位基准、操作目标解析、自增高、toast、其余裁定落地位置、基线数字）——简报写的是「至少」，均为已完成但正文口径不符的事实。
5. **F34 的处置形态**：简报允许「改成能真区分…的断言，或改用同名真实路径」，我两条都做了（保留原名的真实路径 + 新增早退判别用例）。

---

## 7. 未执行项（真机 GUI 手检清单）

**全部 14 项均未执行**——本任务在全自动环境中运行，无 WebView2/GUI 会话，不做任何手检结论；完整清单（含每项步骤与预期）见 `docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md` §7。其中自动化测试**原理上看不见**的 4 项：

1. **#3 自增高推流**（裁定 F19 专条）：打字过程中下方内容持续下推、不被裁切（jsdom 的 `scrollHeight` 被 mock 为常量）。
2. **#5 CRLF 保真**：提交后 `git diff --stat` 只显示该处改动、二进制比对 `\r\n` 未被翻新。
3. **#6 iframe 不重建**：未改动块上方内容不变时，提交后 widget iframe 仍是同一 DOM 节点。
4. **#9 提交耗时实测**：用于校准 `heavyCommitMs = 800`（jsdom 的 PASS 2 数据只是保守上限）。

其余手检项：#1 阅读视图零标记 / #2 Ctrl+E 与推流基本观感 / #4 HTML 与 widget 只读 + 交互性 / #7 mdlog 门禁 / #8 回声抑制不闪印章 / #10 落盘失败不关窗 / #11 数学块包裹视觉 / #12 编辑视图点链接（F15 交叉点）/ #13 七处提交触发点 / #14 编辑视图 + 无活动块时 mdlog 变活跃。

---

## 8. 未解决项（承接验收报告 §10）

1. 真机手检 14 项全部未执行（用户完成）。
2. `heavyDoc` 无 UI 消费点（T6 报告 D12/U4 登记）：spec D5 的「>800ms 挂自适应软提示」目前只到状态层。
3. 畸形围栏下保留单元的 `end` 越界（裁定 F17）：登记为已知取舍，不修。
4. 关窗处理器的异常分支（`task-6-fix-rereview.md` 建议 3）：防御性 `try/catch` 待下一轮。
5. F30 在途窗口的极窄残余（裁定已明示接受）与 F15 链接双触发（v1 不改）：以手检结论决定是否补丁。
