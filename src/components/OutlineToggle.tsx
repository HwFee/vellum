type OutlineToggleProps = {
  isOpen: boolean;
  onToggle: () => void;
};

function OutlineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="15" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="12" y2="18" />
      <circle cx="19" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="18" r="1" fill="currentColor" stroke="none" />
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
