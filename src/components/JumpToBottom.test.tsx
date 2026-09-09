import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JumpToBottom } from "./JumpToBottom";

const animateScrollToMock = vi.fn(
  (_container: HTMLElement, _targetTop: number, _onComplete?: () => void) => () => {}
);

vi.mock("../lib/smoothScroll", () => ({
  animateScrollTo: (container: HTMLElement, targetTop: number, onComplete?: () => void) =>
    animateScrollToMock(container, targetTop, onComplete),
  cancelScrollAnimation: () => {},
}));

function makeContainer(scrollTop: number, scrollHeight: number, clientHeight: number): HTMLElement {
  const el = document.createElement("div");
  let top = scrollTop;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
  return el;
}

describe("JumpToBottom", () => {
  beforeEach(() => {
    animateScrollToMock.mockClear();
  });

  it("距底不超过 300px 时保持隐藏", async () => {
    const container = makeContainer(600, 1000, 400); // 距底 0
    const ref = { current: container };
    const { container: root } = render(<JumpToBottom containerRef={ref} />);
    const button = root.querySelector(".jump-bottom") as HTMLButtonElement;
    expect(button).toBeTruthy();
    // 初次 rAF 计算后仍不可见
    await waitFor(() => {
      expect(button.className).not.toContain("jump-bottom--visible");
    });
    expect(button).toHaveAttribute("aria-hidden", "true");
  });

  it("距底拉开超过 300px 后浮现", async () => {
    const container = makeContainer(100, 1000, 400); // 距底 500
    const ref = { current: container };
    const { getByRole } = render(<JumpToBottom containerRef={ref} />);
    await waitFor(() => {
      expect(getByRole("button", { name: "跳转到底部" })).toHaveClass("jump-bottom--visible");
    });
  });

  it("滚动回底部附近后重新隐藏", async () => {
    const container = makeContainer(100, 1000, 400);
    const ref = { current: container };
    const { container: root, getByRole } = render(<JumpToBottom containerRef={ref} />);
    await waitFor(() =>
      expect(getByRole("button", { name: "跳转到底部" })).toHaveClass("jump-bottom--visible")
    );

    // 滚到距底 1000-400-550=50px
    container.scrollTop = 550;
    fireEvent.scroll(container);
    await waitFor(() => {
      const button = root.querySelector(".jump-bottom") as HTMLButtonElement;
      expect(button.className).not.toContain("jump-bottom--visible");
    });
  });

  it("点击后以缓动滚动到内容底部", async () => {
    const container = makeContainer(100, 1000, 400);
    const ref = { current: container };
    const { getByRole } = render(<JumpToBottom containerRef={ref} />);
    const button = await waitFor(() => {
      const el = getByRole("button", { name: "跳转到底部" });
      expect(el).toHaveClass("jump-bottom--visible");
      return el;
    });
    fireEvent.click(button);
    expect(animateScrollToMock).toHaveBeenCalledWith(container, 600, undefined);
  });

  it("隐藏时从 Tab 序中移除", async () => {
    const container = makeContainer(600, 1000, 400);
    const ref = { current: container };
    const { container: root } = render(<JumpToBottom containerRef={ref} />);
    const button = root.querySelector(".jump-bottom") as HTMLButtonElement;
    await waitFor(() => {
      expect(button).toHaveAttribute("tabindex", "-1");
    });
  });
});
