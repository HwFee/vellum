### Task 4: 编辑会话状态机 `useDocumentEditor`

**Files:**
- Create: `src/hooks/useDocumentEditor.ts`
- Create: `src/hooks/useDocumentEditor.test.ts`

**Interfaces:**
- Consumes: `buildEditUnits` / `spliceUnit` / `EditUnit`（Task 1）
- Produces:
  ```ts
  export type EditorViewMode = "reading" | "editing";
  export type EditorToast = { id: number; message: string };
  export type UseDocumentEditorOptions = {
    markdown: string;
    mdlogActive: boolean;
    onMarkdownChange: (next: string) => void;
    save: (next: string) => Promise<void>;
    heavyCommitMs?: number;          // 默认 800，测试/真机可调
  };
  export function useDocumentEditor(options: UseDocumentEditorOptions): {
    viewMode: EditorViewMode;
    toggleView: () => Promise<void>;
    units: EditUnit[];
    activeUnit: EditUnit | null;
    draft: string;
    initialCaret: number;
    heavyDoc: boolean;
    toast: EditorToast | null;
    activateUnit: (index: number, caretOffset: number) => void;
    updateDraft: (text: string) => void;
    commitActive: () => Promise<void>;
    notifyLocked: (reason: "html" | "widget") => void;
    notifyInterrupted: (message: string) => void;
  };
  ```

- [ ] **Step 1: 写失败测试**

```ts
// src/hooks/useDocumentEditor.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDocumentEditor } from "./useDocumentEditor";

const markdown = "# 标题\n\n第一段。\n\n第二段。\n";

function setup(overrides: Partial<Parameters<typeof useDocumentEditor>[0]> = {}) {
  const onMarkdownChange = vi.fn();
  const save = vi.fn(() => Promise.resolve());
  const view = renderHook(() =>
    useDocumentEditor({ markdown, mdlogActive: false, onMarkdownChange, save, ...overrides })
  );
  return { ...view, onMarkdownChange, save };
}

describe("useDocumentEditor", () => {
  it("从 markdown 切出块单元", () => {
    const { result } = setup();
    expect(result.current.units).toHaveLength(3);
    expect(result.current.viewMode).toBe("reading");
  });

  it("mdlog 记录中拒绝进入编辑视图并提示", async () => {
    const { result } = setup({ mdlogActive: true });
    await act(async () => {
      await result.current.toggleView();
    });
    expect(result.current.viewMode).toBe("reading");
    expect(result.current.toast?.message).toContain("记录中");
  });

  it("激活块后草稿是该块源码，提交时拼回全文并落盘", async () => {
    const { result, onMarkdownChange, save } = setup();
    act(() => {
      result.current.toggleView();
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.activateUnit(1, 0);
    });
    expect(result.current.draft).toBe("第一段。");

    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.commitActive();
    });

    expect(onMarkdownChange).toHaveBeenCalledWith("# 标题\n\n改过的第一段。\n\n第二段。\n");
    expect(save).toHaveBeenCalledWith("# 标题\n\n改过的第一段。\n\n第二段。\n");
    expect(result.current.activeUnit).toBeNull();
  });

  it("草稿与原文相同时不提交、不落盘", async () => {
    const { result, onMarkdownChange, save } = setup();
    act(() => {
      result.current.activateUnit(1, 0);
    });
    await act(async () => {
      await result.current.commitActive();
    });
    expect(onMarkdownChange).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("提交耗时超过阈值时挂出「文档较重」标记", async () => {
    const { result } = setup({ heavyCommitMs: 0 });
    act(() => {
      result.current.activateUnit(1, 0);
    });
    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.commitActive();
    });
    expect(result.current.heavyDoc).toBe(true);
  });

  it("只读块点击给出原因文案", () => {
    const { result } = setup();
    act(() => {
      result.current.notifyLocked("html");
    });
    expect(result.current.toast?.message).toContain("HTML");
  });

  it("编辑中被外部改写：取消编辑并提示", async () => {
    const { result } = setup();
    act(() => {
      result.current.activateUnit(1, 0);
    });
    act(() => {
      result.current.notifyInterrupted("文件已被外部修改 · 编辑已取消");
    });
    expect(result.current.activeUnit).toBeNull();
    expect(result.current.toast?.message).toContain("外部修改");
  });

  it("保存失败时把草稿留在框里并提示", async () => {
    const save = vi.fn(() => Promise.reject(new Error("拒绝写入")));
    const onMarkdownChange = vi.fn();
    const { result } = renderHook(() =>
      useDocumentEditor({ markdown, mdlogActive: false, onMarkdownChange, save })
    );

    act(() => {
      result.current.activateUnit(1, 0);
    });
    act(() => {
      result.current.updateDraft("改过的第一段。");
    });
    await act(async () => {
      await result.current.commitActive();
    });

    expect(result.current.toast?.message).toContain("保存失败");
    expect(result.current.draft).toBe("改过的第一段。");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/hooks/useDocumentEditor.test.ts`
Expected: FAIL —— `Failed to resolve import "./useDocumentEditor"`

- [ ] **Step 3: 实现**

```ts
// src/hooks/useDocumentEditor.ts
import { useCallback, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { buildEditUnits, spliceUnit, type EditUnit } from "../lib/editUnits";

export type EditorViewMode = "reading" | "editing";
export type EditorToast = { id: number; message: string };

export type UseDocumentEditorOptions = {
  markdown: string;
  mdlogActive: boolean;
  onMarkdownChange: (next: string) => void;
  save: (next: string) => Promise<void>;
  heavyCommitMs?: number;
};

const DEFAULT_HEAVY_COMMIT_MS = 800;

export function useDocumentEditor({
  markdown,
  mdlogActive,
  onMarkdownChange,
  save,
  heavyCommitMs = DEFAULT_HEAVY_COMMIT_MS,
}: UseDocumentEditorOptions) {
  const [viewMode, setViewMode] = useState<EditorViewMode>("reading");
  const [activeUnitIndex, setActiveUnitIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [initialCaret, setInitialCaret] = useState(0);
  const [heavyDoc, setHeavyDoc] = useState(false);
  const [toast, setToast] = useState<EditorToast | null>(null);
  const toastIdRef = useRef(0);

  const units = useMemo(() => buildEditUnits(markdown), [markdown]);
  const activeUnit = activeUnitIndex === null ? null : (units.find((unit) => unit.index === activeUnitIndex) ?? null);

  const showToast = useCallback((message: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, message });
  }, []);

  const closeActive = useCallback(() => {
    setActiveUnitIndex(null);
    setDraft("");
    setInitialCaret(0);
  }, []);

  const activateUnit = useCallback(
    (index: number, caretOffset: number) => {
      if (mdlogActive) {
        showToast("记录中 · 编辑已禁用");
        return;
      }
      const unit = units.find((candidate) => candidate.index === index);
      if (!unit?.editable) return;
      setActiveUnitIndex(index);
      setDraft(markdown.slice(unit.start, unit.end));
      setInitialCaret(caretOffset);
    },
    [markdown, mdlogActive, showToast, units]
  );

  const commitActive = useCallback(async () => {
    if (!activeUnit) return;
    const original = markdown.slice(activeUnit.start, activeUnit.end);
    if (draft === original) {
      closeActive();
      return;
    }

    const next = spliceUnit(markdown, activeUnit, draft);

    // flushSync 让整篇重解析同步完成，才能量到真实的提交耗时
    const startedAt = performance.now();
    flushSync(() => onMarkdownChange(next));
    const renderMs = performance.now() - startedAt;
    if (renderMs > heavyCommitMs) setHeavyDoc(true);

    closeActive();
    try {
      await save(next);
    } catch (error) {
      // 保存失败：草稿留在框里（重新激活同一块并保留草稿），让用户可重试
      setDraft(draft);
      setActiveUnitIndex(activeUnit.index);
      showToast(`保存失败：${String(error)}`);
    }
  }, [activeUnit, closeActive, draft, heavyCommitMs, markdown, onMarkdownChange, save, showToast]);

  const toggleView = useCallback(async () => {
    if (viewMode === "editing") {
      await commitActive();
      setViewMode("reading");
      return;
    }
    if (mdlogActive) {
      showToast("记录中 · 断开连接后才能修改");
      return;
    }
    setViewMode("editing");
  }, [commitActive, mdlogActive, showToast, viewMode]);

  /// 中断路径共用：尽力把草稿写进剪贴板，然后取消编辑
  const notifyInterrupted = useCallback(
    (message: string) => {
      if (activeUnitIndex === null) {
        showToast(message);
        return;
      }
      void navigator.clipboard?.writeText(draft).catch(() => {});
      closeActive();
      showToast(message);
    },
    [activeUnitIndex, closeActive, draft, showToast]
  );

  const notifyLocked = useCallback(
    (reason: "html" | "widget") => {
      showToast(reason === "html" ? "HTML 区块为只读" : "交互块只读，点击可交互");
    },
    [showToast]
  );

  const updateDraft = useCallback((text: string) => {
    setDraft(text);
  }, []);

  return {
    viewMode,
    toggleView,
    units,
    activeUnit,
    draft,
    initialCaret,
    heavyDoc,
    toast,
    activateUnit,
    updateDraft,
    commitActive,
    notifyLocked,
    notifyInterrupted,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/hooks/useDocumentEditor.test.ts`
Expected: PASS（8 用例）

- [ ] **Step 5: 与 spec 的差异登记**

spec §6.4 原写「外部变更且有改动 ⇒ 保留草稿 + 二选一横幅」。本计划**简化为**与「mdlog 中途开始」完全相同的路径：`notifyInterrupted`（尽力写剪贴板 + 取消 + 提示），不实现二选一横幅。理由：提交即落盘使草稿存活窗口极短，而二选一横幅需额外状态机与 UI。执行时同步在 spec 的 §6.4 加一行修订标记。

- [ ] **Step 6: 回归 + 提交**

```bash
npx vitest run src/hooks/useDocumentEditor.test.ts && npm test && npx tsc --noEmit
git add src/hooks/useDocumentEditor.ts src/hooks/useDocumentEditor.test.ts
git commit -m "feat(edit): 编辑会话状态机（提交即落盘、自适应重文档提示、中断与失败路径）"
```

---

