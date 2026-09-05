# 工作包 5：技能与文档（wp5-skill-docs）

> **章节说明**：本章为 Vellum 实时对话日志系统（`mdlog`）实现计划的第 5 部分，聚焦于项目专属技能 `.pi/skills/vellum-mdlog` 的规范制定、交互块自包含标准骨架模板 `assets/widget-template.html` 的落地，以及项目根规约 `AGENTS.md` 的基线与规则订正。本计划严格依照设计文档 `docs/superpowers/specs/2026-09-05-pi-mdlog-live-log-design.md` §5、§9 与 §10 撰写，确保实施子智能体遵循 TDD 闭环（Red-Green-Refactor）与零二义性字面执行。

---

### Task 5.1: `AGENTS.md` 规约订正与测试基线更新

**Files:**
- Modify: `AGENTS.md:19-21, 24-54, 76-80`
- Test: `scripts/verify-agents-md.mjs`

**Interfaces:**
- Consumes:
  - spec §9.1 实测测试基线（Vitest 17 文件 / 175 用例；Cargo 15 用例全部通过）
  - spec §10 与 §12（审核决议 D1、D17、D20，更新测试基线、增补项目专属技能真实目录例外、记录 WidgetSandbox 性能与连字符语言提取死规则）
- Produces:
  - 订正后的项目根指导文件 `AGENTS.md`，作为后续所有工作包与协同 Agent 的唯一真源，防止后续 Agent 误执行 `mv` 将项目专属技能移入全局仓库，并防止性能约束被回退。

- [ ] **Step 1: Write the failing test**

创建脚本 `scripts/verify-agents-md.mjs`，以自动化断言约束 `AGENTS.md` 的全部订正项：

```javascript
import fs from 'node:fs';
import path from 'node:path';

const agentsPath = path.resolve(process.cwd(), 'AGENTS.md');
const content = fs.readFileSync(agentsPath, 'utf-8');

const checks = [
  {
    name: '测试基线更新为 17 文件 175 用例',
    pattern: /npm test\s+# vitest run（17 测试文件，175 用例）/,
  },
  {
    name: '技能安装流程记录 vellum-mdlog 真实目录版本化例外',
    pattern: /例外.*`vellum-mdlog`.*项目专属技能.*真实目录.*\.pi\/skills\/.*随仓库版本化.*不迁入全局仓库/,
  },
  {
    name: '已安装技能表中登记 vellum-mdlog',
    pattern: /\|\s*`vellum-mdlog`\s*\|\s*Vellum 交互式 mdlog 日志生成与 `vellum-widget` 交互块编写规范/,
  },
  {
    name: '性能结构约束包含 WidgetSandbox memo 与 LRU 机制',
    pattern: /WidgetSandbox.*React\.memo.*全局最多 10 个存活 iframe LRU/,
  },
  {
    name: '性能结构约束包含代码块语言连字符正则',
    pattern: /language-\(\[\\w-\]\+\)/,
  },
];

let failed = 0;
for (const check of checks) {
  if (!check.pattern.test(content)) {
    console.error(`❌ [FAIL] ${check.name}`);
    failed++;
  } else {
    console.log(`✅ [PASS] ${check.name}`);
  }
}

if (failed > 0) {
  console.error(`\n共 ${failed} 项校验失败，AGENTS.md 亟待订正。`);
  process.exit(1);
} else {
  console.log('\n✨ AGENTS.md 全部规约校验通过！');
  process.exit(0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-agents-md.mjs`
Expected: FAIL（报告 5 项检查失败，因为当前 `AGENTS.md` 仍记录旧基线「14 测试文件，142 用例」，且无 `vellum-mdlog` 例外说明）。

- [ ] **Step 3: Apply corrections to `AGENTS.md`**

在 `AGENTS.md` 中进行如下三处精准更新：

1. **更新命令节基线**：
```markdown
## 命令

```bash
npm run dev          # Vite 开发服务器（端口 1420）
npm run build        # tsc + vite build
npm test             # vitest run（17 测试文件，175 用例）
npm run tauri        # Tauri CLI
```
```

2. **技能安装流程节增加例外说明并更新技能表**：
```markdown
## 技能安装流程

### 仓库结构

全局技能仓库：`C:/Users/17445/Desktop/HwFee-skills/.agents/skills/`

每个项目通过**符号链接**引用仓库中的技能，**不拷贝**。

> **例外说明**：`vellum-mdlog` 为项目专属技能，以真实目录存放于 `.pi/skills/` 并随仓库版本化，**不迁入全局仓库**、**不使用符号联接**。理由：该技能包含针对 Vellum 交互沙箱协议、kami 设计 token 与 CommonMark 围栏规范的强绑定契约，随 Vellum 仓库一同分发版本管理，确保外部开发者 clone 本仓库后无需额外联接即可开箱即用。

### 安装新技能
...
```

并在 `### 已安装的技能（本项目）` 表格末尾追加行：
```markdown
| `vellum-mdlog` | Vellum 交互式 mdlog 日志生成与 `vellum-widget` 交互块编写规范（项目专属技能，随仓库版本化） |
```

3. **在「性能结构约束」节追加沙箱与连字符提取约束**：
```markdown
- `WidgetSandbox` 组件必须严格实施 `React.memo` 与全局最多 10 个存活 iframe LRU 休眠机制；沙箱必须懒挂载，追加写入触发整篇重载时已有 iframe 必须保持位置稳定，严禁未经 memo 或频繁重建导致 WebView 子帧暴涨与交互状态丢失
- `CodeBlock.tsx` 与 `MarkdownDocument.tsx` 语言提取正则必须支持连字符（`/language-([\w-]+)/`），确保 `vellum-widget` 与 `objective-c` 等语言标识完整提取，未注册语言平滑降级为普通代码块
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-agents-md.mjs`
Expected: PASS（5 项检查全部输出 `✅ [PASS]`，退出码 0）。

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md scripts/verify-agents-md.mjs
git commit -m "docs: update AGENTS.md baseline to 175 tests and add vellum-mdlog contract rules"
```

---

### Task 5.2: 新建 `.pi/skills/vellum-mdlog/SKILL.md` 技能规范文档

**Files:**
- Create: `.pi/skills/vellum-mdlog/SKILL.md`
- Test: `scripts/verify-skill-contract.mjs`

**Interfaces:**
- Consumes:
  - spec §5 技能契约（五大核心规则、沙箱 Opaque Origin 禁本地存储、kami 色值与字体栈硬编码、图片归一化惯例）
  - 跨包契约（逐字使用）：围栏语言名 `vellum-widget`；postMessage 类型 `vellum-widget:resize`；高度范围 `[80, 2000]`
- Produces:
  - 供 pi agent 读取的项目专属技能规范 `.pi/skills/vellum-mdlog/SKILL.md`，使后续在 Vellum 仓库内工作的 Agent 在需要编写对话记录或交互块时自动触发并严格遵循契约。

- [ ] **Step 1: Write the failing test**

创建自动化契约检查脚本 `scripts/verify-skill-contract.mjs`，在实现前先定义规范要求：

```javascript
import fs from 'node:fs';
import path from 'node:path';

const skillPath = path.resolve(process.cwd(), '.pi/skills/vellum-mdlog/SKILL.md');

if (!fs.existsSync(skillPath)) {
  console.error(`❌ [FAIL] 目标技能文件不存在: ${skillPath}`);
  process.exit(1);
}

const content = fs.readFileSync(skillPath, 'utf-8');

const requiredTokens = [
  // 触发词与 frontmatter
  'name: vellum-mdlog',
  '对话记录',
  'vellum',
  'mdlog',
  '交互块',
  '可视化讲解',
  // 跨包契约逐字匹配
  'vellum-widget',
  'vellum-widget:resize',
  '[80, 2000]',
  // 沙箱与 Opaque Origin 禁存储
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'SecurityError',
  // kami 色值
  '#f5f4ed',
  '#faf9f5',
  '#e8e6dc',
  '#141413',
  '#3d3d3a',
  '#6b6a64',
  '#1B365D',
  '#dddacc',
  // 字体栈与 CJK 衬线回退
  'TsangerJinKai02',
  'Source Han Serif SC',
  // 动画与交互限制
  'prefers-reduced-motion',
  'emoji',
  // 图片惯例
  'mdlog-assets/',
];

let missing = 0;
for (const token of requiredTokens) {
  if (!content.includes(token)) {
    console.error(`❌ [FAIL] 缺少必需契约关键词: "${token}"`);
    missing++;
  } else {
    console.log(`✅ [PASS] 契约关键词检测通过: "${token}"`);
  }
}

// 检查 frontmatter 格式
const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fmMatch) {
  console.error('❌ [FAIL] 缺少有效的 YAML frontmatter');
  missing++;
} else {
  const fm = fmMatch[1];
  if (!fm.includes('name: vellum-mdlog')) {
    console.error('❌ [FAIL] frontmatter 缺少 name: vellum-mdlog');
    missing++;
  }
  if (!/description:\s*Use when/.test(fm)) {
    console.error('❌ [FAIL] frontmatter description 必须遵循 "Use when..." 触发模式');
    missing++;
  }
}

if (missing > 0) {
  console.error(`\n共 ${missing} 项契约检查不满足！`);
  process.exit(1);
} else {
  console.log('\n✨ SKILL.md 完整性与契约全部通过！');
  process.exit(0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-skill-contract.mjs`
Expected: FAIL（报告目标技能文件 `.pi/skills/vellum-mdlog/SKILL.md` 不存在）。

- [ ] **Step 3: Create `.pi/skills/vellum-mdlog/SKILL.md`**

编写 `.pi/skills/vellum-mdlog/SKILL.md` 的**完整真实内容**（禁止占位符，字面落地）：

````markdown
---
name: vellum-mdlog
description: Use when generating or appending conversation logs (对话记录), inspecting live log sessions in Vellum (vellum, mdlog), or authoring interactive visual widgets (交互块、可视化讲解) for complex algorithms, dynamic demonstrations, or factual explanations.
---

# Vellum mdlog 交互式实时日志与组件规范

## 1. 概述与核心定位

Vellum `mdlog` 系统是基于 Markdown 的交互式会话记录与事实讲解格式。阅读器内置了受信意图标识检测、沙箱 iframe 挂载、双向尺寸协商及严苛的内容安全策略（CSP）。

本技能规定了智能体（Agent）在 Vellum 记录对话、输出交互演示块（`vellum-widget`）以及引用生成图片时的行为契约。

---

## 2. 何时输出交互块（Trigger Rules）

### ✅ 适用场景（仅在必要时使用）
- **客观事实或复杂算法的可视化讲解**：静态文本或公式推导难以直观传达多维演化时（例如：傅里叶级数合成、贝塞尔曲线控制点动态调节、排序算法状态机演练、注意力权重热力图等）；
- **参数动态可调演示**：用户需要拖动滑动条、切换状态按钮来直观感受模型参数对输出波形/结果的影响；
- **自包含数学与物理沙盒**：纯前端内存即可完成闭环运算的轻量仿真。

### ❌ 严禁滥用场景（Prohibitions）
- **单次回复上限**：**单次回复中至多输出 1 个 `vellum-widget`**，严禁一次输出多个 widget，防范 WebView 子帧过多引发性能损耗；
- **纯文本/表格/公式可表达的内容**：严禁仅为华丽装饰而包装普通代码段、简单列表或静态结论；
- **跨网络或外部数据依赖**：需要向远程接口拉取数据的场景严禁使用交互块。

---

## 3. 交互块五大硬性契约（Core Contracts）

### 契约 1：围栏语法与多反引号平衡（Fence & Backtick Nesting）
- 交互块必须使用语言标识符 `vellum-widget`：
  ````markdown
  ```vellum-widget
  <!DOCTYPE html>
  <html lang="zh-CN">
  ...
  </html>
  ```
  ````
- **长围栏规则**：若 HTML 源码或内嵌脚本中包含三反引号（`` ` ``），外层围栏必须使用四个反引号（```` ```` ```` ````）；以此类推，确保外层围栏长度严格大于内部出现的最大连续反引号长度。

### 契约 2：完全自包含 HTML5 与绝对断网隔离（Zero Network Dependency）
- 围栏内部必须是标准的、自包含的完整 HTML5 文档（必须以 `<!DOCTYPE html>` 开头，包含完整的 `<html>`、`<head>`、`<style>`、`<body>`、`<script>`）。
- **绝对断网与 CSP 拦截**：宿主协议对沙箱注入了严苛 CSP（`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:`）。
  - 沙箱会直接拦截所有向外部网络发起的**取数型**请求（包括 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`）；
  - **严禁**使用任何外部 CDN 资源（如 `unpkg.com`、`cdnjs`、Google Fonts 等）；
  - **严禁**引用外部样式表、外部脚本或远程图片；所有样式与脚本必须全内联。

### 契约 3：Opaque Origin 与本地存储严格禁止（Memory-Only State）
- **致命报错陷阱**：沙箱 iframe 仅具有 `sandbox="allow-scripts"` 属性，处于 Opaque Origin（不透明源）状态，**严禁调用任何浏览器本地持久化或存储 API**：
  - `localStorage`
  - `sessionStorage`
  - `indexedDB`
  - `document.cookie`
  调用上述任意 API 将会立即触发浏览器的 `SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document.` 导致整个脚本崩溃！
- **唯一状态规则**：所有交互状态、计算变量、滑动条数值**必须且仅能保存在 JavaScript 内存变量中**。

### 契约 4：Kami 纸墨设计语言硬编码规范（Kami Design Compliance）
沙箱隔离了主应用的 CSS 变量和字体文件，widget 内部必须直接在 CSS 中硬编码 kami 调色板与字体栈：

1. **色彩变量（Hardcoded Tokens）**：
   ```css
   :root {
     --parchment: #f5f4ed; /* 暖纸底 */
     --ivory: #faf9f5;     /* 象牙卡片底 */
     --warm-sand: #e8e6dc; /* 深暖强调底 / 浅边框 */
     --near-black: #141413;/* 浓墨正文 */
     --dark-warm: #3d3d3a; /* 暗暖次要正文 */
     --stone: #6b6a64;     /* 弱化字 / 边框辅助 */
     --brand: #1B365D;     /* 单一靛青品牌色（注意：非 --primary） */
     --hairline: #dddacc;  /* 发丝分割线 */
     --border: #e8e6dc;    /* 标准浅边框 */
   }
   ```
2. **字体栈与 CJK 衬线回退**：
   - 衬线文本栈：`font-family: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif;`
   - 等宽文本栈：`font-family: "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02", "Source Han Serif SC", monospace;`
   - *字体回退说明*：沙箱内无法访问宿主本地字体文件，中文字符将优雅回退至系统内置衬线体（宋体/思源宋体），严格保持优雅纸墨质感。
3. **视觉与可访问性纪律**：
   - **严禁使用 emoji**（严禁任何彩色表情包符号，图标一律采用原生 SVG 发丝线或精炼文本符号）；
   - **圆角规范**：圆角属性值严格限制在 `2px ~ 6px` 之间（章点/微方块为 `1px`，卡片与面板推荐 `4px`）；
   - **字重上限**：`font-weight` 最高不得超过 `500`；
   - **动效豁免**：必须包含 `@media (prefers-reduced-motion: reduce)` 规则关停动画与平滑过渡。

### 契约 5：高度自适应与标题上报协议（Height & Title PostMessage）
宿主容器依据沙箱的内部真实渲染高度进行平滑伸缩。沙箱内部必须包含以下 ResizeObserver 与 load 监听脚本：

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

- **消息类型**：必须精确为 `"vellum-widget:resize"`；
- **标题字段**：`title` 取 `document.title`，用于在宿主组件顶栏显示（如空缺宿主将兜底显示「交互演示」）；
- **高度范围约束**：宿主会将高度强制限制在 `[80, 2000]` 像素之间；低于 80px 按 80px 渲染，超高内容可在沙箱内部启用局部滚动。

---

## 4. 图片生成与引用惯例（Image Convention）

当使用工具（如 `imagen2`）生成图片时：
- Agent **只需在 Markdown 正文中直接使用标准 Markdown 图片引用语法**，例如：
  `![傅里叶合成示意图](generated-images/fourier-series.png)`
- **扩展自动化管理**：`mdlog` 扩展会自动识别生成的回合内图片，将其安全过滤并归一化复制进日志同级目录的 `mdlog-assets/` 中，并在落盘时自动将正文路径改写为净文件名（如 `![](mdlog-assets/fourier-series.png)`）。
- Agent **无需**手动执行图片文件的重命名、路径搬移或 Base64 编码。

---

## 5. 快速参考模板（Minimal Widget Skeleton）

可直接查阅本技能目录下的标准模板文件：
`assets/widget-template.html`

快速骨架结构：
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>演示标题</title>
  <style>
    :root {
      --parchment: #f5f4ed; --ivory: #faf9f5; --near-black: #141413;
      --dark-warm: #3d3d3a; --stone: #6b6a64; --brand: #1B365D; --hairline: #dddacc;
    }
    body {
      margin: 0; padding: 12px; background: var(--parchment); color: var(--dark-warm);
      font-family: "TsangerJinKai02", "Source Han Serif SC", "Songti SC", serif;
    }
    .widget-box { background: var(--ivory); border: 1px solid var(--hairline); border-radius: 4px; padding: 12px; }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
  </style>
</head>
<body>
  <div class="widget-box">
    <!-- 纯内存交互 DOM -->
  </div>
  <script>
    (function() {
      function report() {
        const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
        window.parent.postMessage({ type: "vellum-widget:resize", height: h, title: document.title }, "*");
      }
      window.addEventListener("load", report);
      if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
    })();
  </script>
</body>
</html>
```

---

## 6. 常见错误与避坑清单（Common Mistakes & Fixes）

| 错误表现 | 根本原因 | 正确做法 |
|---|---|---|
| `SecurityError: Access is denied for this document` | 调用了 `localStorage` 或 `sessionStorage` | 所有状态改用 `let` / `const` 纯内存变量保存 |
| 交互块在宿主渲染为普通代码块 | 围栏标识符写错（如 ````html` 或 ````widget`） | 必须严格使用 ````vellum-widget` 标识符 |
| 页面高度坍缩为 0 或未随内容展开 | 漏写了 `report()` 通信脚本或消息类型写错 | 引入标准的 `vellum-widget:resize` 通信 IIFE |
| 外部库未加载，控制台报 CSP 拒绝 | 引用了 CDN 链接（如 unpkg、cdn.jsdelivr） | 沙箱严格断网，所有工具函数与渲染逻辑手写自包含 |
| 围栏被内部的反引号提前截断 | 正文代码块包含三反引号 | 外层围栏使用四个或更多反引号 ```` ```` ```` ```` 包裹 |
| 字体排版风格与 Vellum 主界面割裂 | 使用了默认 Sans-Serif 或随意指定现代无衬线体 | 采用 kami 衬线回退栈，字重 ≤ 500，使用 `#141413` 与 `#3d3d3a` |
| 包含 emoji 图标（如表情字符） | 违反 kami 纸墨克制质感 | 移除 emoji，使用清晰汉字标签或轻量级原生 SVG 矢量标点 |
````

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-skill-contract.mjs`
Expected: PASS（所有 25+ 项契约关键词与 frontmatter 校验全部通过，输出 `✨ SKILL.md 完整性与契约全部通过！`，退出码 0）。

- [ ] **Step 5: Commit**

```bash
git add .pi/skills/vellum-mdlog/SKILL.md scripts/verify-skill-contract.mjs
git commit -m "feat(skills): add vellum-mdlog skill specification document"
```

---

### Task 5.3: 新建交互块骨架模板 `.pi/skills/vellum-mdlog/assets/widget-template.html`

**Files:**
- Create: `.pi/skills/vellum-mdlog/assets/widget-template.html`
- Test: `scripts/verify-widget-template.mjs`

**Interfaces:**
- Consumes:
  - spec §5.1 高度上报脚本与 kami 纸墨基准设计 token
  - 跨包契约：消息类型 `vellum-widget:resize`；高度范围 `[80, 2000]`
- Produces:
  - 完整可用、开箱即跑的交互块基准模板 `.pi/skills/vellum-mdlog/assets/widget-template.html`。作为 Agent 编写任何算法讲解或动态演练的官方骨架。

- [ ] **Step 1: Write the failing test**

创建自动化验证脚本 `scripts/verify-widget-template.mjs`：

```javascript
import fs from 'node:fs';
import path from 'node:path';

const templatePath = path.resolve(
  process.cwd(),
  '.pi/skills/vellum-mdlog/assets/widget-template.html'
);

if (!fs.existsSync(templatePath)) {
  console.error(`❌ [FAIL] 模板文件不存在: ${templatePath}`);
  process.exit(1);
}

const html = fs.readFileSync(templatePath, 'utf-8');

const assertions = [
  { name: '符合标准 HTML5 DOCTYPE 声明', pass: html.startsWith('<!DOCTYPE html>') },
  { name: '指定中文 lang 属性', pass: /<html[^>]+lang=["']zh-CN["']/.test(html) },
  { name: '声明 UTF-8 编码', pass: /<meta charset=["']UTF-8["']/i.test(html) },
  { name: '包含 postMessage 契约类型 vellum-widget:resize', pass: html.includes('"vellum-widget:resize"') },
  { name: '包含 ResizeObserver 监听', pass: html.includes('ResizeObserver') },
  { name: '包含 load 事件兜底上报', pass: html.includes('addEventListener("load"') || html.includes("addEventListener('load'") },
  { name: '严禁外部网络请求 (http://, https://, //)', pass: !/https?:\/\//.test(html) },
  { name: '严禁本地存储 (localStorage)', pass: !html.includes('localStorage') },
  { name: '严禁本地存储 (sessionStorage)', pass: !html.includes('sessionStorage') },
  { name: '严禁数据库存储 (indexedDB)', pass: !html.includes('indexedDB') },
  { name: '严禁 Cookie 存储 (document.cookie)', pass: !html.includes('document.cookie') },
  { name: '严禁使用 emoji', pass: !/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(html) },
  { name: '硬编码 kami 纸底色 #f5f4ed', pass: html.includes('#f5f4ed') },
  { name: '硬编码 kami 象牙白 #faf9f5', pass: html.includes('#faf9f5') },
  { name: '硬编码 kami 浓墨 #141413', pass: html.includes('#141413') },
  { name: '硬编码 kami 暗暖字 #3d3d3a', pass: html.includes('#3d3d3a') },
  { name: '硬编码 kami 弱化字 #6b6a64', pass: html.includes('#6b6a64') },
  { name: '硬编码 kami 靛青品牌色 #1B365D', pass: html.includes('#1B365D') },
  { name: '硬编码 kami 发丝线 #dddacc', pass: html.includes('#dddacc') },
  { name: '支持 prefers-reduced-motion 动画豁免', pass: html.includes('prefers-reduced-motion') },
  { name: '字体栈包含 TsangerJinKai02 与 CJK 衬线回退', pass: html.includes('TsangerJinKai02') && html.includes('Source Han Serif SC') },
];

let failedCount = 0;
for (const a of assertions) {
  if (!a.pass) {
    console.error(`❌ [FAIL] ${a.name}`);
    failedCount++;
  } else {
    console.log(`✅ [PASS] ${a.name}`);
  }
}

if (failedCount > 0) {
  console.error(`\n共 ${failedCount} 项模板契约检查失败！`);
  process.exit(1);
} else {
  console.log('\n✨ widget-template.html 契约全部通过！');
  process.exit(0);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/verify-widget-template.mjs`
Expected: FAIL（报告目标文件 `.pi/skills/vellum-mdlog/assets/widget-template.html` 不存在）。

- [ ] **Step 3: Create `.pi/skills/vellum-mdlog/assets/widget-template.html`**

创建该文件，写入**完整、立即可用的 HTML5 自包含代码**（以经典的「傅里叶方波谐波叠加动态合成器」为真实范例，纯内存状态驱动，严禁占位符）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>傅里叶方波谐波叠加演示</title>
  <style>
    :root {
      /* kami 纸墨基础调色板 */
      --parchment: #f5f4ed;
      --ivory: #faf9f5;
      --warm-sand: #e8e6dc;
      --near-black: #141413;
      --dark-warm: #3d3d3a;
      --stone: #6b6a64;
      --brand: #1B365D;
      --brand-hover: #24477a;
      --hairline: #dddacc;
      --border: #e8e6dc;

      /* 纸墨字体栈 */
      --font-serif: "TsangerJinKai02", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Charter, Georgia, Palatino, serif;
      --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", Consolas, Monaco, "TsangerJinKai02", "Source Han Serif SC", monospace;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--parchment);
      color: var(--dark-warm);
      font-family: var(--font-serif);
      font-size: 13px;
      line-height: 1.6;
      padding: 14px;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* 纸墨卡片容器 */
    .widget-card {
      background: var(--ivory);
      border: 1px solid var(--hairline);
      border-radius: 4px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* 标题栏 */
    .widget-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid var(--hairline);
      padding-bottom: 8px;
    }

    .widget-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--near-black);
      letter-spacing: 0.5px;
    }

    .widget-subtitle {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--stone);
    }

    /* 控制面板 */
    .controls-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
      background: var(--parchment);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 10px 12px;
    }

    .control-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .control-label {
      font-size: 11px;
      color: var(--stone);
      display: flex;
      justify-content: space-between;
    }

    .control-value {
      font-family: var(--font-mono);
      color: var(--near-black);
      font-weight: 500;
    }

    /* 滑动条规范 */
    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 4px;
      background: var(--hairline);
      border-radius: 2px;
      outline: none;
      margin: 4px 0;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 2px;
      background: var(--brand);
      cursor: pointer;
      border: 1px solid var(--ivory);
    }

    /* 按钮组规范 */
    .btn-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .btn {
      background: var(--ivory);
      color: var(--dark-warm);
      border: 1px solid var(--hairline);
      border-radius: 2px;
      font-family: var(--font-serif);
      font-size: 11px;
      padding: 4px 10px;
      cursor: pointer;
      font-weight: 500;
      transition: background 0.15s ease, border-color 0.15s ease;
    }

    .btn:hover {
      background: var(--parchment);
      border-color: var(--stone);
    }

    .btn.active {
      background: var(--brand);
      color: var(--ivory);
      border-color: var(--brand);
    }

    /* 画布区域 */
    .canvas-container {
      position: relative;
      width: 100%;
      height: 180px;
      background: var(--ivory);
      border: 1px solid var(--hairline);
      border-radius: 3px;
      overflow: hidden;
    }

    canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    /* 底部数学公式与说明 */
    .formula-note {
      font-size: 11px;
      font-family: var(--font-mono);
      color: var(--stone);
      line-height: 1.4;
      background: var(--parchment);
      border-left: 2px solid var(--brand);
      padding: 6px 10px;
      border-radius: 0 2px 2px 0;
    }

    /* 动效豁免（严格遵循 kami 纸墨规范） */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="widget-card">
    <div class="widget-header">
      <span class="widget-title">方波谐波合成（Fourier Series Approximation）</span>
      <span class="widget-subtitle">N 次奇次谐波叠加</span>
    </div>

    <div class="controls-grid">
      <div class="control-item">
        <div class="control-label">
          <span>谐波项数 N</span>
          <span class="control-value" id="val-n">5</span>
        </div>
        <input type="range" id="input-n" min="1" max="15" step="1" value="5">
      </div>

      <div class="control-item">
        <div class="control-label">
          <span>角速度 (ω)</span>
          <span class="control-value" id="val-speed">1.0x</span>
        </div>
        <input type="range" id="input-speed" min="0.2" max="2.5" step="0.1" value="1.0">
      </div>

      <div class="control-item" style="justify-content: flex-end;">
        <div class="btn-group">
          <button class="btn active" id="btn-toggle">暂停演练</button>
          <button class="btn" id="btn-reset">重置初始</button>
        </div>
      </div>
    </div>

    <div class="canvas-container">
      <canvas id="wave-canvas"></canvas>
    </div>

    <div class="formula-note" id="formula-text">
      f(t) = (4/π) · ∑ [ sin((2k-1)ωt) / (2k-1) ], k ∈ [1, 5] · 吉布斯过冲峰值 ≈ +17.9%
    </div>
  </div>

  <script>
    // 1. 高度自适应与标题上报脚本（宿主契约）
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

    // 2. 纯内存状态模型（严禁使用 localStorage/sessionStorage 等持久化 API）
    const state = {
      n: 5,
      speed: 1.0,
      playing: true,
      phase: 0.0,
      animId: null
    };

    // DOM 元素引用
    const canvas = document.getElementById('wave-canvas');
    const ctx = canvas.getContext('2d');
    const inputN = document.getElementById('input-n');
    const valN = document.getElementById('val-n');
    const inputSpeed = document.getElementById('input-speed');
    const valSpeed = document.getElementById('val-speed');
    const btnToggle = document.getElementById('btn-toggle');
    const btnReset = document.getElementById('btn-reset');
    const formulaText = document.getElementById('formula-text');

    // 高分辨率画布适配
    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.resetTransform();
      ctx.scale(dpr, dpr);
    }

    // 绘制主循环
    function draw() {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const midY = height / 2;
      const amp = height * 0.35;

      ctx.clearRect(0, 0, width, height);

      // 1. 绘制中线与发丝网格
      ctx.beginPath();
      ctx.strokeStyle = '#dddacc'; // hairline
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.moveTo(0, midY);
      ctx.lineTo(width, midY);
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. 绘制理想方波基准（暗淡线条）
      ctx.beginPath();
      ctx.strokeStyle = '#e8e6dc'; // warm-sand
      ctx.lineWidth = 1;
      const period = width / 2;
      for (let x = 0; x < width; x++) {
        const t = (x / period) * 2 * Math.PI + state.phase;
        const ideal = Math.sin(t) >= 0 ? 1 : -1;
        const y = midY - ideal * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 3. 绘制傅里叶叠加波形（靛青色主线）
      ctx.beginPath();
      ctx.strokeStyle = '#1B365D'; // brand
      ctx.lineWidth = 1.8;
      for (let x = 0; x < width; x++) {
        const t = (x / period) * 2 * Math.PI + state.phase;
        let sum = 0;
        for (let k = 1; k <= state.n; k++) {
          const harmonic = 2 * k - 1;
          sum += Math.sin(harmonic * t) / harmonic;
        }
        const val = sum * (4 / Math.PI);
        const y = midY - val * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 状态推进
      if (state.playing) {
        state.phase += 0.02 * state.speed;
        state.animId = requestAnimationFrame(draw);
      }
    }

    // 交互监听（全在内存中响应）
    inputN.addEventListener('input', (e) => {
      state.n = parseInt(e.target.value, 10);
      valN.textContent = state.n;
      formulaText.textContent = `f(t) = (4/π) · ∑ [ sin((2k-1)ωt) / (2k-1) ], k ∈ [1, ${state.n}] · 吉布斯过冲峰值 ≈ +17.9%`;
      if (!state.playing) draw();
    });

    inputSpeed.addEventListener('input', (e) => {
      state.speed = parseFloat(e.target.value);
      valSpeed.textContent = state.speed.toFixed(1) + 'x';
    });

    btnToggle.addEventListener('click', () => {
      state.playing = !state.playing;
      if (state.playing) {
        btnToggle.textContent = '暂停演练';
        btnToggle.classList.add('active');
        state.animId = requestAnimationFrame(draw);
      } else {
        btnToggle.textContent = '继续播放';
        btnToggle.classList.remove('active');
        if (state.animId) cancelAnimationFrame(state.animId);
      }
    });

    btnReset.addEventListener('click', () => {
      state.n = 5;
      state.speed = 1.0;
      state.phase = 0.0;
      inputN.value = 5;
      valN.textContent = '5';
      inputSpeed.value = 1.0;
      valSpeed.textContent = '1.0x';
      formulaText.textContent = `f(t) = (4/π) · ∑ [ sin((2k-1)ωt) / (2k-1) ], k ∈ [1, 5] · 吉布斯过冲峰值 ≈ +17.9%`;
      if (!state.playing) {
        state.playing = true;
        btnToggle.textContent = '暂停演练';
        btnToggle.classList.add('active');
        state.animId = requestAnimationFrame(draw);
      }
    });

    window.addEventListener('resize', () => {
      resizeCanvas();
      if (!state.playing) draw();
    });

    // 启动初始渲染
    resizeCanvas();
    state.animId = requestAnimationFrame(draw);
  </script>
</body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/verify-widget-template.mjs`
Expected: PASS（21 项针对 HTML5、禁止项、Kami 色值与高度上报脚本的契约全部输出 `✅ [PASS]`，退出码 0）。

- [ ] **Step 5: Commit**

```bash
git add .pi/skills/vellum-mdlog/assets/widget-template.html scripts/verify-widget-template.mjs
git commit -m "feat(skills): add kami compliant self-contained widget skeleton template"
```

---

### Task 5.4: 技能载入机制与全量测试套件验收

**Files:**
- Test: `scripts/verify-skill-discovery.mjs`
- Test: `npm test`（Vitest 前端全量测试）
- Test: `cd src-tauri && cargo test`（Cargo 后端全量测试）

**Interfaces:**
- Consumes:
  - Task 5.1（订正后的 `AGENTS.md`）
  - Task 5.2（`.pi/skills/vellum-mdlog/SKILL.md`）
  - Task 5.3（`.pi/skills/vellum-mdlog/assets/widget-template.html`）
  - 跨包契约：围栏标识 `vellum-widget`、通信类型 `vellum-widget:resize`、高度范围 `[80, 2000]`
- Produces:
  - 验收通过的工程环境与自动化检验脚本，确保技能能被 pi 运行时自动发现并载入系统提示，且无任何既有测试回归。

- [ ] **Step 1: Write the skill discovery verification test**

创建脚本 `scripts/verify-skill-discovery.mjs`，模拟 pi coding agent 的技能发现器（Skill Loader / Parser）对项目专属技能进行端到端静态审查：

```javascript
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const skillDir = path.resolve(projectRoot, '.pi/skills/vellum-mdlog');
const skillFile = path.resolve(skillDir, 'SKILL.md');
const templateFile = path.resolve(skillDir, 'assets/widget-template.html');

console.log('[INFO] 开始执行 pi 技能发现与契约一致性审查...\n');

// 1. 物理目录与文件存在性
if (!fs.existsSync(skillDir) || !fs.statSync(skillDir).isDirectory()) {
  console.error(`❌ [FAIL] 技能目录不存在或不是真实目录: ${skillDir}`);
  process.exit(1);
}
if (!fs.existsSync(skillFile)) {
  console.error(`❌ [FAIL] SKILL.md 文件不存在: ${skillFile}`);
  process.exit(1);
}
if (!fs.existsSync(templateFile)) {
  console.error(`❌ [FAIL] 骨架模板文件不存在: ${templateFile}`);
  process.exit(1);
}
console.log('✅ [PASS] 目录结构校验通过（真实目录，非无效符号联接）');

// 2. 解析 YAML Frontmatter
const content = fs.readFileSync(skillFile, 'utf-8');
const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!fmMatch) {
  console.error('❌ [FAIL] SKILL.md 未包含合法的 YAML frontmatter');
  process.exit(1);
}

const fmRaw = fmMatch[1];
const nameMatch = fmRaw.match(/^name:\s*(.+)$/m);
const descMatch = fmRaw.match(/^description:\s*(.+)$/m);

if (!nameMatch || nameMatch[1].trim() !== 'vellum-mdlog') {
  console.error(`❌ [FAIL] frontmatter name 必须精确为 "vellum-mdlog"，实际: ${nameMatch ? nameMatch[1] : 'null'}`);
  process.exit(1);
}
console.log('✅ [PASS] frontmatter name 精确匹配: vellum-mdlog');

if (!descMatch) {
  console.error('❌ [FAIL] frontmatter 缺少 description 字段');
  process.exit(1);
}

const desc = descMatch[1].trim();
if (desc.length > 1024) {
  console.error(`❌ [FAIL] description 超过 1024 字符限制（当前 ${desc.length}）`);
  process.exit(1);
}
if (!desc.startsWith('Use when')) {
  console.error('❌ [FAIL] description 必须以 "Use when..." 开头');
  process.exit(1);
}

// 检查触发关键词
const triggers = ['对话记录', 'vellum', 'mdlog', '交互块', '可视化讲解'];
const missingTriggers = triggers.filter(t => !desc.includes(t));
if (missingTriggers.length > 0) {
  console.error(`❌ [FAIL] description 遗漏核心触发词: ${missingTriggers.join(', ')}`);
  process.exit(1);
}
console.log('✅ [PASS] frontmatter description 触发词与格式校验通过');

// 3. 跨包契约逐字一致性断言（Cross-Package Verbatim Contracts）
const crossPackageTokens = [
  { name: '围栏语言标识符', text: 'vellum-widget' },
  { name: '通信事件类型', text: 'vellum-widget:resize' },
  { name: '高度范围闭区间', text: '[80, 2000]' },
];

for (const item of crossPackageTokens) {
  if (!content.includes(item.text)) {
    console.error(`❌ [FAIL] SKILL.md 缺少跨包逐字契约: ${item.name} -> "${item.text}"`);
    process.exit(1);
  }
}
console.log('✅ [PASS] 跨包逐字契约检查通过（vellum-widget, vellum-widget:resize, [80, 2000]）');

console.log('\n[PASS] pi agent 技能发现与载入条件 100% 达成！');
process.exit(0);
```

- [ ] **Step 2: Run skill discovery verification**

Run: `node scripts/verify-skill-discovery.mjs`
Expected: PASS（输出 `[PASS] pi agent 技能发现与载入条件 100% 达成！`，退出码 0）。

- [ ] **Step 3: Verify DesignMD status (No Lint Required)**

依设计规约明确：
> **关于 DESIGN.md 校验的判定**：
> 本工作包（WP5）未对根目录 `DESIGN.md` 进行任何修改（所有 kami 纸墨调色板色值与排版规则均为对现有设计规范的纯引用与沙箱内硬编码落地）；因此依 spec §10 规定，**无需执行 `npx -p @google/design.md designmd lint DESIGN.md`**。

- [ ] **Step 4: Run full Vitest frontend suite**

Run: `npm test`
Expected: 17 passed (17 files), 175 passed (175 tests). 必须 100% 保持全绿。

- [ ] **Step 5: Run full Cargo backend suite**

Run: `cd src-tauri && cargo test`
Expected: 15 passed (13 in `vellum_lib`, 2 in `vellum`), 0 failed. 必须 100% 保持全绿。

- [ ] **Step 6: Commit verification scripts**

```bash
git add scripts/verify-skill-discovery.mjs
git commit -m "test(skills): add automated discovery and cross-package contract verification"
```




