---
name: vellum-mdlog
description: >-
  Use for every response whenever the system prompt announces "mdlog live log: CONNECTED"
  (a Vellum mdlog connection is active; replies stream verbatim into the linked Markdown
  document), and whenever a diagram, flowchart, architecture sketch, or interactive visual
  would explain more intuitively than plain text — any scenario, unprompted. Covers
  vellum-widget blocks, static SVG figures, mdlog formatting rules, kami design tokens.
---

# vellum-mdlog：实时对话记录与交互块契约

写给在 Vellum 仓库工作的 Agent。核心记忆点：**自包含**——交互块的一切（样式、脚本、状态）都封装在围栏内的单个 HTML5 文档里，不依赖宿主、网络与持久化的任何东西。

## 1. 触发判定：连接即生效

系统提示出现 `## mdlog live log: CONNECTED` 区块时（mdlog 扩展在连接期间逐回合注入，断开即消失），本技能对**每一条回复**强制生效：正文会被逐字写入所连接的 Markdown 文档并由 Vellum 实时渲染，禁令与契约全部适用，不等用户开口。该状态不存在时，按一般标准适用：图比文字更快建立直觉就画。

## 2. 硬性禁令（违反即返工，无例外）

1. **正文禁止 Markdown 引用块**（`>` 开头的 blockquote）。mdlog 里引用块是**用户回合的专用形态**——宿主会给它点朱红章、加顶线，你一用它就被误当成用户发言。需要引用、注记、强调时，用加粗段首（如 `**注**：…`）、普通段落或列表。用户回合的引用块由扩展自动写入，不归你管。
2. **禁止 ASCII / Unicode 字符画**。用代码块（` ```text ` 等）画方框、箭头、流程、架构示意，一律禁止——在纸墨排版里它们是等宽灰块，丑且不可读。**「ASCII 进度条 / 占比条」同样是字符画**：

   ````text
   [================ 40% Agentic Trajectory ================]
   [============ 30% Multi-Turn Tool Chaining ============]
   ````

   这类写法是重灾区——模型容易把「数据分布」当成文字清单顺手排成字符条。看到百分比、权重、占比，手就别碰代码围栏，直接画水平条形 SVG。任何结构、流程、对比、架构关系、数据分布，一律用 ` ```vellum-widget ` 静态 SVG 图（契约 6）。代码块只放真正的代码。
3. **图解优先：结构、流程、对比、架构、时序、因果，以及数据分布、占比/权重、数值比较、排名/榜单，一律用 `vellum-widget` 图承载，禁止用成段文字或字符画讲解它们**。正文文字只剩三种合法形态：图的引子（图前一两句，不复述图中内容）、图注、以及图表达不了的内容（精确定义、公式推导、代码、一句话结论）。自检两道：① 逐段过正文，凡能用图表达的解释性段落，成图或删除；② **输出任何 ` ``` ` 围栏前自问「围栏里装的是代码还是类图」**——只要是用字符排出的图（方框、箭头、进度条、占比条、表格化伪图），就必须改成 `vellum-widget`，没有例外。

> **强调定界符写法——可移植性建议（非禁令，宿主已软件兜底）**：Vellum 渲染层已内置 `remark-cjk-friendly`（含 GFM 删除线变体），`**` / `~~` 一侧贴标点（`)`、`」` 等）、另一侧贴汉字也能正确渲染为强调，且有渲染级回归测试锁定——在 Vellum 里怎么写都不会出现字面 `**`。但同一份 md 拿到 GitHub / VS Code 等严格 CommonMark 渲染器下，`**记忆腐化(Memory Rot)**是` 这类「定界符跨汉字+括号交界」的写法仍会原样输出星号。想让日志脱离 Vellum 也体面，就让定界符两侧都贴汉字/字母/数字：写 `**记忆腐化**(Memory Rot)是…`，不写 `**记忆腐化(Memory Rot)**是…`。`__` 内嵌下划线不受插件放宽，始终别用。

## 3. 对话纪律：过程静默

正文会被**逐字**写入日志并渲染给用户看：

- **作图、校验、探索、重试的过程不产生任何正文**——只进内部思考与工具调用（「我先看一下项目结构」「图已生成，路径是…」都禁止）。
- 最终回复只写**结果性内容**：图示 + 精练串讲。
- 日志文件由扩展维护：不写标题、不手写回合结构、不关心指纹与锚点——只输出干净的正文与图示。

## 4. 形态选择：静态优先，交互按需

禁令 3 定了什么必须成图，本节定画成什么样：

- **静态 SVG 是默认形态**：流程图、架构图、关系框图、**占比/分布图（水平条形为主）**——方框加连线、条块加标注能讲清的，一律静态（同样放 `vellum-widget` 围栏，无交互逻辑，只有图）。
- **交互只在静态确实表达不了时加**：演化过程或参数探索（傅里叶级数逐阶合成、贝塞尔控制点拖动、排序状态机步进）。用户明确要求交互演示时例外。
- **一张装不下就拆多张**：每张聚焦一个层面（整体分层 / 数据流 / 关键链路时序），图注标明焦点。单次回复静态图可到 2–3 个围栏；**交互式至多 1 个**（WebView 子帧是稀缺资源）。
- **清晰优先**：层次、标注、数据流向、关键细节该画全就画全，不为「简略」砍重点。
- 纯文本、表格、公式已足够表达的内容直接写 Markdown；需要联网取数的内容不属于交互块。

## 5. 交互块契约

### 契约 1：围栏与反引号平衡

- 围栏语言标识符逐字为 `vellum-widget`（静态 SVG 图也用同一标识）：
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

### 契约 4：kami 基调 + 语义化配色 + 字号下限

沙箱与宿主 CSS/字体完全隔离，在 `:root` 里硬编码以下 token 作为基调：

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

- **配色放宽**：背景、正文、边框、发丝线始终用 kami token；但**图示内容允许语义化配色**——例如画英伟达内存架构时可用黛绿 `#2F5D50` 表计算单元、赭石 `#8C5B2E` 表显存、靛青表控制链路。要求：饱和度低、与纸墨底协调、同一语义全图一致。
- **字号下限**：正文与图内标注 `font-size` ≥ 15px，图注/辅助说明 ≥ 12.5px——沙箱内文字不随宿主缩放，过小会看不清。
- **内容不自带外框**：宿主已为每个交互块画了双细线书札框，widget 的 `<body>` 用 `background: var(--ivory)` 通铺、`padding: 12–16px` 作内容边距即可；**禁止**再包一层带边框/底色的卡片 div——会出现「灰夹白」三层框。
- 衬线栈（与正文同栈，内外一致）：`font-family: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif;`（沙箱读不到宿主字体文件，中文优雅回退系统衬线）
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
- **canvas 必随宽重绘**：`canvas` 的位图缓冲不随 CSS 拉伸——窗口/正文列变宽时元素变宽但画面模糊走样。必须监听 `window` 的 `resize`，按新 `clientWidth` 重设 `canvas.width/height` 并重绘（模板 §2 的 `resizeCanvas` + `draw` 就是范式）。

### 契约 6：SVG 布局防重叠（静态图必守）

静态 SVG 图最常见的事故是**文字与框线重叠/溢出**（框装不下文字、标签压在边框线上、连线穿过文字）。以下全部强制：

1. **文本宽度估算**：中文每字 ≈ `1.0 × font-size`，英文/数字/符号每字符 ≈ `0.55 × font-size`。矩形框宽度 ≥ 最长行估算宽度 + 左右各 ≥ 12px 内边距；装不下就加宽框或缩短文案。
2. **框内文字必居中**：`text-anchor="middle"` 且 `x` 取框中心；多行文字按行高逐行排，行距 ≥ 1.5 倍字号。
3. **边线上的标签徽章**（如「Encoder × N」这类骑线标签）：先垫一块与底色同色的实底矩形再放文字，或整体错开边线。
4. **小尺寸图元的标签放形外**：宽不足 **56px** 的小方块/圆/菱形（如状态矩阵 `S`、小算子节点），其名称与尺寸标注**一律放在图形外侧**（下方/右侧邻位，或引线拉出）。小框内最多一个大字字符（如 `S`），其余文字移到框外并在视觉上保持邻接。
5. **连线走沟槽**：框与框之间留 ≥ 24px 沟槽，箭头与折线只走沟槽；回路/虚线沿外围绕行，不穿框不压字。
6. **viewBox 预留**：按内容总高 + 上下各 ≥ 16px 定高，不裁切任何元素；长标题放不下就换行，不与旁边元素争位。
7. **出图流程（静态图必走，全程静默、不产生正文）**：
   a. **起草**：把包含 SVG 的完整 HTML 写入临时文件（Git Bash 下如 `/tmp/vellum-widget-draft.html`）；多张图放进同一草稿即可，工具会按 `svg#N` 分别报告；
   b. **自查（先语义后几何）**：对照渲染想象图逐项过——箭头指向与数据流向是否正确、标签有无歧义、重点是否突出；几何上逐框查字超框、逐字查重叠、逐标签查骑线、逐连线查穿字；发现问题直接改草稿；
   c. **静态检查兜底**：跑 `node .pi/skills/vellum-mdlog/tools/svg-lint.mjs <草稿路径>`。**错误**（exit 1）必须修到全过；**警告**逐条确认——确属刻意设计（如图注字号 12.5px）可保留，否则修掉。修复若动了语义，回到 b 快速复查一遍；
   d. 全部通过后才把 HTML 写进正文围栏输出，并删除临时文件。

## 6. 图片引用惯例

用工具（如 `imagen2`）生成图片后，正文直接写标准 Markdown 引用即可，路径一律带引号：

`![傅里叶合成示意图]("generated-images/fourier-series.png")`

`mdlog` 扩展会把回合内图片自动复制到日志同级 `mdlog-assets/` 并把路径改写为净文件名（`![](mdlog-assets/fourier-series.png)`）。Agent 不做重命名、搬移或 Base64 编码。

## 7. 起手模板

写交互块或静态图示从模板出发：读 `assets/widget-template.html`（本技能同目录）→ 保留 `<head>` 里的 token 与字体栈、契约 5 的通信 IIFE → 替换 `<body>` 演示区与状态逻辑。静态图删掉交互脚本，只留 SVG 与图注。

## 8. 避坑速查

| 症状 | 根因 | 修法 |
|---|---|---|
| 大段文字讲解结构/流程/对比 | 文字抢了图的活 | 成图承载，文字只做引子与串讲（禁令 3） |
| 用 ` ```text ` 排了占比条/进度条（`[==== 40% ====]`） | 把「数据分布/占比」当成了文字清单 | 分布、占比、权重、排名也是图：水平条形 SVG（禁令 2/3） |
| 日志里出现过程碎碎念 | 把探索/校验写成了正文 | 过程只进思考与工具调用（§3） |
| 正文引用块被点上朱红章 | blockquote 是用户回合专用 | 改用加粗段首或普通段落（禁令 1） |
| 在 Vellum 外（GitHub/VS Code）渲染出字面 `**` / `~~` | 定界符跨「汉字+括号」交界，严格 CommonMark 判为普通字符（Vellum 内已由 remark-cjk-friendly 兼容） | 粗体停在汉字上、括号注释放粗外（§2 可移植性建议） |
| 出现字符画灰块 | 用代码块画了图 | 改画 vellum-widget 静态 SVG（禁令 2） |
| `SecurityError: Access is denied for this document` | 调了 `localStorage` / `sessionStorage` | 状态改内存变量（契约 3） |
| 交互块渲染成普通代码块 | 围栏标识写错（`html`、`widget`…） | 标识逐字 `vellum-widget`（契约 1） |
| 高度坍缩为 0 / 不随内容伸缩 | 缺通信 IIFE 或消息类型写错 | 照抄契约 5 的 IIFE |
| 控制台报 CSP 拒绝 | 引用了 CDN / 外链 | 全部手写内联（契约 2） |
| 围栏被内部反引号提前截断 | 正文含三反引号 | 外层围栏用四个以上反引号（契约 1） |
| 图内文字太小看不清 | 字号低于下限 | 正文标注 ≥ 15px，图注 ≥ 12.5px（契约 4） |
| 排版与 Vellum 主界面割裂 | 用了无衬线体 / 字重超标 | kami token + 衬线栈，字重 ≤ 500（契约 4） |
| 图内文字与框重叠/溢出 | 跳过出图流程直接输出 | 契约 6 第 7 条：自查 + `svg-lint.mjs` 修到 exit 0 |
| 小方块的标注骑压边框 | 小图元硬塞多行文字 | 宽 <56px 图元标签一律放形外（契约 6 第 4 条） |
| 出现 emoji 图标 | 违反纸墨质感 | 换 SVG 发丝线或汉字标签（契约 4） |
