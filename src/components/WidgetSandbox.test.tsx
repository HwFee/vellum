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

  beforeEach(() => {
    vi.clearAllMocks();
    if ("__clear" in widgetRegistry && typeof widgetRegistry.__clear === "function") {
      widgetRegistry.__clear();
    }

    vi.spyOn(globalThis, "IntersectionObserver").mockImplementation(function (
      this: unknown,
      callback: IntersectionObserverCallback
    ) {
      observerCallback = callback;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "200px",
        thresholds: [0],
      } as unknown as IntersectionObserver;
    });
  });

  it("renders untrusted placeholder when autoMount is false and mounts only on click", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      id: "w-1",
      url: "http://vellum-widget.localhost/w-1",
    });

    render(<WidgetSandbox html="<div>demo</div>" autoMount={false} />);

    expect(screen.getByText("交互内容 · 点击加载")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("register_widget", expect.anything());

    // 用户点击占位块
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
    // xml 高亮会把 HTML 拆成多个 token，故对 textContent 做整体断言
    const code = document.querySelector(".code-block__body code");
    expect(code?.textContent).toBe("<div>err</div>");
  });

  it("renders dormant placeholder and reactivates upon click", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockResolvedValue({
        id: "w-5",
        url: "http://vellum-widget.localhost/w-5",
      });

      const activateSpy = vi.spyOn(widgetRegistry, "activate");

      render(<WidgetSandbox html="<div>dormant</div>" autoMount={true} />);
      await act(async () => {
        observerCallback?.(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      });

      expect(screen.getByTitle("交互演示")).toBeInTheDocument();

      // 模拟 registry 广播休眠事件
      act(() => {
        for (let i = 1; i <= 11; i++) {
          widgetRegistry.register(`other-${i}`);
          widgetRegistry.requestMount(`other-${i}`);
          widgetRegistry.markVisible(`other-${i}`);
        }
        vi.advanceTimersByTime(400);
      });

      // 断言休眠文案「交互已休眠 · 点击查看」渲染（B3）
      const dormantBtn = screen.getByText("交互已休眠 · 点击查看");
      expect(dormantBtn).toBeInTheDocument();
      expect(screen.queryByTitle("交互演示")).not.toBeInTheDocument();

      // 用户点击休眠占位块唤醒
      await act(async () => {
        fireEvent.click(dormantBtn);
      });

      // 断言 activate() 被调且 iframe 重新挂载
      expect(activateSpy).toHaveBeenCalledWith(expect.any(String));
      expect(screen.getByTitle("交互演示")).toBeInTheDocument();
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
  });
});
