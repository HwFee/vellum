export type LoadedDocument = {
  path: string;
  fileName: string;
  parentPath: string;
  markdown: string;
};

/// 大纲收录的标题层级（h1–h6）。提取（`outline.ts`）与正文标题 id 分配
/// （`MarkdownDocument.tsx` 的 `resolveHeadingId`）必须同宽，改一处就得改另一处。
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type OutlineHeading = {
  id: string;
  level: HeadingLevel;
  text: string;
};

export type DocumentState =
  | { status: "empty" }
  | { status: "loading" }
  | {
      status: "ready";
      document: LoadedDocument;
      /** wikilink 目标 → 已解析的绝对路径（null = 库内找不到）。
       *  与 document 同一次提交进入 ready 态：首次渲染即带表，避免二次整篇解析的闪烁 */
      wikilinks: ReadonlyMap<string, string | null>;
    }
  | { status: "error"; message: string; path?: string };
