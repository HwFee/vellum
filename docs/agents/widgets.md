# mdlog、widget 沙箱与交互块

`AGENTS.md` 的详情分册。收录 `WidgetSandbox` 的存活上限与休眠、沙箱根溢出保护（scroll-latch 正面修复）、交互块授权台账、离屏停帧降载、静态 widget 的指针防线、高度夹取、预载视距、`read_mdlog_state` 归一、残留 sidecar 清理，以及 kami.css 的 mdlog 区段约束。

## WidgetSandbox 存活上限与懒挂载

- `WidgetSandbox` 组件必须严格实施 `React.memo` 与全局最多 10 个存活 iframe LRU 休眠机制。
- 沙箱必须懒挂载；追加写入触发整篇重载时已有 iframe 必须保持位置稳定。
- 严禁未经 memo 或频繁重建导致 WebView 子帧暴涨与交互状态丢失。

## 沙箱根溢出保护（scroll-latch 的正面修复）

- `widget.rs` 的 `WIDGET_ROOT_SCROLL_GUARD` / `inject_root_scroll_guard` 给每个 widget 响应注入 `<style>html{overflow:hidden !important}</style>`。
- 根因：跨源子帧只要有几 px 可滚余量，滚轮手势就会被 Chromium scroll-latch **整段**吞掉且跨帧不续滚（「指针在 widget 上滚不动」的根因）。
- 不可回退 ①：出网前注入（`build_widget_response`，`WidgetRegistry` 保持纯存储）。
- 不可回退 ②：样式必须落在文档内部（越过 `<!DOCTYPE` 会退回 quirks 模式）。
- 不可回退 ③：只作用 `html`、不碰 `body`（`body{height:100vh;overflow:auto}` 是合法自滚动形态）。
- 实测数据见 `CHANGELOG.md` 未发布段，探针与踩坑见 `scripts/cdp-perf-scroll.mjs` 头部注释。

## 交互块授权（三源 + 落盘台账，`widgetTrust.ts`）

- a) `autoMount`（mdlog 日志文档）。
- b) `trustedWidgets` 台账——按 **widget 源码指纹**（cyrb53 + 长度前缀）记住用户点过 `[点击加载]` 的内容，写入共享 settings Store（上限 300、FIFO；Store 失败退 localStorage），渲染期用 `useSyncExternalStore` 同步判定。
- c) 本会话 ref。
- **同一份内容只需点一次**（跨文档重开与重启应用都有效）；同一文档里*不同的*交互块仍需各自点一次。
- 已授权的块被 LRU 休眠后**滑回视野自动 `activate`**（休眠只是「全局最多 10 个存活 iframe」的内存闸门，不该让人点第二次）。
- **未授权**的块一律停在占位块，门禁不得放宽。
- 上限是**稳态**约束：自动恢复会让存活数在滚动/高度上报期间**短暂超过 10**（淘汰只在滚动静默 400ms 后跑一轮，且 `isScrolling` 期间不淘汰），静默后收敛回 10。
- 真机实测（21 块文档）：滑到底部 3s 后 `frames=10`，滑回顶部首个块自动恢复且仍未超过 10。

## 离屏停帧降载与静态 widget 指针防线

- **离屏 widget 停帧降载**：`WidgetSandbox` 的「渲染窗」观察器双向切 `--parked` = `visibility: hidden`，是跨源沙箱唯一可用的宿主侧降载手段。
  - `PARK_ROOT_MARGIN` **必须严格大于预载视距**，否则滑到前会出现空框。
  - **禁止改成 `display:none`**（布局高塌成 0、顶动整篇，已由 `kami.css.test.ts` 锁死）。
  - 视口内动画的固有成本（跨源，宿主无权干预）由 widget 契约的帧预算约束。
- **静态 widget 的 iframe 仍必须带 `mdlog-widget__frame--static`（`pointer-events: none`）**：根溢出保护已覆盖交互 widget，这个类作为静态图的纵深防线保留（静态图不需要指针，穿透后连 hover 都不抢）。
  - 交互性由 `widgetInteractivity.ts` 保守判定（通信 IIFE 之外有脚本/控件/链接/canvas 才算交互），宁可多放行也不错杀；别给静态图去掉这个类。

## 预载视距与高度夹取

- widget 预载视距为上 400px / 下 1200px（滑到前 iframe 已渲染完毕，不再闪）。
- iframe 首个 resize 上报（或 load 后 500ms 兑底）前保持透明、就绪后淡入，高度变化走 CSS 过渡。
- 不要把 rootMargin 改回小值，也不要去掉 `--ready` 淡入门禁。
- 高度夹取 `[80, 6000]` px（不是 2000）：根文档禁滚后，夹取过紧等于直接裁掉高内容，别改回。

## mdlog 状态与吸底

- `read_mdlog_state` 的返回值必须 `?? null` 归一后再入 state：后端抖动给出 `undefined` 时 `undefined !== null` 会被误判为记录中，静默禁用吸底与热重载印章。
- mdlog 记录期间模型追加触发的热重载**禁止吸底跟随**（用户停在哪儿就保持在哪儿）。
- 仅非记录态且距底 ≤80px 的热重载才吸底。

## 残留 `.mdlog` sidecar 自动清理

- `read_mdlog_state` 命令层在判定记录死亡（pid 死 或 心跳超时且非时钟回拨）后 best-effort 删除 sidecar 文件（`should_cleanup_stale_sidecar` / `cleanup_stale_sidecar_if_dead`）。
- `read_mdlog_state_from_path` 保持纯函数无副作用。
- pi 扩展侧 `session_start` 的 sessionId 不匹配分支也会对 pid 已死的 sidecar 做同样清理。

## kami.css 的 mdlog 区段约束

- 约束测试以**首个 `.mdlog-widget` 出现处**起扫描到文件尾。
- 新规则只要含 `.mdlog-widget` 字样就必须放在该出现位置之后，否则无关区段会被卷入扫描。

## 文件索引

| 文件 | 职责 |
|------|------|
| `src/lib/widgetTrust.ts` | 交互块信任台账（按源码指纹落盘，点一次即可） |
