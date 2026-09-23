import { useState, type CSSProperties } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { OutlineToggle } from "./OutlineToggle";

/// 描边入场的笔顺（kami.css `.icon-draw` 按 --i 依次描出）
const iconStagger = (n: number) => ({ "--i": n }) as CSSProperties;

function MinimizeIcon() {
  return (
    <svg className="icon-draw" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line style={iconStagger(0)} pathLength="1" x1="6" y1="15" x2="18" y2="15" />
      <path className="icon-min__inner" style={iconStagger(1)} pathLength="1" d="M9 9h6" opacity="0.35" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg className="icon-draw" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect className="icon-max__frame" style={iconStagger(0)} pathLength="1" x="5" y="5" width="14" height="14" rx="2" />
      <path className="icon-max__inner" style={iconStagger(1)} pathLength="1" d="M5 9h14" opacity="0.35" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="icon-draw" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line style={iconStagger(0)} pathLength="1" x1="6.5" y1="6.5" x2="17.5" y2="17.5" />
      <line style={iconStagger(1)} pathLength="1" x1="17.5" y1="6.5" x2="6.5" y2="17.5" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg className="icon-draw icon-open" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path style={iconStagger(0)} pathLength="1" d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <path className="icon-open__dash" style={iconStagger(1)} pathLength="1" d="M8 14h5" opacity="0.5" />
    </svg>
  );
}

/// 阅读视图：笔（点击进就地编辑）—— 线性风格与其它顶栏图标一致，无 emoji
function PenIcon() {
  return (
    <svg className="icon-pen" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path className="icon-pen__line" style={iconStagger(0)} pathLength="1" d="M12 20h9" />
      <g className="icon-pen__body">
        <path style={iconStagger(1)} pathLength="1" d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
      </g>
    </svg>
  );
}

/// 编辑视图：书（点击回阅读视图）—— 与 Obsidian 的视图切换语义一致
function BookIcon() {
  return (
    <svg className="icon-book" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path style={iconStagger(0)} pathLength="1" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path style={iconStagger(1)} pathLength="1" d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

/// 后退 / 前进：尖括号（‹ ›）—— 历史导航的通用符号，线性风格与其它顶栏图标一致
function ChevronLeftIcon() {
  return (
    <svg className="icon-draw icon-chev icon-chev--left" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path style={iconStagger(0)} pathLength="1" d="M15 5l-7 7 7 7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="icon-draw icon-chev icon-chev--right" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path style={iconStagger(0)} pathLength="1" d="M9 5l7 7-7 7" />
    </svg>
  );
}

/// 导出为 PDF：笺纸 + 落款箭头 —— 线性风格与其它顶栏图标一致
function ExportIcon() {
  return (
    <svg className="icon-draw" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path style={iconStagger(0)} pathLength="1" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path style={iconStagger(1)} pathLength="1" d="M14 2v6h6" opacity="0.35" />
      <g className="icon-export__arrow">
        <path style={iconStagger(2)} pathLength="1" d="M12 11v7" />
        <path style={iconStagger(3)} pathLength="1" d="M9 15l3 3 3-3" />
      </g>
    </svg>
  );
}

/// 阅读设置：齿轮 —— 线性风格与其它顶栏图标一致
function GearIcon() {
  return (
    <svg className="icon-draw" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle style={iconStagger(0)} pathLength="1" cx="12" cy="12" r="3" />
      <path style={iconStagger(1)} pathLength="1" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

type TopBarProps = {
  onOpen: () => void;
  isOutlineOpen?: boolean;
  onToggleOutline?: () => void;
  /// 历史栈里还有可退/可进的条目：为假时按钮禁用（透明度表达，不可点）
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  /// mdlog 记录中：齿轮右侧显示「记录中」小章（记录状态不只出现在文档尾部）
  isRecording?: boolean;
  /// 是否处于编辑视图（按钮呈按下态）
  isEditing?: boolean;
  /// mdlog 记录中为 false：按钮禁用并提示断开连接后才能修改
  canEdit?: boolean;
  onToggleEdit?: () => void;
  /// 设置视图是否打开（齿轮呈按下态：warm-sand 底 + brand 字色）
  isSettingsOpen?: boolean;
  /// 齿轮点击：进入/退出设置视图（视图本身在正文区，弹层已于 2026-09-20 退役）
  onToggleSettings?: () => void;
  /// 有已渲染的文档且不在设置视图里才可导出（底稿取自阅读 DOM）
  canExport?: boolean;
  /// 导出视图是否打开（导出按钮呈按下态，与齿轮同一语汇）
  isExportOpen?: boolean;
  /// 导出按钮点击：进入/退出「导出为 PDF」视图（Ctrl+P 同款开关）
  onToggleExport?: () => void;
};

export function TopBar({
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
  isSettingsOpen = false,
  onToggleSettings,
  canExport = false,
  isExportOpen = false,
  onToggleExport,
}: TopBarProps) {
  const window = getCurrentWindow();
  /// 导出按钮点按反馈：箭头落穿纸底一回合（is-firing 挂上，动画毕摘除）
  const [exportFiring, setExportFiring] = useState(false);

  return (
    <header className="top-bar" data-tauri-drag-region>
      <div className="top-bar__actions top-bar__actions--left" data-tauri-drag-region="false">
        {/* 纯工具栏（2026-09-20）：开关居首，历史导航紧随成对，编辑与打开其后；
            分隔线后是设置齿轮与「记录中」小章。路径已退出顶栏（归宿是正文标题
            tooltip 与设置页「当前文档」） */}
        <OutlineToggle isOpen={isOutlineOpen} onToggle={onToggleOutline ?? (() => {})} />
        {/* title 带快捷键提示，与「切换大纲（Ctrl+B）」同款；禁用态只降透明度 */}
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
          {/* 双章叠放换章：旧章旋缩淡出、新章就地描入（kami.css .edit-swap） */}
          <span className={`edit-swap${isEditing ? " is-book" : ""}`} aria-hidden="true">
            <PenIcon />
            <BookIcon />
          </span>
        </button>
        <button className="open-button" type="button" aria-label="打开文件" title="打开文件" onClick={onOpen}>
          <OpenIcon />
        </button>
        {onToggleExport && (
          <button
            className={`open-button export-toggle${exportFiring ? " is-firing" : ""}`}
            type="button"
            aria-label="导出为 PDF"
            aria-pressed={isExportOpen}
            disabled={!canExport && !isExportOpen}
            title="导出为 PDF（Ctrl+P）"
            onClick={() => {
              setExportFiring(true);
              onToggleExport();
            }}
            onAnimationEnd={(event) => {
              if (event.animationName === "icon-export-drop") setExportFiring(false);
            }}
          >
            <ExportIcon />
          </button>
        )}
        {onToggleSettings && (
          <>
            <span className="top-bar__divider" aria-hidden="true" />
            {/* 齿轮：进入/退出设置视图（2026-09-20 起设置是替换正文区的整页视图，弹层退役）。
                按下态 = 设置视图打开期间（warm-sand 底 + brand 字色），label 与 title 不变 */}
            <button
              className="open-button settings-toggle"
              type="button"
              aria-label="阅读设置"
              aria-pressed={isSettingsOpen}
              title="阅读设置"
              onClick={onToggleSettings}
            >
              <GearIcon />
            </button>
          </>
        )}
        {isRecording && <span className="top-bar__recording">记录中</span>}
      </div>
      {/* 中列留白：纯工具栏后这里只剩拖动热区（见 kami.css 的 .top-bar__spacer） */}
      <div className="top-bar__spacer" data-tauri-drag-region aria-hidden="true" />
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
