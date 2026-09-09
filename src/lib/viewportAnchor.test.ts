import { describe, expect, it, vi } from "vitest";
import { captureViewportAnchor, restoreViewportAnchor } from "./viewportAnchor";

function fakeRect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

function stubRect(el: Element, top: number, bottom: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(fakeRect(top, bottom));
}

function makeContainer(top = 0) {
  const container = document.createElement("div");
  stubRect(container, top, top + 400);
  let scrollTop = 0;
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
  return { container, getScrollTop: () => scrollTop };
}

describe("captureViewportAnchor", () => {
  it("picks the first top-level block whose bottom crosses the container top", () => {
    const { container } = makeContainer(100);
    const content = document.createElement("div");
    const article = document.createElement("article");
    article.className = "markdown-body";
    const above = document.createElement("p");
    const anchorEl = document.createElement("h2");
    const below = document.createElement("p");
    article.append(above, anchorEl, below);
    content.append(article);
    document.body.append(container, content);

    stubRect(above, -300, -50); // 完全在容器顶上方
    stubRect(anchorEl, -50, 120); // 底边越过容器顶（100）
    stubRect(below, 120, 400);

    const anchor = captureViewportAnchor(container, content);
    expect(anchor?.el).toBe(anchorEl);
    expect(anchor?.delta).toBe(-150); // -50 - 100
  });

  it("falls back to contentRoot children when no .markdown-body exists", () => {
    const { container } = makeContainer(0);
    const content = document.createElement("div");
    const block = document.createElement("div");
    content.append(block);
    document.body.append(container, content);
    stubRect(block, 10, 200);

    const anchor = captureViewportAnchor(container, content);
    expect(anchor?.el).toBe(block);
    expect(anchor?.delta).toBe(10);
  });

  it("returns null when every block sits above the container top", () => {
    const { container } = makeContainer(500);
    const content = document.createElement("div");
    const article = document.createElement("article");
    article.className = "markdown-body";
    const el = document.createElement("p");
    article.append(el);
    content.append(article);
    document.body.append(container, content);
    stubRect(el, 0, 100); // bottom 100 <= 500 + 1

    expect(captureViewportAnchor(container, content)).toBeNull();
  });
});

describe("restoreViewportAnchor", () => {
  it("compensates scrollTop by the anchor element drift", () => {
    const { container, getScrollTop } = makeContainer(100);
    const el = document.createElement("p");
    document.body.append(container, el);
    // 捕获时 delta=-50；恢复时元素顶边移动到 30 → 相对容器顶漂移 30-100-(-50) = -20
    stubRect(el, 30, 200);

    const applied = restoreViewportAnchor(container, { el, delta: -50 });
    expect(applied).toBe(true);
    expect(getScrollTop()).toBe(-20);
  });

  it("does not touch scrollTop when drift is below 1px", () => {
    const { container, getScrollTop } = makeContainer(100);
    const el = document.createElement("p");
    document.body.append(container, el);
    stubRect(el, 50.4, 200); // drift = 50.4 - 100 - (-50) = 0.4

    expect(restoreViewportAnchor(container, { el, delta: -50 })).toBe(true);
    expect(getScrollTop()).toBe(0);
  });

  it("returns false when the anchor element was removed by the reload", () => {
    const { container } = makeContainer(100);
    const el = document.createElement("p"); // 未挂进 document → isConnected === false

    expect(restoreViewportAnchor(container, { el, delta: 0 })).toBe(false);
  });
});
