import { afterEach, describe, expect, it, vi } from "vitest";
import { startViewportPin } from "./viewportPin";

function rect(top: number, height = 20): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 0,
    width: 0,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function mockRect(el: Element, top: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect(top));
}

function makeContainer(scrollTop: number, scrollHeight = 20000, clientHeight = 800): HTMLElement {
  const el = document.createElement("div");
  let top = scrollTop;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      // 浏览器会把越界值夹取到 [0, scrollHeight - clientHeight]，这里等价模拟
      top = Math.max(0, Math.min(v, scrollHeight - clientHeight));
    },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
  mockRect(el, 0);
  return el;
}

/// 真实几何模型：块的视口 top = 文档坐标 − 容器 scrollTop。
/// 若返回固定 top（与 scrollTop 无关），补偿量会被重复计入，量出的行为与真机不符。
function makeScene(container: HTMLElement, docTops: number[]) {
  const content = document.createElement("div");
  const body = document.createElement("div");
  body.className = "markdown-body";
  content.appendChild(body);
  document.body.appendChild(content);
  const offsets = [...docTops];
  const blocks = offsets.map((_, index) => {
    const el = document.createElement("p");
    body.appendChild(el);
    vi.spyOn(el, "getBoundingClientRect").mockImplementation(() =>
      rect(offsets[index] - container.scrollTop)
    );
    return el;
  });
  return {
    content,
    blocks,
    /// 改写某块的文档坐标，模拟重排（正文换行导致上方内容变高/变矮）
    setDocTop: (index: number, docTop: number) => {
      offsets[index] = docTop;
    },
  };
}

function frameDriver() {
  const callbacks: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  return {
    /// 跑一帧：把队首回调取出执行
    tick() {
      const cb = callbacks.shift();
      if (!cb) return false;
      cb(performance.now());
      return true;
    },
    pending: () => callbacks.length,
  };
}

describe("startViewportPin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("逐帧把视口锚点补偿回原位（宽度回流导致上方内容变矮的场景）", () => {
    const frames = frameDriver();
    const container = makeContainer(3000);
    // 捕获时锚点视口 top = 3100 − 3000 = 100（delta = 100）
    const scene = makeScene(container, [3100, 3500]);
    const pin = startViewportPin(container, scene.content, {
      until: () => Number.POSITIVE_INFINITY,
      lastUserScrollAt: () => 0,
    });

    // 回流：视口上方的正文变矮 600px ⇒ 锚点上移到视口 top = −500
    scene.setDocTop(0, 2500);
    frames.tick();

    expect(container.scrollTop).toBe(2400);
    // 补偿后锚点回到原来的屏幕位置（内容不动）
    expect(scene.blocks[0].getBoundingClientRect().top).toBe(100);
    pin.stop();
  });

  it("过渡窗结束后不再补偿、也不再续帧", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const frames = frameDriver();
    const container = makeContainer(3000);
    const scene = makeScene(container, [3100, 3500]);
    const pin = startViewportPin(container, scene.content, {
      until: () => 300,
      lastUserScrollAt: () => 0,
    });

    now = 100;
    scene.setDocTop(0, 2500);
    frames.tick();
    expect(container.scrollTop).toBe(2400);

    // 窗口内继续漂移 ⇒ 继续补偿
    now = 200;
    scene.setDocTop(0, 2200);
    frames.tick();
    expect(container.scrollTop).toBe(2100);

    // 超过窗口：本帧仍补偿一次（贴齐最后一帧布局），之后不再续帧
    now = 400;
    scene.setDocTop(0, 1900);
    frames.tick();
    expect(container.scrollTop).toBe(1800);
    expect(frames.pending()).toBe(0);
    pin.stop();
  });

  it("钉住开始之后用户有滚动输入 ⇒ 交还控制权，不再改写 scrollTop", () => {
    let now = 10;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const frames = frameDriver();
    const container = makeContainer(3000);
    const scene = makeScene(container, [3100, 3500]);
    let lastUserScrollAt = 0;
    const pin = startViewportPin(container, scene.content, {
      until: () => Number.POSITIVE_INFINITY,
      lastUserScrollAt: () => lastUserScrollAt,
    });

    // 用户滚轮（时间戳晚于钉住开始）
    lastUserScrollAt = 50;
    scene.setDocTop(0, 2500);
    now = 60;
    frames.tick();

    expect(container.scrollTop).toBe(3000);
    expect(frames.pending()).toBe(0);
    pin.stop();
  });

  it("启动前的时间戳不算用户接管（应用启动初期 0 值不误判）", () => {
    vi.spyOn(performance, "now").mockImplementation(() => 40);
    const frames = frameDriver();
    const container = makeContainer(3000);
    const scene = makeScene(container, [3100, 3500]);
    const pin = startViewportPin(container, scene.content, {
      until: () => Number.POSITIVE_INFINITY,
      lastUserScrollAt: () => 0,
    });

    scene.setDocTop(0, 2500);
    frames.tick();

    expect(container.scrollTop).toBe(2400);
    pin.stop();
  });

  it("applyNow 同步补偿（供绘制前的布局 effect 调用）", () => {
    frameDriver();
    const container = makeContainer(3000);
    const scene = makeScene(container, [3100, 3500]);
    const pin = startViewportPin(container, scene.content, {
      until: () => Number.POSITIVE_INFINITY,
      lastUserScrollAt: () => 0,
    });

    scene.setDocTop(0, 2500);
    expect(pin.applyNow()).toBe(true);
    expect(container.scrollTop).toBe(2400);
    pin.stop();
  });

  it("没有可见顶层块时不补偿（锚点为空）", () => {
    const frames = frameDriver();
    const container = makeContainer(3000);
    const content = document.createElement("div");
    const body = document.createElement("div");
    body.className = "markdown-body";
    content.appendChild(body);
    document.body.appendChild(content);

    const pin = startViewportPin(container, content, {
      until: () => Number.POSITIVE_INFINITY,
      lastUserScrollAt: () => 0,
    });

    expect(pin.applyNow()).toBe(false);
    expect(container.scrollTop).toBe(3000);
    expect(frames.pending()).toBe(0);
    pin.stop();
  });

  it("stop 之后不再补偿", () => {
    const frames = frameDriver();
    const container = makeContainer(3000);
    const scene = makeScene(container, [3100, 3500]);
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    const pin = startViewportPin(container, scene.content, {
      until: () => Number.POSITIVE_INFINITY,
      lastUserScrollAt: () => 0,
    });
    pin.stop();
    scene.setDocTop(0, 2500);

    expect(pin.applyNow()).toBe(false);
    expect(container.scrollTop).toBe(3000);
    expect(cancelSpy).toHaveBeenCalled();
    expect(frames.pending()).toBe(1); // 已排队的回调由 cancelAnimationFrame 撤销（fixture 里是空实现）
  });
});
