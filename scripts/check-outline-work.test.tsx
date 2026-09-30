import { act, renderHook } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import { useOutlineSync } from "../src/hooks/useOutlineSync";
import type { OutlineHeading } from "../src/types";

test("outline event bursts retain the latest position with bounded geometry work", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  let onIntersection: IntersectionObserverCallback | undefined;
  let reads = 0;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const headings: OutlineHeading[] = Array.from({ length: 200 }, (_, index) => ({
    id: `outline-work-${index}`,
    level: 2,
    text: `Heading ${index}`,
  }));
  const box = (top: number) => ({
    top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20,
    x: 0, y: top, toJSON: () => ({}),
  });
  host.getBoundingClientRect = () => box(0);
  for (const [index, heading] of headings.entries()) {
    const element = document.createElement("h2");
    element.id = heading.id;
    element.getBoundingClientRect = () => {
      reads += 1;
      return box(index * 24 - host.scrollTop);
    };
    host.appendChild(element);
  }
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  const observer = vi.spyOn(window, "IntersectionObserver").mockImplementation(function (callback) {
    onIntersection = callback;
    return {
      observe() {}, unobserve() {}, disconnect() {}, takeRecords: () => [],
      root: host, rootMargin: "", scrollMargin: "", thresholds: [0],
    };
  });
  let unmount: (() => void) | undefined;
  const hostRef = { current: host };
  try {
    const rendered = renderHook(() => useOutlineSync(hostRef, headings));
    unmount = rendered.unmount;
    expect(rendered.result.current).toBe("outline-work-3");
    reads = 0;
    act(() => {
      for (let index = 0; index < 20; index += 1) {
        host.scrollTop = 1500;
        host.dispatchEvent(new Event("scroll"));
        onIntersection?.([], {} as IntersectionObserver);
      }
    });
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(16);
    });
    expect(rendered.result.current).toBe("outline-work-65");
    const stage = process.env.VELLUM_PERF_STAGE;
    if (stage === "before" || stage === "after") {
      expect(reads).toBe(stage === "before" ? 8000 : 200);
      writeFileSync(`outputs/outline-work-${stage}.json`, JSON.stringify({
        stage, headings: 200, scrollEvents: 20, intersectionCallbacks: 20,
        headingGeometryReads: reads, activeHeading: rendered.result.current,
      }, null, 2) + "\n");
    }
  } finally {
    unmount?.();
    observer.mockRestore();
    cancel.mockRestore();
    raf.mockRestore();
    host.remove();
  }
});
