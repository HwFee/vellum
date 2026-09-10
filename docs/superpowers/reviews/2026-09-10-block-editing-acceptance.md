# 块级就地编辑 · 验收报告

- 日期：2026-09-10（Task 8 收口）
- 范围：`docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md` 定义的全部功能（T1–T7 已交付）
- 结论：**自动化验证全绿**；**真机 GUI 手检未执行**（清单见 §7，逐项含步骤与预期，由用户完成）
- 依据：实施计划 `docs/superpowers/plans/2026-09-10-vellum-block-editing.md` + 裁定 `rulings.md`（F1–F35，与计划冲突时以裁定为准）

## 1. 功能概述

阅读视图 ⇄ 编辑视图（`Ctrl+E` / 顶栏按钮）；编辑视图下**点块就地改源码、点走即提交**（提交即落盘，无脏标记）。

| 交付面 | 内容 |
|---|---|
| 块单元划分 | `src/lib/editUnits.ts`（纯函数）：顶层节点各成一块 + `list` 下钻到 `listItem` + `blockquote` 下钻一层；区间排序、互不重叠并对重叠做归一化 |
| 结构性只读 | 块级 HTML（含 mdlog 头注释）与 `vellum-widget` 围栏**无编辑入口**，点击只给提示（含嵌套在引用/列表内的情形）；行内 HTML 仍是块内可编辑文本 |
| 标记与包裹 | `src/lib/rehypeEditUnits.ts`：按源码区间给块元素打 `data-vellum-unit`，**仅编辑视图启用**（阅读视图 DOM 与改动前逐字节一致）；代码块/widget/数学块一律外包 `div.vellum-unit-wrap`（`display: contents`），`h1/h2/h3` 手动交还标记属性 |
| 就地编辑面 | `src/components/BlockEditor.tsx`：隐藏原块并锁高、等位覆盖层 textarea、自增高推流、行级光标落点、`Esc`/`Ctrl+S`/失焦提交、一次性提交闸门 |
| 编辑会话状态机 | `src/hooks/useDocumentEditor.ts`：视图模式、草稿、提交即落盘、mdlog 门禁、重文档标记、2.4s 自动消失的提示条 |
| 落盘 | Rust `save_document`：原子写（同目录临时文件 + rename，临时名唯一）+ 换行符/BOM 保真 + 路径/扩展名/50MB/mdlog 存活四道闸门 |
| 一致性 | 回声抑制（磁盘 vs 内存 markdown，LF 归一比对）；外部变更中断当前编辑（草稿尽力写入剪贴板）后静默热重载；失败路径内存回退 + 草稿留在框里可重试 |
| 样式 | `kami.css` 编辑态区段（置于首个 `.mdlog-widget` 之前）+ `DESIGN.md` 编辑态 token |

## 2. 自动化验证结果

| 命令 | 基线（改动前） | 收口后 | 结论 |
|---|---|---|---|
| `npm test` | `Test Files 31 passed (31)` / `Tests 399 passed (399)` | `Test Files 31 passed (31)` / `Tests 400 passed (400)`（8.0s） | ✅ 全绿 |
| `npx tsc --noEmit` | exit 0（无输出） | exit 0（无输出） | ✅ 全绿 |
| `npm run build` | `✓ built in 2.10s`（基线工作树） | `✓ built in 2.21s` | ✅ 成功 |
| `cd src-tauri && cargo test` | 未单独记录 | `56 passed; 0 failed`（lib）+ `7 passed; 0 failed`（main）+ `0`（doc-tests）= **63 用例** | ✅ 全绿 |

说明：

- 「基线」= 本任务改动前的同一工作树（`npm test` / `tsc`）与「本功能之前」的提交 `d9f8523` 工作树（`build`，见 §3）。
- 收口后用例数为 400（新增 1 条：`file-changed` 内容未变时的早退），总数 31 文件；`cargo test` 无 `warning: unused` 类新增告警。
- `npm test` 覆盖了接线级回归：`App.test.tsx`（含关窗递归语义 mock、mdlog 门禁、回声抑制、外部变更分流）、`MarkdownDocument.test.tsx`（阅读视图 DOM 逐字节一致 / 热重载不重建 iframe）、`BlockEditor.test.tsx`、`useDocumentEditor.test.ts`、`editUnits.test.ts`、`rehypeEditUnits.test.ts`、`kami.css.test.ts`（覆盖层选择器与区段扫描约束）。

## 3. 入口 chunk 体积实测（裁定 F11）

方法：`git worktree` 检出**本功能之前**的提交 `d9f8523`（计划与代码首次落库 `2e2c11c` 之前），把主工作树的 `node_modules` 以目录联接挂入该工作树，两侧各跑一次 `npm run build`，取 `dist/index.html` 里 `<script type="module">` 指向的入口 chunk。

| 侧 | 提交 / 工作树 | 入口 chunk | 字节数 | gzip |
|---|---|---|---|---|
| 之前 | `d9f8523`（worktree） | `assets/index-B5tOYCci.js` | 143,766 B（vite 报 143.76 kB） | 40.48 kB |
| 之后 | HEAD + 本任务改动 | `assets/index-Coyz_cau.js` | 158,080 B（vite 报 158.08 kB） | 45.05 kB |
| **增量** | | | **+14,314 B = +14.32 kB** | **+4.57 kB** |

- **未超过 20KB 守门线**，裁定 F11 的回退方案（把单元计算移回 lazy 侧、用 props 上传）**未触发**。
- 数据来源：两次 `npm run build` 的 vite 输出 + `ls -l dist/assets/index-*.js` 的真实字节数（附图 chunk 名的对比基线见 §5 的原始输出）。
- 同类对照：懒加载的 `MarkdownDocument-*.js` 由 266.59 kB **降到** 262.93 kB（块单元代码移到了入口侧），两条初始模块 `rolldown-runtime` / `syntax-highlighter` 完全不变，`vendor-react` 仅 ±0.01 kB 噪声；样式 `index-*.css` 由 22.41 kB → 23.30 kB（+0.89 kB，T7 编辑态区段）。
- 增量归因：`useDocumentEditor`（App 侧）import `buildEditUnits` ⇒ `micromark-extension-math` 进入入口 chunk（本功能新增依赖 `mdast-util-math` / `micromark-extension-math`，仅此两个）。
- 已把该数字写入 `AGENTS.md` 的性能结构约束（含 F11 退路的提示）。

## 4. F34：退化为恒真的既有用例已修复（判别力证据）

**问题**：Task 6 修复轮把回声判据改为「磁盘 vs 内存 markdown 比对」（裁定 F30）后，`file-changed` 在内容未变时整体早退、不再递增 `reloadTick`，于是既有用例 `layout effect arbitrates scroll on hot reload even when markdown content is unchanged (via reloadTick)` 的路径永不执行、断言 `scrollTop` 恒真（登记于 `task-6-fix-rereview.md` U3 / `task-6-fix-report.md` D14.2）。

**处置**：不删除，拆成两条互补用例（`src/App.test.tsx`）：

1. `hot reload with unchanged content is a no-op: no reloadTick, no scroll arbitration (F30 早退)` —— 断言早退本身：沿用 `file-changed` 注入「磁盘 == 内存」，此时容器**处于贴底区间**（距底 20px ≤ 80，若仲裁执行必被写成 `scrollHeight = 1000`），断言 `scrollTop` 仍为 380、无 `.reload-note` 印章，并断言确实读过盘（`load_document` 计 2 次）以免「处理器没跑」的假绿。
2. `layout effect arbitrates scroll on hot reload even when markdown content is unchanged (via reloadTick)` —— **保留原名与原命题**，改走真实路径：**同路径重开**（`loadPath` → `reloadCurrent`，系统关联/第二实例深链的真实入口）。此路径内容逐字符相同 ⇒ `markdown` 依赖不变化，唯一能驱动布局 effect 的就是 `reloadTick`。断掉 `rAF` 使缓动不覆盖，断言贴底仲裁写入 `scrollTop = scrollHeight = 1000`、`restoreScrollPosition` 收到 `{ ratio: 1 }`、且「墨迹未干」印章出现。

**红→绿证据**（每条都实跑）：

| # | 注入的变异 | 旧用例 | 新用例 |
|---|---|---|---|
| A | 布局 effect 依赖去掉 `reloadTick`（`}, [activeDocument?.markdown]);`） | ✅ **仍通过**（证明旧用例对「有/无 reloadTick 驱动」无判别力） | ❌ 失败：`AssertionError: expected 380 to be 1000` |
| B | 关掉 F30 早退（`if (false) { return; }`） | ✅ **仍通过**（证明旧用例对「有/无滚动仲裁」无判别力） | ❌ 失败：`AssertionError: expected 1000 to be 380` |

变异注入后均以备份文件还原（`diff` 校验 `src/App.tsx` 与 HEAD 逐字节一致，工作树无残留），再跑 `npx vitest run src/App.test.tsx` → `53 passed (53)`，全量 `npm test` → `400 passed (400)`。

## 5. 文档同步

| 文件 | 改动 |
|---|---|
| `CHANGELOG.md` | 新增 `## [未发布]` → `### 新增`（5 条：块级就地编辑手感、提交即落盘与原子写、结构性只读、回声抑制与外部变更分流、包裹层与阅读视图零回归）。用「未发布」而非 `1.6.0`：`v1.5.0` 已有 tag、版本号文件（`package.json` / `Cargo.toml` / `tauri.conf.json`）仍在 1.5.0，本仓库的版本号由独立的 `release: vX.Y.Z` 提交统一 bump，本任务不做版本发布 |
| `AGENTS.md` | ①「性能结构约束」新增「块级就地编辑不变量」六条（编辑面沿用 `.document-scroll` 不新建滚动系统；提交不递增 `reloadTick` 不闪印章 + 回声判据；`.vellum-unit-wrap` 必须 `display: contents` 与 `resolveTarget` 的关系；覆盖层选择器特异度；mdlog 三重门禁；入口 chunk 实测增量与 F11 退路）；② 文件索引补 5 行（`BlockEditor` / `useDocumentEditor` / `editUnits` / `rehypeEditUnits` + `App.tsx` 职责扩写）；③「注意事项」首条「纯阅读器，无编辑功能」→ 更正为「阅读器 + 块级就地编辑」（该句已成事实错误）；④ `npm test` 注释的用例数由 26 文件/280 用例更正为 31 文件/400 用例 |
| `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md` | 状态改为「已实施并收口」；§4/§5.3 就地作废「`kamiSchema` 追加 `data*`」；§7.2 就地修订回声判据为「与内存 markdown 比对」；新增 **§14 实施期修订登记**（14.1 §6.4 二选一横幅简化为中断路径、14.2 计划步骤 5.4 作废、14.3 `<pre>` 一律外包 + 标题交还标记属性、14.4 回声判据、14.5 定位基准/操作目标解析/自增高显式写高、14.6 toast 2.4s 自动消失、14.7 其余裁定落地位置、14.8 回归基线实测数字） |

## 6. 改动文件清单（本任务）

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/App.test.tsx` | 修改（测试，F34 唯一允许的代码改动） | 1 条恒真用例 → 2 条具判别力用例 |
| `CHANGELOG.md` | 修改 | 新增「未发布」条目 |
| `AGENTS.md` | 修改 | 性能约束补记 + 文件索引 + 事实更正 |
| `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md` | 修改 | 修订登记 §14 + 就地作废/修订 |
| `docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md` | 新增 | 本文件 |
| `.superpowers/sdd/2026-09-10-vellum-block-editing/task-8-report.md` | 新增 | 过程报告（逐条命令与原始输出） |

未改任何功能代码（`.tsx`/`.ts` 逻辑 / Rust / CSS），未新增依赖。工作树内 `.pi/agents/*` 与 `docs/superpowers/plans/*.md` 的既有未提交改动**非本任务产生**，未纳入本次提交。

## 7. 真机 GUI 手检清单（**未执行**）

> 以下各条**均未执行**（本任务在全自动环境中完成，无 GUI/WebView2 会话），由用户按步骤手检；预期栏即判定标准。

| # | 步骤 | 预期 |
|---|---|---|
| 1 | 打开一份含代码块 / widget / 数学块的文档，在阅读视图点击正文文字 | 只选中文字、无编辑框；DevTools 执行 `document.querySelectorAll("[data-vellum-unit]").length` → `0`；块元素无 `style` 残留 |
| 2 | `Ctrl+E` 进编辑视图，点一个段落 | 出现 textarea（内容 == 该块源码，含列表标记/引用前缀）；**下方内容被推下去**而非被盖住；编辑器与原块位置/宽度对齐 |
| 3 | 在长段落里连续输入数十行（裁定 F19 专条：jsdom 看不见自增高路径） | 打字过程中下方内容持续下推、视口不跳动（原生 scroll anchoring），编辑器不出现内部滚动条、内容不被裁切 |
| 4 | 点击块级 HTML 块与 `vellum-widget` 块 | 仅出现提示条（「HTML 区块为只读」/「交互块只读，点击可交互」），无编辑框；静态 widget 点击不弹编辑框；**可交互 widget 内部控件仍可正常操作**（不被编辑面抢点击） |
| 5 | 在 CRLF 文档上改一个字并提交 | 落盘内容正确；`git diff --stat` 只显示该处改动（不出现整篇换行翻新）；二进制比对确认 `\r\n` 未被翻成 `\n`；BOM（若有）保留 |
| 6 | 提交前记下同一文档中未改动块下方 widget iframe 的 DOM 节点（DevTools 选中），提交后再看 | 未改动块**上方**内容不变时，该 iframe 节点未重建（`=== ` 同一节点）；改动块下方若出现重建属已知代价（§7 第 3 条） |
| 7 | 连接 mdlog 记录后尝试进编辑视图 | 顶栏编辑按钮禁用；`Ctrl+E` 提示「记录中 · 断开连接后才能修改」；若先进入编辑态再建立记录 → 提示「记录已开始，编辑已取消」且**草稿被写入剪贴板** |
| 8 | mdlog 记录中在 Vellum 里提交一个块（或提交后模型追加） | 不闪「墨迹未干」印章、不做滚动补偿（回声抑制）；页面停留在用户当前阅读位置（记录期不吸底） |
| 9 | 提交耗时实测（用于校准 800ms 阈值）：在散文 101KB / 301KB / 1MB 与 widget 重度 512KB 文档上各提交一次，用 DevTools Performance 或临时 `performance.now()` 计时 | 记录实测毫秒数；若真机普遍远低于 800ms，应下调 `heavyCommitMs`（当前仅为状态层标记，见 §7 第 2 条） |
| 10 | 落盘失败路径：把当前文档设为只读后提交 | 出现「保存失败：…」提示；**草稿仍在 textarea 里**；窗口不自动关闭、可继续编辑或手动关闭；内存内容回退到磁盘内容（再次点击同一块看到的是旧文本） |
| 11 | 数学块（`$$…$$` 与 ```` ```math ````）在阅读视图与编辑视图各看一次 | 包裹层 `display: contents` 生效，行距/间距与改动前一致（无多出一层盒子的位移）；编辑视图可点入编辑 |
| 12 | 编辑视图点击块内链接（裁定 F15 的已知交叉点） | 会同时「系统浏览器打开」+「激活该块编辑框」；判断观感是否可接受（若不可接受，回补一行：编辑视图下 `a` 只激活不打开） |
| 13 | 编辑态下逐一触发提交：`Esc`、`Ctrl+S`、点别的块、搜索跳转、大纲跳转、切换文档、关闭窗口 | 每次都提交且落盘（DevTools 观察无 `save_document` 报错）；原块 `style` 属性被清空（无 `visibility`/`height`/`overflow` 残留）；落盘失败时窗口不关 |
| 14 | 编辑视图 + 有活动块时建立 mdlog 记录（自动化的边沿场景） | 提示一次「记录已开始，编辑已取消」，且不重复刷提示；无活动块时静默退出编辑视图（当前无提示，登记项见 §7 第 5 条） |

## 8. 已知限制（含登记项）

| # | 限制 | 影响与处置 |
|---|---|---|
| 1 | **畸形围栏下保留单元的 `end` 仍可能伸进被丢弃项**（裁定 F17） | 输入 `"- a\n\n  ```\n  x\n  ```- b\n- c\n"` 归一化后保留 `[0,26)`、丢弃 `[24,27)`，前者 `end` 跨过 `- c` 的 `- `，此时提交会把下一列表项降级为段落。仅触发于畸形输入（关闭围栏行带尾随文字）；124 份真实文档 + 2951 份 fuzz 下 `dropped=0`（仅 3 份畸形样例丢块）。**不修**：夹紧前一块 `end` 需重评估是否会截断其自身围栏闭合，收益/风险不成比例。可用 git 回退，不丢文件 |
| 2 | **`heavyDoc` 提示本会话内粘性不回退（裁定 F26）+ 目前无 UI 消费点**（`task-6-report.md` D12/U4） | 观测到一次超阈值提交后标记不再复位（文档规模属性而非瞬时值）。且 T6/T7 契约均未指定 `heavyDoc` 的 UI，按 YAGNI 未自行发明 ⇒ **改「>800ms 挂软提示」（spec D5）当前只到状态层**，用户看不到提示。要落地需一次小接线 + 真机校准阈值（手检 #9） |
| 3 | **widget iframe 重建代价**（spec §11） | 提交重渲染时若改动块的**上方**内容变化，其后 widget 可能因 React 索引键漂移重建一次（交互状态丢失）。改动块下方不受影响；手检 #6 覆盖 |
| 4 | **与 pi 会话分叉**（决策 D7） | 编辑后 pi 的上下文不知情，下次续写可能与已改内容重复/矛盾。用户已知并接受；不在本次范围 |
| 5 | **光标为行级近似**（spec §11） | 点击落点按「块内纵向比率 → 源码行首」，不是字符级定位。精确映射需编辑器内核（CodeMirror 6），属非目标 |
| 6 | **F30 在途窗口的极窄残余**（`task-6-fix-rereview.md` 建议 2） | `commitActive` 在 `await save` 期间内存已领先磁盘，此刻若恰有 `file-changed` 到达会被判为外部变更、内存回退为旧内容（随后我方写入的回声自愈）。真正有损失需用户在此几毫秒内再提交另一块。裁定 F30 明示接受 |
| 7 | **编辑视图点链接双触发**（裁定 F15，v1 不改） | 打开系统浏览器的同时激活编辑框；属既有交互交叉点而非回归。手检 #12 决定是否需要补一行条件 |
| 8 | **编辑视图 + 无活动块时 mdlog 变活跃无提示**（`task-6-fix-rereview.md` 范围外观察） | 被动退出编辑视图，口径与 F32 一致（无编辑会话不提示）。手检 #14 看观感 |
| 9 | **关窗处理器的异常分支**（`task-6-fix-rereview.md` 建议 3） | `commitActive()` 意外抛出时包装层跳过 `destroy()` ⇒ 窗口既不关也不拦（安全方向），但此后关闭按钮不可用。可达性极低，未修（防御性 `try/catch` 属下一轮） |

## 9. 与 spec / 计划的偏差

1. **§6.4 外部变更「二选一横幅」简化为中断路径**（计划已登记，Task 4 交付；spec §14.1 补登）——不做「保留我的改动 / 载入磁盘版本」。
2. **计划步骤 5.4 作废**（裁定 F13）：不给 `kamiSchema` 追加 `data*`（插件在 sanitize 之后，标记不经 sanitize；追加会放宽**阅读视图**白名单）。
3. **`<pre>` 一律外包 `.vellum-unit-wrap`、`h1/h2/h3` 交还标记属性**（裁定 F12；spec §14.3）——比计划多覆盖 `components.pre` / `h1/h2/h3` 的 React 覆盖渲染。
4. **回声判据改为「与内存 markdown 比对」**（裁定 F30；spec §14.4）——删除 `lastSavedMarkdownRef` 快照。
5. **`toast` 2.4s 自动消失 + `dismissToast()`**（裁定 F31；spec §14.6）——与 spec §9 一致，CSS 只做淡入淡出。
6. **自增高由组件显式写高**（裁定 F19）：`onChange` 与 RO 回调都写 `textarea.style.height`，不依赖 textarea 自身盒高变化触发 RO。
7. **`CHANGELOG.md` 用 `## [未发布]`**：不预声明 1.6.0（版本发布由独立 `release:` 提交统一 bump，见 §5）。
8. **`AGENTS.md` 附带事实更正**：「纯阅读器，无编辑功能」、测试用例数（26/280 → 31/400）、文件索引 5 行——超出简报字面要求，属本次功能造成的文档失真，一并修正。

## 10. 未解决项

1. **真机 GUI 手检清单（§7 全部 14 项）未执行** —— 必须在有 WebView2 会话的环境中由用户完成；其中 #3（自增高推流）、#5（CRLF 保真）、#6（iframe 不重建）、#9（提交耗时校准）是自动测试**原理上看不见**的项。
2. `heavyDoc` 无 UI 消费点（§8 第 2 条）：spec D5 的「自适应软提示」尚未可见。
3. 畸形围栏单元 `end` 越界（F17）：登记不修。
4. 手检 #12 若判定链接双触发不可接受，需补一行「编辑视图下 `a` 只激活不打开」。
5. 关窗处理器异常分支的防御性 `try/catch`（§8 第 9 条）：待下一轮。
