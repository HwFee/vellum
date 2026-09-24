import { useCallback, useDeferredValue, useState } from "react";

export type SearchState = {
  searchQuery: string;
  /** 搜索词延迟传给文档渲染层：输入框即时响应，大文档的高亮重解析
      以低优先级在后台进行（MarkdownDocument 已 memo， deferred 值不变时整体跳过渲染） */
  deferredSearchQuery: string;
  /** urgent 渲染期间 deferred 值尚未跟进：此时 activeMatchIndex 已被重置为 0，
      MarkdownDocument 凭此标记知道「索引重置是输入的副产物」，不触发滚动 */
  searchQueryPending: boolean;
  activeMatchIndex: number;
  matchCount: number;
  handleSearchChange: (query: string) => void;
  handleNextMatch: () => void;
  handlePrevMatch: () => void;
  handleMatchCountChange: (count: number) => void;
};

/// 全文检索状态（原 App.tsx「===== 搜索状态 =====」一节）。
export function useSearchState(): SearchState {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);

  // 搜索词延迟传给文档渲染层：输入框即时响应，大文档的高亮重解析
  // 以低优先级在后台进行（MarkdownDocument 已 memo， deferred 值不变时整体跳过渲染）
  const deferredSearchQuery = useDeferredValue(searchQuery);
  // urgent 渲染期间 deferred 值尚未跟进：此时 activeMatchIndex 已被重置为 0，
  // MarkdownDocument 凭此标记知道「索引重置是输入的副产物」，不触发滚动
  const searchQueryPending = searchQuery !== deferredSearchQuery;

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
    setActiveMatchIndex(0);
  }, []);

  const handleNextMatch = useCallback(() => {
    setActiveMatchIndex((prev) => (matchCount > 0 ? (prev + 1) % matchCount : 0));
  }, [matchCount]);

  const handlePrevMatch = useCallback(() => {
    setActiveMatchIndex((prev) => (matchCount > 0 ? (prev - 1 + matchCount) % matchCount : 0));
  }, [matchCount]);

  const handleMatchCountChange = useCallback((count: number) => {
    setMatchCount(count);
  }, []);

  return {
    searchQuery,
    deferredSearchQuery,
    searchQueryPending,
    activeMatchIndex,
    matchCount,
    handleSearchChange,
    handleNextMatch,
    handlePrevMatch,
    handleMatchCountChange,
  };
}
