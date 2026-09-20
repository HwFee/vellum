import { useCallback, useEffect, useState } from "react";
import { getSettingsStore } from "../lib/settings";

const STORE_KEY = "readerSettings";

export interface ReaderSettings {
  fontSize: number;
  columnWidth: number;
  lineHeight: number;
}

export const READER_FONT_SIZE_OPTIONS = [13, 14, 16, 18] as const;
export const READER_COLUMN_WIDTH_OPTIONS = [720, 800, 960] as const;
export const READER_LINE_HEIGHT_OPTIONS = [1.5, 1.55, 1.7] as const;

export const READER_SETTINGS_DEFAULT: ReaderSettings = {
  fontSize: 14,
  columnWidth: 800,
  lineHeight: 1.55,
};

function pick<T extends number>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "number" && (options as readonly number[]).includes(value)
    ? (value as T)
    : fallback;
}

/// 持久化值逐字段校验：非法/越界字段回退默认，其余字段保留
function sanitize(saved: unknown): ReaderSettings {
  const record = (saved ?? {}) as Partial<Record<keyof ReaderSettings, unknown>>;
  return {
    fontSize: pick(record.fontSize, READER_FONT_SIZE_OPTIONS, READER_SETTINGS_DEFAULT.fontSize),
    columnWidth: pick(
      record.columnWidth,
      READER_COLUMN_WIDTH_OPTIONS,
      READER_SETTINGS_DEFAULT.columnWidth
    ),
    lineHeight: pick(
      record.lineHeight,
      READER_LINE_HEIGHT_OPTIONS,
      READER_SETTINGS_DEFAULT.lineHeight
    ),
  };
}

/**
 * 阅读设置（正文字号 / 栏宽 / 行高）。
 * 生效方式：覆写根元素 --reader-font-size / --reader-column-width / --reader-line-height
 * CSS 变量，kami.css 的正文与 .document-title 消费这些变量（带默认值回退）。
 * 变量挂在 documentElement、与文档无关——热重载与换文档后设置继续生效。
 * 与 outlineWidth 同一个 settings.json Store，key `readerSettings`；改动即落盘。
 * 注意：栏宽/字号变化会引起整篇重排，调用方在 setSettings 前必须先走
 * beginWidthTransition() 钉住视口（与侧栏拖宽同路径）。
 */
export function useReaderSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const [settings, setSettingsState] = useState<ReaderSettings>(READER_SETTINGS_DEFAULT);

  // 启动尽早恢复持久化设置；无记录或读取失败时保持默认值（与 CSS 回退一致，不闪烁）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await getSettingsStore();
        const saved = await store.get<unknown>(STORE_KEY);
        if (cancelled || saved == null) return;
        setSettingsState(sanitize(saved));
      } catch (error) {
        console.warn("readerSettings Store load failed:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 设置 → 根 CSS 变量覆写
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--reader-font-size", `${settings.fontSize}px`);
    root.setProperty("--reader-column-width", `${settings.columnWidth}px`);
    root.setProperty("--reader-line-height", `${settings.lineHeight}`);
  }, [settings]);

  // 卸载时清掉变量覆写（默认值由 CSS 回退承接）
  useEffect(
    () => () => {
      const root = document.documentElement.style;
      root.removeProperty("--reader-font-size");
      root.removeProperty("--reader-column-width");
      root.removeProperty("--reader-line-height");
    },
    []
  );

  const setSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setSettingsState((prev) => {
      const next = sanitize({ ...prev, ...patch });
      // 分段选择器是离散操作，无需防抖：直接落盘
      void (async () => {
        try {
          const store = await getSettingsStore();
          await store.set(STORE_KEY, next);
          await store.save();
        } catch (error) {
          console.warn("readerSettings Store save failed:", error);
        }
      })();
      return next;
    });
  }, []);

  return [settings, setSettings];
}
