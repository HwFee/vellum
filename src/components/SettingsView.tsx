import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  READER_COLUMN_WIDTH_OPTIONS,
  READER_FONT_SIZE_OPTIONS,
  READER_LINE_HEIGHT_OPTIONS,
  READER_SETTINGS_DEFAULT,
  type ReaderSettings,
} from "../hooks/useReaderSettings";
import {
  BUNDLED_FONTS,
  filterFonts,
  loadSystemFonts,
  sortFontsForSlot,
  type FontSlot,
  type SystemFont,
} from "../lib/fonts";
import type { AppPreferences } from "../lib/appPreferences";
import type { ThemePreference } from "../lib/theme";
import type { HeadingScript } from "../lib/headingLabels";
import { checkForUpdates } from "../lib/updater";

/**
 * 设置页分节：侧栏导航与栏内分节**同源**（新增一个设置域 = 这里加一条 + 栏内加一个分节，
 * 侧栏搜索自动能搜到它）。顺序即栏内从上到下的顺序。
 */
export const SETTINGS_SECTIONS = [
  { id: "reading", label: "阅读" },
  { id: "interface", label: "界面" },
  { id: "updates", label: "更新" },
  { id: "about", label: "关于与数据" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

/// 分节元素 id：侧栏点条目据此在滚动容器里找到目标（设置视图与正文共用同一个滚动容器）
export function settingsSectionElementId(id: SettingsSectionId): string {
  return `settings-section-${id}`;
}

/// 1.5 / 1.55 / 1.7 的紧凑显示（去掉多余的尾随零）
function formatLineHeight(value: number): string {
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/// 快捷键一览（只读陈列）：与 App 的全局快捷键处理器一一对应。
const SHORTCUTS = [
  { label: "切换大纲", keys: ["CTRL", "B"] },
  { label: "聚焦搜索", keys: ["CTRL", "K / F"] },
  { label: "全库检索", keys: ["CTRL", "SHIFT", "F"] },
  { label: "打开文件", keys: ["CTRL", "O"] },
  { label: "就地编辑", keys: ["CTRL", "E"] },
  { label: "提交保存", keys: ["CTRL", "S"] },
  { label: "导出为 PDF", keys: ["CTRL", "P"] },
  { label: "字号 大·小·复位", keys: ["CTRL", "+", "−", "0"] },
  { label: "下一处·上一处匹配", keys: ["F3", "SHIFT F3"] },
  { label: "后退·前进", keys: ["ALT", "←", "→"] },
  { label: "专注模式", keys: ["F11"] },
] as const;

/// 「外观」分段选择器的选项（顺序即展示顺序）
const THEME_OPTIONS: readonly ThemePreference[] = ["system", "light", "dark"];
const THEME_LABELS: Record<ThemePreference, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

/// 「侧栏题头字形」分段选择器的选项（出厂繁体——维持既有题头字形）
const HEADING_SCRIPT_OPTIONS: readonly HeadingScript[] = ["traditional", "simplified"];
const HEADING_SCRIPT_LABELS: Record<HeadingScript, string> = {
  traditional: "繁体",
  simplified: "简体",
};

type SegmentRowProps<T extends string | number> = {
  label: string;
  options: readonly T[];
  value: T;
  format: (value: T) => string;
  onSelect: (value: T) => void;
};

function SegmentRow<T extends string | number>({ label, options, value, format, onSelect }: SegmentRowProps<T>) {
  return (
    <div className="settings-view__row">
      <span className="settings-view__label">{label}</span>
      <div className="segments" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className="seg"
            aria-pressed={option === value}
            onClick={() => onSelect(option)}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

type ToggleRowProps = {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
};

/// 两态开关（开 / 关）：与分段选择器同一语汇，只是选项固定为布尔两档
function ToggleRow({ label, value, onChange }: ToggleRowProps) {
  return (
    <div className="settings-view__row">
      <span className="settings-view__label">{label}</span>
      <div className="segments" role="group" aria-label={label}>
        <button type="button" className="seg" aria-pressed={value} onClick={() => onChange(true)}>
          开
        </button>
        <button type="button" className="seg" aria-pressed={!value} onClick={() => onChange(false)}>
          关
        </button>
      </div>
    </div>
  );
}

/// 面板宽度与高度上限：定位时用来判「下方放不下就翻到上方」，与 `.font-picker__panel`
/// 的 max-height / width 是同一组数（那边是 CSS，这边是量度）
const FONT_PANEL_WIDTH = 320;
const FONT_PANEL_MAX_HEIGHT = 340;
const FONT_PANEL_GAP = 6;

/// 面板定位：锚在按钮左下（右缘对齐），下方不足则翻到上方。
/// 面板是 fixed 的——设置视图活在 overflow-y: scroll 的滚动容器里，
/// 绝对定位的面板会在容器底部被裁掉。
function measurePanel(anchor: HTMLElement | null, panel: HTMLElement | null) {
  if (!anchor || !panel) return null;
  const rect = anchor.getBoundingClientRect();
  const width = panel.offsetWidth || FONT_PANEL_WIDTH;
  const height = Math.min(panel.offsetHeight || FONT_PANEL_MAX_HEIGHT, FONT_PANEL_MAX_HEIGHT);
  const maxLeft = Math.max(8, window.innerWidth - width - 8);
  const left = Math.min(Math.max(8, rect.right - width), maxLeft);
  const below = window.innerHeight - rect.bottom - FONT_PANEL_GAP;
  const above = rect.top - FONT_PANEL_GAP;
  if (below < height && above > below) {
    return { left, top: undefined, bottom: window.innerHeight - rect.top + FONT_PANEL_GAP };
  }
  return { left, top: rect.bottom + FONT_PANEL_GAP, bottom: undefined };
}

type FontPickerRowProps = {
  label: string;
  slot: FontSlot;
  /// 当前字面（空串 = 默认，由 CSS 回退承接）
  value: string;
  /// 「默认」那一行的字样（各槽各不相同：中文随包楷体 / 西文跟随中文 / 代码 JetBrains Mono）
  defaultLabel: string;
  fonts: readonly SystemFont[];
  onSelect: (name: string) => void;
};

/**
 * 候选项字面的渐进预览：默认用界面字体渲染行名，滚进视口（含 60px 预载带）才把
 * 行换上它自己的字面——开面板即触发几百款字体的同步整形曾是整帧卡顿的主因。
 * 字面一旦应用就不再摘下（已载入的字体再渲染是零成本）；无 IntersectionObserver
 * 的环境（测试/旧内核）退化为直接上字面。
 */
function FontOptionName({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || preview) return;
    if (typeof IntersectionObserver === "undefined") {
      setPreview(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPreview(true);
          observer.disconnect();
        }
      },
      { root: el.closest(".font-picker__list"), rootMargin: "60px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [preview]);

  return (
    <span
      ref={ref}
      className="font-picker__option-name"
      style={preview ? { fontFamily: `"${name}"` } : undefined}
    >
      {name}
    </span>
  );
}

/**
 * 字体选择器（中文 / 西文 / 代码三槽共用一枚）。
 * 候选表 = 本机已装字体 + 随包两款（Rust 的 list_system_fonts，拉一次缓存在 lib/fonts）。
 * 行字面渐进渲染（见 FontOptionName）——选之前先看得见字形，又不为隐藏项白整形。
 */
function FontPickerRow({
  label,
  slot,
  value,
  defaultLabel,
  fonts,
  onSelect,
}: FontPickerRowProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{
    left: number;
    top: number | undefined;
    bottom: number | undefined;
  } | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  /// 字面预热淡态：写 --font-* 前会先 document.fonts.load 暖字体（useReaderSettings），
  /// 暖完或超时前按钮以淡态提示「已选、正在载」；字体就绪事件或 800ms 兜底恢复
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setPending(false);
    if (!value) return;
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    if (!fonts || typeof fonts.check !== "function") return;
    const spec = `16px "${value}"`;
    if (fonts.check(spec)) return;
    setPending(true);
    const settle = () => {
      if (fonts.check(spec)) setPending(false);
    };
    fonts.addEventListener("loadingdone", settle);
    const timeout = setTimeout(() => setPending(false), 800);
    return () => {
      fonts.removeEventListener("loadingdone", settle);
      clearTimeout(timeout);
    };
  }, [value]);

  const options = useMemo(() => sortFontsForSlot(fonts, slot), [fonts, slot]);
  const visible = useMemo(() => filterFonts(options, query), [options, query]);
  const bundledNames = useMemo(
    () => new Set(BUNDLED_FONTS.map((font) => font.name.toLowerCase())),
    []
  );

  const place = useCallback(() => {
    setPosition(measurePanel(anchorRef.current, panelRef.current));
  }, []);

  // 开面板：先量再画（useLayoutEffect 在浏览器绘制前跑），避免先闪一帧在旧位置上
  useLayoutEffect(() => {
    if (!open) return;
    place();
    searchRef.current?.focus();
  }, [open, place]);

  // 面板是 fixed 的，滚动 / 缩放不会自动跟着走：开着的这阵子逐帧重算
  //（capture 为 true：滚动发生在本页的内层滚动容器里，不冒泡到 window）
  useEffect(() => {
    if (!open) return;
    const options = { capture: true } as const;
    window.addEventListener("scroll", place, options);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, options);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // 点面板与按钮之外的地方关掉（pointerdown 而非 click：点另一行的按钮时
  // 先关本面板、再让那一行开，不会出现两个面板叠在一起）
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    anchorRef.current?.focus();
  }, []);

  const handleSelect = (name: string) => {
    onSelect(name);
    close();
  };

  return (
    <div className="settings-view__row">
      <span className="settings-view__label">{label}</span>
      <div
        className="font-picker"
        ref={rowRef}
        // Esc 只关面板、不退设置视图：设置视图的 Esc 监听挂在 window 上，
        // 而这里在冒泡链更早的一层拦下（面板与按钮都在本节点内）
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            event.preventDefault();
            close();
          }
        }}
      >
        <button
          type="button"
          ref={anchorRef}
          className={
            "font-picker__value" +
            (value ? "" : " font-picker__value--default") +
            (pending ? " font-picker__value--pending" : "")
          }
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${label}（当前：${value || defaultLabel}）`}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {value || defaultLabel}
        </button>
        {open && (
          <div
            className="font-picker__panel"
            ref={panelRef}
            role="listbox"
            aria-label={`${label}候选表`}
            style={{
              left: position?.left,
              top: position?.top,
              bottom: position?.bottom,
            }}
          >
            <input
              ref={searchRef}
              className="font-picker__search"
              type="search"
              value={query}
              placeholder="搜索字体…"
              aria-label={`搜索${label}`}
              onChange={(event) => setQuery(event.target.value)}
            />
            <ul className="font-picker__list">
              {/* 「默认」永远排第一：它是回退出厂字面的那条路 */}
              {(query === "" || defaultLabel.includes(query)) && (
                <li>
                  <button
                    type="button"
                    className="font-picker__option"
                    role="option"
                    aria-selected={value === ""}
                    onClick={() => handleSelect("")}
                  >
                    <span className="font-picker__option-name">{defaultLabel}</span>
                    <span className="font-picker__option-tag">默认</span>
                  </button>
                </li>
              )}
              {visible.map((font) => (
                <li key={font.name}>
                  <button
                    type="button"
                    className="font-picker__option"
                    role="option"
                    aria-selected={font.name === value}
                    onClick={() => handleSelect(font.name)}
                  >
                    {/* 用它自己的字面渲染：CJK 与否一眼可辨（滚到才整形，渐进预览） */}
                    <FontOptionName name={font.name} />
                    <span className="font-picker__option-tag">
                      {bundledNames.has(font.name.toLowerCase())
                        ? "随包"
                        : font.mono
                          ? "等宽"
                          : font.cjk
                            ? "中文"
                            : "西文"}
                    </span>
                  </button>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="font-picker__empty">没有匹配「{query}」的字体</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

type SettingsViewProps = {
  settings: ReaderSettings;
  onSettingsChange: (patch: Partial<ReaderSettings>) => void;
  preferences: AppPreferences;
  onPreferencesChange: (patch: Partial<AppPreferences>) => void;
  /// 当前文档的完整路径（无文档时 null ⇒ 显示「未打开文件」）
  currentDocumentPath: string | null;
  recentCount: number;
  onClearRecent: () => void;
  onExit: () => void;
};

/**
 * 设置视图：整块替换正文区（顶栏与侧栏容器不变，侧栏内容换成 SettingsNav）。
 * Esc 或「‹ 返回阅读」退出；改动即存（阅读三件套走 useReaderSettings，行为偏好走
 * useAppPreferences，两者机制都不动，这里只换 UI 入口）。
 */
export function SettingsView({
  settings,
  onSettingsChange,
  preferences,
  onPreferencesChange,
  currentDocumentPath,
  recentCount,
  onClearRecent,
  onExit,
}: SettingsViewProps) {
  const [version, setVersion] = useState<string | null>(null);
  /// 字体候选表：先给随包两款（开关即能用），系统字体拉到后整体换上；
  /// 拉失败也就是保持随包那两份（loadSystemFonts 已兜底），不报错
  const [fonts, setFonts] = useState<readonly SystemFont[]>(BUNDLED_FONTS);

  useEffect(() => {
    let cancelled = false;
    void loadSystemFonts().then((list) => {
      if (!cancelled) setFonts(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 版本取运行时（Tauri 的 app 命令，权限已由 core:default 覆盖）；拿不到就不显示数字
  // （非 Tauri 环境 / 命令不可用），绝不编一个版本号出来
  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((value) => {
        if (!cancelled && typeof value === "string" && value !== "") setVersion(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Esc 退出设置视图（输入框里的 Escape 已在 SettingsNav 里就地消费，冒不到这里）
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  return (
    <div className="settings-view">
      <div className="settings-view__head">
        <button type="button" className="button button-ghost" onClick={onExit}>
          ‹ 返回阅读
        </button>
        <span className="settings-view__note">ESC · 改动即存</span>
      </div>

      <section className="settings-view__section" id={settingsSectionElementId("reading")}>
        <span className="empty-eyebrow settings-view__eyebrow">阅读</span>
        <SegmentRow
          label="正文字号"
          options={READER_FONT_SIZE_OPTIONS}
          value={settings.fontSize}
          format={(value) => `${value}`}
          onSelect={(fontSize) => onSettingsChange({ fontSize })}
        />
        <SegmentRow
          label="栏宽"
          options={READER_COLUMN_WIDTH_OPTIONS}
          value={settings.columnWidth}
          format={(value) => `${value}`}
          onSelect={(columnWidth) => onSettingsChange({ columnWidth })}
        />
        <SegmentRow
          label="行高"
          options={READER_LINE_HEIGHT_OPTIONS}
          value={settings.lineHeight}
          format={formatLineHeight}
          onSelect={(lineHeight) => onSettingsChange({ lineHeight })}
        />
        {/* 字体三槽：中文 / 西文 / 代码各管一槽。候选项来自本机已装字体（Rust
            list_system_fonts）+ 随包两款；换字面同样是「整篇重排」，走的是同一个
            onSettingsChange（App 侧统一先钉视口） */}
        <FontPickerRow
          label="中文字体"
          slot="cjk"
          value={settings.cjkFont}
          defaultLabel="默认 · 倉頡楷體"
          fonts={fonts}
          onSelect={(cjkFont) => onSettingsChange({ cjkFont })}
        />
        <FontPickerRow
          label="西文字体"
          slot="latin"
          value={settings.latinFont}
          defaultLabel="默认 · 跟随中文"
          fonts={fonts}
          onSelect={(latinFont) => onSettingsChange({ latinFont })}
        />
        <FontPickerRow
          label="代码字体"
          slot="mono"
          value={settings.monoFont}
          defaultLabel="默认 · JetBrains Mono"
          fonts={fonts}
          onSelect={(monoFont) => onSettingsChange({ monoFont })}
        />
        {/* 滚轮手势是行为偏好（走 appPreferences），但归「阅读」节——它调的就是上面的字号 */}
        <ToggleRow
          label="Ctrl + 滚轮改字号"
          value={preferences.ctrlWheelFontSize}
          onChange={(ctrlWheelFontSize) => onPreferencesChange({ ctrlWheelFontSize })}
        />
        {/* 样张：弹层退役后「边调边看正文」由它接住——字号 / 栏宽 / 行高实时消费同一组
            CSS 变量（变量挂在 documentElement 上，与正文消费的是同一份） */}
        <div className="settings-view__proof">
          <div className="settings-view__proof-tag">样张</div>
          <p className="settings-view__proof-sheet">
            纸是静的，字是活的。行距松一分，读起来便慢一分；栏宽收一分，目光回行便少迷路一分。界面只是「读」的容器，不该抢走文字的声音。
          </p>
          {/* 三槽各有一样张：汉字看中文槽、这行拉丁文看西文槽、行内 code 看代码槽 */}
          <p className="settings-view__proof-sheet settings-view__proof-latin">
            Paper is quiet, type is alive. 行内 <code>code</code> 看代码槽。
          </p>
        </div>
        <div className="settings-view__row">
          <button
            type="button"
            className="text-button"
            onClick={() => onSettingsChange({ ...READER_SETTINGS_DEFAULT })}
          >
            恢复默认
          </button>
        </div>
      </section>

      <section className="settings-view__section" id={settingsSectionElementId("interface")}>
        <span className="empty-eyebrow settings-view__eyebrow">界面</span>
        <SegmentRow
          label="外观"
          options={THEME_OPTIONS}
          value={preferences.theme}
          format={(theme) => THEME_LABELS[theme]}
          onSelect={(theme) => onPreferencesChange({ theme })}
        />
        <SegmentRow
          label="侧栏题头字形"
          value={preferences.headingScript}
          options={HEADING_SCRIPT_OPTIONS}
          format={(script) => HEADING_SCRIPT_LABELS[script]}
          onSelect={(headingScript) => onPreferencesChange({ headingScript })}
        />
        <ToggleRow
          label="启动时展开侧栏"
          value={preferences.sidebarOpenOnLaunch}
          onChange={(sidebarOpenOnLaunch) => onPreferencesChange({ sidebarOpenOnLaunch })}
        />
      </section>

      <section className="settings-view__section" id={settingsSectionElementId("updates")}>
        <span className="empty-eyebrow settings-view__eyebrow">更新</span>
        <ToggleRow
          label="启动时自动检查更新"
          value={preferences.autoCheckUpdates}
          onChange={(autoCheckUpdates) => onPreferencesChange({ autoCheckUpdates })}
        />
        <div className="settings-view__row">
          <span className="settings-view__label">当前版本</span>
          <span className="settings-view__value">{version ? `v${version}` : "—"}</span>
        </div>
        <div className="settings-view__row">
          <span className="settings-view__label">手动检查</span>
          {/* 手动入口无论「启动时自动检查更新」开关如何都查，结果由 updater 出回执 */}
          <button type="button" className="button button-primary" onClick={() => void checkForUpdates(true)}>
            立即检查
          </button>
        </div>
      </section>

      <section className="settings-view__section" id={settingsSectionElementId("about")}>
        <span className="empty-eyebrow settings-view__eyebrow">关于与数据</span>
        <div className="settings-view__row">
          <span className="settings-view__label">当前文档</span>
          <span className="settings-view__path">{currentDocumentPath ?? "未打开文件"}</span>
        </div>
        <div className="settings-view__row">
          <span className="settings-view__label">最近打开列表</span>
          <button
            type="button"
            className="button button-ghost"
            disabled={recentCount === 0}
            onClick={onClearRecent}
          >
            清除（{recentCount} 条）
          </button>
        </div>
        <div className="settings-view__row settings-view__row--keys">
          <span className="settings-view__label">快捷键</span>
          <div className="settings-view__shortcuts">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.label} className="settings-view__row">
                <span className="settings-view__value">{shortcut.label}</span>
                <span className="settings-view__keys">
                  {shortcut.keys.map((key) => (
                    <kbd key={key} className="outline-search__kbd">
                      {key}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
