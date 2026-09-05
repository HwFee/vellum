import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { CustomScrollbar } from "./CustomScrollbar";

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={containerRef} className="scroll-host">
        <div ref={contentRef} />
      </div>
      <CustomScrollbar containerRef={containerRef} contentRef={contentRef} />
    </>
  );
}

function mockScrollMetrics(element: HTMLElement, metrics: { clientHeight: number; scrollHeight: number }) {
  Object.defineProperty(element, "clientHeight", { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
}

function mockRect(element: Element, rect: Partial<DOMRect>) {
  element.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    }) as DOMRect;
}

function getParts() {
  const host = document.querySelector(".scroll-host") as HTMLElement;
  const track = document.querySelector(".custom-scrollbar") as HTMLElement;
  const thumb = document.querySelector(".custom-scrollbar__thumb") as HTMLElement;
  return { host, track, thumb };
}

describe("CustomScrollbar", () => {
  it("maps thumb drag distance to scroll position proportionally", () => {
    render(<Harness />);
    const { host, thumb } = getParts();
    // 轨道高 100、内容高 1000：thumb 高 24（最小值），可滚轨道 76、可滚内容 900
    mockScrollMetrics(host, { clientHeight: 100, scrollHeight: 1000 });
    host.scrollTop = 0;

    fireEvent.mouseDown(thumb, { clientY: 50 });
    // deltaY = 38，占可滚轨道一半 → scrollTop = 900 * 0.5
    fireEvent.mouseMove(document, { clientY: 88 });
    expect(host.scrollTop).toBe(450);

    // mouseup 后拖拽监听被移除，继续移动不再滚动
    fireEvent.mouseUp(document);
    fireEvent.mouseMove(document, { clientY: 150 });
    expect(host.scrollTop).toBe(450);
  });

  it("clamps drag scrolling to the scrollable range", () => {
    render(<Harness />);
    const { host, thumb } = getParts();
    mockScrollMetrics(host, { clientHeight: 100, scrollHeight: 1000 });
    host.scrollTop = 0;

    fireEvent.mouseDown(thumb, { clientY: 50 });
    fireEvent.mouseMove(document, { clientY: -500 });
    expect(host.scrollTop).toBe(0);

    fireEvent.mouseMove(document, { clientY: 5000 });
    expect(host.scrollTop).toBe(900);
    fireEvent.mouseUp(document);
  });

  it("pages up or down when the track is clicked outside the thumb", () => {
    render(<Harness />);
    const { host, track, thumb } = getParts();
    mockScrollMetrics(host, { clientHeight: 100, scrollHeight: 1000 });
    host.scrollTop = 100;
    mockRect(track, { top: 0 });
    mockRect(thumb, { top: 60, height: 24 });

    // 点击 thumb 上方 → 向上翻 80% 视口高度
    fireEvent.click(track, { clientY: 10 });
    expect(host.scrollTop).toBe(20);

    // 点击 thumb 下方 → 向下翻 80% 视口高度
    fireEvent.click(track, { clientY: 200 });
    expect(host.scrollTop).toBe(100);
  });

  it("does not scroll when the track is clicked on the thumb itself", () => {
    render(<Harness />);
    const { host, track, thumb } = getParts();
    mockScrollMetrics(host, { clientHeight: 100, scrollHeight: 1000 });
    host.scrollTop = 100;
    mockRect(track, { top: 0 });
    mockRect(thumb, { top: 60, height: 24 });

    fireEvent.click(track, { clientY: 70 });
    expect(host.scrollTop).toBe(100);
  });

  it("removes drag listeners when unmounted mid-drag", () => {
    const { unmount } = render(<Harness />);
    const { host, thumb } = getParts();
    mockScrollMetrics(host, { clientHeight: 100, scrollHeight: 1000 });
    host.scrollTop = 0;

    fireEvent.mouseDown(thumb, { clientY: 50 });
    unmount();

    // 卸载后 document 上的拖拽监听已清理，移动不应再影响滚动位置
    fireEvent.mouseMove(document, { clientY: 100 });
    expect(host.scrollTop).toBe(0);
  });

  it("announces drag start on the scroll container with vellum:scrollbar-drag", () => {
    render(<Harness />);
    const { host, thumb, track } = getParts();
    mockScrollMetrics(host, { clientHeight: 100, scrollHeight: 1000 });

    // 落位守护与程序化动画都需要知道「用户接管了滚动」，而拖 thumb 不产生
    // wheel / touch / keydown，所以下游唯一可依赖的信号就是这个自定义事件
    const events: Event[] = [];
    const onDrag = (event: Event) => events.push(event);
    host.addEventListener("vellum:scrollbar-drag", onDrag);

    fireEvent.mouseDown(thumb, { clientY: 50 });
    expect(events).toHaveLength(1);
    expect(events[0].bubbles).toBe(true);

    // 拖拽中途的移动与 mouseup 不得重复广播（守护只需在接管瞬间让位一次）
    fireEvent.mouseMove(document, { clientY: 120 });
    fireEvent.mouseUp(document);
    expect(events).toHaveLength(1);

    // 轨道翻页点击不属于拖拽，不广播该事件
    fireEvent.click(track, { clientY: 200 });
    expect(events).toHaveLength(1);

    host.removeEventListener("vellum:scrollbar-drag", onDrag);
  });
});
