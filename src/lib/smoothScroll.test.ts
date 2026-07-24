import { describe, expect, it, vi, afterEach } from "vitest";
import { animateScrollTo } from "./smoothScroll";

function makeContainer(initial = 0): HTMLElement {
  const el = document.createElement("div");
  let top = initial;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
  return el;
}

describe("animateScrollTo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not start an animation when already at the target", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const container = makeContainer(100);

    animateScrollTo(container, 100);

    expect(raf).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(100);
  });

  it("eases out: fast at start, slow near the target", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      callbacks.push(cb);
      return callbacks.length;
    });

    const container = makeContainer(0);
    animateScrollTo(container, 1000); // duration = 500ms

    // 前 100ms（t=0.2）应走过约 48.8%，第二个 100ms 的增量明显变少（缓出）
    now = 100;
    callbacks.shift()!(100);
    const early = container.scrollTop;
    now = 200;
    callbacks.shift()!(200);
    const secondIncrement = container.scrollTop - early;
    now = 500;
    callbacks.shift()!(500);

    expect(early).toBeGreaterThan(400);
    expect(secondIncrement).toBeLessThan(early);
    expect(container.scrollTop).toBe(1000);
    expect(callbacks).toHaveLength(0); // 到达目标后不再续帧
  });

  it("cancel stops the animation", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const callbacks: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");

    const container = makeContainer(0);
    const cancel = animateScrollTo(container, 1000);
    now = 100;
    callbacks.shift()!(100);
    cancel();

    expect(cancelSpy).toHaveBeenCalled();
  });
});
