### Task 3: 就地编辑面 `BlockEditor`

**Files:**
- Create: `src/lib/editorGeometry.ts`
- Create: `src/lib/editorGeometry.test.ts`
- Create: `src/components/BlockEditor.tsx`
- Create: `src/components/BlockEditor.test.tsx`

**Interfaces:**
- Consumes: 无（只操作已渲染的 DOM）
- Produces:
  ```ts
  // src/lib/editorGeometry.ts
  export type OverlayBox = { top: number; left: number; width: number; minHeight: number };
  export function computeOverlayBox(
    targetRect: DOMRectLike, containerRect: DOMRectLike, containerScrollTop: number
  ): OverlayBox;
  // src/components/BlockEditor.tsx
  export type BlockEditorProps = {
    unitIndex: number;
    value: string;                 // 受控草稿（由 useDocumentEditor 拥有，便于切视图/跳转时强制提交）
    initialCaret: number;
    onChange: (text: string) => void;
    onCommit: () => void;
    onCancel: () => void;
  };
  ```
- DOM 契约：容器 `.markdown-body` 上加 `markdown-body--editing` 类（提供 `position: relative`）；原块元素被指向后写入内联样式 `visibility:hidden; overflow:hidden; height:<px>`，卸载时**逐项还原**

- [ ] **Step 1: 写失败测试（几何纯函数）**

```ts
// src/lib/editorGeometry.test.ts
import { describe, expect, it } from "vitest";
import { computeOverlayBox } from "./editorGeometry";

const rect = (top: number, left: number, width: number, height: number) =>
  ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRect;

describe("computeOverlayBox", () => {
  it("按容器滚动量换算相对坐标", () => {
    const box = computeOverlayBox(
      rect(300, 40, 700, 120),
      rect(100, 40, 700, 600),
      200
    );
    expect(box).toEqual({ top: 400, left: 0, width: 700, minHeight: 120 });
  });

  it("高度为 0 时给出 1 像素下限", () => {
    const box = computeOverlayBox(rect(300, 40, 700, 0), rect(100, 40, 700, 600), 0);
    expect(box.minHeight).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/editorGeometry.test.ts`
Expected: FAIL —— `Failed to resolve import "./editorGeometry"`

- [ ] **Step 3: 实现几何函数**

```ts
// src/lib/editorGeometry.ts
export type DOMRectLike = { top: number; left: number; width: number; height: number };
export type OverlayBox = { top: number; left: number; width: number; minHeight: number };

/// 把目标块相对视口的矩形换算为「相对滚动容器内容原点」的覆盖层盒。
/// 覆盖层的 offsetParent 是 .markdown-body（编辑视图下 position: relative），
/// 因此 left 取目标相对容器左缘的距离，top 需加上容器已滚动的距离。
export function computeOverlayBox(
  targetRect: DOMRectLike,
  containerRect: DOMRectLike,
  containerScrollTop: number
): OverlayBox {
  return {
    top: targetRect.top - containerRect.top + containerScrollTop,
    left: targetRect.left - containerRect.left,
    width: targetRect.width,
    minHeight: Math.max(1, targetRect.height),
  };
}
```

- [ ] **Step 4: 实现 `BlockEditor`**

```tsx
// src/components/BlockEditor.tsx
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { computeOverlayBox, type OverlayBox } from "../lib/editorGeometry";

export type BlockEditorProps = {
  unitIndex: number;
  value: string;
  initialCaret: number;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

const MANAGED_STYLES = ["visibility", "overflow", "height"] as const;

/// 受控 textarea：草稿由上层（useDocumentEditor）持有，因此上层可随时
/// 「先提交再切视图/跳搜索」，不需要向子组件反向注册提交函数。
export function BlockEditor({ unitIndex, value, initialCaret, onChange, onCommit }: BlockEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [box, setBox] = useState<OverlayBox | null>(null);
  const settlingRef = useRef(false);

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-vellum-unit="${unitIndex}"]`);
    const container = document.querySelector<HTMLElement>(".document-scroll");
    const textarea = textareaRef.current;
    if (!target || !container || !textarea) return;

    const previous = MANAGED_STYLES.map((name) => [name, target.style[name]] as const);
    const targetRect = target.getBoundingClientRect();
    target.style.visibility = "hidden";
    target.style.overflow = "hidden";
    target.style.height = `${targetRect.height}px`;

    setBox(computeOverlayBox(targetRect, container.getBoundingClientRect(), container.scrollTop));
    target.style.height = `${textarea.scrollHeight}px`;

    // 自增高：textarea 涨高时把原块也撑高，后续内容被推下去（不是被盖住）
    const observer = new ResizeObserver(() => {
      target.style.height = `${textarea.scrollHeight}px`;
    });
    observer.observe(textarea);

    return () => {
      observer.disconnect();
      for (const [name, previousValue] of previous) target.style[name] = previousValue;
    };
  }, [unitIndex]);

  // 挂载时定位光标（不在每次 value 变化时重定位，否则打字会跳光标）
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    settlingRef.current = true;
    textarea.focus();
    const caret = Math.max(0, Math.min(initialCaret, textarea.value.length));
    textarea.setSelectionRange(caret, caret);
    const timer = setTimeout(() => {
      settlingRef.current = false;
    }, 0);
    return () => clearTimeout(timer);
  }, [unitIndex, initialCaret]);

  function requestCommit() {
    onCommit();
  }

  return (
    <textarea
      ref={textareaRef}
      className="block-editor__input"
      data-block-editor-for={unitIndex}
      value={value}
      spellCheck={false}
      style={box ? { top: box.top, left: box.left, width: box.width, minHeight: box.minHeight } : undefined}
      onChange={(event) => onChange(event.target.value)}
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
      onBlur={() => {
        // 挂载后首次定位光标可能触发一次失焦，忽略该次
        if (settlingRef.current) return;
        requestCommit();
      }}
    />
  );
}
```

- [ ] **Step 5: 写组件测试**

```tsx
// src/components/BlockEditor.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockEditor } from "./BlockEditor";

function mountFixture(source = "正文") {
  document.body.innerHTML = `
    <div class="document-scroll">
      <div class="markdown-body"><p data-vellum-unit="0">${source}</p></div>
    </div>`;
  return document.querySelector<HTMLElement>('[data-vellum-unit="0"]')!;
}

/// 受控宿主：把草稿状态放在测试里，与 useDocumentEditor 的接法一致
function Harness({ initial = "正文", onCommit }: { initial?: string; onCommit: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <BlockEditor
      unitIndex={0}
      value={value}
      initialCaret={0}
      onChange={setValue}
      onCommit={onCommit}
      onCancel={vi.fn()}
    />
  );
}

describe("BlockEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100, left: 20, width: 600, height: 80, bottom: 180, right: 620, x: 20, y: 100, toJSON: () => ({}),
    } as DOMRect);
  });

  it("隐藏原块并锁高，卸载时还原内联样式", () => {
    const target = mountFixture();
    const { unmount } = render(<Harness onCommit={vi.fn()} />);

    expect(target.style.visibility).toBe("hidden");
    expect(target.style.overflow).toBe("hidden");
    expect(target.style.height).toBe("80px");

    unmount();
    expect(target.style.visibility).toBe("");
    expect(target.style.height).toBe("");
  });

  it("Esc 提交当前草稿（草稿由上层持有，提交只发信号）", () => {
    mountFixture();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "改过的正文" } });
    expect(screen.getByRole("textbox")).toHaveValue("改过的正文");

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+S 与失焦都走同一条提交信号，且失焦不乱触发", async () => {
    mountFixture();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);

    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 6: 回归 + 提交**

```bash
npx vitest run src/lib/editorGeometry.test.ts src/components/BlockEditor.test.tsx && npm test && npx tsc --noEmit
git add src/lib/editorGeometry.ts src/lib/editorGeometry.test.ts src/components/BlockEditor.tsx src/components/BlockEditor.test.tsx
git commit -m "feat(edit): 就地编辑面 BlockEditor（隐藏原块锁高、自增高推流、Esc/失焦提交）"
```

---

