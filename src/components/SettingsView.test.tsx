import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { SettingsView, settingsSectionElementId } from "./SettingsView";
import { READER_SETTINGS_DEFAULT, type ReaderSettings } from "../hooks/useReaderSettings";
import { APP_PREFERENCES_DEFAULT, type AppPreferences } from "../lib/appPreferences";
import { checkForUpdates } from "../lib/updater";
import { __resetSystemFontsForTest } from "../lib/fonts";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("1.8.1")),
}));

/// 本机字体表是本命令给的：用例里固定三款（中文 / 西文 / 等宽各一），
/// 免得断言跟着真机装了什么字体跑
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() =>
    Promise.resolve([
      { name: "SimSun", cjk: true, mono: false },
      { name: "Georgia", cjk: false, mono: false },
      { name: "Consolas", cjk: false, mono: true },
    ])
  ),
}));

vi.mock("../lib/updater", () => ({
  checkForUpdates: vi.fn(() => Promise.resolve()),
}));

type SetupOptions = {
  settings?: ReaderSettings;
  preferences?: AppPreferences;
  currentDocumentPath?: string | null;
  /// 默认 true：既有用例都站在库模式一侧（快捷键一览的「全库检索」行预设可见）
  isLibraryMode?: boolean;
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
      isLibraryMode={options.isLibraryMode ?? true}
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
  // 字体表是模块级缓存的：每个用例都从随包两款重启，断言才不互相串
  __resetSystemFontsForTest();
  vi.mocked(invoke).mockClear();
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

  it("样张排在字体行之前、三槽各有一行样字（中文段 / 英文行 / 代码块），全部恢复默认回写整套默认值", async () => {
    const { onSettingsChange } = await setup({
      settings: { ...READER_SETTINGS_DEFAULT, fontSize: 18, columnWidth: 960, lineHeight: 1.7 },
    });

    const proof = document.querySelector(".settings-view__proof")!;
    expect(proof).toBeInTheDocument();
    // 行序：样张在中文字体行之前（三槽字面在样张上先看得见）
    const cjkRow = screen.getByRole("button", { name: /中文字体（当前/ }).closest(".settings-view__row")!;
    expect(proof.compareDocumentPosition(cjkRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(proof as HTMLElement).getByText(/quick brown fox/)).toBeInTheDocument();
    // 代码样张 = 正文同一个 CodeBlock（含复制钮与语言标）
    const block = proof.querySelector(".settings-view__proof-block .code-block");
    expect(block).toHaveTextContent('print("素笺 · Vellum 0O1lI {}[]")');
    expect(within(block as HTMLElement).getByRole("button", { name: "复制" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "全部恢复默认" }));
    expect(onSettingsChange).toHaveBeenCalledWith(READER_SETTINGS_DEFAULT);
  });

  it("行内复位：非默认的行露「恢复默认」小钮（默认行占位隐藏），点击只复位该行字段", async () => {
    const { onSettingsChange } = await setup({
      settings: { ...READER_SETTINGS_DEFAULT, fontSize: 18, cjkFont: "SimSun" },
    });

    // 改了 fontSize 与 cjkFont：这两行露钮；栏宽/行高是默认值，钮在但不露面
    const fontSizeRow = screen.getByRole("group", { name: "正文字号" }).closest(".settings-view__row")!;
    const resets = [...document.querySelectorAll(".settings-view__row-reset")];
    const [fsReset, cwReset] = resets;
    expect(fsReset).not.toHaveStyle({ visibility: "hidden" });
    expect(cwReset).toHaveStyle({ visibility: "hidden" });

    fireEvent.click(within(fontSizeRow as HTMLElement).getByRole("button", { name: "恢复默认" }));
    expect(onSettingsChange).toHaveBeenCalledWith({ fontSize: READER_SETTINGS_DEFAULT.fontSize });

    // 字体行的复位回写空串（默认 = 不覆写变量）
    const cjkRow = screen.getByRole("button", { name: /中文字体（当前：SimSun/ }).closest(".settings-view__row")!;
    fireEvent.click(within(cjkRow as HTMLElement).getByRole("button", { name: "恢复默认" }));
    expect(onSettingsChange).toHaveBeenCalledWith({ cjkFont: "" });
  });

  it("「外观」分段选择器：三档陈列，出厂高亮「跟随系统」，点击回写 theme", async () => {
    const { onPreferencesChange } = await setup();

    const appearance = screen.getByRole("group", { name: "外观" });
    expect(
      within(appearance).getByRole("button", { name: "跟随系统" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(within(appearance).getByRole("button", { name: "浅色" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    fireEvent.click(within(appearance).getByRole("button", { name: "深色" }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("「侧栏题头字形」分段器：出厂繁体，点「简体」回写 headingScript", async () => {
    const { onPreferencesChange } = await setup();

    const row = screen.getByRole("group", { name: "侧栏题头字形" });
    expect(within(row).getByRole("button", { name: "繁体" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(row).getByRole("button", { name: "简体" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    fireEvent.click(within(row).getByRole("button", { name: "简体" }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ headingScript: "simplified" });
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
    await setup({ isLibraryMode: true });

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

  it("单文件模式隐去「全库检索」行（那个快捷键在非库模式吞键不动作）", async () => {
    await setup({ isLibraryMode: false });

    expect(screen.queryByText("全库检索")).toBeNull();
    // 其余快捷键照旧
    expect(screen.getByText("聚焦搜索")).toBeInTheDocument();
    expect(screen.getByText("切换大纲")).toBeInTheDocument();
  });

  it("字体三槽各一行，出厂都显示「默认」字样（中文随包楷体 / 西文跟随中文 / 代码 JetBrains Mono）", async () => {
    await setup();

    expect(screen.getByText("中文字体")).toBeInTheDocument();
    expect(screen.getByText("西文字体")).toBeInTheDocument();
    expect(screen.getByText("代码字体")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /中文字体（当前：默认 · 倉頡楷體）/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /西文字体（当前：默认 · 跟随中文）/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /代码字体（当前：默认 · JetBrains Mono）/ })).toBeInTheDocument();
  });

  it("候选项渐进预览：滚进视口才换自己的字面，滚出后不再摘下", async () => {
    // 接管 IntersectionObserver：记下每次 observe 的目标与回调，手动「滚进视口」
    const registry: Array<{ el: Element; cb: IntersectionObserverCallback }> = [];
    const RealIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      private cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback, _init?: IntersectionObserverInit) {
        this.cb = cb;
      }
      observe(el: Element) {
        registry.push({ el, cb: this.cb });
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;

    try {
      await setup();
      fireEvent.click(screen.getByRole("button", { name: /中文字体（当前/ }));
      const region = await screen.findByRole("listbox", { name: "中文字体候选表" });
      await waitFor(() => expect(within(region).getByText("SimSun")).toBeInTheDocument());

      // 候选项此刻仍用界面字体渲染——展开不再让几百款字体同步整形
      const names = [...region.querySelectorAll<HTMLElement>(".font-picker__chip-name")];
      const optionNames = names.filter((el) => !el.textContent?.startsWith("默认"));
      expect(optionNames.length).toBeGreaterThan(0);
      for (const el of optionNames) expect(el.style.fontFamily).toBe("");

      // 「滚进视口」SimSun → 该字片换上自己的字面
      const target = registry.find((entry) => entry.el.textContent === "SimSun");
      expect(target).toBeTruthy();
      act(() => {
        target!.cb(
          [{ isIntersecting: true, target: target!.el } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      });
      const simsunName = optionNames.find((el) => el.textContent === "SimSun")!;
      expect(simsunName.style.fontFamily).toBe('"SimSun"');

      // 未相交的行照旧是界面字体
      for (const el of optionNames.filter((e) => e !== simsunName)) {
        expect(el.style.fontFamily).toBe("");
      }

      // 「滚出视口」再相交一次负例：字面一旦应用就不再摘下
      act(() => {
        target!.cb(
          [{ isIntersecting: false, target: target!.el } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      });
      expect(simsunName.style.fontFamily).toBe('"SimSun"');
    } finally {
      globalThis.IntersectionObserver = RealIO;
    }
  });

  it("点开中文字体：就地展开候选区（平铺三列字片，无分组眉题），选中即回写 cjkFont 并收起", async () => {
    const { onSettingsChange } = await setup();

    const trigger = screen.getByRole("button", { name: /中文字体（当前/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // 展开区不在浮层里：它就是行与行之间的文档流节点
    const region = document.querySelector(".font-picker__region")!;
    expect(region).toBeInTheDocument();
    expect(region.parentElement).toHaveClass("settings-view__section");
    const listbox = await screen.findByRole("listbox", { name: "中文字体候选表" });

    await waitFor(() => expect(within(listbox).getByText("SimSun")).toBeInTheDocument());
    expect(within(listbox).getByText("TsangerJinKai02")).toBeInTheDocument();
    expect(within(listbox).getByText("默认 · 倉頡楷體")).toBeInTheDocument();
    // 平铺无分组：眉题一个都不该在；默认 → 随包两款 → 其余按名字
    expect(listbox.querySelector(".font-picker__group")).toBeNull();
    const chips = [...listbox.querySelectorAll(".font-picker__chip")].map(
      (el) => el.textContent
    );
    expect(chips).toEqual([
      "默认 · 倉頡楷體",
      "TsangerJinKai02",
      "JetBrains Mono",
      "Consolas",
      "Georgia",
      "SimSun",
    ]);

    fireEvent.click(within(listbox).getByText("SimSun"));
    expect(onSettingsChange).toHaveBeenCalledWith({ cjkFont: "SimSun" });
    // 选完收起：触发器回到未展开；区域 DOM 常驻（过渡收尾后落 rested 隐藏态，
    // 不卸载——末段动画不能靠 unmount 收，否则残余高度瞬跳）
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() =>
      expect(document.querySelector(".font-picker__region--rested")).toBeInTheDocument()
    );
  });

  it("选中项紧跟「默认」之后（随包两款再后，其余按名字）；默认态无选中则不占首条之外的位置", async () => {
    await setup({ settings: { ...READER_SETTINGS_DEFAULT, latinFont: "Georgia" } });
    fireEvent.click(screen.getByRole("button", { name: /西文字体（当前/ }));
    const listbox = await screen.findByRole("listbox", { name: "西文字体候选表" });
    await waitFor(() => expect(within(listbox).getByText("Georgia")).toBeInTheDocument());
    const chips = [...listbox.querySelectorAll(".font-picker__chip")].map(
      (el) => el.textContent
    );
    expect(chips).toEqual([
      "默认 · 跟随中文",
      "Georgia",
      "TsangerJinKai02",
      "JetBrains Mono",
      "Consolas",
      "SimSun",
    ]);
  });

  it("点字片先 pointerdown 也不被误判成「点外面」——点击照常提交（展开区是行的兄弟节点）", async () => {
    const { onSettingsChange } = await setup();
    const trigger = screen.getByRole("button", { name: /中文字体（当前/ });
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox", { name: "中文字体候选表" });
    await waitFor(() => expect(within(listbox).getByText("SimSun")).toBeInTheDocument());

    // 真实按下-抬起序列：pointerdown 落在字片上不许先收区
    const chip = within(listbox).getByText("SimSun").closest("button")!;
    fireEvent.pointerDown(chip);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(chip);
    expect(onSettingsChange).toHaveBeenCalledWith({ cjkFont: "SimSun" });
  });

  it("pointerdown 落在搜索框不收起；落在行与区之外才收起", async () => {
    await setup();
    const trigger = screen.getByRole("button", { name: /中文字体（当前/ });
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox", { name: "中文字体候选表" });
    const search = within(listbox.parentElement!).getByRole("combobox", { name: "搜索中文字体" });

    fireEvent.pointerDown(search);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() =>
      expect(document.querySelector(".font-picker__region--rested")).toBeInTheDocument()
    );
  });

  it("字体行同时只开一个：开中文再开西文，中文那区收起来", async () => {
    await setup();

    const cjkTrigger = screen.getByRole("button", { name: /中文字体（当前/ });
    fireEvent.click(cjkTrigger);
    expect(await screen.findByRole("listbox", { name: "中文字体候选表" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /西文字体（当前/ }));
    expect(cjkTrigger).toHaveAttribute("aria-expanded", "false");
    expect(await screen.findByRole("listbox", { name: "西文字体候选表" })).toBeInTheDocument();
    // 收起区常驻但落 rested 隐藏态
    await waitFor(() =>
      expect(
        document.querySelector('.font-picker__region--rested')
      ).toBeInTheDocument()
    );
  });

  it("搜索框过滤候选字片；无匹配时给空态文案；选「默认」回写空串", async () => {
    const { onSettingsChange } = await setup({
      settings: { ...READER_SETTINGS_DEFAULT, latinFont: "Georgia" },
    });

    fireEvent.click(screen.getByRole("button", { name: /西文字体（当前：Georgia）/ }));
    const listbox = await screen.findByRole("listbox", { name: "西文字体候选表" });
    await waitFor(() => expect(within(listbox).getByText("SimSun")).toBeInTheDocument());

    const search = within(listbox.parentElement!).getByRole("combobox", { name: "搜索西文字体" });
    fireEvent.change(search, { target: { value: "cons" } });
    expect(within(listbox).queryByText("SimSun")).toBeNull();
    expect(within(listbox).getByText("Consolas")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "不存在" } });
    expect(within(listbox).getByText("没有匹配「不存在」的字体")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.click(within(listbox).getByText("默认 · 跟随中文"));
    expect(onSettingsChange).toHaveBeenCalledWith({ latinFont: "" });
  });

  it("方向键在栅格上走高亮（↑↓ 跨行 ±3、←→ 同行 ±1），Enter 提交并收起", async () => {
    const { onSettingsChange } = await setup();

    fireEvent.click(screen.getByRole("button", { name: /中文字体（当前/ }));
    const listbox = await screen.findByRole("listbox", { name: "中文字体候选表" });
    await waitFor(() => expect(within(listbox).getByText("SimSun")).toBeInTheDocument());
    const search = within(listbox.parentElement!).getByRole("combobox", { name: "搜索中文字体" });

    // 平铺表：默认(0) → 随包(TsangerJinKai02=1, JetBrains Mono=2) →
    // 按名：Consolas=3 → Georgia=4 → SimSun=5。↓ 一次跳三格到 Consolas
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const consolasChip = within(listbox).getByText("Consolas").closest("button")!;
    expect(consolasChip).toHaveClass("font-picker__chip--active");
    expect(search).toHaveAttribute("aria-activedescendant", consolasChip.id);

    fireEvent.keyDown(search, { key: "ArrowRight" });
    const georgiaChip = within(listbox).getByText("Georgia").closest("button")!;
    expect(georgiaChip).toHaveClass("font-picker__chip--active");

    fireEvent.keyDown(search, { key: "ArrowLeft" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onSettingsChange).toHaveBeenCalledWith({ cjkFont: "Consolas" });
    await waitFor(() =>
      expect(document.querySelector(".font-picker__region--rested")).toBeInTheDocument()
    );
  });

  it("展开区里按 Esc 只收本区并把焦点还给触发器，不退设置视图", async () => {
    const { onExit } = await setup();

    const trigger = screen.getByRole("button", { name: /代码字体（当前/ });
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox", { name: "代码字体候选表" });
    const search = within(listbox.parentElement!).getByRole("combobox", { name: "搜索代码字体" });

    fireEvent.keyDown(search, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(onExit).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    await waitFor(() =>
      expect(document.querySelector(".font-picker__region--rested")).toBeInTheDocument()
    );
  });

  it("Ctrl + 滚轮改字号：开关反映偏好、点击回写 ctrlWheelFontSize", async () => {
    const { onPreferencesChange } = await setup();

    const group = screen.getByRole("group", { name: "Ctrl + 滚轮改字号" });
    expect(within(group).getByRole("button", { name: "开" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    fireEvent.click(within(group).getByRole("button", { name: "关" }));
    expect(onPreferencesChange).toHaveBeenCalledWith({ ctrlWheelFontSize: false });
  });
});
