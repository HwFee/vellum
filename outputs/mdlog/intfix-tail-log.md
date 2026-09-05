# Vellum 集成修复批尾款轮实施日志 (Integration Tail Fix Log)

- **基线提交**：`3ae47d1`
- **实施准则**：遵循 TDD 红绿循环（Red-Green-Refactor）、`verification-before-completion`、AGENTS.md 性能红线与 DESIGN.md kami 纸墨规范。
- **目标清单**：F1 至 F13（包含 A1-A3、C1-C5、C7-C9、P11、P13 与相关工程化收尾）。

---

## 1. 提交清单 (Semantic Commit Log)

*待执行与记录*

---

## 2. 逐项实施记录与 TDD 红绿证据

### F1（A1，安全竞态）WidgetSandbox 授权绑定内容键
- **问题与根因**：P2 复位逻辑在 `useLayoutEffect` 中执行，但挂载仲裁 effect 在提交帧执行时读取到了旧闭包状态（`isUserActivated=true`）。当 `register_widget` IPC 存在数十毫秒延迟时，快速切换到新文档 Y 会触发未经授权的 `invoke("register_widget", { html: Y })`，造成约一个 IPC RTT 的越权注册窗口；同时在提交帧上 DOM 会短暂存留上一文档的 iframe。
- **修法**：方案 (b) 授权绑定内容键。
  1. 引入 `activatedForHtmlRef = useRef<string | null>(autoMount ? html : null)`，在用户手动点击占位块授权及 autoMount 受信路径同步赋值为当前 `html`；
  2. 在 `html` 或 `autoMount` 变化复位分支中重置该 ref 为 `autoMount ? html : null`，并在渲染期同步兜底清空；
  3. 仲裁条件改为 `const isAuthorized = autoMount || activatedForHtmlRef.current === html; const shouldMount = isAuthorized && !isDormant;`，利用 ref 实时读取避免提交帧闭包；
  4. 渲染期占位块分支以 `!isAuthorized` 判断，避免提交帧存活陈旧 iframe。
- **Red 证据**：
  ```
  FAIL  src/components/WidgetSandbox.test.tsx > WidgetSandbox > F1/A1: does not register new html without authorization when register_widget is in flight during document switch
  AssertionError: expected [ '<div>x1</div>', '<div>y1</div>' ] to deeply equal [ '<div>x1</div>' ]
  - Expected
  + Received
    [
      "<div>x1</div>",
  +   "<div>y1</div>",
    ]
  ```
- **Green 证据**：
  ```
  Test Files  1 passed (1)
  Tests  8 passed (8)
  ```
- **状态**：已完成。

### F2（A2，死代码清理）src-tauri/src/main.rs 删除 should_rebind
- **问题与根因**：P8 拆分中保留的 `should_rebind` 成为仅测试引用的包装函数，生产路径零调用，导致 `cargo check` 产生 `warning: function should_rebind is never used` 死代码警告。
- **修法**：删除 `src-tauri/src/main.rs:242` 的 `should_rebind` 定义与测试导入；测试矩阵中的 4 处断言直接使用 `should_clear_registry`。
- **Red 证据**：
  ```
  warning: function `should_rebind` is never used
     --> src\main.rs:242:4
      |
  242 | fn should_rebind(current: Option<&PathBuf>, next: &Path) -> bool {
      |    ^^^^^^^^^^^^^
  ```
- **Green 证据**：
  `cargo check` 输出零警告；`cargo test` 42 passed (vellum_lib 35, main.rs 7)。
- **状态**：已完成。

### F3（A3，守卫断言补全）3ae47d1 守卫回归测试
- **问题与根因**：commit `3ae47d1` 新增的「实例复用时复位 widget 标题/高度」和「`:active` 抵消 1px 下沉」属于关键守卫逻辑，但先前测试集未对其进行断言，存在未来重构静默丢失的风险。
- **修法**：
  1. `WidgetSandbox.test.tsx`：P2 区域新增用例，通过 postMessage 将标题设为自定义值、高度设为 750px 后变更 `html`，断言顶栏标题与 iframe title 均重置回默认「交互演示」、高度重置为 240px。通过变异注释复位代码获得真实红灯。
  2. `kami.css.test.ts`：追加断言匹配 `.mdlog-widget__placeholder:active` 包含 `transform: none`。通过在 CSS 中删除规则获得真实红灯。
- **Red 证据**：
  - WidgetSandbox 变异红灯：`TestingLibraryElementError: Unable to find an element with the title: 交互演示.`
  - kami.css 变异红灯：`AssertionError: expected '.markdown-body .mdlog-widget__placeholder:active { ... }' to match /transform:\s*none/`
- **Green 证据**：
  - `WidgetSandbox.test.tsx` 9 passed
  - `kami.css.test.ts` 26 passed
- **状态**：已完成。

### F4（C1+C5，并发与授权语义注释）
- **说明**：
  1. `src/components/WidgetSandbox.tsx`（C1）：明确注释安全门禁以 html 字符串为键：同一份 widget 内容只需授权一次。通过 ref 在仲裁 effect 执行期实时读取，规避 React 提交帧闭包导致的旧授权在途越权注册竞态。
  2. `src/components/MarkdownDocument.tsx`（C5）：在 `useHeadingIdResolver` 处写明不变量约束——`resolveHeadingId` 必须且仅允许在渲染期同步调用（如 `components.h1/h2/h3`）。严禁在事件回调或 effect 中调用，避免 React 19 并发渲染 pass 废弃/重放时产生可观测的 tearing。
- **状态**：已完成（纯注释规范，不改变现有行为）。

### F5（C2，占位块可交互性与可访问性语义拆分）
- **问题与根因**：loading 态的非交互 `<div>`（`交互准备中…`）与可交互 `<button>`（授权/休眠占位块）共用 `.mdlog-widget__placeholder`，使非交互 div 错误继承了 `cursor: pointer` 及 `:hover` 的颜色反馈，破坏了可访问性与用户预期。
- **修法**：
  1. `src/styles/kami.css`：将 `cursor: pointer`、`:hover`、`:focus-visible` 及 `:active` 样式限定到 `button.mdlog-widget__placeholder`，div 仅保留容器尺寸与背景等非交互样式；
  2. `src/styles/kami.css.test.ts`：追加规则文本正则断言，验证 `button.mdlog-widget__placeholder` 独占 cursor 与交互伪类。
- **Red/Green 证据**：先改测试导致红灯（`AssertionError: expected '' to match /cursor:\s*pointer/`），CSS 实现后 27 测试全绿。
- **状态**：已完成。

### F6（C3，kami.css 真级联 computed-style 断言升级）
- **问题与根因**：原有选择器出现顺序断言（`placeholderIndex > buttonIndex`）在选择器被意外削弱时仍为真，判别力较弱。
- **修法**：在 `src/styles/kami.css.test.ts` 中通过在 jsdom 注入完整 `kami.css` `<style>`，对挂载在 `.markdown-body` 下的 `button` 与 `div` 占位块分别读取 `window.getComputedStyle`，断言 `minHeight: 120px`、`borderRadius: 0px`、`boxShadow: none`、`fontWeight: 500`、`width: 100%`、`padding: 24px`、`display: flex`、`cursor: pointer / not pointer`（避开 jsdom 无法归一的 border-top 假红）。
- **Red/Green 证据**：通过变异将占位块 minHeight 改为 32px 触发真实失败（`AssertionError: expected '32px' to be '120px'`），恢复后全绿。
- **状态**：已完成。

### F7（C4，WidgetSandbox autoMount true→false 名实相符补测）
- **问题与根因**：`WidgetSandbox.test.tsx` 中测试用例名承诺覆盖「html changes or autoMount flips to false」，但先前用例中仅 rerender 了 html，缺少 autoMount 由 true 翻为 false 的分支断言。
- **修法**：在用例末尾追加第 3 阶段：先以 `autoMount={true}` 挂载并加载 iframe，随后 rerender 传入相同 html 但 `autoMount={false}`，断言触发 `unregister_widget` 并回到未授权占位块态。通过变异使 `autoMountFlippedFalse = false` 成功捕获 Red 失败。
- **Red/Green 证据**：变异时抛出 `AssertionError: expected "vi.fn()" to be called with arguments: [ 'unregister_widget', { id: "w-automount" } ]`；恢复后全绿。
- **状态**：已完成。

### F8（C7，App 同路径重开热重载保活 iframe）
- **状态**：待开始

### F9（C8，Rust main.rs apply_rebind 入参同源消除分叉）
- **问题与根因**：`path_changed` 判定在 `load_document` 调度点与 `apply_rebind` 内部各计算一次，存在判定逻辑未来可能分叉的隐患。
- **修法**：将 `apply_rebind` 签名变更为 `fn apply_rebind(registry: &mut WidgetRegistry, current: &mut Option<PathBuf>, next: &Path, path_changed: bool) -> bool`，调用点直接传入一次性求值结果，消除内部重判分叉。
- **Red/Green 证据**：修改签名后更新相关调用方与单元测试，`cargo check` 0 警告，`cargo test` 42 全绿。
- **状态**：已完成。

### F10（P11，widgetRegistry dispose 清理机制与单测）
- **状态**：待开始

### F11（P13，CustomScrollbar 拖拽派发事件打断落位守护）
- **状态**：待开始

### F12（语言标识统一与 vitest exclude outputs/**）
- **状态**：待开始

### F13（C9，订正 integration-fix-log.md 历史记录）
- **状态**：待开始

---

## 3. 最终全局验证矩阵

*待执行全量验证后填写*
