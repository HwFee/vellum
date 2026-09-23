# 工程环境、技能、宣传品与发布

`AGENTS.md` 的详情分册。收录三个执行入口的真实 shell、技能安装流程与 pi 扩展、性能优化技能表与死规则、入口 chunk 尺寸历史，以及打包与生产构建的注意事项、签名与发布、真机探针、`tauri/custom-protocol` feature。

## 跑命令用哪个 shell（三个入口不是一个 shell）

| 入口 | 实际 shell | 语法 |
|------|-----------|------|
| 前台 `bash` 工具 | Git Bash / MSYS，bash 5.3.15 | POSIX（`&&`、`$(…)`、`for … do … done`） |
| `bg_run` 后台任务 | **会变，别按表猜** | 不保证，先探明 |
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
- 每个项目通过**目录联接**引用仓库中的技能，**不拷贝**（`.pi/skills/<skill-name>` 均为联接，永不入库；`.gitignore` 已忽略 `.pi/`）。
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
- 阅读器完善计划（2026-09-20，task 2–12）：
  - **计划各任务落地后为 184.19KB**（controller 记录，未逐任务留档）：设置面板 / 最近打开 / 导航历史 / h1–h6 大纲 / 任务勾选 / 打印样式 / 自动更新 / UI 修复批量一批增量累计 +18.6KB（设置变量消费、`recentFiles.ts`、`navHistory.ts`、`taskList.ts`、`scrollRestore` 复用、updater 启动检查、几处渲染与快捷键接线）。
  - **终验 fix wave 后为 184.43KB**（`index-icw-KE6P.js`，gzip 52.53KB，再 +0.24KB：代际 getter 接线、搜索 pending 抑帧、`Ctrl+P` 守卫、提示条 key 前缀、`isScrollInputKey`、阅读设置落盘改 effect）——**2026-09-20 终验实测**（`npm test` 45 文件 / 914 用例全绿（终验后又 +1：弹层锚定断言）、`npm run build` 通过）。同一轮复审的打印级联修复只改了 CSS 与断言：JS 尺寸不变（184.43KB / gzip 52.53KB），只换了内容哈希（`index-BJne7Dx_.js` → `index-icw-KE6P.js`）；入口 CSS 从 33.41KB / gzip 6.82KB 涨到 **33.43KB / gzip 6.83KB**（`index-j3mC1w28.css`，**+13 字节 = 末尾段新增 `.mdlog-live{display:none}`（25 字节）− 主段清单去掉 `,.mdlog-live`（12 字节）**，即规则挪位本身；与注释无关——生产 CSS 经压缩、注释已被剥离，`grep -c` 在产物里找不到注释文字）。
- 若后续继续增长，按裁定 F11 的退路把单元计算移回 lazy 侧。
- 设置页 / 顶栏 B / 勾选定稿（2026-09-20 第二批，T1–T3）：
  - **终态为 192.90KB**（gzip 54.69KB，再 +8.47KB / +2.16KB：设置页两个新组件 `SettingsView` / `SettingsNav` 与顶栏齿轮按下态接线、`updater.ts`（`checkForUpdates` 抽公共）、`appPreferences.ts`、`recentFiles.clearRecentFiles`、`useOutlineSync` 的 `revision` 参数、勾选写回接线）——**2026-09-21 实测**（`npm test` **48 文件 / 969 用例**全绿、`npm run build` 通过）。
    - 分两次读数：T2 落地后 **192.86KB / gzip 54.68KB**，T2 审阅修复（窄屏 Escape 依赖表 + 进设置视图归零）后 **192.90KB / gzip 54.69KB**；T3 只改 CSS 与断言，JS 尺寸不变。
- **v1.11.0 图标动效后为 204.65KB**（`index-E30tNwKl.js`，gzip 58.21KB）——**2026-09-23 实测**（`npm test` 51 文件 / 998 用例全绿、`npm run build` 通过）。+11.75KB 的大头是 v1.10.0 导出 PDF 那批（`ExportPdfView` / `exportDocument` / `exportLayout` / `exportPagination` 进入口链），图标动效本体只添了 svg 属性与一个 `useState`；入口 CSS 涨到 **43.82KB / gzip 8.60KB**（`index-BSYYaWY-.css`，含导出舞台段与图标动效段）。
  - 入口 CSS 从 33.43KB / gzip 6.83KB 涨到 **34.74KB / gzip 7.04KB**（+1.31KB）：设置视图段与三个迁出的通用类（`.segments` / `.seg`、`.text-button`、`.button.button-ghost`）、齿轮按下态、勾选定稿（自绘方框 + 钤印 + 划线）与打印覆写；同时删掉 `.settings-popover*` / `.settings-anchor`，打印隐藏清单去掉 `.settings-popover`。

## 注意事项

- **多实例（2026-09-12）**：无单实例锁（`early_single_instance` 模块与 `tauri-plugin-single-instance` 均已移除），每次启动都是独立进程/窗口，各自从命令行参数加载自己的文档。
  - settings Store 跨进程共享、后写覆盖——阅读位置按文件路径键控，不同文件的实例互不干扰；同一份设置（侧栏宽等）以最后退出者为准。
  - 运行期不再有 `pending-open-paths` 事件，前端只在启动时 drain 一次 `drain_pending_open_paths`。
- **直接跑过 `cargo check` / `cargo test` 之后，`tauri dev` 可能起成「生产模式」实例**（2026-09-21 导出 PDF 验收时踩实）：cargo 复用了不带 Tauri CLI 环境变量的构建脚本产物，二进制把 `devUrl` 丢掉了——页面落在 `http://tauri.localhost/`、加载**二进制里内嵌的旧 dist**（资源在 `generate_context!()` 编译期内嵌），而不是 vite dev server。症状：改前端代码、硬刷新、甚至 `ignoreCache` 重载都不生效，CSS 永远是旧的。判别：CDP 里看 `location.href`（dev 应是 `http://localhost:1420/`）。处置：`npm run build` 刷新 dist 后重启 dev（dist 变动会让 tauri-build 重跑、重新内嵌）；要严格对齐 dev 行为就先 `cargo clean -p vellum` 再 `tauri dev`。
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

- 自动更新走 `tauri-plugin-updater`：Rust 侧在 `src-tauri/src/main.rs` 注册（`tauri_plugin_updater::Builder::new().build()`），npm 侧 `@tauri-apps/plugin-updater`；检查逻辑集中在 `src/lib/updater.ts`（`checkForUpdates(manual?)`，`Update` 句柄在 `finally` 里 `close()`，提示条复用 `.editor-toast` 挂在 body 上）。两个入口：`src/main.tsx` 的启动静默路径（先读 `src/lib/appPreferences.ts` 的 `autoCheckUpdates`，为开才查；读盘不阻塞渲染）与设置页「更新 · 立即检查」（**不看**该开关，结果一律回执）。
  - **自动路径只在生产构建里跑**（`canInstall` 由 `import.meta.env.PROD` 初始化，测试经 `__setUpdaterInstallForTest` 打开——否则「启动静默更新」这条路径在测试里永远不可达）：dev 实例不该被 release 包自动替换。无更新 / 检查失败 / 更新失败一律静默（失败时把已出的提示撤掉，只落 console）；拿到更新就**先出提示再下载**——Windows 上安装会拉起安装器并退出进程，这条提示是「应用即将关闭」的唯一预警。
  - 手动路径（`manual = true`）无论开关都查，结果一律回执：有新版本同一句「发现新版本，重启后更新」（不可安装时只报告、不替换当前进程）、已最新「已是最新版本」、失败「检查失败，稍后再试」；回执 4 秒自动消失（自动路径那条不设时限）。
- **发布前必须先有签名密钥对**：`npm run tauri signer generate -- -w "%USERPROFILE%\.tauri\vellum.key"`（等价于 `tauri signer generate`，会一并打印公钥），把**公钥**填进 `tauri.conf.json` 的 `plugins.updater.pubkey`。
  - **`-w` 要给 Windows 绝对路径**：cmd 不展开 `~`，写 `~/.tauri/vellum.key` 会在当前目录建出一个名字真叫 `~` 的目录（Git Bash 里 `~` 才有意义，别照抄 Unix 文档）。
  - `pubkey` 自 v1.9.0（2026-09-21）起是**真公钥**：密钥对由 `tauri signer generate -- -w "%USERPROFILE%\.tauri\vellum.key" --ci` 生成（无密码），私钥在本机 `~/.tauri/vellum.key`，**不入库**；换机器发版需把私钥串设进 `TAURI_SIGNING_PRIVATE_KEY` 才能出 `.sig`。占位串时期的性质仍适用于 1.8.x 旧实例：`check()` 不验签、install inert 但 download 不 inert——latest.json 上架后每个 1.8.x 实例每次启动都会把 ~21MB 安装包白下完再静默验签失败（已知代价，release notes 已注明 1.8.x 需手动覆盖安装一次）。
  - 私钥与其密码只进 CI secret（`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`），**不入库**。
- **时序红线：先换真公钥，再让 CI 产出并上传 `latest.json`**（反过来做会伤到每个用户）：`check()` 只看 endpoint 上的 `version`，**不验签**——只要 `latest.json` 在，占位 pubkey 期间的每个实例都会把 ~21MB 安装包整个下完，然后卡在 `download()` 的签名校验上失败。用户看到的是提示条闪一下又消失（失败静默），代价是白下载一次；每次启动都来一遍。正确顺序：① `signer generate` ② 公钥进 `tauri.conf.json` 并发版 ③ 才开始产 `latest.json`。
- `bundle.createUpdaterArtifacts: true` 已开：打包额外产出安装包的 `.sig`（2026-09-20 实测 NSIS 只产出**一份** `bundle/nsis/*-setup.exe.sig`，没有 `.nsis.zip`——`.exe` 本体就是更新包，插件侧走 `extract_exe`）。
- **开了它之后，打包就必须有私钥**（2026-09-20 实测，别被误导）：`npx tauri bundle`（`npm run tauri build` 同理）会**先把安装包产出来**，再报
  `A public key has been found, but no private key. Make sure to set TAURI_SIGNING_PRIVATE_KEY environment variable.`
  并以**退出码 1** 结束——即 `bundle/nsis/*.exe` 在，命令算失败，且没有 `.sig`。
  - 实测**只有 `TAURI_SIGNING_PRIVATE_KEY`（密钥串本身）被认**；把 `TAURI_SIGNING_PRIVATE_KEY_PATH` 指到 Windows 路径那次仍报 no private key（未深究，CI 用密钥串即可）。设对之后退出码 0，并多出一行 `Finished 1 updater signature at: ...\*-setup.exe.sig`。
  - 只想在本地验证打包链路：要么设 `TAURI_SIGNING_PRIVATE_KEY`（+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`），要么临时把 `bundle.createUpdaterArtifacts` 改回 `false`（验证完记得改回来，否则不发 `.sig`，更新链路永远失败）。
- **`latest.json` 不由本地打包产出**：按 Tauri 的格式（`version` / `pub_date` / `platforms."windows-x86_64".{url,signature}`）由 CI / 发布流程生成，作为 release 资产上传；endpoint 固定指向 `https://github.com/HwFee/vellum/releases/latest/download/latest.json`。
- **`plugins.updater.requireSignedVersion` 现在不能开**（2026-09-20 实测，评审建议的硬化项）：插件从签名 trusted comment 里读 `version:` 字段来比对 endpoint 公告的版本（`tauri-plugin-updater/src/updater.rs` 的 `verify_signed_version`），开了之后**签名里没有该字段就直接 `Err(MissingSignedVersion)`**。而本仓库 pin 的 CLI（`@tauri-apps/cli` 2.11.4）签出来的 trusted comment 只有 `timestamp:` 与 `file:`——把刚打出来的 `*-setup.exe.sig` base64 解开看，形如
  `trusted comment: timestamp:1789901448\tfile:Vellum_1.8.1_x64-setup.exe`，**没有 `version:`**。结论：现在打开它 = 每一次更新都验签失败（更新链路整体死掉），比默认的「可被构造响应强制降级」更糟。等 CLI 版本开始在 trusted comment 里写 `version:`（用同一手法解一个 `.sig` 确认）之后再开，并注意届时旧 release 的签名仍无该字段、需要重签重发。
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
- **待办真机项：`Ctrl+P` 打印**（2026-09-20 起挂起，未验证）。WebView2 有 `ShowPrintUI` / `Print` / `PrintToPdf` 三条 API，微软反馈 #42 也确认 `window.print()` 经 `ExecuteScript` 可用，但本机从未真的弹过一次打印对话框。验证方式：先 `taskkill /IM vellum.exe /F` → `npm run tauri build` → 以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 起 release exe → 按 `scripts/cdp-verify.mjs` 的模式连 CDP，`Runtime.evaluate` 里看 `typeof window.print`，再用 `Input.dispatchKeyEvent` 派一次真实 `Ctrl+P` 看对话框是否弹出（**别**在无头/自动化里直接调 `window.print()`：原生打印对话框是模态的，脚本侧关不掉）。确认通过后 README 的 Usage 才能补这条快捷键（`docs/agents/rendering.md` 打印一节同理）。

### `tauri/custom-protocol` feature

- **`tauri/custom-protocol` feature 是生产上下文的开关**（tauri 2.11 的 `dev = !custom_protocol` 判定）。
- `Cargo.toml` 已显式声明，缺失它的构建会产出 dev 上下文 exe——窗口加载 `http://localhost:1420`、不嵌入前端资源，无 dev 服务器时显示「localhost 拒绝连接」。
- 打包始终用 `npm run tauri build`（CLI 也会自动注入该 feature）；改 Rust 代码后验证可用裸 `cargo build --release`（manifest 已声明，结果一致）。

## 文件索引

| 文件 | 职责 |
|------|------|
| `src/lib/updater.ts` | 更新检查（启动静默路径 + 设置页「立即检查」，提示条复用 `.editor-toast`） |
| `src/lib/appPreferences.ts` | 界面行为偏好（`sidebarOpenOnLaunch` / `autoCheckUpdates`，与 `outlineWidth` 同一个 settings Store） |
| `src/components/SettingsView.tsx` | 设置视图四节内容栏（`SETTINGS_SECTIONS` 分节清单唯一来源） |
| `src/components/SettingsNav.tsx` | 设置视图的侧栏内容（复用 `.outline-panel*` / `.outline-search*` 语汇） |
| `scripts/check-obsidian-corpus.test.tsx` | Obsidian 全库语料检查（真实渲染管线跑 wisdom 每一篇 `.md`，三族语法各计识别数 + 未处理构造必须为 0） |
| `scripts/check-obsidian-corpus.mjs` | 语料检查入口（拉起 vitest 并透传退出码；检查本体在 .test.tsx 里，见文件头注释） |
| `scripts/cdp-obsidian-verify.mjs` | 真机验收 CDP 探针（完整说明见 `docs/agents/obsidian.md`） |
