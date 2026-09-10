# Task 3 修复轮 1 重审（限定范围：`e82ba24` → `0ab2e1c`）

只读重审。未修改任何文件（`git status` 确认工作树对我方文件无改动）；只跑了聚焦测试与 `tsc`，按控制器要求未重跑整套。
判定范围仅限：上一轮审查的 Critical-1 / Important-2/3/4/5/6 / Minor-7/8/10/11 + 本 diff 是否引入新破坏。

## 我实际跑过的命令与真实输出

```
$ git log --oneline -3
0ab2e1c fix(edit): 自增高显式写高与降级分支修正（审查轮 1）
e82ba24 feat(edit): 编辑会话状态机（提交即落盘、自适应重文档提示、中断与失败路径）
784fdf9 feat(edit): 就地编辑面 BlockEditor（隐藏原块锁高、自增高推流、Esc/失焦提交）

$ git diff --stat HEAD          # 工作树与 head 一致（src/ 下无未提交改动）
（仅 .pi/agents/*、docs/superpowers/plans/* 改动；src/ 零改动）

$ git show --stat 0ab2e1c | tail -4
 src/components/BlockEditor.test.tsx | 229 +++++++----
 src/components/BlockEditor.tsx      | 111 ++++++---
 2 files changed, 283 insertions(+), 57 deletions(-)   ← 与 diff 包一致，无第三个文件

$ npx vitest run src/components/BlockEditor.test.tsx src/lib/editorGeometry.test.ts
 Test Files  2 passed (2)
      Tests  15 passed (15)      Duration 1.39s
（13 条 BlockEditor 用例 + 2 条 editorGeometry 用例，与报告「6 → 13 条」一致）

$ npx tsc --noEmit
TSC_EXIT=0（无输出）

$ ls outputs/            # 探针残留检查
hit-main-building-poster.png  hit-poster-prompt.txt  mdlog  release-notes-v1.2.0.md  release-notes-v1.3.3.md
（无 __audit_scratch，与报告 §5 一致）
```

**红证据的独立核验**：我没有改动仓库（只读约束），改为用 diff 里的旧实现逐条推演失败用例数，结果与报告 §2 的突变表逐条吻合，说明那张表不是编的：

| 报告突变 | 报告结果 | 我的独立推演 |
|---|---|---|
| M1 `onChange` 去掉 `syncHeight()` | 1 failed | 只有 `:254` 那条红（textarea/target 均无写高）✓ |
| M2 `syncHeight` 不写 `textarea.style.height` | 3 failed | `:138`、`:254`、`:274` 恰好 3 条 ✓ |
| M3 去掉 `if (!host)` 早退 | 1 failed | 只有 `:127` 那条 ✓ |
| M4 去掉闸门 | 1 failed | 只有 `:168` 那条（blur → 2 次）✓ |
| M5 去掉 `observe(host)` | 1 failed | 只有 `:294` 那条 ✓ |
| M6 去掉「子节点须有布局盒」 | 1 failed | 只有 `:229` 那条 ✓ |
| M7 失败分支不 `dropOverlay()` | 1 failed | 只有 `:319` 那条 ✓ |

---

## 逐条判定

### 1. Critical-1 / F19 — ADDRESSED — 证据 `src/components/BlockEditor.tsx:64-71`、`:131-138`、`:170-173`

- 组件显式写高确实双路：`syncHeight()` 同值写 `textarea.style.height` 与 `target.style.height`（`BlockEditor.tsx:68-70`），由 `onChange`（`:170-173`）与 RO 回调（`:134` `new ResizeObserver(syncHeight)`）共用；`:133` 的首次调用来自 effect ②，`:134-136` 把 textarea 纳入观察。
- **测量确实搬到了 box 应用之后**：effect ②（`:131-138`，deps `[box, syncHeight]`）首行 `if (!box) return;`（`:132`）——首挂载时 `box` 仍为 null（`setBox` 在 layout effect ① 里发起，`:109`），effect ② 直接早退；React 把这次 layout 期 setState 同步 flush 到下一次 commit（`style={top,left,width,minHeight}` 落到 DOM，`:167-169`）后，effect ② 才因 `box` 引用变化重跑并测量。结构上无法出现「盒子未落地就量」。
- **新用例不再依赖手工回调**：`:254-271` 用 `fireEvent.change`（`:264`）触发，`beforeEach` 里全局 RO 已被替身接管（`:109`），而替身 `trigger()` 从不自动回调——所以 `:266-267` 同时断言 `textarea.style.height === "240px"` 与 `target.style.height === "240px"` **只能**由 `onChange → syncHeight` 产生。`:269-271` 另断言无任何实例被 disconnect，作为「本用例内没有别的 RO 生命周期事件」的辅证。RO 路径由 `:274-292` 单独锁定。
- **我验算的期望值**：全局 mock `rect.height = 80`（`:110-112`），全局 `scrollHeight = 96`（`:115-118`）⇒ `lockedHeightRef = 80`（`:105`）、`box.minHeight = max(1,80) = 80`（`editorGeometry.ts:11`）；挂载时 `max(96, 80) = 96` ⇒ textarea 与 target 均 `96px`（`:147-148`）；用例内把 textarea 的 `scrollHeight` 改为 240 ⇒ `max(240, 80) = 240` ⇒ 双方 `240px`（`:266-267`）。三个数字与断言全部对上，且 `minHeight(80)` 与 `height(96)` 不同值 ⇒ 锁高与自增高不可互相冒充（Minor-8 一并解决）。
- 未解决面：jsdom 看不见真实布局（「textarea 自身盒高不变」这一前提仍只能在真机上闭合），报告 §4.1 已明确要求 T8 加真机手检项。这属于已登记的未闭合验证，不构成驳回。

### 2. Important-2 / F21② — ADDRESSED — 证据 `src/components/BlockEditor.tsx:94-100`、`src/components/BlockEditor.test.tsx:7-8,127-136,156,171`

- `const host = target.closest<HTMLElement>(".document-scroll__content")`（`:94`）为 null 时 `dropOverlay(); return;`（`:98-99`）——早退发生在 `previous` 快照（`:102`）与任何 `visibility/overflow/height` 写入（`:106-108`）**之前**，因此原块一个内联属性都不会被写。
- 该分支现在有专属用例并带断言：`:127-136` 用**没有**宿主的简报夹具（`:7-8` 已注明），断言 `target.getAttribute("style") === null`（`:132`）、`input.style.cssText === ""`（`:134`）、`input.style.top === ""`（`:135`）。
- 上一轮指出的「两条用例正跑在该分支却不作断言」已修：Esc 用例（`:156`）与 Ctrl+S/失焦用例（`:171`）都改用 `mountHostFixture`，不再落在降级分支里。

### 3. Important-3 / F22 — ADDRESSED — 证据 `src/components/BlockEditor.tsx:57,77,153-157,177,181,184`、`src/components/BlockEditor.test.tsx:168-182`

- 三路（Esc `:177`、Ctrl+S `:181`、失焦 `:184`）全部改走 `requestCommit`，闸门本体 `if (committedRef.current) return; committedRef.current = true;`（`:154-155`）；复位点在新激活周期起点（`:77`，effect ① 首行）。
- 断言已按裁定改写：`:173-174` Ctrl+S → 1 次；`:177-178` 随后 blur → **仍为 1 次**（旧实现此处为 2 次，即上一轮 Critical 的 Important-3）；`:180-181` 再 Esc → 仍 1 次。
- 补注（不改判定）：闸门只在 `unitIndex` 变化/重挂载时复位，未见「新激活周期后仍可提交」的用例——见「新破坏」§4，当前接线安全但缺一条回归锁。

### 4. Important-4 / F21① — ADDRESSED — 证据 `src/components/BlockEditor.tsx:113-120,122-126`、`src/components/BlockEditor.test.tsx:294-317`

- 宿主容器 RO 已实现：`geometryObserver` 用 `targetRef.current.getBoundingClientRect()` 与 `host.getBoundingClientRect()` 重算 `computeOverlayBox` 并 `setBox`（`:116-118`），观察对象是 **host**（`:120`），cleanup `disconnect()`（`:123`）。
- 测试用替身驱动并断言盒更新：`:306-307` 断言 host 恰有 1 个观察者，改写 rect 模拟「上方内容撑高 60px」后 `act(() => hostObservers[0].trigger())`（`:315`），断言 `top` 由 `200px` 变 `260px`（`:304`/`:316`）。期望值验算：`targetRect.top − hostRect.top = 300−100 = 200`，改后 `360−100 = 260` ✓。
- 覆盖边界（宿主尺寸不变但目标块位移不重算）报告 §4.3 已登记为已知取舍。

### 5. Important-5 / F20 — ADDRESSED（含一处**已登记**的裁定细化）— 证据 `src/components/BlockEditor.tsx:28-41`、`src/components/BlockEditor.test.tsx:229-252`

- 首选判据确为类名：`if (marked.classList.contains("vellum-unit-wrap")) return firstLayoutChildOrSelf(marked);`（`:31`），高 0 只作兜底（`:36-39`）。
- 兜底被收窄为「高 0 **且** 子节点自身有布局盒」（`:38`）。这正是裁定意图（"避免把零高真实块误判成包裹层"）所必需：若照字面实现（凡高 0 就下钻），`:229` 用例里零高 `<p>` 会命中兜底并下钻到 `<img>`，`paragraph.style.visibility === "hidden"` 必然为红——即字面版与裁定自身要求的用例互斥。偏差已在报告 §3.1 登记并给出理由，方向更贴近裁定意图，故判 ADDRESSED 而非未登记偏差。
- 零高真实块用例已加：夹具 `<p data-vellum-unit="0"><img alt=""></p>`（`:230`），段落 rect 全 0、`img` rect 也全 0（`:238-240`），断言段落自身被隐藏、`img` 无任何内联样式（`:246-248`）。期望值：`resolveTarget` 走 `:36` → 子节点高 0 不满足 `> 0` → 落回 `:40` 返回段落本身 ✓。

### 6. Important-6 / F21③ — ADDRESSED — 证据 `src/components/BlockEditor.tsx:81-90`、`src/components/BlockEditor.test.tsx:319-330`

- 解析失败分支（`!target || !textarea`，`:86`）走 `dropOverlay()`（`:88`），其函数体为 `textarea.style.height = ""` + `setBox(null)`（`:81-84`）——不再是旧实现的裸 `return`。
- 用例 `:319-330`：从 unit 0 切到不存在的 unit 99（`:322`、`:326`），断言 `textarea.style.cssText === ""`（`:328`）且上一块样式已还原 `first.style.visibility === ""`（`:329`）。旧实现此处 `style.cssText` 为 `"top: 0px; left: 0px; width: 600px; mi…"`，该断言有判别力（与报告 §2 红证据一致）。

### 7. Minor 7 / 8 / 10 / 11 — 四条 ADDRESSED

| 项 | 判定 | 证据 |
|---|---|---|
| 7a 原带内联 `height` 卸载后还原原值 | ADDRESSED | 新用例 `test.tsx:347-357`：夹具带 `style="height: 140px"`，编辑期断言 `96px`、卸载后断言 `140px`（机制仍是 `:102` 快照 / `:125` 还原，赋回原字符串） |
| 7b `unitIndex` 切换时上一轮已还原 | ADDRESSED | 新用例 `test.tsx:332-345`：0 → 1，断言 `first.visibility/height` 回空、`second` 被隐藏且拿到 `96px`（先 cleanup 后新快照，未把「已隐藏」当原状） |
| 8 锁高与自增高可区分 | ADDRESSED | `test.tsx:115-118` 把 `scrollHeight` 改为 96（≠ rect 80）：`minHeight === "80px"`（`:146`）与 `height === "96px"`（`:147-148`）成为两个不同值，旧实现下 target 只会有 `96px`、textarea 恒为 `""` |
| 10 替身 `disconnectCalled` | ADDRESSED | 替身改为按实例记录 `observed`/`disconnectCalled`（`test.tsx:78-92`），`disconnect()` 不再清共享表（`:89-92`）；`unmount()` 后断言 `instances.every(o => o.disconnectCalled)`（`:291`） |
| 11 `data-block-editor-for` | ADDRESSED（处置为「保留 + 登记」） | `BlockEditor.tsx:163-164` 就地声明为调试属性、生产逻辑不消费；报告 §2 已登记。仍是相对 T3 brief / T6 brief 的 DOM 契约多余属性，但已有消费者无关的明确声明，视为已登记 |

（附带：Minor-9「测量时机」虽未在本次待判定清单内，也已按裁定落到 effect ②，见第 1 条。）

---

## 新破坏（仅限本修复 diff）

1. **反馈环 — 未发现**（已验算）。
   收敛依据：写入值 `Math.max(textarea.scrollHeight, lockedHeightRef.current)`（`BlockEditor.tsx:68`）**不依赖 box**，所以「写高 → RO 回回调 → 再写高」每轮写的是同一个值，布局不变 ⇒ RO 不再投递。逐条核对：
   - textarea RO（`:134`）回调再次写同值 ⇒ 无尺寸变化 ⇒ 不重复投递；
   - 宿主 RO（`:113-120`）只在宿主尺寸真变化时触发，且 `setBox` 只引起一次 re-render；effect ② 因 `box` 引用变化重建 observer（`:137`）+ 再写同值 ⇒ 收敛；
   - 唯一可能无限增长的是「content-box 下 `height = scrollHeight` 每轮按 padding 递增」的经典陷阱，已排除：`src/styles/kami.css:48-50` 的 `* { box-sizing: border-box }` 全局生效。
   代价是打字期的有限 churn（每次高度变化多一轮 setBox + observer 重建），报告 §4.4 已登记，非性能红线。
2. **早退分支是否让用户「完全进不了编辑」— 不会，但缺任何提示**。
   `!host` / `!target` 只跳过隐藏与定位（`BlockEditor.tsx:86-100`），textarea 仍在渲染（`:159-169`，`style={undefined}`），用户仍可打字，只是覆盖层不再定位、原块也不再隐藏。裁定 F21② 的字面要求（「早退且不隐藏原块」）已满足；我实测的生产路径里 `.document-scroll__content` 恒存在且是标记块祖先（`src/App.tsx:745`，`.markdown-body` 在其内），故这是纯降级路径。**建议**（不阻断）：降级分支加一句 `console.warn`（或把「不可编辑」经 `onCancel` 上报给 T6），否则真机上一旦出现用户只会看到「块没反应/输入框跑到文档末尾」，无从判断。
3. **多个 RO 的 cleanup — 齐全**。
   两个 observer 各在自己的 cleanup 中断开：`geometryObserver.disconnect()`（`BlockEditor.tsx:123`）与 `observer.disconnect()`（`:137`）；早退分支不创建 observer（`:86-90`、`:95-100` 在任何 `new ResizeObserver` 之前），不存在漏网。卸载后无回调残留还有一层兜底：cleanup 把 `targetRef.current = null`（`:124`），`syncHeight` 首行即 `if (!textarea || !target) return`（`:67`）。测试侧 `test.tsx:290-291` 断言所有实例 `disconnectCalled`。
4. **提交闸门的复位前提（跨任务风险，非本 diff 缺陷）**。
   `committedRef` 只在 effect ①（deps `[unitIndex]`）复位（`:77`）。若 T6 在同一 `unitIndex` 上保持挂载，一次提交后闸门永不复位 ⇒ 用户再也提交不了。**但当前接线安全**：`useDocumentEditor.ts:118` 在 `await save(next)` **之前**就 `closeActive()`（`:55-59` 置 `activeUnitIndex = null`）⇒ BlockEditor 立刻卸载、`committedRef` 随实例销毁；F24 的失败重试路径（`:130-134` `setActiveUnitIndex(unitIndex)`）是「卸载后重新挂载」⇒ 新 ref（false）。且 T6 brief 的渲染片段（`task-6-brief.md:155-157`）没有 `key`，与报告 §4.2 的担心相反，现网不会踩到；但这层保证是**隐式的**（依赖 T4 先 close 再 await）。**建议**：T6 显式加 `key`（或激活序号），并补一条「换块后仍能提交」的回归用例（当前无用例锁定 `:77` 的复位）。

## 范围外观察（未改动代码 / 未列入清单，仅登记）

- `minor-12`（`textarea.focus()` 在 `useEffect` 而非 layout effect，`:143-149`）未变，与计划一致，激活有一帧无焦点。不在本轮范围。
- `onCancel` 仍是死参数（`:12-13` 注释声明）；T6 brief 把它接成 `commitActive()`，语义与 Esc 完全相同，v1 无「放弃改动」路径。属既有登记项，本轮未变。
- `firstLayoutChildOrSelf` 在 `.vellum-unit-wrap` 无元素子节点时返回包裹层自身（`:21-23`）——`display: contents` 上锁高无效，这是 F18 既有边界。实际管线（`rehypeEditUnits.ts:62` 的 `<pre>` 外包）恒有子节点。
- 宿主 RO 只观察宿主（`:120`），「宿主尺寸不变但目标块位移」不重算（报告 §4.3 已登记）。
- `lockedHeightRef` 在早退分支不复位（`:105` 只在成功分支写）——因 `box` 为 null 时 `syncHeight` 不再被调用，无实际影响。
- T7/T8 欠账：`.block-editor__input` 的绝对定位、`document-scroll__content--editing`、F23 选择器特异度、真机手检（长草稿推流 / 测量时机）全部未落地，与本轮无关但仍是进入 T6/T7 前的前置。

## 结论

**All findings addressed:** Yes

**Reasoning:** 上轮 11 条待判定项（Critical-1、Important-2/3/4/5/6、Minor-7/8/10/11）逐条都能在 `BlockEditor.tsx` 找到对应实现、且在 `BlockEditor.test.tsx` 找到带判别力的新断言；聚焦测试我亲跑为 `2 files / 15 tests passed`、`tsc --noEmit` 退出码 0，报告的红证据经我用旧实现逐条推演后与突变表完全吻合。唯一对裁定的实质细化（F20 兜底收窄为「高 0 且子节点有布局盒」）是让裁定自身要求的用例可成立所必需，且已在报告 §3.1 登记。本 diff 未引入反馈环、RO 泄漏或用户被锁死编辑的路径；两处残余（降级分支无提示、提交闸门复位依赖 T4 先 close 再 await 的隐式前提）已给出可执行的跨任务建议，不构成阻断。
