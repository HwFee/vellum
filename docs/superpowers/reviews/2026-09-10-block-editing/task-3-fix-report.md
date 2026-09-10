# Task 3 修复轮 1 报告 — `BlockEditor` 自增高与降级分支

- **状态**：完成（已提交，单次提交）
- **提交**：`0ab2e1c` — `fix(edit): 自增高显式写高与降级分支修正（审查轮 1）`（2 文件，+283 / −57）
- **测试结论（完工前实跑）**：`npx vitest run src/components/BlockEditor.test.tsx src/lib/editorGeometry.test.ts` → **2 文件 / 15 用例全绿**；`npm test` → **31 文件 / 369 用例全绿**（基线 362 + 本轮 7 条新用例）；`npx tsc --noEmit` → **退出码 0**；Rust 未改动，未跑 `cargo test`。

## 1. 文件清单

| 路径 | 类型 | 说明 |
|---|---|---|
| `src/components/BlockEditor.tsx` | 修改 | 显式自增高写高（`syncHeight`）、测量搬到 box 应用之后的第二个 layout effect、`host` 缺失早退不隐藏、`resolveTarget` 类名首选 + 零高兜底收窄、宿主 RO 重算盒、`committedRef` 一次性提交闸门、降级分支清覆盖层内联样式、`data-block-editor-for` 注释声明为调试属性 |
| `src/components/BlockEditor.test.tsx` | 修改 | 6 → 13 条用例（新增 I2/I3/I4/I5/I6 + Minor-7a/7b/8/10 覆盖；`CaptureResizeObserver` 替身改为按实例记录 `observed`/`disconnectCalled`） |

未触碰：`src/lib/editorGeometry.ts`（F4 两参版已正确，本轮无需改动）、`editUnits.ts`、`rehypeEditUnits.ts`、`MarkdownDocument.tsx`、`useDocumentEditor.ts`、`App.tsx`、Rust 侧、`kami.css`。无新增依赖。

## 2. 红 → 绿证据（逐条）

**红证据的取法**：把 `src/components/BlockEditor.tsx` 临时回退到 `784fdf9` 的版本（新测试文件不动）实跑，随后逐字节还原（`diff` 校验 `RESTORED_OK`、`git status` 确认工作树对我方文件无改动）。这是「用最终测试打旧实现」的干净红证据，不掺夹具返工。

```
$ git show 784fdf9:src/components/BlockEditor.tsx > src/components/BlockEditor.tsx
$ npx vitest run src/components/BlockEditor.test.tsx src/lib/editorGeometry.test.ts
 Test Files  1 failed | 1 passed (2)
      Tests  9 failed | 6 passed (15)

AssertionError: expected 'visibility: hidden; overflow: hidden;…' to be null        ← I2
AssertionError: expected '' to be '96px'                                            ← Critical-1（锁高/自增高）
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times            ← I3
AssertionError: expected '96px' to be '120px'                                       ← 自增高下限（本轮细化）
AssertionError: expected '' to be 'hidden'                                          ← I5
AssertionError: expected '' to be '240px'                                           ← Critical-1（onChange 写高）
AssertionError: expected '' to be '240px'                                           ← Critical-1（RO 写高）
AssertionError: expected [] to have a length of 1 but got +0                        ← I4
AssertionError: expected 'top: 0px; left: 0px; width: 600px; mi…' to be ''          ← I6
```

绿（恢复实现后，聚焦 + 全量 + 类型）：

```
$ npx vitest run src/components/BlockEditor.test.tsx src/lib/editorGeometry.test.ts
 Test Files  2 passed (2)
      Tests  15 passed (15)          Duration 1.31s

$ npm test
 Test Files  31 passed (31)
      Tests  369 passed (369)        Duration 8.25s

$ npx tsc --noEmit
TSC_EXIT=0
```

「测试通过」本身不证明断言有判别力，故另跑 7 条**实现突变 → 必红**探针（`outputs/__audit_scratch/mutations.sh`，跑完即删；还原经 `diff -q` 校验 `RESTORED_OK`）：

| 突变（实现层） | 结果 | 对应缺陷 |
|---|---|---|
| M1 `onChange` 里去掉 `syncHeight()` | `1 failed \| 12 passed` | Critical-1 / F19 |
| M2 `syncHeight` 不写 `textarea.style.height` | `3 failed \| 10 passed` | Critical-1 / F19 |
| M3 去掉 `if (!host)` 早退 | `1 failed \| 12 passed` | I2 / F21② |
| M4 去掉 `committedRef` 闸门判断 | `1 failed \| 12 passed` | I3 / F22 |
| M5 去掉 `geometryObserver.observe(host)` | `1 failed \| 12 passed` | I4 / F21① |
| M6 去掉「子节点须有布局盒」限定 | `1 failed \| 12 passed` | I5 / F20 |
| M7 `resolveTarget` 失败分支不 `dropOverlay()` | `1 failed \| 12 passed` | I6 / F21③ |

### Critical-1 → 裁定 F19（自增高触发源）

- **修法**：新增 `syncHeight()`（`BlockEditor.tsx:63-73`）——`const height = Math.max(textarea.scrollHeight, lockedHeightRef.current)`，然后 **`textarea.style.height = height` 与 `target.style.height = height` 双向同值写回**。`onChange`（`:186-189`）与 RO 回调（`:136-139`）共用它。测量搬进**第二个 `useLayoutEffect`**（deps `[box, syncHeight]`，`:131-139`）：box（绝对定位 + 宽度）先由 ① 写入 DOM、React 重渲染落定后，② 才读 `scrollHeight`，避免「textarea 还在普通流里就量」。RO 保留（`observer.observe(textarea)`），但已不再承担唯一触发责任。
- **测试**：`草稿变长时 onChange 直接写高（不依赖 textarea 自身盒高变化），无需手工触发 RO` —— `fireEvent.change` 后断言 `textarea.style.height === "240px"` 且 `target.style.height === "240px"`，并断言全程没有手工触发过任何 RO 回调；`RO 回调同样把 scrollHeight 写回原块` 单独锁定 RO 路径。
- **红**：`expected '' to be '240px'`（两处）+ `expected '' to be '96px'`。**绿**：15/15；突变 M1/M2 必红。

### Important-2 → 裁定 F21②（`host` 缺失不得隐藏原块）

- **修法**：`target.closest(".document-scroll__content")` 为空时 `dropOverlay()`（清覆盖层内联高度 + `setBox(null)`）后**直接 return**，不写 `visibility/overflow/height`、不快照 `previous`、不建 observer（`BlockEditor.tsx:95-102`）。
- **测试**：`宿主容器缺失时早退：不隐藏原块、不写内联样式、覆盖层不定位` 用**没有** `.document-scroll__content` 的简报夹具，断言原块 `getAttribute("style") === null` 且 `textarea.style.cssText === ""`。原先正跑在该分支却不作断言的两条用例（Esc 提交、Ctrl+S/失焦）已改用含宿主的夹具。
- **红**：`expected 'visibility: hidden; overflow: hidden; height: 96px;' to be null`。**绿**：15/15；突变 M3 必红。

### Important-3 → 裁定 F22（提交一次性闸门）

- **修法**：`committedRef`（`:57`）在激活周期起点复位（layout effect ① 首行，`:79`），Esc / Ctrl+S / 失焦统一走 `requestCommit()`（`:158-165`），首次信号后直接 return。
- **测试**：`Esc / Ctrl+S / 失焦共用一次性提交闸门` —— Ctrl+S → 1 次；随后 `blur` → **仍为 1 次**；再 Esc → 仍为 1 次（把上一版「blur 变 2 次」的断言按裁定改写为「仍为 1 次」）。
- **红**：`expected "vi.fn()" to be called 1 times, but got 2 times`。**绿**：15/15；突变 M4 必红。

### Important-4 → 裁定 F21①（宿主容器 RO 重算盒）

- **修法**：① 内额外 `const geometryObserver = new ResizeObserver(...)`，用 `targetRef.current.getBoundingClientRect()` 与 `host.getBoundingClientRect()` 重算 `computeOverlayBox` 并 `setBox`；观察对象是 **host**，cleanup `disconnect()`（`:105-116`、`:118-123`）。
- **测试**：`宿主容器尺寸变化时重算覆盖层盒，编辑器不再漂在旧位置` —— 断言 host 恰有 1 个观察者，改写 rect 替身模拟「上方图片撑高 60px」后驱动该回调，断言 `textarea.style.top` 由 `200px` 变 `260px`。
- **红**：`expected [] to have a length of 1 but got +0`。**绿**：15/15；突变 M5 必红。

### Important-5 → 裁定 F20（包裹层判定以类名首选）

- **修法**：`resolveTarget`（`:29-46`）先判 `marked.classList.contains("vellum-unit-wrap")` → 下钻 `firstElementChild`；**兜底**才看 `rect.height === 0`，且**要求子节点自己有布局盒**（`child.getBoundingClientRect().height > 0`）才下钻，否则返回标记元素本身。
- **测试**：`零高真实块（仅含未加载图片的段落）不被误判为包裹层` —— 段落 rect 高 0、其 `<img>` rect 也全 0（未加载），断言段落自身被隐藏并锁高、`img` 无任何内联样式。
- **红**：`expected '' to be 'hidden'`（旧实现下钻到行内 `<img>`）。**绿**：15/15；突变 M6 必红。
- **偏差说明（重要）**：裁定 F20 的字面实现（「未命中类名才用 `rect.height === 0` 兜底」）**无法通过其自身要求的这条用例**——一个零高的 `<p>` 仍会命中高 0 兜底并下钻到 `<img>`。故把兜底收窄为「高 0 **且** 子节点有布局盒」，正是让「零高真实块」与「无盒包裹层」可区分的判据。见 §4 偏差 1。

### Important-6 → 裁定 F21③（解析失败清空盒）

- **修法**：`!target || !textarea` 分支执行 `dropOverlay()` → `setBox(null)` 且清掉自增高写过的高度（`:86-90`）。
- **测试**：`目标解析失败（热重载后标记丢失）时清空覆盖层盒，不沿用上一块` —— 从 unit 0 切到不存在的 unit 99，断言 `textarea.style.cssText === ""` 且 unit 0 的样式已还原。
- **红**：`expected 'top: 0px; left: 0px; width: 600px; mi…' to be ''`（旧实现沿用上一块盒）。**绿**：15/15；突变 M7 必红。

### Minor（顺手项）

| 项 | 修法 / 证据 |
|---|---|
| 7a 原带内联 `height` 的块卸载后还原成原值 | 新用例 `目标原本带内联 height 时，卸载后还原成原值而非清空`：夹具 `style="height: 140px"`，编辑期断言 `96px`（自增高已覆盖），卸载后断言回到 `140px`。旧实现该路径本就正确（无红），属覆盖补强。 |
| 7b `unitIndex` 切换时上一轮样式已还原 | 新用例 `unitIndex 切换时先还原上一块的内联样式，再隐藏新块`：0 → 1，断言 p0 `visibility/height` 回空、p1 被隐藏且拿到 `96px`。 |
| 8 锁高与自增高断言可区分 | `beforeEach` 的 `scrollHeight` 改为 **96**（rect 高仍 80）：「锁定原高」体现为覆盖层 `minHeight === "80px"`，自增高写回体现为 `target.style.height === "96px"`，两个值不同、互不冒充（旧实现的红 `expected '' to be '96px'` 即此断言的判别力）。 |
| 9 测量时机搬到 box 应用之后 | 由 effect ② 的 `[box, syncHeight]` 依赖 + 顺序注释保证（`:131-139`）；jsdom 无法观测布局阶段顺序，故无直接单测（见 §5 未解决项 1）。 |
| 10 RO 替身记录 `disconnectCalled` | `CaptureResizeObserver` 改为按实例记录 `observed`/`disconnectCalled`，不再清空共享表；用例卸载后断言 `instances.every(o => o.disconnectCalled)`（且 `instances.length > 0`）。 |
| 11 `data-block-editor-for` | **保留**并在 JSX 处加注释声明它是调试属性（真机 DevTools/手检定位用），生产逻辑不消费（`:169-170`）。 |

## 3. 与 spec / 计划 / 裁定的偏差

1. **F20 兜底收窄**（见上 §2 Important-5）：字面版与新用例互斥，收窄为「高 0 且子节点有布局盒」。这是唯一对裁定语义的实质细化；空包裹层（类名在）路径完全按 F20 执行。
2. **自增高写回取 `max(scrollHeight, 锁定原高)`**（F19 的延伸）：F19 要求「把同一值写回目标元素高度」，仍满足「同一值写回双方」；加下限是因为草稿变短时若只写 `scrollHeight`，原块会塌陷、下方内容上移到覆盖层 `min-height` 之下，形成重叠空档。锁高值存于 `lockedHeightRef`，F18 用例即为该下限的断言（`expected '96px' to be '120px'` 是旧实现的红）。
3. **降级分支额外清空 `textarea.style.height`**：`host` 缺失 / 解析失败时不把上一块自增高留下的高度带进普通流；这也是两条降级用例敢断言 `style.cssText === ""` 的前提。
4. **旧用例迁移**：简报夹具（无 `.document-scroll__content`）现在专用于 Important-2 的降级用例；正常路径用例改用含宿主的夹具。Esc/Ctrl+S 两条用例的断言按 F22 从「2 次」改为「1 次」。
5. 未改 `editorGeometry.ts`：F4 两参版与用例在 784fdf9 已正确，本轮无缺陷指向它（YAGNI）。

## 4. 未解决项 / 关注点

1. **真机手检（T8 必加）**：jsdom 永远看不见「长草稿推流」与「测量时机」这两条布局路径。需在 T8 手检：普通段落持续输入到超过原块高度 ⇒ 输入框长高、下方内容被推下去、无裁切；再验证草稿删短 ⇒ 高度不低于原高、无重叠。
2. **提交闸门的复位时机（转 T6 关注）**：`committedRef` 只在 `unitIndex` 变化（含重挂载）时复位。T4 的保存失败路径会「关闭后再激活同一块」——若 T6 让 `BlockEditor` 保持挂载（同一 `unitIndex`）而不重挂载，闸门不会复位，用户将无法再次提交。建议 T6 以 `key={activeUnit.index}`（或激活序号）强制重挂载；本轮未在组件内加「保存失败」感知（组件不持有该状态）。
3. **宿主 RO 的覆盖边界**：按 F21① 只观察宿主容器，因此「宿主尺寸不变但目标块位移」的场景不会重算（例如容器因其他原因尺寸恒定而目标被 `transform` 移动）。真机若出现漂移，再补一个观察目标块的 RO。
4. **打字期的轻微 churn**：自增高改变原块高度 ⇒ 宿主尺寸变化 ⇒ 宿主 RO ⇒ `setBox`（新对象）⇒ effect ② 重建 textarea observer。已收敛（写同值不再触发），未加 box 等值 bail-out（YAGNI，单覆盖层非性能红线）。
5. **`onCancel` 仍是死参数**：v1 里 Esc 与提交同义（简报用例要求 Esc → `onCommit` 恰一次），沿用上一版登记，接口留给 T6。
6. **T7 依赖未落地**：`.block-editor__input` 的绝对定位 / `.document-scroll__content--editing`、`.markdown-body--editing`（F2）、`.vellum-unit-wrap { display: contents }`、F23 的选择器特异度，全部归 T7；本轮只使用约定类名，未改任何样式文件。

## 5. 验证命令与真实输出（摘要）

| 命令 | 输出 |
|---|---|
| `npx vitest run src/components/BlockEditor.test.tsx src/lib/editorGeometry.test.ts` | `Test Files 2 passed (2)` / `Tests 15 passed (15)` |
| `npm test` | `Test Files 31 passed (31)` / `Tests 369 passed (369)`（基线 362 + 7 条新用例） |
| `npx tsc --noEmit` | `TSC_EXIT=0`（无输出） |
| 旧实现 + 新测试（红证据） | `Test Files 1 failed \| 1 passed (2)` / `Tests 9 failed \| 6 passed (15)`，失败项见 §2 起始 |
| 突变探针 7 条 | 每条 `1 failed \| 12 passed`（M2 为 `3 failed \| 10 passed`）；`RESTORED_OK` |
| `cd src-tauri && cargo test` | 未跑（本轮未改 Rust） |
| 探针目录 | `outputs/__audit_scratch/` 已删除（`ls outputs/` 只剩既有无关文件） |
