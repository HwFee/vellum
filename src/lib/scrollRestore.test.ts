import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutlineHeading } from "../types";
import type { ScrollPositionRecord } from "./scrollMemory";

const animateScrollToMock = vi.fn((_container: HTMLElement, _targetTop: number, _onComplete?: () => void) => () => {});
const cancelScrollAnimationMock = vi.fn((_container: HTMLElement) => {});

vi.mock("./smoothScroll", () => ({
  animateScrollTo: (container: HTMLElement, targetTop: number, onComplete?: () => void) =>
    onComplete
      ? animateScrollToMock(container, targetTop, onComplete)
      : animateScrollToMock(container, targetTop),
  cancelScrollAnimation: (container: HTMLElement) => cancelScrollAnimationMock(container),
}));

import { captureScrollPosition, resolveAnchorElement, restoreScrollPosition } from "./scrollRestore";

function mockRect(el: Element, top: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + 20,
    left: 0,
    right: 0,
    width: 0,
    height: 20,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

function makeContainer(scrollTop: number, scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement("div");
  let top = scrollTop;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
  mockRect(el, 0);
  return el;
}

function addHeading(id: string, top: number): HTMLElement {
  const el = document.createElement("h2");
  el.id = id;
  document.body.appendChild(el);
  mockRect(el, top);
  return el;
}

const outline = (ids: string[]): OutlineHeading[] =>
  ids.map((id) => ({ id, level: 2 as const, text: id }));

describe("captureScrollPosition", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("无标题文档只记录比例", () => {
    const container = makeContainer(750, 2000, 500);
    expect(captureScrollPosition(container, [])).toEqual({ ratio: 0.5 });
  });

  it("锚定视口顶上方最近的标题，偏移为视口顶与标题顶之差", () => {
    const container = makeContainer(1000, 3000, 500);
    addHeading("h1", -400); // 视口顶上方 400px
    addHeading("h2", -80); // 视口顶上方 80px，更近
    addHeading("h3", 300); // 视口顶下方
    const record = captureScrollPosition(container, outline(["h1", "h2", "h3"]));
    expect(record).toEqual({ ratio: 0.4, anchorId: "h2", anchorIndex: 1, offset: 80 });
  });

  it("页面在首个标题之前时锚定第一个标题（负偏移）", () => {
    const container = makeContainer(0, 3000, 500);
    addHeading("h1", 200); // 首个标题在视口顶下方 200px
    addHeading("h2", 900);
    const record = captureScrollPosition(container, outline(["h1", "h2"]));
    expect(record.anchorId).toBe("h1");
    expect(record.offset).toBe(-200);
  });

  it("跳过未渲染（无 DOM）的大纲标题", () => {
    const container = makeContainer(1000, 3000, 500);
    addHeading("h2", -50);
    const record = captureScrollPosition(container, outline(["ghost", "h2"]));
    expect(record.anchorId).toBe("h2");
    expect(record.anchorIndex).toBe(1);
  });
});

describe("resolveAnchorElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("anchorId 命中直接返回", () => {
    const el = addHeading("target", 100);
    expect(resolveAnchorElement({ ratio: 0.5, anchorId: "target" }, outline(["target"]))).toBe(el);
  });

  it("anchorId 被删后按序号找最近幸存的标题（优先向后）", () => {
    addHeading("a", 0);
    const c = addHeading("c", 200);
    // 原锚点 b（序号 1）已不存在 → 落到序号 1 现在的 c
    const record: ScrollPositionRecord = { ratio: 0.5, anchorId: "b", anchorIndex: 1, offset: 10 };
    expect(resolveAnchorElement(record, outline(["a", "c"]))).toBe(c);
  });

  it("序号越界时钳到末尾标题", () => {
    const b = addHeading("b", 200);
    const record: ScrollPositionRecord = { ratio: 0.5, anchorId: "gone", anchorIndex: 9, offset: 0 };
    expect(resolveAnchorElement(record, outline(["a", "b"]))).toBe(b);
  });

  it("找不到任何锚点时返回 null", () => {
    expect(resolveAnchorElement({ ratio: 0.5 }, [])).toBeNull();
    expect(resolveAnchorElement({ ratio: 0.5, anchorId: "gone" }, outline(["a"]))).toBeNull();
  });
});

describe("restoreScrollPosition", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    animateScrollToMock.mockClear();
    cancelScrollAnimationMock.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("有锚点时滚动到「标题顶 − 偏移」处", () => {
    // 容器已滚动到 1000，锚点标题当前视口坐标 top=100，保存时偏移 80
    // → 目标 scrollTop = 1000 + 100 + 80 = 1180
    const container = makeContainer(1000, 3000, 500);
    addHeading("sec", 100);
    const content = document.createElement("div");
    restoreScrollPosition(
      container,
      content,
      { ratio: 0.5, anchorId: "sec", anchorIndex: 0, offset: 80 },
      outline(["sec"])
    );
    expect(animateScrollToMock).toHaveBeenCalledWith(container, 1180);
  });

  it("锚点丢失时退回比例兜底", () => {
    const container = makeContainer(0, 3000, 500);
    const content = document.createElement("div");
    restoreScrollPosition(container, content, { ratio: 0.4 }, []);
    expect(animateScrollToMock).toHaveBeenCalledWith(container, 1000); // 0.4 * (3000-500)
  });

  it("用户滚动时结束守护并取消动画", () => {
    const container = makeContainer(0, 3000, 500);
    const content = document.createElement("div");
    restoreScrollPosition(container, content, { ratio: 0.4 }, []);
    container.dispatchEvent(new Event("wheel"));
    expect(cancelScrollAnimationMock).toHaveBeenCalledWith(container);
  });

  it("返回的取消函数结束后，用户事件不再触发取消动画", () => {
    const container = makeContainer(0, 3000, 500);
    const content = document.createElement("div");
    const cancel = restoreScrollPosition(container, content, { ratio: 0.4 }, []);
    cancel();
    container.dispatchEvent(new Event("wheel"));
    expect(cancelScrollAnimationMock).not.toHaveBeenCalled();
  });
});
