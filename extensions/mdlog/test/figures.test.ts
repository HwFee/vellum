import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  MAX_FIGURE_BYTES,
  describeFigure,
  expandFigureMarkers,
  figureFence,
  figureMarker,
  longestBacktickRun,
  makeFigureId,
  pendingFromSnapshot,
  referencedFigureIds,
  replaceFigureMarkersForTranscript,
  resolveDraftPath,
  validateFigureHtml,
} from "../src/figures.ts";
import type { FigureRecord } from "../src/figures.ts";

const HTML = "<!DOCTYPE html>\n<html><body><p>图</p></body></html>";

function record(id: string, html = HTML, title?: string): FigureRecord {
  return { id, html, title, createdAt: 1 };
}

function lookupOf(...records: FigureRecord[]) {
  const map = new Map(records.map((r) => [r.id, r]));
  return (id: string) => map.get(id);
}

describe("figures: 围栏生成", () => {
  test("包成 vellum-widget 围栏并裁掉尾部空白", () => {
    assert.equal(figureFence(`${HTML}\n\n`), "```vellum-widget\n" + HTML + "\n```");
  });

  test("内部有连续反引号时外层围栏自动加长（CommonMark 围栏规则）", () => {
    // 用拼接而非模板串：模板串里出现连续反引号会让 Node 的类型剥离解析器丢同步
    const withBackticks = HTML + "\n<pre>a ``` b</pre>";
    const fence = figureFence(withBackticks);
    assert.equal(fence.startsWith("````vellum-widget\n"), true);
    assert.equal(fence.endsWith("\n````"), true);
    assert.equal(longestBacktickRun("```x````y"), 4);
  });

  test("围栏语言名逐字为 vellum-widget（跨包契约）", () => {
    assert.equal(figureFence(HTML).split("\n")[0], "```vellum-widget");
  });

  test("围栏自身平衡（首行开栏、末行闭栏）", () => {
    const lines = figureFence(HTML).split("\n");
    assert.equal(lines[0], "```vellum-widget");
    assert.equal(lines[lines.length - 1], "```");
  });
});

describe("figures: 标记与展开", () => {
  test("标记形状固定（工具回执与展开共用同一处定义）", () => {
    assert.equal(figureMarker("ab12"), "<!-- mdlog-fig:ab12 -->");
  });

  test("展开成围栏，位置原地不动（引子在前、图注在后）", () => {
    const text = `引子。\n\n${figureMarker("f1")}\n\n图注。`;
    const { text: out, usedIds } = expandFigureMarkers(text, lookupOf(record("f1")));
    assert.deepEqual(usedIds, ["f1"]);
    assert.equal(out.startsWith("引子。\n\n```vellum-widget\n"), true);
    assert.equal(out.endsWith("\n```\n\n图注。"), true);
  });

  test("同一 id 只展开首次，重复出现的位置丢弃", () => {
    const text = `${figureMarker("f1")}\n\n中间\n\n${figureMarker("f1")}`;
    const { text: out, usedIds } = expandFigureMarkers(text, lookupOf(record("f1")));
    assert.deepEqual(usedIds, ["f1"]);
    assert.equal(out.split("```vellum-widget").length - 1, 1);
    assert.equal(out.includes("mdlog-fig"), false);
  });

  test("命中不了记录的标记整枚移除（隐形注释不给读者看）", () => {
    const text = `上文\n\n${figureMarker("nope")}\n\n下文`;
    const { text: out, droppedIds } = expandFigureMarkers(text, lookupOf());
    assert.deepEqual(droppedIds, ["nope"]);
    assert.equal(out.includes("mdlog-fig"), false);
    assert.equal(out.includes("上文"), true);
    assert.equal(out.includes("下文"), true);
  });

  test("标记夹在句子中间时补出行边界（否则围栏被当行内代码、HTML 漏成正文）", () => {
    const text = `见下图 ${figureMarker("f1")} 所示。`;
    const { text: out } = expandFigureMarkers(text, lookupOf(record("f1")));
    assert.equal(out, `见下图 \n\n${figureFence(HTML)}\n\n 所示。`);
    assert.equal(out.split("\n").some((line) => line.startsWith("```vellum-widget")), true);
  });

  test("标记独占一行时原地展开，不额外加空行", () => {
    const text = `上文。\n\n  ${figureMarker("f1")}  \n\n下文。`;
    const { text: out } = expandFigureMarkers(text, lookupOf(record("f1")));
    assert.equal(out, `上文。\n\n  ${figureFence(HTML)}  \n\n下文。`);
  });

  test("无标记时原样返回", () => {
    const text = "纯正文，没有图。";
    assert.equal(expandFigureMarkers(text, lookupOf(record("f1"))).text, text);
  });

  test("回合末兜底只认本批快照：期间新到的图留给下一回合", () => {
    const f1 = record("f1");
    const f2 = record("f2");
    // 快照里有 f1、队列里 f1/f2 → 只补 f1（f2 的标记还在下一回合的正文里）
    assert.deepEqual(pendingFromSnapshot([f1], [f1, f2]).map((f) => f.id), ["f1"]);
    // 快照里的图已被标记展开消费掉（不在队列）→ 不再补写
    assert.deepEqual(pendingFromSnapshot([f1], [f2]), []);
    assert.deepEqual(pendingFromSnapshot([f1], []), []);
  });

  test("referencedFigureIds 去重且保留出现顺序", () => {
    const text = `${figureMarker("b")} ${figureMarker("a")} ${figureMarker("b")}`;
    assert.deepEqual(referencedFigureIds(text), ["b", "a"]);
  });
});

describe("figures: HTML 校验", () => {
  test("接受完整 HTML5 文档", () => {
    assert.equal(validateFigureHtml(HTML).ok, true);
    assert.equal(validateFigureHtml("<html lang=\"zh-CN\"><body>x</body></html>").ok, true);
  });

  test("拒绝空内容与非 HTML 片段", () => {
    assert.equal(validateFigureHtml("   ").ok, false);
    assert.equal(validateFigureHtml("<div>只有片段</div>").ok, false);
  });

  test("超过 512KB 上限时拒绝（与 Vellum widget.rs 同值）", () => {
    const big = `<!DOCTYPE html><html><body>${"x".repeat(MAX_FIGURE_BYTES)}</body></html>`;
    const result = validateFigureHtml(big);
    assert.equal(result.ok, false);
    assert.match(String((result as { error: string }).error), /超过上限/);
  });
});

describe("figures: 草稿路径解析", () => {
  test("相对路径以会话 cwd 为基准", () => {
    const cwd = "C:/work/proj";
    const result = resolveDraftPath("drafts/fig.html", cwd, (p) => p === path.resolve(cwd, "drafts/fig.html"));
    assert.equal(result.exists, true);
    assert.equal(result.resolved, path.resolve(cwd, "drafts/fig.html"));
  });

  test("剥掉引号包裹（Agent 常从 shell 习惯带过来）", () => {
    const cwd = "C:/work";
    const target = path.resolve(cwd, "a b.html");
    const result = resolveDraftPath('"a b.html"', cwd, (p) => p === target);
    assert.equal(result.exists, true);
  });

  test("Git Bash 的 /tmp 在 Windows 下回退到系统临时目录", () => {
    const mapped = path.join(os.tmpdir(), "vellum-widget-draft.html");
    const result = resolveDraftPath("/tmp/vellum-widget-draft.html", "C:/work", (p) => p === mapped);
    assert.equal(result.exists, true);
    assert.equal(result.resolved, mapped);
  });

  test("拒绝非 .html 扩展名、引号与换行", () => {
    assert.match(String(resolveDraftPath("a.md", "C:/w").error), /扩展名/);
    assert.match(String(resolveDraftPath("a\nb.html", "C:/w").error), /非法字符/);
    assert.match(String(resolveDraftPath("  ", "C:/w").error), /为空/);
  });

  test("文件不存在时返回解析结果供报错引用", () => {
    const result = resolveDraftPath("missing.html", "C:/work", () => false);
    assert.equal(result.exists, false);
    assert.equal(result.error, undefined);
    assert.equal(result.resolved, path.resolve("C:/work", "missing.html"));
  });
});

describe("figures: id 与显示", () => {
  test("id 为 4 位 base36", () => {
    const id = makeFigureId();
    assert.match(id, /^[0-9a-z]{4}$/);
  });

  test("注入固定随机源时避开已占用的 id", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 20; i++) taken.add(makeFigureId(Math.random, taken));
    assert.equal(taken.size, 20);
  });

  test("describeFigure 给出标题与体积", () => {
    assert.match(describeFigure(record("f1", HTML, "傅里叶合成")), /^傅里叶合成 · \d+ KB$/);
    assert.match(describeFigure(record("f2")), /^\d+ KB$/);
  });

  test("对话记录里把标记换成一行可读标签（不碰落盘路径）", () => {
    const markdown = `上文\n\n${figureMarker("f1")}\n\n下文`;
    const out = replaceFigureMarkersForTranscript(markdown, lookupOf(record("f1", HTML, "图一")));
    assert.equal(out.includes("mdlog-fig"), false);
    assert.match(out, /▤ \*\*图\*\* · 图一 · \d+ KB/);

    const unknown = replaceFigureMarkersForTranscript(figureMarker("zz"), lookupOf());
    assert.equal(unknown.includes("mdlog-fig"), false);
    assert.match(unknown, /已投递/);
  });
});

describe("figures: 与磁盘的真实交互", () => {
  test("草稿文件按解析出的绝对路径读取", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-fig-"));
    const draft = path.join(dir, "draft.html");
    fs.writeFileSync(draft, HTML, "utf8");
    const result = resolveDraftPath("draft.html", dir);
    assert.equal(result.exists, true);
    assert.equal(fs.readFileSync(result.resolved, "utf8"), HTML);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
