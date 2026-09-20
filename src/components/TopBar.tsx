import { useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { compactPath } from "../lib/path";
import type { ReaderSettings } from "../hooks/useReaderSettings";
import { OutlineToggle } from "./OutlineToggle";
import { SettingsPopover } from "./SettingsPopover";

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

/// 后退 / 前进：尖括号（‹ ›）—— 历史导航的通用符号，线性风格与其它顶栏图标一致
function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5l7 7-7 7" />
    </svg>
  );
}

/// 阅读设置：齿轮 —— 线性风格与其它顶栏图标一致
function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

type TopBarProps = {
  parentPath?: string;
  onOpen: () => void;
  isOutlineOpen?: boolean;
  onToggleOutline?: () => void;
  /// 历史栈里还有可退/可进的条目：为假时按钮禁用（透明度表达，不可点）
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  /// mdlog 记录中：路径右侧显示「记录中」小章（记录状态不只出现在文档尾部）
  isRecording?: boolean;
  /// 是否处于编辑视图（按钮呈按下态）
  isEditing?: boolean;
  /// mdlog 记录中为 false：按钮禁用并提示断开连接后才能修改
  canEdit?: boolean;
  onToggleEdit?: () => void;
  /// 阅读设置（字号 / 栏宽 / 行高）：两者齐备时才渲染齿轮入口
  readerSettings?: ReaderSettings;
  onReaderSettingsChange?: (patch: Partial<ReaderSettings>) => void;
};

export function TopBar({
  parentPath,
  onOpen,
  isOutlineOpen = false,
  onToggleOutline,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  isRecording = false,
  isEditing = false,
  canEdit = true,
  onToggleEdit,
  readerSettings,
  onReaderSettingsChange,
}: TopBarProps) {
  const window = getCurrentWindow();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <header className="top-bar" data-tauri-drag-region>
      <div className="top-bar__actions top-bar__actions--left" data-tauri-drag-region="false">
        {/* 历史导航：按钮簇最前（阅读轨迹的方向感先于其它动作）。
            title 带快捷键提示，与「切换大纲（Ctrl+B）」同款；禁用态只降透明度 */}
        <button
          className="open-button nav-button"
          type="button"
          aria-label="后退"
          title="后退（Alt+←）"
          disabled={!canGoBack}
          onClick={onGoBack}
        >
          <ChevronLeftIcon />
        </button>
        <button
          className="open-button nav-button"
          type="button"
          aria-label="前进"
          title="前进（Alt+→）"
          disabled={!canGoForward}
          onClick={onGoForward}
        >
          <ChevronRightIcon />
        </button>
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
        <button className="open-button" type="button" aria-label="打开文件" title="打开文件" onClick={onOpen}>
          <OpenIcon />
        </button>
        {readerSettings && onReaderSettingsChange && (
          <>
            <span className="top-bar__divider" aria-hidden="true" />
            {/* 弹层的定位上下文：absolute 于齿轮下方右侧，点外部 / Escape 由 SettingsPopover 自理 */}
            <div className="settings-anchor">
              <button
                ref={settingsButtonRef}
                className="open-button settings-toggle"
                type="button"
                aria-label="阅读设置"
                aria-expanded={settingsOpen}
                title="阅读设置"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <GearIcon />
              </button>
              {settingsOpen && (
                <SettingsPopover
                  settings={readerSettings}
                  onChange={onReaderSettingsChange}
                  onClose={() => setSettingsOpen(false)}
                  anchorRef={settingsButtonRef}
                />
              )}
            </div>
          </>
        )}
      </div>
      {/* 文件名不在这里显示（它在正文首行，见 .document-title）；顶栏只报所在目录 */}
      <div className="top-bar__meta" data-tauri-drag-region>
        <div className="top-bar__path">
          {parentPath ? compactPath(parentPath) : "未打开文件"}
        </div>
        {isRecording && <span className="top-bar__recording">记录中</span>}
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
