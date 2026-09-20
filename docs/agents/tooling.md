# 工程环境、技能、宣传品与发布

`AGENTS.md` 的详情分册。收录三个执行入口的真实 shell、技能安装流程与 pi 扩展、宣传品（`video/` + `promo/`）、性能优化技能表与死规则、入口 chunk 尺寸历史，以及打包与生产构建的注意事项、真机探针、`tauri/custom-protocol` feature。

## 跑命令用哪个 shell（三个入口不是一个 shell）

| 入口 | 实际 shell | 语法 |
|------|-----------|------|
| 前台 `bash` 工具 | Git Bash / MSYS，bash 5.3.15 | POSIX（`&&`、`$(…)`、`for … do … done`） |
| `bg_run` 后台任务 | PowerShell 7.6.6（Core，`pwsh.exe`） | PowerShell 7（`&&`、`? :`、`??` 均可用） |
| `powershell` 工具 | PowerShell 7.6.6（Core） | 同上 |

- **后台任务用哪个 shell 会变，别按表猜**：表里那一栏是**当时的**实测值。
- 2026-09-18 复核时它已不成立——同一条 `npm run tauri build 2>&1 | Select-Object -Last 25` 报的是 `/usr/bin/bash: line 1: Select-Object: command not found`，即后台跑的是 Git Bash，`PI_BG_SHELL` 那条用户级变量显然丢了或被 harness 覆盖。
- 历史教训仍然有效：`npm test 2>&1 | tail -40` 曾在 PowerShell 下报「术语 'tail' 不会被识别为 cmdlet」，命令压根没执行、退出码却是 1——本项目已误读过一次，当成「测试失败」去查代码。
- **稳妥做法**：后台命令只用跨 shell 都成立的部分（`&&`、`;`、重定向都不要依赖），或先跑一次 `echo $0` / `Write-Output $PSVersionTable` 探明。
- 截尾与匹配优先交给前台 `bash` 工具（那边确定是 Git Bash）。
- **这条靠用户级环境变量撑着**：`PI_BG_SHELL=pwsh` + `PI_BG_SHELL_PATH=…\PowerShell\7\pwsh.exe`（User 与 Process 作用域均已设）。
  - 变量一旦丢失，`pi-background-tasks` 会回落到 `cmd.exe`（取 `ComSpec`），上面这条就不再成立。
- **`bash -lc "…"` 不是逃生口**：把 `PI_BG_SHELL` 改成 `bash`、或在 PowerShell 里直接调 `bash`，拿到的都是 `C:\WINDOWS\system32\bash.exe`（WSL，bash 5.2.21）。
  - 而 **WSL 里没有 node/npm**（实测 `node: command not found`）。要跑 POSIX 就放前台 `bash` 工具。

## 技能安装流程

### 仓库结构

- 全局技能仓库：`C:/Users/17445/Desktop/HwFee-skills/skills/`
- 每个项目通过**目录联接**引用仓库中的技能，**不拷贝**（本地 `.pi/skills/<skill-name>` 均为联接，永不入库；`.gitignore` 已忽略 `.pi/skills/`）。
- **git 会跟随联接读到真实内容**——所以这些路径可以被误 `git add` 进来，历史上就发生过。
  - 判据只有一条：`git ls-files .pi/skills/` 有输出就是错，用 `git rm -r --cached .pi/skills/<skill-name>/` 解除跟踪（`--cached` 只动索引）。
  - **别用 `rm -rf` 删那个路径**——它会顺着联接删掉全局库里的真身。
- 2026-09-12 记录：`vellum-mdlog` 单一归属全局技能库（`C:\Users\17445\Desktop\HwFee-skills\skills\vellum-mdlog`；该库自身是 git 仓库，远端 `HwFee/skills-manager-backup`，备份由 Skills Manager 维护）。
  - 此前「项目专属、不迁库、开箱即用」的例外不再成立：本仓库只留目录联接，外部 clone **不会**得到该技能，需按「安装新技能」第 5 步重建联接。
  - 2026-09-10 的迁移当时只删了磁盘目录、漏了解除跟踪，已于 2026-09-12 补齐。

### 安装新技能

1. 用 `npx skills find <关键词>` 搜索全网技能。
2. 评估质量：优先选 1K+ 安装量、官方源（vercel-labs、anthropics 等）。
3. 安装到当前项目目录（不用 `-g`，避免污染全局 `~/.agents/skills/`）：

```bash
npx skills add <owner/repo@skill> -a kimi-code-cli -y
```

4. 将安装的技能目录**移动**到全局仓库：

```bash
mv .agents/skills/<skill-name> /c/Users/17445/Desktop/HwFee-skills/skills/
```

5. 从仓库创建目录联接（Windows 上 `ln -s` 不可靠，用 `mklink /J`）：

```bash
cmd //c "mklink /J .pi\\skills\\<skill-name> C:\\Users\\17445\\Desktop\\HwFee-skills\\skills\\<skill-name>"
```

### 已安装的技能（本项目）

| 技能 | 用途 |
|------|------|
| `react-performance-optimization` | React memo/useMemo/code-splitting/virtualization |
| `bundle-size-optimization` | Bundle 分析、tree-shaking、code splitting |
| `design-md` | 按 google-labs DESIGN.md 规范提取/校验设计语言（项目设计语言见根目录 `DESIGN.md`，校验：`npx -p @google/design.md designmd lint DESIGN.md`） |
| `tauri-v2` | Tauri 2 架构、IPC 通信、插件与原生桌面事件开发规范 |
| `web-artifacts-builder` | 交互式 HTML / React / 可视化 Artifacts 沙箱构建规范 |
| `superpowers` | 工程化研发方法论套件（头脑风暴、TDD、系统化调试、执行计划、工作流规约） |
| `vellum-mdlog` | Vellum 纸墨 Markdown 与 `vellum-widget` 契约（2026-09-10 起迁入全局仓库，本地为目录联接）；要点见下方小节 |

`vellum-mdlog` 技能要点：

- 三个触发分支：mdlog 连接（逐回合强制）、**写本机 Vellum 阅读的 md 笔记**（2026-09-12 新增）、无提示出图。
- 契约 1–6 全文在技能内 `references/widget-contracts.md`，速查在 `references/troubleshooting.md`——主体 `SKILL.md` 只留分支路由、图承载禁令、出图流程与最小清单。
- 其「强调定界符跨汉字+括号」写法要求已于 2026-09 起降级为可移植性建议——渲染层由 remark-cjk-friendly 软件兼容（见 `docs/agents/obsidian.md`）。

`vellum-mdlog` 的记录态判据与出图通道：

- **记录态判据是工具表里有 `vellum_figure`**（pi 扩展只在记录连接期间激活它）。
- 技能里那条「系统提示出现 `mdlog live log: CONNECTED`」的注入是 2026-09-14 重建扩展时丢的——`CHANGELOG.md` 未发布段仍留着它当年的修复记录与回归测试，2026-09-16 起由工具激活门禁与 `promptGuidelines` 承担同一作用。
- 图示经该工具投递（草稿路径 → 扩展回一枚 `<!-- mdlog-fig:ID -->` 标记 → 写入器落盘前展开回围栏），**源码不进对话记录，日志文件与手写围栏逐字节同形**。
- 细则见 `extensions/mdlog/README.md`。

### pi 扩展（本项目，与技能同一套联接思路）

- 实体在**本仓库** `extensions/mdlog/`（2026-09-16 从 `~/.pi/agent/extensions/mdlog` 迁入，原目录内层 git 仓库一并撤销，历史以 Vellum 文档为准）；pi 的加载位是指向它的目录联接：

```bash
node -e "const fs=require('fs');fs.symlinkSync('C:/Users/17445/Desktop/Vellum/extensions/mdlog','C:/Users/17445/.pi/agent/extensions/mdlog','junction')"
```

- **外部 clone 拿不到它**：pi 只扫 `~/.pi/agent/extensions/`，克隆后必须按上面这条重建联接，否则实时日志整体失效（静默失效——pi 不会报错）。
  - 验证方式：临时在扩展工厂里加一行 `console.error` 跑 `pi -p "..."`，输出里出现即说明联接被跟随（pi 的扩展发现显式接受 `isSymbolicLink()` 目录项，`core/extensions/loader.js`）。
- **`node_modules` 里三个联接是指向 pi 自带那份的**（`typebox` / `@earendil-works/pi-tui` / `@earendil-works/pi-coding-agent`）。
  - pi 加载扩展时走 jiti 别名，`node --test` 与 `tsc` 走 Node 原生解析——两套解析必须都能找到，且刻意指向同一份以防版本漂移。重建命令见 `extensions/mdlog/README.md`。
- **它的 TS 不属于前端构建面**：app 的 `tsconfig.json` 只 `include: ["src"]`，`vite.config.ts` 的 `test.exclude` 已排除 `extensions/**`（那边的测试跑 `node:test`，被 vitest 拾取会必挂）。
- 常用命令（在 `extensions/mdlog/` 里）：`npm test`、`npm run typecheck`。

## 宣传品（`video/` 宣传片工程 + `promo/` 对外材料）

产品宣传片与落地页。**两边的颜色、字体、文案都取自同一处事实来源**——`video/src/theme.ts`（视频侧）与仓库根 `DESIGN.md`（落地页侧），与应用同源；片子里的界面是真实运行的窗口，不是重画的示意图。

**中英两版共用一条时间线**（`VellumPromo` / `VellumPromoZh`），语言由 `src/locale.tsx` 的 context 下发：场景用 `useCopy()` 取文案、`useShot()` 取素材（中文版是 `capture/zh-*.png`）、`useMetaFont()` 取元信息字族。三条容易踩的线：

- **`useShot()` 返回相对路径，不是 `staticFile()` 结果**：WindowShot / PlateScroll 内部自己会调 staticFile，重复调用会抛「The value "/public/…" is already …」（这个坑真被渲染到第 108 帧才发现）。需要完整 URL 的地方（如 `<Img>`）自己再包一层。
- **等宽字体没有汉字**：中文文案落在 JetBrains Mono 上会掉进系统 CJK 字体、行高与字重都对不上。片子里一律走 `useMetaFont()`，落地页里中文小字一律用衬线。
- **中文版不是同一支片配字幕**：中文演示文档是另一份（`video/assets/demo.zh.md`），素材用 `npm run capture:zh` 抓（产物 `zh-` 前缀，与英文那套共存）；会话 B 的日志文档本来就是中文，两版共用。

```bash
# 素材 + 渲染（video/ 里；需要先有一份 release 版 exe）
npm run assets          # 同步字体 → 合成配乐 → CDP 抓真实界面（英文）
npm run capture:zh      # 中文演示文档那一套（zh- 前缀）
npm run render          # out/vellum-promo.mp4（含配乐）
npm run render:silent   # out/vellum-promo-silent.mp4（无需配乐的嵌入用）
npx remotion render VellumPromoZh out/vellum-promo-zh.mp4

# 导出入库的那一套（仓库根）
node promo/build-assets.mjs
```

不可回退的几条：

- **`video/` 里入库的只有源码**：成片（`out/`）、抓取素材（`public/capture/`，含 `zh-*`）、字体（`public/fonts/`）、配乐（`public/music.wav`）全部是生成物，已由 `video/.gitignore` 排除。
  - `promo/assets/` 是**唯一入库的分发副本**，只由 `promo/build-assets.mjs` 生成（中英两套，同名只差 `-zh` 后缀），不要手改。
- **抓取脚本会 `taskkill /IM vellum.exe /F`**（并存实例会互相抢占远程调试端口），跑 `npm run capture` 前先确认没有需要保留的实例。
  - 素材文档暂存到 `~/Documents/Notes`——顶栏会原样显示绝对路径，所以不能直接用仓库路径抓图。
- **字体闸门（`video/src/fonts.ts` 的 `useBrandFontsGate`）必须挂在真正画画面的组件里**（现落在 `PaperBackground` 上，它是每场的底）。
  - 仓耳今楷 8.4 MB×2，任何一帧抢在 `document.fonts.load` 之前都会被画成回退字体（中文是今楷、英文变几何无衬线）；只挂在 `Root.tsx` 上不够。
- **分镜里不许用 CSS 动画**：Remotion 逐帧截图，transition/keyframes 根本不会被采样，所有运动必须由 `useCurrentFrame()` 驱动。
- **长图素材用「撑高视口」抓，不用 `captureBeyondViewport`**：`.document-scroll` 是滚动盒，盒外截不到正文；滚动则由 Remotion 按帧推进（录屏的帧间隔会抖）。两个理由都写在 `video/capture/capture.mjs` 头部。
- **落地页不引入第二个强调色、不加大圆角与厚度投影**（照 `DESIGN.md` 的 Do's/Don'ts），动效只有进场淡入一种且尊重 `prefers-reduced-motion`；字体与截图走相对路径，单独部署时必须把 `public/fonts/` 一并搬走。

## 性能优化

### 遇到性能需求时

**先参考已安装的技能**，让技能指导优化方向，不要凭空发挥：

| 技能 | 适用场景 |
|------|----------|
| `react-performance-optimization` | React 渲染慢、重渲染、大列表 |
| `bundle-size-optimization` | 打包体积大、构建产物多 |
| `vercel-react-best-practices` | 70 条 React 性能规则（仓库中，需要时联接） |

### 一条死规则

`CodeBlock.tsx` 用 `PrismLight`，**禁止切回 `PrismAsyncLight`**——会导致 Vite 生成 270+ 语言 chunk。

### 完整优化记录

- 逐次优化的取舍记在 `CHANGELOG.md` 的版本条目里。

### 入口 chunk（`dist/assets/index-*.js`）尺寸历史

- 143.76 → 158.08 → 158.53 → 158.99 → 160.02 → 160.88 → 161.10KB（逐次增量见 `CHANGELOG`）。
  - 143.76KB → 158.08KB（+14.32KB，gzip +4.57KB；来源：`npm run build` 产物对比 `848899c` 之前 `d9f8523` 的工作树）——本增量为 `useDocumentEditor` 引入 `buildEditUnits`（math 解析器进入口）所致。
- 最近五次增量：
  - **属性卡后为 162.98KB**（`index-BC4-jcVn.js`，再 +1.88KB：`frontmatter.ts` 解析器 + `rehypeObsidian` 随 `editUnits` 进入口 chunk）。
  - **wikilink 端到端后为 165.02KB**（`index-BAc_OKVp.js`，再 +2.04KB：`wikilink.ts` 解析/抽取 + 行内换树 + `a:` 渲染器分支 + App 解析接线）。
  - **wikilink 片段跳转后为 165.56KB**（`index-BII2CVuq.js`，再 +0.54KB：`matchHeadingByFragment` + `loadPath` 片段接线 + 片段跳转共用 `scrollHeadingIntoView`）。
  - **文档标题进正文后为 165.68KB**（`index-B3G__s3X.js`，再 +0.12KB：`fileNameToTitle` + `.document-title` 渲染）。
  - **顶栏去标题 + 标题贴顶后为 165.59KB**（`index-BrRc41wR.js`，−0.09KB：`.top-bar__title` 连同它的 DOM 一并移除，抵消了 `:has()` 两条上移规则）。
- 若后续继续增长，按裁定 F11 的退路把单元计算移回 lazy 侧。

## 注意事项

- **多实例（2026-09-12）**：无单实例锁（`early_single_instance` 模块与 `tauri-plugin-single-instance` 均已移除），每次启动都是独立进程/窗口，各自从命令行参数加载自己的文档。
  - settings Store 跨进程共享、后写覆盖——阅读位置按文件路径键控，不同文件的实例互不干扰；同一份设置（侧栏宽等）以最后退出者为准。
  - 运行期不再有 `pending-open-paths` 事件，前端只在启动时 drain 一次 `drain_pending_open_paths`。
- **打包前必须确认没有 Vellum 实例在跑**（`Get-Process vellum` 为空）：release 二进制被占用时 `npm run tauri build` 会在链接阶段报 `failed to remove file ... vellum.exe / os error 5 拒绝访问`。
  - 且**前端产物已构建完成**，很容易误以为是代码错。先 `taskkill /IM vellum.exe /F` 再打包。

### 生产构建专属坑（真机才会暴露，jsdom 与 dev 模式下全绿）

- capabilities 必须有 `core:window:allow-destroy`：`onCloseRequested` 的 JS 包装层在处理器**不拦截**时会调 `destroy()`，只声明 `allow-close` 是不够的。
  - 缺权限则**窗口永远关不掉**（真机 Console：`Command plugin:window|destroy not allowed by ACL`）。
  - 同理关闭处理器必须有异常兜底（任何意外都放行关闭，否则一次抛错就把窗口永久留住）。
- capabilities 必须有 `core:window:allow-set-title`：窗口标题随文档（T5）走 OS 级 `getCurrentWindow().setTitle()`。
  - 缺权限则标题写不进去，且**只在真机 Console 报 ACL 拒绝**（`Command plugin:window|set_title not allowed by ACL`），jsdom 里 mock 掉 window API 的用例照样全绿。
  - 同理 `updater:default`（自动更新）——四个命令 `check` / `download` / `install` / `download-and-install` 都在这一套里；漏掉则启动检查静默失败（错误被 `src/main.tsx` 吞掉，只会落 console）。
- CSP 必须含 `connect-src ipc: http://ipc.localhost`：缺它会回落到 `default-src 'self'` 把 IPC 拦掉。
  - 后果：`plugin:store`（阅读位置 / 侧栏状态 / 上次打开）与 `plugin:event`（`file-changed` / `mdlog-state-changed`）在整个生产构建里**全程走 postMessage 降级通道并持续报错**（`main.rs` 有断言 CSP 字符串全等的测试，改 CSP 必须同步改它）。

### 发布与自动更新（签名密钥 / `latest.json`）

- 自动更新走 `tauri-plugin-updater`：Rust 侧在 `src-tauri/src/main.rs` 注册（`tauri_plugin_updater::Builder::new().build()`），npm 侧 `@tauri-apps/plugin-updater`；检查挂在 `src/main.tsx` 的启动路径上。
  - **只在生产构建里跑**（`import.meta.env.PROD` 守卫）：dev 实例不该被 release 包自动替换。检查失败 / 无更新 / 下载失败一律静默，只在「签名校验通过的包已下载」之后才出 `.editor-toast` 提示。
- **发布前必须先有签名密钥对**：`npm run tauri signer generate -- -w ~/.tauri/vellum.key`（等价于 `tauri signer generate`，会一并打印公钥），把**公钥**填进 `tauri.conf.json` 的 `plugins.updater.pubkey`。
  - 当前 `pubkey` 是占位串 `PLACEHOLDER_REPLACE_WITH_TAURI_SIGNER_GENERATE_PUBKEY`：占位状态下 `download()` 的签名校验必然失败 ⇒ 更新链路整体 inert，不会误装任何包。这也是「自动更新不会在开发机上乱动」的第二层保险。
  - 私钥与其密码只进 CI secret（`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`），**不入库**。
- `bundle.createUpdaterArtifacts: true` 已开：打包额外产出安装包的 `.sig` 签名文件（NSIS 下是 `*-setup.exe` 与 `*-setup.nsis.zip` 各一份 `.sig`）。
- **`latest.json` 不由本地打包产出**：按 Tauri 的格式（`version` / `pub_date` / `platforms."windows-x86_64".{url,signature}`）由 CI / 发布流程生成，作为 release 资产上传；endpoint 固定指向 `https://github.com/HwFee/vellum/releases/latest/download/latest.json`。
- CSP 的 `connect-src` 额外放了 endpoint 域名 `https://github.com`。实际的 HTTP 请求在 Rust 侧（reqwest）发出，CSP 管不到它——这一条是防御性声明，别据此推断「更新走 webview fetch」。
- 真机更新链路（拉起 NSIS 安装器 → 进程退出 → 重启到新版本）**需要真公钥 + 真实 release 才能验证**，未纳入本轮验收；Windows 上 `install()` 会先 `ShellExecuteW` 安装器再 `std::process::exit(0)`，因此「重启后生效」那条提示在 Windows 上基本看不到（下载阶段那条能看到）。

### 真机探针脚本

- 真机验证入口：`scripts/cdp-verify.mjs`——以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 启动 release exe。
  - 再用 Node 原生 WebSocket 走 CDP 断言：CSP 违规数 / ACL 拒绝数 / 笔⇄书图标 / 单位块数量 / 点 ✕ 后 page target 归零。
- 真机滚动/锁存探针：`scripts/cdp-perf-scroll.mjs`（`npm run perf:scroll`）。
  - 合成手势逐 widget 判锁存 + 帧时序 / 进程级 CPU / 可选 trace 归因 + 每个沙箱子帧的根溢出保护断言。
  - 跑前必须 `taskkill /IM vellum.exe /F`（多实例后新实例不再被吞，但并存实例的 WebView2 会污染 CPU/帧时序读数，preflight 仍要求独占）。方法论与踩坑写在脚本头部注释。
- 真机「侧栏开关跳位」探针：`scripts/cdp-sidebar-jump.mjs --file <真实.md>`。
  - 逐帧对比「钉住元素相对容器顶偏移」与 scrollTop/文档高/正文宽，分**帧内读数**与**绘制后读数**两个数（只有后者是用户看到的画面：rAF 内的修正回调早于探针采样时，帧内读数会记下修正前的状态）。
  - 自带四个相位/实验：关侧栏 / 开侧栏 / 窗口缩放（Emulation）/ 拖宽手柄（合成指针），以及「瞬时改宽」与「关停全部 CSS 过渡的侧栏开关」两组对照，并回放 scrollTop 写入来源栈。
  - **必须先派一次 wheel 再等 6s**，否则阅读位置落位守护的缓动动画会污染测量。
- 真机锚定规则对照：`scripts/cdp-anchor-synthetic.mjs`——纯合成滚动容器里「改宽度 vs 改字号」的锚定矩阵，确认「行内尺寸变化不补偿」是**浏览器规则**（同一容器改字号正常补偿、改宽度恒为 0），与项目结构无关。
- 真机 Obsidian 验收：`scripts/cdp-obsidian-verify.mjs`——完整说明（断言清单、定稿形态三条真机证据、边框宽度按区间判、实测数字）见 `docs/agents/obsidian.md`。

### `tauri/custom-protocol` feature

- **`tauri/custom-protocol` feature 是生产上下文的开关**（tauri 2.11 的 `dev = !custom_protocol` 判定）。
- `Cargo.toml` 已显式声明，缺失它的构建会产出 dev 上下文 exe——窗口加载 `http://localhost:1420`、不嵌入前端资源，无 dev 服务器时显示「localhost 拒绝连接」。
- 打包始终用 `npm run tauri build`（CLI 也会自动注入该 feature）；改 Rust 代码后验证可用裸 `cargo build --release`（manifest 已声明，结果一致）。

## 文件索引

| 文件 | 职责 |
|------|------|
| `promo/index.html` | 宣传落地页（单文件、内联 CSS、零依赖，片可切中/英） |
| `promo/build-assets.mjs` | 从成片导出对外分发的整套宣传材料（中英两套） |
| `video/src/theme.ts` | 宣传片的品牌 token 与中英两套文案（视频侧单一事实来源） |
| `video/src/locale.tsx` | 语言闸门（useCopy / useShot / useMetaFont） |
| `video/capture/capture.mjs` | CDP 抓真实窗口素材（窗口图 + 全高长图） |
| `scripts/check-obsidian-corpus.test.tsx` | Obsidian 全库语料检查（真实渲染管线跑 wisdom 每一篇 `.md`，三族语法各计识别数 + 未处理构造必须为 0） |
| `scripts/check-obsidian-corpus.mjs` | 语料检查入口（拉起 vitest 并透传退出码；检查本体在 .test.tsx 里，见文件头注释） |
| `scripts/cdp-obsidian-verify.mjs` | 真机验收 CDP 探针（完整说明见 `docs/agents/obsidian.md`） |
