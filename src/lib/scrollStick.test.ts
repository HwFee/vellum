import { describe, expect, it } from "vitest";
import { isContainerNearBottom, isNearBottom } from "./scrollStick";

describe("isNearBottom", () => {
  it("returns true when precisely at the bottom or within threshold (<= 80px)", () => {
    expect(isNearBottom(1000, 700, 300, 80)).toBe(true);
    expect(isNearBottom(1000, 650, 300, 80)).toBe(true);
    expect(isNearBottom(1000, 620, 300, 80)).toBe(true);
  });

  it("returns false when distance to bottom exceeds threshold", () => {
    expect(isNearBottom(1000, 619, 300, 80)).toBe(false);
    expect(isNearBottom(1000, 0, 300, 80)).toBe(false);
  });

  it("returns true when content does not overflow (scrollHeight <= clientHeight)", () => {
    expect(isNearBottom(300, 0, 300, 80)).toBe(true);
    expect(isNearBottom(200, 0, 300, 80)).toBe(true);
  });

  it("defaults threshold to 80 when not specified", () => {
    expect(isNearBottom(1000, 620, 300)).toBe(true);
    expect(isNearBottom(1000, 619, 300)).toBe(false);
  });
});

describe("isContainerNearBottom", () => {
  it("computes bottom stickiness from DOM element properties", () => {
    const el = document.createElement("div");
    Object.defineProperty(el, "scrollHeight", { value: 1200, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 750, configurable: true });

    expect(isContainerNearBottom(el, 80)).toBe(true);

    Object.defineProperty(el, "scrollTop", { value: 600, configurable: true });
    expect(isContainerNearBottom(el, 80)).toBe(false);
  });
});
