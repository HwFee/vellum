import { describe, expect, it } from "vitest";
import { computeOverlayBox } from "./editorGeometry";

const rect = (top: number, left: number, width: number, height: number) =>
  ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRect;

describe("computeOverlayBox", () => {
  it("按宿主容器换算相对坐标", () => {
    const box = computeOverlayBox(
      rect(300, 40, 700, 120),
      rect(100, 30, 720, 600)
    );
    expect(box).toEqual({ top: 200, left: 10, width: 700, minHeight: 120 });
  });

  it("高度为 0 时给出 1 像素下限", () => {
    const box = computeOverlayBox(rect(300, 40, 700, 0), rect(100, 30, 720, 600));
    expect(box.minHeight).toBe(1);
  });
});
