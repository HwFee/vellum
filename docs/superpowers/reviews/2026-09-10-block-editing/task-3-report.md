# Task 3 实施报告：就地编辑面 `BlockEditor` + 覆盖层几何

- 状态：完成（已提交）
- 提交：`784fdf9` — `feat(edit): 就地编辑面 BlockEditor（隐藏原块锁高、自增高推流、Esc/失焦提交）`（单次提交，4 文件 353 插入）
- 测试结论：`npm test` → **30 文件 / 353 用例全绿**（基线 28/345 + 本任务 2 文件 / 8 用例）；`npx tsc --noEmit` 退出码 0

## 1. 改动文件清单

| 路径 | 类型 | 说明 |
|---|---|---|
| `src/lib/editorGeometry.ts` | 新增 | `DOMRectLike`/`OverlayBox`/`computeOverlayBox(targetRect, hostRect)`（两参，裁定 F4） |
| `src/lib/editorGeometry.test.ts` | 新增 | 2 用例：宿主容器相对坐标换算、高度 0 → `minHeight` 下限 1 |
| `src/components/BlockEditor.tsx` | 新增 | 受控 `textarea` 覆盖层：隐藏原块 + 锁高、自增高写回、Esc / Ctrl+S / 失焦提交、卸载逐项还原内联样式 |
| `src/components/BlockEditor.test.tsx` | 新增 | 6 用例：简报 3 条逐字 + 新增 3 条（F4 宿主基准接线、F18 包裹层目标解析、自增高写回） |

未触碰：`MarkdownDocument.tsx`、`rehypeEditUnits.ts`、`editUnits.ts`、`App.tsx`、Rust 侧、`kami.css`（样式归 Task 7；本次只使用约定类名 `.block-editor__input`）。**无新增依赖、无新增 CSS 文件。**

## 2. TDD 红 → 绿证据

### 2.1 纯函数（简报 Step 1–3）

```
$ npx vitest run src/lib/editorGeometry.test.ts        # 写测试、未实现
FAIL  src/lib/editorGeometry.test.ts [ src/lib/editorGeometry.test.ts ]
Error: Failed to resolve import "./editorGeometry" from "src/lib/editorGeometry.test.ts". Does the file exist?
      Tests  no tests

$ npx vitest run src/lib/editorGeometry.test.ts        # 实现后
      Test Files  1 passed (1)
           Tests  2 passed (2)
```

### 2.2 组件（简报 Step 5–4）

```
$ npx vitest run src/components/BlockEditor.test.tsx   # 写测试、未实现
FAIL  src/components/BlockEditor.test.tsx [ src/components/BlockEditor.test.tsx ]
Error: Failed to resolve import "./BlockEditor" from "src/components/BlockEditor.test.tsx". Does the file exist?
      Tests  no tests

$ npx vitest run src/components/BlockEditor.test.tsx   # 实现后
      Test Files  1 passed (1)
           Tests  6 passed (6)
```

### 2.3 逐条行为的「实现突变 → 必红」验证

测试通过本身不能证明测试有判别力，故用探针脚本（`outputs/__audit_scratch/mutations.sh`，**已删除**）逐条突变实现、确认对应用例转红，随后逐字节还原（`diff` 对比备份：`RESTORED_OK`）：

| 突变（实现层） | 结果 |
|---|---|
| 删除 `target.style.visibility = "hidden"` | `Tests 2 failed | 4 passed` |
| 删除卸载还原循环（`target.style[name] = previousValue`） | `Tests 3 failed | 3 passed` |
| Escape 分支改为不提交 | `Tests 1 failed | 5 passed` |
| 删除 Ctrl+S 分支 | `Tests 1 failed | 5 passed` |
| 宿主容器 `.document-scroll__content` → `.document-scroll`（F4 接线） | `Tests 2 failed | 4 passed` |
| `resolveTarget` 去掉 height===0 回退（F18） | `Tests 1 failed | 5 passed` |
| ResizeObserver 回调改为空（自增高） | `Tests 1 failed | 5 passed` |
| `computeOverlayBox` 的 `top` 由减改加（F4 纯函数） | `Tests 1 failed | 1 passed` |

## 3. 全量验证（完工前实跑）

```
$ npm test
 Test Files  30 passed (30)
      Tests  353 passed (353)
   Duration  7.15s

$ npx tsc --noEmit
TSC_EXIT=0        # 无输出
```

Rust 未改动，故未跑 `cargo test`。探针目录 `outputs/__audit_scratch/` 已在使用后删除（`git status` 无残留）。

## 4. 与计划 / 裁定的偏差

1. **F4（覆盖层基准）已落实，计划文本的旧代码作废**：`computeOverlayBox` 为两参版（`targetRect, hostRect`，同容器矩形相减，不加 `scrollTop`）；`BlockEditor` 用 `target.closest(".document-scroll__content")` 取宿主，未用 `offsetParent`（jsdom 下恒 null）。计划文档第 3 任务段尚未同步该签名，以 `rulings.md` F4 为准。
2. **F5a**：测试 `beforeEach` 用 `Object.defineProperty(HTMLElement.prototype, "scrollHeight", { get: () => 80 })`；并在 `afterEach` 删除该自有属性、恢复 `ResizeObserver` 全局 mock，避免污染同文件后续用例。
3. **F5b**：未实现 `settlingRef` 与挂载期失焦守卫。焦点定位仍在独立的 `useEffect(deps: [unitIndex, initialCaret])` 内（未并入 `useLayoutEffect`）——因为锁高/还原效果的 deps 必须只有 `unitIndex`：若 `initialCaret` 变化触发重跑，`previous` 会把「已隐藏」状态当原状记下，卸载就还原不回原样。裁定 F5b 的意图（不吞真实失焦、不产生多余 blur）已满足：`focus()` 每次激活只调用一次，不产生额外 blur。
4. **F18**：新增 `resolveTarget(unitIndex)` —— `querySelector` 命中标记后，若 `getBoundingClientRect().height === 0`（`display: contents` 无布局盒）则改用 `firstElementChild`，否则用自身；隐藏 / 锁高 / 自增高 / 还原全部作用于该元素，覆盖层测量盒同源。附带用 `instanceof HTMLElement` 兜住非元素子节点。未对包裹层写入任何内联属性（用例断言 `wrapper.getAttribute("style") === null`）。
5. **测试较简报多 3 条**（简报 3 条逐字保留，另加一个带 `.document-scroll__content` 的夹具辅助函数，不改动简报夹具正文）：F4 宿主基准接线（断言 `top/left/width/minHeight`）、F18 包裹层目标解析、自增高写回 + 卸载停止。加测理由：任务约束 §5 明确要求「自增高写回原块高度」与「隐藏原块锁高、卸载还原」的红→绿证据，而简报的 3 条用例不覆盖 ResizeObserver 路径；F18 是本次新裁定、必须锁死。
6. **`onCancel` 本任务无消费点**：Esc 与 Ctrl+S 均发 `onCommit`（简报用例要求 `Esc → onCommit` 恰一次），`onCancel` 仅保留在 `BlockEditorProps` 契约中供 Task 4/6 接线。已用注释标注，未擅自删除 prop（接口由简报指定）。
7. **锁高原高的中间态不可单独观测**：`target.style.height = targetRect.height` 与紧随其后的 `textarea.scrollHeight` 写在同一同步块内，jsdom 下最终值即 `scrollHeight`；用例断言的 `"80px"` 是净效果（mock 下两者同为 80）。这是计划代码的固有性质，未额外造测试（YAGNI）。

## 5. 未解决项 / 关注点

1. **`querySelector` 是文档级查找**（沿用计划代码）：多文档实例（如 mdlog 双视图）同时挂载时，`[data-vellum-unit="n"]` 会命中文档中第一处。T6 只激活单个编辑面，预期无影响；若将来出现并存场景，需把根元素经 ref/context 传入。
2. **真实失焦竞态待真机观察**（F5 登记项）：删掉挂载期守卫后，若 WebView2 在激活瞬间产生一次假 blur，会立刻提交空改动。jsdom 与突变验证都未复现；真机出现时再补精确守卫。
3. **`ResizeObserver` 只观察 textarea，不观察原块**：目前原块高度由 textarea 单向驱动（符合「推流」语义）；窗口缩放导致的宽度变化重排由 T7 的 CSS（`min-height` + 自动高度）兜底。若真机上换行导致 textarea 高度变化而未触发 resize 回调，需要在 T8 复核补 `width` 变化监听。
4. **Task 7 依赖**：`.block-editor__input`（绝对定位 + `min-height`）、`.markdown-body--editing`（`position: relative` 已于 F2 挂在 `<article>`）、`.vellum-unit-wrap { display: contents }`、`.document-scroll__content` 的定位上下文均尚未在 `kami.css` 落地，本次仅约定类名。
