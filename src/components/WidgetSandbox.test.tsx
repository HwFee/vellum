import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WidgetSandbox } from "./WidgetSandbox";
import { widgetRegistry } from "../lib/widgetRegistry";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("WidgetSandbox", () => {
  let observerCallback: IntersectionObserverCallback | null = null;
  let observerOptions: IntersectionObserverInit | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    if ("__clear" in widgetRegistry && typeof widgetRegistry.__clear === "function") {
      widgetRegistry.__clear();
    }

    vi.spyOn(globalThis, "IntersectionObserver").mockImplementation(function (
      this: unknown,
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit
    ) {
      observerCallback = callback;
      observerOptions = options;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: options?.rootMargin ?? "0px",
        thresholds: [0],
      } as unknown as IntersectionObserver;
    });
  });

  it("preloads the iframe well before it enters the viewport (top 400px / bottom 1200px)", () => {
    render(<WidgetSandbox html="<div>preload</div>" autoMount={true} />);
    // 预载视距：阅读方向预留约一屏多的提前量，滑到 widget 时 iframe 已渲染完毕
    expect(observerOptions?.rootMargin).toBe("400px 0px 1200px 0px");
  });

  it("keeps the iframe transparent until the first resize report, then fades in", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-fade",
      url: "http://vellum-widget.localhost/w-fade",
    });

    render(<WidgetSandbox html="<div>fade</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    // 未收到上报前：透明占位（无 --ready 类；--static 是滚动锁存修复，与此断言无关）
    expect(iframe.className).toContain("mdlog-widget__frame");
    expect(iframe.className).not.toContain("--ready");

    const mockContentWindow = {} as Window;
    Object.defineProperty(iframe, "contentWindow", { value: mockContentWindow });
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 300 },
          source: mockContentWindow,
        })
      );
    });

    expect(iframe.className).toContain("mdlog-widget__frame--ready");
  });

  it("reveals the iframe 500ms after load as fallback when no resize report arrives", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockResolvedValueOnce({
        id: "w-fallback",
        url: "http://vellum-widget.localhost/w-fallback",
      });

      render(<WidgetSandbox html="<div>no-iife</div>" autoMount={true} />);
      await act(async () => {
        observerCallback?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      });

      const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
      expect(iframe.className).not.toContain("--ready");

      fireEvent.load(iframe);
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(iframe.className).toContain("mdlog-widget__frame--ready");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders untrusted placeholder when autoMount is false and mounts only on click", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-1",
      url: "http://vellum-widget.localhost/w-1",
    });

    render(<WidgetSandbox html="<div>demo</div>" autoMount={false} />);

    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("register_widget", expect.anything());

    // 用户点击占位块：授权写在 ref 上，本用例同时是「点击必须触发一次渲染」
    // （WidgetSandbox.grantRenderTick）的守卫——少了这次渲染就不会走 register_widget。
    await act(async () => {
      fireEvent.click(screen.getByText("交互内容 · 点击加载"));
    });

    expect(invoke).toHaveBeenCalledWith("register_widget", { html: "<div>demo</div>" });
    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.src).toBe("http://vellum-widget.localhost/w-1");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("auto mounts when autoMount is true and element enters viewport", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-2",
      url: "http://vellum-widget.localhost/w-2",
    });

    render(<WidgetSandbox html="<div>trusted</div>" autoMount={true} />);

    // 尚未进入视口时未调用 invoke
    expect(invoke).not.toHaveBeenCalled();

    // 触发 IntersectionObserver 相交
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(invoke).toHaveBeenCalledWith("register_widget", { html: "<div>trusted</div>" });
    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    expect(iframe.src).toBe("http://vellum-widget.localhost/w-2");
  });

  it("handles postMessage resize with clamp [80, 2000] and title update", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-3",
      url: "http://vellum-widget.localhost/w-3",
    });

    render(<WidgetSandbox html="<div>comm</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    const iframe = screen.getByTitle("交互演示") as HTMLIFrameElement;
    const mockContentWindow = {} as Window;
    Object.defineProperty(iframe, "contentWindow", { value: mockContentWindow });

    // 1. 非法来源消息被忽略
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "vellum-widget:resize", height: 800, title: "伪造" },
        source: {} as Window,
      })
    );
    // 默认初始高度为 240px；非法来源消息被忽略，高度值未变化（仍为 240px）即判定忽略成功（B3）
    expect(iframe.style.height).toBe("240px");

    // 2. 合法来源高度设置与 title 更新
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 600, title: "正弦波演示" },
          source: mockContentWindow,
        })
      );
    });
    expect(iframe.style.height).toBe("600px");
    expect(iframe.title).toBe("正弦波演示");

    // 3. 超下限 clamp 至 80px
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 30 },
          source: mockContentWindow,
        })
      );
    });
    expect(iframe.style.height).toBe("80px");

    // 4. 超上限 clamp 至 2000px
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 3000 },
          source: mockContentWindow,
        })
      );
    });
    expect(iframe.style.height).toBe("2000px");
  });

  it("renders fallback CodeBlock on invoke failure without crashing", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("IPC network error"));

    render(
      <WidgetSandbox
        html="<div>err</div>"
        autoMount={true}
      />
    );

    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    // A5: 降级由组件内部渲染 CodeBlock，不依赖父级 fallback prop 传参
    // markup 高亮会把 HTML 拆成多个 token，故对 textContent 做整体断言
    const code = document.querySelector(".code-block__body code");
    expect(code?.textContent).toBe("<div>err</div>");
    // F12: 降级语言统一为 Prism 已注册的 markup（xml 并未注册，写上去也不高亮）
    expect(document.querySelector(".code-block__lang")?.textContent).toBe("markup");
  });

  it("renders dormant placeholder and reactivates upon click (P4: unregisters on dormant and re-registers on wake)", async () => {
    vi.useFakeTimers();
    try {
      let registerCallsCount = 0;
      vi.mocked(invoke).mockImplementation(async (cmd) => {
        if (cmd === "register_widget") {
          return registerCallsCount++ === 0
            ? { id: "w-5-a", url: "http://vellum-widget.localhost/w-5-a" }
            : { id: "w-5-b", url: "http://vellum-widget.localhost/w-5-b" };
        }
        return null;
      });

      const activateSpy = vi.spyOn(widgetRegistry, "activate");

      render(<WidgetSandbox html="<div>dormant</div>" autoMount={true} />);
      await act(async () => {
        observerCallback?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      });

      const iframeInitial = screen.getByTitle("交互演示") as HTMLIFrameElement;
      expect(iframeInitial).toBeInTheDocument();
      expect(iframeInitial.src).toBe("http://vellum-widget.localhost/w-5-a");
      expect(invoke).toHaveBeenCalledWith("register_widget", { html: "<div>dormant</div>" });

      // 模拟 registry 广播休眠事件
      act(() => {
        for (let i = 1; i <= 11; i++) {
          widgetRegistry.register(`other-${i}`);
          widgetRegistry.requestMount(`other-${i}`);
          widgetRegistry.markVisible(`other-${i}`);
        }
        vi.advanceTimersByTime(400);
      });

      // P4 断言：进入休眠时必须调用 unregister_widget 释放后端资源，且 iframe 必须销毁
      expect(invoke).toHaveBeenCalledWith("unregister_widget", { id: "w-5-a" });
      const dormantBtn = screen.getByText("交互已休眠 · 点击查看");
      expect(dormantBtn).toBeInTheDocument();
      expect(screen.queryByTitle("交互演示")).not.toBeInTheDocument();

      // 用户点击休眠占位块唤醒
      await act(async () => {
        fireEvent.click(dormantBtn);
      });

      // 断言 activate() 被调且走完整注册流程（重新调用 register_widget 获得新 URL）
      expect(activateSpy).toHaveBeenCalledWith(expect.any(String));
      const registerCalls = vi.mocked(invoke).mock.calls.filter(
        (call) => call[0] === "register_widget"
      );
      expect(registerCalls.length).toBe(2);
      const iframeReactivated = screen.getByTitle("交互演示") as HTMLIFrameElement;
      expect(iframeReactivated).toBeInTheDocument();
      expect(iframeReactivated.src).toBe("http://vellum-widget.localhost/w-5-b");
    } finally {
      vi.useRealTimers();
    }
  });

  it("unregisters widget from backend upon unmount", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-6",
      url: "http://vellum-widget.localhost/w-6",
    });

    const { unmount } = render(<WidgetSandbox html="<div>unmount</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    unmount();
    expect(invoke).toHaveBeenCalledWith("unregister_widget", { id: "w-6" });
  });

  it("P2: resets custom title and height to defaults when html changes after postMessage resize", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({
        id: "w-p2-1",
        url: "http://vellum-widget.localhost/w-p2-1",
      })
      .mockResolvedValueOnce({
        id: "w-p2-2",
        url: "http://vellum-widget.localhost/w-p2-2",
      });

    // 1. 挂载第一个 widget 并模拟 postMessage 更改标题和高度
    const { rerender } = render(<WidgetSandbox html="<div>first</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    const iframe1 = screen.getByTitle("交互演示") as HTMLIFrameElement;
    const mockContentWindow = {} as Window;
    Object.defineProperty(iframe1, "contentWindow", { value: mockContentWindow });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "vellum-widget:resize", height: 750, title: "私密标题-甲" },
          source: mockContentWindow,
        })
      );
    });

    expect(iframe1.title).toBe("私密标题-甲");
    expect(screen.getByText("私密标题-甲 · vellum-widget")).toBeInTheDocument();
    expect(iframe1.style.height).toBe("750px");

    // 2. 变更 html prop：触发实例复位，标题必须回到默认「交互演示」，高度回到 240px
    rerender(<WidgetSandbox html="<div>second</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    const iframe2 = screen.getByTitle("交互演示") as HTMLIFrameElement;
    expect(iframe2).toBeInTheDocument();
    expect(screen.getByText("交互演示 · vellum-widget")).toBeInTheDocument();
    expect(iframe2.style.height).toBe("240px");
    expect(screen.queryByTitle("私密标题-甲")).not.toBeInTheDocument();
  });

  it("P2: unregisters old id and resets authorization when html changes or autoMount flips to false", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-old",
      url: "http://vellum-widget.localhost/w-old",
    });

    // 1. 用户手动授权非受信组件
    const { rerender } = render(<WidgetSandbox html="<div>old</div>" autoMount={false} />);
    const placeholder = screen.getByText("交互内容 · 点击加载");
    await act(async () => {
      fireEvent.click(placeholder);
    });

    expect(invoke).toHaveBeenCalledWith("register_widget", { html: "<div>old</div>" });
    expect(screen.getByTitle("交互演示")).toBeInTheDocument();

    // 2. html prop 变化：实例必须释放旧 id，清空 URL，回到未授权占位状态
    rerender(<WidgetSandbox html="<div>new</div>" autoMount={false} />);
    await act(async () => {});

    expect(invoke).toHaveBeenCalledWith("unregister_widget", { id: "w-old" });
    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
    expect(screen.queryByTitle("交互演示")).not.toBeInTheDocument();

    // 3. autoMount 由 true 翻为 false（C4 名实相符）：必须注销旧 id 并回到未授权占位块态
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-automount",
      url: "http://vellum-widget.localhost/w-automount",
    });
    rerender(<WidgetSandbox html="<div>trusted</div>" autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    expect(screen.getByTitle("交互演示")).toBeInTheDocument();

    rerender(<WidgetSandbox html="<div>trusted</div>" autoMount={false} />);
    await act(async () => {});

    expect(invoke).toHaveBeenCalledWith("unregister_widget", { id: "w-automount" });
    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
    expect(screen.queryByTitle("交互演示")).not.toBeInTheDocument();
  });

  it("F1/A1: does not register new html without authorization when register_widget is in flight during document switch", async () => {
    let resolveX: (val: any) => void = () => {};
    const xPromise = new Promise((resolve) => {
      resolveX = resolve;
    });

    const registeredHtmls: string[] = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "register_widget") {
        registeredHtmls.push(args?.html);
        if (args?.html === "<div>x1</div>") {
          return xPromise;
        }
        return { id: "w-y1", url: "http://vellum-widget.localhost/w-y1" };
      }
      return undefined;
    });

    // 1. 渲染非受信文档 X 并点击授权
    const { rerender } = render(<WidgetSandbox html="<div>x1</div>" autoMount={false} />);
    const placeholder = screen.getByText("交互内容 · 点击加载");
    fireEvent.click(placeholder);

    // 此时 X 的 register_widget 正在在途挂起
    expect(registeredHtmls).toEqual(["<div>x1</div>"]);

    // 2. 在 X 的 register 挂起期间，文档换档切到 Y
    rerender(<WidgetSandbox html="<div>y1</div>" autoMount={false} />);

    // 断言：Y 必须是未授权占位块，陈旧 iframe 不存活，Y 的 html 绝不能被注册
    expect(registeredHtmls).toEqual(["<div>x1</div>"]);
    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
    expect(screen.queryByTitle("交互演示")).not.toBeInTheDocument();

    // 3. 异步 resolve X，旧注册取消，再次断言 Y 仍未被越权注册
    await act(async () => {
      resolveX({ id: "w-x1", url: "http://vellum-widget.localhost/w-x1" });
    });

    expect(registeredHtmls).toEqual(["<div>x1</div>"]);
    expect(invoke).toHaveBeenCalledWith("unregister_widget", { id: "w-x1" });
    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
  });
  it("disables pointer events on static figures (scroll-latch fix) but keeps them on interactive widgets", async () => {
    // 静态图（仅通信 IIFE）：iframe 必须带 --static（pointer-events: none），
    // 否则滚轮手势会被 scroll-latch 锁进跨源子帧，表现为「图上滚动卡住」
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "register_widget") {
        return { id: "w-static", url: "http://vellum-widget.localhost/w-static" };
      }
      return undefined;
    });
    const staticHtml = `<!DOCTYPE html><html><body><svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>
      <script>(function(){ window.parent.postMessage({ type: "vellum-widget:resize", height: 10, title: document.title }, "*"); })();</script>
      </body></html>`;
    const { unmount } = render(<WidgetSandbox html={staticHtml} autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    const staticFrame = screen.getByTitle("交互演示") as HTMLIFrameElement;
    expect(staticFrame.className).toContain("mdlog-widget__frame--static");
    unmount();

    // 交互 widget（含按钮）：不得加 --static，指针事件保持放行
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "register_widget") {
        return { id: "w-interactive", url: "http://vellum-widget.localhost/w-interactive" };
      }
      return undefined;
    });
    render(<WidgetSandbox html={'<div><button type="button">go</button></div>'} autoMount={true} />);
    await act(async () => {
      observerCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });
    const interactiveFrame = screen.getByTitle("交互演示") as HTMLIFrameElement;
    expect(interactiveFrame.className).not.toContain("mdlog-widget__frame--static");
    expect(interactiveFrame.className).toContain("mdlog-widget__frame");
  });
});
