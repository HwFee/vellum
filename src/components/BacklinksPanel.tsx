import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { basename, fileNameToTitle } from "../lib/path";
import type { BacklinkFile } from "../lib/library";

export type BacklinksPanelProps = {
  /// 题头槽位（侧栏页签）
  header: React.ReactNode;
  /// 当前文档路径：换代即重取反链
  documentPath: string | null;
  onOpenPath: (path: string) => void;
};

/**
 * 「反鏈」页签：库内哪些笔记 `[[链到本篇]]`（`find_backlinks` 锚定当前文档）。
 * 每条来文给题（可点、同大纲条目语汇）+ 至多 5 行命中摘录（12px 橄榄）。
 */
export function BacklinksPanel({ header, documentPath, onOpenPath }: BacklinksPanelProps) {
  const [files, setFiles] = useState<BacklinkFile[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setFiles(null);
    setError(false);
    invoke<BacklinkFile[]>("find_backlinks")
      .then((res) => {
        if (alive) setFiles(res);
      })
      .catch((err: unknown) => {
        console.warn("find_backlinks failed:", err);
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [documentPath]);

  return (
    <nav className="outline-panel" aria-label="反向链接">
      {header}
      <div className="outline-panel__scroll">
        {error ? (
          <p className="outline-panel__empty">无法读取反向链接</p>
        ) : files === null ? (
          <p className="outline-panel__empty">…</p>
        ) : files.length === 0 ? (
          <p className="outline-panel__empty">暂无笔记链接到本篇</p>
        ) : (
          <ul className="outline-panel__list">
            {files.map((file) => (
              <li key={file.path} className="outline-panel__item library-backlink">
                <button
                  type="button"
                  className="outline-panel__link"
                  title={file.relPath}
                  onClick={() => onOpenPath(file.path)}
                >
                  {fileNameToTitle(basename(file.path))}
                </button>
                <ul className="library-backlink__lines">
                  {file.snippets.map((s) => (
                    <li key={s.line} className="library-backlink__line">
                      <span className="library-backlink__ln">L{s.line}</span>
                      {s.snippet}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
