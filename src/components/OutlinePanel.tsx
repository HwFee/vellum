import { useEffect, useMemo, useRef } from "react";
import { buildOutlineTree, type OutlineNode } from "../lib/outline";
import { animateScrollTo } from "../lib/smoothScroll";
import type { OutlineHeading } from "../types";

type OutlinePanelProps = {
  headings: OutlineHeading[];
  activeHeadingId?: string;
  onSelectHeading?: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  matchCount: number;
  activeMatchIndex: number;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
};

const CN_NUMS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/// 将阿拉伯序号转为中文数字（大纲一级标题编号用），支持 1–99。
function toChineseNumeral(n: number): string {
  if (n <= 10) return CN_NUMS[n - 1];
  if (n < 20) return "十" + (n % 10 === 0 ? "" : CN_NUMS[(n % 10) - 1]);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return CN_NUMS[tens - 1] + "十" + (ones === 0 ? "" : CN_NUMS[ones - 1]);
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function OutlineItems({
  nodes,
  activeHeadingId,
  onSelectHeading,
}: {
  nodes: OutlineNode[];
  activeHeadingId?: string;
  onSelectHeading?: (id: string) => void;
}) {
  return (
    <ul className="outline-panel__list">
      {nodes.map((node, index) => {
        const numeral = node.level === 1 ? toChineseNumeral(index + 1) : null;
        return (
          <li key={node.id} className="outline-panel__item">
            <button
              type="button"
              className={`outline-panel__link ${node.id === activeHeadingId ? "outline-panel__link--active" : ""}`}
              aria-label={node.text || undefined}
              title={node.text || undefined}
              onClick={() => onSelectHeading?.(node.id)}
            >
              {numeral !== null && (
                <span className="outline-panel__num">{numeral}、</span>
              )}
              {node.text || "\u00A0"}
            </button>
            {node.children.length > 0 ? (
              <OutlineItems
                nodes={node.children}
                activeHeadingId={activeHeadingId}
                onSelectHeading={onSelectHeading}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function OutlinePanel({
  headings,
  activeHeadingId,
  onSelectHeading,
  searchQuery,
  onSearchChange,
  matchCount,
  activeMatchIndex,
  onNextMatch,
  onPrevMatch,
  searchInputRef,
}: OutlinePanelProps) {
  const navRef = useRef<HTMLElement>(null);
  const scrollCancelRef = useRef<(() => void) | null>(null);
  const isSearching = searchQuery.length > 0;
  // 大纲树只在 headings 变化时重建，搜索输入等高频渲染不再重复计算
  const outlineTree = useMemo(() => buildOutlineTree(headings), [headings]);

  // 搜索激活时跳过自动滚动：搜索已通过文档内的 scrollIntoView 滚动正文，
  // 若大纲面板再跟随滚动会形成连锁反应（正文↔侧边栏互相触发），导致抖动甚至白屏。
  // 正文滚动时 activeHeadingId 高频变化，原生 smooth scrollIntoView 被连续打断会"近距离慢挪、
  // 远距离直跳"；这里手动计算 block:"nearest" 目标位置，用自定义缓动从当前位置接续动画，
  // 保证大纲始终平滑跟随。
  useEffect(() => {
    if (!activeHeadingId) return;
    if (isSearching) return;
    const active = navRef.current?.querySelector(".outline-panel__link--active");
    const container = active?.closest(".outline-sidebar");
    if (!active || !container) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    let target: number | null = null;
    if (activeRect.top < containerRect.top) {
      target = container.scrollTop + (activeRect.top - containerRect.top) - 8;
    } else if (activeRect.bottom > containerRect.bottom) {
      target = container.scrollTop + (activeRect.bottom - containerRect.bottom) + 8;
    }
    if (target === null) return;

    scrollCancelRef.current?.();
    scrollCancelRef.current = animateScrollTo(container as HTMLElement, target);
  }, [activeHeadingId, isSearching]);

  // 卸载时取消进行中的跟随动画
  useEffect(() => () => scrollCancelRef.current?.(), []);

  return (
    <nav ref={navRef} className="outline-panel" aria-label="文档大纲">
      <div className="outline-panel__header">目錄</div>

      {/* 搜索框 — 样式 C 描边式 */}
      <div className={`outline-search ${isSearching ? "outline-search--active" : ""}`}>
        <span className="outline-search__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          ref={searchInputRef}
          type="text"
          className="outline-search__input"
          placeholder="寻章…"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) {
              e.preventDefault();
              onPrevMatch();
            } else if (e.key === "Enter") {
              e.preventDefault();
              onNextMatch();
            } else if (e.key === "Escape") {
              onSearchChange("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-label="搜索文档内容"
        />
        {isSearching ? (
          <span className="outline-search__results">
            <span className="outline-search__count">
              {matchCount > 0 ? `${activeMatchIndex + 1}/${matchCount}` : "0/0"}
            </span>
            <button type="button" className="outline-search__nav" onClick={onPrevMatch} aria-label="上一个匹配" title="上一个 (Shift+Enter)">
              <ChevronUpIcon />
            </button>
            <button type="button" className="outline-search__nav" onClick={onNextMatch} aria-label="下一个匹配" title="下一个 (Enter)">
              <ChevronDownIcon />
            </button>
          </span>
        ) : (
          <kbd className="outline-search__kbd">⌘K</kbd>
        )}
      </div>

      {headings.length === 0 ? (
        <p className="outline-panel__empty">本文档暂无目录</p>
      ) : (
        <OutlineItems
          nodes={outlineTree}
          activeHeadingId={activeHeadingId}
          onSelectHeading={onSelectHeading}
        />
      )}
    </nav>
  );
}
