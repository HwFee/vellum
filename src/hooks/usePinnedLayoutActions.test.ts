import { act, renderHook } from "@testing-library/react";
import { usePinnedLayoutActions } from "./usePinnedLayoutActions";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setFullscreen: vi.fn(() => Promise.resolve()),
  }),
}));

vi.mock("../lib/appPreferences", () => ({
  loadAppPreferences: vi.fn(() =>
    Promise.resolve({ sidebarOpenOnLaunch: false, autoCheckUpdates: false })
  ),
}));

function makeDeps(overrides: Partial<Parameters<typeof usePinnedLayoutActions>[0]> = {}) {
  return {
    toggleOutline: () => {},
    setIsOutlineOpen: () => {},
    isOutlineOpen: false,
    isNarrow: false,
    outlineWidth: 240,
    setOutlineWidth: () => {},
    setReaderSettings: () => {},
    readerFontSize: 14,
    beginWidthTransition: () => {},
    noteLayoutShift: () => {},
    isSettingsOpen: false,
    isExportOpen: false,
    isFocusMode: false,
    setIsFocusMode: () => {},
    ...overrides,
  };
}

describe("专注模式进出（C2 留一线）", () => {
  it("进入时先钉视口（beginWidthTransition），再收侧栏，最后置专注态", () => {
    const order: string[] = [];
    const { result } = renderHook(() =>
      usePinnedLayoutActions(
        makeDeps({
          isOutlineOpen: true,
          beginWidthTransition: () => order.push("pin"),
          setIsOutlineOpen: () => order.push("outline"),
          setIsFocusMode: () => order.push("focus"),
        })
      )
    );

    act(() => result.current.toggleFocusMode());
    expect(order).toEqual(["pin", "outline", "focus"]);
  });

  it("侧栏本就关着时进入专注：只钉视口再置态，不碰侧栏 setter", () => {
    const order: string[] = [];
    const { result } = renderHook(() =>
      usePinnedLayoutActions(
        makeDeps({
          isOutlineOpen: false,
          beginWidthTransition: () => order.push("pin"),
          setIsOutlineOpen: () => order.push("outline"),
          setIsFocusMode: () => order.push("focus"),
        })
      )
    );

    act(() => result.current.toggleFocusMode());
    expect(order).toEqual(["pin", "focus"]);
  });

  it("退出时还原侧栏成进入前的开合态，顺序同样是先钉视口", () => {
    const order: string[] = [];
    const openCalls: boolean[] = [];
    const deps = makeDeps({
      isOutlineOpen: true,
      beginWidthTransition: () => order.push("pin"),
      setIsOutlineOpen: (open: boolean) => {
        order.push("outline");
        openCalls.push(open);
      },
      setIsFocusMode: () => order.push("focus"),
    });

    // 用受控 state 让 isFocusMode 在两次渲染间变化（toggle 读的是当前渲染值）
    let focusMode = false;
    const { result, rerender } = renderHook(() =>
      usePinnedLayoutActions({ ...deps, isFocusMode: focusMode })
    );

    act(() => result.current.toggleFocusMode()); // 进入：侧栏收掉
    focusMode = true;
    rerender();
    act(() => result.current.toggleFocusMode()); // 退出：还原成进入前的开

    expect(order).toEqual(["pin", "outline", "focus", "pin", "outline", "focus"]);
    expect(openCalls).toEqual([false, true]);
  });

  it("专注态下 Escape 退出；设置/导出视图开着或落在输入控件上时归它们", () => {
    const exitCalls: string[] = [];
    const deps = makeDeps({
      isFocusMode: true,
      beginWidthTransition: () => exitCalls.push("pin"),
      setIsFocusMode: (on: boolean) => {
        if (!on) exitCalls.push("focus-off");
      },
    });
    const { unmount } = renderHook(() => usePinnedLayoutActions(deps));

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKeyDown(input);
    expect(exitCalls).toEqual([]); // input 上的 Esc 不退出

    fireKeyDown(window);
    expect(exitCalls).toEqual(["pin", "focus-off"]);
    document.body.removeChild(input);
    unmount();
  });
});

function fireKeyDown(target: Window | Element) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
  );
}
