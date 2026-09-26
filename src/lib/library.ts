/// `src-tauri/src/library.rs` 三个命令的返回契约（camelCase，与 serde 对应）。
/// 三个命令都锚定 AppState.current——前端不传路径。

export type SidebarTab = "outline" | "files" | "search" | "backlinks";

export type LibraryFile = { path: string; relPath: string };

export type LibraryListing = {
  root: string;
  rootName: string;
  isVault: boolean;
  files: LibraryFile[];
  truncated: boolean;
};

export type LibraryMatch = {
  /// 1-based 行号
  line: number;
  /// 命中行的上下文摘录（首尾可能带 `…` 掐头去尾；tab 已换空格）
  snippet: string;
  /// 命中在 snippet 内的 **char** 起止（Rust 端按 char 计）——
  /// 切片一律走 Array.from 的码点序列，UTF-16 代理对与 CJK 扩展区不错位
  matchStart: number;
  matchLen: number;
};

export type LibrarySearchFile = {
  path: string;
  relPath: string;
  matches: LibraryMatch[];
};

export type LibrarySearch = {
  files: LibrarySearchFile[];
  truncated: boolean;
};

export type BacklinkSnippet = {
  line: number;
  snippet: string;
};

export type BacklinkFile = {
  path: string;
  relPath: string;
  snippets: BacklinkSnippet[];
};

/// 文件树节点：目录带 children，文件带 path。
export type FileTreeNode = {
  name: string;
  relPath: string;
  children?: FileTreeNode[];
  path?: string;
};

const TREE_COLLATOR = new Intl.Collator("zh-Hans-CN");

/**
 * 把扁平的 relPath 清单收成目录树：目录在前、文件在后，同组内
 * `zh-Hans-CN` localeCompare 排序（中文按拼音序，与文件名直觉一致）。
 */
export function buildFileTree(files: LibraryFile[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", relPath: "", children: [] };
  const folders = new Map<string, FileTreeNode>();
  folders.set("", root);

  for (const file of files) {
    const parts = file.relPath.split("/");
    const fileName = parts[parts.length - 1];
    let parent = root;
    let prefix = "";
    for (const part of parts.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      let folder = folders.get(prefix);
      if (!folder) {
        folder = { name: part, relPath: prefix, children: [] };
        folders.set(prefix, folder);
        parent.children!.push(folder);
      }
      parent = folder;
    }
    parent.children!.push({ name: fileName, relPath: file.relPath, path: file.path });
  }

  const sortLevel = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      const aDir = a.children !== undefined ? 0 : 1;
      const bDir = b.children !== undefined ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return TREE_COLLATOR.compare(a.name, b.name);
    });
    for (const node of nodes) if (node.children) sortLevel(node.children);
  };
  sortLevel(root.children ?? []);
  return root.children ?? [];
}

/**
 * 把 snippet 按 matchStart/matchLen 拆成 [前段, 命中, 后段]。
 * 两个索引都是 char 计数（Rust 契约），故用 `Array.from` 走码点序列切片。
 */
export function snippetParts(
  snippet: string,
  matchStart: number,
  matchLen: number
): [string, string, string] {
  const chars = Array.from(snippet);
  return [
    chars.slice(0, matchStart).join(""),
    chars.slice(matchStart, matchStart + matchLen).join(""),
    chars.slice(matchStart + matchLen).join(""),
  ];
}
