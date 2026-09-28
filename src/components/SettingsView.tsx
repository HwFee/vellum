import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
  flatFontOptions,
  loadSystemFonts,
  type FontSlot,
  type SystemFont,
} from "../lib/fonts";
import type { AppPreferences } from "../lib/appPreferences";
import type { ThemePreference } from "../lib/theme";
import type { HeadingScript } from "../lib/headingLabels";
import { checkForUpdates } from "../lib/updater";
import { CodeBlock } from "./CodeBlock";

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

/// 行内单项复位：非默认才露面——默认时 visibility:hidden 占位留着，行不抖。
/// 复位仍走 onSettingsChange 一条路（先钉视口的规矩照用不误）。
function RowReset({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="settings-view__row-reset"
      style={visible ? undefined : { visibility: "hidden" }}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      onClick={onClick}
    >
      恢复默认
    </button>
  );
}

type SegmentRowProps<T extends string | number> = {
  label: string;
  options: readonly T[];
  value: T;
  format: (value: T) => string;
  onSelect: (value: T) => void;
  /// 给了默认值就带行内复位钮；不给就没有
  defaultValue?: T;
};

function SegmentRow<T extends string | number>({ label, options, value, format, onSelect, defaultValue }: SegmentRowProps<T>) {
  return (
    <div className="settings-view__row">
      <span className="settings-view__label">
        {label}
        {defaultValue !== undefined && (
          <RowReset visible={value !== defaultValue} onClick={() => onSelect(defaultValue)} />
        )}
      </span>
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

/// 收起过渡完成后的落位延时（0.16s 动画 + 余量）：落位只做「加 rested 类」——
/// DOM 常驻不卸载，收起全程没有任何布局突跳（末段卡顿的来源就是轨道收完还剩
/// padding 一截，或提前 unmount 把残余高度瞬间抹掉）
const FONT_REGION_SETTLE_MS = 200;

type FontPickerRowProps = {
  label: string;
  /// 当前字面（空串 = 默认，由 CSS 回退承接）
  value: string;
  /// 「默认」那一行的字样（各槽各不相同：中文随包楷体 / 西文跟随中文 / 代码 JetBrains Mono）
  defaultLabel: string;
  fonts: readonly SystemFont[];
  onSelect: (name: string) => void;
  /// 展开态由 SettingsView 持有（三个字体行同时只开一个）
  open: boolean;
  onToggle: (open: boolean) => void;
};

/**
 * 候选项字面的渐进预览：默认用界面字体渲染字片名，滚进视口（含 60px 预载带）才把
 * 字片换上它自己的字面——展开即触发几百款字体的同步整形曾是整帧卡顿的主因。
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
      { root: el.closest(".font-picker__grid-scroll"), rootMargin: "60px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [preview]);

  return (
    <span
      ref={ref}
      className="font-picker__chip-name"
      style={preview ? { fontFamily: `"${name}"` } : undefined}
    >
      {name}
    </span>
  );
}

/**
 * 字体选择器（中文 / 西文 / 代码三槽共用一枚）：行内展开，不浮层。
 * 触发器是与行内控件同节奏的输入框样式；点开在行下就地展开一片候选区
 * （grid-template-rows 0fr→1fr 过渡，不量高、随文下推后续行）。三个字体行的
 * 展开态由 SettingsView 的 openFontSlot 持有——同时只开一个。
 * 候选表 = 本机已装字体 + 随包两款（Rust 的 list_system_fonts，拉一次缓存在 lib/fonts）。
 * 字片字面渐进渲染（见 FontOptionName）——选之前先看得见字形，又不为隐藏项白整形。
 */
function FontPickerRow({
  label,
  value,
  defaultLabel,
  fonts,
  onSelect,
  open,
  onToggle,
}: FontPickerRowProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  /// 展开区三个状态位：opened = DOM 常驻（首开之后不再卸载）；expanded =
  /// grid-template-rows 的目标值（0fr↔1fr 由它驱动）；rested = 收起动画跑完后的
  /// visibility:hidden + inert（内容仍在，只是不可见不占焦点——再开时原样翻出）
  const [opened, setOpened] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [rested, setRested] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const regionId = useId();
  const optionId = (index: number) => `${regionId}-opt-${index}`;

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

  /// 平铺候选表（不分类）：选中项最先，随包紧随，其余按名字——三槽同一张全表
  const flat = useMemo(() => flatFontOptions(fonts, value), [fonts, value]);
  const filtered = useMemo(() => filterFonts(flat, query), [flat, query]);
  const showDefault =
    query === "" || defaultLabel.toLowerCase().includes(query.trim().toLowerCase());
  /// 键盘/悬停共用的可提交项平铺表：默认项第一，之后按平铺序
  const items = useMemo(() => {
    const names: string[] = showDefault ? [""] : [];
    for (const font of filtered) names.push(font.name);
    return names;
  }, [filtered, showDefault]);

  // 展开：先挂 DOM（0fr），下一帧再上 --open，过渡才看得见；焦点交给搜索框
  useLayoutEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setRested(false);
    setOpened(true);
  }, [open]);
  useLayoutEffect(() => {
    if (!opened || !open) return;
    const raf = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(raf);
  }, [opened, open]);
  useEffect(() => {
    if (opened && open) searchRef.current?.focus();
  }, [opened, open]);
  // 收起：类名在动画起点就摘（expanded=false → 0fr 过渡起跑），rested 只在
  // 过渡结束（transitionend 为准，超时兜底）后落位——落位不改任何布局
  useEffect(() => {
    if (open || !opened) return;
    setExpanded(false);
    const timeout = setTimeout(() => setRested(true), FONT_REGION_SETTLE_MS);
    return () => clearTimeout(timeout);
  }, [open, opened]);

  // 点这行之外的地方收起来（pointerdown 而非 click：点另一行的触发器时
  // 先收本区、再让那一行开）。**判定必须同时认展开区**——region 是行节点的
  // 兄弟（Fragment 平铺），只查 rowRef 会把点字片/搜索框误判成「外面」：
  // pointerdown 就收起，到 pointerup 时字片已移位，click 永远落不下去。
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rowRef.current?.contains(target) && !regionRef.current?.contains(target)) {
        onToggle(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open, onToggle]);

  const close = useCallback(
    (refocus: boolean) => {
      onToggle(false);
      if (refocus) triggerRef.current?.focus();
    },
    [onToggle]
  );

  const handleSelect = (name: string) => {
    onSelect(name);
    close(true);
  };

  // Esc 只收本区、不退设置视图：设置视图的 Esc 监听挂在 window 上，
  // 这里在冒泡链更早的一层拦下
  const handleEscape = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      event.preventDefault();
      close(true);
    }
  };

  // 栅格导航：↑↓ 跨行（±3），←→ 同行（±1），Enter 提交高亮项，Esc 收起
  const handleGridKeys = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      handleEscape(event);
      return;
    }
    if (items.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.min(Math.max(index + (event.key === "ArrowDown" ? 3 : -3), 0), items.length - 1)
      );
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.min(Math.max(index + (event.key === "ArrowRight" ? 1 : -1), 0), items.length - 1)
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      handleSelect(items[Math.min(activeIndex, items.length - 1)]);
    }
  };

  // 高亮项滚进可视区
  useEffect(() => {
    if (!expanded) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, expanded]);

  const chip = (name: string, labelText: string, index: number, ownFace: boolean) => (
    <button
      key={name || "default"}
      type="button"
      id={optionId(index)}
      className={"font-picker__chip" + (index === activeIndex ? " font-picker__chip--active" : "")}
      role="option"
      aria-selected={name === value}
      tabIndex={-1}
      onMouseEnter={() => setActiveIndex(index)}
      onClick={() => handleSelect(name)}
    >
      {ownFace && name ? (
        <FontOptionName name={name} />
      ) : (
        <span className="font-picker__chip-name">{labelText}</span>
      )}
    </button>
  );

  return (
    <>
      <div className="settings-view__row" ref={rowRef}>
        <span className="settings-view__label">
          {label}
          <RowReset visible={value !== ""} onClick={() => handleSelect("")} />
        </span>
        <button
          type="button"
          ref={triggerRef}
          className={
            "font-picker__trigger" +
            (value ? "" : " font-picker__trigger--default") +
            (pending ? " font-picker__trigger--pending" : "")
          }
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={regionId}
          aria-label={`${label}（当前：${value || defaultLabel}）`}
          onClick={() => (open ? close(true) : onToggle(true))}
          onKeyDown={handleEscape}
        >
          {/* 触发器上的名字用当前字面自体渲染——选的就是它长什么样 */}
          <span
            className="font-picker__trigger-name"
            style={value ? { fontFamily: `"${value}"` } : undefined}
          >
            {value || defaultLabel}
          </span>
          <svg
            className="font-picker__chevron"
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M1.5 3l3 3 3-3" />
          </svg>
        </button>
      </div>
      {opened && (
        <div
          id={regionId}
          ref={regionRef}
          className={
            "font-picker__region" +
            (expanded ? " font-picker__region--open" : "") +
            (rested ? " font-picker__region--rested" : "")
          }
          inert={rested}
          onTransitionEnd={(event) => {
            // 以过渡完成为准落 rested；0fr 轨道已到底，落位不产生任何布局变化
            if (event.propertyName === "grid-template-rows" && !open) setRested(true);
          }}
        >
          <div className="font-picker__region-inner" onKeyDown={handleGridKeys}>
            <div className="font-picker__region-pad">
              <input
                ref={searchRef}
                className="font-picker__search"
                type="search"
                value={query}
                placeholder="搜索字体…"
                aria-label={`搜索${label}`}
                role="combobox"
                aria-expanded={expanded}
                aria-controls={`${regionId}-list`}
                aria-activedescendant={items.length > 0 ? optionId(activeIndex) : undefined}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(0);
                }}
              />
              <div
                className="font-picker__grid-scroll"
                id={`${regionId}-list`}
                role="listbox"
                aria-label={`${label}候选表`}
              >
                <div className="font-picker__grid">
                  {showDefault && chip("", defaultLabel, 0, false)}
                  {filtered.map((font, i) =>
                    chip(font.name, font.name, (showDefault ? 1 : 0) + i, true)
                  )}
                </div>
                {items.length === 0 && (
                  <div className="font-picker__empty">没有匹配「{query}」的字体</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type SettingsViewProps = {
  settings: ReaderSettings;
  onSettingsChange: (patch: Partial<ReaderSettings>) => void;
  preferences: AppPreferences;
  onPreferencesChange: (patch: Partial<AppPreferences>) => void;
  /// 当前文档的完整路径（无文档时 null ⇒ 显示「未打开文件」）
  currentDocumentPath: string | null;
  /// 当前是否库模式：单文件模式没有全库检索，快捷键一览隐去那一行
  isLibraryMode?: boolean;
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
  isLibraryMode = false,
  recentCount,
  onClearRecent,
  onExit,
}: SettingsViewProps) {
  const [version, setVersion] = useState<string | null>(null);
  /// 字体候选表：先给随包两款（开关即能用），系统字体拉到后整体换上；
  /// 拉失败也就是保持随包那两份（loadSystemFonts 已兜底），不报错
  const [fonts, setFonts] = useState<readonly SystemFont[]>(BUNDLED_FONTS);
  /// 字体三槽的展开区同时只开一个：记展开中的槽位（null = 全收）
  const [openFontSlot, setOpenFontSlot] = useState<FontSlot | null>(null);

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
          defaultValue={READER_SETTINGS_DEFAULT.fontSize}
        />
        <SegmentRow
          label="栏宽"
          options={READER_COLUMN_WIDTH_OPTIONS}
          value={settings.columnWidth}
          format={(value) => `${value}`}
          onSelect={(columnWidth) => onSettingsChange({ columnWidth })}
          defaultValue={READER_SETTINGS_DEFAULT.columnWidth}
        />
        <SegmentRow
          label="行高"
          options={READER_LINE_HEIGHT_OPTIONS}
          value={settings.lineHeight}
          format={formatLineHeight}
          onSelect={(lineHeight) => onSettingsChange({ lineHeight })}
          defaultValue={READER_SETTINGS_DEFAULT.lineHeight}
        />
        {/* 样张：弹层退役后「边调边看正文」由它接住——字号 / 栏宽 / 行高 / 三槽字面
            实时消费同一组 CSS 变量（变量挂在 documentElement 上，与正文同一份）。
            三行各看一槽：中文段看中文槽、英文行看西文槽、代码块看代码槽 */}
        <div className="settings-view__proof">
          <div className="settings-view__proof-tag">样张</div>
          <p className="settings-view__proof-sheet">
            纸是静的，字是活的。行距松一分，读起来便慢一分；栏宽收一分，目光回行便少迷路一分。界面只是「读」的容器，不该抢走文字的声音。
          </p>
          <p className="settings-view__proof-sheet settings-view__proof-latin">
            Paper is quiet, type is alive. The quick brown fox jumps over the lazy dog 0123456789.
          </p>
          {/* 代码样字用与正文同一个 CodeBlock（同一套 kami 高亮与复制钮），
              外层挂 markdown-body 让其继承正文语境，proof-block 收口外边距 */}
          <div className="settings-view__proof-block markdown-body">
            <CodeBlock code={'print("素笺 · Vellum 0O1lI {}[]")'} language="python" />
          </div>
        </div>
        {/* 字体三槽：中文 / 西文 / 代码各管一槽。候选项来自本机已装字体（Rust
            list_system_fonts）+ 随包两款；换字面同样是「整篇重排」，走的是同一个
            onSettingsChange（App 侧统一先钉视口）。行内展开的候选区同时只开一个
            ——openFontSlot 记哪一槽正开着（null = 全收） */}
        <FontPickerRow
          label="中文字体"
          value={settings.cjkFont}
          defaultLabel="默认 · 倉頡楷體"
          fonts={fonts}
          onSelect={(cjkFont) => onSettingsChange({ cjkFont })}
          open={openFontSlot === "cjk"}
          onToggle={(next) => setOpenFontSlot(next ? "cjk" : null)}
        />
        <FontPickerRow
          label="西文字体"
          value={settings.latinFont}
          defaultLabel="默认 · 跟随中文"
          fonts={fonts}
          onSelect={(latinFont) => onSettingsChange({ latinFont })}
          open={openFontSlot === "latin"}
          onToggle={(next) => setOpenFontSlot(next ? "latin" : null)}
        />
        <FontPickerRow
          label="代码字体"
          value={settings.monoFont}
          defaultLabel="默认 · JetBrains Mono"
          fonts={fonts}
          onSelect={(monoFont) => onSettingsChange({ monoFont })}
          open={openFontSlot === "mono"}
          onToggle={(next) => setOpenFontSlot(next ? "mono" : null)}
        />
        {/* 滚轮手势是行为偏好（走 appPreferences），但归「阅读」节——它调的就是上面的字号 */}
        <ToggleRow
          label="Ctrl + 滚轮改字号"
          value={preferences.ctrlWheelFontSize}
          onChange={(ctrlWheelFontSize) => onPreferencesChange({ ctrlWheelFontSize })}
        />
        <div className="settings-view__row">
          <button
            type="button"
            className="text-button"
            onClick={() => onSettingsChange({ ...READER_SETTINGS_DEFAULT })}
          >
            全部恢复默认
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
            {SHORTCUTS.filter(
              (shortcut) => isLibraryMode || shortcut.label !== "全库检索"
            ).map((shortcut) => (
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
