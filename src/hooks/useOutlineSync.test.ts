import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { useOutlineSync } from "./useOutlineSync";
import type { OutlineHeading } from "../types";

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  root: Element | null = null;
  rootMargin: string = "";
  thresholds: number[] = [];
  observedElements: Element[] = [];
  disconnectMock: () => void;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    if (options) {
      this.root = options.root as Element | null;
      this.rootMargin = options.rootMargin ?? "";
      this.thresholds = Array.isArray(options.threshold) ? options.threshold : [options.threshold ?? 0];
    }
    this.disconnectMock = vi.fn();
  }

  observe(element: Element) {
    this.observedElements.push(element);
  }

  unobserve(element: Element) {
    this.observedElements = this.observedElements.filter((e) => e !== element);
  }

  disconnect() {
    this.observedElements = [];
    this.disconnectMock();
  }

  takeRecords() {
    return [];
  }
}

describe("useOutlineSync", () => {
  let originalIntersectionObserver: typeof IntersectionObserver;
  let observers: MockIntersectionObserver[] = [];

  beforeEach(() => {
    originalIntersectionObserver = window.IntersectionObserver;
    observers = [];

    window.IntersectionObserver = vi.fn(function (callback, options) {
      const observer = new MockIntersectionObserver(callback, options);
      observers.push(observer);
      return observer as unknown as IntersectionObserver;
    }) as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    window.IntersectionObserver = originalIntersectionObserver;
  });

  it("observes rendered heading elements", () => {
    const headings: OutlineHeading[] = [
      { id: "title", level: 1, text: "Title" },
      { id: "section", level: 2, text: "Section" },
    ];

    const container = document.createElement("div");
    container.innerHTML = '<h1 id="title">Title</h1><h2 id="section">Section</h2>';
    document.body.appendChild(container);

    const { result } = renderHook(() => {
      const contentRef = useRef<HTMLDivElement | null>(container as unknown as HTMLDivElement);
      return useOutlineSync(contentRef, headings);
    });

    expect(observers).toHaveLength(1);
    expect(observers[0].observedElements).toHaveLength(2);
    expect(result.current).toBe("title");

    document.body.removeChild(container);
  });

  it("returns undefined when no headings are provided", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const { result } = renderHook(() => {
      const contentRef = useRef<HTMLDivElement | null>(container as unknown as HTMLDivElement);
      return useOutlineSync(contentRef, []);
    });

    expect(observers).toHaveLength(0);
    expect(result.current).toBeUndefined();

    document.body.removeChild(container);
  });

  it("updates active heading when scroll position changes", () => {
    const headings: OutlineHeading[] = [
      { id: "title", level: 1, text: "Title" },
      { id: "section", level: 2, text: "Section" },
    ];

    const container = document.createElement("div");
    container.innerHTML = '<h1 id="title">Title</h1><h2 id="section">Section</h2>';
    document.body.appendChild(container);

    const title = document.getElementById("title")!;
    const section = document.getElementById("section")!;

    let titleTop = 200;
    let sectionTop = 400;

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    vi.spyOn(title, "getBoundingClientRect").mockImplementation(() => ({
      top: titleTop,
      left: 0,
      right: 0,
      bottom: titleTop + 20,
      width: 0,
      height: 20,
      x: 0,
      y: titleTop,
      toJSON: () => {},
    }));

    vi.spyOn(section, "getBoundingClientRect").mockImplementation(() => ({
      top: sectionTop,
      left: 0,
      right: 0,
      bottom: sectionTop + 20,
      width: 0,
      height: 20,
      x: 0,
      y: sectionTop,
      toJSON: () => {},
    }));

    const { result } = renderHook(() => {
      const contentRef = useRef<HTMLDivElement | null>(container as unknown as HTMLDivElement);
      return useOutlineSync(contentRef, headings);
    });

    // 所有标题都在阈值线下方（页面在顶部）：兜底激活第一个标题
    expect(result.current).toBe("title");

    titleTop = 50;
    act(() => {
      observers[0].callback([], observers[0] as unknown as IntersectionObserver);
    });

    expect(result.current).toBe("title");

    titleTop = -100;
    sectionTop = 50;
    act(() => {
      observers[0].callback([], observers[0] as unknown as IntersectionObserver);
    });

    expect(result.current).toBe("section");

    document.body.removeChild(container);
  });

  it("disconnects observer when unmounted", () => {
    const headings: OutlineHeading[] = [{ id: "title", level: 1, text: "Title" }];

    const container = document.createElement("div");
    container.innerHTML = '<h1 id="title">Title</h1>';
    document.body.appendChild(container);

    const { unmount } = renderHook(() => {
      const contentRef = useRef<HTMLDivElement | null>(container as unknown as HTMLDivElement);
      return useOutlineSync(contentRef, headings);
    });

    expect(observers).toHaveLength(1);
    expect(observers[0].disconnectMock).not.toHaveBeenCalled();

    unmount();

    expect(observers[0].disconnectMock).toHaveBeenCalledTimes(1);

    document.body.removeChild(container);
  });

  it("falls back to scroll events when IntersectionObserver is unavailable", () => {
    const mockedObserver = window.IntersectionObserver;
    window.IntersectionObserver = undefined as unknown as typeof IntersectionObserver;

    const headings: OutlineHeading[] = [
      { id: "title", level: 1, text: "Title" },
      { id: "section", level: 2, text: "Section" },
    ];

    const container = document.createElement("div");
    container.innerHTML = '<h1 id="title">Title</h1><h2 id="section">Section</h2>';
    document.body.appendChild(container);

    const title = document.getElementById("title")!;
    const section = document.getElementById("section")!;

    let titleTop = 200;
    let sectionTop = 400;

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    vi.spyOn(title, "getBoundingClientRect").mockImplementation(() => ({
      top: titleTop,
      left: 0,
      right: 0,
      bottom: titleTop + 20,
      width: 0,
      height: 20,
      x: 0,
      y: titleTop,
      toJSON: () => {},
    }));

    vi.spyOn(section, "getBoundingClientRect").mockImplementation(() => ({
      top: sectionTop,
      left: 0,
      right: 0,
      bottom: sectionTop + 20,
      width: 0,
      height: 20,
      x: 0,
      y: sectionTop,
      toJSON: () => {},
    }));

    const { result } = renderHook(() => {
      const contentRef = useRef<HTMLDivElement | null>(container as unknown as HTMLDivElement);
      return useOutlineSync(contentRef, headings);
    });

    // 所有标题都在阈值线下方（页面在顶部）：兜底激活第一个标题
    expect(result.current).toBe("title");

    titleTop = 50;
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toBe("title");

    titleTop = -100;
    sectionTop = 50;
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toBe("section");

    document.body.removeChild(container);
    window.IntersectionObserver = mockedObserver;
  });

  it("clears active heading when headings become empty", () => {
    const container = document.createElement("div");
    container.innerHTML = '<h1 id="title">Title</h1>';
    document.body.appendChild(container);

    const { result, rerender } = renderHook(
      (props: { headings: OutlineHeading[] }) => {
        const contentRef = useRef<HTMLDivElement | null>(container as unknown as HTMLDivElement);
        return useOutlineSync(contentRef, props.headings);
      },
      {
        initialProps: { headings: [{ id: "title", level: 1, text: "Title" }] },
      }
    );

    expect(result.current).toBe("title");

    rerender({ headings: [] });

    expect(result.current).toBeUndefined();

    document.body.removeChild(container);
  });

  it("listens to scroll events even when IntersectionObserver is available", () => {
    const headings: OutlineHeading[] = [
      { id: "title", level: 1, text: "Title" },
      { id: "section", level: 2, text: "Section" },
    ];

    const container = document.createElement("div");
    container.innerHTML = '<h1 id="title">Title</h1><h2 id="section">Section</h2>';
    document.body.appendChild(container);

    const title = document.getElementById("title")!;
    const section = document.getElementById("section")!;

    let titleTop = 200;
    let sectionTop = 400;

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    vi.spyOn(title, "getBoundingClientRect").mockImplementation(() => ({
      top: titleTop,
      left: 0,
      right: 0,
      bottom: titleTop + 20,
      width: 0,
      height: 20,
      x: 0,
      y: titleTop,
      toJSON: () => {},
    }));

    vi.spyOn(section, "getBoundingClientRect").mockImplementation(() => ({
      top: sectionTop,
      left: 0,
      right: 0,
      bottom: sectionTop + 20,
      width: 0,
      height: 20,
      x: 0,
      y: sectionTop,
      toJSON: () => {},
    }));

    const addEventListenerSpy = vi.spyOn(container, "addEventListener");

    const { result } = renderHook(() => {
      const contentRef = useRef<HTMLDivElement | null>(container as unknown as HTMLDivElement);
      return useOutlineSync(contentRef, headings);
    });

    // 所有标题都在阈值线下方（页面在顶部）：兜底激活第一个标题
    expect(result.current).toBe("title");
    expect(addEventListenerSpy).toHaveBeenCalledWith("scroll", expect.any(Function), { passive: true });

    titleTop = 50;
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toBe("title");

    titleTop = -100;
    sectionTop = 50;
    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    expect(result.current).toBe("section");

    document.body.removeChild(container);
    addEventListenerSpy.mockRestore();
  });
});
