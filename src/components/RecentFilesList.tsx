import { basename, compactPath, dirname, fileNameToTitle } from "../lib/path";

type RecentFilesListProps = {
  /// 最近打开列表（新的在前）；为空则整个区块不渲染
  recentFiles: string[];
  onOpenRecent: (path: string) => void;
};

/**
 * 「最近打开」列表：空态与错误态共用。
 * 错误态尤其需要它——文件打不开的那一刻，正是用户最需要一个替代入口的时刻。
 * 每行 = 文件名（剥 .md）+ 右侧 mono 目录路径，整行是一个按钮（键盘可达、title 挂完整路径）。
 */
export function RecentFilesList({ recentFiles, onOpenRecent }: RecentFilesListProps) {
  if (recentFiles.length === 0) return null;

  return (
    <div className="recent-files">
      <h2 className="recent-files__title">最近打开</h2>
      <ul className="recent-files__list">
        {recentFiles.map((path) => (
          <li key={path}>
            <button
              className="recent-files__link"
              type="button"
              title={path}
              onClick={() => onOpenRecent(path)}
            >
              <span className="recent-files__name">{fileNameToTitle(basename(path))}</span>
              <span className="recent-files__dir">{compactPath(dirname(path))}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
