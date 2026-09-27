import { useCallback, useEffect, useRef, useState } from "react";
import { getSettingsStore } from "../lib/settings";
import { FONT_SLOT_VAR, fontSlotValue, sanitizeFontName, type FontSlot } from "../lib/fonts";

const STORE_KEY = "readerSettings";

/// 字面预热样张：按槽位各给够代表性的字符（CJK / 拉丁 / 代码符），
/// fonts.load 据此触发整族加载——而不是只载到行名的那几个字
const FONT_WARM_SAMPLE: Record<FontSlot, string> = {
  cjk: "素笺字体预览样张",
  latin: "Vellum AaBbGg 0123",
  mono: "() => {}; // mono",
};

export interface ReaderSettings {
  fontSize: number;
  columnWidth: number;
  lineHeight: number;
  /// 中文字面（空串 = 随包楷体，不覆写 --font-cjk）
  cjkFont: string;
  /// 西文字面（空串 = 跟随中文槽：西文字形仍由中文槽那款字体给）
  latinFont: string;
  /// 代码字面（空串 = 随包 JetBrains Mono）
  monoFont: string;
}

export const READER_FONT_SIZE_OPTIONS = [13, 14, 16, 18] as const;
export const READER_COLUMN_WIDTH_OPTIONS = [720, 800, 960] as const;
export const READER_LINE_HEIGHT_OPTIONS = [1.5, 1.55, 1.7] as const;

export const READER_SETTINGS_DEFAULT: ReaderSettings = {
  fontSize: 14,
  columnWidth: 800,
  lineHeight: 1.55,
  cjkFont: "",
  latinFont: "",
  monoFont: "",
};

/// Ctrl+= / Ctrl+- 的正文字号步进与 Ctrl+0 复位（快捷键侧用的纯函数）：
/// direction 0 回默认档；±1 沿选项表走一档、端点处夹取；
/// 当前值不在选项表内时先按最近一档定锚，再应用方向。
export function stepFontSize(current: number, direction: 1 | -1 | 0): number {
  if (direction === 0) return READER_SETTINGS_DEFAULT.fontSize;
  let index = (READER_FONT_SIZE_OPTIONS as readonly number[]).indexOf(current);
  if (index === -1) {
    index = READER_FONT_SIZE_OPTIONS.reduce(
      (best, option, i) =>
        Math.abs(option - current) < Math.abs(READER_FONT_SIZE_OPTIONS[best] - current) ? i : best,
      0
    );
  }
  const next = Math.min(READER_FONT_SIZE_OPTIONS.length - 1, Math.max(0, index + direction));
  return READER_FONT_SIZE_OPTIONS[next];
}

function pick<T extends number>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "number" && (options as readonly number[]).includes(value)
    ? (value as T)
    : fallback;
}

/// 字面字段：清洗后即接受（候选表是本机字体枚举出来的，不可能在白名单里穷举）；
/// 非字符串 / 清洗后为空（含 `"\;{}` 被剔干净的脏值）一律回「默认」
function pickFontName(value: unknown): string {
  return sanitizeFontName(value);
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
    cjkFont: pickFontName(record.cjkFont),
    latinFont: pickFontName(record.latinFont),
    monoFont: pickFontName(record.monoFont),
  };
}

/**
 * 阅读设置（正文字号 / 栏宽 / 行高 / 中文·西文·代码三槽字体）。
 * 生效方式：覆写根元素 --reader-font-size / --reader-column-width / --reader-line-height
 * 与 --font-cjk / --font-latin / --font-mono，kami.css 的正文与 .document-title 消费这些变量
 * （带默认值回退）。字面变量的值形如 `"思源宋体", var(--font-cjk-tail)`——尾巴在 CSS 端着。
 * 变量挂在 documentElement、与文档无关——热重载与换文档后设置继续生效。
 * 与 outlineWidth 同一个 settings.json Store，key `readerSettings`；改动即落盘。
 * 注意：栏宽/字号变化会引起整篇重排，调用方在 setSettings 前必须先走
 * beginWidthTransition() 钉住视口（与侧栏拖宽同路径）。换字体同理——字体度量不同，
 * 行数会变（走的是同一个 handleReaderSettingsChange 入口）。
 */
export function useReaderSettings(): [ReaderSettings, (patch: Partial<ReaderSettings>) => void] {
  const [settings, setSettingsState] = useState<ReaderSettings>(READER_SETTINGS_DEFAULT);
  /// 本次改动是否来自用户（启动时那次异步读盘不是改动，不该回写）
  const dirtyRef = useRef(false);

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

  // 字体三槽 → 根 CSS 变量：空串（默认）时**移除覆写**，让 kami.css 的 :root 回退生效。
  // 不写空值——`--font-cjk: ;` 会让消费处的 font-family 在计算值阶段失效。
  // 非默认字面先经 document.fonts.load 预热（300ms 封顶）再落笔：先写后载会让正文
  // 按回退字体排一遍、字文件到达再排一遍（双重整篇重排 + 字形先替后换的闪变）；
  // 预热把「加载」并进变量写入之前，重排只做一次。超时仍落笔——慢机器不饿着等；
  // apply 落点在 450ms 布局过渡窗内（beginWidthTransition 在 setSettings 之前已开）。
  // 已载入 / 回默认 / 无 fonts API（测试环境）的情形一律同步落笔，不绕一圈异步。
  useEffect(() => {
    const root = document.documentElement.style;
    const slots = { cjk: settings.cjkFont, latin: settings.latinFont, mono: settings.monoFont };
    const write = () => {
      for (const [slot, name] of Object.entries(slots) as [FontSlot, string][]) {
        if (name) root.setProperty(FONT_SLOT_VAR[slot], fontSlotValue(slot, name));
        else root.removeProperty(FONT_SLOT_VAR[slot]);
      }
    };
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    const cold = (Object.entries(slots) as [FontSlot, string][]).filter(
      ([slot, name]) =>
        name !== "" && !!fonts?.load && !fonts.check(`16px "${name}"`, FONT_WARM_SAMPLE[slot])
    );
    if (cold.length === 0) {
      write();
      return;
    }
    let cancelled = false;
    void Promise.all(
      cold.map(([slot, name]) =>
        Promise.race([
          fonts!.load(`16px "${name}"`, FONT_WARM_SAMPLE[slot]).catch(() => []),
          new Promise<FontFace[]>((resolve) => setTimeout(resolve, 300)),
        ])
      )
    ).then(() => {
      if (!cancelled) write();
    });
    return () => {
      cancelled = true;
    };
  }, [settings.cjkFont, settings.latinFont, settings.monoFont]);

  // 卸载时清掉变量覆写（默认值由 CSS 回退承接）
  useEffect(
    () => () => {
      const root = document.documentElement.style;
      root.removeProperty("--reader-font-size");
      root.removeProperty("--reader-column-width");
      root.removeProperty("--reader-line-height");
      root.removeProperty(FONT_SLOT_VAR.cjk);
      root.removeProperty(FONT_SLOT_VAR.latin);
      root.removeProperty(FONT_SLOT_VAR.mono);
    },
    []
  );

  // 落盘挂在 effect 上而不是 setState updater 里：updater 在 StrictMode 下会被调用两次
  // （副作用幂等只是运气好），且它可能早于本次状态真正提交就发起 IPC —— 落盘的内容与
  // 已提交的状态不再是同一份。effect 只在**提交之后**跑，落盘值就是屏幕上的值
  useEffect(() => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    // 分段选择器是离散操作，无需防抖：直接落盘
    void (async () => {
      try {
        const store = await getSettingsStore();
        await store.set(STORE_KEY, settings);
        await store.save();
      } catch (error) {
        console.warn("readerSettings Store save failed:", error);
      }
    })();
  }, [settings]);

  const setSettings = useCallback((patch: Partial<ReaderSettings>) => {
    dirtyRef.current = true;
    setSettingsState((prev) => sanitize({ ...prev, ...patch }));
  }, []);

  return [settings, setSettings];
}
