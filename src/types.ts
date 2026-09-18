export type LoadedDocument = {
  path: string;
  fileName: string;
  parentPath: string;
  markdown: string;
};

export type OutlineHeading = {
  id: string;
  level: 1 | 2 | 3;
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
