# Release 构建与沙箱 CSP 人工验收报告（spec §9.3）

- **验收日期**：2026-09-05
- **验收对象**：`src-tauri/target/release/vellum.exe`（Vellum 1.4.0，构建 commit `440ccee`）
- **安装包产物**：`src-tauri/target/release/bundle/nsis/Vellum_1.4.0_x64-setup.exe`
- **运行环境**：Windows 10/11 x64；WebView2 Runtime `152.0.4191.62`
- **验收治具**：`outputs/mdlog/acceptance-fixtures/`（check1 / check23 / check45 / check67 共 4 个 `.md` 文件，均含受信指纹头 `<!-- mdlog:v1 s=... -->`，widget 自动挂载）
- **验收人**：用户（主 Agent 引导逐项操作）
- **总体结论**：（待填：通过 / 附条件通过 / 不通过）

---

## 逐项核验记录

### 核验 1：正向功能渲染（dev + release 各一次）

- **操作**：分别用 `npm run dev` 与 release 版 `vellum.exe` 打开 `check1-trusted-widget.md`
- **预期**：widget 自动挂载（受信免点击）；iframe 内靛青波形正常绘制；顶栏标题显示「验收·傅里叶方波」；高度自适应无坍缩；中文衬线渲染不乱码
- **dev 实测**：（待补：tauri dev 对照构建进行中）
- **release 实测**：widget 自动挂载、波形绘制正常、标题正确、中文衬线无乱码（用户确认；版式迭代为 D 书札卷轴后再次确认）
- **判定**：PASS（dev 侧待补）

### 核验 2：网络断开隔离

- **操作**：打开 `check23-csp-network.md`，F12 打开 DevTools Console
- **预期**：`fetch`/`XMLHttpRequest` 被 CSP `default-src 'none'` 拦截（Console 红字 `Refused to connect ... violates directive`），无 `LEAK` 字样
- **实测**：fetch/XHR 均被 CSP 拦截（用户确认 Console 红字），无 LEAK
- **判定**：PASS：远程图片隔离

- **操作**：同 `check23-csp-network.md`，观察图片占位与 Console
- **预期**：`<img src="https://...">` 被 CSP `img-src data:` 拦截，图片不加载，Console 报违规
- **实测**：远程图片被 CSP `img-src data:` 拦截不加载（用户确认），无 LEAK
- **判定**：PASS

### 核验 4：本地存储隔离

- **操作**：打开 `check45-storage.md`，看 Console
- **预期**：`localStorage` / `sessionStorage` 访问抛 `SecurityError: Access is denied for this document`，无 `LEAK` 字样
- **实测**：localStorage/sessionStorage 均抛 `SecurityError`（用户贴出 Console 原文），无 LEAK
- **判定**：PASS：Cookie / indexedDB 隔离

- **操作**：同 `check45-storage.md`，看 Console
- **预期**：`document.cookie` 读写受阻、`indexedDB.open` 抛错或永不成功，无 `LEAK` 字样
- **实测**：cookie 设置与 indexedDB.open 均抛 `SecurityError`（用户贴出 Console 原文），无 LEAK
- **判定**：PASS：导航弹窗隔离

- **操作**：打开 `check67-navigation.md`，点第一个按钮「window.open（预期无效）」
- **预期**：不弹任何新窗口；Console 显示 `window.open result: blocked(null)`
- **实测**：window.open 无效、不弹新窗口（用户确认）
- **判定**：PASS：子帧自导航残余风险确认（Y4 已知已接受风险）

- **操作**：同 `check67-navigation.md`，点第二个按钮「location.href 自导航」
- **预期**：仅该子帧自身跳转（可能显示空白/错误页）；顶层主窗口文档与其余界面完全不受影响。记录为已知已接受残余风险
- **实测**：子帧自导航仅影响自身，主窗口文档与界面完好（用户确认）——残余风险确认在案
- **判定**：PASS（风险确认）

### 核验 8：DOM 防穿透

- **操作**：任意打开一个已挂载 widget 的文档（如 `check1-trusted-widget.md`），在主应用 DevTools Console 执行：
  1. `document.querySelector("iframe").contentDocument`（主应用侧）
  2. 在 widget iframe 的 Console 上下文执行 `parent.document`（沙箱侧）
- **预期**：主应用侧恒为 `null`；沙箱侧抛跨域异常（`Blocked a frame with origin "null" from accessing a cross-origin frame`）
- **实测**：top 侧 `iframe.contentDocument` 为 `null`；子帧（DevTools 中显示为 chromewebdata/ IFrame）侧 `parent.document` 抛跨域红字（用户确认）
- **判定**：PASS

---

## 结项签名

- 验收执行：用户 GUI 实测 + 主 Agent 引导与记录（核验 1 的 dev 侧对照待补）
- 结果复核：主 Agent（对照本报告逐项核对后签字）
