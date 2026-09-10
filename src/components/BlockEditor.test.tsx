import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockEditor } from "./BlockEditor";

/// 与简报（计划 Step 5）逐字一致的极简夹具：只有滚动容器 + 正文层。
/// 注意：它没有 `.document-scroll__content`，即覆盖层宿主缺失的降级分支。
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

/// 两个可编辑块，用于验证 unitIndex 切换 / 解析失败时的盒重置。
function mountTwoUnitsFixture() {
  mountHostFixture(`<p data-vellum-unit="0">甲</p><p data-vellum-unit="1">乙</p>`);
  return {
    first: document.querySelector<HTMLElement>('[data-vellum-unit="0"]')!,
    second: document.querySelector<HTMLElement>('[data-vellum-unit="1"]')!,
  };
}

/// 受控宿主：把草稿状态放在测试里，与 useDocumentEditor 的接法一致
function Harness({
  initial = "正文",
  onCommit,
  initialCaret = 0,
  unitIndex = 0,
}: {
  initial?: string;
  onCommit: () => void;
  initialCaret?: number;
  unitIndex?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <BlockEditor
      unitIndex={unitIndex}
      value={value}
      initialCaret={initialCaret}
      onChange={setValue}
      onCommit={onCommit}
      onCancel={vi.fn()}
    />
  );
}

const rectLike = (top: number, left: number, width: number, height: number): DOMRect =>
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

/// ResizeObserver 替身：分别记录每个实例观察了谁、是否被 disconnect，
/// 并可手工驱动回调（setup.ts 的全局 mock 从不回调）。
/// 用 disconnectCalled 记录而非清空共享回调表，避免「替身自己清空」混淆语义（审查 Minor-10）。
class CaptureResizeObserver {
  static instances: CaptureResizeObserver[] = [];
  readonly callback: ResizeObserverCallback;
  observed: Element[] = [];
  disconnectCalled = false;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    CaptureResizeObserver.instances.push(this);
  }
  observe(target: Element): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnectCalled = true;
    this.observed = [];
  }
  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const observersFor = (target: Element) =>
  CaptureResizeObserver.instances.filter((observer) => observer.observed.includes(target));

const OriginalResizeObserver = globalThis.ResizeObserver;

describe("BlockEditor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    CaptureResizeObserver.instances = [];
    globalThis.ResizeObserver = CaptureResizeObserver as unknown as typeof ResizeObserver;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100, left: 20, width: 600, height: 80, bottom: 180, right: 620, x: 20, y: 100, toJSON: () => ({}),
    } as DOMRect);
    // jsdom 的 scrollHeight 恒为 0。取值刻意与 rect 高度（80）不同，
    // 让「锁定原高」与「自增高写回」两个断言可区分（裁定 F5a / 审查 Minor-8）。
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 96,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    globalThis.ResizeObserver = OriginalResizeObserver;
  });

  it("宿主容器缺失时早退：不隐藏原块、不写内联样式、覆盖层不定位（裁定 F21②）", () => {
    const target = mountFixture();
    render(<Harness onCommit={vi.fn()} />);

    // 宁可不进编辑，也不能让用户看到「块消失 + 编辑器跑到别处」
    expect(target.getAttribute("style")).toBeNull();
    const input = screen.getByRole("textbox");
    expect(input.style.cssText).toBe("");
    expect(input.style.top).toBe("");
  });

  it("隐藏原块并锁定原高，自增高把 scrollHeight 写回原块，卸载时逐项还原", () => {
    mountHostFixture(`<p data-vellum-unit="0">正文</p>`);
    const target = document.querySelector<HTMLElement>('[data-vellum-unit="0"]')!;
    const { unmount } = render(<Harness onCommit={vi.fn()} />);

    expect(target.style.visibility).toBe("hidden");
    expect(target.style.overflow).toBe("hidden");
    // 锁定原高（rect 80）体现为覆盖层的 minHeight，与自增高写回的 96px 可区分
    expect(screen.getByRole("textbox").style.minHeight).toBe("80px");
    expect(target.style.height).toBe("96px");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).style.height).toBe("96px");

    unmount();
    expect(target.style.visibility).toBe("");
    expect(target.style.overflow).toBe("");
    expect(target.style.height).toBe("");
  });

  it("Esc 提交当前草稿（草稿由上层持有，提交只发信号）", () => {
    mountHostFixture(`<p data-vellum-unit="0">正文</p>`);
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "改过的正文" } });
    expect(screen.getByRole("textbox")).toHaveValue("改过的正文");

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("Esc / Ctrl+S / 失焦共用一次性提交闸门：首个信号之后不再重复提交（裁定 F22）", () => {
    mountHostFixture(`<p data-vellum-unit="0">正文</p>`);
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", ctrlKey: true });
    expect(onCommit).toHaveBeenCalledTimes(1);

    // 同一激活周期内：失焦与 Esc 都不得再发一次（异步提交期间尤其重要）
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onCommit).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(onCommit).toHaveBeenCalledTimes(1);
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

  it("目标为 .vellum-unit-wrap 时，样式与测量都落到其元素子节点（裁定 F18）", () => {
    mountHostFixture(`<div class="vellum-unit-wrap" data-vellum-unit="0"><pre>code</pre></div>`);
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
    // 锁定的原高（rect 120）大于 mock 的 scrollHeight（96）⇒ 自增高取两者下限
    expect(pre.style.height).toBe("120px");
    expect(screen.getByRole("textbox").style.top).toBe("200px");
    // 包裹层本身不生成布局盒，绝不写内联样式
    expect(wrapper.getAttribute("style")).toBeNull();

    unmount();
    expect(pre.style.visibility).toBe("");
    expect(pre.style.height).toBe("");
  });

  it("零高真实块（仅含未加载图片的段落）不被误判为包裹层（裁定 F20）", () => {
    mountHostFixture(`<p data-vellum-unit="0"><img alt=""></p>`);
    const paragraph = document.querySelector<HTMLElement>('p[data-vellum-unit="0"]')!;
    const image = paragraph.firstElementChild as HTMLElement;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("document-scroll__content")) return rectLike(100, 30, 720, 600);
        if (this === paragraph) return rectLike(300, 40, 700, 0);
        // 未加载的图片没有布局盒
        if (this === image) return rectLike(300, 40, 0, 0);
        return rectLike(300, 40, 700, 120);
      }
    );

    const { unmount } = render(<Harness onCommit={vi.fn()} />);

    // 段落自己就是操作目标：不能下钻到行内子元素（锁高对行内元素无效、left/width 会算错）
    expect(paragraph.style.visibility).toBe("hidden");
    expect(paragraph.style.height).not.toBe("");
    expect(image.getAttribute("style")).toBeNull();

    unmount();
    expect(paragraph.style.visibility).toBe("");
  });

  it("草稿变长时 onChange 直接写高（不依赖 textarea 自身盒高变化），无需手工触发 RO（裁定 F19）", () => {
    mountHostFixture(`<p data-vellum-unit="0">正文</p>`);
    const target = document.querySelector<HTMLElement>('[data-vellum-unit="0"]')!;
    render(<Harness onCommit={vi.fn()} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    // 打字只改 scrollHeight，不改 textarea 的 border box ⇒ RO 永不回调，
    // 所以必须由 onChange 显式把 scrollHeight 写进双方的高度
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 240 });

    fireEvent.change(textarea, { target: { value: "很长\n的\n草稿" } });

    expect(textarea.style.height).toBe("240px");
    expect(target.style.height).toBe("240px");
    // 未手工触发任何 RO 回调
    expect(CaptureResizeObserver.instances.every((observer) => observer.disconnectCalled === false)).toBe(
      true
    );
  });

  it("RO 回调同样把 scrollHeight 写回原块，卸载后所有 observer 已 disconnect（裁定 F19 / 审查 Minor-10）", () => {
    mountHostFixture(`<p data-vellum-unit="0">正文</p>`);
    const target = document.querySelector<HTMLElement>('[data-vellum-unit="0"]')!;
    const { unmount } = render(<Harness onCommit={vi.fn()} />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    const textareaObservers = observersFor(textarea);
    expect(textareaObservers.length).toBeGreaterThan(0);

    Object.defineProperty(textarea, "scrollHeight", { configurable: true, get: () => 240 });
    textareaObservers[textareaObservers.length - 1].trigger();

    expect(textarea.style.height).toBe("240px");
    expect(target.style.height).toBe("240px");

    unmount();
    expect(CaptureResizeObserver.instances.length).toBeGreaterThan(0);
    expect(CaptureResizeObserver.instances.every((observer) => observer.disconnectCalled)).toBe(true);
  });

  it("宿主容器尺寸变化时重算覆盖层盒，编辑器不再漂在旧位置（裁定 F21①）", () => {
    const host = mountHostFixture(`<p data-vellum-unit="0">正文</p>`);
    const rectMock = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("document-scroll__content")) return rectLike(100, 30, 720, 600);
        return rectLike(300, 40, 700, 120);
      });

    render(<Harness onCommit={vi.fn()} />);
    expect(screen.getByRole("textbox").style.top).toBe("200px");

    const hostObservers = observersFor(host);
    expect(hostObservers).toHaveLength(1);

    // 上方懒加载图片 / widget iframe 上报高度：目标块下移 60px，宿主也变高
    rectMock.mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("document-scroll__content")) return rectLike(100, 30, 720, 660);
      return rectLike(360, 40, 700, 120);
    });
    act(() => hostObservers[0].trigger());

    expect(screen.getByRole("textbox").style.top).toBe("260px");
  });

  it("目标解析失败（热重载后标记丢失）时清空覆盖层盒，不沿用上一块（裁定 F21③）", () => {
    mountTwoUnitsFixture();
    const first = document.querySelector<HTMLElement>('[data-vellum-unit="0"]')!;
    const { rerender } = render(<Harness unitIndex={0} onCommit={vi.fn()} />);
    expect(first.style.visibility).toBe("hidden");
    expect(screen.getByRole("textbox").style.top).not.toBe("");

    rerender(<Harness unitIndex={99} onCommit={vi.fn()} />);

    expect(screen.getByRole("textbox").style.cssText).toBe("");
    expect(first.style.visibility).toBe("");
  });

  it("unitIndex 切换时先还原上一块的内联样式，再隐藏新块（审查 Minor-7）", () => {
    const { first, second } = mountTwoUnitsFixture();
    const { rerender } = render(<Harness unitIndex={0} onCommit={vi.fn()} />);

    expect(first.style.visibility).toBe("hidden");
    expect(second.getAttribute("style")).toBeNull();

    rerender(<Harness unitIndex={1} onCommit={vi.fn()} />);

    expect(first.style.visibility).toBe("");
    expect(first.style.height).toBe("");
    expect(second.style.visibility).toBe("hidden");
    expect(second.style.height).toBe("96px");
  });

  it("目标原本带内联 height 时，卸载后还原成原值而非清空（审查 Minor-7）", () => {
    mountHostFixture(`<p data-vellum-unit="0" style="height: 140px">正文</p>`);
    const target = document.querySelector<HTMLElement>('[data-vellum-unit="0"]')!;
    const { unmount } = render(<Harness onCommit={vi.fn()} />);

    // 编辑期间被覆盖成自增高后的高度
    expect(target.style.height).toBe("96px");

    unmount();
    expect(target.style.height).toBe("140px");
  });

  it("textarea 是单行固有高（rows=1），不是默认的两行", () => {
    mountHostFixture(`<p data-vellum-unit="0">正文</p>`);
    render(<Harness onCommit={vi.fn()} />);

    // 真机缺陷：rows 默认 2 ⇒ 单行草稿被量成两行高，每次点击都多出一行留白并把下方内容推走
    expect(screen.getByRole("textbox")).toHaveAttribute("rows", "1");
  });

  it("自增高先把高度归零再读 scrollHeight（否则 rows 的固有高会把结果抬高）", () => {
    mountHostFixture(`<p data-vellum-unit="0">正文</p>`);
    let heightAtRead: string | null = null;
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        heightAtRead = this.style.height;
        return 96;
      },
    });

    render(<Harness onCommit={vi.fn()} />);

    expect(heightAtRead).toBe("0px");
  });

  it("行高按目标块实测值对齐（不写死，标题/列表项才不会错位）", () => {
    mountHostFixture(`<p data-vellum-unit="0" style="line-height: 30px">正文</p>`);
    render(<Harness onCommit={vi.fn()} />);

    expect(screen.getByRole("textbox").style.lineHeight).toBe("30px");
  });
});
