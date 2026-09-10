### Task 2: rehype 标记插件 + 点击解析（仅编辑视图启用）

**Files:**
- Create: `src/lib/rehypeEditUnits.ts`
- Create: `src/lib/rehypeEditUnits.test.ts`
- Modify: `src/components/MarkdownDocument.tsx`（新增 props、插件接线、`sanitize` schema 加 `data*`、article 上的点击解析）
- Modify: `src/components/MarkdownDocument.test.tsx`（追加 `editable` 模式用例）

**Interfaces:**
- Consumes: `buildEditUnits` / `EditUnit` / `findUnitForRange`（Task 1）
- Produces:
  ```ts
  // src/lib/rehypeEditUnits.ts
  export function createRehypeEditUnits(units: EditUnit[]): () => (tree: unknown) => void;
  // MarkdownDocument 新增 props（全部可选，缺省＝阅读视图）
  type EditProps = {
    editable?: boolean;
    onActivateUnit?: (index: number, caretOffset: number) => void;
    onLockedUnitClick?: (reason: "html" | "widget") => void;
  };
  ```
- DOM 契约：`data-vellum-unit="<index>"`（可编辑与不可编辑块都有）；不可编辑块额外 `data-vellum-locked="html|widget"`

- [ ] **Step 1: 写失败测试**

```ts
// src/lib/rehypeEditUnits.test.ts
import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { buildEditUnits } from "./editUnits";
import { createRehypeEditUnits } from "./rehypeEditUnits";

async function render(markdown: string, editable = true) {
  const processor = unified().use(remarkParse).use(remarkRehype);
  if (editable) processor.use(createRehypeEditUnits(buildEditUnits(markdown)));
  processor.use(rehypeStringify);
  return String(await processor.process(markdown));
}

describe("createRehypeEditUnits", () => {
  it("给每个块打上与 editUnits 一致的索引", async () => {
    const html = await render("# 标题\n\n正文\n");
    expect(html).toContain('data-vellum-unit="0"');
    expect(html).toContain('data-vellum-unit="1"');
  });

  it("不可编辑块额外带 locked 标记", async () => {
    const html = await render('<div class="x">hi</div>\n');
    expect(html).toContain('data-vellum-unit="0"');
    expect(html).toContain('data-vellum-locked="html"');
  });

  it("编辑视图关闭时不产生任何标记", async () => {
    const html = await render("# 标题\n", false);
    expect(html).not.toContain("data-vellum-unit");
  });
});
```

追加到 `src/components/MarkdownDocument.test.tsx`：

```tsx
it("编辑视图下块元素带 data-vellum-unit，阅读视图下没有", () => {
  const markdown = "# 标题\n\n正文\n";
  const { container, unmount } = render(<MarkdownDocument markdown={markdown} editable />);
  expect(container.querySelectorAll("[data-vellum-unit]").length).toBe(2);
  unmount();

  const reading = render(<MarkdownDocument markdown={markdown} />);
  expect(reading.container.querySelectorAll("[data-vellum-unit]").length).toBe(0);
});

it("点击可编辑块回调索引，点击只读块回调原因", () => {
  const onActivateUnit = vi.fn();
  const onLockedUnitClick = vi.fn();
  const markdown = '正文\n\n```vellum-widget\n<div>x</div>\n```\n';
  render(
    <MarkdownDocument
      markdown={markdown}
      editable
      onActivateUnit={onActivateUnit}
      onLockedUnitClick={onLockedUnitClick}
    />
  );

  fireEvent.click(screen.getByText("正文"));
  expect(onActivateUnit).toHaveBeenCalledWith(0, expect.any(Number));

  fireEvent.click(document.querySelector('[data-vellum-locked="widget"]') as Element);
  expect(onLockedUnitClick).toHaveBeenCalledWith("widget");
  expect(onActivateUnit).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/lib/rehypeEditUnits.test.ts src/components/MarkdownDocument.test.tsx`
Expected: FAIL —— `Failed to resolve import "./rehypeEditUnits"`

- [ ] **Step 3: 实现插件**

```ts
// src/lib/rehypeEditUnits.ts
import type { EditUnit } from "./editUnits";

type HastElement = {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children?: HastNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};
type HastNode = HastElement | { type: string; children?: HastNode[]; position?: HastElement["position"] };

const MATH_CLASSES = new Set(["math-display", "math-inline", "language-math"]);

function classesOf(element: HastElement): string[] {
  const value = element.properties.className;
  return Array.isArray(value) ? value.map(String) : [];
}

/// rehype-katex 会整体替换命中这些类的节点（连同属性），
/// 因此这类元素必须外包一层容器来承载标记（容器用 display:contents 不参与布局）。
function isReplacedByKatex(element: HastElement): boolean {
  const classes = classesOf(element);
  if (classes.some((name) => MATH_CLASSES.has(name))) return true;
  if (element.tagName !== "pre") return false;
  return (element.children ?? []).some(
    (child) =>
      child.type === "element" &&
      (child as HastElement).tagName === "code" &&
      classesOf(child as HastElement).includes("language-math")
  );
}

export function createRehypeEditUnits(units: EditUnit[]) {
  return function rehypeEditUnits() {
    function walk(parent: { children?: HastNode[] }) {
      const children = parent.children;
      if (!children) return;

      for (let i = 0; i < children.length; i += 1) {
        const node = children[i];
        if (node.type !== "element") {
          walk(node as { children?: HastNode[] });
          continue;
        }

        const element = node as HastElement;
        const start = element.position?.start?.offset;
        const end = element.position?.end?.offset;

        if (typeof start === "number" && typeof end === "number") {
          const unit = units.find((candidate) => candidate.start <= start && candidate.end >= end);
          if (unit) {
            const tag = (target: HastElement) => {
              target.properties.dataVellumUnit = unit.index;
              if (!unit.editable && unit.reason) target.properties.dataVellumLocked = unit.reason;
            };

            if (isReplacedByKatex(element)) {
              const wrapper: HastElement = {
                type: "element",
                tagName: "div",
                properties: { className: ["vellum-unit-wrap"] },
                children: [element as unknown as HastNode],
                position: element.position,
              };
              tag(wrapper);
              tag(element);
              children[i] = wrapper;
            } else {
              tag(element);
            }
          }
        }

        walk(element as { children?: HastNode[] });
      }
    }

    return (tree: unknown) => walk(tree as { children?: HastNode[] });
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/lib/rehypeEditUnits.test.ts`
Expected: PASS（3 用例）

- [ ] **Step 5: 接线 `MarkdownDocument`**

改动点（保持 memo 契约）：

1. props 增加 `editable`、`onActivateUnit`、`onLockedUnitClick`
2. `MarkdownDocument` 内 `const units = useMemo(() => (editable ? buildEditUnits(markdown) : []), [editable, markdown])`
3. `MarkdownBody` 的 `rehypePlugins` 里，在 `[rehypeSanitize, kamiSchema]` 之后、搜索高亮之前插入 `...(editable ? [createRehypeEditUnits(units)] : [])`（`createRehypeEditUnits` 的结果需 `useMemo`，依赖 `[editable, units]`）
4. `kamiSchema.attributes["*"]` 追加 `"data*"`
5. article 上加 `onClick`：

```tsx
const handleClick = useCallback(
  (event: React.MouseEvent<HTMLElement>) => {
    if (!editable) return;
    const target = (event.target as Element | null)?.closest("[data-vellum-unit]");
    if (!target) return;
    const index = Number(target.getAttribute("data-vellum-unit"));
    const unit = units.find((candidate) => candidate.index === index);
    if (!unit) return;

    if (!unit.editable) {
      onLockedUnitClick?.(unit.reason === "widget" ? "widget" : "html");
      return;
    }

    const rect = target.getBoundingClientRect();
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
    const source = markdown.slice(unit.start, unit.end);
    onActivateUnit?.(index, caretOffsetForRatio(source, ratio));
  },
  [editable, markdown, onActivateUnit, onLockedUnitClick, units]
);
```

- [ ] **Step 6: 回归 + 提交**

```bash
npx vitest run src/components/MarkdownDocument.test.tsx && npm test && npx tsc --noEmit
git add src/lib/rehypeEditUnits.ts src/lib/rehypeEditUnits.test.ts src/components/MarkdownDocument.tsx src/components/MarkdownDocument.test.tsx
git commit -m "feat(edit): rehype 块标记插件与点击解析（仅编辑视图启用，阅读视图 DOM 不变）"
```

---

