import { getCurrentWindow } from "@tauri-apps/api/window";
import { compactPath } from "../lib/path";
import { OutlineToggle } from "./OutlineToggle";

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="6" y1="15" x2="18" y2="15" />
      <path d="M9 9h6" opacity="0.35" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <path d="M5 9h14" opacity="0.35" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6.5" y1="6.5" x2="17.5" y2="17.5" />
      <line x1="17.5" y1="6.5" x2="6.5" y2="17.5" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path d="M8 14h5" opacity="0.5" />
    </svg>
  );
}

/// 阅读视图：笔（点击进就地编辑）—— 线性风格与其它顶栏图标一致，无 emoji
function PenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/// 编辑视图：书（点击回阅读视图）—— 与 Obsidian 的视图切换语义一致
function BookIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

type TopBarProps = {
  parentPath?: string;
  onOpen: () => void;
  isOutlineOpen?: boolean;
  onToggleOutline?: () => void;
  /// 是否处于编辑视图（按钮呈按下态）
  isEditing?: boolean;
  /// mdlog 记录中为 false：按钮禁用并提示断开连接后才能修改
  canEdit?: boolean;
  onToggleEdit?: () => void;
};

export function TopBar({
  parentPath,
  onOpen,
  isOutlineOpen = false,
  onToggleOutline,
  isEditing = false,
  canEdit = true,
  onToggleEdit,
}: TopBarProps) {
  const window = getCurrentWindow();

  return (
    <header className="top-bar" data-tauri-drag-region>
      <div className="top-bar__actions top-bar__actions--left" data-tauri-drag-region="false">
        <OutlineToggle isOpen={isOutlineOpen} onToggle={onToggleOutline ?? (() => {})} />
        <button
          // 复用左区图标按钮样式（与相邻的「打开文件」同款）；edit-toggle 作语义钩子
          className="open-button edit-toggle"
          type="button"
          aria-label="切换编辑视图"
          aria-pressed={isEditing}
          data-icon={isEditing ? "book" : "pen"}
          disabled={!canEdit}
          title={
            !canEdit
              ? "记录中 · 断开连接后才能修改"
              : isEditing
                ? "返回阅读视图（Ctrl+E）"
                : "就地编辑（Ctrl+E）"
          }
          onClick={onToggleEdit}
        >
          {isEditing ? <BookIcon /> : <PenIcon />}
        </button>
        <button className="open-button" type="button" aria-label="打开文件" onClick={onOpen}>
          <OpenIcon />
        </button>
      </div>
      {/* 文件名不在这里显示（它在正文首行，见 .document-title）；顶栏只报所在目录 */}
      <div className="top-bar__meta" data-tauri-drag-region>
        <div className="top-bar__path">
          {parentPath ? compactPath(parentPath) : "未打开文件"}
        </div>
      </div>
      <div className="window-controls" data-tauri-drag-region="false">
        <button
          className="window-control"
          type="button"
          aria-label="最小化"
          onClick={(event) => {
            event.stopPropagation();
            void window.minimize();
          }}
        >
          <MinimizeIcon />
        </button>
        <button
          className="window-control"
          type="button"
          aria-label="最大化"
          onClick={(event) => {
            event.stopPropagation();
            void window.toggleMaximize();
          }}
        >
          <MaximizeIcon />
        </button>
        <button
          className="window-control window-control--close"
          type="button"
          aria-label="关闭"
          onClick={(event) => {
            event.stopPropagation();
            void window.close();
          }}
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}
