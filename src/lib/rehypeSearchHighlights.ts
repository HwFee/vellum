// 搜索高亮 rehype 插件（原 MarkdownDocument.tsx 内嵌，抽出后管线行为逐字不变）

export type HastText = { type: "text"; value: string };
export type HastElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
  /// 源码位置（hast 的标准字段）：任务列表勾选靠它把 <li> 映射回源码偏移
  position?: { start?: { offset?: number }; end?: { offset?: number } };
};
export type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const SEARCH_SKIP_TAGS = new Set(["mark", "script", "style", "pre", "code"]);

// 搜索高亮只负责生成 <mark class="search-match">；「当前匹配」的
// search-match--current 类由 MarkdownDocument 的 layout effect 直接操作 DOM 添加。
// 这样切换上一个/下一个匹配不会改动插件参数，也就不会触发整篇文档重新解析。
export function rehypeSearchHighlights({ query }: { query: string }) {
  const normalizedQuery = query.trim().toLowerCase();

  return (tree: HastNode) => {
    if (!normalizedQuery) return;

    function highlightChildren(parent: { children: HastNode[] }) {
      const nextChildren: HastNode[] = [];

      for (const child of parent.children) {
        if (child.type === "text") {
          const text = (child as HastText).value;
          const lowerText = text.toLowerCase();
          let lastIndex = 0;
          let matchIndex = lowerText.indexOf(normalizedQuery);

          while (matchIndex !== -1) {
            if (matchIndex > lastIndex) {
              nextChildren.push({ type: "text", value: text.slice(lastIndex, matchIndex) });
            }

            const mark: HastElement = {
              type: "element",
              tagName: "mark",
              properties: { className: ["search-match"] },
              children: [{
                type: "text",
                value: text.slice(matchIndex, matchIndex + normalizedQuery.length),
              }],
            };
            nextChildren.push(mark);
            lastIndex = matchIndex + normalizedQuery.length;
            matchIndex = lowerText.indexOf(normalizedQuery, lastIndex);
          }

          if (lastIndex === 0) {
            nextChildren.push(child);
          } else if (lastIndex < text.length) {
            nextChildren.push({ type: "text", value: text.slice(lastIndex) });
          }
          continue;
        }

        if (child.type === "element") {
          const element = child as HastElement;
          if (!SEARCH_SKIP_TAGS.has(element.tagName)) {
            highlightChildren(element);
          }
        } else if ("children" in child && child.children) {
          highlightChildren(child as { children: HastNode[] });
        }
        nextChildren.push(child);
      }

      parent.children = nextChildren;
    }

    if ("children" in tree && tree.children) {
      highlightChildren(tree as { children: HastNode[] });
    }
  };
}
