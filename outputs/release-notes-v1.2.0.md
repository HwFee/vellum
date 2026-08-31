## Vellum · 素笺 v1.2.0

### 新增

- 文档内搜索：大纲面板搜索框（⌘K / Ctrl+K 聚焦），Enter / Shift+Enter 在匹配项间跳转，当前匹配高亮并平滑滚动定位，实时显示「第 n/共 N 项」

### 性能

- 代码高亮改用 `PrismLight` 按需注册 20 种语言，打包产物由 303 个文件（~2.5MB）降至 6 个（672KB）
- `manualChunks` 拆分 React 核心与语法高亮为独立 chunk，正文引擎 `React.lazy` 懒加载
- 启动时窗口在首篇文档渲染提交后才显示，消除空状态闪现；字体改为后台加载不阻塞渲染
- 搜索词经 `useDeferredValue` 传入文档层，输入不再被大文档重解析阻塞；切换上一个/下一个匹配改为 DOM 打标，不再整篇重解析
- 文档不含原始 HTML 时自动跳过 `rehype-raw` 的二次解析
- `components` prop、大纲树、代码块/图片组件全面 memo 化，消除无关重渲染

### 安装

- **Vellum_1.2.0_x64-setup.exe** — Windows 10/11 x64 NSIS 安装包（自动关联 `.md` / `.markdown` 文件）
