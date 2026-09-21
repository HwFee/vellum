# pi-mdlog

Pi 对话实时记录扩展（Live Markdown Logger for Vellum）。运行依赖只有 Node.js 内置模块；
`@earendil-works/pi-coding-agent` 仅作类型用途。

**源码住在本仓库**（`Vellum/extensions/mdlog/`，2026-09-16 从 `~/.pi/agent/extensions/mdlog` 迁入）。
pi 只扫 `~/.pi/agent/extensions/`，所以那个位置是一条指向本目录的目录联接——**克隆仓库后必须重建**，
否则实时日志会静默失效（pi 不会报错，只是当扩展不存在）：

```bash
node -e "const fs=require('fs');fs.symlinkSync('C:/Users/17445/Desktop/Vellum/extensions/mdlog','C:/Users/17445/.pi/agent/extensions/mdlog','junction')"
```

## 特性

- **MD 文件即真相**：把与 Agent 的对话实时追加为排版规范的 Markdown，Vellum 侧靠文件监听实时热重载。
- **书札版式（v3.1）**：文件头只有隐形指纹（不写可见标题）；助手说话人标签为
  `<p class="mdlog-who"><strong>Pi</strong> · HH:MM</p>`，宿主 `src/styles/kami.css` 按该类名挂章点；用户回合用
  blockquote 首段。`---` 回合分隔线在 Vellum 内被 `hr { display: none }` 视觉隐藏，留白节奏分回合。
- **碎片合并**：同角色连续消息合并为一个回合块——批内拼装 + 跨批次/文件尾合并重写
  （文件尾 `endsWith` 校验，外部编辑则降级为独立追加）；合并重写走临时文件 + rename 原子替换
  （EPERM 微重试），杜绝并发读者读到 0 字节窗。
- **逐字节空行契约**：锚点注释与 `---` 前后恒有 `\n\n`，追加前按文件尾部状态补足（O(1) 尾部读取），
  外部编辑器剥掉尾换行也不会把 `---` 与新块黏成一行。
- **智能追加**：尾向扫描回退到「属于当前分支」的锚点（不是首个正则命中）；忽略围栏内与行内伪锚点；
  命中不到时按首行会话指纹分流（4a 询问/仅追加，4b 原子前置文件头并全量回填）。
- **图片安全管线**：候选路径以会话 cwd 为唯一基准、realpath 做包含性判定；同物理文件只复制一次；
  正文重写单趟化（占位 token）杜绝 `mdlog-assets/mdlog-assets` 双前缀；异步复制 + 超时（定时器 clear + unref）；
  `maxImageBytes` / `assetRetentionMb` 配置下限 clamp。
- **图投递（`vellum_figure` 工具）**：Agent 把图示 HTML 交给工具（通常给已 lint 的草稿文件路径），
  正文里只留一枚短标记 `<!-- mdlog-fig:ID -->`，写入器在落盘前把它展开回 ```` ```vellum-widget ````
  围栏——**日志文件与手写围栏逐字节同形**（Vellum 侧零改动），只是几 KB 源码不再经过对话记录。
- **断网沙箱交互**：原样支持 ```` ```vellum-widget ```` 自包含 HTML 演示块（出网注入由 Vellum 侧 Rust 完成）。
- **健壮性**：sidecar 任何写失败都被隔离（不得冒泡成 uncaughtException 杀死宿主会话）；
  心跳定时器 unref；`/mdlog off` 的 discard 语义会真正等在途写链 settle，断开后无迟到写盘。

## 命令用法

- `/mdlog <文件路径> [--full|--append|--no-open]`：连接指定 Markdown 并开始记录。
  - `--full`：强制回填全量历史；`--append`：强制仅记录连接后的新消息；`--no-open`：不自动唤起外部应用。
  - 路径含空格时可用成对引号包裹；只接受 `.md` / `.markdown`（手动与自动重连同一道闸）。
- `/mdlog off`：断开当前记录连接并清理 sidecar 状态（等待在途写链 settle）。
- `/mdlog status`：显示连接文件、已写消息数、最近写入时间与会话标识。

## 图示投递（`vellum_figure` 工具）

Agent 直接在回复正文里写 ```` ```vellum-widget ```` 时，几 KB HTML 会逐字进日志与对话记录——
正文后面挂一条源码长龙。改走工具：

```
vellum_figure(path: "/tmp/vellum-widget-draft.html", title: "傅里叶级数逐阶合成")
→ 已投递图示 f3a1（傅里叶级数逐阶合成 · 8.4 KB）。把它单独成行放在图应出现的位置：
  <!-- mdlog-fig:f3a1 -->
```

- **`path` 优先**：草稿文件路径（cwd 相对或绝对；Git Bash 的 `/tmp/x.html` 回退到系统临时目录）。
  源码连对话都不经过。内联 `html` 只适合小图。
- **落位**：标记整枚照抄、单独成行，放在图该出现的位置（图前引子之后、图注之前）。
  写入器落盘时展开成围栏，正文里的标记不会出现在日志里。
- **兜底**：投递了却忘放标记的图，在该回合末（`agent_settled`）追加到回合末尾——宁晚不丢；
  断开连接时也会补写，不留给下次连接。
- **屏幕不脏**：工具行与结果行都是压缩的一行；另一条 markdown transformer 把标记在 pi 的
  交互式记录里改写成 `▤ 图 · 标题 · 8 KB`（只作用于 TUI 渲染，不碰落盘路径）。
- **只在记录期间可用**：mdlog 是全局扩展，未连接时工具会被摘出工具表（`setActiveTools`），
  不在无关项目里多出一个工具。
- **回填不丢图**：图随 `pi.appendEntry("mdlog:figure", …)` 落进会话条目，`--full` 回填时从
  branch 还原 id→HTML，标记照旧能展开。

### 同名命令冲突

若 `pi` 环境中已有其它扩展注册了 `/mdlog`，pi 会自动把本扩展的命令改名为 `/mdlog:1`（依次递增）。
此时请使用带后缀的命令；`description` 与参数语义完全相同。

## 文件布局

```
~/.pi/agent/extensions/mdlog/
├── index.ts          # 扩展入口：命令注册与五个生命周期事件的接线
├── config.json       # 可选配置（工具白名单 / 图片扩展名与体积 / 唤起路径）
├── src/
│   ├── types.ts      # 共享类型（纯类型，无运行时代码）
│   ├── format.ts     # 纯函数格式化器（逐字节决定写入形态）
│   ├── scan.ts       # 智能追加：锚点回退扫描、指纹分流、4b 原子前置
│   ├── image.ts      # 图片候选提取 / 净化 / 复制 / 配额清理
│   ├── figures.ts    # 图示投递：标记、围栏生成、HTML 校验、草稿路径解析、展开
│   ├── tool.ts       # vellum_figure 工具定义（参数校验 + 压缩显示）
│   ├── writer.ts     # 串行实时写入器（防抖、重试、碎片合并、图展开与兜底、断开闸）
│   ├── sidecar.ts    # sidecar 状态机与心跳（异常隔离 + unref）
│   └── command.ts    # 命令解析、状态输出、唤起 Vellum
└── test/             # node:test 套件（152 用例 / 41 套件）
```

两条实现纪律（都是被 Node 的类型剥离解析器咬过的）：

- **正则字面量里不写反引号**：`node --test` 直接跑 TS（类型剥离）时，含反引号的正则字面量会让
  解析器丢同步，报 `ERR_INVALID_TYPESCRIPT_SYNTAX: Unterminated regexp literal`（模板串里出现
  连续反引号同理）。围栏字符一律走 `figures.ts` 的 `BACKTICK` 常量 + `repeat()` 拼；
  测试里需要用围栏字面量时用引号字符串，不要放进模板串。
- **围栏长度按内部最长反引号串 +1 自动加长**：图内出现 ```` ``` ```` 时外层必须更长的围栏，
  否则围栏提前闭合、HTML 漏进正文。

## 配置（`config.json`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `toolNames` | `[]` | 非空时只从这些工具的 `tool_execution_end` 输出里提取图片 |
| `imageExtensions` | png/jpg/jpeg/gif/webp/bmp | 允许同步的扩展名；`svg` 始终被剔除 |
| `maxImageBytes` | 20971520 | 单图字节上限（下限 clamp 到 1KB） |
| `assetRetentionMb` | 200 | `mdlog-assets` 配额（下限 clamp 到 1MB） |
| `imageCopyTimeoutMs` | 5000 | 单图复制超时；关档刷盘时压到 1000 |
| `vellumPath` | `""` | 唤起 Vellum 的可执行文件路径（高于 `MDLOG_VELLUM_PATH` 与安装位探测） |

> JSON 里的 Windows 路径必须写双反斜杠（`"C:\\Program Files\\Vellum\\Vellum.exe"`）。
> 写错转义只会让该候选失配，代码有 `fs.existsSync` 容错并自动回退到下一个候选。

## 跨包契约（不得漂移）

1. sidecar 路径恒为 `<日志文件全路径>.mdlog`，字段：`version/sessionId/pid/connectedAt/lastWriteAt/heartbeatAt/anchorLost?`；
2. 文件首行恒为会话指纹 `<!-- mdlog:v1 s=<sessionId> -->`（Vellum 受信门禁的唯一判据）；
3. 交互块围栏语言名逐字保持为 `vellum-widget`；
4. Vellum 与 pi 之间没有任何长连接，实时性只来自文件监听 + sidecar 心跳；
5. 图标记恒为 `<!-- mdlog-fig:<id> -->`，**只在写入器展开、绝不进日志文件**——日志里出现它
   就说明展开漏了（图没落位），与「日志文件与手写围栏同形」的承诺不符。

## 开发

```bash
npm test        # node --test test/**/*.test.ts（Node ≥ 22.6 才能原生跑 TS：类型剥离）
npm run typecheck   # tsc --noEmit（strict + erasableSyntaxOnly）
```

- 测试运行器为 Node 内置 `node:test`，零第三方测试依赖；本机 Node 24.16 已验证。
- **三处依赖解析，两套解析器**：pi 加载扩展时用 jiti 别名，`node --test` 与 `tsc` 走 Node 原生
  `node_modules` 解析。所以 `node_modules/` 下有指向**全局 pi 自带那份**的目录联接：
  `typebox`（`vellum_figure` 的参数 schema）、`@earendil-works/pi-tui`（渲染组件）、
  `@earendil-works/pi-coding-agent`（仅类型）。指向同一份是刻意的——两套解析拿到不同版本会漂移。
  克隆或重建本目录后需要补：

  ```bash
  node -e "const fs=require('fs');const PI='<全局 pi 安装位>/node_modules/@earendil-works/pi-coding-agent';for(const p of ['typebox','@earendil-works/pi-tui','@earendil-works/pi-coding-agent'])fs.symlinkSync(PI+'/node_modules/'+p,'node_modules/'+p,'junction')"
  ```
  `tsconfig.json` 只需为 `typebox` 留一条 `paths`（它的 `exports` 没有 `types` 条件，
  NodeNext 下 tsc 找不到声明文件）：`"typebox": ["./node_modules/typebox/build/index.d.mts"]`。
- 全部落盘均为同步调用（`appendFileSync` / `writeFileSync` + `renameSync`），事件 handler 里只做同步入队。

## 来源说明（2026-09-14 重建）

本目录曾于 2026-09 被清空（`~/.pi` 重建时丢失，无 git 远端、无回收站副本）。
本次重建的权威来源：

- 设计契约、基线实现与复审意见：`Vellum/docs/superpowers/**`（已于 2026-09-21 清理，从 git 历史取回）；
- 修复清单：`Vellum/outputs/mdlog/*-fix-log.md`（同上，git 历史）；
- 当时的验收语料：`Vellum/outputs/mdlog/acceptance-fixtures/`（同上）；

与原实现的已知差异：图片处理被提到重试圈外（原实现重试会重复复制图片、留下孤儿资产）；
`ensureTrailingNewlinesOnFile` 改为按文件尾部实测（原为每实例一次守卫，外部剥尾换行后接缝会黏连）。
