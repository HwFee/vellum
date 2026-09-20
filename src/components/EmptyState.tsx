import { RecentFilesList } from "./RecentFilesList";

type EmptyStateProps = {
  onOpen: () => void;
  /// 最近打开列表（新的在前）；为空则列表区块不渲染
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
      <RecentFilesList recentFiles={recentFiles} onOpenRecent={onOpenRecent} />
      <p className="empty-hint">或将 .md 文件拖入窗口</p>
    </section>
  );
}
