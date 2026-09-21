import { useEffect, useMemo, useRef, useState } from "react";
import type { OutlineHeading } from "../types";

export function useOutlineSync(
  scrollContainerRef: React.RefObject<HTMLElement | null>,
  headings: OutlineHeading[],
  // 大纲点击跳转期间锁定的目标标题 id：正文缓动滚动会途经中间标题，
  // 锁定期间 activeHeadingId 固定为目标，避免大纲跟随动画先跑去中间位置再折返
  navTargetRef?: React.RefObject<string | null>,
  // 正文容器内容换代（设置视图替换正文后又换回来）：正文元素退出过 DOM，回来时是**新元素**
  // ——观察器不按这一项重挂，就再也不会收到回调（大纲高亮会停在空白态直到用户滚动）
  revision: string = "document"
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
      // 导航锁定期间直接采用目标标题，忽略途经位置
      const navTarget = navTargetRef?.current;
      if (navTarget) {
        if (activeRef.current !== navTarget) {
          setActiveHeadingId(navTarget);
        }
        return;
      }

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
  }, [scrollContainerRef, headingIdsKey, revision]);

  return activeHeadingId;
}
