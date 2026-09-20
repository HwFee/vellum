import { describe, expect, it } from "vitest";
import {
  EMPTY_NAV_HISTORY,
  pushNav,
  resetForward,
  stepBack,
  stepForward,
  type NavEntry,
  type NavHistory,
} from "./navHistory";

/** 条目构造：位置记录只填 ratio——栈行为与记录内容无关 */
function entry(path: string, ratio = 0): NavEntry {
  return { path, record: { ratio } };
}

/// A → B → C 依次点 wikilink 换文档后的历史：当前在 C，back 栈底到栈顶是 A、B
function afterWikilinkTrail(): NavHistory {
  return pushNav(pushNav(EMPTY_NAV_HISTORY, entry("a.md", 0.1)), entry("b.md", 0.2));
}

describe("navHistory", () => {
  it("wikilink 换文档：当前条目压入 back，并清空 forward", () => {
    const withForward = { back: [entry("a.md")], forward: [entry("z.md")] };
    const next = pushNav(withForward, entry("b.md", 0.4));

    expect(next.back.map((item) => item.path)).toEqual(["a.md", "b.md"]);
    expect(next.forward).toEqual([]);
    // 纯函数：入参不被改写
    expect(withForward.back).toHaveLength(1);
    expect(withForward.forward).toHaveLength(1);
  });

  it("后退：back 栈顶成为目标，当前条目进 forward 栈顶", () => {
    const step = stepBack(afterWikilinkTrail(), entry("c.md", 0.3));

    expect(step?.target.path).toBe("b.md");
    expect(step?.target.record).toEqual({ ratio: 0.2 });
    expect(step?.history.back.map((item) => item.path)).toEqual(["a.md"]);
    expect(step?.history.forward.map((item) => item.path)).toEqual(["c.md"]);
  });

  it("前进：forward 栈顶成为目标，当前条目回 back 栈顶", () => {
    const step = stepForward(
      { back: [], forward: [entry("b.md", 0.2), entry("c.md", 0.3)] },
      entry("a.md", 0.1)
    );

    expect(step?.target.path).toBe("b.md");
    expect(step?.history.back.map((item) => item.path)).toEqual(["a.md"]);
    expect(step?.history.forward.map((item) => item.path)).toEqual(["c.md"]);
  });

  it("后退再前进回到同一处：A→B→C 退到底后前进依次是 B、C", () => {
    let history = afterWikilinkTrail();

    // 在 C 上连按两次后退：目标依次是 B、A
    const backOnce = stepBack(history, entry("c.md", 0.3))!;
    history = backOnce.history;
    expect(backOnce.target.path).toBe("b.md");

    const backTwice = stepBack(history, entry("b.md", 0.2))!;
    history = backTwice.history;
    expect(backTwice.target.path).toBe("a.md");
    expect(history.back).toEqual([]);

    // 从 A 连按两次前进：目标依次是 B、C，位置记录原样带回
    const forwardOnce = stepForward(history, entry("a.md", 0.1))!;
    history = forwardOnce.history;
    expect(forwardOnce.target.path).toBe("b.md");
    expect(forwardOnce.target.record).toEqual({ ratio: 0.2 });

    const forwardTwice = stepForward(history, entry("b.md", 0.2))!;
    history = forwardTwice.history;
    expect(forwardTwice.target.path).toBe("c.md");
    expect(history.forward).toEqual([]);
    expect(history.back.map((item) => item.path)).toEqual(["a.md", "b.md"]);
  });

  it("后退到底 / 前进到头：无可走时返回 null（按钮禁用态的判据）", () => {
    expect(stepBack(EMPTY_NAV_HISTORY, entry("a.md"))).toBeNull();
    expect(stepForward(EMPTY_NAV_HISTORY, entry("a.md"))).toBeNull();
    expect(stepForward({ back: [entry("a.md")], forward: [] }, entry("a.md"))).toBeNull();
  });

  it("新导航（非 wikilink）：只作废 forward，back 保留", () => {
    const history = { back: [entry("a.md"), entry("b.md")], forward: [entry("z.md")] };
    const next = resetForward(history);

    expect(next.back.map((item) => item.path)).toEqual(["a.md", "b.md"]);
    expect(next.forward).toEqual([]);
  });

  it("forward 本来就空时返回原引用（打开文档不该平白多一次重渲染）", () => {
    const history = { back: [entry("a.md")], forward: [] };
    expect(resetForward(history)).toBe(history);
    expect(resetForward(EMPTY_NAV_HISTORY)).toBe(EMPTY_NAV_HISTORY);
  });
});
