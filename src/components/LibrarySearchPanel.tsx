import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { basename, fileNameToTitle } from "../lib/path";
import { snippetParts, type LibrarySearch } from "../lib/library";

export type LibrarySearchPanelProps = {
  /// 题头槽位（侧栏页签）
  header: React.ReactNode;
  /// 当前文档路径：换代即重查（命令锚定 AppState.current）
  documentPath: string | null;
  /// 查询词提升到 App state：切页签再切回来时不丢
  query: string;
  onQueryChange: (query: string) => void;
  /// 点中一条命中：换文档 + 把词喂给文内检索高亮
  onOpenHit: (path: string, query: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
};

const DEBOUNCE_MS = 300;

/**
 * 「檢索」页签：全库全文检索（`search_library` 锚定当前文档的库根）。
 * 输入 300ms 防抖；请求号守卫丢弃过期回包（键入快时旧响应不盖新结果）。
 * 命中片段按 char 索引切片（`snippetParts`），命中词包 `.search-match` 高亮——
 * 与文内检索同一枚 mark 样式。
 */
export function LibrarySearchPanel({
  header,
  documentPath,
  query,
  onQueryChange,
  onOpenHit,
  inputRef,
}: LibrarySearchPanelProps) {
  const [result, setResult] = useState<LibrarySearch | null>(null);
  const [pending, setPending] = useState(false);
  /// 请求代际：回包只认「最新一次请求」
  const requestRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResult(null);
      setPending(false);
      return;
    }
    setPending(true);
    const timer = setTimeout(() => {
      const id = ++requestRef.current;
      invoke<LibrarySearch>("search_library", { query: trimmed })
        .then((res) => {
          if (requestRef.current === id) {
            setResult(res);
            setPending(false);
          }
        })
        .catch((err: unknown) => {
          console.warn("search_library failed:", err);
          if (requestRef.current === id) {
            setResult(null);
            setPending(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, documentPath]);

  const trimmed = query.trim();
  const isEmpty = trimmed.length === 0;

  return (
    <nav className="outline-panel" aria-label="库内检索">
      {header}
      <div className={`outline-search ${trimmed ? "outline-search--active" : ""}`}>
        <span className="outline-search__icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          className="outline-search__input"
          placeholder="检索全库…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="检索全库内容"
        />
        {pending ? (
          <span className="outline-search__count" aria-live="polite">…</span>
        ) : null}
      </div>
      <div className="outline-panel__scroll">
        {isEmpty ? (
          <p className="outline-panel__empty">输入关键词检索全库</p>
        ) : pending && !result ? (
          <p className="outline-panel__empty">…</p>
        ) : result && result.files.length === 0 ? (
          <p className="outline-panel__empty">无匹配</p>
        ) : result ? (
          <>
            {result.files.map((file) => (
              <div className="library-hit" key={file.path}>
                <div className="library-hit__title" title={file.relPath}>
                  {fileNameToTitle(basename(file.path))}
                  <span className="library-hit__count">{file.matches.length}</span>
                </div>
                {file.matches.map((m) => {
                  const [before, match, after] = snippetParts(
                    m.snippet,
                    m.matchStart,
                    m.matchLen
                  );
                  return (
                    <button
                      type="button"
                      key={`${m.line}:${m.matchStart}`}
                      className="library-hit__line"
                      onClick={() => onOpenHit(file.path, trimmed)}
                    >
                      <span className="library-hit__ln">L{m.line}</span>
                      <span className="library-hit__text">
                        {before}
                        <mark className="search-match">{match}</mark>
                        {after}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {result.truncated ? (
              <p className="library-note">结果过多，仅显示前 300 处</p>
            ) : null}
          </>
        ) : null}
      </div>
    </nav>
  );
}
