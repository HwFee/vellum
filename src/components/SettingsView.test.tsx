import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { getVersion } from "@tauri-apps/api/app";
import { SettingsView, settingsSectionElementId } from "./SettingsView";
import { READER_SETTINGS_DEFAULT, type ReaderSettings } from "../hooks/useReaderSettings";
import { APP_PREFERENCES_DEFAULT, type AppPreferences } from "../lib/appPreferences";
import { checkForUpdates } from "../lib/updater";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("1.8.1")),
}));

vi.mock("../lib/updater", () => ({
  checkForUpdates: vi.fn(() => Promise.resolve()),
}));

type SetupOptions = {
  settings?: ReaderSettings;
  preferences?: AppPreferences;
  currentDocumentPath?: string | null;
  recentCount?: number;
};

async function setup(options: SetupOptions = {}) {
  const onSettingsChange = vi.fn();
  const onPreferencesChange = vi.fn();
  const onClearRecent = vi.fn();
  const onExit = vi.fn();
  const view = render(
    <SettingsView
      settings={options.settings ?? READER_SETTINGS_DEFAULT}
      onSettingsChange={onSettingsChange}
      preferences={options.preferences ?? APP_PREFERENCES_DEFAULT}
      onPreferencesChange={onPreferencesChange}
      currentDocumentPath={options.currentDocumentPath ?? null}
      recentCount={options.recentCount ?? 0}
      onClearRecent={onClearRecent}
      onExit={onExit}
    />
  );
  // 版本号是挂载后异步取回的：在这里等它落地，免得用例结束后才 setState（React 会告警）
  await act(async () => {});
  return { onSettingsChange, onPreferencesChange, onClearRecent, onExit, view };
}

beforeEach(() => {
  vi.mocked(getVersion).mockClear();
  vi.mocked(getVersion).mockResolvedValue("1.8.1");
  vi.mocked(checkForUpdates).mockClear();
});

describe("SettingsView", () => {
  it("渲染四个分节，分节元素 id 与侧栏导航同源", async () => {
    await setup();

    for (const label of ["阅读", "界面", "更新", "关于与数据"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const id of ["reading", "interface", "updates", "about"] as const) {
      expect(document.getElementById(settingsSectionElementId(id))).toBeInTheDocument();
    }
  });

  it("顶行是「‹ 返回阅读」幽灵按钮与「ESC · 改动即存」说明", async () => {
    const { onExit } = await setup();

    expect(screen.getByText("ESC · 改动即存")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "‹ 返回阅读" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("Escape 退出设置视图", async () => {
    const { onExit } = await setup();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("阅读三件套：分段选择器标出当前值，点击回写对应字段", async () => {
    const { onSettingsChange } = await setup();

    for (const label of ["正文字号", "栏宽", "行高"]) {
      expect(screen.getByRole("group", { name: label })).toBeInTheDocument();
    }
    // 默认值高亮：14 / 800 / 1.55
    expect(screen.getByRole("button", { name: "14" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "800" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1.55" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "16" }));
    expect(onSettingsChange).toHaveBeenCalledWith({ fontSize: 16 });

    fireEvent.click(screen.getByRole("button", { name: "960" }));
    expect(onSettingsChange).toHaveBeenCalledWith({ columnWidth: 960 });

    fireEvent.click(screen.getByRole("button", { name: "1.7" }));
    expect(onSettingsChange).toHaveBeenCalledWith({ lineHeight: 1.7 });
  });

  it("样张消费同一组 CSS 变量，恢复默认回写整套默认值", async () => {
    const { onSettingsChange } = await setup({ settings: { fontSize: 18, columnWidth: 960, lineHeight: 1.7 } });

    expect(screen.getByText("样张")).toBeInTheDocument();
    expect(document.querySelector(".settings-view__proof-sheet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    expect(onSettingsChange).toHaveBeenCalledWith(READER_SETTINGS_DEFAULT);
  });

  it("界面与更新两态开关：开 / 关回写布尔偏好，出厂值分别是关与开", async () => {
    const { onPreferencesChange } = await setup();

    const sidebar = screen.getByRole("group", { name: "启动时展开侧栏" });
    expect(sidebar).toHaveTextContent("开关");
    const sidebarOff = within(sidebar).getByRole("button", { name: "关" });
    expect(sidebarOff).toHaveAttribute("aria-pressed", "true");
    // 出厂关（维持 1.8.1 现状，2026-09-20 起变为可调）
    expect(within(sidebar).getByRole("button", { name: "开" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    fireEvent.click(within(sidebar).getByRole("button", { name: "开" }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ sidebarOpenOnLaunch: true });

    const autoCheck = screen.getByRole("group", { name: "启动时自动检查更新" });
    // 出厂开
    expect(within(autoCheck).getByRole("button", { name: "开" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    fireEvent.click(within(autoCheck).getByRole("button", { name: "关" }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ autoCheckUpdates: false });
  });

  it("当前版本取运行时版本号；「立即检查」调 updater（无论自动开关如何）", async () => {
    await setup({ preferences: { ...APP_PREFERENCES_DEFAULT, autoCheckUpdates: false } });

    expect(await screen.findByText("v1.8.1")).toBeInTheDocument();
    expect(getVersion).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "立即检查" }));
    expect(checkForUpdates).toHaveBeenCalledWith(true);
  });

  it("拿不到运行时版本时不编版本号（显示占位）", async () => {
    vi.mocked(getVersion).mockRejectedValue(new Error("not tauri"));

    await setup();
    await waitFor(() => expect(getVersion).toHaveBeenCalled());
    expect(screen.queryByText(/^v\d/)).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("当前文档显示完整路径，无文档时显示「未打开文件」", async () => {
    const { view } = await setup({ currentDocumentPath: "C:/notes/readme.md" });
    expect(screen.getByText("C:/notes/readme.md")).toBeInTheDocument();

    view.rerender(
      <SettingsView
        settings={READER_SETTINGS_DEFAULT}
        onSettingsChange={vi.fn()}
        preferences={APP_PREFERENCES_DEFAULT}
        onPreferencesChange={vi.fn()}
        currentDocumentPath={null}
        recentCount={0}
        onClearRecent={vi.fn()}
        onExit={vi.fn()}
      />
    );
    expect(screen.getByText("未打开文件")).toBeInTheDocument();
  });

  it("清除最近打开列表：按钮带条数，0 条时禁用，有条数时触发回调", async () => {
    const { onClearRecent, view } = await setup({ recentCount: 0 });
    const disabled = screen.getByRole("button", { name: "清除（0 条）" });
    expect(disabled).toBeDisabled();
    fireEvent.click(disabled);
    expect(onClearRecent).not.toHaveBeenCalled();

    view.rerender(
      <SettingsView
        settings={READER_SETTINGS_DEFAULT}
        onSettingsChange={vi.fn()}
        preferences={APP_PREFERENCES_DEFAULT}
        onPreferencesChange={vi.fn()}
        currentDocumentPath={null}
        recentCount={3}
        onClearRecent={onClearRecent}
        onExit={vi.fn()}
      />
    );
    const clear = screen.getByRole("button", { name: "清除（3 条）" });
    expect(clear).not.toBeDisabled();
    fireEvent.click(clear);
    expect(onClearRecent).toHaveBeenCalledTimes(1);
  });

  it("快捷键一览：十一行只读陈列，kbd 复用大纲搜索框的样式类", async () => {
    await setup();

    const rows: Array<[string, string[]]> = [
      ["切换大纲", ["CTRL", "B"]],
      ["聚焦搜索", ["CTRL", "K / F"]],
      ["全库检索", ["CTRL", "SHIFT", "F"]],
      ["打开文件", ["CTRL", "O"]],
      ["就地编辑", ["CTRL", "E"]],
      ["提交保存", ["CTRL", "S"]],
      ["导出为 PDF", ["CTRL", "P"]],
      ["字号 大·小·复位", ["CTRL", "+", "−", "0"]],
      ["下一处·上一处匹配", ["F3", "SHIFT F3"]],
      ["后退·前进", ["ALT", "←", "→"]],
      ["专注模式", ["F11"]],
    ];
    for (const [label, keys] of rows) {
      const row = screen.getByText(label).closest(".settings-view__row")!;
      expect(row).toBeInTheDocument();
      for (const key of keys) {
        const kbd = Array.from(row.querySelectorAll("kbd")).find((el) => el.textContent === key);
        expect(kbd, `${label} 缺 ${key}`).toBeInTheDocument();
        expect(kbd).toHaveClass("outline-search__kbd");
      }
    }
  });
});
