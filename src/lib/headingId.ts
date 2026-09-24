/// react-markdown 把 hast 属性作为 props 交给自定义 components，而被自定义组件接管的
/// 标签不会自动把这些属性落到 DOM。这里只交还块标记属性（不透传 node 等内部 prop），
/// 阅读视图下标记属性本就不存在，DOM 保持零差异。
export function unitMarkProps(props: object): { unit?: number; locked?: string } {
  const record = props as Record<string, unknown>;
  const unit = record["data-vellum-unit"];
  const locked = record["data-vellum-locked"];
  return {
    unit: typeof unit === "number" ? unit : undefined,
    locked: typeof locked === "string" ? locked : undefined,
  };
}

/// React 子树 → 纯文本（标题 id 解析与代码块内容提取共用）：
/// 字符串直取，数组拼接，元素递归 children；img 取 alt（与大纲/可访问名同口径）。
export function extractText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { alt?: string; children?: unknown } }).props;
    if (props && "alt" in props) {
      return props.alt ?? "";
    }
    return extractText(props?.children);
  }
  return "";
}
