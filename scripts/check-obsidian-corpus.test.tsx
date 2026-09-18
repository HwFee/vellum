/**
 * Obsidian 全库语料检查：把 wisdom 笔记库的**每一篇** `.md` 走一遍**真实渲染管线**，
 * 证明没有 Obsidian 专有语法被留在「未处理」状态，并打印每一族语法的识别计数。
 *
 * 为什么必须是 vitest 里的 `.tsx`（而不是一个 node 脚本）：这里要渲染的是
 * `MarkdownDocument.tsx` 本身——remark/rehype 插件链、`components` 覆盖渲染、
 * KaTeX、懒加载语言包全都只有 vitest 能跑起来。另起一个 standalone 脚本等于把
 * 管线重写一遍，检查的就不再是「应用看到的东西」了。
 *
 * ── 三族语法的「已处理」判据（每一族都是**源码侧 × 渲染侧**两道闸）────────────
 *
 * - **frontmatter**：文首 `---` 围栏必须渲染成 `div.md-props` 属性卡，且正文里
 *   不再有原始 YAML 键行。
 * - **wikilink**：① 渲染后的正文（`code`/`pre` 子树除外）里不再有**字形完整**的
 *   `[[…]]`；② 源码侧抽取出的每一个目标都必须在 DOM 里对应一枚
 *   `[data-wikilink]`——`[[ **加粗** 目标]]` 这种被行内标记切成多个文本节点的
 *   漏网之鱼只有 ② 抓得到。
 * - **callout**：① 正文里不再有字面标记行 `[!type]`；② 源码侧认出的标记行数
 *   必须等于 DOM 里 `[data-callout]` 的个数（一个静默退化成普通引用的提示块
 *   只有 ② 抓得到）。
 *
 * 判据里的两个正则**直接复用实现侧的那一份**（`WIKILINK_RE` /
 * `extractWikilinkTargets`）：检查器若自带一套「什么算 wikilink」的定义，两边就会
 * 各自漂移，检查通过只能证明两套正则碰巧一致。
 *
 * ── 两处偏离任务书的地方（都是被真实语料逼出来的，证据留在下面）────────────
 *
 * 1. **方括号不做裸子串判定，改用「字形完整的 wikilink 候选」**。任务书写的是
 *    「正文里不出现字面 `[[` / `]]`」，但库里 6 处非代码文本节点含方括号，全都是
 *    **引用块里没加围栏的 numpy / 矩阵字面量**，例如
 *    `notes/2026-09-11.md` 引用块里的 `np.array([[1.0, 2.0, …]])`、
 *    `Logs/2026-08-01.md` 散文里的手算矩阵 `[[7 10] [15 22]]`。
 *    这些**不是 Obsidian 语法**：括号套括号的形态实现侧与 Obsidian 都不会认成链接
 *    （`splitWikilinks` 对空目标/畸形目标按纯文本留下，这是有测试锁定的既定行为）。
 *    裸子串判定会让检查器报 6 个假阳性、把守则变成噪音，故改为按实现侧的
 *    `WIKILINK_RE` 判「是不是一个本该成锚点的候选」；那 6 处仍被统计并以
 *    「方括号字面量（非 wikilink 形态）」的名义打印出来，绝不藏起来。
 * 2. **不传 `wikilinks` 表**。解析目标→路径是 Rust 侧 `resolve_wikilinks` 的活，
 *    语料检查要能脱开 IPC 独立跑；不传表时 `components.a` 渲染惰性锚点，形状与
 *    已解析时一致（本文件只关心「方括号有没有留在文本里」）。
 *
 * 另外两条自我约束：**库不存在就整体跳过**（这个文件会被每台机器的 `npm test`
 * 拾取，没有 wisdom 库的机器必须看到「跳过」而不是一片红）；**检查器绝不改产品
 * 代码**——失败即报告，不为了让数字好看去放宽判据。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownDocument } from "../src/components/MarkdownDocument";
import { extractWikilinkTargets, WIKILINK_RE } from "../src/lib/wikilink";
import { parseFrontmatter } from "../src/lib/frontmatter";

// 与 MarkdownDocument.test.tsx 逐项对齐的 mocking：真实管线会碰 Tauri IPC
// （外链 opener、widget 注册、图片资源解析），jsdom 里没有这些东西。
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

/// 语料库路径可用环境变量覆盖（换库、或指向一份语料样本时不必改代码）
const VAULT_ROOT = process.env.VELLUM_VAULT ?? "C:/Users/17445/Desktop/wisdom";

/// 递归时跳过的目录名：点目录（`.obsidian` 等）与依赖目录都不是笔记
const SKIP_DIR_NAMES = new Set(["node_modules"]);

/// 单篇渲染的超时：库里有 ~190KB 的会话日志（含几十个 widget 围栏），
/// 默认 5s 会假性失败；给足两分钟，真出问题时报的是断言而不是超时。
const RENDER_TIMEOUT_MS = 120_000;

/// 报告区最多列几行细节（汇总数字永远是全量的）
const MAX_REPORTED_DETAILS = 20;

function walkMarkdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || SKIP_DIR_NAMES.has(entry.name)) continue;
      found.push(...walkMarkdownFiles(join(dir, entry.name)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

type CorpusFile = { rel: string; abs: string };

const vaultExists = existsSync(VAULT_ROOT);
const corpus: CorpusFile[] = vaultExists
  ? walkMarkdownFiles(VAULT_ROOT)
      .sort()
      .map((abs) => ({ rel: relative(VAULT_ROOT, abs).replace(/\\/g, "/"), abs }))
  : [];

type Family = "frontmatter" | "wikilink" | "callout";
type Finding = { rel: string; family: Family; snippet: string };

/// 文本节点级的判据：**去掉 `g` 标志**。带 `g` 的正则 `.test()` 会在多次调用之间
/// 保留 `lastIndex`，逐节点扫描时会跳过下一个节点前半段里的匹配（静默假阴性）；
/// 判据本身与实现侧的 `WIKILINK_RE` 仍是同一份 source，只是不带状态。
const WIKILINK_CANDIDATE_RE = new RegExp(WIKILINK_RE.source);

/// `m` 覆盖真实语料形态：标记行与正文行同处一个文本节点（软换行），
/// 标题必须以空白引入且折叠符可选——与 `rehypeObsidian` 的标记判定同形。
const CALLOUT_MARKER_RE = /^[ \t]*\[![A-Za-z][A-Za-z0-9_-]*\][-+]?(?:[ \t]|$)/m;

/// 源码侧的 callout 标记行（含引用前缀；嵌套引用 `> > [!tip]` 同样认得）。
/// 与文本节点判据同形，只是多了引用前缀——认得太宽会把「实现侧刻意不装饰」
/// 的写法（如 `[!tip]标题` 无分隔）也计入分母，那正是假阳性的来源。
const CALLOUT_SOURCE_LINE_RE = /^[ \t]*>[ \t]*(?:>[ \t]*)*\[![A-Za-z][A-Za-z0-9_-]*\][-+]?(?:[ \t]+.*)?$/;

/// 原始 YAML 键行。只在**文本节点自身**上匹配（而不是整篇的 textContent）：
/// 属性卡的键名与值是两个元素，节点拼起来是「date2026-06-20」这种不含冒号的形式，
/// 因此这条只可能命中「整块 YAML 被当正文渲染」的老行为。
const RAW_YAML_KEY_RE =
  /^(?:date|updated|type|tags|sources|related|confidence|status|ai-first)[ \t]*:/m;

/// 文首围栏（允许 BOM 与 CRLF）。判据与 `parseFrontmatter` 的首行判定同源，
/// 但不受「围栏未闭合」影响——那种文档同样必须没有原始 YAML 漏进正文。
const LEADING_FENCE_RE = /^\uFEFF?---[ \t]*\r?\n/;

/// 语料级计数（模块级累加，最后一个用例负责打印与判定完成条件）
const stats = {
  scanned: 0,
  fenced: 0,
  filesWithCard: 0,
  wikilinkAnchors: 0,
  sourceTargets: 0,
  filesWithWikilink: 0,
  callouts: 0,
  calloutMarkers: 0,
  filesWithCallout: 0,
  calloutsByType: new Map<string, number>(),
  bracketLiterals: 0,
  filesWithBracketLiterals: 0,
};

const unhandled: Finding[] = [];
/// 报告用（**不**参与失败判定）：含方括号但不构成 wikilink 候选的文本节点，
/// 例如引用块里没加围栏的 `np.array([[1.0, …]])`。打印出来供人复核。
const bracketLiteralNotes: Finding[] = [];

function scanText(
  node: Node,
  inCode: boolean,
  visit: (value: string, inCode: boolean) => void
): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      visit(child.nodeValue ?? "", inCode);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    scanText(element, inCode || element.tagName === "CODE" || element.tagName === "PRE", visit);
  }
}

function snippetOf(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

function formatFinding(finding: Finding): string {
  return `${finding.rel} :: ${finding.snippet}`;
}

function countMatches(source: string, re: RegExp): number {
  return source.match(new RegExp(re.source, "gm"))?.length ?? 0;
}

function inspectFile(rel: string, source: string, container: HTMLElement): Finding[] {
  const findings: Finding[] = [];
  stats.scanned += 1;

  // ── frontmatter：文首围栏必须成卡，且不能有原始 YAML 键行漏进正文 ──────────
  const frontmatter = parseFrontmatter(source);
  const hasFence = LEADING_FENCE_RE.test(source);
  const card = container.querySelector(".md-props");

  if (hasFence) {
    stats.fenced += 1;
    if (card) {
      stats.filesWithCard += 1;
    } else if (frontmatter.fields.length > 0) {
      // 空块（`---\n---`）按设计整块丢掉、不留空卡片，故只在有字段时才要求成卡
      findings.push({
        rel,
        family: "frontmatter",
        snippet: "文首 --- 围栏未渲染成 .md-props 属性卡",
      });
    }
  }

  // ── 文本节点：三族语法的字面残留 ────────────────────────────────────────
  let fileBracketLiterals = 0;

  scanText(container, false, (value, inCode) => {
    if (inCode || value.trim() === "") return;

    if (WIKILINK_CANDIDATE_RE.test(value)) {
      findings.push({ rel, family: "wikilink", snippet: snippetOf(value) });
    } else if (value.includes("[[") || value.includes("]]")) {
      // 不是 wikilink 候选（括号套括号、未闭合），只登记不判定
      fileBracketLiterals += 1;
      bracketLiteralNotes.push({ rel, family: "wikilink", snippet: snippetOf(value) });
    }
    if (CALLOUT_MARKER_RE.test(value)) {
      findings.push({ rel, family: "callout", snippet: snippetOf(value) });
    }
    if (hasFence && RAW_YAML_KEY_RE.test(value)) {
      findings.push({ rel, family: "frontmatter", snippet: snippetOf(value) });
    }
  });

  if (fileBracketLiterals > 0) {
    stats.bracketLiterals += fileBracketLiterals;
    stats.filesWithBracketLiterals += 1;
  }

  // ── wikilink：源码抽出过的每个目标都必须落成一枚 [data-wikilink] ──────────
  // 跨文本节点的候选（`[[**粗**目标]]`、`[[目标]]` 被行内标记切开）不会被上面的
  // 节点级判定看见，这里用「源码目标集 ⊆ DOM 目标集」补上。
  const renderedTargets = new Set(
    Array.from(container.querySelectorAll("[data-wikilink]")).map(
      (element) => element.getAttribute("data-wikilink") ?? ""
    )
  );
  const sourceTargets = extractWikilinkTargets(source);
  stats.sourceTargets += sourceTargets.length;

  const missingTargets = sourceTargets.filter((target) => !renderedTargets.has(target));
  if (missingTargets.length > 0) {
    findings.push({
      rel,
      family: "wikilink",
      snippet: `源码里有目标未渲染成锚点：${missingTargets.slice(0, 5).join(" / ")}`,
    });
  }

  const anchors = container.querySelectorAll(".wikilink").length;
  if (anchors > 0) {
    stats.wikilinkAnchors += anchors;
    stats.filesWithWikilink += 1;
  }

  // ── callout：源码标记行数必须等于装饰出的提示块数 ───────────────────────
  const callouts = container.querySelectorAll("[data-callout]");
  const markers = countMatches(source, CALLOUT_SOURCE_LINE_RE);
  stats.calloutMarkers += markers;
  stats.callouts += callouts.length;

  if (callouts.length > 0) {
    stats.filesWithCallout += 1;
    for (const callout of callouts) {
      const type = callout.getAttribute("data-callout") ?? "(缺属性)";
      stats.calloutsByType.set(type, (stats.calloutsByType.get(type) ?? 0) + 1);
    }
  }

  if (markers !== callouts.length) {
    findings.push({
      rel,
      family: "callout",
      snippet: `源码标记行 ${markers} 处，渲染出的提示块 ${callouts.length} 个`,
    });
  }

  return findings;
}

function formatCalloutTypes(): string {
  const entries = Array.from(stats.calloutsByType.entries()).sort((a, b) => b[1] - a[1]);
  return entries.length === 0 ? "无" : entries.map(([type, count]) => `${type} ${count}`).join(" / ");
}

/// 覆盖率（family 出现在多少篇文档里 / 扫了多少篇）——单纯的总数看不出「是不是
/// 只有一两篇命中」，行级比率能把漂移暴露出来。
function fileRate(files: number, total: number): string {
  if (total === 0) return "0/0";
  return `${files}/${total}（${Math.round((files / total) * 100)}%）`;
}

describe.skipIf(!vaultExists || corpus.length === 0)(
  `Obsidian 全库语料检查 · ${VAULT_ROOT}`,
  () => {
    it.each(corpus)("$rel 渲染后无未处理的 Obsidian 语法", async ({ rel, abs }) => {
      const source = readFileSync(abs, "utf8");
      const view = render(<MarkdownDocument markdown={source} />);
      // 让按需加载的高亮语言包在 act 内完成，避免 act(...) 警告
      await act(async () => {});

      const findings = inspectFile(rel, source, view.container);
      unhandled.push(...findings);

      // 断言放在计数之后：即便这一篇挂了，最后一个用例的汇总仍是完整的
      expect(findings.map(formatFinding), rel).toEqual([]);
    }, RENDER_TIMEOUT_MS);

    it("全库汇总：三族语法各有识别计数，未处理构造数必须为 0", () => {
      const summary = [
        `语料检查：扫描 ${stats.scanned} 篇`,
        `frontmatter：文首围栏 ${stats.fenced} 篇 · 属性卡 ${stats.filesWithCard} 篇`,
        `wikilink：锚点 ${stats.wikilinkAnchors} 个（${fileRate(stats.filesWithWikilink, stats.scanned)}）· 源码目标 ${stats.sourceTargets} 个（全部落成锚点）`,
        `callout：${stats.callouts} 个 / 源码标记行 ${stats.calloutMarkers} 处（${fileRate(stats.filesWithCallout, stats.scanned)}）：${formatCalloutTypes()}`,
        `方括号字面量（非 wikilink 形态，仅报告不计入未处理）：${stats.bracketLiterals} 处 / ${stats.filesWithBracketLiterals} 篇`,
        `未处理构造 ${unhandled.length}`,
      ];
      console.log(summary.join("\n"));

      for (const note of bracketLiteralNotes.slice(0, MAX_REPORTED_DETAILS)) {
        console.log(`报告（非未处理）:: ${formatFinding(note)}`);
      }
      for (const finding of unhandled) {
        console.log(`未处理 :: ${formatFinding(finding)}`);
      }

      expect(unhandled.map(formatFinding)).toEqual([]);
    });
  }
);
