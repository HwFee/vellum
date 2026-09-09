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

import { captureScrollPosition, resolveAnchorElement, resolveBlockElement, restoreScrollPosition } from "./scrollRestore";

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

/// 造一个 .markdown-body 作用域并按序塞入顶层块，返回块元素列表
function addBlocks(tops: number[]): HTMLElement[] {
  const content = document.createElement("div");
  const body = document.createElement("div");
  body.className = "markdown-body";
  content.appendChild(body);
  document.body.appendChild(content);
  return tops.map((top) => {
    const el = document.createElement("p");
    body.appendChild(el);
    mockRect(el, top);
    return el;
  });
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

  it("有内容根时记录首个可见顶层块的序号与偏移", () => {
    const container = makeContainer(1000, 3000, 500);
    const content = document.createElement("div");
    const body = document.createElement("div");
    body.className = "markdown-body";
    content.appendChild(body);
    document.body.appendChild(content);
    const blocks = [-300, -80, 120].map((top) => {
      const el = document.createElement("p");
      body.appendChild(el);
      mockRect(el, top);
      return el;
    });
    void blocks;
    // 第一个 bottom > 视口顶 +1 的块：top=-80（bottom=-60）不合格？bottom=-80+20=-60 < 1，
    // 合格的是 top=120 的块——首个可见块可以是部分进入视口或紧随其后的块
    const record = captureScrollPosition(container, [], content);
    expect(record.blockIndex).toBe(2);
    expect(record.blockOffset).toBe(-120);
  });

  it("块锚点取「底边越过视口顶」的首块（跨视口顶的块优先）", () => {
    const container = makeContainer(500, 3000, 500);
    const content = document.createElement("div");
    const body = document.createElement("div");
    body.className = "markdown-body";
    content.appendChild(body);
    document.body.appendChild(content);
    [-200, -10, 300].forEach((top) => {
      const el = document.createElement("p");
      body.appendChild(el);
      mockRect(el, top);
    });
    // top=-10 的块 bottom=10 > 1 → 首块命中
    const record = captureScrollPosition(container, [], content);
    expect(record.blockIndex).toBe(1);
    expect(record.blockOffset).toBe(10); // 视口顶 0 − 块顶 −10
  });

  it("不传内容根时退化为比例 + 标题锚点（向后兼容）", () => {
    const container = makeContainer(750, 2000, 500);
    const record = captureScrollPosition(container, []);
    expect(record).toEqual({ ratio: 0.5 });
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

describe("resolveBlockElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blockIndex 命中直接返回对应顶层块", () => {
    const blocks = addBlocks([0, 100, 200]);
    const content = document.querySelector(".markdown-body")!.parentElement as HTMLElement;
    expect(resolveBlockElement({ ratio: 0.5, blockIndex: 1 }, content)).toBe(blocks[1]);
  });

  it("序号越界（内容被删短）时钳到末块", () => {
    const blocks = addBlocks([0, 100]);
    const content = document.querySelector(".markdown-body")!.parentElement as HTMLElement;
    expect(resolveBlockElement({ ratio: 0.5, blockIndex: 9 }, content)).toBe(blocks[1]);
  });

  it("无 blockIndex 或无块时返回 null", () => {
    const blocks = addBlocks([0]);
    const content = document.querySelector(".markdown-body")!.parentElement as HTMLElement;
    expect(resolveBlockElement({ ratio: 0.5 }, content)).toBeNull();
    void blocks;
    const empty = document.createElement("div");
    expect(resolveBlockElement({ ratio: 0.5, blockIndex: 0 }, empty)).toBeNull();
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

  it("无标题时按块锚点恢复（末尾追加后总高变大也不错位）", () => {
    // mdlog 场景：文档在记录期间从 3000 高涨到 6000 高，比例 0.4 会落到 2200，
    // 但块锚点锁定的是同一个顶层块——目标 = 当前 scrollTop + 块视口位移 + 偏移
    const container = makeContainer(1000, 6000, 500);
    const content = document.createElement("div");
    const body = document.createElement("div");
    body.className = "markdown-body";
    content.appendChild(body);
    document.body.appendChild(content);
    for (let i = 0; i < 5; i++) {
      const el = document.createElement("p");
      body.appendChild(el);
      mockRect(el, 100 * i - 350); // 第 3 块 top=-150
    }
    restoreScrollPosition(
      container,
      content,
      { ratio: 0.4, blockIndex: 2, blockOffset: 150 },
      []
    );
    // 目标 = 1000 + (-150) + 150 = 1000（块顶恰好在偏移位置 → 不动）
    expect(animateScrollToMock).toHaveBeenCalledWith(container, 1000);
  });

  it("标题锚点优先于块锚点", () => {
    const container = makeContainer(1000, 3000, 500);
    addHeading("sec", 100);
    const content = document.createElement("div");
    const body = document.createElement("div");
    body.className = "markdown-body";
    content.appendChild(body);
    document.body.appendChild(content);
    const el = document.createElement("p");
    body.appendChild(el);
    mockRect(el, 400);
    restoreScrollPosition(
      container,
      content,
      { ratio: 0.9, anchorId: "sec", anchorIndex: 0, offset: 80, blockIndex: 0, blockOffset: -400 },
      outline(["sec"])
    );
    // 走标题锚点：1000 + 100 + 80 = 1180（而非块锚点的 1000 + 400 - 400）
    expect(animateScrollToMock).toHaveBeenCalledWith(container, 1180);
  });

  it("用户滚动时结束守护并取消动画", () => {
    const container = makeContainer(0, 3000, 500);
    const content = document.createElement("div");
    restoreScrollPosition(container, content, { ratio: 0.4 }, []);
    container.dispatchEvent(new Event("wheel"));
    expect(cancelScrollAnimationMock).toHaveBeenCalledWith(container);
  });

  it("自定义滚动条拖拽（vellum:scrollbar-drag）同样结束守护并取消动画", () => {
    const container = makeContainer(0, 3000, 500);
    const content = document.createElement("div");
    restoreScrollPosition(container, content, { ratio: 0.4 }, []);

    // 拖 thumb 直接写 container.scrollTop，不产生 wheel/touch/keydown；
    // 若守护不认这个信号，下一次内容 resize 会把用户拖走的位置又拉回锚点。
    container.dispatchEvent(
      new CustomEvent("vellum:scrollbar-drag", { bubbles: true })
    );
    expect(cancelScrollAnimationMock).toHaveBeenCalledTimes(1);
    expect(cancelScrollAnimationMock).toHaveBeenCalledWith(container);

    // 守护确已结束：后续用户事件不再重复触发（监听已撤）
    container.dispatchEvent(new Event("wheel"));
    expect(cancelScrollAnimationMock).toHaveBeenCalledTimes(1);
  });

  it("返回的取消函数结束后，用户事件不再触发取消动画", () => {
    const container = makeContainer(0, 3000, 500);
    const content = document.createElement("div");
    const cancel = restoreScrollPosition(container, content, { ratio: 0.4 }, []);
    cancel();
    container.dispatchEvent(new Event("wheel"));
    expect(cancelScrollAnimationMock).not.toHaveBeenCalled();
  });

  it("取消函数结束后 vellum:scrollbar-drag 也不再触发守护结束", () => {
    const container = makeContainer(0, 3000, 500);
    const content = document.createElement("div");
    const cancel = restoreScrollPosition(container, content, { ratio: 0.4 }, []);
    cancel();
    container.dispatchEvent(new CustomEvent("vellum:scrollbar-drag", { bubbles: true }));
    expect(cancelScrollAnimationMock).not.toHaveBeenCalled();
  });
});
