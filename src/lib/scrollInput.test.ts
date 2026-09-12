import { describe, expect, it } from "vitest";
import { isScrollKey } from "./scrollInput";

describe("isScrollKey", () => {
  it("认会滚动容器的按键", () => {
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " ",
      "Spacebar",
      "Tab",
    ]) {
      expect(isScrollKey(key), key).toBe(true);
    }
  });

  it("快捷键与普通字符键不算滚动输入", () => {
    // Ctrl+K 开侧栏、Ctrl+E 切视图、Ctrl+S 提交、Escape 关侧栏/取消编辑：
    // 误记为滚动输入会让宽度过渡期的视口钉住当场收手（快捷键路径重新跳动）
    for (const key of ["k", "K", "e", "s", "Escape", "a", "Enter", "Shift", "Control"]) {
      expect(isScrollKey(key), key).toBe(false);
    }
  });
});
