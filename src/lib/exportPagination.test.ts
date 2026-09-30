import { paginatePreview, trimCloneToChars, type PaginationBlock } from "./exportPagination";

const LINE_H = 20;

function box(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 100,
    width: 100,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

type RangeProto = { getClientRects?: () => DOMRectList };

function installLineGeometry(lineCounts: Map<Element, number>, elementRangeReads: number[]) {
  for (const [element, count] of lineCounts) {
    (element as HTMLElement).getBoundingClientRect = () => box(0, count * LINE_H);
  }
  const proto = Range.prototype as unknown as RangeProto;
  const original = proto.getClientRects;
  proto.getClientRects = function (this: Range) {
    const container = this.commonAncestorContainer;
    const element =
      container.nodeType === Node.TEXT_NODE
        ? container.parentElement
        : (container as Element);
    const rects: DOMRect[] = [];
    if (container.nodeType === Node.TEXT_NODE && this.endOffset - this.startOffset <= 1) {
      rects.push(box(this.startOffset * LINE_H, LINE_H));
    } else {
      if (container.nodeType !== Node.TEXT_NODE) elementRangeReads.push(0);
      const total = element ? (lineCounts.get(element) ?? 0) : 0;
      for (let i = 0; i < total; i += 1) rects.push(box(i * LINE_H, LINE_H));
    }
    return rects as unknown as DOMRectList;
  };
  return {
    restore() {
      if (original) {
        proto.getClientRects = original;
      } else {
        delete proto.getClientRects;
      }
    },
  };
}

function segmentText(el: HTMLElement, fromChar: number | undefined, toChar: number | undefined) {
  const clone = el.cloneNode(true) as HTMLElement;
  trimCloneToChars(clone, fromChar ?? 0, toChar ?? Number.MAX_SAFE_INTEGER);
  return clone.textContent;
}

test("跨两页以上的长段落逐页续拆：区间不重叠、拼回原文、行盒只量一次", () => {
  const p = document.createElement("p");
  const text = "abcdefghijklmnopqrstuvwxy";
  p.textContent = text;
  const elementRangeReads: number[] = [];
  const spy = installLineGeometry(new Map([[p, 25]]), elementRangeReads);
  try {
    const blocks: PaginationBlock[] = [{ el: p, top: 0, height: 25 * LINE_H }];
    const pages = paginatePreview(blocks, 200);

    expect(pages).toHaveLength(3);
    const segments = pages.flat().filter((s) => s.el === p);
    expect(segments.map((s) => [s.fromChar ?? 0, s.toChar ?? text.length])).toEqual([
      [0, 10],
      [10, 20],
      [20, 25],
    ]);
    const rebuilt = segments
      .map((s) => segmentText(p, s.fromChar, s.toChar))
      .join("");
    expect(rebuilt).toBe(text);
    expect(elementRangeReads).toHaveLength(1);
  } finally {
    spy.restore();
  }
});

test("页中段的段落（前面有块占位）按剩余页高拆分，续页不丢行", () => {
  const h2 = document.createElement("h2");
  const p = document.createElement("p");
  const text = "abcdefghijklmnopqrstuvwxy";
  p.textContent = text;
  const reads: number[] = [];
  const spy = installLineGeometry(new Map([[p, 25]]), reads);
  try {
    const blocks: PaginationBlock[] = [
      { el: h2, top: 0, height: 50 },
      { el: p, top: 50, height: 25 * LINE_H },
    ];
    const pages = paginatePreview(blocks, 200);

    expect(pages).toHaveLength(3);
    expect(pages[0].map((s) => s.el)).toEqual([h2, p]);
    const ranges = pages
      .flat()
      .filter((s) => s.el === p)
      .map((s) => [s.fromChar ?? 0, s.toChar ?? text.length]);
    expect(ranges).toEqual([
      [0, 7],
      [7, 17],
      [17, 25],
    ]);
  } finally {
    spy.restore();
  }
});

test("寡行约束下续页保留恰好两行（widows=2，不留单行）", () => {
  const p = document.createElement("p");
  p.textContent = "abcdefghijkl";
  const reads: number[] = [];
  const spy = installLineGeometry(new Map([[p, 12]]), reads);
  try {
    const pages = paginatePreview([{ el: p, top: 0, height: 12 * LINE_H }], 220);
    expect(pages).toHaveLength(2);
    const segments = pages.flat().filter((s) => s.el === p);
    expect(segments.map((s) => [s.fromChar ?? 0, s.toChar ?? 12])).toEqual([
      [0, 10],
      [10, 12],
    ]);
  } finally {
    spy.restore();
  }
});

test("孤行约束：页末只放得下一行时整段移走（orphans=2）", () => {
  const h2 = document.createElement("h2");
  const p = document.createElement("p");
  p.textContent = "abcde";
  const reads: number[] = [];
  const spy = installLineGeometry(new Map([[p, 5]]), reads);
  try {
    const pages = paginatePreview(
      [
        { el: h2, top: 0, height: 170 },
        { el: p, top: 170, height: 5 * LINE_H },
      ],
      200
    );
    expect(pages).toHaveLength(2);
    expect(pages[0].map((s) => s.el)).toEqual([h2]);
    const tail = pages[1].filter((s) => s.el === p);
    expect(tail).toHaveLength(1);
    expect(tail[0].fromChar).toBeUndefined();
    expect(tail[0].toChar).toBeUndefined();
  } finally {
    spy.restore();
  }
});

test("量不到行盒（零 rect）时退化为整块搬运，不拆不动", () => {
  const p = document.createElement("p");
  p.textContent = "abcdefghij";
  const proto = Range.prototype as unknown as RangeProto;
  const original = proto.getClientRects;
  proto.getClientRects = () => [] as unknown as DOMRectList;
  const spy = {
    restore() {
      if (original) {
        proto.getClientRects = original;
      } else {
        delete proto.getClientRects;
      }
    },
  };
  try {
    const pages = paginatePreview([{ el: p, top: 0, height: 15 * LINE_H }], 200);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(1);
    expect(pages[0][0].fromChar).toBeUndefined();
  } finally {
    spy.restore();
  }
});

test("比页高的非段落孤块（pre）照旧独占一页", () => {
  const pre = document.createElement("pre");
  pre.textContent = "code";
  const reads: number[] = [];
  const spy = installLineGeometry(new Map(), reads);
  try {
    const pages = paginatePreview([{ el: pre, top: 0, height: 500 }], 200);
    expect(pages).toHaveLength(1);
    expect(pages[0][0].el).toBe(pre);
    expect(pages[0][0].fromChar).toBeUndefined();
  } finally {
    spy.restore();
  }
});

test("页末标题随下一块一起换页（break-after: avoid 语义不变）", () => {
  const p = document.createElement("p");
  const h2 = document.createElement("h2");
  const p2 = document.createElement("p");
  const reads: number[] = [];
  const spy = installLineGeometry(new Map(), reads);
  try {
    const pages = paginatePreview(
      [
        { el: p, top: 0, height: 190 },
        { el: h2, top: 190, height: 20 },
        { el: p2, top: 210, height: 20 },
      ],
      200
    );
    expect(pages).toHaveLength(2);
    expect(pages[0].map((s) => s.el)).toEqual([p]);
    expect(pages[1].map((s) => s.el)).toEqual([h2, p2]);
  } finally {
    spy.restore();
  }
});
