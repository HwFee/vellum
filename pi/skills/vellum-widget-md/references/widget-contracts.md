# widget 契约（契约 1–7）

`vellum-widget` 围栏里那份 HTML5 文档的全部硬约束。写 widget 前通读，细节与阈值都在这里。

- 工作流（选形态 → 起草 → 自查 → 检查 → 交付）在 `SKILL.md`；契约 1–5 与 7 的可机检部分由 `tools/check-widgets.mjs` 执行，契约 6 由 `tools/svg-lint.mjs` 执行。
- 路径一律相对于技能根 `pi/skills/vellum-widget-md/`。

## 契约 1：围栏与反引号平衡

围栏语言标识符逐字为 `vellum-widget`（静态 SVG 图也用同一标识）：

````markdown
```vellum-widget
<!DOCTYPE html>
<html lang="zh-CN">...</html>
```
````

内部出现连续反引号时，外层围栏反引号数 > 内部最大连续反引号数（内部有三反引号，外层就用四个）。

## 契约 2：自包含断网

围栏内是以 `<!DOCTYPE html>` 开头的完整 HTML5 文档，样式全内联、脚本全内联。宿主 CSP 为 `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`——外部请求（`fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / CDN 脚本样式 / 远程图片 / 外链字体）全被拦截，工具函数与渲染逻辑全部手写内联。

## 契约 3：状态只活在内存

沙箱仅有 `sandbox="allow-scripts"`，处于 Opaque Origin：`localStorage`、`sessionStorage`、`indexedDB`、`document.cookie` 一碰就抛 `SecurityError` 并让整个脚本崩掉。所有交互状态（滑动条数值、播放标志、计算缓存）放 `let` / `const` 内存变量。

## 契约 4：纸墨外观与帧预算

沙箱与宿主 CSS / 字体完全隔离，在 `:root` 硬编码 kami token：

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

- **配色放宽**：背景、正文、边框、发丝线始终用 kami token；图示内容允许语义化配色——画英伟达内存架构可用黛绿 `#2F5D50` 表计算单元、赭石 `#8C5B2E` 表显存、靛青表控制链路。要求：饱和度低、与纸墨底协调、同一语义全图一致。
- **字号下限**：正文与图内标注 `font-size` ≥ 15px，图注/辅助说明 ≥ 12.5px——沙箱内文字不随宿主缩放。
- **图标用发丝线原生 SVG 或精炼文本符号，不用 emoji**；圆角 2–6px（卡片 4px）；`font-weight` ≤ 500。
- **内容不自带外框**：宿主已为每个交互块画了双细线书札框，`<body>` 用 `background: var(--ivory)` 通铺、`padding: 12–16px` 作内容边距即可；不要包一层带边框/底色的卡片 div，否则出现「灰夹白」三层框。
- **字体栈照抄模板** `:root` 的 `--font-serif` / `--font-mono`（沙箱读不到宿主字体文件，中文优雅回退系统衬线）。
- 必含 `@media (prefers-reduced-motion: reduce)` 关停动画与过渡。**动画有帧预算**：真机实测（合成样本、240Hz 屏）一个视口内的动画 widget 可稳定吃掉 **0.4 核 CPU**，全部停帧后降到 9ms/s——成本就在「看得见的动画」本身。① 优先 CSS `@keyframes` / `transition`（合成器侧，成本低）；② 必须用 rAF 时按 **≥33ms（≈30fps）** 节流，别每帧重绘大 canvas（成本 ∝ 像素数 × 帧率）；③ 动画区域尽量小。宿主会自动停掉离屏 widget 的渲染，所以不必自己判断可见性，但也别指望「反正离屏不跑」——widget 一进视口成本就开始算。

## 契约 5：高度与标题上报

宿主按沙箱真实渲染高度平滑伸缩，沙箱必须携带此通信 IIFE（协议常量以 `assets/widget-template.html` 为准，逐字照抄）：

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

- 消息类型逐字 `"vellum-widget:resize"`；`title` 取 `document.title`（空缺时宿主显示「交互演示」）。
- 宿主把高度夹在 `[80, 6000]` px：不足 80 按 80 渲染，超 6000 按 6000 渲染（runaway 防护）。
- **宿主注入根溢出保护（`html{overflow:hidden !important}`），沙箱根文档永不成为滚动盒**。2026-09-11 真机 CDP 实测：子帧内只要有几 px 可滚动余量，滚轮手势就被 Chromium scroll-latch **整段**锁进子帧，且跨帧不做手势续滚——指针停在 widget 上时宿主页面完全滚不动（仅有 8px 余量、请求滚动 1200px，宿主位移 0）。所以 widget 按一屏内可读设计；确实需要内部滚动就自备内层容器（`div{height:260px;overflow-y:auto}`），并知道指针停在该容器上时那一段手势归它。
- **canvas 必随宽重绘**：位图缓冲不随 CSS 拉伸，窗口或正文列变宽时元素变宽但画面模糊走样。监听 `window` 的 `resize`，按新 `clientWidth` 重设 `canvas.width/height` 并重绘（模板的 `resizeCanvas` + `draw` 就是范式）。

## 契约 6：静态 SVG 布局防重叠

静态 SVG 图最常见的事故是**文字与框线重叠 / 溢出**（框装不下字、标签压在边框线上、连线穿过文字）。以下全部强制；工作流见 `SKILL.md`。

1. **文本宽度估算**：中文每字 ≈ `1.0 × font-size`，英文/数字/符号每字符 ≈ `0.55 × font-size`。矩形框宽 ≥ 最长行估算宽 + 左右各 ≥ 12px 内边距；装不下就加宽框或缩短文案。
2. **框内文字必居中**：`text-anchor="middle"` 且 `x` 取框中心；多行按行高逐行排，行距 ≥ 1.5 倍字号。
3. **边线上的标签徽章**（如「Encoder × N」这类骑线标签）：先垫一块与底色同色的实底矩形再放文字，或整体错开边线。
4. **小尺寸图元的标签放形外**：宽不足 **56px** 的小方块/圆/菱形（如状态矩阵 `S`、小算子节点），名称与尺寸标注一律放图形外侧（下方/右侧邻位，或引线拉出）；框内最多留一个大字字符。
5. **连线走沟槽**：框与框之间留 ≥ 24px 沟槽，箭头与折线只走沟槽；回路/虚线沿外围绕行，不穿框不压字。
6. **viewBox 预留**：按内容总高 + 上下各 ≥ 16px 定高，不裁切任何元素；长标题放不下就换行，不与旁边元素争位。

## 契约 7：宿主生命周期与授权

这些由宿主决定，widget 作者只需知道后果。

- **授权**：mdlog 日志文档（头部带 `mdlog:v1`）里的 widget 自动挂载；其他任何 `.md` 里，每个 widget 首次停在「交互内容 · 点击加载」占位块，用户点一次才运行。同一份内容（按源码指纹）点过一次，跨文档与重启都记住；同一文档里**不同的**块各点一次。交付非 mdlog 文档时要告诉用户。
- **存活上限**：全局最多 10 个存活 iframe，超出按 LRU 休眠，已授权的块滑回视野自动恢复。休眠会丢掉 widget 的内存状态（回到默认态），所以别把「只能做一次」的进度放在 widget 里。
- **体积**：围栏内 HTML 超 512KB 降级成代码块。
- **静态/交互判定**：通信 IIFE 之外只要有脚本、`on*=` 处理器、表单控件、`<canvas>`、`<a href>`，宿主就按交互块处理（放行指针）；纯 SVG 图是静态块（iframe 不接指针，滚轮直接落在正文上）。静态图的 `<script>` 里除通信 IIFE 外不要放任何东西，注释也放在 `<script>` 之外。
- **离屏停帧**：离开视窗的 widget 被 `visibility:hidden` 停帧，rAF 与 CSS 动画都停；回来继续。别用 `display:none` 一类手段自己判断可见性。
