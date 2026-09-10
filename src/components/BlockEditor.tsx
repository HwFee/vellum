import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
function firstLayoutChildOrSelf(marked: HTMLElement): HTMLElement {
  return marked.firstElementChild instanceof HTMLElement ? marked.firstElementChild : marked;
}

/// 解析真正要操作的元素（隐藏 / 锁高 / 自增高 / 测量同源）。
/// 首选判据是类名（裁定 F20）——`display: contents` 的包裹层正是 `.vellum-unit-wrap`，
/// 只有它才需要下钻；「rect 高 0」既有包装层的情况，也可能只是零高的真实块。
function resolveTarget(unitIndex: number): HTMLElement | null {
  const marked = document.querySelector<HTMLElement>(`[data-vellum-unit="${unitIndex}"]`);
  if (!marked) return null;
  if (marked.classList.contains("vellum-unit-wrap")) return firstLayoutChildOrSelf(marked);

  // 兜底（包裹层类名缺失但确实没有布局盒）。必须要求子节点自己**有**布局盒：
  // 否则「仅含未加载图片的段落」这类零高真实块会被下钻到行内子元素上，
  // 锁高对行内元素无效、覆盖层的 left/width 也会算错（裁定 F20）。
  if (marked.getBoundingClientRect().height === 0) {
    const child = marked.firstElementChild;
    if (child instanceof HTMLElement && child.getBoundingClientRect().height > 0) return child;
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
  const targetRef = useRef<HTMLElement | null>(null);
  /// 锁定的原块高度：自增高写回时的下限（草稿变短不能留下重叠空档）
  const lockedHeightRef = useRef(0);
  /// 一次性提交闸门（裁定 F22）：同一激活周期内 onCommit 最多发一次
  const committedRef = useRef(false);
  const [box, setBox] = useState<OverlayBox | null>(null);

  /// 自增高（裁定 F19）：textarea 的**盒高**不会随打字变化，ResizeObserver 因此
  /// 永远不会因为「草稿变长」而回调。所以必须由组件显式把 scrollHeight 写进
  /// textarea.style.height，再把同一个值写回原块 —— 后续内容才会被真正推下去。
  /// 下限取锁定的原高：草稿比原块短时，两个高度仍与覆盖层的 min-height 一致。
  const syncHeight = useCallback(() => {
    const textarea = textareaRef.current;
    const target = targetRef.current;
    if (!textarea || !target) return;
    // 必须先归零再量：scrollHeight 返回「内容高与自身可见高的较大值」，而 textarea 的
    // 固有高来自 rows（默认**2 行**）—— 不归零就会把单行草稿量成两行高，于是每次点击
    // 单行块都会撑出两行、把下方内容推下去（真机 UX 缺陷：单行下面留白 + 内容被推走）。
    // 配套 rows={1} 作双保险。
    textarea.style.height = "0px";
    const height = Math.max(textarea.scrollHeight, lockedHeightRef.current);
    textarea.style.height = `${height}px`;
    target.style.height = `${height}px`;
  }, []);

  // ① 定位 + 占位：隐藏原块、锁定原高、算覆盖层盒。
  // 本 effect **不依赖覆盖层已挂载**（覆盖层要等 box 才渲染，见 JSX）：否则会死锁——
  // 没有 box 就不渲染 textarea，而 effect 又要求 textarea 存在才继续。
  // 依赖只有 unitIndex —— 若把 initialCaret 也算进来，效果会重跑并把「已隐藏」的状态
  // 当成原状记下来，卸载时就还原不回原样了。
  useLayoutEffect(() => {
    committedRef.current = false; // 新激活周期：提交闸门复位（裁定 F22）
    const target = resolveTarget(unitIndex);
    // 降级路径共用：覆盖层不留任何内联样式（含自增高写过的高度）
    const dropOverlay = () => {
      const textarea = textareaRef.current;
      if (textarea) textarea.style.height = "";
      setBox(null);
    };

    if (!target) {
      // 标记丢失（如热重载后）时不得沿用上一个块的盒（裁定 F21③）
      dropOverlay();
      return;
    }

    // 覆盖层是 .document-scroll__content 的绝对定位子元素，基准必须是该宿主容器
    // （裁定 F4：不用 offsetParent —— jsdom 下恒为 null，测试覆盖不到）
    const host = target.closest<HTMLElement>(".document-scroll__content");
    if (!host) {
      // 宿主缺失时早退且**不隐藏原块**（裁定 F21②）：宁可不进编辑，
      // 也不能让用户看到「块消失 + 编辑器跑到别处」。
      dropOverlay();
      return;
    }

    const previous = MANAGED_STYLES.map((name) => [name, target.style[name]] as const);
    const targetRect = target.getBoundingClientRect();
    targetRef.current = target;
    lockedHeightRef.current = targetRect.height;
    target.style.visibility = "hidden";
    target.style.overflow = "hidden";
    target.style.height = `${targetRect.height}px`;
    setBox(computeOverlayBox(targetRect, host.getBoundingClientRect()));

    // 盒重算（裁定 F21①）：上方懒加载图片 / widget iframe 上报高度会把目标块顶下去，
    // 只算一次的盒会让编辑器漂在旧位置。
    const geometryObserver = new ResizeObserver(() => {
      const currentTarget = targetRef.current;
      if (!currentTarget) return;
      setBox(
        computeOverlayBox(currentTarget.getBoundingClientRect(), host.getBoundingClientRect())
      );
    });
    geometryObserver.observe(host);

    return () => {
      geometryObserver.disconnect();
      targetRef.current = null;
      for (const [name, previousValue] of previous) target.style[name] = previousValue;
    };
  }, [unitIndex]);

  // ② 覆盖层度量：必须在 ① 的 box 已写进 DOM、且覆盖层已挂载之后（裁定 F19 / 审查 Minor-9），
  // 否则读到的是 textarea 还在普通流、宽度未定时的换行结果。
  // 行高也在这里按**该块渲染态实测值**对齐（不写死）：段落 / 标题 / 列表项行高各不相同，
  // 不按块测量就会让盒高与首行基线一起漂移（单行块表现为「字往上跳 + 下面留白」）；
  // 必须先设行高再量高，否则量到的是旧度量的高度。
  useLayoutEffect(() => {
    if (!box) return;
    const textarea = textareaRef.current;
    const target = targetRef.current;
    if (textarea && target) {
      const renderedLineHeight = window.getComputedStyle(target).lineHeight;
      if (renderedLineHeight && renderedLineHeight !== "normal") {
        textarea.style.lineHeight = renderedLineHeight;
      }
    }
    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    if (textarea) observer.observe(textarea);
    return () => observer.disconnect();
  }, [box, syncHeight]);

  // 挂载/换块时定位光标；不在 value 变化时重定位，否则打字会跳光标。
  // 裁定 F5b：不设「挂载期失焦守卫」—— 焦点就在这里一次性设置，不产生多余 blur，
  // 而守卫会把真实失焦（提交路径之一）一起吞掉。
  // 依赖包含 box：覆盖层在 box 就绪前不渲染（见 JSX），故必须在盒应用后（重跑）才能 focus。
  // **preventScroll 是必须的**：若在盒尚未应用时 focus，textarea 还停在内容末尾的静态位置，
  // 浏览器会为把焦点元素滚入视野而**把整篇滚到底**（真机复现：点第一块 → scrollTop 直达底部；
  // 且该位置会被阅读位置记忆记住，下次打开也在底部）。
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !box) return;
    textarea.focus({ preventScroll: true });
    const caret = Math.max(0, Math.min(initialCaret, textarea.value.length));
    textarea.setSelectionRange(caret, caret);
  }, [unitIndex, initialCaret, box]);

  /// Esc / Ctrl+S / 失焦共用的一次性提交信号（裁定 F22）：上层提交是异步的，
  /// 组件在上层完成前仍挂载，没有闸门时一次编辑会走两遍提交。
  const requestCommit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit();
  }, [onCommit]);

  // 盒未就绪（解析失败 / 宿主缺失）时**不渲染**覆盖层：若把 textarea 先挂进文档，
  // 它是绝对定位但无 top/left，会停在内容末尾的静态位置，任何 focus 都会把整篇滚到底。
  if (!box) return null;

  return (
    <textarea
      ref={textareaRef}
      className="block-editor__input"
      // 调试属性：便于真机 DevTools / 手检时确认覆盖层对应哪个块，生产逻辑不消费。
      data-block-editor-for={unitIndex}
      // rows=1：textarea 的固有高默认是 2 行，会让首次测量与首次绘制都高出两行
      //（配合 syncHeight 的「归零再量」双保险，见该函数注释）。
      rows={1}
      value={value}
      spellCheck={false}
      style={{ top: box.top, left: box.left, width: box.width, minHeight: box.minHeight }}
      onChange={(event) => {
        onChange(event.target.value);
        syncHeight();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          requestCommit();
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          requestCommit();
        }
      }}
      onBlur={requestCommit}
    />
  );
}
