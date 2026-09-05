---
name: vellum-mdlog
description: Use when writing 对话记录 to a Vellum (vellum) mdlog live log file, or authoring a 交互块 (vellum-widget interactive widget) for 可视化讲解 of algorithms, dynamic demonstrations, or factual explanations.
---

# vellum-mdlog：实时对话记录与交互块契约

写给在 Vellum 仓库工作的 Agent：用 `/mdlog` 把对话流式写入 Markdown 日志时、以及在日志中嵌入 `vellum-widget` 交互块时，遵循本文件。

核心记忆点：**自包含**——交互块的一切（样式、脚本、状态）都封装在围栏内的单个 HTML5 文档里，不依赖宿主、网络与持久化的任何东西。

## 1. 何时输出交互块

输出 `vellum-widget` 只在这类分支：**客观事实或复杂算法的可视化讲解**——静态文本与公式难以直观传达演化过程（傅里叶级数合成、贝塞尔曲线控制点、排序算法状态机、注意力权重热力图），或用户需要拖动参数实时感受输出变化。

单次回复至多 1 个 `vellum-widget`（WebView 子帧是稀缺资源）。纯文本、表格、公式已足够表达的内容直接写 Markdown；需要联网取数的内容不属于交互块。

## 2. 交互块五大契约

### 契约 1：围栏与反引号平衡

- 围栏语言标识符逐字为 `vellum-widget`：
  ````markdown
  ```vellum-widget
  <!DOCTYPE html>
  <html lang="zh-CN">...</html>
  ```
  ````
- 内部出现连续反引号时，外层围栏反引号数 > 内部最大连续反引号数（内部有三反引号，外层就用四个）。

### 契约 2：自包含断网

围栏内是以 `<!DOCTYPE html>` 开头的完整 HTML5 文档，样式全内联、脚本全内联。宿主 CSP 为 `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`——任何外部请求（`fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / CDN 脚本样式 / 远程图片 / 外链字体）都会被拦截，工具函数与渲染逻辑全部手写内联。

### 契约 3：状态只活在内存

沙箱仅有 `sandbox="allow-scripts"`，处于 Opaque Origin：调用 `localStorage`、`sessionStorage`、`indexedDB`、`document.cookie` 会立即抛 `SecurityError` 并使整个脚本崩溃。所有交互状态（滑动条数值、播放标志、计算缓存）用 `let` / `const` 内存变量保存。

### 契约 4：kami 纸墨设计硬编码

沙箱与宿主 CSS/字体完全隔离，在 `:root` 里硬编码以下 token 并全程只引用它们：

```css
:root {
  --parchment: #f5f4ed; /* 暖纸底 */
  --ivory: #faf9f5;     /* 象牙卡片底 */
  --warm-sand: #e8e6dc; /* 深暖强调底 / 浅边框 */
  --near-black: #141413;/* 浓墨正文 */
  --dark-warm: #3d3d3a; /* 暗暖次要正文 */
  --stone: #6b6a64;     /* 弱化字 / 边框辅助 */
  --brand: #1B365D;     /* 单一靛青品牌色 */
  --hairline: #dddacc;  /* 发丝分割线 */
  --border: #e8e6dc;    /* 标准浅边框 */
}
```

- 衬线栈：`font-family: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif;`（沙箱读不到宿主字体文件，中文优雅回退系统衬线）
- 等宽栈：`font-family: "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02", "Source Han Serif SC", monospace;`
- 图标用发丝线原生 SVG 或精炼文本符号，不用 emoji；圆角 2–6px（卡片 4px）；`font-weight` ≤ 500；
- 必含 `@media (prefers-reduced-motion: reduce)` 规则关停动画与过渡。

### 契约 5：高度与标题上报

宿主按沙箱真实渲染高度平滑伸缩，沙箱必须携带此通信 IIFE（逐字照抄即可）：

```html
<script>
  (function() {
    function report() {
      const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      window.parent.postMessage({
        type: "vellum-widget:resize",
        height: h,
        title: document.title
      }, "*");
    }
    window.addEventListener("load", report);
    if (window.ResizeObserver) {
      new ResizeObserver(report).observe(document.body);
    }
  })();
</script>
```

- 消息类型逐字 `"vellum-widget:resize"`；`title` 取 `document.title`（空缺时宿主显示「交互演示」）；
- 宿主把高度夹在 `[80, 2000]` px：不足 80 按 80 渲染，超高内容在沙箱内部局部滚动。

## 3. 图片引用惯例

用工具（如 `imagen2`）生成图片后，正文直接写标准 Markdown 引用即可，路径一律带引号：

`![傅里叶合成示意图]("generated-images/fourier-series.png")`

`mdlog` 扩展会把回合内图片自动复制到日志同级 `mdlog-assets/` 并把路径改写为净文件名（`![](mdlog-assets/fourier-series.png)`）。Agent 不做重命名、搬移或 Base64 编码。

## 4. 起手模板

写交互块从模板出发：读 `assets/widget-template.html`（本技能同目录）→ 保留 `<head>` 里的 token 与字体栈、契约 5 的通信 IIFE → 替换 `<body>` 演示区与状态逻辑。

## 5. 避坑速查

| 症状 | 根因 | 修法 |
|---|---|---|
| `SecurityError: Access is denied for this document` | 调了 `localStorage` / `sessionStorage` | 状态改内存变量（契约 3） |
| 交互块渲染成普通代码块 | 围栏标识写错（`html`、`widget`…） | 标识逐字 `vellum-widget`（契约 1） |
| 高度坍缩为 0 / 不随内容伸缩 | 缺通信 IIFE 或消息类型写错 | 照抄契约 5 的 IIFE |
| 控制台报 CSP 拒绝 | 引用了 CDN / 外链 | 全部手写内联（契约 2） |
| 围栏被内部反引号提前截断 | 正文含三反引号 | 外层围栏用四个以上反引号（契约 1） |
| 排版与 Vellum 主界面割裂 | 用了无衬线体 / 字重超标 | kami token + 衬线栈，字重 ≤ 500（契约 4） |
| 出现 emoji 图标 | 违反纸墨质感 | 换 SVG 发丝线或汉字标签（契约 4） |
