import { describe, expect, it, vi } from "vitest";

describe("IntersectionObserver setup mock", () => {
  it("provides global IntersectionObserver with full observer contract", () => {
    expect(globalThis.IntersectionObserver).toBeDefined();

    const callback = vi.fn();
    const observer = new globalThis.IntersectionObserver(callback, {
      rootMargin: "200px",
      threshold: [0, 0.5],
    });

    expect(observer.rootMargin).toBe("200px");
    expect(observer.thresholds).toEqual([0, 0.5]);

    const el = document.createElement("div");
    expect(() => observer.observe(el)).not.toThrow();
    expect(() => observer.unobserve(el)).not.toThrow();
    expect(() => observer.disconnect()).not.toThrow();
    expect(observer.takeRecords()).toEqual([]);
  });
});
