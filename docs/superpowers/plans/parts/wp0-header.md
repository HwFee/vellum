# Pi 对话实时记录（mdlog）与沙箱交互块 · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pi 扩展把用户与 Agent 的对话实时追加写入 Markdown 文件，Vellum 复用文件监听热重载管线渲染记录，并用沙箱 iframe 渲染 `vellum-widget` 自包含 HTML 交互块。

**Architecture:** 「MD 文件即真相」——pi 全局扩展 `mdlog` 负责格式化与追加写入（含图片资产复制、心跳 sidecar、智能追加续写）；Vellum 仅监听文件系统：日志文件变更触发静默热重载，sidecar 驱动「记录中」徽章，`vellum-widget` 围栏块经 Rust 自定义协议（`http://vellum-widget.localhost`）注册后在 `sandbox="allow-scripts"` iframe 中渲染。进程间无任何直接连接。

**Tech Stack:** Tauri 2（Rust / windows-sys / notify）· React 19 + TypeScript + Vite 8 · react-markdown 10 · pi 扩展 API（TypeScript，jiti 加载）· Vitest + Testing Library · cargo test。

**Spec:** `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md`（v3，唯一事实来源；每个 Task 的细化要求以 spec 对应章节为准）

**设计预览（CSS 唯一真源）:** `docs/preview/mdlog-preview.html`

## Global Constraints

每个 Task 的要求都隐含包含本节全部约束：

- 平台仅 Windows 10/11 x64；不得引入 macOS/Linux 分支逻辑（协议 URL 生成等平台差异点除外，按 spec 写明的方式处理）。
- 风格合规：全链路无 emoji；新增 CSS 只允许使用 kami.css `:root` 已声明变量，圆角 ∈ {0, 1px, 2px, 3px, 4px, 6px}，字重 ≤ 500，不引入第二种强调色/渐变/深色模式。
- 性能死规则（AGENTS.md）：`CodeBlock.tsx` 禁止切回 PrismAsyncLight；`MarkdownDocument.tsx` 的 memo 结构与 props 引用稳定约束不可破坏；`components` 必须是 useMemo 结果（依赖仅 `[resolveHeadingId, isTrustedMdlog]`）；`search-match--current` 仍由 layout effect 维护；katex 保持在 rehype 管线末尾。
- widget 契约硬数值：单条 HTML ≤ 512KB；注册表 ≤ 64 条 LRU；存活 iframe ≤ 10；iframe 高度 clamp [80, 2000]px；懒挂载 rootMargin 200px；滚动稳定 400ms 后才允许淘汰挂载；休眠项仅点击复活。
- 语言提取正则改为 `/language-([\w-]+)/`；widget 围栏语言名逐字为 `vellum-widget`。
- 协议与安全：iframe `sandbox="allow-scripts"`（严禁 allow-same-origin）；widget 响应必带 4 条头（Content-Type: text/html; charset=utf-8 · CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:` · X-Content-Type-Options: nosniff · Cache-Control: no-store）；404 响应同样带 CSP；CSP 仅追加 `frame-src http://vellum-widget.localhost`。
- pi 扩展纪律：事件 handler 内严禁 await 写入/复制（登记 + setTimeout 调度 + 串行 Promise 链）；心跳 setInterval 30s 写 `heartbeatAt`；I/O 错误就地指数退避 50/150/300ms。
- 测试基线时刻全绿：前端 `npm test` 17 文件 / 175 用例；后端 `cargo test` 15 用例。每个 Task 以 commit 收尾，提交前必须两套全绿。
- TDD：每个 Task 先写失败测试再实现；测试代码与实现代码都必须是可直接运行的真实代码。
- 包边界：包 1（Rust）→ 包 2/3（前端）→ 包 4（pi 扩展）→ 包 5（技能与文档）；跨包契约以各 Task 的 Interfaces 段为准，逐字一致。

---
