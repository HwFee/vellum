import { buildFileTree, snippetParts, type LibraryFile } from "./library";

const file = (relPath: string): LibraryFile => ({ path: `/root/${relPath}`, relPath });

describe("buildFileTree", () => {
  it("扁平清单收成目录树：目录在前、文件在后，同组按 zh-Hans-CN 排序", () => {
    const tree = buildFileTree([
      file("zeta.md"),
      file("notes/b.md"),
      file("notes/a.md"),
      file("alpha.md"),
      file("readings/深/x.md"),
    ]);

    // 顶层：目录 notes、readings 在前，文件按拼音序 alpha、zeta 在后
    expect(tree.map((n) => n.name)).toEqual(["notes", "readings", "alpha.md", "zeta.md"]);
    const notes = tree[0];
    expect(notes.children?.map((n) => n.name)).toEqual(["a.md", "b.md"]);
    const deep = tree[1].children?.[0];
    expect(deep?.name).toBe("深");
    expect(deep?.children?.[0].path).toBe("/root/readings/深/x.md");
  });

  it("空清单出空树，顶层文件不带父目录节点", () => {
    expect(buildFileTree([])).toEqual([]);
    const tree = buildFileTree([file("solo.md")]);
    expect(tree[0].name).toBe("solo.md");
    expect(tree[0].path).toBe("/root/solo.md");
    expect(tree[0].children).toBeUndefined();
  });

  it("共享前缀的目录节点只建一份（兄弟文件进同一个父目录）", () => {
    const tree = buildFileTree([file("d/x.md"), file("d/y.md"), file("d/sub/z.md")]);
    expect(tree).toHaveLength(1);
    const d = tree[0];
    expect(d.children?.map((n) => n.name)).toEqual(["sub", "x.md", "y.md"]);
    expect(d.children?.filter((n) => n.children)).toHaveLength(1);
  });
});

describe("snippetParts", () => {
  it("按 char 索引拆成前/命中/后三段", () => {
    const [before, match, after] = snippetParts("…前文的keyword后文…", 4, 7);
    expect(before).toBe("…前文的");
    expect(match).toBe("keyword");
    expect(after).toBe("后文…");
  });

  it("CJK 与代理对字符按码点切，不错位", () => {
    // 「字」是 BMP 单码点；前后 CJK 各占 1 char
    const snippet = "…前面全是中文填充字符，关键字在这里…";
    const [before, match, after] = snippetParts(snippet, 12, 3);
    expect(before).toBe("…前面全是中文填充字符，");
    expect(match).toBe("关键字");
    expect(after).toBe("在这里…");
  });
});
