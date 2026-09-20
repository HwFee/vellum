import type { Heading, Node, Parent, Root } from "mdast";
import type { HeadingLevel, OutlineHeading } from "../types";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}\-]/gu, "")
      .replace(/-+/g, "-") || "heading"
  );
}

function isParent(node: Node): node is Parent {
  return "children" in node && Array.isArray((node as Parent).children);
}

function isAtxHeading(sourceLines: string[], node: Heading): boolean {
  const lineIndex = (node.position?.start?.line ?? 1) - 1;
  const line = sourceLines[lineIndex] ?? "";
  return /^#{1,6}\s/.test(line.trimStart());
}

export function extractOutline(markdown: string): OutlineHeading[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as Root;

  const headings: OutlineHeading[] = [];
  const usedIds = new Set<string>();
  const lines = markdown.split(/\r?\n/);

  function walk(node: Node) {
    if (node.type === "heading") {
      const heading = node as Heading;
      if (
        heading.depth >= 1 &&
        heading.depth <= 6 &&
        isAtxHeading(lines, heading)
      ) {
        const text = toString(heading).trim();
        let baseId = slugify(text) || "heading";

        let id = baseId;
        let suffix = 1;
        while (usedIds.has(id)) {
          id = `${baseId}-${suffix}`;
          suffix += 1;
        }
        usedIds.add(id);

        headings.push({ id, level: heading.depth as HeadingLevel, text });
      }
    }

    if (isParent(node)) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(tree);
  return headings;
}

export type OutlineNode = OutlineHeading & { children: OutlineNode[] };

export function buildOutlineTree(headings: OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const heading of headings) {
    const node: OutlineNode = { ...heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

/**
 * 把 wikilink 片段（Obsidian 写的是**人读标题原文**，如 `#Day 10`，不是 slug）
 * 落到大纲里的某个标题上。
 *
 * 三条**严格**优先级，全部都只认「整段相等」，绝不做子串/模糊匹配：片段对不上
 * 只是不跳转（读者仍能看到笔记），跳到错的标题却会把人带到另一处内容，比不跳更糟。
 * 1. 逐字节相等（两侧 trim）——语料里 `#Day 10` 这种写法命中同一行；
 * 2. 折叠空白（连续空白归一为单个空格）后大小写不敏感相等（`Day  10` / `day 10`）；
 * 3. slug 相等（`slugify(片段) === 标题 id`），覆盖写成 slug 的片段（`#hello-world`）。
 *
 * 空片段（`[[目标#]]`）与三条全落空都返回 undefined，由调用方退回原有行为。
 */
export function matchHeadingByFragment(
  headings: OutlineHeading[],
  fragment: string
): OutlineHeading | undefined {
  const exact = fragment.trim();
  if (exact === "" || headings.length === 0) return undefined;

  const direct = headings.find((heading) => heading.text.trim() === exact);
  if (direct) return direct;

  const fold = (value: string) => value.replace(/\s+/gu, " ").trim().toLowerCase();
  const folded = fold(exact);
  const normalised = headings.find((heading) => fold(heading.text) === folded);
  if (normalised) return normalised;

  const slug = slugify(exact);
  return headings.find((heading) => heading.id === slug);
}
