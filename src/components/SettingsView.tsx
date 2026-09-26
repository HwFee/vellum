import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  READER_COLUMN_WIDTH_OPTIONS,
  READER_FONT_SIZE_OPTIONS,
  READER_LINE_HEIGHT_OPTIONS,
  READER_SETTINGS_DEFAULT,
  type ReaderSettings,
} from "../hooks/useReaderSettings";
import type { AppPreferences } from "../lib/appPreferences";
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

/// 快捷键一览（只读陈列）：与 App 的全局快捷键处理器一一对应
const SHORTCUTS = [
  { label: "切换大纲", keys: ["CTRL", "B"] },
  { label: "聚焦搜索", keys: ["CTRL", "K / F"] },
  { label: "打开文件", keys: ["CTRL", "O"] },
  { label: "就地编辑", keys: ["CTRL", "E"] },
  { label: "提交保存", keys: ["CTRL", "S"] },
  { label: "导出为 PDF", keys: ["CTRL", "P"] },
  { label: "字号 大·小·复位", keys: ["CTRL", "+", "−", "0"] },
  { label: "下一处·上一处匹配", keys: ["F3", "SHIFT F3"] },
  { label: "后退·前进", keys: ["ALT", "←", "→"] },
  { label: "专注模式", keys: ["F11"] },
] as const;

type SegmentRowProps = {
  label: string;
  options: readonly number[];
  value: number;
  format: (value: number) => string;
  onSelect: (value: number) => void;
};

function SegmentRow({ label, options, value, format, onSelect }: SegmentRowProps) {
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
        {/* 样张：弹层退役后「边调边看正文」由它接住——字号 / 栏宽 / 行高实时消费同一组
            CSS 变量（变量挂在 documentElement 上，与正文消费的是同一份） */}
        <div className="settings-view__proof">
          <div className="settings-view__proof-tag">样张</div>
          <p className="settings-view__proof-sheet">
            纸是静的，字是活的。行距松一分，读起来便慢一分；栏宽收一分，目光回行便少迷路一分。界面只是「读」的容器，不该抢走文字的声音。
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
