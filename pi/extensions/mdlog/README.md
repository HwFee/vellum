# pi-mdlog

Pi 对话实时记录扩展（Live Markdown Logger for Vellum）。在 Vellum 仓库中启动 pi 后直接执行：

```text
/mdlog outputs/session.md
```

扩展由仓库内入库的 `.pi/settings.json` 声明加载（`{"extensions": ["../pi/extensions/mdlog"], "skills": ["../pi/skills"]}`），**仅在本仓库内生效**，不污染全局 `~/.pi/agent/extensions/`，其他项目不会多出命令或工具。运行时仅依赖 Node.js 内置模块，`@earendil-works/pi-coding-agent` 仅作类型引用。

## 核心能力

- **书札版式实时落盘**：文件首行只写隐形会话指纹 `<!-- mdlog:v1 s=<sessionId> -->`；用户回合写为 `>` 引用块（Vellum 渲染朱红章点与顶线），助手回合写为 `<p class="mdlog-who"><strong>Pi</strong> · HH:MM</p>`，回合间以 `---` 与留白分隔，Vellum 靠文件监听实时热重载。
- **同角色碎片合并与原子重写**：连续同角色消息自动合并为单一回合（批内拼装 + 跨批文件尾 `endsWith` 校验后经临时文件 + `rename` 原子替换，遇外部编辑自动降级为独立追加）。
- **逐字节空行与智能追加**：O(1) 读取文件尾部补齐 `\n\n`；尾向扫描回退至当前分支锚点（忽略代码块内伪锚点），未命中时按首行指纹分流询问或原子前置文件头全量回填。
- **图示无感投递（`vellum_figure`）**：连接期间自动向工具表注入 `vellum_figure`。Agent 传入草稿 HTML 路径后只在回复正文放一行短标记 `<!-- mdlog-fig:ID -->`，写入器落盘前将其展开为 ```` ```vellum-widget ```` 围栏（漏放标记的图在回合结束或断开时自动补写到末尾），避免几 KB 源码刷屏对话流。
- **本地图片安全同步**：以会话 `cwd` 为基准经 `realpath` 校验包含关系，同名物理文件去重复制至 `mdlog-assets/`，单趟占位替换杜绝重复前缀，带单图体积与目录配额上限。

## 命令用法

- `/mdlog <文件路径> [--full | --append | --no-open]`：连接目标 `.md` / `.markdown` 文件并开始记录（路径含空格时用引号包裹）。
  - `--full`：强制回填当前分支全部历史消息。
  - `--append`：仅追加连接建立后的新消息。
  - `--no-open`：只写文件，不自动唤起 Vellum 窗口。
- `/mdlog status`：查看当前连接的日志文件、已写入消息数、最近写入时间与会话 ID。
- `/mdlog off`：等待在途写盘队列全部落定后断开连接，并清理 `.mdlog` sidecar 状态文件与 `vellum_figure` 工具。

> 若环境中其他扩展已占用 `/mdlog`，pi 会自动将命令顺延为 `/mdlog:1`，参数语义完全一致。

## 图示投递流程（`vellum_figure`）

1. 将经过校验的 HTML 草稿交给工具（优先传 `path`，内联 `html` 仅用于极小片段）：
   ```text
   vellum_figure(path: "/tmp/vellum-widget-draft.html", title: "傅里叶级数逐阶合成")
   → 已投递图示 f3a1（傅里叶级数逐阶合成 · 8.4 KB）。把它单独成行放在图应出现的位置：
     <!-- mdlog-fig:f3a1 -->
   ```
2. 将返回的 `<!-- mdlog-fig:f3a1 -->` 单独成行放入回复正文对应位置（引子之后、图注之前）。
3. 写入器在落盘时把标记原地展开为 ```` ```vellum-widget ```` 围栏（若内部含反引号串，自动加长外层围栏），终端 TUI 中则折叠显示为 `▤ 图 · 标题 · 8 KB`。

## 跨包契约（与 Vellum 宿主对齐）

1. **sidecar 路径**：恒为 `<日志文件全路径>.mdlog`，含 `version / sessionId / pid / connectedAt / lastWriteAt / heartbeatAt / anchorLost?`。
2. **首行指纹**：恒为 `<!-- mdlog:v1 s=<sessionId> -->`，是 Vellum 判定 mdlog 文档的唯一凭据。
3. **围栏标识**：交互与静态图围栏语言名恒为 `vellum-widget`。
4. **零长连接**：pi 与 Vellum 仅通过 Markdown 文件监听与 `.mdlog` sidecar 心跳协作。
5. **标记不落盘**：`<!-- mdlog-fig:<id> -->` 必须在写入器内展开完毕，不得残留在最终 `.md` 文件中。

## 配置（`config.json`）

| 字段 | 默认值 | 说明 |
|---|---|---|
| `toolNames` | `[]` | 非空时仅从指定工具的 `tool_execution_end` 输出中提取图片路径 |
| `imageExtensions` | `png/jpg/jpeg/gif/webp/bmp` | 允许复制的图片扩展名（`svg` 始终排除） |
| `maxImageBytes` | `20971520` | 单张图片字节上限（20 MB，下限夹取至 1 KB） |
| `assetRetentionMb` | `200` | `mdlog-assets/` 目录总配额上限（MB，下限夹取至 1 MB） |
| `imageCopyTimeoutMs` | `5000` | 单图异步复制超时（ms，关闭刷盘时收紧至 1000 ms） |
| `vellumPath` | `""` | Vellum 可执行文件绝对路径（高于环境变量 `MDLOG_VELLUM_PATH` 与默认安装位探测） |

## 本地开发与测试

在 `pi/extensions/mdlog/` 目录下执行（需 Node.js ≥ 22.6 原生 TS 类型剥离支持）：

```bash
npm test            # 运行 node:test 测试套件（157 个用例）
npm run typecheck   # 运行 tsc --noEmit 类型检查
```

首次克隆仓库或清理目录后，若需在扩展目录独立运行 `npm test` 或 `npm run typecheck`，先建立指向全局 pi 安装位的三项 Junction（删除时只用 `Remove-Item` 单条或 `[System.IO.Directory]::Delete`，切勿递归删除目标目录）：

```bash
node -e "const fs=require('fs');const PI='<全局 pi 安装位>/node_modules/@earendil-works/pi-coding-agent';for(const p of ['typebox','@earendil-works/pi-tui','@earendil-works/pi-coding-agent'])fs.symlinkSync(PI+'/node_modules/'+p,'node_modules/'+p,'junction')"
```
