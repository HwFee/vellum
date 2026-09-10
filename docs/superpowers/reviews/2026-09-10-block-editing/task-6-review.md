# Task 6 审查报告 — `App` 接线（门禁、提交落盘、回声抑制、外部变更分流）

- 审查对象：`8e83ca5..3f0b74a`（`src/App.tsx`、`src/App.test.tsx`、`src/components/TopBar.tsx`、`src/components/TopBar.test.tsx`）
- 方式：只读；独立跑过聚焦测试与类型检查，其余一律以「代码 + 上游一手源码」为证据
- 结论：**驳回（Needs fixes）** —— 门禁与接线主体正确，但关窗路径存在可复现的死循环（Critical），另有两条用户可见的回声/提示缺陷

---

### Spec Compliance

| # | 要求（来源） | 结论 | 证据 |
|---|---|---|---|
| 1 | `Ctrl+E` 进编辑视图 | ✅ | `src/App.tsx:153-156`（全局 keydown 分支）；测试 `src/App.test.tsx:1625` |
| 2 | `Ctrl+S` 全局 `preventDefault` 并提交当前块（F6） | ✅ | `src/App.tsx:147-151`（先 `preventDefault` 再 `commitActive`，无活动块为 no-op）；测试 `src/App.test.tsx:1677` 断言 `fireEvent.keyDown(...) === false` |
| 3 | 与 `Ctrl+K` / 窄屏 `Escape` 不冲突 | ✅ | `src/App.tsx:140-166`（k 分支行为与依赖不变）；`src/App.tsx:748-760` 的 Escape 只管大纲 |
| 4 | 回声抑制：读数比对（EOL 归一），相等则整体忽略 | ⚠️ | 机制在 `src/App.tsx:444-447`，**EOL 归一两侧一致**（`src/App.tsx:444` 与 `:492` 同为 `replace(/\r\n/g,"\n")`）；但快照生命周期不完整，会把真实外部变更误吞（见 Important-1） |
| 5 | 不等则走既有热重载路径，不递增 `reloadTick`、不闪印章 | ✅ | 早退 `src/App.tsx:446` 位于 `reloadCurrent`（`:450`）之前，`setReloadTick`/`setShowReloadNote` 只在 `src/App.tsx:326-329` 内；测试 `src/App.test.tsx:1698`（负）+ `:1727`（正，同装置下印章确实会出现） |
| 6 | mdlog 记录中不得进编辑视图（顶栏禁用 + hook 门禁 + Rust 闸门） | ✅ | 顶栏 `src/components/TopBar.tsx:86-87`；App `src/App.tsx:831-832`；hook 三道门 `src/hooks/useDocumentEditor.ts:63、93、150`；Rust 闸门属 T5（本 diff 无 `src-tauri/` 改动） |
| 7 | 覆盖层是 `.document-scroll__content` 的**直接子元素** | ✅ | `src/App.tsx:877-883`（宿主）与 `:919-928`（`BlockEditor` 与 `.document-content` 同级并列）；测试 `src/App.test.tsx:1636` 断言 `textarea.parentElement` 带该类 |
| 8 | 编辑视图给宿主加 `document-scroll__content--editing` | ✅ | `src/App.tsx:879-882` |
| 9 | 布局过渡窗不破 | ✅ | `src/App.tsx:287-293` 延迟合并仍在；延迟分支 `void reloadCurrent()` **主动丢弃 `preloaded`**（`src/App.tsx:291`），避免用过期的预读 |
| 10 | 滚动记忆不破 | ✅ | 回声路径在 `reloadCurrent` 之前返回（不改状态/不做锚点补偿）；外部路径仍走 `:309-320` 的锚点+像素兜底 |
| 11 | `MarkdownBody` 引用稳定 | ✅ | 新回调全部 `useCallback([])`：`src/App.tsx:505-515`、`:469-474`、`:488-493`；`MarkdownDocument`/`MarkdownBody` 均为 `memo`（`src/components/MarkdownDocument.tsx:515、335`），打字期间只有 `draft` 变，props 全稳定 |
| 12 | `npm test` 全绿 / `tsc` / `build` | ⚠️ | 我独立跑的两个受影响文件全绿、`tsc` clean（见文末）；**全量 31/384 与 `npm run build` 未独立复核**（受本次只读+不重跑整套的约束；`grep` 确认只有 `src/App.test.tsx` 引用 `App`/`TopBar`，本 diff 的爆炸半径即这两个文件） |
| 13 | 只改 4 个约定文件、不碰 T1–T5 实现与 Rust | ✅ | diff 头 `4 files changed`；`src-tauri/**`、`kami.css`、`useDocumentEditor.ts` 零改动 |
| 14 | 裁定 F15（编辑视图点链接 / 交互 widget） | ⚠️ | 按裁定 v1 保持现状、未改语义（`src/App.tsx` 无相关分支）——符合裁决，但「真机观感差再改」的前提只有 T8 手检，本环境无法验证 |
| 15 | 报告登记的偏差 D1–D12 | ✅ 合理 | 抽查：D1 由既有用例 `silently reloads the document when file-changed event fires` 强制（双读会让该用例红，见报告 M7）；D2/D3 是实现细节且更贴合硬约束；D4 更正了简报里的空断言用例（我核对简报 Step 1 第 3 条确实在 `loadDocument()` 之后才 `mockImplementation` 捕获 handler ⇒ 恒 `undefined`，“字面照抄=空断言”成立）；D12 不发明 UI 正确 |

---

### Strengths

1. **回声抑制的判定口径是对的**：两侧同表达式 LF 归一（`src/App.tsx:444` / `:492`），CRLF 文档不会每次提交都白闪印章；且早退发生在 `reloadCurrent` 之前，连同 `reloadTick`、印章、锚点补偿一起跳过，符合「整体忽略」。
2. **正负对照测试齐全**：`src/App.test.tsx:1698`（回声不闪）与 `:1727`（外部变更照闪 + 中断提示）用同一装置，证明前者不是「印章本来就不出现」的空断言；`fileChangedHandler()` 从 `listen.mock.calls` 取处理器（`:1605-1609`）修正了简报的恒真写法。
3. **引用稳定性处理得当**：`useCallback([]) + editorRef`（`src/App.tsx:501-515`）既保住 `MarkdownDocument` 的 memo 边界，又避免 T4 审查 M11 指出的「消费者把随键入变化的回调放进依赖」。
4. **超出简报但符合 spec §6.3 的两处补强**：`loadPath` 先提交（`src/App.tsx:217`，等价于「切文档」这一提交触发点）、`reloadIfExternal` 把预读结果喂给 `reloadCurrent(preloaded)`（`:449`）避免同一事件双读盘——后者还有既有用例反向锁定。
5. 顶栏按钮复用既有 `.open-button` 样式、图标为线性 SVG、无 emoji、无新色值，未越界改 `kami.css`（留给 T7）。

---

### Issues

#### Critical (Must Fix)

**C1 — 关窗处理器在「落盘失败」时进入无限重试循环，窗口永远关不掉（且每次迭代都同步重解析整篇文档）**

- 位置：`src/App.tsx:382-388`
  ```tsx
  const closeUnlisten = await getCurrentWindow().onCloseRequested(async (event) => {
    const current = editorRef.current;
    if (!current || !current.activeUnit) return;
    event.preventDefault();
    await current.commitActive();      // 失败时 hook 会「重新激活同一块 + 保留草稿」(F24)
    void getCurrentWindow().close();   // ← 这里会再次触发 closeRequested → 本处理器再次入栈
  });
  ```
- 一手证据（不是推测）：
  - `node_modules/@tauri-apps/api/window.d.ts:745`：*"Note this emits a closeRequested event so you can intercept it. To force window close, use `destroy`."*
  - `node_modules/@tauri-apps/api/window.js:1632-1641`：`onCloseRequested` 包一层 `listen('tauri://close-requested')`，只在 `!evt.isPreventDefault()` 时 `this.destroy()`。
  - `tauri-2.11.5/src/manager/window.rs:170-175`：`CloseRequested` 分支中若窗口存在 JS 监听器则 `api.prevent_close()` 并 `emit_to_window(WINDOW_CLOSE_REQUESTED_EVENT)`。
  - `tauri-2.11.5/src/window/mod.rs:1793`：`close()` *"emits WindowEvent::CloseRequested first like a user-initiated close request so you can intercept it"*；`destroy()`（`:1799`）*"does not emit any events"*。
  - `tauri-runtime-wry-2.11.4/src/lib.rs:4368`：`Message::Window(id, WindowMessage::Close) => on_close_requested(...)`（即程序化 `close()` 也走同一处理器）。
- 可复现步骤（真机）：
  1. 打开任意文档 → `Ctrl+E` → 点一个块 → 改几个字；
  2. 让这次落盘必然失败（把文件设为只读 / 加独占锁 / 删掉父目录 / OneDrive 同步锁）；
  3. 点顶栏 ✕（`src/components/TopBar.tsx:129` 的 `window.close()`）或系统关闭按钮 → 第一次 `preventDefault` 后 `commitActive` 失败，F24 把块重新激活（`src/hooks/useDocumentEditor.ts:113-127`），随后 `close()` 重新触发 `CloseRequested`，处理器再次看到 `activeUnit !== null` → 再次 `preventDefault` → 再提交 → 再失败 → …… 无限循环。
- 后果：`save_document` IPC + 两次 `flushSync` 整篇重解析/次、`toast` 反复重播，CPU 打满、窗口无法关闭，只能任务管理器杀进程。这是 Windows 上相当常见的可恢复故障（文件被占用/只读），不是理论边角。
- 修复方向：提交后按「活动块是否真的清掉」决定要不要关，失败就留在窗内让用户处理（草稿此时仍在框里）：
  ```tsx
  await current.commitActive();
  if (!editorRef.current?.activeUnit) void getCurrentWindow().close(); // 失败则保持窗口打开
  ```
  另外成功路径完全可以不调 `close()`——不 `preventDefault` 时 JS 包装层自己会 `destroy()`。
- 测试为什么没抓到：`src/App.test.tsx:1825` 的 window mock（`:31-46`）里 `close` 是 `vi.fn()`，**不重发 `closeRequested`**，与真实 Tauri 语义（上面 5 条一手证据）不一致 ⇒ 该用例的绿不代表真机关窗行为正确。

#### Important (Should Fix)

**I1 — mdlog 记录期间每来一次 `file-changed` 都会弹「文件已被外部修改 · 编辑已取消」，且该提示永不过期**

- 位置：`src/App.tsx:437-449`（`reloadIfExternal` → `editorRef.current?.notifyInterrupted("文件已被外部修改 · 编辑已取消")`）+ `src/hooks/useDocumentEditor.ts:77-88`（`notifyInterrupted` 在 `activeUnitIndex === null` 时**只弹提示、不做别的事**）+ `src/App.tsx:844-848`（提示条渲染）。
- 推理链：mdlog 记录中模型每次追加都会触发 `file-changed`（AGENTS.md 明列的常态路径）→ 磁盘内容 ≠ `lastSavedMarkdownRef`（记录期禁编辑，快照必然不是当次追加内容）⇒ 走外部分支 ⇒ `notifyInterrupted` ⇒ 无活动块 ⇒ `showToast("文件已被外部修改 · 编辑已取消")`。于是**用户从未进入编辑态、也从未有编辑被取消**，屏幕上却持续挂着这条错误提示。
- 现存用例已经覆盖了触发路径但没断言这一点：`src/App.test.tsx:1276-1280` 在 mdlog 活跃时调用 `file-changed`，只断言了正文更新与「不吸底」，从未断言该提示**不该**出现（我 grep `src/App.test.tsx` 里 `文件已被外部修改` 只命中新用例 `:1758`，即「编辑中外部变更」这一条正确场景）。
- 修复方向：只在确有编辑会话被中断时提示，例如 `if (editorRef.current?.activeUnit) editorRef.current.notifyInterrupted(...)`（或 `viewMode === "editing"`），其余情况静默热重载。裁定 F25 要求的是「提交口门禁」，不要求对无人编辑的外部变更弹窗。

**I2 — `editor.toast` 没有任何消失路径（永久覆盖层）**

- 位置：`src/App.tsx:844-848`（`key={editor.toast.id}` 渲染，无 timer）+ `src/hooks/useDocumentEditor.ts:50-52`（只有 `setToast`，无 `clearToast`/定时器）。
- 对照同类提示：印章「墨迹未干」在 `src/App.tsx:669-672` 有 `setTimeout(() => setShowReloadNote(false), 2800)`；T7 的 `.editor-toast` CSS（`task-7-brief.md:70-86`）只有 `position: fixed; bottom: 18%`，没有任何淡入淡出/超时。
- 后果：`position: fixed` 的提示条会一直压在正文上（「记录中 · 断开连接后才能修改」「HTML 区块为只读」「保存失败：…」乃至 I1 的错误提示），直到下一条提示把它顶掉；T7/T8 都不负责清理 ⇒ 会一路带进发布版。建议在 App 侧给 `editor.toast` 加与印章同口径的 2.8s 定时清除（或由 hook 暴露 `dismissToast`）。

**I3 — `lastSavedMarkdownRef` 生命周期不完整：快照从不失效，会误吞真实外部变更；且快照在 save 落定前不更新，存在「提交被外部变更回滚」的竞态**

- 位置：`src/App.tsx:55`（声明）、`:492`（唯一写入点）、`:445`（唯一读取点）。全文件再无清零点（`grep -n lastSavedMarkdownRef src/App.tsx` 只有 55 / 445 / 492）。
- 子问题 a（误吞真实外部变更）：
  1. 打开文档 → 编辑提交，磁盘 = W，`lastSaved = W`；
  2. 外部程序把文件改成 E → watcher 触发 → `E ≠ W` → 走外部分支，视图变成 E，**但快照仍是 W**；
  3. 外部程序把文件**改回 W**（git checkout、编辑器撤销、同步工具回滚）→ watcher 触发 → `normalized === lastSaved(W)` ⇒ 被当成回声忽略 ⇒ 视图停在 E，与磁盘永久不一致，直到下一次提交。
  同一根因还有一个更弱的变体：快照不含 `path`，切到另一篇内容恰好等于 `lastSaved` 的文档时，该文档的真实外部变更也会被吞。
- 子问题 b（提交在途竞态）：`lastSavedMarkdownRef` 只在 `await invoke("save_document")` **之后**赋值（`:491-492`），而 `flushSync(onMarkdownChange(next))` 在 await 之前就已把内存改成新内容（`src/hooks/useDocumentEditor.ts:104`）。若外部 `file-changed` 落在这次 save 的 IPC 窗口内：`reloadIfExternal` 读到的是旧盘内容、与旧快照不等 ⇒ 走外部分支 ⇒ `reloadCurrent(latest)` 把内存覆盖回旧内容；随后 save 成功、快照写成新内容。结果：刚提交的编辑从视图里消失，而紧随其后的自身回声又正好等于新快照被忽略 ⇒ 视图再也不会自愈（内存落后磁盘）。
- 修复方向：把快照换成 `{ path, normalized }` 并在「走外部分支 / 切换文档 / `reloadCurrent` 应用新内容」时同步失效；更简单的替代判据是直接和**内存中的** `state.document.markdown`（同样 LF 归一）比较——它能同时免疫 a、b 两类误判（自身回声时内存恰等于磁盘）。
- 说明：报告 D9 只论证了「必须归一」，未覆盖快照失效与在途竞态；这两点都不是计划文本能豁免的正确性问题。

**I4 — 关窗提交失败时草稿静默丢失（与 C1 同源，即使按 C1 修掉循环后依然存在）**

- 位置：`src/App.tsx:386-387`。`commitActive` 内部把 `save` 异常吞掉并 resolve（`src/hooks/useDocumentEditor.ts:113-127`），因此 `await current.commitActive()` 正常返回后无条件 `close()`。若此时磁盘只读，用户只看到一瞬的「保存失败」提示（且如 I2 所述不会消失），窗口照关，草稿连同 F24 特意保留的回归路径一起丢失。
- 建议：按 C1 的写法，落盘失败就不关窗，让用户在编辑框里继续处理。

#### Minor (Nice to Have)

1. **`Ctrl+E` 在空态/加载态也把 `viewMode` 置为 `editing`**：`src/App.tsx:495-500` 无条件接受 `toggleView`，于是 `src/App.tsx:831` 的顶栏按钮显示按下态、`:879-882` 给空态容器加上 `--editing` 类（T7 会加 `position: relative`）。无数据损失，纯观感；可加 `if (state.status !== "ready") return;`。
2. **`Ctrl+S` 在 mdlog 记录中（无活动块）会弹「记录已开始，编辑已取消」**：全局兜底（`src/App.tsx:147-151`）让 F6 的 `commitActive` 在阅读态也可达，而 `src/hooks/useDocumentEditor.ts:93-94` 的门禁无条件弹提示。属 T4 文案面，但由本任务新接线放大（与 I1/I2 叠加会更吵）。
3. **mdlog 变活跃边沿的重复中断（报告 D7）**：`src/App.tsx:742` 先弹 `记录已开始 · 编辑已取消`，紧接着 `toggleView → commitActive` 的门禁（`useDocumentEditor.ts:93-94`）再弹 `记录已开始，编辑已取消`，同一批次两次 `setToast`，最终显示 hook 文案且分隔符不一致（`·` vs `，`）。用户可见的是重播一次的动画 + 文案口径不一，建议去掉 App 侧那一行或统一文案。
4. **测试保真度**：`src/App.test.tsx:1825` 的 window mock 不模拟 `close()` 重发 `closeRequested`（与 `window.d.ts:745` 相悖），是 C1 逃逸的直接原因；建议在 mock 的 `close` 里回放 `closeHandlers`（真机语义等价）并补一条「落盘失败时关窗不得无限重试」的用例。
5. **`src/App.test.tsx:1669-1670` 的点击断言是恒真的**：mdlog 门禁生效时 `editable === false`，正文根本没挂 `data-vellum-unit`，该点击本来就不可能激活覆盖层（真正证明门禁的是同用例 `:1676` 断言 `.markdown-body--editing` 为 null）。注释「记录中点击正文块同样不得激活覆盖层」名不副实，建议改为直接断言 `units` 未挂载。
6. **渲染期写 ref**：`src/App.tsx:501` 的 `editorRef.current = editor` 在渲染阶段赋值，React 并发渲染下被丢弃的那次渲染会留下一个未提交的会话对象。当前读点都在 commit 之后（effect/事件），实际影响低，但更稳妥是放到 `useLayoutEffect` 里（或至少加注释说明取舍）。
7. **`reloadCurrent(preloaded)` 的接口变更未登记给 T7/T8**：报告 D1 只在「与简报代码不同」处提到，T7/T8 简报的 Interfaces 都不含该参数（新增了可选参数，向后兼容，风险低，登记即可）。

---

### Assessment

**Task quality:** Needs fixes

**Reasoning:** 接线本体（Ctrl+E/Ctrl+S、覆盖层宿主与类名、mdlog 三重门禁、回调引用稳定、回声 EOL 归一与正负对照测试）与简报/裁定/spec 一致，测试也确为真行为而非空断言；但关窗处理器在 `close()` 会重发 `closeRequested`（Tauri 一手源码/runtime 证据）这一事实下，落盘失败即进入无限提交循环、窗口无法关闭，属必须修的 Critical；外加 mdlog 常态路径上的错误提示、提示条永不消失、回声快照失效/在途竞态三条应当修复项。

---

### 我实际跑过的命令与输出摘要

| 命令 | 输出 |
|---|---|
| `npx vitest run src/App.test.tsx src/components/TopBar.test.tsx` | `Test Files 2 passed (2)` / `Tests 51 passed (51)` / `Duration 5.15s`（= 新增 11 条全绿；未重跑整套，故 31/384 未独立复核） |
| `npx tsc --noEmit` | 无输出，`exit=0`（类型门禁通过） |
| `grep -rln "from \"./App\"\|components/TopBar" src --include=*.test.tsx` | 仅 `src/App.test.tsx` ⇒ 本 diff 的测试爆炸半径就是已跑的两个文件 |
| `grep -n "close" node_modules/@tauri-apps/api/window.d.ts` | `:745` close() 会发出可拦截的 closeRequested；`:756` destroy() 强制关闭 |
| `grep -n "onCloseRequested" -A18 node_modules/@tauri-apps/api/window.js` | `:1632-1641` 包装层：未 preventDefault 时自行 `this.destroy()` |
| `grep -rn "CloseRequested" tauri-2.11.5/src` + `sed` | `src/manager/window.rs:170-175`（有 JS 监听器则 `api.prevent_close()` 并 emit）；`src/window/mod.rs:1793/1799`（close 会 emit、destroy 不 emit） |
| `grep -rn "WindowMessage::Close" tauri-runtime-wry-2.11.4/src/lib.rs` + `sed` | `:4368 Message::Window(id, WindowMessage::Close) => on_close_requested(...)`（程序化 close() 也走同一路径） |

（另：`npx vitest ... --reporter=basic` 在本仓库 vitest 4.1.9 下报 `Failed to load custom Reporter from basic`，属我调用参数问题，与实现无关；随后用默认 reporter 复跑得到上表结果。）
