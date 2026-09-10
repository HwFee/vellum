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

/// 就地编辑（笔）：线性风格与其它顶栏图标一致，无 emoji
function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 19h4l10-10a2 2 0 0 0-3-3L6 16z" />
      <path d="M14 8l3 3" opacity="0.35" />
    </svg>
  );
}

type TopBarProps = {
  fileName?: string;
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
  fileName,
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
          // 复用左区图标按钮样式（T7 的类名契约未含顶栏编辑钮）；edit-toggle 作语义钩子
          className="open-button edit-toggle"
          type="button"
          aria-label="切换编辑视图"
          aria-pressed={isEditing}
          disabled={!canEdit}
          title={canEdit ? "就地编辑（Ctrl+E）" : "记录中 · 断开连接后才能修改"}
          onClick={onToggleEdit}
        >
          <EditIcon />
        </button>
        <button className="open-button" type="button" aria-label="打开文件" onClick={onOpen}>
          <OpenIcon />
        </button>
      </div>
      <div className="top-bar__meta" data-tauri-drag-region>
        <div className="top-bar__title">{fileName ?? "未打开文件"}</div>
        {parentPath ? <div className="top-bar__path">{compactPath(parentPath)}</div> : null}
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
