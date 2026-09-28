import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Store } from "@tauri-apps/plugin-store";
import {
  useReaderSettings,
  stepFontSize,
  READER_SETTINGS_DEFAULT,
  LATIN_UNICODE_RANGE,
} from "./useReaderSettings";
import { __resetSettingsStoreForTest } from "../lib/settings";

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockSave = vi.fn();

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () =>
      ({
        get: mockGet,
        set: mockSet,
        save: mockSave,
      }) as unknown as Store
    ),
  },
}));

const READER_VARS = [
  "--reader-font-size",
  "--reader-column-width",
  "--reader-line-height",
  "--font-cjk",
  "--font-latin",
  "--font-mono",
];

function clearReaderVars() {
  for (const name of READER_VARS) {
    document.documentElement.style.removeProperty(name);
  }
}

describe("useReaderSettings", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockSave.mockReset();
    __resetSettingsStoreForTest();
    clearReaderVars();
  });

  afterEach(() => {
    clearReaderVars();
  });

  it("默认值并覆写根 CSS 变量", () => {
    const { result } = renderHook(() => useReaderSettings());
    expect(result.current[0]).toEqual(READER_SETTINGS_DEFAULT);
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--reader-font-size")).toBe("14px");
    expect(root.getPropertyValue("--reader-column-width")).toBe("800px");
    expect(root.getPropertyValue("--reader-line-height")).toBe("1.55");
  });

  it("启动时恢复持久化设置", async () => {
    mockGet.mockResolvedValue({ fontSize: 16, columnWidth: 960, lineHeight: 1.7 });
    const { result } = renderHook(() => useReaderSettings());
    await waitFor(() =>
      expect(result.current[0]).toEqual({
        ...READER_SETTINGS_DEFAULT,
        fontSize: 16,
        columnWidth: 960,
        lineHeight: 1.7,
      })
    );
    expect(document.documentElement.style.getPropertyValue("--reader-font-size")).toBe("16px");
  });

  it("持久化的非法字段逐字段回退默认，合法字段保留", async () => {
    mockGet.mockResolvedValue({ fontSize: 99, columnWidth: 720, lineHeight: "loose" });
    const { result } = renderHook(() => useReaderSettings());
    await waitFor(() =>
      expect(result.current[0]).toEqual({
        ...READER_SETTINGS_DEFAULT,
        columnWidth: 720,
      })
    );
  });

  it("读取失败/无记录时保持默认值", async () => {
    mockGet.mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useReaderSettings());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current[0]).toEqual(READER_SETTINGS_DEFAULT);
    unmount();

    __resetSettingsStoreForTest();
    vi.mocked(Store.load).mockRejectedValueOnce(new Error("store unavailable"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result: result2 } = renderHook(() => useReaderSettings());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result2.current[0]).toEqual(READER_SETTINGS_DEFAULT);
    warnSpy.mockRestore();
  });

  it("局部更新合并后立即持久化到 settings Store", async () => {
    const { result } = renderHook(() => useReaderSettings());
    await act(async () => {
      result.current[1]({ fontSize: 18 });
    });
    expect(result.current[0]).toEqual({ ...READER_SETTINGS_DEFAULT, fontSize: 18 });
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith("readerSettings", {
        ...READER_SETTINGS_DEFAULT,
        fontSize: 18,
      })
    );
    expect(mockSave).toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--reader-font-size")).toBe("18px");
  });

  it("落盘失败只告警、不影响当前设置", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockSet.mockRejectedValue(new Error("disk readonly"));
    const { result } = renderHook(() => useReaderSettings());
    await act(async () => {
      result.current[1]({ lineHeight: 1.7 });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current[0].lineHeight).toBe(1.7);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("readerSettings"),
      expect.anything()
    );
    warnSpy.mockRestore();
  });

  it("启动恢复只读不写：读盘得到的设置不触发回写，只有用户改动才落盘", async () => {
    mockGet.mockResolvedValue({ fontSize: 16, columnWidth: 960, lineHeight: 1.7 });
    const { result } = renderHook(() => useReaderSettings());
    await waitFor(() => expect(result.current[0].fontSize).toBe(16));
    // 落盘挂在 settings 的 effect 上，若不加「用户改过」这道闸，启动那次 setState 会
    // 立刻把刚读到的值原样写回（StrictMode 下还会写两遍）
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();

    // 用户改一次 ⇒ 落盘的是**已提交的状态**（读到的 16/960/1.7 与这次改动合并后的那份）
    await act(async () => {
      result.current[1]({ fontSize: 18 });
    });
    await waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith("readerSettings", {
        ...READER_SETTINGS_DEFAULT,
        fontSize: 18,
        columnWidth: 960,
        lineHeight: 1.7,
      })
    );
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it("卸载时移除 CSS 变量覆写", () => {
    const { result, unmount } = renderHook(() => useReaderSettings());
    act(() => {
      result.current[1]({ columnWidth: 720 });
    });
    expect(document.documentElement.style.getPropertyValue("--reader-column-width")).toBe("720px");
    unmount();
    expect(document.documentElement.style.getPropertyValue("--reader-column-width")).toBe("");
  });
});

describe("useReaderSettings 字体三槽（中文 / 西文 / 代码）", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockSave.mockReset();
    __resetSettingsStoreForTest();
    clearReaderVars();
  });

  afterEach(() => {
    clearReaderVars();
  });

  it("出厂不覆写字体变量：三个槽都走 kami.css 的回退", () => {
    renderHook(() => useReaderSettings());
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--font-cjk")).toBe("");
    expect(root.getPropertyValue("--font-latin")).toBe("");
    expect(root.getPropertyValue("--font-mono")).toBe("");
  });

  it("选字面后写「字面 + 兜底尾巴」，尾巴交给 CSS 端着", () => {
    const { result } = renderHook(() => useReaderSettings());
    act(() => {
      result.current[1]({ cjkFont: "SimSun", latinFont: "Georgia", monoFont: "Consolas" });
    });

    const root = document.documentElement.style;
    expect(root.getPropertyValue("--font-cjk")).toBe('"SimSun", var(--font-cjk-tail)');
    // 西文槽的尾巴接回中文槽：汉字必须落回中文槽那款字体
    expect(root.getPropertyValue("--font-latin")).toBe('"Georgia", var(--font-cjk)');
    expect(root.getPropertyValue("--font-mono")).toBe('"Consolas", var(--font-mono-tail)');
  });

  it("改回默认（空串）时移除变量，而不是写空值（空值会让 font-family 在计算值阶段失效）", () => {
    const { result } = renderHook(() => useReaderSettings());
    act(() => {
      result.current[1]({ cjkFont: "SimSun" });
    });
    expect(document.documentElement.style.getPropertyValue("--font-cjk")).not.toBe("");

    act(() => {
      result.current[1]({ cjkFont: "" });
    });
    expect(document.documentElement.style.getPropertyValue("--font-cjk")).toBe("");
    // 不是写了空值充数：整段 style 里不该再出现这个变量
    expect(document.documentElement.getAttribute("style") ?? "").not.toContain("--font-cjk");
  });

  it("持久化的字体名逐字段清洗：脏值落回默认、合法值原样恢复", async () => {
    mockGet.mockResolvedValue({
      fontSize: 16,
      columnWidth: 800,
      lineHeight: 1.55,
      cjkFont: "  Source Han Serif SC  ",
      latinFont: 42,
      monoFont: '";{}',
    });
    const { result } = renderHook(() => useReaderSettings());

    await waitFor(() => expect(result.current[0].cjkFont).toBe("Source Han Serif SC"));
    expect(result.current[0].latinFont).toBe("");
    expect(result.current[0].monoFont).toBe("");
    expect(document.documentElement.style.getPropertyValue("--font-cjk")).toBe(
      '"Source Han Serif SC", var(--font-cjk-tail)'
    );
  });

  it("字体槽随卸载一并清掉", () => {
    const { result, unmount } = renderHook(() => useReaderSettings());
    act(() => {
      result.current[1]({ monoFont: "Consolas" });
    });
    expect(document.documentElement.style.getPropertyValue("--font-mono")).not.toBe("");

    unmount();
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe("");
  });

  it("冷字面先经 document.fonts.load 预热再写变量——load 返回前不落笔", async () => {
    let resolveLoad: (faces: FontFace[]) => void = () => {};
    const fontsStub = {
      load: vi.fn(
        (_spec: string, _text: string) =>
          new Promise<FontFace[]>((resolve) => {
            resolveLoad = resolve;
          })
      ),
      check: vi.fn(() => false),
    };
    Object.defineProperty(document, "fonts", { value: fontsStub, configurable: true });
    try {
      const { result } = renderHook(() => useReaderSettings());
      act(() => {
        result.current[1]({ cjkFont: "SimSun" });
      });

      // 预热在途：load 已发起，变量还没写——正文不会先按回退排一遍
      expect(fontsStub.load).toHaveBeenCalledWith('16px "SimSun"', "素笺字体预览样张");
      expect(document.documentElement.style.getPropertyValue("--font-cjk")).toBe("");

      await act(async () => {
        resolveLoad([]);
      });
      expect(document.documentElement.style.getPropertyValue("--font-cjk")).toBe(
        '"SimSun", var(--font-cjk-tail)'
      );
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  it("预热超 300ms 封顶仍落笔——慢机器不饿着等", async () => {
    const fontsStub = {
      load: vi.fn(() => new Promise<FontFace[]>(() => {})),
      check: vi.fn(() => false),
    };
    Object.defineProperty(document, "fonts", { value: fontsStub, configurable: true });
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useReaderSettings());
      act(() => {
        result.current[1]({ cjkFont: "SimSun" });
      });
      expect(document.documentElement.style.getPropertyValue("--font-cjk")).toBe("");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(document.documentElement.style.getPropertyValue("--font-cjk")).toBe(
        '"SimSun", var(--font-cjk-tail)'
      );
    } finally {
      vi.useRealTimers();
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });

  it("已载入的字面（fonts.check 为 true）同步落笔，不绕一圈异步", () => {
    const fontsStub = {
      load: vi.fn(() => Promise.resolve([] as FontFace[])),
      check: vi.fn(() => true),
    };
    Object.defineProperty(document, "fonts", { value: fontsStub, configurable: true });
    try {
      const { result } = renderHook(() => useReaderSettings());
      act(() => {
        result.current[1]({ cjkFont: "SimSun" });
      });
      // check 命中即跳过预热：变量同步就位
      expect(fontsStub.load).not.toHaveBeenCalled();
      expect(document.documentElement.style.getPropertyValue("--font-cjk")).toBe(
        '"SimSun", var(--font-cjk-tail)'
      );
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });
});

describe("西文槽 unicode-range 收窄（Vellum Latin FontFace）", () => {
  /// 可控的 FontFace stub：load() 的兑现时机由用例掌握
  class FakeFontFace {
    family: string;
    source: string;
    descriptors: Record<string, string>;
    status = "unloaded";
    resolveLoad: (face: FontFace) => void = () => {};
    rejectLoad: (err: unknown) => void = () => {};
    fail = false;
    constructor(family: string, source: string, descriptors: Record<string, string>) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
    }
    load(): Promise<FontFace> {
      return new Promise<FontFace>((resolve, reject) => {
        if (this.fail) reject(new Error("no local face"));
        else {
          this.resolveLoad = resolve;
          this.rejectLoad = reject;
          this.status = "loaded";
          resolve(this as unknown as FontFace);
        }
      });
    }
  }

  let created: FakeFontFace[] = [];
  let fontsStub: {
    add: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    check: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    created = [];
    fontsStub = {
      add: vi.fn(() => true),
      delete: vi.fn(() => true),
      check: vi.fn(() => false),
      load: vi.fn(() => Promise.resolve([])),
    };
    vi.stubGlobal(
      "FontFace",
      class extends FakeFontFace {
        constructor(family: string, source: string, descriptors: Record<string, string>) {
          super(family, source, descriptors);
          created.push(this);
        }
      }
    );
    Object.defineProperty(document, "fonts", { value: fontsStub, configurable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (document as unknown as { fonts?: unknown }).fonts;
  });

  it("local() 收窄成功：挂 Vellum Latin face、写别名栈，unicodeRange 只盖拉丁区", async () => {
    const { result } = renderHook(() => useReaderSettings());
    act(() => {
      result.current[1]({ latinFont: "Microsoft YaHei" });
    });
    await act(async () => {});

    expect(created).toHaveLength(1);
    const face = created[0];
    expect(face.family).toBe("Vellum Latin");
    expect(face.source).toContain('local("Microsoft YaHei")');
    expect(face.descriptors.unicodeRange).toBe(LATIN_UNICODE_RANGE);
    // CJK 全角区不在范围内：汉字不会因为西文槽选了带汉字的字面而被接走
    expect(face.descriptors.unicodeRange).not.toContain("3000");
    expect(fontsStub.add).toHaveBeenCalledWith(face);
    expect(document.documentElement.style.getPropertyValue("--font-latin")).toBe(
      '"Vellum Latin", var(--font-cjk)'
    );
  });

  it("local() 解析失败：回退「原名 + 回中文槽」栈并告警", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => useReaderSettings());
    created = [];
    const FailingFace = class extends FakeFontFace {
      constructor(family: string, source: string, descriptors: Record<string, string>) {
        super(family, source, descriptors);
        this.fail = true;
        created.push(this);
      }
    };
    vi.stubGlobal("FontFace", FailingFace);
    act(() => {
      result.current[1]({ latinFont: "Source Sans Pro" });
    });
    await act(async () => {});

    expect(fontsStub.add).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--font-latin")).toBe(
      '"Source Sans Pro", var(--font-cjk)'
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("换字面：旧 face 先删再挂新 face；回默认删 face 并移除覆写", async () => {
    const { result } = renderHook(() => useReaderSettings());
    act(() => {
      result.current[1]({ latinFont: "Georgia" });
    });
    await act(async () => {});
    const first = created[0];
    expect(document.documentElement.style.getPropertyValue("--font-latin")).toBe(
      '"Vellum Latin", var(--font-cjk)'
    );

    act(() => {
      result.current[1]({ latinFont: "Consolas" });
    });
    await act(async () => {});
    expect(fontsStub.delete).toHaveBeenCalledWith(first);
    expect(created).toHaveLength(2);
    expect(fontsStub.add).toHaveBeenLastCalledWith(created[1]);
    expect(created[1].source).toContain('local("Consolas")');

    act(() => {
      result.current[1]({ latinFont: "" });
    });
    await act(async () => {});
    expect(fontsStub.delete).toHaveBeenLastCalledWith(created[1]);
    expect(document.documentElement.style.getPropertyValue("--font-latin")).toBe("");
  });

  it("300ms 内没载好先写兜底栈，载好后再升级为 Vellum Latin", async () => {
    const PendingFace = class extends FakeFontFace {
      constructor(family: string, source: string, descriptors: Record<string, string>) {
        super(family, source, descriptors);
        created.push(this);
      }
      load(): Promise<FontFace> {
        return new Promise<FontFace>((resolve) => {
          this.resolveLoad = resolve;
        });
      }
    };
    vi.stubGlobal("FontFace", PendingFace);
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useReaderSettings());
      act(() => {
        result.current[1]({ latinFont: "Georgia" });
      });
      // 载入在途，先不落笔
      expect(document.documentElement.style.getPropertyValue("--font-latin")).toBe("");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      // 超时：兜底原名栈先顶上
      expect(document.documentElement.style.getPropertyValue("--font-latin")).toBe(
        '"Georgia", var(--font-cjk)'
      );
      // 载好了再升级
      await act(async () => {
        created[0].resolveLoad(created[0] as unknown as FontFace);
        await Promise.resolve();
      });
      expect(document.documentElement.style.getPropertyValue("--font-latin")).toBe(
        '"Vellum Latin", var(--font-cjk)'
      );
      expect(fontsStub.add).toHaveBeenCalledWith(created[0]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("stepFontSize（Ctrl+= / Ctrl+- / Ctrl+0 的字号步进）", () => {
  it("+1 沿选项表进档，18 处夹取", () => {
    expect(stepFontSize(14, 1)).toBe(16);
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(18, 1)).toBe(18);
  });

  it("-1 沿选项表退档，13 处夹取", () => {
    expect(stepFontSize(14, -1)).toBe(13);
    expect(stepFontSize(18, -1)).toBe(16);
    expect(stepFontSize(13, -1)).toBe(13);
  });

  it("direction 0 复位默认档", () => {
    expect(stepFontSize(13, 0)).toBe(READER_SETTINGS_DEFAULT.fontSize);
    expect(stepFontSize(18, 0)).toBe(READER_SETTINGS_DEFAULT.fontSize);
    expect(stepFontSize(14, 0)).toBe(READER_SETTINGS_DEFAULT.fontSize);
  });

  it("当前值不在选项表内时按最近档定锚再步进", () => {
    // 17 最近档是 16：+1 → 18、-1 → 14
    expect(stepFontSize(17, 1)).toBe(18);
    expect(stepFontSize(17, -1)).toBe(14);
  });
});
