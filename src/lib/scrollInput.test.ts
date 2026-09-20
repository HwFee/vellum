import { describe, expect, it } from "vitest";
import { isScrollInputKey, isScrollKey } from "./scrollInput";

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

describe("isScrollInputKey", () => {
  it("滚动键不带 Alt 才算用户滚动输入", () => {
    for (const key of ["ArrowUp", "ArrowDown", "PageUp", "Home", " ", "Tab"]) {
      expect(isScrollInputKey({ key, altKey: false }), key).toBe(true);
    }
    // 非滚动键与快捷键照旧不算
    for (const key of ["k", "Escape", "Enter"]) {
      expect(isScrollInputKey({ key, altKey: false }), key).toBe(false);
    }
  });

  it("Alt+←/→ 是历史导航，不算滚动输入（否则后退键会取消宽度过渡期的钉住）", () => {
    // 箭头键在滚动清单里，靠 Alt 排除；这一条若散在调用方各写一份，漏一处就静默失效
    expect(isScrollInputKey({ key: "ArrowLeft", altKey: true })).toBe(false);
    expect(isScrollInputKey({ key: "ArrowRight", altKey: true })).toBe(false);
    // 其它修饰键不改变分类（Ctrl+← 之类的滚动意图仍按滚动键算）
    expect(isScrollInputKey({ key: "ArrowLeft", altKey: false })).toBe(true);
  });
});
