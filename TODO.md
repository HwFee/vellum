# 待办问题清单

全部完成（2026-09-20 复核）：以下 5 项均已落地，记录保留。

## 1. 墨迹未干提示位置 ✅

热重载提示已重做为「印章」式：悬浮于窗口中下方（水平居中、距底约 22%），不随文档滚动，所有窗口尺寸可见。侧边栏打开时随文章区域中心右移（≥720px 断点）。动画为放大旋转→按压回弹→停留→淡出，正文保留由虚而实的新墨过渡。

## 2. 性能优化 ✅

- **字体策略收紧**：`waitForFonts()` 增加 `document.fonts.check()` 快路径、改用 `Promise.allSettled`（单个失败不影响整体）、兜底超时 3s→1s；保留 `font-display: block` 防 FOUT。
- **合并 Store**：新建 `src/lib/settings.ts` 共享 settings.json Store 单例，`lastOpened` 与 `outlineOpen` 复用，消除重复 IPC。
- **代码分割**：`MarkdownDocument` 改为 `React.lazy` 懒加载，react-markdown + rehype/remark + 语法高亮拆为独立 chunk（主包从约 600kB 降至 320kB）。
- **启动跳过中间 loading 态**：首次加载直接 empty → ready，少一次无意义渲染。
- 启动闪现旧界面此前已解决，本次未涉及。

## 3. 大纲面板未跟随滚动 ✅

`OutlinePanel` 在活跃标题变化时把高亮项平滑滚进视野（`block: 'nearest'` 语义）。原生 `scrollIntoView` 在高频变化时会被连续打断（近距离慢挪、远距离直跳），故改为手动计算目标位置 + 自定义缓动从当前位置接续动画。

## 4. 全屏 + 侧边栏文字宽度异常 ✅

移除了侧边栏打开时正文加宽到 960px 的规则（及 `--content-max-width-wide` 变量）。无论侧边栏开关，正文最大宽度恒为 800px。

## 5. 默认侧边栏应关闭 ✅

`useOutlineOpen` 启动时恒为关闭，不再恢复上次的开关状态；用户交互后的状态仍会持久化（仅启动时不读取）。
