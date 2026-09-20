import { basename, compactPath, dirname, fileNameToTitle } from "../lib/path";

type EmptyStateProps = {
  onOpen: () => void;
  /// 最近打开列表（新的在前）；为空则不渲染该区块
  recentFiles: string[];
  onOpenRecent: (path: string) => void;
};

export function EmptyState({ onOpen, recentFiles, onOpenRecent }: EmptyStateProps) {
  return (
    <section aria-label="空文档" className="empty-state">
      <div className="empty-eyebrow">Markdown 查看器</div>
      <h1>素笺</h1>
      <p>打开 Markdown 文件开始查看。</p>
      <button className="button button-primary" type="button" onClick={onOpen}>
        打开文件…
      </button>
      {recentFiles.length > 0 ? (
        <div className="empty-recents">
          <h2 className="empty-recents__title">最近打开</h2>
          <ul className="empty-recents__list">
            {recentFiles.map((path) => (
              <li key={path}>
                <button
                  className="empty-recents__link"
                  type="button"
                  title={path}
                  onClick={() => onOpenRecent(path)}
                >
                  <span className="empty-recents__name">{fileNameToTitle(basename(path))}</span>
                  <span className="empty-recents__dir">{compactPath(dirname(path))}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="empty-hint">或将 .md 文件拖入窗口</p>
    </section>
  );
}
