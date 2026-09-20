# Vellum · 素笺 — 阅读器完善计划（2026-09-20）

来源：2026-09-20 代码评审建议，用户逐条确认（特性 2–8 OK；特性 1 设置面板方案确认为顶栏弹层；另要求清理过期文档、基于新特性改进 UI）。「目錄」繁体标题保留不变（用户明确喜欢其文房气质）。

## Global Constraints（所有任务必须遵守）

1. `CodeBlock.tsx` 用 `PrismLight`，禁止切回 `PrismAsyncLight`。
2. 交给 react-markdown 的字符串永远是完整原文；块单元按绝对源码偏移工作。
3. `rehypeObsidian` 挂在 `rehype-sanitize` 之后、`rehypeEditUnits` 之前；katex 在 rehype 管线末尾。
4. `components` prop 必须是 `useMemo` 结果，引用稳定。
5. `.vellum-unit-wrap` 必须 `display: contents`；不得加尺寸/边框/ margin。
6. 离屏 widget 停帧用 `--parked`（`visibility: hidden`），禁止 `display:none`。
7. 侧栏开关与拖宽的全部入口必须走 `beginWidthTransition()`。
8. kami.css 新规则只要含 `.mdlog-widget` 字样，必须放在首个该选择器出现处之后；其他新 CSS 放在其之前。
9. 顶栏不显示文件名（`.top-bar__title` 已移除）；本计划的窗口标题是 OS 级 `setTitle`，不违反此条。
10. 设计语言（DESIGN.md）：单一靛青强调色（页面占比 ≤5%）、无深色模式、无渐变/色块、圆角 ≤6px、无 pill、字重 ≤500、动画 150–250ms 且尊重 `prefers-reduced-motion`。
11. 既有测试钉住的文案不得破坏：`打开文件` / `切换大纲` / `切换编辑视图` / `素笺` / `打开 Markdown 文件开始查看。` / `未打开文件`；改动这些需同步更新 `App.test.tsx` / `TopBar.test.tsx`。
12. 每个任务完成后 `npm test` 必须全绿；涉及 Rust 的任务 `cargo check --manifest-path src-tauri/Cargo.toml` 必须通过。改动 UI 的任务同步跑 `npm run build`（tsc + vite）。
13. 新增 UI 文案用简体中文；「目錄」侧栏标题保持繁体不动。
14. mdlog 记录中只读的三重门禁不得绕过：任何新的写盘入口（任务勾选）必须检查 `read_mdlog_state` 归一化（`?? null`）。
15. 不新增第三方运行时依赖（任务 10 的 tauri-plugin-updater 除外，它是本计划明确批准的）。

## Task 1 — 仓库卫生与过期文档清理

范围：`README.md`、`AGENTS.md`、`TODO.md`、`docs/agents/tooling.md`、`.gitignore`、`OPTIMIZATION_HANDOFF.md`（工作区已删除，随本任务提交删除）。

具体修订（以代码现状为准）：

- `README.md`：
  - 测试数改为「38 个测试文件 / 766 个用例」。
  - 删除对 `./OPTIMIZATION_HANDOFF.md` 的链接（第 102 行附近），改为指向 `docs/agents/` 分册或删除该句。
  - Download 一节：删除 MSI 条目，只保留 NSIS（`tauri.conf.json` `targets` 只有 `["nsis"]`），保留文件关联说明。
  - 列宽描述 `min(1080px, 100%)` 改为 `min(800px, 100%)`。
  - 删除「折叠在页边的脚注」表述（无对应实现），改为「脚注」或删除该短语。
- `AGENTS.md`：`npm test` 行改为「38 测试文件，766 用例」；删除「优化记录：`OPTIMIZATION_HANDOFF.md`」与末尾「完整优化记录见 OPTIMIZATION_HANDOFF.md（含评估后放弃的方向）」两处引用（文件已不存在）。
- `docs/agents/tooling.md`：删除对 `OPTIMIZATION_HANDOFF.md` 的引用（约 150 行），如该句承载信息则改写为指向 `CHANGELOG.md`。
- `TODO.md`：当前是同一份清单的两份拷贝（1–25 行已完成态 + 26–49 行原始待办态）。合并为一份，保留已完成记录；无未完成项则明确写「全部完成」。
- `.gitignore`：追加 `.commandcode/`、`.kimi-code/`、`.opencode/` 三行（参照已有 `.zcode/` 条目格式）。
- 提交工作区中已存在的 `OPTIMIZATION_HANDOFF.md` 删除。

无代码改动，无需新增测试。验收：grep 全仓 `OPTIMIZATION_HANDOFF` 无残留引用（CHANGELOG 历史条目除外，若有则不动历史）；`grep -n "1080" README.md` 无残留；`npm test` 不受影响。

## Task 2 — 阅读设置面板（顶栏弹层）

入口：顶栏左侧按钮簇末尾加分隔线 + 齿轮幽灵按钮（28×28，与其它幽灵按钮同规格），`aria-label="阅读设置"`，title `阅读设置`。

弹层 `SettingsPopover.tsx`（新组件）：ivory 底、1px `--border` 描边、6px 圆角、轻投影，锚定在齿轮下方右侧；点外部 / Escape 关闭。三行分段选择器：

- 正文字号：13 / 14（默认）/ 16 / 18
- 栏宽：720 / 800（默认）/ 960（px）
- 行高：1.5 / 1.55（默认）/ 1.7

底部「恢复默认」链接 + mono 小字「自动保存」。

实现要点：

- 持久化走现有 `@tauri-apps/plugin-store`（与 `outlineWidth` 同一 Store 文件），key `readerSettings`，结构 `{ fontSize: number, columnWidth: number, lineHeight: number }`。
- 应用方式：在 `document.documentElement` 上设 CSS 变量 `--reader-font-size` / `--reader-column-width` / `--reader-line-height`；kami.css 中正文 `.markdown-body` 的 `font-size` / `line-height`、`max-width: min(800px,100%)` 改为消费这些变量（带默认值回退 `var(--reader-font-size, 14px)` 等）。标题字号保持设计阶梯不动（h1/h2/h3 不随正文字号缩放），只改正文、引用、列表、表格、行内代码的基准字号——行内代码保持 12px 不变。
- 栏宽改动会触发整篇重排：切换栏宽/字号/行高时必须复用现有的「换版不跳位」机制（`viewportPin.ts`，与侧栏拖宽同路径）钉住视口。
- 热重载 / 换文档后设置仍然生效（变量挂在 documentElement，与文档无关）。

测试：新增 `SettingsPopover.test.tsx`（渲染三个分段组、点击切换触发回调、恢复默认）；`kami.css.test.ts` 增补断言变量消费与默认值回退。注意约束 8：新 CSS 段落插入位置。

## Task 3 — 小幅 UI 修复批量

全部为独立小修，一个任务内完成：

1. `OutlinePanel.tsx` 搜索框 idle 态的 kbd chip：`⌘K` 改为 `Ctrl K`（Windows 应用）。
2. 键盘：`Ctrl+B` 切换侧栏开/关（所有宽度下）；`Ctrl+K` 在侧栏已打开且搜索框已聚焦时第二次按下不动作即可，但 `Ctrl+B` 必须能关。所有开关走 `beginWidthTransition()`（约束 7）。更新对应 tooltip 文案为「切换大纲（Ctrl+B）」。
3. 顶栏大纲切换与打开文件按钮补 `title`（分别为「切换大纲（Ctrl+B）」「打开文件」），与编辑切换一致。
4. `ErrorState.tsx`：加「重新打开」实色按钮（触发打开文件对话框，由 App 传入回调）；按钮样式与任务 3.5 共用。
5. kami.css 补上缺失的 `.empty-eyebrow` 与 `.button.button-primary` 规则（`EmptyState.tsx` / `ErrorState.tsx` 现引用不存在的类）：eyebrow 用 `ui-mono` 10px / 500 / 大写感 / 4px 字距 / `--stone`；button-primary 用 warm-sand 底 + `inset 0 0 0 1px var(--hairline)` + 6px 圆角 + 7px 16px 内边距 + 500 字重，hover 加深 + `0 1px 2px` 4% 投影（对齐 DESIGN.md button-contained）。
6. 侧栏拖宽手柄（`App.tsx` 渲染处）加 `!isNarrow` 守卫——窄屏下正文不位移，拖了无意义。
7. 纱罩 z-index：`.narrow-scrim`（现 750）抬到 950，高于 `.custom-scrollbar`（900）与 `.reload-note`（900），保证窄屏浮层时侧栏外不可交互。先查 `kami.css.test.ts` 是否钉了这些值，若钉了同步改测试并说明理由。
8. `.document-scroll`（`tabIndex={0}`）补 `:focus-visible` 样式：2px 10% 靛青内发光或 1px 靛青内描边，克制款。
9. 搜索框：有查询时右侧显示清除 × 按钮（点击清空并保焦）；查询非空且 0 匹配时计数位显示「无匹配」而非 `0/0`；计数容器加 `aria-live="polite"`。
10. mdlog 记录中时，顶栏路径右侧加一枚 tag-bg 小章「记录中」（mono 10px，`--brand` 字色），让记录状态不只出现在文档尾部。样式与 editor-toast 同族。

测试：更新/新增 `OutlinePanel` 与 `TopBar` 相关用例；`App.test.tsx` 中快捷键用例补 `Ctrl+B`。

## Task 4 — 最近打开 + 拖放打开 + 空状态重做

- 新 `src/lib/recentFiles.ts`：Store key `recentFiles`，`string[]`（绝对路径），最多 8 条，去重置顶；`addRecent(path)` 在每次成功打开文档时调用。`lastOpened.ts` 的启动恢复改读 `recentFiles[0]`（保留旧 key 迁移：若 `recentFiles` 空而 `lastOpenedPath` 存在，以其为种子）。
- `EmptyState.tsx` 重做：保留既有文案「打开 Markdown 文件开始查看。」（约束 11），按钮「打开文件…」；下方「最近打开」列表（文件名 500 字重 + 右侧 mono 10px stone 色目录路径，hover ivory 底 + 文件名转靛青），点击直接打开；列表为空则不渲染该区块；再下方一行 stone 小字「或将 .md 文件拖入窗口」。
- 拖放：`getCurrentWebviewWindow().onDragDropEvent`，`enter`/`over` 时正文区显示一道靛青内描边提示态，`drop` 时取第一个 `.md`/`.markdown` 路径走既有打开管线；`leave` 清除提示态。多文件拖入只取第一个。
- 最近列表中点击已不存在的文件：走既有错误管线（ErrorState），并把该条从列表移除。

测试：`recentFiles.test.ts`（去重、上限、迁移）；EmptyState 渲染用例（有/无最近列表两态）。

## Task 5 — 窗口标题随文档

- capabilities 加 `core:window:allow-set-title`。
- 打开文档后 `getCurrentWindow().setTitle(`${文件名} — 素笺`)`；无文档 / 关闭后复位 `素笺`。文件名取 basename（与正文 `h1.document-title` 同源逻辑，`src/lib/path.ts`）。
- 测试：mock `@tauri-apps/api/window`，断言调用参数。

## Task 6 — wikilink 前进/后退历史

- `App.tsx` 维护历史栈：每次通过 wikilink 打开另一文档时，把当前文档路径 + 当前阅读位置（复用 `scrollMemory.ts` 的三级记录）压入 back 栈，清空 forward 栈；后退/前进时互换。同文档内的锚点跳转不入栈。
- 快捷键 `Alt+←` / `Alt+→`；顶栏左侧按钮簇最前加 ‹ › 两个幽灵按钮（禁用态 stone 30% 透明度、不可点），title「后退（Alt+←）」「前进（Alt+→）」。
- 后退/前进落到目标文档后，用该文档记忆的三级位置恢复（已有机制，直接复用 `scrollRestore.ts`）。
- 测试：栈行为单测（push/back/forward/新导航清 forward）。

## Task 7 — 大纲收录 h4–h6

- `src/lib/outline.ts`：提取范围 h1–h3 扩到 h1–h6；层级嵌套逻辑不变。
- `OutlinePanel.tsx`：新增 l4–l6 缩进档（在 l3 基础上每级 +14px 左 padding），l4–l6 字号降到 12px、`--olive` 色，不进入中文数字编号（编号仍只给 h1）。
- 大纲跟随（`useOutlineSync.ts`）与搜索逻辑无需改动，确认 h4–h6 的锚点跳转同样工作。
- kami.css：补 `.outline__item--l4/l5/l6` 规则（在既有 outline 段落内追加，注意约束 8）。
- 测试：outline 提取用例补 h4–h6 嵌套；长文档 mixed 层级用例。

## Task 8 — 任务列表勾选写回

- 阅读视图中点击任务列表 checkbox（remark-gfm 渲染的 `<input type="checkbox" disabled>`——需让其在 Vellum 内可点）：找到所属顶层块单元（`editUnits.ts` 绝对偏移），在该单元源码内按出现顺序定位第 N 个 `- [ ]` / `- [x]` 标记并翻转，走既有原子写盘管线（`useDocumentEditor` 的 commit 路径或直连 `save_document`）。
- mdlog 记录中禁止（约束 14）；只读块（HTML 块内的任务列表）不可点。
- 点击后视觉：checkbox 立刻翻转（乐观更新），写盘失败回滚并复用 editor-toast 提示「写入失败」。
- 光标/滚动位置保持不动；热重载回声抑制已能识别自身写入（复用）。
- hover 时 checkbox 出现 1px 靛青描边提示可点；`cursor: pointer`。
- 测试：单元内多任务项的索引定位、翻转幂等、mdlog 门禁。

## Task 9 — 打印样式

- kami.css 追加 `@media print` 段（放在 `.mdlog-widget` 段之前，约束 8）：隐藏顶栏、侧栏、自定义滚动条、跳底按钮、印章/提示浮层、widget 占位 chrome；正文列宽放开到 100%；代码块 / 表格 / 引用 `break-inside: avoid`；页边距交给浏览器默认。
- 若 WebView2 支持 `window.print()`（先实测 `typeof window.print === 'function'` 并真机验证一次），绑定 `Ctrl+P`；不支持则只做样式、README 不提快捷键。实测结果写进报告。

## Task 10 — 自动更新（tauri-plugin-updater）

- `src-tauri/Cargo.toml` 加 `tauri-plugin-updater`；`tauri.conf.json` 加 `plugins.updater`（`pubkey` 占位 + endpoints 指向 `https://github.com/HwFee/vellum/releases/latest/download/latest.json`）与 `bundle.createUpdaterArtifacts: true`；`main.rs` 注册插件。
- npm 侧加 `@tauri-apps/plugin-updater`；`src/main.tsx` 启动时静默 `check()`，有新版本时复用 editor-toast 样式的非阻塞提示「发现新版本，重启后更新」（用 `install()` 下载后提示重启；失败静默不打扰）。
- capabilities 如需 updater 权限位一并补上。
- 文档：`docs/agents/tooling.md` 打包一节追加「发布前需 `tauri signer generate` 生成密钥对并把公钥填入 `tauri.conf.json`；`latest.json` 由 CI/发布流程产出」的说明。
- 验收：`cargo check` 通过、`npm test` 绿、配置 JSON 合法。真机更新链路需要签名密钥与真实 release，不在本任务验收范围（报告中明确标注）。

## 完成后

- 全部任务绿后做整体 review，然后 `npm run build` + `npm test` 终验。
- 更新 `CHANGELOG.md`（新增 Unreleased / v1.9.0 草稿条目，列本计划全部改动）与 `README.md` Features 节（新增设置面板、最近打开、前进后退等条目；Usage 一节补新快捷键 Ctrl+B / Alt+← / Alt+→ / 拖放）。「目錄」不改。
- 更新 `AGENTS.md` 红线/路径如有新机制（设置变量、recentFiles）需要登记。

## Task 11 — 安装包体积与 MSI 残留订正（README + promo）

来源：Task 1 审阅 deferral。范围：`README.md`、`promo/index.html`、`promo/announcement.md`。

- 「约 7 MB 安装包」实测为约 21 MB（NSIS 产物 20,781,858 字节）：`README.md:96` 与 `promo/index.html`（约 3 处）、`promo/announcement.md`（约 4 处）统一改为「约 21 MB」。
- `promo/announcement.md:50-51` 残留 MSI 条目与 `素笺_` 文件名前缀：改为只列 NSIS，文件名前缀改 `Vellum_`（与 `tauri.conf.json` productName 及真实产物一致）。
- 不动 promo 的设计风格与版面；只改数字与文件名/格式描述。
- 验收：`grep -rn "7 MB\|7MB" README.md promo/` 无残留；`grep -rn "\.msi\|素笺_" README.md promo/` 无残留（CHANGELOG/历史 release notes 不动）。

无代码改动。与 Task 10 文件集不相交，可并行。

## Task 12 — 终验 fix wave + 文档收口

来源：各任务审阅的 deferred minors 汇总 + plan「完成后」。一个实现者完成全部，逐项核对：

**Fix wave（代码小修）：**
1. T8 代际守卫硬化（~3 行）：`useDocumentEditor` 的代际改为同步读（App 传 `getDocumentGeneration: () => number` 或直接传 ref），消除 reloadCurrent ref 递增与渲染提交之间的调度窗。补一条针对该窗口的用例（或论证现有用例已覆盖并把论证写进报告）。
2. T3-M6：`App.tsx` 的 `.reload-note` 与 `.editor-toast` key 撞车（都从 1 起）——给 key 加前缀（`reload-${tick}` / `toast-${id}`）。
3. T3-M1：App 把 `searchQueryPending`（useDeferredValue 的 pending 态）传给 OutlinePanel，pending 时不显示「无匹配」。
4. T3-M2/M4：`.button.button-primary` 补 `height: 32px` 与 `:active` 态；`.outline-search__clear` 要么补样式要么删掉惰性类。
5. T3-M3：补 ErrorState「重新打开」接线用例。
6. T9：Ctrl+P 分支补 `return` 与 `!event.shiftKey`；`printSpy.mockRestore()`；打印隐藏清单加 `.mdlog-live`。
7. T2：SettingsPopover Escape 分支加 `event.stopPropagation()`；`useReaderSettings` 落盘副作用挪出 setState updater（改 useEffect 监听落盘）。

**文档收口：**
8. `CHANGELOG.md` 新增 v1.9.0（或 Unreleased）条目：设置面板 / 最近打开 + 拖放 / 窗口标题 / 前进后退 / h4–h6 大纲 / 任务勾选写回 / 打印样式 / 自动更新 / UI 修复批量（逐条一行，中文，跟随既有条目格式）。
9. `README.md`：Features 节补设置面板、最近打开、前进后退、h4–h6、勾选写回、打印、自动更新条目；Usage 节补 Ctrl+B / Alt+←/→ / 拖放 / Ctrl+P（若真机验证通过）。
10. `AGENTS.md`：红线 8 的侧栏入口枚举补 `Ctrl+B`；关键路径补 `recentFiles` / `navHistory` / `taskList` / `useReaderSettings` 登记；测试计数以最终实测为准。
11. `docs/agents/rendering.md:78` 侧栏入口枚举补 Ctrl+B；`:45`/`:59`/`scrollInput.ts` 的 Alt 例外契约归位（键分类规则移到 scrollInput.ts 或其文档）；`:129` 文件索引补 navHistory.ts。
12. `docs/agents/tooling.md`：入口 chunk 尺寸历史更新到终验实测值。
13. `TODO.md`：如适用，把本计划列为已完成记录。

**约束：** 改动 UI 行为的部分跑 `npm test` + `npm run build`；文档部分不动历史条目。提交风格同前，可拆 2–3 个提交（fix 一个、docs 一个）。
