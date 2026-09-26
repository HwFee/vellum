import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { buildFileTree, type FileTreeNode, type LibraryListing } from "../lib/library";
import { fileNameToTitle } from "../lib/path";

export type FilesPanelProps = {
  /// 题头槽位（侧栏页签）
  header: React.ReactNode;
  /// 当前文档路径：换代即重取列表，并做「当前篇」高亮 + 祖先目录自动展开
  documentPath: string | null;
  onOpenPath: (path: string) => void;
};

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TreeNodes({
  nodes,
  expanded,
  onToggle,
  currentPath,
  onOpenPath,
}: {
  nodes: FileTreeNode[];
  expanded: ReadonlySet<string>;
  onToggle: (relPath: string) => void;
  currentPath: string | null;
  onOpenPath: (path: string) => void;
}) {
  return (
    <ul className="library-tree">
      {nodes.map((node) =>
        node.children ? (
          <li key={node.relPath}>
            <button
              type="button"
              className="library-tree__folder"
              aria-expanded={expanded.has(node.relPath)}
              onClick={() => onToggle(node.relPath)}
            >
              <span className="library-tree__chev" aria-hidden="true">
                ›
              </span>
              <FolderIcon />
              {node.name}
            </button>
            {expanded.has(node.relPath) ? (
              <TreeNodes
                nodes={node.children}
                expanded={expanded}
                onToggle={onToggle}
                currentPath={currentPath}
                onOpenPath={onOpenPath}
              />
            ) : null}
          </li>
        ) : (
          <li key={node.relPath}>
            <button
              type="button"
              className={
                "outline-panel__link library-tree__file" +
                (node.path === currentPath ? " outline-panel__link--active" : "")
              }
              title={node.relPath}
              onClick={() => node.path && onOpenPath(node.path)}
            >
              {fileNameToTitle(node.name)}
            </button>
          </li>
        )
      )}
    </ul>
  );
}

/**
 * 「文件」页签：库内 Markdown 文件树（`list_library` 锚定当前文档的库根）。
 * 筛选输入命中 relPath 子串（大小写不敏感）时退成扁平命中列表；
 * 当前文档高亮（与大纲激活同一条 2px 靛青边轨）且祖先目录自动展开。
 */
export function FilesPanel({ header, documentPath, onOpenPath }: FilesPanelProps) {
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 换文档即重取（命令锚定 AppState.current，换代后列表必须跟着换库）
  useEffect(() => {
    let alive = true;
    setListing(null);
    setError(false);
    setFilter("");
    invoke<LibraryListing>("list_library")
      .then((res) => {
        if (alive) setListing(res);
      })
      .catch((err: unknown) => {
        console.warn("list_library failed:", err);
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [documentPath]);

  // 当前篇的祖先目录自动展开（每次新清单到手重算一次）
  useEffect(() => {
    if (!listing || !documentPath) return;
    const current = listing.files.find((f) => f.path === documentPath);
    if (!current) return;
    const ancestors = new Set<string>();
    let prefix = "";
    for (const part of current.relPath.split("/").slice(0, -1)) {
      prefix = prefix ? `${prefix}/${part}` : part;
      ancestors.add(prefix);
    }
    setExpanded(ancestors);
  }, [listing, documentPath]);

  const tree = useMemo(
    () => (listing ? buildFileTree(listing.files) : []),
    [listing]
  );

  // 筛选命中扁平列出（relPath 子串、大小写不敏感）
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q || !listing) return null;
    return listing.files.filter((f) => f.relPath.toLowerCase().includes(q));
  }, [filter, listing]);

  const toggleFolder = (relPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(relPath)) next.delete(relPath);
      else next.add(relPath);
      return next;
    });
  };

  return (
    <nav className="outline-panel" aria-label="库文件">
      {header}
      {listing ? (
        <div className="library-root" title={listing.root}>
          {listing.rootName}
          {listing.isVault ? " · 库" : ""}
        </div>
      ) : null}
      <div className={`outline-search ${filter ? "outline-search--active" : ""}`}>
        <span className="outline-search__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
        </span>
        <input
          type="text"
          className="outline-search__input"
          placeholder="筛选文件…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="筛选库内文件"
        />
      </div>
      <div className="outline-panel__scroll">
        {error ? (
          <p className="outline-panel__empty">无法读取文件列表</p>
        ) : !listing ? (
          <p className="outline-panel__empty">…</p>
        ) : listing.files.length === 0 ? (
          <p className="outline-panel__empty">库内暂无其他 Markdown 文件</p>
        ) : filtered ? (
          <>
            {filtered.length === 0 ? (
              <p className="outline-panel__empty">无匹配文件</p>
            ) : (
              <ul className="library-tree">
                {filtered.map((f) => (
                  <li key={f.relPath}>
                    <button
                      type="button"
                      className={
                        "outline-panel__link library-tree__file library-tree__file--flat" +
                        (f.path === documentPath ? " outline-panel__link--active" : "")
                      }
                      title={f.relPath}
                      onClick={() => onOpenPath(f.path)}
                    >
                      {fileNameToTitle(f.relPath.split("/").pop() ?? f.relPath)}
                      <span className="library-tree__dir">{f.relPath}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <TreeNodes
              nodes={tree}
              expanded={expanded}
              onToggle={toggleFolder}
              currentPath={documentPath}
              onOpenPath={onOpenPath}
            />
            {listing.truncated ? (
              <p className="library-note">仅列出前 50 000 项</p>
            ) : null}
          </>
        )}
      </div>
    </nav>
  );
}
