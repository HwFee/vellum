import { describe, expect, it } from "vitest";
import {
  EXPORT_CONTENT_HEIGHT_PX,
  EXPORT_CONTENT_WIDTH_PX,
  EXPORT_PAGE,
  MM_TO_CSS_PX,
} from "./exportLayout";

describe("导出页面几何（上游 kami 模板常量）", () => {
  it("A4 纵向 + 边距 20mm/22mm，版心 = 纸面减边距", () => {
    expect(EXPORT_PAGE.widthPx).toBeCloseTo(210 * MM_TO_CSS_PX, 6);
    expect(EXPORT_PAGE.heightPx).toBeCloseTo(297 * MM_TO_CSS_PX, 6);
    expect(EXPORT_CONTENT_WIDTH_PX).toBeCloseTo(166 * MM_TO_CSS_PX, 6);
    expect(EXPORT_CONTENT_HEIGHT_PX).toBeCloseTo(257 * MM_TO_CSS_PX, 6);
  });
});
