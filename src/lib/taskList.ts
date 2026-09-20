import type { ListItem, Node, Parent, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { PARSE_OPTIONS } from "./editUnits";

/// 任务列表标记（GFM task list）在源码里的绝对位置。
/// 与块单元同源：都用 PARSE_OPTIONS 的那一套解析定位，故标记偏移与 EditUnit
/// 的区间永远对得上（这是「按绝对偏移回写」的立足点）。
export type TaskMarker = {
  /// 列表项起点（`-` / `*` / `1.` 的偏移）。与 hast 里 <li> 的 position.start.offset
  /// 同源，是「点的是哪一项」的对照物——<input> 自己不带位置（见 taskList 测试）。
  itemStart: number;
  /// 复选框字符（`x` / `X` / 空格）的偏移：翻转只改这一个字符
  offset: number;
  checked: boolean;
};

/// 列表项起点处的任务标记前缀：`- [ ]` / `* [x]` / `+ [X]` / `1. [ ]`。
/// sticky（`y`）匹配，且只在 listItem 的位置上试——因此代码块、正文、原始 HTML 里
/// 字面的 `- [ ]` 不会被当成任务标记（不做全文扫描）。
const TASK_PREFIX = /(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]/y;

/// 读 listItem 起点处的任务标记；不是任务项时返回 null。
function markerAt(markdown: string, itemStart: number): TaskMarker | null {
  TASK_PREFIX.lastIndex = itemStart;
  const match = TASK_PREFIX.exec(markdown);
  if (!match) return null;

  return {
    itemStart,
    // 方括号之间恰好一个字符：从匹配末尾往前数两位就是它
    offset: itemStart + match[0].length - 2,
    checked: match[1] !== " ",
  };
}

function walk(node: Node, markdown: string, out: TaskMarker[]): void {
  if (node.type === "listItem" && typeof (node as ListItem).checked === "boolean") {
    const start = node.position?.start?.offset;
    if (typeof start === "number") {
      const marker = markerAt(markdown, start);
      if (marker) out.push(marker);
    }
  }

  for (const child of (node as Parent).children ?? []) {
    walk(child, markdown, out);
  }
}

/// 全文的任务标记，按源码顺序（mdast 深度优先 == 文档顺序，嵌套列表也不例外）。
///
/// 有意做成**按需调用**（每次点击解析一次）而不是挂进 markdown 的 memo 链：
/// 勾选是低频的用户动作，而每次提交/热重载都多一次全量解析是高频代价——
/// 别把它「优化」成 useMemo(collectTaskMarkers(markdown))。
export function collectTaskMarkers(markdown: string): TaskMarker[] {
  if (!markdown.trim()) return [];

  let root: Root;
  try {
    root = fromMarkdown(markdown, PARSE_OPTIONS) as Root;
  } catch {
    // 防御性分支（与 buildEditUnits 同款）：fromMarkdown 对任意字符串都能产出树、实际不抛，
    // 这里只兜住将来解析器行为变化；该分支不可达、不写测试。
    return [];
  }

  const markers: TaskMarker[] = [];
  walk(root, markdown, markers);
  return markers;
}

/// 勾选时写入的字符：沿用文档里**已有**的勾选风格（出现过 `[X]` 就用大写），
/// 没有先例时用 `[x]`。这样 `- [X]` 的文档在「取消 → 再勾上」的往返里不会被悄悄
/// 改成小写（大小写风格是作者的，不该由一次点击改写）。
function checkedChar(markdown: string, markers: TaskMarker[]): string {
  return markers.some((marker) => marker.checked && markdown[marker.offset] === "X") ? "X" : "x";
}

/// 翻转某个任务列表项：在 [unitStart, unitEnd) 区间内按出现顺序定位「第 N 个任务标记」
/// （N = 区间内排在 itemStart 之前的标记数，即复选框在 DOM 里的顺序），只改写复选框
/// 那一个字符——区间内其余字节与区间外的一切逐字节保留。
///
/// 返回翻转后的**完整原文**；以下情形返回 null，调用方一律静默忽略：
/// - itemStart 不是任务列表项（普通列表项、原始 HTML 里的 <input>）；
/// - itemStart 落在区间外（只读块里的任务列表、DOM 位置与源码对不上）。
export function toggleTaskMarkerInUnit(
  markdown: string,
  unitStart: number,
  unitEnd: number,
  itemStart: number
): string | null {
  const markers = collectTaskMarkers(markdown);
  const inUnit = markers.filter(
    (marker) => marker.itemStart >= unitStart && marker.offset < unitEnd
  );

  const ordinal = inUnit.findIndex((marker) => marker.itemStart === itemStart);
  if (ordinal === -1) return null;

  const target = inUnit[ordinal];
  const value = target.checked ? " " : checkedChar(markdown, markers);

  return markdown.slice(0, target.offset) + value + markdown.slice(target.offset + 1);
}
