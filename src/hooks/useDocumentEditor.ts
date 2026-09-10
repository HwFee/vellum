import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/// 提示条的自动消失时长（裁定 F31，spec §9）：它是 position: fixed 的覆盖层，
/// 不能永久压在正文上，也不能以 CSS 动画作为唯一的消失机制。
const TOAST_DURATION_MS = 2400;

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
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /// 提交闸门（终审 C2 / 裁定 F38-B）：一次提交从「拼接/落盘」到结果返回之间，
  /// 同一会话的重复调用必须直接返回 —— 不得再 splice 一次、再落盘一次。
  /// 真机里 `Ctrl+S` 在编辑框内会同时走两条通道（textarea 的 onKeyDown 与 window 的全局兜底），
  /// 而第一次提交的 flushSync 会同步把父级 markdown 推前、`editorRef` 已换成新闭包，
  /// 第二次调用会拿「新 markdown 的同索引单元」当原文比对 ⇒ 草稿改变块结构时重复拼入。
  /// 组件侧的 `committedRef`（F22）只拦得住它自己那条通道，闸门必须落在会话状态机这一层。
  const committingRef = useRef(false);

  const units = useMemo<EditUnit[]>(() => buildEditUnits(markdown), [markdown]);
  const activeUnit =
    activeUnitIndex === null
      ? null
      : (units.find((unit) => unit.index === activeUnitIndex) ?? null);

  const clearToastTimer = useCallback(() => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
  }, []);

  /// 手动关闭（测试与未来的关闭交互用）：与自动消失走同一清理路径
  const dismissToast = useCallback(() => {
    clearToastTimer();
    setToast(null);
  }, [clearToastTimer]);

  const showToast = useCallback(
    (message: string) => {
      toastIdRef.current += 1;
      setToast({ id: toastIdRef.current, message });
      // 每条提示都有完整的 2.4s 可见时长：新增提示时重置计时（旧计时器作废）
      clearToastTimer();
      toastTimerRef.current = setTimeout(() => {
        toastTimerRef.current = null;
        setToast(null);
      }, TOAST_DURATION_MS);
    },
    [clearToastTimer]
  );

  // 卸载时清掉未到期的计时器（否则会在已卸载的组件上 setState）
  useEffect(() => clearToastTimer, [clearToastTimer]);

  /// 清空编辑会话（活动块 / 草稿 / caret）。两条语义共用同一实现：
  /// ① 提交完成或中断时的内部收起；
  /// ② 对外暴露的 `resetSession` —— 切换文档时必须调用（裁定 F39）：
  ///    F24 的失败重激活会把会话连同草稿一起留在原地，跨过文档边界后
  ///    就会被按「同序号块」拼进新文档（写到错的文件里）。
  const resetSession = useCallback(() => {
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

  /// 中断路径共用：尽力把草稿写进剪贴板，然后取消编辑
  const notifyInterrupted = useCallback(
    (message: string) => {
      if (activeUnitIndex === null) {
        showToast(message);
        return;
      }
      void navigator.clipboard?.writeText(draft).catch(() => {});
      resetSession();
      showToast(message);
    },
    [activeUnitIndex, draft, resetSession, showToast]
  );

  /// 提交当前块。返回值是「本次调用后是否已无待落盘草稿」：
  /// true = 会话已收起（无活动块 / 无改动 / 已落盘 / 被 mdlog 门禁中断）；
  /// false = 落盘失败，草稿仍留在框里等用户处理（F24）。
  /// 关窗前提交（审查 C1 / 裁定 F33）必须据此决定是否拦截 —— 直接读消费者侧的
  /// editorRef 拿到的是上一轮渲染的快照，在 await 之后可能尚未跟进（实测两个方向都会错）。
  const commitActive = useCallback(async (): Promise<boolean> => {
    // 无活动块先短路（审查 Minor 2）：F6 的全局 Ctrl+S 兜底让本函数在阅读态可达，
    // 此时没有任何编辑会话可中断，不得弹「记录已开始，编辑已取消」。
    if (!activeUnit) return true;
    // 提交口门禁（裁定 F25）：只拦入口不够 —— 激活块之后记录才建立时，
    // Ctrl+S / 失焦 / toggleView 都会走到这里，必须同样禁止写入。
    if (mdlogActive) {
      notifyInterrupted("记录已开始，编辑已取消");
      return true;
    }
    // 重入闸门（裁定 F38-B）：已有提交在途时直接返回，绝不重做一遍。
    // 真机的双通道（textarea + window）正是从这条短路里被拦掉的。
    if (committingRef.current) return true;
    const original = toDraftText(markdown.slice(activeUnit.start, activeUnit.end));
    if (draft === original) {
      resetSession();
      return true;
    }

    // 失败分支要按「本次提交前的块」重激活，故在此冻结索引与 caret
    const unitIndex = activeUnit.index;
    const caret = initialCaret;
    const next = spliceUnit(markdown, activeUnit, draft);

    committingRef.current = true;
    try {
      // flushSync 让整篇重解析同步完成，才能量到真实的提交耗时（重文档标记的依据）
      const startedAt = performance.now();
      flushSync(() => onMarkdownChange(next));
      const renderMs = performance.now() - startedAt;
      // heavyDoc 有意保持粘性（裁定 F26）：它是「文档规模」属性而非瞬时值，
      // 本会话内不回退 —— 观测到超阈值提交一次后即不再反复探测。
      if (renderMs > heavyCommitMs) setHeavyDoc(true);

      resetSession();
      await save(next);
      return true;
    } catch (error) {
      // 失败路径（裁定 F24）：先把父级内存回退到本次提交前的 markdown，
      // 让内存与磁盘重新一致（提交即落盘、落盘失败即回退），
      // 再重新激活同一块并保留草稿与用户原点击的 caret，供其直接重试。
      flushSync(() => onMarkdownChange(markdown));
      setActiveUnitIndex(unitIndex);
      setDraft(draft);
      setInitialCaret(caret);
      showToast(`保存失败：${String(error)}`);
      return false;
    } finally {
      committingRef.current = false;
    }
  }, [
    activeUnit,
    draft,
    heavyCommitMs,
    initialCaret,
    markdown,
    mdlogActive,
    notifyInterrupted,
    onMarkdownChange,
    resetSession,
    save,
    showToast,
  ]);

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
    // 空态/加载态（无块单元）不进编辑视图（审查 Minor 1）：否则顶栏呈按下态，
    // 宿主还会挂上 T7 会加 position: relative 的 --editing 类，而没有任何块可编辑。
    if (units.length === 0) return;
    setViewMode("editing");
  }, [commitActive, mdlogActive, showToast, units.length, viewMode]);

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
    resetSession,
    dismissToast,
  };
}
