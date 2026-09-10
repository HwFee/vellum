# SDD ledger — plan: docs/superpowers/plans/2026-09-10-vellum-block-editing.md

Spec: docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md（可读，已作为绑定权威）
Workspace: .superpowers/sdd/2026-09-10-vellum-block-editing/
Rulings 详情: ./rulings.md

## Setup

Ruling: 在 master 上继续实施（不切分支、不建 worktree） — 依据：本仓库全部历史（含历次 release）
均为 master 线性提交，无 feature 分支惯例；且控制器上一轮已明示询问「master 继续 / 切分支」，
用户以新指令代替反对 — 若判错，代价是把这些提交挪到分支（`git branch feat/... && git reset --hard <base>`，
可逆，成本低）。

Ruling: Task 1 由控制器（主对话）在 SDD 流程启动前完成，改为**事后补任务审查** —
依据：用户先指示「不派子智能体」随后改为「用子智能体」，Task 1 已按计划完成并验证 —
若判错，代价是 Task 1 未经双盲审查（已额外安排 reviewer 补审）。

## 预检扫描

### 跨任务（共享文件/接口的任务对）

| 任务对 | 生产 → 消费 | 结论 |
|---|---|---|
| T1 → T2 | `EditUnit` / `buildEditUnits` / `findUnitForRange` → 插件区间判定与标记 | ⚠️ F1：T2 内联重复了包含判定，裁定改用 `findUnitForRange` |
| T2 → T3 | DOM 契约 `data-vellum-unit` → 覆盖层目标定位 | ✅ 一致（选择器字符串两边相同） |
| T2 → T6 | props `editable` / `onActivateUnit` / `onLockedUnitClick` → App 传参 | ✅ 一致（签名与回调形状相同） |
| T2 → T7 | 类名 `vellum-unit-wrap` / `markdown-body--editing` → 样式选择器 | ⚠️ F2：`markdown-body--editing` 无生产者，裁定由 T2 补 |
| T3 → T6 | `BlockEditorProps`（受控 value/onChange/onCommit/onCancel） → App 渲染 | ✅ 一致（T3 已改为受控） |
| T3 → T7 | `.block-editor__input` 内联 top/left/width + `position:absolute` | ⚠️ F4：定位基准与 offsetParent 不一致，裁定同容器矩形相减 |
| T4 → T6 | hook 返回的 `viewMode/draft/activateUnit/commitActive/notifyLocked/notifyInterrupted/toast` → App 调用 | ✅ 一致（逐个核对，无缺项） |
| T4 → T5 | `save(next)` 由 App 注入；Rust 命令名 `save_document` 与参数 `{path, content}` | ✅ 一致（前端只消费成功/失败，不读 `bytesWritten`） |
| T5 → T6 | 命令注册进 `invoke_handler`；`SaveOutcome` camelCase | ✅ 一致 |
| T6 → T8 | 验收项（回声抑制、mdlog 门禁、CRLF 保真） → 收口报告 | ✅ 一致 |

### 单任务自一致

| 任务 | 测试 vs 实现 自检 | 结论 |
|---|---|---|
| T1 | caret 期望值 vs 实现 | ✅ 已在实做中修正（忽略尾随空行，期望 8 而非 10） |
| T2 | 插件单测依赖 `rehype-stringify` | ⚠️ F3：未安装，裁定改为直接构造 hast 调用函数 |
| T3 | jsdom `scrollHeight=0` vs 断言 `80px`；`settlingRef` 吞失焦 | ⚠️ F5：裁定补 mock、删守卫 |
| T4 | `flushSync` 量测 + 失败路径保留草稿 | ✅ 自一致（失败路径显式重新激活同块并保留草稿） |
| T5 | `TestDir` 夹具可用性、BOM/CRLF 期望 | ✅ 自一致（`use super::*` 可取到夹具与 `fs/PathBuf`） |
| T6 | 全局 Ctrl+S 未兜底 | ⚠️ F6：裁定补 `preventDefault` + `commitActive()` |
| T7 | 区段位置必须早于首个 `.mdlog-widget` | ✅ 计划已写明（并加断言测试） |
| T8 | 回归命令与真机清单 | ✅ 自一致 |

## 任务进度

Task 1: complete (commit 848899c..2e2c11c, 事后补审)
Task 1: review round 1 (reviewer @ deepseek-flash, 4m28s) — 判定 **Needs fixes**：❌ Critical-1 区间重叠（合法 Markdown 可复现：definition+setext heading；畸形围栏 2 字节重叠）、❌ Important-2 嵌套 HTML/widget 只读被绕过（3 条绕过路径）；另 Important-3 区间首行标记不对称、Minor 4/5/6/7/8/9/10（死值、死分支、计划漂移、CRLF 光标偏移、解析一致无锁定测试、入口 chunk 口径、覆盖缺口）
Task 1: Ruling F7/F8/F9/F10/F11 已记入 rulings.md（区间归一化 / 嵌套锁定类型不覆盖 / 行首起算 + LF 归一 / 删死值 / 入口 chunk 守门）
Task 1: fix round 1/5 **已交付** commit `3017ac3`（341 用例全绿，net +37）— 修复：区间归一化（`normalizeOverlaps` + `lineStartOnOrAfter`）、下钻不覆盖锁定类型、区间对齐行首、删 `"unmapped"`、补覆盖；报告 `task-1-fix-report.md`（DONE_WITH_CONCERNS：计划文档 Task 1 代码块未同步 → 控制器已加「实施后修订」注记）
Task 1: fix round 1 scoped re-review (reviewer, 4m19s) — 逐条 **ADDRESSED**（F7/F8/F9a/F10 + Minor-10 全覆盖），**All findings addressed: Yes**
Task 1: Ruling F17（畸形围栏下残留 `end` 跨入被丢弃项 — 登记不修）
Task 1: **complete** (commits 848899c..3017ac3, review clean，341 用例全绿，公开签名与常见文档块索引未变；唯一低严重度行为变化：单子块引用容器也带同索引标记，不影响点击/锁定语义)
Task 2: implemented (commits 2e2c11c..3ad0f80) — DONE_WITH_CONCERNS（28 文件 / 304 用例全绿、`tsc` 退出码 0）
Task 2: Ruling F12（接受 `<pre>` 一律外包 + h1/h2/h3 交还标记属性）/ F13（计划步骤 5.4 作废：**不**给 `kamiSchema` 追加 `data*`，否则放宽阅读视图白名单）/ F14（CRLF 切片的 caret 偏移归 T2 修复轮）— 已记入 rulings.md，计划文本已同步
Task 2: review round 1 (reviewer, 3m47s) — 判定 **Needs fixes**：❌ C1 裁定 F9b（CRLF caret 归一）未落地；⚠️ I1 `<pre>` 包裹层 × `display: contents` ⇒ rect 为 0、caret 恒落块首；I2 阅读视图 `<pre>` 路径无断言；I3 caret 零真实断言；I4 raw HTML 用例只覆盖 offset 0；M1–M4
Task 2: Ruling F15（M3 点击语义交叉点归 T3/T6，v1 不改）/ F16（M1 打标口径：不得用 `querySelectorAll("[data-vellum-unit]")` 数块数）
Task 2: fix round 1/5 **已交付** commit `1b64c53`（345 用例全绿；C1 红证据 `[0, -6, +7]`；C1/I1/I2/I3/I4/M1/M4 逐条落实）
Task 2: fix round 1 scoped re-review (reviewer, 3m44s) — 逐条 **ADDRESSED**（C1/I1/I2/I3/I4/M1/M4），**All findings addressed: Yes**
Task 2: **complete** (commits 2e2c11c..1b64c53, review clean，345 用例全绿)
Task 3: implemented (commit 784fdf9) — 30 文件 / 353 用例全绿、`tsc` 0；交付 `editorGeometry.ts`（两参 F4）、`BlockEditor.tsx`（受控、F18 目标解析）、8 个新用例
Task 3: review round 1 (reviewer, 3m49s) — 判定 **Needs fixes**：❌ Critical-1 自增高真机无触发源（textarea 自身盒高不变 ⇒ RO 永不回调；测试用手工回调掩盖）；⚠️ Important-2 host 缺失时降级成「块消失+编辑器在别处」；I3 失焦二次提交；I4 盒只算一次（上方内容变高后错位）；I5 零高真实块被误判为包裹层；I6 解析失败沿用旧盒；Minor 7–13
Task 3: Ruling F19/F20/F21/F22/F23（显式写高 / class 首选判据 / 降级与重算 / 一次性闸门 / T7 选择器特异度）
Task 3: fix round 1/5 **已交付** commit `0ab2e1c`（31 文件 / 369 用例全绿，+7 用例）；报告 `task-3-fix-report.md`
Task 3: fix round 1 scoped re-review (reviewer, 2m56s) — 逐条 **ADDRESSED**（Critical-1 / I2–I6 / Minor 7/8/10/11），**All findings addressed: Yes**（含一条已登记的裁定细化 F27）
Task 3: **complete** (commits 784fdf9..0ab2e1c, review clean，369 用例全绿；低严重度遗留：textarea.focus 在 effect 而非 layout effect，已登记)
Task 4: implemented (commit 784fdf9..e82ba24) — 31 文件 / 362 用例全绿；`tsc` 干净
Task 4: review round 1 (reviewer, 2m28s) — 判定 **Needs fixes**：❌ C1 保存失败重试路径状态不自洽（`flushSync` 已让父级吸收新文本 → 旧索引语义的 activeUnit + 旧草稿 ⇒ 重复落盘或永不落盘；探针证实）；⚠️ I2 `commitActive` 缺 mdlog 门禁（提交口可绕过）；M7 heavyDoc 不复位；M8 失败分支不恢复 caret
Task 4: Ruling F24/F25/F26（失败回退内存 / 提交口门禁 / heavyDoc 粘性）
Task 4: fix round 1/5 **已交付** commit `db001e0`（C1 + I2 + M8；M7 按 F26 不改）
Task 4: fix round 1 scoped re-review (reviewer, 2m29s) — 逐条 **ADDRESSED**，**All findings addressed: Yes**（新增风险仅建议级登记：条件性并发回退覆盖与性能代价）
Task 4: **complete** (commits e82ba24..db001e0, review clean)
Task 5: implemented (commit db001e0..8e83ca5) — 3 文件 +305；Rust 侧原子写 / EOL+BOM 保真 / 四道闸门
Task 5: review round 1 (reviewer, 3m31s) — **Approved**（无 Critical）；Important-1 读旧文件失败被静默降级为 LF（`unwrap_or_default`）、Important-2 临时名固定会互踩
Task 5: Ruling F28/F29（读失败返回 Err / 临时名加 uuid 短后缀）
Task 5: fix round 1/5 **已交付** commit `b700a86`（F28 读失败返回 Err + F29 临时名 uuid 短后缀）
Task 5: fix round 1 scoped re-review (reviewer, 1m22s) — 逐条 **ADDRESSED**（F28/F29），**All findings addressed: Yes**（`cargo test --lib save_tests` 14 passed）
Task 5: **complete** (commits 8e83ca5..b700a86, review clean)
Task 6: review round 1 (reviewer, 5m16s) — 判定 **Needs fixes**：❌ C1 关窗处理器在落盘失败时无限重试循环（Tauri `close()` 会重发 `closeRequested`，5 条一手源码证据；window mock 不模拟该语义 ⇒ 用例逃逸）；⚠️ I1 mdlog 记录中常态刷「外部修改」提示；I2 toast 无消失路径；I3 `lastSavedMarkdownRef` 会误吞真实外部变更 + 在途竞态；I4 关窗提交失败静默丢草稿；Minor 1–7
Task 6: Ruling F30/F31/F32/F33（回声判据改为内存比对 / toast 2.4s 自动消失 / 仅在会话被中断时提示 / 关窗失败不关窗且 mock 按真机语义）
Task 6: fix round 1/5 **已交付** commit `46ed156`（C1 + I1–I4 + Minor 1/2/3/5；31 文件 / **394 用例全绿**，build 成功）
Task 6: fix round 1 scoped re-review (reviewer, 4m0s) — 逐条 **ADDRESSED**，**All findings addressed: Yes**（含用 `node -e` 复刻 mock 语义证明旧实现必红）；新增 U3（一条既有 reloadTick 用例退化为恒真，已裁 F34 归入 T8）
Task 6: **complete** (commits 3f0b74a..46ed156, review clean，394 用例全绿)
Task 7: review round 1 (reviewer, 3m10s) — **Approved**（无 Critical）；两条 Important：① 覆盖层 `>` 位置无 DOM 层守卫（接线漂移会静默失效而测试全绿）② 非段落块度量差异未登记 → Ruling F36：并入终审修复波。硬指标经独立核验：区段在首个 `.mdlog-widget` 之前且不含该字样、覆盖层特异度 (0,2,0) > (0,1,1)、度量与正文逐项对得上、DESIGN.md lint errors 0
Task 7: **complete** (commits 46ed156..ef696af, review Approved，399 用例全绿；2 条 Important 按 F36 转入终审修复波)
Task 8: implemented (commit ef696af..05505eb) — **400 用例全绿**、`tsc` clean、`build` 成功、`cargo test` 全绿；F11 入门 chunk **+14.32 kB**；F34 变异注入证据；文档三份 + 验收报告；14 项真机手检**未执行**（F35）
Task 8: review round 1 (reviewer, 5m51s) — 判定 **Needs fixes**：可跑数字与结构性事实**全部亲验属实**，但 `CHANGELOG.md:12` 宣告的「>800ms 软提示」在代码里**无 UI 消费者**（唯一价值就是声明可信，故不放行）；修复面极小（1 行 CHANGELOG + spec 一处 hash + 验收三处交叉引用 + AGENTS 一处括注）
全分支终审 (reviewer, 10m46s，14 提交 / 252KB diff) — 结论 **需先修复再合并**：
  - C1 脚注定义内块级 HTML/widget 可编辑（结构性只读被绕过，三个反例实测）
  - C2 编辑框内 Ctrl+S 双通道提交 ⇒ 结构变化草稿重复拼入 + 二次落盘（实测 `新段。` 重现两次）
  - I1 落盘失败后切文档 ⇒ 上一份草稿写进新文档；I2 进出编辑视图重建全部 iframe；I3 heavyDoc 只到状态层
  - 正面结论：链路闭合、测试与文档数字可复现且诚实、400/63/tsc/build 均绿
终审修复波: Ruling F37–F43（脚注可下钻容器 + 遍历式断言 / Ctrl+S A+B 去重 / 切文档 resetSession / heavyDoc 接界面 / DOM 层位置守卫 / iframe 重建**登记不改** / 非段落度量登记）
终审修复波: **已交付** commit `e57fc13`（12 文件 +440/−41；TDD + 变异注入；未改 Rust / 未动 `.vellum-unit-wrap`）
终审修复波: 夹缝重审 **已派发**（range 05505eb..e57fc13）— 重点再验：在途闸门会不会把**落盘失败的重试路径**也拦死（F38-B 反作用）、heavyDoc 新 UI 是否泄漏到阅读视图、脚注下钻后 F7 不变量是否仍守
Task 8: pending
