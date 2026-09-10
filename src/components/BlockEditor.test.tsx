import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockEditor } from "./BlockEditor";

/// 与简报（计划 Step 5）逐字一致的极简夹具：只有滚动容器 + 正文层。
function mountFixture(source = "正文") {
  document.body.innerHTML = `
    <div class="document-scroll">
      <div class="markdown-body"><p data-vellum-unit="0">${source}</p></div>
    </div>`;
  return document.querySelector<HTMLElement>('[data-vellum-unit="0"]')!;
}

/// 覆盖层几何（裁定 F4）需要真实的宿主容器 .document-scroll__content。
function mountHostFixture(inner: string) {
  document.body.innerHTML = `
    <div class="document-scroll">
      <div class="document-scroll__content">
        <div class="markdown-body">${inner}</div>
      </div>
    </div>`;
  return document.querySelector<HTMLElement>(".document-scroll__content")!;
}

/// 受控宿主：把草稿状态放在测试里，与 useDocumentEditor 的接法一致
function Harness({
  initial = "正文",
  onCommit,
  initialCaret = 0,
}: {
  initial?: string;
  onCommit: () => void;
  initialCaret?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <BlockEditor
      unitIndex={0}
      value={value}
      initialCaret={initialCaret}
      onChange={setValue}
      onCommit={onCommit}
      onCancel={vi.fn()}
    />
  );
}

const rectLike = (
  top: number,
  left: number,
  width: number,
  height: number
): DOMRect =>
  ({
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/// 捕获 ResizeObserver 回调，用于验证「自增高写回原块高度」（setup.ts 的全局 mock 不回调）
const resizeCallbacks: ResizeObserverCallback[] = [];
const observedTargets: Element[] = [];

class CaptureResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe(target: Element): void {
    observedTargets.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    resizeCallbacks.length = 0;
  }
}

const OriginalResizeObserver = globalThis.ResizeObserver;

describe("BlockEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resizeCallbacks.length = 0;
    observedTargets.length = 0;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100, left: 20, width: 600, height: 80, bottom: 180, right: 620, x: 20, y: 100, toJSON: () => ({}),
    } as DOMRect);
    // jsdom 的 scrollHeight 恒为 0，自增高 / 锁高断言都依赖真实读数（裁定 F5a）
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 80,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    globalThis.ResizeObserver = OriginalResizeObserver;
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

  it("覆盖层盒以 .document-scroll__content 宿主矩形为基准（裁定 F4）", () => {
    mountHostFixture(`<p data-vellum-unit="0">正文</p>`);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("document-scroll__content")) return rectLike(100, 30, 720, 600);
        return rectLike(300, 40, 700, 120);
      }
    );

    render(<Harness onCommit={vi.fn()} />);

    const input = screen.getByRole("textbox");
    expect(input.style.top).toBe("200px");
    expect(input.style.left).toBe("10px");
    expect(input.style.width).toBe("700px");
    expect(input.style.minHeight).toBe("120px");
  });

  it("目标为 display:contents 的 .vellum-unit-wrap 时，样式与测量都落到其元素子节点（裁定 F18）", () => {
    mountHostFixture(
      `<div class="vellum-unit-wrap" data-vellum-unit="0"><pre>code</pre></div>`
    );
    const wrapper = document.querySelector<HTMLElement>(".vellum-unit-wrap")!;
    const pre = wrapper.firstElementChild as HTMLElement;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("document-scroll__content")) return rectLike(100, 30, 720, 600);
        // display: contents 不生成布局盒，Chromium 下 rect 全 0
        if (this.classList.contains("vellum-unit-wrap")) return rectLike(0, 0, 0, 0);
        return rectLike(300, 40, 700, 120);
      }
    );

    const { unmount } = render(<Harness onCommit={vi.fn()} />);

    expect(pre.style.visibility).toBe("hidden");
    expect(pre.style.height).toBe("80px");
    expect(screen.getByRole("textbox").style.top).toBe("200px");
    // 包裹层本身不生成布局盒，绝不写内联样式
    expect(wrapper.getAttribute("style")).toBeNull();

    unmount();
    expect(pre.style.visibility).toBe("");
    expect(pre.style.height).toBe("");
  });

  it("草稿自增高时把新高度写回原块（后续内容被推下去）且卸载后停止", () => {
    globalThis.ResizeObserver = CaptureResizeObserver as unknown as typeof ResizeObserver;
    const target = mountFixture();
    const { unmount } = render(<Harness onCommit={vi.fn()} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(observedTargets).toContain(textarea);
    // 模拟输入多行后 textarea 长高
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 240 });

    expect(target.style.height).toBe("80px");
    for (const callback of [...resizeCallbacks]) callback([], {} as ResizeObserver);
    expect(target.style.height).toBe("240px");

    unmount();
    expect(target.style.height).toBe("");
    // 卸载时 observer 已 disconnect（CaptureResizeObserver 清空回调）
    expect(resizeCallbacks).toHaveLength(0);
  });
});
