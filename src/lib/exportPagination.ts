/**
 * 导出为 PDF 的预览分页（2026-09-21）。
 *
 * 目标：预览纸页与 Chromium printToPDF 的分页结果一致（预览即所得）。
 * 语义对齐打印管线：
 * - 块不跨页是少数派（代码块 / 表格 / 引用 / 图片有 break-inside: avoid）；
 *   段落是最常见的**可拆分**块——Chromium 按行拆开，页末留几行、次页续几行。
 *   所以这里的分页不是「整块归属」，而是段落按行盒切分（lineBoxes / charOffsetAtLine），
 *   孤行寡行约束与 Chromium 默认一致（orphans/widows = 2）。
 * - 标题不留在页脚（break-after: avoid）：段落整段移走时会带上紧邻的前置标题。
 * - 页首块的上边距在分页处截断（CSS 分段规则：分页断点处的相邻 margin 归零），
 *   段落下半段的克隆同理 marginTop 归零。
 *
 * 这些函数 DOM 耦合（Range / getClientRects），jsdom 里量不到真实行盒——
 * 行为验证走真机（docs/agents/rendering.md 的导出节），单元测试只守纯几何部分。
 */

/// 同一行的判定容差（px）：inline 片段的 rect 顶边有亚像素抖动
const LINE_EPS = 1;
/// 孤行 / 寡行约束：与 Chromium 打印默认值一致
const ORPHANS = 2;
const WIDOWS = 2;

/** 待分页的块：相对正文容器顶部的纵坐标与高度（CSS px）；段落的下半段带 fromChar */
export interface PaginationBlock {
  el: HTMLElement;
  top: number;
  height: number;
  /** 段落拆分后下半段的起始字符偏移（块内 text 节点文档序累计） */
  fromChar?: number;
}

/** 一页的内容：若干片段。整块的 fromChar/toChar 为空；段落拆片段带区间 */
export interface PageSegment {
  el: HTMLElement;
  fromChar?: number;
  toChar?: number;
  /** 分页簿记：块在连续流里的顶坐标（标题随块换页时回顶要用；渲染侧忽略） */
  top: number;
}

/**
 * 块的行盒序列（相对块顶的 top/bottom，已按行合并 inline 片段）。
 * Range.getClientRects 对每个行内片段各给一枚 rect：纯文本段落一行一枚，
 * 夹着 inline 元素（code/em/链接）的行会有多枚——同 top 合并、底取最大。
 */
export function lineBoxes(el: HTMLElement): Array<{ top: number; bottom: number }> {
  const range = document.createRange();
  range.selectNodeContents(el);
  const base = el.getBoundingClientRect().top;
  const lines: Array<{ top: number; bottom: number }> = [];
  for (const rect of Array.from(range.getClientRects())) {
    const top = rect.top - base;
    const bottom = rect.bottom - base;
    const last = lines[lines.length - 1];
    if (last && Math.abs(top - last.top) < LINE_EPS) {
      last.bottom = Math.max(last.bottom, bottom);
    } else {
      lines.push({ top, bottom });
    }
  }
  return lines;
}

/**
 * 段落内指定行（相对块顶的 top）起点处的块内累计字符偏移。
 * 逐 text 节点找落在该行的片段，再在节点内二分首个落在该行的字符。
 * 找不到（行盒抖动等）返回块尾——调用方视为不可拆。
 */
export function charOffsetAtLine(el: HTMLElement, lineTop: number): number {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const base = el.getBoundingClientRect().top;
  let cumulative = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    range.selectNodeContents(node);
    const onLine = Array.from(range.getClientRects()).some(
      (rect) => Math.abs(rect.top - base - lineTop) < LINE_EPS
    );
    if (onLine) {
      let lo = 0;
      let hi = node.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        range.setStart(node, mid);
        range.setEnd(node, Math.min(node.length, mid + 1));
        const rect = range.getClientRects()[0];
        if (rect && rect.top - base >= lineTop - LINE_EPS) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      return cumulative + lo;
    }
    cumulative += node.length;
    node = walker.nextNode() as Text | null;
  }
  return cumulative;
}

/** 把克隆裁到 [fromChar, toChar) 字符区间（与 charOffsetAtLine 同一套累计口径） */
export function trimCloneToChars(clone: HTMLElement, fromChar: number, toChar: number): void {
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  let pos = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const start = pos;
    const end = pos + node.length;
    const keepStart = Math.max(0, Math.min(node.length, fromChar - start));
    const keepEnd = Math.max(keepStart, Math.min(node.length, toChar - start));
    if (keepStart > 0 || keepEnd < node.length) {
      node.data = node.data.slice(keepStart, keepEnd);
    }
    pos = end;
    node = walker.nextNode() as Text | null;
  }
}

const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/**
 * 预览分页主流程（就地消耗 blocks 队列——调用方每次重建都重新测量，不复用入参）。
 * 返回每页的片段序列；空块列返回空数组（调用方不渲染纸页）。
 */
export function paginatePreview(
  blocks: PaginationBlock[],
  contentHeight: number,
  firstPageTopInset = 0
): PageSegment[][] {
  const pages: PageSegment[][] = [];
  if (blocks.length === 0) return pages;

  let segments: PageSegment[] = [];
  // 首页页顶：首块的上边距不截断（文档起点不是分页断点），可用高度减去这块留白
  let pageTop = blocks[0].top - firstPageTopInset;
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];
    const pageBottom = pageTop + contentHeight;
    const bottom = block.top + block.height;

    if (bottom <= pageBottom + LINE_EPS) {
      segments.push({ el: block.el, fromChar: block.fromChar, top: block.top });
      i++;
      continue;
    }

    // 放不下：段落按行拆（孤行寡行约束内），下半段合成新块进入下一轮
    if (block.el.tagName === "P") {
      const lines = lineBoxes(block.el);
      const fitCount = lines.filter((line) => block.top + line.bottom <= pageBottom + LINE_EPS).length;
      const k = Math.min(fitCount, lines.length - WIDOWS);
      if (k >= ORPHANS && k < lines.length) {
        const cut = charOffsetAtLine(block.el, lines[k].top);
        if (cut > (block.fromChar ?? 0)) {
          segments.push({ el: block.el, fromChar: block.fromChar, toChar: cut, top: block.top });
          pages.push(segments);
          segments = [];
          // 下半段：从新页页顶起算（上边距截断），高度 = 剩余行盒跨度
          blocks[i] = {
            el: block.el,
            top: pageBottom,
            height: block.height - lines[k].top,
            fromChar: cut,
          };
          pageTop = pageBottom;
          continue;
        }
      }
    }

    // 不可拆（或拆不动）：整块移下一页。标题不留在页脚——上一页末尾若是标题，
    // 它随本块一起走（break-after: avoid 的预览语义）；页里只剩标题一枚时除外
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      if (segments.length > 1 && HEADING_TAGS.has(last.el.tagName)) {
        const heading = segments.pop()!;
        pages.push(segments);
        segments = [heading];
        // pageTop 以被带走的标题顶为准：本块相对它的位置在连续流里不变
        pageTop = last.top;
        continue;
      }
      pages.push(segments);
      segments = [];
      pageTop = block.top;
      continue;
    }

    // 页是空的还放不下（比页高的孤块）：独占一页（预览截断显示；
    // 真实 PDF 里非段落孤块由 Chromium 自行处理，这里不摹）
    segments.push({ el: block.el, fromChar: block.fromChar, top: block.top });
    pages.push(segments);
    segments = [];
    i++;
    if (i < blocks.length) pageTop = blocks[i].top;
  }

  if (segments.length > 0) pages.push(segments);
  return pages;
}
