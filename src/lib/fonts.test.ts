import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  BUNDLED_FONTS,
  filterFonts,
  fontSlotValue,
  loadSystemFonts,
  mergeFonts,
  prefetchSystemFonts,
  quoteFontFamily,
  sanitizeFontName,
  sortFontsForSlot,
  __resetSystemFontsForTest,
  type SystemFont,
} from "./fonts";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const SYSTEM: SystemFont[] = [
  { name: "SimSun", cjk: true, mono: false },
  { name: "Georgia", cjk: false, mono: false },
  { name: "Consolas", cjk: false, mono: true },
];

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  __resetSystemFontsForTest();
});

describe("sanitizeFontName 清洗", () => {
  it("非字符串与空串一律回「默认」（空串）", () => {
    expect(sanitizeFontName(undefined)).toBe("");
    expect(sanitizeFontName(null)).toBe("");
    expect(sanitizeFontName(42)).toBe("");
    expect(sanitizeFontName("   ")).toBe("");
  });

  it("去掉控制字符与能拼出声明片段的字符（引号 / 反斜杠 / 分号 / 花括号）", () => {
    expect(sanitizeFontName('Sim\u0000Sun')).toBe("SimSun");
    expect(sanitizeFontName('Foo"; background: red; }')).toBe("Foo background: red");
    // 全是非法字符时清洗结果为空 ⇒ 读盘脏值落回默认，而不是写进变量
    expect(sanitizeFontName('";{}')).toBe("");
  });

  it("去首尾空白并截断到上限（96 字）", () => {
    expect(sanitizeFontName("  Source Han Serif SC  ")).toBe("Source Han Serif SC");
    expect(sanitizeFontName("x".repeat(200))).toHaveLength(96);
  });
});

describe("quoteFontFamily / fontSlotValue 栈合成", () => {
  it("字面一律带引号，引号与反斜杠转义", () => {
    expect(quoteFontFamily("Source Han Serif SC")).toBe('"Source Han Serif SC"');
  });

  it("中文槽接 --font-cjk-tail、代码槽接 --font-mono-tail、西文槽接回中文槽", () => {
    expect(fontSlotValue("cjk", "SimSun")).toBe('"SimSun", var(--font-cjk-tail)');
    expect(fontSlotValue("mono", "Consolas")).toBe('"Consolas", var(--font-mono-tail)');
    // 西文字面没有汉字字形：尾巴必须接回 --font-cjk，否则正文汉字会掉到 generic serif
    expect(fontSlotValue("latin", "Georgia")).toBe('"Georgia", var(--font-cjk)');
  });
});

describe("sortFontsForSlot 排序", () => {
  it("先按槽位相关性：中文槽首条是随包楷体，中文系统字体紧随其后", () => {
    const sorted = sortFontsForSlot([...SYSTEM, ...BUNDLED_FONTS], "cjk");
    expect(sorted.map((font) => font.name)).toEqual([
      "TsangerJinKai02",
      "SimSun",
      // 非 CJK 的随包字体（JetBrains Mono）落进第二档：它在中文槽里是噪声
      "JetBrains Mono",
      "Consolas",
      "Georgia",
    ]);
  });

  it("代码槽首条是随包 JetBrains Mono，等宽系统字体在前", () => {
    const sorted = sortFontsForSlot([...SYSTEM, ...BUNDLED_FONTS], "mono");
    expect(sorted.map((font) => font.name)).toEqual([
      "JetBrains Mono",
      "Consolas",
      // 非等宽的随包字体（楷体）落进第二档，排在同档的随包位
      "TsangerJinKai02",
      "Georgia",
      "SimSun",
    ]);
  });

  it("中文槽把 CJK 字体排在前面，代码槽把等宽字体排在前面（只调顺序、不过滤）", () => {
    const sorted = sortFontsForSlot(SYSTEM, "cjk");
    expect(sorted.map((font) => font.name)).toEqual(["SimSun", "Consolas", "Georgia"]);

    const monoFirst = sortFontsForSlot(SYSTEM, "mono");
    expect(monoFirst.map((font) => font.name)).toEqual(["Consolas", "Georgia", "SimSun"]);
  });

  it("同档内按名字排序，且不改动入参数组", () => {
    const input = [...SYSTEM];
    const sorted = sortFontsForSlot(input, "latin");
    expect(sorted.map((font) => font.name)).toEqual(["Consolas", "Georgia", "SimSun"]);
    expect(input.map((font) => font.name)).toEqual(["SimSun", "Georgia", "Consolas"]);
  });
});

describe("filterFonts 搜索", () => {
  it("大小写不敏感的子串匹配；空格分词后逐词命中", () => {
    expect(filterFonts(SYSTEM, "geo").map((font) => font.name)).toEqual(["Georgia"]);
    expect(filterFonts(SYSTEM, "SOURCE han").map((font) => font.name)).toEqual([]);
    expect(filterFonts(SYSTEM, "")).toHaveLength(3);
  });
});

describe("mergeFonts 合并", () => {
  it("按名去重且以随包那份为准（保住 cjk 标记）", () => {
    const merged = mergeFonts(
      [{ name: "JetBrains Mono", cjk: true, mono: true }],
      [
        { name: "jetbrains mono", cjk: false, mono: false },
        { name: "Georgia", cjk: false, mono: false },
      ]
    );
    expect(merged.map((font) => font.name)).toEqual(["JetBrains Mono", "Georgia"]);
    expect(merged[0].cjk).toBe(true);
  });
});

describe("loadSystemFonts 取本机字体", () => {
  it("拿到系统字体后与随包两款合并", async () => {
    vi.mocked(invoke).mockResolvedValue(SYSTEM);
    const fonts = await loadSystemFonts();

    expect(invoke).toHaveBeenCalledWith("list_system_fonts");
    expect(fonts.map((font) => font.name)).toContain("SimSun");
    expect(fonts.map((font) => font.name)).toContain("TsangerJinKai02");
  });

  it("进程内只拉一次（缓存在模块级）", async () => {
    vi.mocked(invoke).mockResolvedValue(SYSTEM);
    await loadSystemFonts();
    await loadSystemFonts();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("命令失败只告警，回退到随包两款——设置页不该因枚举字体而报错", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValue(new Error("no such command"));

    const fonts = await loadSystemFonts();
    expect(fonts.map((font) => font.name)).toEqual(BUNDLED_FONTS.map((font) => font.name));
    expect(warnSpy).toHaveBeenCalledWith("list_system_fonts failed:", expect.anything());
    warnSpy.mockRestore();
  });
});

describe("prefetchSystemFonts 闲时预热", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("经 requestIdleCallback 调度；重复调用仍是进程内一拉（缓存收口）", async () => {
    vi.mocked(invoke).mockResolvedValue(SYSTEM);
    const ric = vi.fn((cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 });
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", ric);

    prefetchSystemFonts();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("list_system_fonts"));
    // 二次调用照常调度，但 invoke 不再发——缓存直接返回
    prefetchSystemFonts();
    prefetchSystemFonts();
    expect(ric).toHaveBeenCalledTimes(3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("无 requestIdleCallback 的环境走 setTimeout 兜底", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    vi.useFakeTimers();
    vi.mocked(invoke).mockResolvedValue(SYSTEM);

    prefetchSystemFonts();
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).toHaveBeenCalledWith("list_system_fonts");
  });
});
