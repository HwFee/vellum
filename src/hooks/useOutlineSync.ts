import { useEffect, useMemo, useRef, useState } from "react";
import type { OutlineHeading } from "../types";

export function useOutlineSync(
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  headings: OutlineHeading[]
): string | undefined {
  const [activeHeadingId, setActiveHeadingId] = useState<string | undefined>(undefined);
  const headingIdsKey = useMemo(() => headings.map((h) => h.id).join(","), [headings]);
  const activeRef = useRef(activeHeadingId);
  activeRef.current = activeHeadingId;

  useEffect(() => {
    if (!scrollContainerRef.current) return;

    if (headings.length === 0) {
      if (activeRef.current !== undefined) {
        setActiveHeadingId(undefined);
      }
      return;
    }

    const container = scrollContainerRef.current;
    const headingIds = headings.map((h) => h.id);

    const updateActive = () => {
      const containerRect = container.getBoundingClientRect();
      const threshold = containerRect.top + 80;

      let bestId: string | undefined = undefined;
      let bestTop = Number.NEGATIVE_INFINITY;

      for (const id of headingIds) {
        const element = document.getElementById(id);
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        if (rect.top <= threshold && rect.top > bestTop) {
          bestTop = rect.top;
          bestId = id;
        }
      }

      // 顶部兜底：页面在文档开头时所有标题都在阈值线下方，没有候选；
      // 此时激活文档顺序中的第一个标题（即「即将进入的那一节」），保证高亮不消失
      if (bestId === undefined) {
        for (const id of headingIds) {
          if (document.getElementById(id)) {
            bestId = id;
            break;
          }
        }
      }

      if (activeRef.current !== bestId) {
        setActiveHeadingId(bestId);
      }
    };

    const handleScroll = () => updateActive();

    if (typeof window.IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver(
        () => {
          updateActive();
        },
        {
          root: container,
          rootMargin: "0px 0px -80% 0px",
          threshold: 0,
        }
      );

      for (const id of headingIds) {
        const element = document.getElementById(id);
        if (element) observer.observe(element);
      }

      container.addEventListener("scroll", handleScroll, { passive: true });
      updateActive();

      return () => {
        container.removeEventListener("scroll", handleScroll);
        observer.disconnect();
      };
    }

    container.addEventListener("scroll", handleScroll, { passive: true });
    updateActive();

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [scrollContainerRef, headingIdsKey]);

  return activeHeadingId;
}
