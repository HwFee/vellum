import { rehypeSearchHighlights, type HastElement, type HastNode } from "./rehypeSearchHighlights";

function paragraph(text: string): HastNode {
  return {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        children: [{ type: "text", value: text }],
      },
    ],
  };
}

function run(tree: HastNode, query: string): HastNode {
  rehypeSearchHighlights({ query })(tree);
  return tree;
}

function textOf(node: HastNode): string {
  if (node.type === "text") return (node as { value: string }).value;
  const children = "children" in node ? node.children ?? [] : [];
  return children.map(textOf).join("");
}

function marksOf(node: HastNode): HastElement[] {
  const out: HastElement[] = [];
  const walk = (n: HastNode) => {
    const el = n as HastElement;
    if (n.type === "element" && el.tagName === "mark") out.push(el);
    if ("children" in n) (n.children ?? []).forEach(walk);
  };
  walk(node);
  return out;
}

describe("rehypeSearchHighlights", () => {
  it("ASCII 命中照常切 mark，拼接后原文逐字不变", () => {
    const tree = run(paragraph("alpha alpha"), "alpha");
    const marks = marksOf(tree);
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => textOf(m))).toEqual(["alpha", "alpha"]);
    expect(textOf(tree)).toBe("alpha alpha");
  });

  it("indexOf 语义不重叠：aaaa 查 aa 得两处", () => {
    const tree = run(paragraph("aaaa"), "aa");
    expect(marksOf(tree)).toHaveLength(2);
    expect(textOf(tree)).toBe("aaaa");
  });

  it("前置字符小写膨胀（İ→i+̇）后，命中仍切在原文正确位置", () => {
    const tree = run(paragraph("İx"), "x");
    const marks = marksOf(tree);
    expect(marks).toHaveLength(1);
    expect(textOf(marks[0])).toBe("x");
    expect(textOf(tree)).toBe("İx");
  });

  it("查询 İ 整字命中只占一个原文码点的位置", () => {
    const tree = run(paragraph("İx"), "İ");
    const marks = marksOf(tree);
    expect(marks).toHaveLength(1);
    expect(textOf(marks[0])).toBe("İ");
    expect(textOf(tree)).toBe("İx");
  });

  it("查询膨胀产物之一（i 或组合符）命中整个 İ，不吞后字符", () => {
    const tree = run(paragraph("aİb"), "i");
    let marks = marksOf(tree);
    expect(marks).toHaveLength(1);
    expect(textOf(marks[0])).toBe("İ");
    expect(textOf(tree)).toBe("aİb");

    const dotted = run(paragraph("aİb"), "̇");
    marks = marksOf(dotted);
    expect(marks).toHaveLength(1);
    expect(textOf(marks[0])).toBe("İ");
    expect(textOf(dotted)).toBe("aİb");
  });

  it("emoji / 增补平面与 CJK 混排下偏移仍按原文对齐", () => {
    const tree = run(paragraph("素笺𠀀İx"), "x");
    const marks = marksOf(tree);
    expect(marks).toHaveLength(1);
    expect(textOf(marks[0])).toBe("x");
    expect(textOf(tree)).toBe("素笺𠀀İx");
  });

  it("膨胀文本里的多处命中逐个对齐", () => {
    const tree = run(paragraph("İxİx"), "x");
    const marks = marksOf(tree);
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => textOf(m))).toEqual(["x", "x"]);
    expect(textOf(tree)).toBe("İxİx");
  });

  it("整串小写语义保留：词尾 ς 命中、词中 σ 不误判", () => {
    const tail = run(paragraph("ΟΣ"), "ος");
    expect(marksOf(tail)).toHaveLength(1);
    expect(textOf(marksOf(tail)[0])).toBe("ΟΣ");
    expect(textOf(tail)).toBe("ΟΣ");

    const middle = run(paragraph("ΟΣΑ"), "ος");
    expect(marksOf(middle)).toHaveLength(0);
    expect(textOf(middle)).toBe("ΟΣΑ");
  });

  it("无命中时不做任何切分", () => {
    const tree = run(paragraph("İx"), "z");
    expect(marksOf(tree)).toHaveLength(0);
    expect(textOf(tree)).toBe("İx");
  });

  it("pre / code 内文本不高亮", () => {
    const tree: HastNode = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "pre",
          children: [
            {
              type: "element",
              tagName: "code",
              children: [{ type: "text", value: "needle" }],
            },
          ],
        },
        { type: "element", tagName: "p", children: [{ type: "text", value: "needle" }] },
      ],
    };
    run(tree, "needle");
    const marks = marksOf(tree);
    expect(marks).toHaveLength(1);
    expect((tree as { children: HastElement[] }).children[0].children).toHaveLength(1);
  });
});
