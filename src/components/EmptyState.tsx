import type { RecentLibrary } from "../lib/recentLibraries";
import { RecentFilesList } from "./RecentFilesList";

type EmptyStateProps = {
  /// 「选择文件…」按钮：既有 Markdown 文件对话框
  onOpen: () => void;
  /// 「选择文件夹…」按钮：Rust 侧目录对话框（open_library 命令），前端不传路径
  onOpenLibrary: () => void;
  /// 最近打开的文件（新的在前）；为空则文件分组不渲染
  recentFiles: string[];
  /// 最近打开的库（新的在前）；为空则库分组不渲染
  recentLibraries: RecentLibrary[];
  onOpenRecent: (path: string) => void;
  /// 点最近库条目：库根路径交给 loadPath（与拖入文件夹同一管线）
  onOpenRecentLibrary: (path: string) => void;
};

/**
 * 开始页（方案 B · 一体拖放区）：拖文件进单文件阅读、拖文件夹进库模式，
 * 两个「选择…」按钮分别走文件对话框与 Rust 侧目录对话框。
 * 最近列表分两节：「最近打开」（文件）与「最近库」（文件夹）。
 */
export function EmptyState({
  onOpen,
  onOpenLibrary,
  recentFiles,
  recentLibraries,
  onOpenRecent,
  onOpenRecentLibrary,
}: EmptyStateProps) {
  return (
    <section aria-label="空文档" className="empty-state empty-state--start">
      <div className="empty-state__mast">
        <div className="empty-eyebrow">Markdown 查看器</div>
        <h1>素笺</h1>
        <p>把 .md 文件或文件夹拖进来。</p>
      </div>

      <div className="empty-state__zone">
        <svg
          className="empty-state__zone-icon"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
        <div className="empty-state__zone-lead">文件进阅读 · 文件夹进库</div>
        <div className="empty-state__or" aria-hidden="true">
          或
        </div>
        <div className="empty-state__btns">
          <button className="button button-primary" type="button" onClick={onOpen}>
            选择文件…
          </button>
          <button className="button button-primary" type="button" onClick={onOpenLibrary}>
            选择文件夹…
          </button>
        </div>
      </div>

      {recentLibraries.length > 0 ? (
        <div className="recent-files recent-files--libraries">
          <h2 className="recent-files__title">最近库</h2>
          <ul className="recent-files__list">
            {recentLibraries.map((library) => (
              <li key={library.path}>
                <button
                  className="recent-files__link"
                  type="button"
                  title={library.path}
                  onClick={() => onOpenRecentLibrary(library.path)}
                >
                  <span className="recent-files__name">{library.name}</span>
                  <span className="recent-files__dir">{library.path}</span>
                  <span className="kind-tag">库</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <RecentFilesList recentFiles={recentFiles} onOpenRecent={onOpenRecent} />
    </section>
  );
}
