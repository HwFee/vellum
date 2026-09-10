### Task 8: 全量回归、文档与真机复核

**Files:**
- Modify: `CHANGELOG.md`（新增 `### 新增` 条目）
- Modify: `AGENTS.md`（「性能结构约束」补两条：编辑视图不新增滚动系统、提交不闪印章）
- Modify: `docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md`（登记 §6.4 简化修订）

- [ ] **Step 1: 全量回归**

```bash
npm test && npx tsc --noEmit && npm run build
cd src-tauri && cargo test && cd ..
```

Expected：`npm test` 全绿（基线 280 用例 + 本功能新增用例）；`vite build` 成功且入口 chunk 无显著增长（`mdast` 已在入口 chunk，仅新增约 6KB 源码）。

- [ ] **Step 2: 打包真机验证（`npm run tauri build`）**

逐项复核并记录到 `docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md`：

- [ ] 阅读视图与改动前完全一致（点击只选字，无标记属性）
- [ ] `Ctrl+E` 进编辑视图；点击块出现 textarea，下方内容被推下去而非被盖住
- [ ] 长段落编辑时视口不跳动（原生 scroll anchoring 生效）
- [ ] 点击 HTML 块 / 交互块只出提示，不出现编辑框；widget 点击仍能与其交互
- [ ] 提交后落盘内容正确；CRLF 文档换行符未被翻新（用 `git diff --stat` 或二进制比对确认）
- [ ] 提交后其下方未改动块的 widget iframe 未重建（iframe `src` 不变）
- [ ] 记录中的文档无法进入编辑视图（顶栏按钮禁用 + 提示）
- [ ] mdlog 追加触发的热重载不闪「墨迹未干」于我方提交之后（回声抑制生效）
- [ ] 提交耗时实测记录（用于校准 800ms 阈值）

- [ ] **Step 3: 文档与提交**

```bash
git add CHANGELOG.md AGENTS.md docs/superpowers/specs/2026-09-10-vellum-block-editing-design.md docs/superpowers/reviews/2026-09-10-block-editing-acceptance.md
git commit -m "docs(edit): 块级就地编辑收口（更新日志、性能约束补记、spec 修订登记、验收报告）"
```

---

## 计划自查（写入后一次）

- **spec 覆盖**：§3 决策 D1–D8 → Task 1/2/4/6；§5 单元与标记 → Task 1/2；§6 激活与提交 → Task 3/4/6；§7 落盘与一致性 → Task 5/6；§8 与既有机制 → Task 6 的 6/7/8 条；§9 样式 → Task 7；§10 测试与验收 → 各 Task 的测试步骤 + Task 8；§11 风险 → Task 8 复核项。**已登记一处偏离**：§6.4 外部变更二选一横幅简化为中断路径（Task 4 Step 5）。
- **占位符**：无 TBD/TODO；每个代码步骤都有可执行内容。
- **类型一致性**：`EditUnit`/`buildEditUnits`/`spliceUnit`/`caretOffsetForRatio`/`computeOverlayBox`/`BlockEditorProps`（受控 `value`+`onChange`）/`SaveOutcome`/`UseDocumentEditorOptions` 在各任务间签名一致；`BlockEditor` 在 Task 3 与 Task 6 的调用点形状一致。
