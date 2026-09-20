import type { ScrollPositionRecord } from "./scrollMemory";

/**
 * wikilink 前进/后退历史栈。
 *
 * 栈条目 = 离开时那一篇的路径 + 三级阅读位置记录（`scrollMemory.ts` 的记录结构）。
 * 位置随条目一起走，是因为后退要回到「上一篇的原位」而不只是上一篇——落位本身
 * 复用 `scrollRestore.ts` 的既有管线，这里只负责把记录带到那一次加载上。
 *
 * 入栈的判据只有一条：**点 wikilink 换文档**。对话框打开 / 拖放 / 最近列表 /
 * 启动恢复都是「新导航」，不清 back（读了一半另开一篇，仍应能退回来处），只作废
 * forward——forward 记的是「刚才从这里退回去」，新导航之后那条支线不再成立。
 * 后退/前进自身（`source: "history"`）两侧栈都不动，互换由下面的 step* 完成。
 * 同文档锚点跳转与自引用 wikilink 不换文档，压根不经过这里。
 *
 * 两个栈的栈顶方向刻意相反：back 的栈顶在末尾（后退弹最后一个），forward 的栈顶
 * 在开头（前进取第一个，后退时把当前条目 unshift 进去）。这样「后退再前进」得到
 * 的次序与浏览器的历史一致（A→B→C，退到 A 后前进依次是 B、C）。
 */
export type NavEntry = {
  path: string;
  record: ScrollPositionRecord;
};

export type NavHistory = {
  /// 栈顶在末尾
  back: NavEntry[];
  /// 栈顶在开头
  forward: NavEntry[];
};

export const EMPTY_NAV_HISTORY: NavHistory = { back: [], forward: [] };

/** 新导航（wikilink 换文档）：当前条目压入 back，forward 整条作废 */
export function pushNav(history: NavHistory, entry: NavEntry): NavHistory {
  return { back: [...history.back, entry], forward: [] };
}

/**
 * 非 wikilink 的新导航：只作废 forward，保留 back。
 * 本来就是空时返回原引用——`resetForward` 会在每一次打开文档时被调用，
 * 换成新对象等于每次打开都多一次无意义的重渲染。
 */
export function resetForward(history: NavHistory): NavHistory {
  return history.forward.length === 0 ? history : { back: history.back, forward: [] };
}

export type NavStep = {
  history: NavHistory;
  target: NavEntry;
};

/** 后退一步：当前条目进 forward 栈顶，back 栈顶作为目标；无可退时返回 null */
export function stepBack(history: NavHistory, current: NavEntry): NavStep | null {
  const target = history.back[history.back.length - 1];
  if (!target) return null;
  return {
    history: { back: history.back.slice(0, -1), forward: [current, ...history.forward] },
    target,
  };
}

/** 前进一步：当前条目回 back 栈顶，forward 栈顶作为目标；无可进时返回 null */
export function stepForward(history: NavHistory, current: NavEntry): NavStep | null {
  const target = history.forward[0];
  if (!target) return null;
  return {
    history: { back: [...history.back, current], forward: history.forward.slice(1) },
    target,
  };
}
