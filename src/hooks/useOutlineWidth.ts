import { useCallback, useEffect, useRef, useState } from "react";
import { getSettingsStore } from "../lib/settings";

const STORE_KEY = "outlineWidth";

// 侧边栏宽度调节幅度刻意收窄（用户要求「幅度不能太大」）：
// 过窄标题被裁、过宽侵占正文章宽，200–320px 围绕默认 240 微调
export const OUTLINE_WIDTH_MIN = 200;
export const OUTLINE_WIDTH_MAX = 320;
export const OUTLINE_WIDTH_DEFAULT = 240;

function clampWidth(value: number): number {
  return Math.min(OUTLINE_WIDTH_MAX, Math.max(OUTLINE_WIDTH_MIN, Math.round(value)));
}

/**
 * 侧边栏宽度（拖拽右缘调节）。
 * 生效方式：覆写根元素 --outline-width CSS 变量——--outline-shift 由
 * calc(var(--outline-width) + var(--outline-gutter)) 派生，正文右移量自动跟随，
 * 无需 JS 参与布局。
 * 与 outlineOpen 不同，宽度是长期偏好：持久化到共享 settings Store 且启动时恢复。
 */
export function useOutlineWidth(): [number, (width: number) => void] {
  const [width, setWidthState] = useState(OUTLINE_WIDTH_DEFAULT);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 启动时恢复上次调节的宽度
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await getSettingsStore();
        const saved = await store.get<unknown>(STORE_KEY);
        if (cancelled) return;
        if (typeof saved === "number" && Number.isFinite(saved)) {
          setWidthState(clampWidth(saved));
        }
      } catch (error) {
        console.warn("outlineWidth Store load failed:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 宽度变化 → 覆写根 CSS 变量（sidebar 宽度与正文 margin 同时跟随）
  useEffect(() => {
    document.documentElement.style.setProperty("--outline-width", `${width}px`);
  }, [width]);

  // 卸载时清掉变量覆写与未落盘的防抖写入
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty("--outline-width");
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
    },
    []
  );

  const setWidth = useCallback((next: number) => {
    setWidthState(clampWidth(next));
    // 拖拽期间连续调用：防抖落盘，松手后 400ms 写一次即可
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void (async () => {
        try {
          const store = await getSettingsStore();
          await store.set(STORE_KEY, clampWidth(next));
          await store.save();
        } catch (error) {
          console.warn("outlineWidth Store save failed:", error);
        }
      })();
    }, 400);
  }, []);

  return [width, setWidth];
}
