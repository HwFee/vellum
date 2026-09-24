import { useCallback, useRef } from "react";
import { slugify } from "../lib/outline";
import type { HeadingLevel, OutlineHeading } from "../types";

/**
 * 标题 id 分配器（原 MarkdownDocument.tsx 内嵌，逐字不变）：
 * 按「大纲精确匹配 → 公式标题按序兜底 → slugify + 序号」的顺序分配，
 * 保证正文标题 id 与大纲条目一一对应、且同渲染内不重号。
 */
export function useHeadingIdResolver(headings?: OutlineHeading[]) {
  const usedIds = useRef(new Set<string>());
  const fallbackCounter = useRef(0);
  const headingsRef = useRef(headings);
  headingsRef.current = headings;

  // Reset allocation on every render so document/headings changes do not carry over stale ids.
  usedIds.current = new Set<string>();
  fallbackCounter.current = 0;

  // 【不变量约束（React 19 并发渲染合规，C5）】：
  // resolveHeadingId 必须且仅允许在渲染期被组件（components.h1–h6）同步调用。
  // headingsRef 在每次渲染函数体中赋值，usedIds/fallbackCounter 也在同一次渲染中重置。
  // 严禁将其放入事件处理器、useEffect/useLayoutEffect 或 setTimeout 等异步回调中调用，
  // 否则在 React 19 并发中断/重放渲染时，读取到的将是未提交帧或已被废弃 pass 的 stale headings。
  return useCallback(
    (level: HeadingLevel, text: string) => {
      const candidates = headingsRef.current?.filter((h) => h.level === level && h.text === text) ?? [];
      for (const candidate of candidates) {
        if (!usedIds.current.has(candidate.id)) {
          usedIds.current.add(candidate.id);
          return candidate.id;
        }
      }

      // 精确匹配失败多半是公式标题：渲染文本与源文本不一致（「$O(n)$」渲染成「O(n)」，
      // 且 KaTeX 输出含 MathML 隐藏副本）。渲染顺序与大纲顺序一致（同源文档），取同级
      // 第一个未使用且源文本含 $ 的标题按序分配。限定含 $ 是为了防止原始 HTML 标题
      //（不在大纲里）误占大纲 id。
      const mathCandidate = headingsRef.current?.find(
        (h) => h.level === level && h.text.includes("$") && !usedIds.current.has(h.id)
      );
      if (mathCandidate) {
        usedIds.current.add(mathCandidate.id);
        return mathCandidate.id;
      }

      let baseId = slugify(text) || "heading";
      if (!usedIds.current.has(baseId)) {
        usedIds.current.add(baseId);
        return baseId;
      }

      let suffix = fallbackCounter.current + 1;
      let id = `${baseId}-${suffix}`;
      while (usedIds.current.has(id)) {
        suffix += 1;
        id = `${baseId}-${suffix}`;
      }
      usedIds.current.add(id);
      fallbackCounter.current = suffix;
      return id;
    },
    []
  );
}
