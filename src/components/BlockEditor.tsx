import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { computeOverlayBox, type OverlayBox } from "../lib/editorGeometry";

export type BlockEditorProps = {
  unitIndex: number;
  /// 受控草稿：由上层（useDocumentEditor）持有，因此上层可随时「先提交再切视图/跳转」
  value: string;
  initialCaret: number;
  onChange: (text: string) => void;
  onCommit: () => void;
  /// 取消信号。v1 里 Esc 与提交同义（见下方 requestCommit），暂无消费点，
  /// 契约先留给上层的后续接线（Task 4/6）。
  onCancel: () => void;
};

/// 被隐藏 / 锁高 / 自增高改写过的内联样式，卸载时逐项还原。
const MANAGED_STYLES = ["visibility", "overflow", "height"] as const;

/// 标记可能落在外包容器 `.vellum-unit-wrap` 上，而 T7 给它的 CSS 是 display: contents：
/// 它不生成布局盒，对其设 height / visibility 无效，测量也恒返回 0（裁定 F18）。
/// 故先解析出真正的操作目标：rect 高度为 0 说明命中的是无盒包裹层，改用其首个元素子节点。
function resolveTarget(unitIndex: number): HTMLElement | null {
  const marked = document.querySelector<HTMLElement>(`[data-vellum-unit="${unitIndex}"]`);
  if (!marked) return null;
  if (marked.getBoundingClientRect().height === 0) {
    return marked.firstElementChild instanceof HTMLElement ? marked.firstElementChild : marked;
  }
  return marked;
}

/// 受控 textarea：草稿由上层持有，因此上层可随时「先提交再切视图/跳搜索」，
/// 不需要向子组件反向注册提交函数。
export function BlockEditor({
  unitIndex,
  value,
  initialCaret,
  onChange,
  onCommit,
}: BlockEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [box, setBox] = useState<OverlayBox | null>(null);

  // 原块就地消失：占位（隐藏 + 锁住原高）与自增高都写在这个元素上。
  // 依赖只有 unitIndex —— 若把 initialCaret 也算进来，效果会重跑并把「已隐藏」的状态
  // 当成原状记下来，卸载时就还原不回原样了。
  useLayoutEffect(() => {
    const target = resolveTarget(unitIndex);
    const textarea = textareaRef.current;
    if (!target || !textarea) return;

    // 覆盖层是 .document-scroll__content 的绝对定位子元素，基准必须是该宿主容器
    // （裁定 F4：不用 offsetParent —— jsdom 下恒为 null，测试覆盖不到）
    const host = target.closest<HTMLElement>(".document-scroll__content");
    const previous = MANAGED_STYLES.map((name) => [name, target.style[name]] as const);
    const targetRect = target.getBoundingClientRect();

    target.style.visibility = "hidden";
    target.style.overflow = "hidden";
    target.style.height = `${targetRect.height}px`;
    if (host) setBox(computeOverlayBox(targetRect, host.getBoundingClientRect()));
    target.style.height = `${textarea.scrollHeight}px`;

    // 自增高：草稿变长时把原块一起撑高，后续内容被推下去（而不是被覆盖层盖住）
    const observer = new ResizeObserver(() => {
      target.style.height = `${textarea.scrollHeight}px`;
    });
    observer.observe(textarea);

    return () => {
      observer.disconnect();
      for (const [name, previousValue] of previous) target.style[name] = previousValue;
    };
  }, [unitIndex]);

  // 挂载/换块时定位光标；不在 value 变化时重定位，否则打字会跳光标。
  // 裁定 F5b：不设「挂载期失焦守卫」—— 焦点就在这里一次性设置，不产生多余 blur，
  // 而守卫会把真实失焦（提交路径之一）一起吞掉。
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    const caret = Math.max(0, Math.min(initialCaret, textarea.value.length));
    textarea.setSelectionRange(caret, caret);
  }, [unitIndex, initialCaret]);

  return (
    <textarea
      ref={textareaRef}
      className="block-editor__input"
      data-block-editor-for={unitIndex}
      value={value}
      spellCheck={false}
      style={
        box ? { top: box.top, left: box.left, width: box.width, minHeight: box.minHeight } : undefined
      }
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCommit();
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          onCommit();
        }
      }}
      onBlur={() => onCommit()}
    />
  );
}
