import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough";
import type { PluggableList } from "unified";

// mdast 节点的最小结构（只声明本文件用到的字段）
type MdastNode = {
  type: string;
  value?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: MdastNode[];
};

// micromark-extension-math 的语法没有 Pandoc 的货币保护规则，会把
// 「价格在 $5 和 $10 之间」里的 $5 和 $ 误判为行内公式。
// 这里按节点位置回查原文，套用 Pandoc 的判定规则：
// 开 $ 后紧跟空格、闭 $ 前是空格、或闭 $ 紧跟 ASCII 数字 → 不是公式，还原为文本。
function remarkMathCurrencyGuard() {
  return (tree: MdastNode, file: { value?: unknown }) => {
    const source = typeof file.value === "string" ? file.value : "";
    if (!source) return;

    function visit(node: MdastNode) {
      if (!node.children) return;
      for (let index = 0; index < node.children.length; index++) {
        const child = node.children[index];
        if (child.type === "inlineMath") {
          const start = child.position?.start.offset;
          const end = child.position?.end.offset;
          if (start !== undefined && end !== undefined && end > start + 1) {
            let openLength = 0;
            while (source[start + openLength] === "$") openLength += 1;
            let closeLength = 0;
            while (source[end - 1 - closeLength] === "$") closeLength += 1;

            const afterOpen = source[start + openLength];
            const beforeClose = source[end - closeLength - 1];
            const afterClose = source[end];

            const looksLikeCurrency =
              afterOpen === " " ||
              afterOpen === "\t" ||
              beforeClose === " " ||
              beforeClose === "\t" ||
              (afterClose !== undefined && afterClose >= "0" && afterClose <= "9");

            if (looksLikeCurrency) {
              node.children[index] = { type: "text", value: source.slice(start, end) };
              continue;
            }
          }
        }
        visit(child);
      }
    }

    visit(tree);
  };
}

// remark 插件列表与文档无关，提升为模块常量，避免每次渲染产生新引用
// remark-cjk-friendly（含 gfm 删除线版）：放宽 CommonMark 强调定界符的 flanking 判定，
// 使 **粗体**(注)、~~删除线~~中文 这类「标点贴 CJK」写法正常渲染（规范原文下会输出字面 **）
export const REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkCjkFriendly,
  remarkCjkFriendlyGfmStrikethrough,
  remarkMath,
  remarkMathCurrencyGuard,
];
