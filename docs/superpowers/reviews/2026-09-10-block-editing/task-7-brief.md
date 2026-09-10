### Task 7: 编辑态样式与设计语言

**Files:**
- Modify: `src/styles/kami.css`（新增大区段，插在 `/* ===== Pi 对话记录与沙箱交互块 ===== */` 之前）
- Modify: `src/styles/kami.css.test.ts`
- Modify: `DESIGN.md`

**Interfaces:**
- Consumes: Task 3/6 的类名契约：`.document-scroll__content--editing`、`.block-editor__input`、`.editor-toast`、`.markdown-body--editing`、`.vellum-unit-wrap`
- Produces: 无新增导出

- [ ] **Step 1: 写失败测试**

```ts
// 追加到 src/styles/kami.css.test.ts
it("编辑态区段位于首个 .mdlog-widget 之前，且自身不含该字样", () => {
  const editorSection = css.indexOf(".block-editor__input");
  const mdlogSection = css.indexOf(".mdlog-widget");

  expect(editorSection).toBeGreaterThan(-1);
  expect(editorSection).toBeLessThan(mdlogSection);

  const editorBlock = css.slice(css.indexOf("/* ===== 编辑视图"), mdlogSection);
  expect(editorBlock).not.toContain(".mdlog-widget");
});

it("编辑态宿主提供定位上下文", () => {
  expect(css).toMatch(/\.document-scroll__content--editing\s*\{[^}]*position:\s*relative/);
  expect(css).toMatch(/\.block-editor__input\s*\{[^}]*position:\s*absolute/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/styles/kami.css.test.ts`
Expected: FAIL —— `editorSection` 为 -1

- [ ] **Step 3: 加样式**

```css
/* ===== 编辑视图（块级就地编辑） ===== */
.document-scroll__content--editing {
  position: relative;
}

.block-editor__input {
  position: absolute;
  z-index: 30;
  margin: 0;
  padding: 0 2px;
  border: 0;
  border-left: 2px solid var(--accent, #4a5b8c);
  background: transparent;
  color: var(--ink, #2f2f2c);
  font: inherit;
  font-family: var(--mono);
  font-size: 0.95rem;
  line-height: 1.7;
  resize: none;
  overflow: hidden;
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
}

.markdown-body--editing .vellum-unit-wrap {
  display: contents;
}

.editor-toast {
  position: fixed;
  left: 50%;
  bottom: 18%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 3px;
  background: var(--tag-bg, rgba(74, 91, 140, 0.08));
  color: var(--ink, #2f2f2c);
  font: 500 10px/1 var(--mono);
  letter-spacing: 0.04em;
  pointer-events: none;
  z-index: 40;
}
```

要点：`font-family: var(--mono)` 与 `line-height: 1.7` 必须与渲染态正文一致（否则覆盖层与下方内容错位）；`.vellum-unit-wrap` 用 `display: contents` 保证数学块外层容器不参与布局。

- [ ] **Step 4: 同步 `DESIGN.md`**

在 token 表补三项（若已存在同名语义 token 则复用，不重复定义）：编辑面左边轨色 `--accent`、提示条底色 `--tag-bg`、等宽字体 `--mono`（后两者现有文件已定义，核对后仅补文档描述）。

- [ ] **Step 5: 校验 + 回归 + 提交**

```bash
npx -p @google/design.md designmd lint DESIGN.md
npx vitest run src/styles/kami.css.test.ts && npm test
git add src/styles/kami.css src/styles/kami.css.test.ts DESIGN.md
git commit -m "feat(edit): 编辑视图样式与设计语言同步（区段置于 mdlog 之前、display:contents 数学块容器）"
```

---

