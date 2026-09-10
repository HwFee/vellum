### Task 6: `App` 接线（门禁、提交落盘、回声抑制、外部变更分流）

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TopBar.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/components/TopBar.test.tsx`

**Interfaces:**
- Consumes: `useDocumentEditor`（Task 4）、`MarkdownDocument` 的 `editable`/`onActivateUnit`/`onLockedUnitClick`（Task 2）、`BlockEditor`（Task 3）、`save_document`（Task 5）
- Produces: 新增 props `isEditing`/`onToggleEdit` 到 `TopBar`；App 内部 `applyMarkdown` 与 `reloadIfExternal`

- [ ] **Step 1: 写失败测试（App 集成）**

```tsx
// 追加到 src/App.test.tsx
it("Ctrl+E 进入编辑视图，点击块激活就地编辑，提交后落盘", async () => {
  await loadDocument();
  fireEvent.keyDown(window, { key: "e", ctrlKey: true });

  await waitFor(() => expect(document.querySelector("[data-vellum-unit]")).not.toBeNull());
  fireEvent.click(screen.getByText("Body text."));

  const textarea = await screen.findByRole("textbox");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });
  fireEvent.keyDown(textarea, { key: "Escape" });

  await waitFor(() =>
    expect(backendInvoke).toHaveBeenCalledWith("save_document", {
      path: loadedDoc.path,
      content: expect.stringContaining("Body text edited."),
    })
  );
});

it("mdlog 记录中不得进入编辑视图", async () => {
  await loadDocument();
  backendInvoke.mockImplementation((command: string) => {
    if (command === "read_mdlog_state") {
      return Promise.resolve({ lastWriteAt: 1, heartbeatAt: Date.now(), expiresAt: Date.now() + 60_000 });
    }
    return Promise.resolve(loadedDoc);
  });

  await waitFor(() => expect(screen.getByText("记录中 · PI")).toBeInTheDocument());
  fireEvent.keyDown(window, { key: "e", ctrlKey: true });

  expect(document.querySelector("textarea.block-editor__input")).toBeNull();
});

it("自己的写入回声不触发「墨迹未干」印章", async () => {
  await loadDocument();
  let reloadListener: (() => void) | undefined;
  vi.mocked(listen).mockImplementation(async (event: string, handler: () => void) => {
    if (event === "file-changed") reloadListener = handler;
    return () => {};
  });

  fireEvent.keyDown(window, { key: "e", ctrlKey: true });
  fireEvent.click(await screen.findByText("Body text."));
  const textarea = await screen.findByRole("textbox");
  fireEvent.change(textarea, { target: { value: "Body text edited." } });
  fireEvent.keyDown(textarea, { key: "Escape" });

  // 模拟我方写入引发的 watcher 回声：磁盘内容与草稿一致
  backendInvoke.mockImplementation((command: string) =>
    command === "load_document"
      ? Promise.resolve({ ...loadedDoc, markdown: "# Intro\n\n## Section\n\nBody text edited." })
      : Promise.resolve(undefined)
  );
  await act(async () => {
    reloadListener?.();
  });

  expect(screen.queryByText("墨迹未干")).toBeNull();
});
```

并把 App.test.tsx 的 window mock 补全（缺 `onCloseRequested` 会让新代码抛错）：

```tsx
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    show: vi.fn(() => Promise.resolve()),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  })),
}));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL —— 找不到 `[data-vellum-unit]`（编辑视图未接线）

- [ ] **Step 3: 接线 App**

改动点（全部保持既有引用稳定性约束）：

1. 引入 `useDocumentEditor`、`BlockEditor`；`const [lastSavedMarkdown, setLastSavedMarkdown] = useState<string | null>(null)` 改为 `useRef<string | null>(null)`（只给回调读，不参与渲染）
2. 文档 markdown 更新器：

```tsx
const applyMarkdown = useCallback((next: string) => {
  setState((previous) =>
    previous.status === "ready"
      ? { ...previous, document: { ...previous.document, markdown: next } }
      : previous
  );
}, []);

const saveMarkdown = useCallback(async (next: string) => {
  const path = currentPathRef.current;
  if (!path) throw new Error("No document is loaded");
  await invoke("save_document", { path, content: next });
  lastSavedMarkdownRef.current = next;
}, []);

const editor = useDocumentEditor({
  markdown: activeDocument?.markdown ?? "",
  mdlogActive: isMdlogActive,
  onMarkdownChange: applyMarkdown,
  save: saveMarkdown,
});
```

3. `Ctrl+E`：在既有 `handleSearchShortcut` 里加分支

```tsx
if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
  event.preventDefault();
  void editor.toggleView();
  return;
}
```

4. 点击回调（引用稳定）：

```tsx
const handleActivateUnit = useCallback(
  (index: number, caretOffset: number) => editor.activateUnit(index, caretOffset),
  [editor.activateUnit]
);
const handleLockedUnitClick = useCallback(
  (reason: "html" | "widget") => editor.notifyLocked(reason),
  [editor.notifyLocked]
);
```

5. 渲染：`.document-scroll__content` 在编辑视图加 `document-scroll__content--editing` 类；`MarkdownDocument` 传 `editable={editor.viewMode === "editing"}`；其后并列渲染

```tsx
{editor.activeUnit ? (
  <BlockEditor
    unitIndex={editor.activeUnit.index}
    value={editor.draft}
    initialCaret={editor.initialCaret}
    onChange={editor.updateDraft}
    onCommit={() => void editor.commitActive()}
    onCancel={() => void editor.commitActive()}
  />
) : null}
```

6. 回声抑制（改「监听 file-changed」的 effect）：

```tsx
async function reloadIfExternal() {
  const path = currentPathRef.current;
  if (!path) return;
  try {
    const latest = await invoke<LoadedDocument>("load_document", { path });
    const normalized = latest.markdown.replace(/\r\n/g, "\n");
    if (lastSavedMarkdownRef.current !== null && normalized === lastSavedMarkdownRef.current) {
      return; // 自己的写入回声：整体忽略（不更新状态、不递增 reloadTick、不闪印章）
    }
    editor.notifyInterrupted("文件已被外部修改 · 编辑已取消");
    await reloadCurrent(); // 外部变更继续走既有热重载路径
  } catch {
    // 读失败：保留旧内容
  }
}
```

7. mdlog 变活跃时清场：新增 effect

```tsx
useEffect(() => {
  if (isMdlogActive) {
    editor.notifyInterrupted("记录已开始 · 编辑已取消");
    if (editor.viewMode === "editing") {
      void editor.toggleView();
    }
  }
}, [isMdlogActive]);
```

8. 关窗前提交：在启动 effect 里加

```tsx
const unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
  if (editorRef.current?.activeUnit) {
    event.preventDefault();
    await editorRef.current.commitActive();
    void getCurrentWindow().close();
  }
});
```

（`editorRef` 每次渲染赋值为最新 `editor`，避免闭包过期；卸载时调用 `unlistenClose`。）

9. 提示条渲染（App 层，`editor.toast` 非空时）：

```tsx
{editor.toast ? (
  <div key={editor.toast.id} className="editor-toast" role="status">
    {editor.toast.message}
  </div>
) : null}
```

10. `TopBar` 新增 props `isEditing` / `onToggleEdit` / `canEdit`，左侧动作区加按钮（`aria-label="切换编辑视图"`，`canEdit` 为 false 时禁用并带 title「记录中 · 断开连接后才能修改」）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/App.test.tsx src/components/TopBar.test.tsx`
Expected: PASS

- [ ] **Step 5: 全量回归 + 提交**

```bash
npm test && npx tsc --noEmit
git add src/App.tsx src/App.test.tsx src/components/TopBar.tsx src/components/TopBar.test.tsx
git commit -m "feat(edit): App 接线（Ctrl+E 门禁、提交落盘、回声抑制、外部变更与 mdlog 分流）"
```

---

