import { useEffect, useRef, type RefObject } from "react";
import {
  READER_COLUMN_WIDTH_OPTIONS,
  READER_FONT_SIZE_OPTIONS,
  READER_LINE_HEIGHT_OPTIONS,
  READER_SETTINGS_DEFAULT,
  type ReaderSettings,
} from "../hooks/useReaderSettings";

type SettingsPopoverProps = {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  onClose: () => void;
  /** 触发按钮：点击它不算「点外部」（开/关由按钮自身的 toggle 负责） */
  anchorRef: RefObject<HTMLElement | null>;
};

/// 1.5 / 1.55 / 1.7 的紧凑显示（去掉多余的尾随零）
function formatLineHeight(value: number): string {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

type SegmentRowProps = {
  label: string;
  options: readonly number[];
  value: number;
  format: (value: number) => string;
  onSelect: (value: number) => void;
};

function SegmentRow({ label, options, value, format, onSelect }: SegmentRowProps) {
  return (
    <div className="settings-popover__row">
      <span className="settings-popover__label">{label}</span>
      <div className="settings-popover__segments" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className="settings-popover__segment"
            aria-pressed={option === value}
            onClick={() => onSelect(option)}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 阅读设置弹层：锚在顶栏齿轮按钮下方（绝对定位于其包裹容器），
 * 点外部 / Escape 关闭。三行分段选择器 + 底部「恢复默认 / 自动保存」。
 * 样式定位与描边见 kami.css 的 .settings-popover 区段。
 */
export function SettingsPopover({ settings, onChange, onClose, anchorRef }: SettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // 栈式语义：本层收下这次 Escape，不再冒到 window——窄屏下 Escape 同时是
        // 「关侧栏」的入口，不拦就会一次按键关两层（弹层与侧栏一起消失）
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, anchorRef]);

  return (
    <div ref={popoverRef} className="settings-popover" role="dialog" aria-label="阅读设置">
      <SegmentRow
        label="正文字号"
        options={READER_FONT_SIZE_OPTIONS}
        value={settings.fontSize}
        format={(value) => `${value}`}
        onSelect={(fontSize) => onChange({ fontSize })}
      />
      <SegmentRow
        label="栏宽"
        options={READER_COLUMN_WIDTH_OPTIONS}
        value={settings.columnWidth}
        format={(value) => `${value}`}
        onSelect={(columnWidth) => onChange({ columnWidth })}
      />
      <SegmentRow
        label="行高"
        options={READER_LINE_HEIGHT_OPTIONS}
        value={settings.lineHeight}
        format={formatLineHeight}
        onSelect={(lineHeight) => onChange({ lineHeight })}
      />
      <div className="settings-popover__footer">
        <button
          type="button"
          className="settings-popover__reset"
          onClick={() => onChange({ ...READER_SETTINGS_DEFAULT })}
        >
          恢复默认
        </button>
        <span className="settings-popover__autosave">自动保存</span>
      </div>
    </div>
  );
}
