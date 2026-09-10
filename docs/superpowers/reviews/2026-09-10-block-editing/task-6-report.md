# Task 6 报告 — App 接线（Ctrl+E 门禁、提交落盘、回声抑制、外部变更与 mdlog 分流）

- **状态**：完成（全部计划步骤 + 裁定 F6/F9b/F14/F25/F26 落地；红→绿与变异体证据见 §3/§4）
- **提交**：`3f0b74a6b351ed01a80da2064f75b2a5683b26ab` — `feat(edit): App 接线（Ctrl+E 门禁、提交落盘、回声抑制、外部变更与 mdlog 分流）`（**单次提交**，基线 `8e83ca5`）
- **测试结论**：`npm test` → **31 文件 / 384 用例全绿**（接线前基线 31 / 373，本任务净增 11 条）；`npx tsc --noEmit` → 无输出（clean）；`npm run build` → 成功（2.26s）
- **未涉及 Rust**：`git show --stat HEAD` 的 4 个文件全在 `src/`，`src-tauri/` 零改动（故未跑 `cargo test`）
- **临时文件**：未创建任何探针文件（`outputs/__audit_scratch/` 不存在）；变异实验全部在仓库文件上原地改后立刻还原，终态 `git diff HEAD --stat` 对本任务 4 文件为空

---

## 1. 改动文件清单（`git diff --numstat 8e83ca5 HEAD`）

| 文件 | +/− | 内容 |
|---|---|---|
| `src/App.tsx` | +166 / −10 | `useDocumentEditor` + `BlockEditor` 接线；全局 `Ctrl+E`/`Ctrl+S`；`applyMarkdown`/`saveMarkdown`；`editorRef`；`reloadIfExternal`（回声抑制 + 外部变更分流）；`reloadCurrent(preloaded?)`；mdlog 变活跃清场；关窗前提交；提示条；编辑态类名与覆盖层宿主 |
| `src/components/TopBar.tsx` | +30 / −0 | 新增 `isEditing`/`canEdit`/`onToggleEdit` props；左区第二个图标按钮（`aria-label="切换编辑视图"`、`aria-pressed`、禁用态 title）；`EditIcon`（线性 SVG，无 emoji） |
| `src/App.test.tsx` | +325 / −6 | window mock 补 `onCloseRequested` 并可断言（`vi.hoisted` 捕获处理器与窗口实例）；**9 条**新用例 |
| `src/components/TopBar.test.tsx` | +21 / −0 | **2 条**新用例（切换/呈现编辑态、记录中禁用） |

未改动（遵守约束）：`src-tauri/**`、`src/styles/kami.css`、T1–T5 的任何实现文件、`DESIGN.md`、`MarkdownDocument.tsx`、`useDocumentEditor.ts`。无新增依赖。

App 侧新增/变更的接线点（要点，逐条对应简报 Step 3 的 1–10）：

1. `lastSavedMarkdownRef`（LF 归一的「最近一次我方写入」）、`editorRef`
2. `applyMarkdown`（`useCallback []`）/ `saveMarkdown`（`invoke("save_document", { path, content })`）/ `useDocumentEditor({ markdown: activeDocument?.markdown ?? "", mdlogActive: isMdlogActive, onMarkdownChange: applyMarkdown, save: saveMarkdown })`
3. 全局 keydown（原 `handleSearchShortcut` 更名 `handleGlobalShortcut`）：`(ctrl|meta)+s` ⇒ `preventDefault()` + `commitActive()`（F6）；`(ctrl|meta)+e` ⇒ `preventDefault()` + `toggleView()`；`(ctrl|meta)+k` 行为不变。依赖仍只有 `[isOutlineOpen, setIsOutlineOpen]`
4. `handleActivateUnit` / `handleLockedUnitClick` / `handleToggleEdit`：`useCallback(..., [])` + 经 `editorRef` 读最新会话
5. 渲染：`.document-scroll__content` 在编辑视图加 `document-scroll__content--editing`；`MarkdownDocument` 传 `editable`/`onActivateUnit`/`onLockedUnitClick`；`BlockEditor` 作为 `.document-scroll__content` 的**直接子元素**并列渲染（不在 `.markdown-body` 内，裁定 F23）
6. `reloadIfExternal()`：读盘 → LF 归一比对最近写入 → 相等即整体忽略（不更新状态 / 不递增 `reloadTick` / 不闪印章 / 不做滚动补偿）；不等则 `notifyInterrupted` + 热重载
7. mdlog 变活跃 effect：`notifyInterrupted("记录已开始 · 编辑已取消")` + 编辑中则 `toggleView()`
8. 启动 effect 内 `onCloseRequested`：有活动块 ⇒ `preventDefault()` → `commitActive()` → `close()`；无活动块放行；`unlistenClose` 卸载清理
9. `editor.toast` 渲染为 `.editor-toast`（`role="status"`，`key={toast.id}` 重播）
10. `TopBar` 三新 props + 按钮

---

## 2. 交付的接口（供 T7/T8 依赖）

```tsx
// TopBar（新增，均为可选）
isEditing?: boolean;   // 编辑视图按下态
canEdit?: boolean;     // 默认 true；false ⇒ 按钮 disabled + title「记录中 · 断开连接后才能修改」
onToggleEdit?: () => void;

// App 内部
applyMarkdown(next: string)                 // 文档 markdown 唯一写入点（提交/失败回退都经此）
reloadCurrent(preloaded?: LoadedDocument)    // 预览读到的内容可直接复用，不再读盘
reloadIfExternal()                          // file-changed 的回声/外部变更分流
```

DOM 契约（T7 的类名清单全部就位）：`.document-scroll__content--editing`（覆盖层宿主）、`.block-editor__input`（直接子元素）、`.editor-toast`、`.markdown-body--editing`（T2 已加）、顶栏按钮 `.open-button.edit-toggle`。

---

## 3. 红 → 绿证据（逐条，真实输出摘要）

### 3.1 先写测试（红）：`npx vitest run src/App.test.tsx`（实现前）

```
 FAIL  src/App.test.tsx > Ctrl+E 进入编辑视图，点击块激活就地编辑，提交后落盘
 FAIL  src/App.test.tsx > mdlog 记录中不得进入编辑视图
      TestingLibraryElementError: Unable to find an element with the text: 记录中 · 断开连接后才能修改
 FAIL  src/App.test.tsx > 自己的写入回声不触发「墨迹未干」印章
      AssertionError: expected null not to be null      （enterEditingView 等待 [data-vellum-unit] 超时）
 FAIL  src/App.test.tsx > 全局 Ctrl+S 拦截 WebView 默认保存并在有活动块时提交
      AssertionError: expected true to be false          （fireEvent 返回 true ⇒ 未 preventDefault）
 FAIL  src/App.test.tsx > 外部变更不误判为回声：照常热重载并提示编辑已取消
 Test Files  1 failed (1)
      Tests  5 failed | 38 passed (43)
```

第 1 条的红与简报 Step 2 预期一致（找不到 `[data-vellum-unit]`，即编辑视图未接线）。

### 3.2 后写实现（绿）

```
$ npx vitest run src/App.test.tsx src/components/TopBar.test.tsx
 Test Files  2 passed (2)
      Tests  51 passed (51)

$ npm test
 Test Files  31 passed (31)
      Tests  384 passed (384)

$ npx tsc --noEmit
(无输出)
```

### 3.3 9 条 App 用例 + 2 条 TopBar 用例（`--reporter=verbose` 全绿）

```
✓ Ctrl+E 进入编辑视图，点击块激活就地编辑，提交后落盘                  （简报用例）
✓ mdlog 记录中不得进入编辑视图                                        （简报用例）
✓ 自己的写入回声不触发「墨迹未干」印章                                （简报用例）
✓ 全局 Ctrl+S 拦截 WebView 默认保存并在有活动块时提交                  （F6）
✓ 外部变更不误判为回声：照常热重载并提示编辑已取消                     （回声反向）
✓ 保存失败后退回阅读视图不留下孤悬覆盖层，草稿可再进编辑视图找回
✓ 编辑中 mdlog 变活跃：草稿尽力写入剪贴板、中断编辑并退回阅读视图
✓ 关窗请求：有未提交草稿时先落盘再关闭，无活动块时放行
✓ 切换文档前先提交活动块：草稿落回原文档，不写进新文档
✓ TopBar > toggles the edit view and reflects the editing state
✓ TopBar > disables the edit toggle while mdlog logging is active
```

### 3.4 变异体（证明用例真能杀掉实现，而非恒真）

每条变异都是「原地改 → 只跑对应用例 → 立刻还原」，全部真实输出：

| # | 变异（删/改实现） | 结果 |
|---|---|---|
| M1 | 回声分支的 `return;` 去掉（不抑制 `file-changed`） | FAIL `expected <div class="reload-note" …(1)></div> to be null` ⇒ 用例 3 真的在测回声抑制 |
| M2 | 回声分支改为无条件 `return`（一律当回声） | FAIL `Unable to find an element with the text: Body text from elsewhere.` ⇒ 用例 5 真的在测「外部变更照常重载」 |
| M3 | mdlog 变活跃 effect 整体短路（`if (true) return`） | FAIL `Unable to find an element with the text: /编辑已取消/` ⇒ 用例 7 覆盖该 effect |
| M4 | 覆盖层门槛改回 `editor.activeUnit ? (`（只在视图标志上做文章） | FAIL `expected <textarea …(3)></textarea> to be null` ⇒ 用例 6 锁住「失败态不孤悬覆盖层」 |
| M5 | 关窗处理器改 `if (true) return;`（关前不提交） | FAIL `expected "vi.fn()" to be called 1 times, but got 0 times` ⇒ 用例 8 覆盖关窗提交 |
| M6 | `loadPath` 开头 `await commitActive()` 删除 | FAIL `expected "vi.fn()" to be called with arguments: [ 'save_document', { …(2) } ]` ⇒ 用例 9 覆盖「切文档前提交」 |
| M7 | `reloadCurrent` 改回计划原样的「双读」（`preloaded` 不生效） | FAIL 既有用例 `silently reloads the document when file-changed event fires` ⇒ 见偏差 D1 的实证 |
| M8 | 简报**字面形式**的回声用例 + 同时关掉回声抑制 | **PASS**（1 passed）⇒ 简报字面形式是空断言，见偏差 D4 |

---

## 4. 与简报 / 裁定 / spec 的偏差说明

> 简报 Step 3 的 1–10 全部落地；下列为「实现细节与简报代码片段不同」或「简报未列但 spec §6.3 要求」的条目，逐条给理由与证据。

### D1（实现细节）：`reloadIfExternal` 把已读到的文档交给 `reloadCurrent(preloaded?)`，而不是再读一次盘

简报片段是「预读一次比对 + `reloadCurrent()` 内部再读一次」，同一事件读盘两次。改为 `reloadCurrent(preloaded?: LoadedDocument)` 复用（`const document = preloaded ?? await invoke(...)`）。
**证据（M7）**：按计划原样双读时，既有用例 `silently reloads the document when file-changed event fires` 直接 FAIL —— 它只 `mockResolvedValueOnce` 一份响应，第二次 `load_document` 返回 `undefined`、`document.path` 抛错被热重载的 catch 吞掉，正文不再更新。真机上双读还会让每次外部变更都多付一次整篇读盘（大文档可观）。布局过渡窗内延迟提交时**主动丢弃预读**、稍后重新读盘（保证读到的是当刻内容）。

### D2（实现细节 + T4 遗留决策）：覆盖层与编辑态类名同一门槛

简报是 `editor.activeUnit ? <BlockEditor/> : null`。改为 `editor.viewMode === "editing" && editor.activeUnit`。
理由：T4 审查 I3 未修（`commitActive` 吞异常 ⇒ 落盘失败后 `toggleView` 仍 `setViewMode("reading")`，而失败分支已重新激活该块），T4 修复报告明确把这条 UI 一致性问题**留给 T6 决策**。若覆盖层只认 `activeUnit`，失败态下 `editable=false` ⇒ `units` 为空 ⇒ 正文无 `data-vellum-unit` 标记 ⇒ `BlockEditor.resolveTarget` 返回 null ⇒ `setBox(null)`，textarea 无内联样式、脱出定位上下文掉到正文末尾；同时宿主也没有 `position: relative`（T7 的类名随视图标志走）。故让两处同门槛：失败态覆盖层消失、正文回到阅读渲染，而**草稿仍被 hook 保留**，再按 `Ctrl+E` 原样带回（用例 6 断言 `restored.value === "Body text edited."`）。M4 证明该用例能杀掉放宽门槛的实现。

### D3（实现细节）：App → 子组件的回调一律 `useCallback([], …)` + `editorRef`

简报给的是 `useCallback(..., [editor.activateUnit])`。改为空依赖 + `editorRef.current`。
理由：(a) 性能结构约束要求传给 memo 化 `MarkdownDocument` 的 props 引用稳定，而 `activateUnit` 的依赖含 `markdown`/`units`，每次提交都会换引用；(b) T4 审查 M11 明确提示 `notifyInterrupted` 引用随键入变化、消费者放进依赖会反复订阅 —— 本项目 `isMdlogActiveRef`/`headingsRef` 已有同款约定。`editorRef.current` 在每次渲染赋值，effect/事件回调读到的一定是最新会话。

### D4（测试写法）：回声用例改用 `listen.mock.calls` 取处理器（简报的字面形式是空断言）

简报用例在 `await loadDocument()` **之后**才 `vi.mocked(listen).mockImplementation(...)` 去捕获 `reloadListener`；但 `file-changed` 的监听在挂载时就已注册（既有测试都是从 `vi.mocked(listen).mock.calls` 取处理器），此后不会再有注册 ⇒ `reloadListener` 恒为 `undefined`，`reloadListener?.()` 是 no-op。
**证据（M8）**：用简报字面形式 + 同时**关掉回声抑制**，用例依然 PASS ⇒ 恒真。故改用本文件既有惯例（`mock.calls.find(([event]) => event === "file-changed")` 后 `act` 内调用），并在 M1 下证明可红。简报的另外两条用例（Ctrl+E、mdlog 记录中）按原文采用，仅把 `findByRole("textbox")`（会命中大纲搜索框）换成 `textarea.block-editor__input`。

### D5（简报笔误）：`lastSavedMarkdown` 原本不是 state

简报 Step 3-1 说「`const [lastSavedMarkdown, setLastSavedMarkdown] = useState<string|null>(null)` 改为 `useRef`」——`App.tsx` 里原本没有这个 state，直接新建为 `lastSavedMarkdownRef`（功能与简报要求一致：只给回调读、不参与渲染）。

### D6（超出简报步骤、但 spec §6.3 明列）：`loadPath` 开头先提交活动块

```tsx
async function loadPath(path: string) {
  // 切换文档前先提交活动块（规格 §6.3）
  await editorRef.current?.commitActive();
  ...
```
理由：spec §6.3 把「切换到别的文档」列为提交触发点。经 OS 关联 / 第二实例深链（`drain_pending_open_paths`）切文档时**没有失焦事件**，不先提交就会把上一篇的草稿按「同序号块」拼进新文档 —— 即以新文档的路径落盘旧文档的草稿（真正写到错的文件里）。用例 9 用「jsdom 的 click 不移焦」构造该路径并断言 `save_document` 只写过 `loadedDoc.path`；M6 证明删掉这一行即红。残余情形见 §5-U6。

### D7（计划原样，登记观感）：mdlog 变活跃边沿会触发两次 `notifyInterrupted`

计划 Step 3-7 的代码顺序是「先 `notifyInterrupted("记录已开始 · 编辑已取消")`，再 `toggleView()`」，而 `toggleView → commitActive` 的 mdlog 门禁（F25）会**再**中断一次，文案是 hook 的「记录已开始，编辑已取消」（分隔符是「，」不是「·」）。用户最终看到的是 hook 版本文案；两次 `setToast` 在同一批次里，不产生可见闪烁（仅 toast 的 `key` 变化让动画重播一次）。**按计划原样保留**（F25 要求 App 侧保证这条边沿调用 `notifyInterrupted`；hook 门禁另有剪贴板与提示，属重复但无害）。若 T8 真机认为多余，去掉 App 侧那一行即可（hook 门禁已覆盖剪贴板 + 提示 + 清场）。

### D8（实现细节）：顶栏编辑按钮的类名

计划只说「左侧动作区加按钮」，而 T7 的类名契约（`task-7-brief.md` Interfaces）不含顶栏编辑钮 ⇒ 新类名会完全没有样式。故写成 `className="open-button edit-toggle"`：`open-button` 复用既有图标按钮样式（28×28、`--hairline` 内描边、hover/active/focus-visible 全套，与相邻大纲/打开按钮视觉一致），`edit-toggle` 作语义钩子备 T7/T8 追加规则。

### D9（口径澄清）：`saveMarkdown` 记录的是 **LF 归一的** 写入内容

裁定 F9b/F14 禁止的是 App 侧对 caret/草稿做归一（T2/T4 已做，App 未再动）。这里的归一对象是**回声指纹**：`lastSavedMarkdownRef.current = next.replace(/\r\n/g, "\n")`，与 `reloadIfExternal` 里对磁盘内容的归一同一表达式。若不归一，CRLF 文档（Windows 常态）下自己的回声永远匹配不上，每次提交都会白闪一次印章并整篇重读 —— 与 spec §7.2 的「按归一 EOL 后比对」一致。比对两侧都不还原 CRLF（还原是 Rust `dominant_eol` 的职责，T5）。

### D10（同既有约定）：`onCloseRequested` 的注册未加 try/catch

与既有 `listen("pending-open-paths")` / `listen("file-changed")` 同构：注册失败会走 `bindStartup().catch` 的错误页（窗口仍会显示）。登记为已接受风险（§5-U8），不引入无测试覆盖的防御分支。

### D11（真机项，v1 保持现状）：裁定 F15 的两个交叉点未改

编辑视图下点链接仍会「系统浏览器打开 + 激活就地编辑」两件事同时发生；可交互 widget 的 iframe 因 `pointer-events` 吞掉点击 ⇒ `onLockedUnitClick("widget")` 不会触发（静态 widget 不受影响）。这两点 jsdom 观测不到（需要真机 + 真 iframe），**未做任何语义改动**（裁决：v1 保持现状），登记给 T8 手检（§5-U1）。

### D12（未消费）：`heavyDoc` 在 App 侧无消费者

T6 简报与 T7 简报都没有为 `heavyDoc` 指定 UI；按 YAGNI 不自行发明（例如塞进顶栏按钮 title）。T4 只承诺「暴露该标记」。

---

## 5. 未解决项 / 待观察（建议随 T8 复核）

| 编号 | 项 | 现状与建议 |
|---|---|---|
| U1 | **F15 真机观感** | 编辑视图点链接 = 打开浏览器 + 弹编辑器；交互 widget iframe 吞点击（只读提示不出现）。v1 按裁定保持，需真机确认「是否需要一个 `if (editing) only-activate` 的分支」 |
| U2 | **T7 样式未落地前的观感** | 现在 `.editor-toast`、`.block-editor__input`、`.document-scroll__content--editing` 都没有 CSS 规则：提示条会以普通块级元素出现在 `.app-shell__body` 的 flex 行里，覆盖层是未定位的原生 textarea。jsdom 只验证结构，真机观感须待 T7；这也是 T7 `kami.css.test.ts` 契约里已列的类名集合 |
| U3 | **F11 入口 chunk 增量（本次已实测，供 T8 引用）** | 接线前 `dist/assets/index-*.js = 144.35 kB / gzip 40.67 kB`、`MarkdownDocument-*.js = 270.42 kB / gzip 84.42 kB`；接线后 `index-*.js = 157.75 kB / gzip 44.94 kB`、`MarkdownDocument-*.js = 262.93 kB / gzip 82.06 kB`。入口 +13.40 kB raw（+4.27 kB gzip，**低于 F11 的 20KB 阈值**），懒加载 chunk 反而 −7.49 kB（remark-math/编辑单元被入口复用后不再重复）。`syntax-highlighter` 仍为单 chunk 117.47 kB，**没有**回归成 270+ 语言 chunk（PrismLight 红线未破） |
| U4 | **heavyDoc 无 UI 消费点** | T6/T7 契约均未指定，保留 |
| U5 | **spec §6.3 的「搜索结果跳转 / 大纲跳转」未显式调 `commitActive`** | 依赖失焦路径：点侧栏项/正文标题、点搜索框、乃至 `Ctrl+K` 的程序化 `focus()` 都会让正在编辑的 textarea 触发 `onBlur → requestCommit`（jsdom 不模拟移焦，故未写用例）。若 T8 真机发现键盘驱动的跳转能绕过提交，再补显式调用 |
| U6 | **落盘失败 + 随后切文档的残余风险** | D6 的提交是「尽力」：若 `save` 被拒，hook 保留草稿与活动块，紧接着切文档时覆盖层虽被 D2 门槛挡住（不渲染），但 `activeUnitIndex` 仍指向新文档的同序号块 —— 此时按 Ctrl+E 再提交会把旧草稿拼进新文档。触发条件苛刻（保存失败 + 无失焦切文档），且 hook 侧 I3 未修；登记待 T4 后续轮次或 T8 决策 |
| U7 | **`MarkdownDocument` memo 边界无新增渲染计数回归** | 编辑期每一次键入都会重渲染 App；本任务靠「`useCallback([]) + editorRef`（回调）、`markdown`/`headings` 只在提交时变化」保证 memo 不失效。这是结构性论证 + jsdom 不可廉价观测渲染次数，未加计数用例（既有 T2 接线级用例仍覆盖热重载不重建 iframe）。建议 T8 若要硬保证，用 devtools/profiler 手检一次 |
| U8 | **关窗监听注册失败 = 失去关前提交** | 无 try/catch（与既有 `listen` 同构）；失败会走启动错误页。若 T8 认为风险不可接受，可加 best-effort catch 并配一条用例（让 `getCurrentWindow().onCloseRequested` reject 后仍能正常加载） |
| U9 | **mdlog 变活跃的重复提示（D7）** | 文案分隔符不一致（`·` vs `，`），最终显示 hook 版本；如认为噪音可去掉 App 侧调用 |

---

## 6. 命令与输出记录（原样）

```
# 基线（改动前）
$ npm test
 Test Files  31 passed (31)
      Tests  373 passed (373)

# 红（实现前，追加 5 条用例后）
$ npx vitest run src/App.test.tsx
 FAIL  src/App.test.tsx > Ctrl+E 进入编辑视图，点击块激活就地编辑，提交后落盘
 FAIL  src/App.test.tsx > mdlog 记录中不得进入编辑视图
 FAIL  src/App.test.tsx > 全局 Ctrl+S 拦截 WebView 默认保存并在有活动块时提交
      AssertionError: expected true to be false // Object.is equality
 FAIL  src/App.test.tsx > 自己的写入回声不触发「墨迹未干」印章
 FAIL  src/App.test.tsx > 外部变更不误判为回声：照常热重载并提示编辑已取消
 Test Files  1 failed (1)
      Tests  5 failed | 38 passed (43)

# 绿（最终，提交后重跑）
$ npx vitest run src/App.test.tsx src/components/TopBar.test.tsx
 Test Files  2 passed (2)
      Tests  51 passed (51)

$ npm test
 Test Files  31 passed (31)
      Tests  384 passed (384)

$ npx tsc --noEmit
(无输出)

$ npm run build
dist/assets/rolldown-runtime-QTnfLwEv.js                0.69 kB │ gzip:  0.42 kB
dist/assets/syntax-highlighter-CUlFCbOG.js            117.47 kB │ gzip: 38.59 kB
dist/assets/index-Co89CEMj.js                         157.75 kB │ gzip: 44.94 kB
dist/assets/vendor-react-b08XxTfu.js                  182.17 kB │ gzip: 57.35 kB
dist/assets/katex-BUUS-sV2.js                         258.87 kB │ gzip: 77.46 kB
dist/assets/MarkdownDocument-C1MAK3mY.js              262.93 kB │ gzip: 82.06 kB
✓ built in 2.26s

# 变异体（节选，全部原地还原）
M1 不解回声  ⇒ AssertionError: expected <div class="reload-note" …(1)></div> to be null
M2 一律当回声 ⇒ TestingLibraryElementError: Unable to find ... Body text from elsewhere.
M3 mdlog effect 短路 ⇒ Unable to find an element with the text: /编辑已取消/
M4 覆盖层只认 activeUnit ⇒ AssertionError: expected <textarea …(3)></textarea> to be null
M5 关窗不提交 ⇒ expected "vi.fn()" to be called 1 times, but got 0 times
M6 切文档前不提交 ⇒ expected "vi.fn()" to be called with arguments: [ 'save_document', { …(2) } ]
M7 计划原样双读 ⇒ FAIL 既有用例 silently reloads the document when file-changed event fires
M8 简报字面回声用例 + 关掉抑制 ⇒ Tests 1 passed | 46 skipped  （空断言证据）

# 终态
$ git log --oneline -2
3f0b74a feat(edit): App 接线（Ctrl+E 门禁、提交落盘、回声抑制、外部变更与 mdlog 分流）
8e83ca5 feat(edit): save_document 命令（原子写 + EOL/BOM 保真 + 当前文档与 mdlog 双闸门）

$ git diff HEAD --stat          # 本任务 4 文件为空；仅剩派发前就存在的无关改动
 .pi/agents/implementer.md / reviewer-gemini.md / reviewer-qwen.md / docs/superpowers/plans/…（均未入库）
```

（`git status` 中 `.pi/agents/*` 与 `docs/superpowers/plans/2026-09-10-vellum-block-editing.md` 的改动是派发前工作区里既有的、与本任务无关的内容，**未**被 `git add`。）
