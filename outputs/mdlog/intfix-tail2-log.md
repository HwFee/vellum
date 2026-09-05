# Vellum 集成修复批尾款轮续跑实施日志 (Integration Tail Fix Log · Round 2)

- **基线提交**：`3ae47d1`（前任 F1-F7/F9 成果位于工作区，未 commit）
- **本轮范围**：F8、F10、F11、F12、F13 + 全量验证与提交入库
- **实施准则**：TDD 红绿循环（Red-Green-Refactor）、`verification-before-completion`、AGENTS.md 性能红线与 DESIGN.md kami 纸墨规范。
- **接手说明**：前任（gemini）因额度中断，其工作区日志见 `outputs/mdlog/intfix-tail-log.md`；本轮（qwen）续跑并对前任成果做抽查核验（见 §5）。

---

## 1. 提交清单 (Semantic Commit Log)

| 序号 | 提交哈希 | 提交信息 | 涉及文件 |
|---|---|---|---|
| 1 | `31d5be4` | `fix(app): C7 同路径重开走静默热重载，保活 widget iframe 与 ready 态`（F8） | `src/App.tsx`, `src/App.test.tsx`, `src/lib/path.ts`, `src/lib/path.test.ts` |
| 2 | `adc1e1b` | `fix(mdlog): 尾款批 F1-F7/F9 + 降级语言统一（沙箱授权同键、占位块语义、Rust 死代码、守卫断言）` | `src-tauri/src/main.rs`, `src/components/MarkdownDocument.tsx`, `src/components/MarkdownDocument.test.tsx`, `src/components/WidgetSandbox.tsx`, `src/components/WidgetSandbox.test.tsx`, `src/styles/kami.css`, `src/styles/kami.css.test.ts` |
| 3 | `d5381c9` | `fix(widget): 尾款批 F10/F11/F12（二）— registry dispose 回收全局监听、滚动条拖拽让位落位守护、vitest 排除 outputs/` | `src/lib/widgetRegistry.ts`, `src/lib/widgetRegistry.test.ts`, `src/lib/scrollRestore.ts`, `src/lib/scrollRestore.test.ts`, `src/components/CustomScrollbar.tsx`, `src/components/CustomScrollbar.test.tsx`, `vite.config.ts` |

每个 commit 入栈前均实测绿：

- `31d5be4`：临时 worktree 实跑 `npx vitest run src/` → `22 files / 226 tests passed`；
- `adc1e1b`：临时 worktree 实跑 `npx vitest run src/` → `22 files / 229 tests passed`；其 `src-tauri/src/main.rs` 与终点工作区逐字节一致（`git diff adc1e1b -- src-tauri/src/main.rs` 输出 0 行），故 Cargo 42 全绿 / `cargo check` 零警告对本 commit 同样成立；
- `d5381c9`：即终点工作区，四道门禁全量实测见 §4。

未入库项：`outputs/mdlog/*.md`（含本日志与 F13 订正）与 `docs/superpowers/reviews/*` 按仓库现行惯例保持未跟踪（`git ls-files outputs` 仅 3 个产品附件）；`.pi/agents/implementer.md` 本轮开始前即已修改，不属本批产物，未动。

---

## 2. 起点基线快照

接手时工作区状态（前任 F1-F7/F9 未 commit）：

- `git status --short`：`M src-tauri/src/main.rs`、`M src/App.test.tsx`、`M src/components/MarkdownDocument.tsx`、`M src/components/WidgetSandbox.test.tsx`、`M src/components/WidgetSandbox.tsx`、`M src/styles/kami.css`、`M src/styles/kami.css.test.ts`（另 `.pi/agents/implementer.md` 与未跟踪的 `outputs/`、`docs/superpowers/reviews/`）。
- 交接所述全量基线：`npx vitest run src/` → 226 过 / 1 红（红项即 `App.test.tsx` 的 F8 用例）；cargo 42 全绿、`cargo check` 零警告、tsc 未验证。
- 本轮实测起点：`npx vitest run src/App.test.tsx` → `Tests 1 failed | 36 passed (37)`，唯一红项为 F8 用例（尚不可判别，见 §3·F8）。
- F8 完成后的首个全量绿：`npx vitest run src/` → `Test Files 22 passed (22) / Tests 229 passed (229)`；终点四道门禁见 §4。

---

## 3. 逐项实施记录与 TDD 红绿证据

### F8（C7，App 同路径重开热重载保活 iframe）

- **问题与根因**：`src/App.tsx` `loadPath()` 在 `currentPathRef.current !== null` 时统一先 `setState({ status: "loading" })`。第二实例深链 `drain_pending_open_paths → loadPath`（`App.tsx:258-268` → `:145`）命中**当前已打开的同一文档**时，loading 帧会让 `state.status === "ready"` 分支整体卸载，`MarkdownDocument` 与其下所有 `WidgetSandbox` iframe 被销毁重建（伴随 `unregister_widget` / 重新 `register_widget`），用户正在进行的交互（滑块、表单、滚动位置、沙箱内内存态）全部丢失。这是「交互状态不丢」承诺唯一剩余的破坏路径。
- **修法**：
  1. `src/lib/path.ts` 新增 `isSamePath(a, b)` canonical 比较（统一 `\`→`/`、忽略大小写、忽略结尾斜杠、空值即 false），与既有 `currentPathRef.current !== expectedPath` 守卫风格一致但覆盖深链路径写法差异；
  2. `loadPath()` 入口最前加同路径守卫：`if (isSamePath(path, currentPathRef.current)) { await reloadCurrent(); return; }`，在任何拆台动作（保存位置、复位 mdlog 标志、取消落位守护、清 timer）之前拦截；
  3. 复用 `reloadCurrent()` 的既有热重载语义：不自建 loading 帧、走 `setState({status:"ready", document})` + `setReloadTick(t => t+1)`、`pendingScrollRef` 保留当前位置、贴底仲裁照旧。
- **Red 证据**（单测 `src/lib/path.test.ts`）：
  ```
  FAIL  src/lib/path.test.ts > isSamePath treats separators, case and trailing slashes as equivalent
  TypeError: isSamePath is not a function
  Test Files  1 failed (1)
  ```
- **Red 证据**（接线级 `src/App.test.tsx`，将前任所留用例改造为可判别后）：
  ```
  FAIL  src/App.test.tsx > App outline integration > F8/C7: re-opening the same path does not destroy ready state or widget iframe
  Error: expect(element).not.toBeInTheDocument()
  expected document not to contain element, found <section class="empty-state" role="status">加载中...</section> instead
   ❯ src/App.test.tsx:1474:46
  Tests  1 failed | 36 skipped (37)
  ```
- **Green 证据**：
  ```
  npx vitest run src/lib/path.test.ts src/App.test.tsx
  Test Files  2 passed (2)
  Tests  41 passed (41)

  npx vitest run src/
  Test Files  22 passed (22)
  Tests  229 passed (229)
  ```
- **对前任所留红测试的修正（必要，否则形同虚设）**：原用例三处缺陷使其无法判别本 bug——
  1. 文档缺 `<!-- mdlog:v1 -->` 头 → `autoMount=false`，交互块停在「点击加载」占位块，iframe 根本不挂载；
  2. `App.test.tsx` 未桩 `IntersectionObserver`（jsdom 桩件永不回调 `isIntersecting`）→ 永远停在「交互准备中…」；
  3. 二次点击后只 `await waitFor(存在 交互演示)`，而旧 iframe 在那一拍尚未被卸，断言瞬间即真 → **原实现在无修复时也会「假绿」通过**（实测确认：加前两项后未改实现即 passed）。本轮改为把第二次 `load_document` 挂起成 gate，先 `await act(setTimeout 0)` 给 loading 帧充分浮现机会再断言「无加载中... 且 iframe 仍在文档中」，随后放行 gate，最后断言 iframe 严格同一实例 + `register_widget` 全局仅调用 1 次 + `loadDocumentCalls === 2`。
- **偏差/后果说明**：同路径重开现在沿用热重载的静默失败语义——若该文件此刻已不可读，保留旧内容、不弹错误帧（与 `file-changed` 热重载一致）；同时会像普通热重载一样播放一次「落墨/墨迹未干」提示（mdlog 活跃时自动抑制）。

### F10（P11，widgetRegistry dispose 清理机制与单测）

- **问题与根因**：`src/lib/widgetRegistry.ts` 在 `createWidgetRegistry()` 里无条件 `window.addEventListener("scroll", handleScroll, { capture: true, passive: true })`，但没有任何对应的释放入口。已有的 `__clear()` 只清定时器/条目/订阅，故意保留全局监听（单例需要它驱动休眠仲裁）；因此每新建一个 registry 实例（测试隔离、未来多宿主实例、HMR）都会永久泄漏一个捕获期 window 监听，并可能在实例已废弃后仍回调其 `evictIfNecessary()`。
- **修法**：`WidgetRegistry` 接口新增 `dispose(): void`（并在工厂返回类型上置为必选），实现三件事：`window.removeEventListener("scroll", handleScroll, { capture: true })`（capture 标志必须与 add 时一致，否则无效）、`clearTimeout(scrollTimer)`、重置 `isScrolling` 并 `widgets.clear() / subscribers.clear()`。`__clear()` 保持原语义（仅重置状态、保留监听），两者差异已写入代码注释；`dispose()` 幂等，且不会“毒化”实例（之后仍可 register/subscribe/淘汰）。
- **Red 证据**：
  ```
  FAIL  src/lib/widgetRegistry.test.ts > widgetRegistry.dispose (F10/P11)
  TypeError: reg.dispose is not a function
  Test Files  1 failed (1)
  Tests  2 failed | 5 passed (7)
  ```
- **Green 证据**：
  ```
  Test Files  1 passed (1)
  Tests  9 passed (9)
  ```
- **逐职责判别验证（变异测试）**：`dispose` 的三项清理职责各自单独破坏时都有专属于它的用例变红，证明用例不是只跟 `dispose` 存在与否绑定（三次变异均从 `%TEMP%` 备份 `cp` 回滚，已复测 9 passed）：
  1. 删 `removeEventListener` → `leaves no live scroll listener behind…` 红：`AssertionError: expected [] to deeply equal [ { id: 'v-1', dormant: true } ]`；
  2. 删 `clearTimeout(scrollTimer)` → `cancels the pending flush timer…` 红：`AssertionError: expected [ { id: 'q-1', dormant: true } ] to deeply equal []`；
  3. 删 `subscribers.clear()` → `clears subscribers and registry state on dispose` 红：`AssertionError: expected 1 to be +0`（旧订阅者仍被 `activate` 触达）；仅破坏 1/2 时该用例仍绿，反之亦然——三条合起来构成完整判别。另：未实现 `dispose` 的初始态为 `TypeError: reg.dispose is not a function`。
- **用例清单**（新增 4 个）：dispose 后滚动与遗留 flush 均不再触发淘汰/通知、订阅集与内部注册表清空且可重新订阅、遗留定时器不得抢先 fire 到 dispose 后新建的超限状态、滚动监听不得残留（以 flush 时序为代理观测点）。
- **范围说明**：本轮仅新增能力与测试，未改 `WidgetSandbox` 的卸载接线（现有单例与应用同生命周期，`release(id)` 已逐个回收条目）；在非 spec 要求处提前接入宿主卸载路径属 YAGNI，本轮不做。

### F11（P13，CustomScrollbar 拖拽打断落位守护）

- **问题与根因**：`src/lib/scrollRestore.ts` 落位守护的「用户接管」事件集只有 `container` 上的 `wheel` / `touchstart` 与 `window` 上的 `keydown`。Vellum 的自定义滚动条拖 thumb 是直接 `container.scrollTop = …` 写值，不产生任何上述事件（桌面 WebView2 下 `touchstart` 也不可依赖），因此开局恢复期间拖滚动条会被 ResizeObserver 重锚逻辑把位置拽回锚点。
- **修法**（按 spec 最小方案）：
  1. `CustomScrollbar.handleThumbMouseDown` 在拖拽起始（仅一次）向滚动容器派发 `new CustomEvent("vellum:scrollbar-drag", { bubbles: true })`；
  2. `restoreScrollPosition` 在容器上监听该事件并复用 `endByUser`（cleanup + `cancelScrollAnimation`），`cleanup` 里对称 `removeEventListener`；函数文档注释同步列出该结束条件。
- **Red 证据**：
  ```
  FAIL  src/components/CustomScrollbar.test.tsx > CustomScrollbar > announces drag start on the scroll container with vellum:scrollbar-drag
  AssertionError: expected [] to have a length of 1 but got +0

  FAIL  src/lib/scrollRestore.test.ts > restoreScrollPosition > 自定义滚动条拖拽（vellum:scrollbar-drag）同样结束守护并取消动画
  AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times

  Test Files  2 failed (2)
  Tests  2 failed | 18 passed (20)
  ```
- **Green 证据**：
  ```
  Test Files  2 passed (2)
  Tests  20 passed (20)
  ```
  新用例额外用 `toHaveBeenCalledTimes(1)` 并在其后补发一次 `wheel` 验证「不再重复触发」，
  以反证守护真正结束（监听已撤）而非只多了一个旁路入口；另补一条「取消函数被调用后，
  `vellum:scrollbar-drag` 也不再触发动作」用例，防止监听残留。
- **行为注释**：两侧均写明「拖 thumb 不产生原生输入事件，故需显式信号」；并说明事件在滚动容器上派发且允许冒泡，使仅监听容器或仅监听 document 的消费方都能收到。
- **残留风险（本轮有意不做，超出 F11 范围）**：轨道翻页点击（`handleTrackClick`）同样直写 `scrollTop` 而不广播；但它是单次离散跳转、无持续拖拽流，与守护抢位窗口极短，且 App 侧动画取消监听（仅 wheel/touch/keydown）也未纳入本事件——若后续报「点轨道时与缓动动画互拉」，可直接复用同一个 `vellum:scrollbar-drag` 信号而无需新事件名。

### F12（降级语言标识统一与 vitest exclude outputs/**）

**（一）降级语言统一为 `markup`**

- **现状**：`MarkdownDocument.tsx` 超限（>512KB）降级写 `language=""`，`WidgetSandbox.tsx` 注册失败降级写 `language="xml"`。`markup` 才是 `CodeBlock.tsx` 真实 `registerLanguage` 的 Prism 语言（`xml` 仅靠 `LANGUAGE_ALIASES` 映射到 markup，作为字面量写在此处名实不符；而 `""` 会被 `resolveHighlightLanguage` 当 `text`，完全丢高亮）。
- **修法**：两处均改为 `language="markup"`（widget 内容本就是完整 HTML 文档，markup 高亮语义正确），各附一行为何统一的注释。
- **Red 证据**（先给两处降级各加一条语言 chip 断言）：
  ```
  AssertionError: expected 'text' to be 'markup'   // MarkdownDocument 512KB 降级
  AssertionError: expected 'xml' to be 'markup'    // WidgetSandbox 错误降级
  Tests  2 failed | 49 passed (51)
  ```
  旧值以红测实测定底，非臆断；既有测试无任一处断言旧值，无需回改其他用例（仅将 `WidgetSandbox.test.tsx` 里“xml 高亮会把 HTML 拆成多个 token”注释订正为 markup）。
- **Green 证据**：`npx vitest run src/` → `Test Files 22 passed (22) / Tests 236 passed (236)`。
- **可见行为变化**：超限降级的代码块头部语言 chip 由 `text` 变为 `markup`，且内容获得 HTML 高亮（原本无高亮）。

**（二）`vite.config.ts` 的 `test.exclude` 追加 `outputs/**`**

- **修法**：`exclude: [...defaultExclude, "outputs/**", "dist/**"]`（`defaultExclude` 从 `vitest/config` 导入，避免丢掉 `**/node_modules/**` 等默认排除）。
- **验证证据**：在 `outputs/__audit_scratch/probe-f12-exclusion.test.tsx` 放一个必红探针（`expect(1).toBe(2)`）：
  ```
  # 加 exclude 后
  npx vitest list --files-only  → 22 个文件，probe 不在列
  npm test                      → Test Files 22 passed (22) / Tests 236 passed (236)

  # 删除 exclude 行（反证）
  npx vitest list --files-only  → 39 个文件，新增拾取：
    outputs/__audit_scratch/probe-f12-exclusion.test.tsx
    outputs/__audit_scratch/mut/mdlog/test/*.test.ts   （8 个）
    outputs/__audit_scratch/prefix/test/*.test.ts     （8 个）
  ```
  即尾款轮留下的审核副本会被全量跑拾取 17 个非产品用例（且这些 Node 侧用例在 jsdom 环境下会直接报错），现已彻底隔离。
- **探针已删除**：`outputs/__audit_scratch/probe-f12-exclusion.test.tsx` 验证完毕即 `rm`，未入库（`outputs/` 整体未被跟踪）。其余 `probe-*.mjs` / `mut/` / `prefix/` 属前任尾款轮遗留草稿，不属本轮产物，本轮未动。

### F13（订正 integration-fix-log.md 历史记录）

- **问题**：`outputs/mdlog/integration-fix-log.md` §3「改动文件清单」的 `git diff --stat` 块是事后追写的估计值，与实 diff 不符（声称 `11 files changed, 539 insertions(+), 62 deletions(-)` 与 `src/App.tsx 28`/`src/App.test.tsx 110`/`MarkdownDocument.test.tsx 150` 等）；§1 提交清单缺审核建议追补批 `3ae47d1`。
- **实测依据**：
  ```
  $ git log --oneline 1cdca85..d157d23
    d157d23 / 8156069 / 31a7611 / ceb4e04 / eef250b / 231ae4d / 0db95a4 / 9f9d7fb / a4c6140  （9 个，与 §1 表 1-9 行一致）
  $ git diff --stat 1cdca85..d157d23
    11 files changed, 630 insertions(+), 48 deletions(-)
      src-tauri/src/main.rs 97 | src/App.test.tsx 100 | src/App.tsx 11 | MarkdownDocument.test.tsx 284
      MarkdownDocument.tsx 17 | WidgetSandbox.test.tsx 56 | WidgetSandbox.tsx 40
      widgetRegistry.test.ts 29 | widgetRegistry.ts 4 | kami.css 12 | kami.css.test.ts 28
  $ git diff --stat 1cdca85..3ae47d1
    11 files changed, 639 insertions(+), 48 deletions(-)（WidgetSandbox.tsx 43、kami.css 18）
  ```
- **订正内容**：§3 换为两份真实 `git diff --stat` 输出（区间 9 commit 与含 `3ae47d1` 的 10 commit 终点）并附订正说明段；§1 补第 10 行 `3ae47d1`（`fix(mdlog): 集成审核建议——实例复用时复位 widget 标题/高度；占位块 :active 防下沉穿透`，文件 `src/components/WidgetSandbox.tsx`、`src/styles/kami.css`）；文件头「最新提交」由 `d157d23` 改为 `3ae47d1` 并注明区间末。
- **未订正项（实跑证明本就正确）**：§4 的 Vitest `22 files / 223 tests` 与 `npx tsc --noEmit` 零错——在 `f428111` 的临时 worktree（node_modules 以 `mklink /J` 接入，跑完 `rmdir` 卸 link + `git worktree remove`）实跑得到：
  ```
  Test Files  22 passed (22)
       Tests  223 passed (223)
  npx tsc --noEmit → exit=0
  ```
  已在 §4 顶部补一行「尾款轮复核」备注（含 Cargo 42 的复核位置说明），避免后人重复怀疑。

---

## 4. 最终全局验证矩阵

终点 commit `d5381c9`（工作区与之一致，`git status --short` 仅剩与本批无关的 `.pi/agents/implementer.md`）：

| 门禁 | 命令 | 实测输出 |
|---|---|---|
| 前端全量测试 | `npm test`（= `vitest run`，含 F12 exclude） | `Test Files  22 passed (22)` / `Tests  236 passed (236)` / exit 0 |
| 前端定点测试 | `npx vitest run src/` | 同上 22 / 236 全绿 |
| Rust 测试 | `cd src-tauri && cargo test` | `35 passed` + `7 passed` + doc `0` = **42 全绿**，exit 0，无 `warning:` 行 |
| Rust 告警 | `cargo check --all-targets` | exit 0，`warning` 行数 **0**（`Finished dev profile …`） |
| 类型检查 | `npx tsc --noEmit` | exit 0，零输出 |
| kami 合规 | emoji/象形码点正则全扫 `src/` + `src-tauri/src/`（ts/tsx/css/rs） | `Total emoji violations: 0` |

用例数变化：接手时 `223 passed / 1 failed`（前任基线 223 + 一个不可判别的 F8 红测）→ 终点 `236 passed`（+13：F8 接线 1、isSamePath 2、前任新增 3（A1 越权注册、标题/高度复位、真级联 computed-style）、dispose 4、滚动条拖拽 1、落位守护 2；F12 的两处语言标签断言与 F5/F7 均系在既有用例内加断言，不计数）。

### 构建验证附注

本轮未重跑 `npm run build`（vite 产物构建），因 `tsc --noEmit` 零错且未新增依赖/入口；F12 的 `vite.config.ts` 改动仅触及 `test.exclude`，不影响 `build` 配置块。若需严格回归可在下一批补跑。

---

## 5. 对前任 F1-F7/F9 工作区成果的抽查结论

逐项比对 `outputs/mdlog/intfix-tail-log.md` 自述与实际代码（均为实测 grep，非推定）：

| 项 | 自述 | 实测 | 结论 |
|---|---|---|---|
| F1/A1 | 新增 `activatedForHtmlRef` 并以它仲裁 `isAuthorized/shouldMount` | `WidgetSandbox.tsx` 内 ref 声明 + 渲染期兜底 + `const isAuthorized = autoMount \|\| activatedForHtmlRef.current === html` 均存在；`F1/A1` 用例存在 | 一致 |
| F2 | 删 `should_rebind` 定义与测试导入 | `main.rs` 已无 `fn should_rebind`，`cargo check` 零警告；仅余一处测试函数名 `should_rebind_and_watcher_matrix_evaluation` 残留旧名 | 基本一致（残留名已由本轮 `adc1e1b` 改为 `rebind_and_watcher_matrix_evaluation`） |
| F3 | 补 3ae47d1 两项守卫回归 | `WidgetSandbox.test.tsx:259` “resets custom title and height”；`kami.css.test.ts:199` 对 `:active` 含 `transform:\s*none` 的正则断言均存在 | 一致 |
| F4 | 并发/授权语义与渲染期调用不变量注释 | `WidgetSandbox.tsx` 安全门禁注释、`MarkdownDocument.tsx:236` “resolveHeadingId 必须且仅允许在渲染期…” 均在位 | 一致 |
| F5/C2 | 交互伪类限定 `button.` 前缀 | `kami.css:1202/1206/1212/1218` 四条选择器均以 `.markdown-body button.mdlog-widget__placeholder` 开头；测试对 div 版 `not.toMatch(/cursor:\s*pointer/)` | 一致 |
| F6/C3 | 升级为真级联 computed-style 断言 | `kami.css.test.ts:239-256` 存 `getComputedStyle(button/div)` 与 `cursor === "pointer"` / `not.toBe("pointer")` | 一致 |
| F7/C4 | 补 autoMount true→false 第三阶段 | `WidgetSandbox.test.tsx:337-355` 存在第三阶段（以 `autoMount={true}` 挂载后同 html rerender 为 `false`，断言 `unregister_widget { id: "w-automount" }` 回未授权态） | 一致 |
| F9/C8 | `apply_rebind` 改接 `path_changed` 入参 | `main.rs:181` 单次求值、`:186` 直接传入，内部不再重判；生产调用点仅 1 处 | 一致 |

**与日志自述不符、需补充的两点（均已由本轮修正）：**

1. **`npx tsc --noEmit` 并非零错**（前任日志未列该项为已验，任务交接里也标“tsc 未验证”）：F1 改造后 `WidgetSandbox.tsx:37` 的 `isUserActivated` 变成只写不读，tsc 报 `TS6133: 'isUserActivated' is declared but its value is never read`。本轮未简单删除（它仍兼任“点击授权后强制渲染”的触发器——直接删除会使 `MarkdownDocument.test.tsx` 的 P2 防线用例真实变红：`expected "vi.fn()" to be called with arguments: [ 'register_widget', … ] / Number of calls: 0`），而是改名为 `grantRenderTick` 并列入挂载仲裁 effect 依赖表，名实回归。现 tsc exit 0。
2. **F8 红测不可判别**：前任留的 `F8/C7` 用例因缺 `mdlog:v1` 头与 `IntersectionObserver` 桩件而根本挂不了 iframe；补上这两项后、在未修 `App.tsx` 时仍会“假绿”通过（`waitFor` 比 loading 帧更早完成）。已按 §3·F8 重做（挂起第二次 `load_document`、断言无 loading 帧 + iframe 同一实例 + `register_widget` 仅 1 次）。

---

## 6. 偏差说明

1. **F8 前置修正了前任的验收测试**（非 spec 内工作，但不改就无法把红灯归因到正确位置）：补 `mdlog:v1` 受信头、`IntersectionObserver` 桩、第二次加载 gate 与三个强断言。未改断言的原始意图（同路径重开不得销毁 ready 态与 iframe）。
2. **F8 新增 `isSamePath` 工具到 `src/lib/path.ts`**：任务书写的是“`path === currentPathRef.current`”；因深链路径可能带反斜杠/大小写差异，采 Windows 口径的 canonical 比较（包含于“与现有守卫风格一致”的最小扩展），并配单测。比字面 `===` 宽，不会错杀同文件不同写法。
3. **同路径重开的失败语义随之变为“静默”**：文件不可读时不再弹 error 帧而保留旧内容（与 `file-changed` 热重载一致）。spec 未单独讨论此分支，如需弹提示需补一个“重开失败→轻量通知”的后续项。
4. **F10 未接宿主卸载线**：仅按任务书新增 `dispose()` + 用例，未将其接入 `WidgetSandbox` 卸载或 `main.tsx` HMR（当前单例与应用同生命周期，接入属 YAGNI）。
5. **F11 未覆盖轨道翻页点击**：见 §3·F11 “残留风险”；严格限定在任务书指定的“拖拽起始”信号。
6. **F12（一）使超限降级代码块多一个 `markup` 语言标签并获得 HTML 高亮**：这是修组一致意图（名实相符），非纯重构；若审核认为应保留“无标签”观感，只需回退 `MarkdownDocument.tsx` 一处并同步删两条断言。
7. **本轮额外修了两项前任改造留下的“无名尾”**：（a）`WidgetSandbox` 的 `grantRenderTick` 重命名（tsc 硬门禁必需，仅换名与依赖表，不改仲裁逻辑）；（b）`main.rs` 矩阵测试函数名去 `should_rebind` 残留（纯命名，不改断言）。两者均在 `adc1e1b` 下入库并在 commit message 中点名。
8. **未改 `AGENTS.md` 的“223+ 用例”描述**：按硬约束，AGENTS.md 与 `docs/superpowers/` 由主 Agent 维护；现值（236）已在 §4 备案，供主 Agent 同步。
