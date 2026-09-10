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
  /// 提交耗时的「重文档」阈值。默认 800ms，测试与真机校准可注入。
  heavyCommitMs?: number;
};

const DEFAULT_HEAVY_COMMIT_MS = 800;

/// 草稿与 caret 必须基于同一份 LF 归一文本（裁定 F9b/F14）：
/// 上游（MarkdownDocument 的点击回调）已按归一后的文本算 caret，此处切片必须同样归一，
/// 否则多行 CRLF 块（Windows 常态）的光标落点会系统性偏移。
/// 落盘的 CRLF 还原由 Rust 侧 dominant_eol 负责（Task 5），TS 侧不还原。
function toDraftText(source: string): string {
  return source.replace(/\r\n/g, "\n");
}

/// 编辑会话状态机：持有视图模式、块单元、当前编辑块与草稿，负责
/// 「提交即落盘」的存取编排、自适应重文档标记，以及中断 / 失败路径。
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

  const units = useMemo<EditUnit[]>(() => buildEditUnits(markdown), [markdown]);
  const activeUnit =
    activeUnitIndex === null
      ? null
      : (units.find((unit) => unit.index === activeUnitIndex) ?? null);

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
      setDraft(toDraftText(markdown.slice(unit.start, unit.end)));
      setInitialCaret(caretOffset);
    },
    [markdown, mdlogActive, showToast, units]
  );

  const commitActive = useCallback(async () => {
    if (!activeUnit) return;
    const original = toDraftText(markdown.slice(activeUnit.start, activeUnit.end));
    if (draft === original) {
      closeActive();
      return;
    }

    const next = spliceUnit(markdown, activeUnit, draft);

    // flushSync 让整篇重解析同步完成，才能量到真实的提交耗时（重文档标记的依据）
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
