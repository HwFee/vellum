import type { CSSProperties } from "react";

type OutlineToggleProps = {
  isOpen: boolean;
  onToggle: () => void;
};

/// 描边入场的笔顺（kami.css `.icon-draw` 按 --i 依次描出）
const iconStagger = (n: number) => ({ "--i": n }) as CSSProperties;

function OutlineIcon() {
  return (
    <svg className="icon-draw" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line className="icon-line icon-l1" style={iconStagger(0)} pathLength="1" x1="4" y1="6" x2="15" y2="6" />
      <line className="icon-line icon-l2" style={iconStagger(1)} pathLength="1" x1="4" y1="12" x2="20" y2="12" />
      <line className="icon-line icon-l3" style={iconStagger(2)} pathLength="1" x1="4" y1="18" x2="12" y2="18" />
      <circle style={iconStagger(3)} cx="19" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle style={iconStagger(4)} cx="16" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function OutlineToggle({ isOpen, onToggle }: OutlineToggleProps) {
  return (
    <button
      type="button"
      className="outline-toggle"
      aria-label="切换大纲"
      aria-pressed={isOpen}
      title="切换大纲（Ctrl+B）"
      onClick={onToggle}
    >
      <OutlineIcon />
    </button>
  );
}
