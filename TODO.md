# Vellum · 待办

未实现的功能想法，按主题归类。做完一项就删一项，别留「已完成」条目（历史看 `CHANGELOG.md`）。

**插件系统暂不做**：下面所有能力都按内置功能实现，不引入扩展加载位。

---

## 目标：以「自家库」为形态的阅读 + 轻编辑工作台

定于 2026-09-27。两条决策先钉住，后面所有条目都受它约束：

- **不做**：标签索引 / 标签面板、每日笔记、模板、图谱视图、双向同步、移动端、全库替换编辑。
  这些是「替代 Obsidian」的清单，不是「自家库工作台」的清单。
  差异化力气给三族语法渲染（wikilink / callout / 嵌入）、mdlog、导出 PDF。
- **Obsidian 库只读兼容**：可以编辑 `.md` 正文、勾选任务；**一个字节都不写 `.obsidian/`**。

### 模式由「怎么打开」决定，不由目录结构猜（2026-09-27 定）

| 打开方式 | 模式 |
|---|---|
| 双击 / 「打开方式」/ 开始页选或拖入 **一个 `.md`** / 最近文件 | **单文件** |
| 资源管理器右键文件夹「用 Vellum 打开」/ 文件夹拖到桌面图标或已开窗口 / 开始页选或拖入 **一个文件夹** / 最近库 | **库**（根 = 那个文件夹） |

- 多实例保持不变：一次打开一个进程，每个窗口自带模式。**不需要单实例**（原 P3 的 `tauri-plugin-single-instance` 回归作废）。
- 单文件模式：侧栏只有「目錄」大纲，没有文件 / 检索 / 反链页签，`Ctrl+Shift+F` 吞键不动作。
- 库模式：侧栏四页签（目錄 / 文件 / 檢索 / 反鏈），库根锚在 Rust 侧状态里。
- 库根只能来自 Rust 侧（argv、Rust 弹出的目录对话框、Rust 侧 `WindowEvent::DragDrop` 拿到的拖放路径、最近库列表的序号），**前端不能传任意路径当库根**——`AppState.current` 是读取边界的唯一可信锚点，库根同样要守这条。

### 单文件模式下的 `[[链接]]`：向上找库，只读解析

- 相对路径能找到的照旧直接解析（`resolve_wikilink_map` 第 2 步，逐级向上找同名文件）。
- 仍有未解析的链接时才向上找库：祖先里最近的 `.vellum` / `.obsidian`，或「最近库」列表里包含该文件的库。**有上限**：最多 8 级、到用户主目录或盘符根即停。
- 找到了：在那个库里按唯一 basename 兜底解析、悬停预览照常；界面**仍是单文件模式**，顶部给一条轻提示「属于库 xxx · 在库中打开」，点一下才切到库模式（不自动切——「点文件就是单文件」这条不破）。
- 找不到：链接置灰不可点（已有 `.wikilink--missing` 样式），悬停说明「未找到目标笔记」。
- basename 索引是贵的那一步（`document.rs` 的 `build_basename_index` 每次全库重扫），与库模式共用 P2 的索引缓存。

### `.vellum/` 只放用户有意保存的库级配置

```
.vellum/
  settings.json        库级配置（先只放排除清单）
```

- **打开文件夹一律不写 `.vellum/`**（右键、拖放、开始页都一样）。「这是个库」记在应用数据目录的 `recentLibraries` 里。
- 只有用户在库里真正改了一项库级设置时，才创建 `.vellum/settings.json`。
- 缓存（basename 索引、检索索引）放应用数据目录、按库根路径的 hash 分目录，**不进用户的库**（否则 Git 用户第一次提交就把缓存带上去）。
- Obsidian 库：`.obsidian/` 一个字节都不写；有 `.obsidian/` 时可只读它的 `userIgnoreFilters` / `attachmentFolderPath`。

### 写权限（红线，实现时别越）

| 操作 | 库（非 Obsidian） | 库（根下有 `.obsidian`） | 单文件 |
|---|---|---|---|
| 编辑正文 / 勾选任务 | ✅ | ✅ | ✅ |
| 新建笔记 | ✅ | ⚠️ 加法，破坏性最低，可开 | ❌ |
| 重命名 / 删除 / 移动 | ✅ | ❌ 先不开（会和 OB 自身的链接维护打架） | ❌ |

---

## P0 · 打开方式决定模式

- [ ] Rust：`AppState.current` 改成 `Option<Opened { doc, library: Option<LibraryRef> }>`，文档与所属库在同一临界区原子替换（**不另加锁**，锁序照旧 `current → watcher → widget_state.0 → preview_allow`；持锁期间绝不遍历目录）。库根变化时 `preview_allow` 一并清空
- [ ] argv：`first_markdown_from_args`（`main.rs`，现在丢弃一切非 `.md` 参数）改为同时接受目录 → 库模式；拖到桌面图标即走这条，无需注册
- [ ] `list_library` / `search_library` / `find_backlinks` 只在库模式下工作，根从 `Opened.library` 读，不再各自调 `find_vault_root`；单文件模式返回明确的「非库模式」
- [ ] 新命令 `open_library`：Rust 侧弹目录对话框（不收前端路径）
- [ ] 窗口内拖放：文件夹 → 库模式，`.md` → 单文件。文件夹路径在 Rust 侧 `WindowEvent::DragDrop` 里接（前端 `usePlatformBindings.ts` 的 `onDragDropEvent` 只负责悬停态 UI），不经前端回传
- [ ] 前端：侧栏页签只在库模式渲染；`Ctrl+Shift+F` 单文件模式下吞键不动作；设置页快捷键一览随模式隐去「全库检索」
- [ ] 开始页（`EmptyState`）：一整块拖放区（自动判别文件 / 文件夹）+「打开文件」「打开文件夹」两个按钮 + 最近列表（文件与库分组）
- [ ] 空文件夹 / 无 Markdown：库模式空态「没有找到 Markdown 文件」，不弹错
- [ ] 库根过大（拖进 `D:\` 或主目录）：文件数超上限时提示「文件过多，建议选更小的文件夹」；检索 / 反链同样设上限
- [ ] 测试：argv 目录参数、拖放判别、单文件模式下库命令拒绝、嵌套 `.vellum` / `.obsidian` 就近规则

## P1 · 单文件模式的链接向上找库

- [ ] 见上文「单文件模式下的 `[[链接]]`」：有上限的向上查找、只读解析、「在库中打开」提示、找不到置灰
- [ ] 测试：8 级上限、到主目录即停、`.vellum` 与 `.obsidian` 同级时 `.vellum` 赢、嵌套时最近者赢

## P2 · 库做实

- [ ] `recentLibraries` 持久化（照 `recentFiles` 那套 Store 套路）
- [ ] basename / 检索索引缓存（应用数据目录，mtime 失效）—— 顺手解决 `document.rs` 每次 `build_basename_index` 重扫全库，以及 `search_library` 每次全库重扫
- [ ] 新建笔记（库内）
- [ ] `.vellum/settings.json` 落地（先只放排除清单；只在用户改设置时创建）

## P3 · 平台集成（右键菜单）

- [ ] Windows：NSIS `installerHooks` 在 `HKCU\Software\Classes` 写 `Directory\shell\Vellum` 与 `Directory\Background\shell\Vellum`（带 `%V`），卸载钩子删除。**Windows 11 上只出现在「显示更多选项」里**——进一级菜单要实现 `IExplorerCommand` + sparse package，暂不做
- [ ] 安装包的桌面快捷方式：Tauri 默认 NSIS 完成页已有「创建桌面快捷方式」勾选框，开始菜单快捷方式默认创建——无需改动，只需确认
- [ ] Linux：`.desktop` 的 `MimeType` 加 `inode/directory`，文件管理器里出现「用 Vellum 打开」

---

## 重命名不是文件操作（实现重命名前必读）

一次重命名要连带处理下面几处，漏一处就是脏数据：

1. 全库正文里的 `[[旧名]]`、`[[旧名#标题|别名]]`、嵌入 `![[旧名]]`、相对链接 `[x](旧名.md)`
2. mdlog sidecar（`src-tauri/src/watcher.rs:12` `sidecar_path_for`）
3. `recentFiles`（以及 `recentLibraries`、按路径记的阅读位置 `useScrollMemory`）
4. `navHistory` 前进/后退两栈
5. `AppState.current`

## 暂不做

- **插件系统**：不做，能力一律内置。
- **标签索引 / 标签面板、每日笔记、模板、图谱、同步、移动端、全库替换编辑**：见开头「目标」——它们是替代 Obsidian 的清单，不在自家库工作台的范围内。
- **翻译**（选中翻译 / 整篇翻译）：先搁置——要出网（CSP 现在只放行 ipc）、要 key、笔记内容外发，性价比不够。
