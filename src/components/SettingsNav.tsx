import { useState } from "react";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./SettingsView";

type SettingsNavProps = {
  activeSectionId: SettingsSectionId;
  onSelectSection: (id: SettingsSectionId) => void;
  /// 与大纲搜索框共用同一枚 ref：Ctrl+K 在设置视图里聚焦的也是这枚输入框
  searchInputRef: React.RefObject<HTMLInputElement | null>;
};

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="7" y1="7" x2="17" y2="17" />
      <line x1="17" y1="7" x2="7" y2="17" />
    </svg>
  );
}

/**
 * 设置视图的侧栏内容：同一枚 `.outline-sidebar` 换内容（题头「設定」+ 搜索框 + 分节导航）。
 * 类名一律复用 `.outline-panel*` / `.outline-search*` 语汇——侧栏的样式、开合、拖宽、
 * 默认关全部跟着文章大纲那枚走，这里只换内容，不新增侧栏样式。
 *
 * 搜索框的行为与大纲一致：输入即过滤下方条目，idle 态右侧是 kbd「Ctrl K」。
 */
export function SettingsNav({ activeSectionId, onSelectSection, searchInputRef }: SettingsNavProps) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const visibleSections =
    trimmed === ""
      ? SETTINGS_SECTIONS
      : SETTINGS_SECTIONS.filter((section) => section.label.includes(trimmed));

  return (
    <nav className="outline-panel" aria-label="设置分节">
      <div className="outline-panel__header">設定</div>

      <div className={`outline-search ${trimmed !== "" ? "outline-search--active" : ""}`}>
        <span className="outline-search__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          ref={searchInputRef}
          type="text"
          className="outline-search__input"
          placeholder="寻项…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            // 栈式语义：输入框里的 Escape 只清词，不再冒到 window 去关掉整个设置视图
            event.stopPropagation();
            setQuery("");
            event.currentTarget.blur();
          }}
          aria-label="搜索设置项"
        />
        {trimmed !== "" ? (
          <button
            type="button"
            className="outline-search__nav outline-search__clear"
            aria-label="清除搜索"
            title="清除搜索"
            onClick={() => {
              setQuery("");
              searchInputRef.current?.focus();
            }}
          >
            <ClearIcon />
          </button>
        ) : (
          <kbd className="outline-search__kbd">Ctrl K</kbd>
        )}
      </div>

      <div className="outline-panel__scroll">
        {visibleSections.length === 0 ? (
          <p className="outline-panel__empty">无匹配分节</p>
        ) : (
          <ul className="outline-panel__list">
            {visibleSections.map((section) => {
              const isActive = section.id === activeSectionId;
              return (
                <li key={section.id} className="outline-panel__item">
                  <button
                    type="button"
                    className={`outline-panel__link ${isActive ? "outline-panel__link--active" : ""}`}
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => onSelectSection(section.id)}
                  >
                    {section.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
