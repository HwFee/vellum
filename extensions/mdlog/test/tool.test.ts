import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFigureTool, FIGURE_TOOL_NAME } from "../src/tool.ts";
import { expandFigureMarkers, figureMarker } from "../src/figures.ts";
import type { FigureRecord } from "../src/figures.ts";

const HTML = "<!DOCTYPE html>\n<html><body><p>图</p></body></html>";

const ctx = { cwd: "C:/work" } as unknown as ExtensionContext;

/** 渲染只用到 fg/bold；返回纯文本便于断言 */
const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as never;

interface FixtureOptions {
  connected?: boolean;
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
}

function fixture(options: FixtureOptions = {}) {
  const registered: FigureRecord[] = [];
  const tool = createFigureTool({
    isConnected: () => options.connected ?? true,
    register: (record) => registered.push(record),
    takenIds: () => new Set(registered.map((r) => r.id)),
    readFile: options.readFile,
    exists: options.exists,
  });
  return { tool, registered };
}

type Tool = ReturnType<typeof createFigureTool>;

async function run(tool: Tool, params: { path?: string; html?: string; title?: string }) {
  return tool.execute("call-1", params, undefined, undefined, ctx);
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}

describe("vellum_figure：投递", () => {
  test("工具名与描述面向模型（说明等价于 vellum-widget 围栏）", () => {
    const { tool } = fixture();
    assert.equal(tool.name, FIGURE_TOOL_NAME);
    assert.match(tool.description, /vellum-widget/);
    assert.equal(tool.promptGuidelines.length > 0, true);
  });

  test("未连接时拒绝投递并指路（非记录态直接写围栏）", async () => {
    const { tool, registered } = fixture({ connected: false });
    const result = await run(tool, { html: HTML });
    assert.equal(registered.length, 0);
    assert.match(textOf(result), /投递失败/);
    assert.match(textOf(result), /记录连接/);
  });

  test("内联源码：登记 + 回执给出可整枚照抄的标记", async () => {
    const { tool, registered } = fixture();
    const result = await run(tool, { html: HTML, title: "图一" });

    assert.equal(registered.length, 1);
    assert.equal(registered[0].html, HTML);
    assert.equal(registered[0].title, "图一");
    assert.match(registered[0].id, /^[0-9a-z]{4}$/);

    const text = textOf(result);
    assert.equal(text.includes(figureMarker(registered[0].id)), true);
    assert.match(text, /单独成行/);
    assert.equal(result.details?.source, "html");
    assert.equal(result.details?.bytes, Buffer.byteLength(HTML, "utf8"));
  });

  test("回执里的标记真的能展开（回执与写入器同一处定义）", async () => {
    const { tool, registered } = fixture();
    const result = await run(tool, { html: HTML });
    const markerLine = (textOf(result).match(/<!-- mdlog-fig:[^>]+-->/) ?? [])[0];
    assert.ok(markerLine, "回执里应有标记");

    const expanded = expandFigureMarkers(`前\n\n${markerLine}\n\n后`, (id) =>
      registered.find((r) => r.id === id)
    );
    assert.equal(expanded.usedIds.length, 1);
    assert.equal(expanded.text.includes("```vellum-widget"), true);
  });

  test("草稿路径：源码不进对话，从文件读", async () => {
    const expected = path.resolve("C:/work", "draft.html");
    const read: string[] = [];
    const { tool, registered } = fixture({
      exists: (candidate) => candidate === expected,
      readFile: (candidate) => {
        read.push(candidate);
        return HTML;
      },
    });
    const result = await run(tool, { path: "draft.html", title: "草稿图" });

    assert.deepEqual(read, [expected]);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].html, HTML);
    assert.equal(result.details?.source, "path");
  });

  test("草稿不存在 / 扩展名不对 / 读取失败都给出可行动的报错", async () => {
    const missing = fixture({ exists: () => false });
    assert.match(textOf(await run(missing.tool, { path: "nope.html" })), /草稿文件不存在/);

    const wrongExt = fixture();
    assert.match(textOf(await run(wrongExt.tool, { path: "draft.md" })), /扩展名/);

    const unreadable = fixture({
      exists: () => true,
      readFile: () => {
        throw new Error("EPERM");
      },
    });
    assert.match(textOf(await run(unreadable.tool, { path: "draft.html" })), /读取失败/);
  });

  test("非法 HTML 与超限 HTML 都拒绝登记", async () => {
    const { tool, registered } = fixture();

    const fragment = await run(tool, { html: "<div>片段</div>" });
    assert.match(textOf(fragment), /完整 HTML5/);

    const oversized = await run(tool, { html: `<!DOCTYPE html><html>${"x".repeat(512 * 1024)}</html>` });
    assert.match(textOf(oversized), /超过上限/);

    assert.equal(registered.length, 0);
  });

  test("既没给 path 也没给 html 时报错", async () => {
    const { tool } = fixture();
    assert.match(textOf(await run(tool, {})), /path（草稿文件路径）或 html/);
  });

  test("id 与已登记的不冲突", async () => {
    const { tool, registered } = fixture();
    for (let i = 0; i < 8; i++) await run(tool, { html: HTML });
    const ids = registered.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe("vellum_figure：压缩显示（源码不上屏）", () => {
  test("renderCall 只显示标题或草稿文件名，绝不回显源码", () => {
    const { tool } = fixture();

    const withTitle = tool.renderCall({ html: HTML, title: "傅里叶合成" }, theme).render(200).join("\n");
    assert.match(withTitle, /傅里叶合成/);
    assert.equal(withTitle.includes("<html>"), false);

    const withPath = tool
      .renderCall({ path: "C:\\tmp\\drafts\\fig.html" }, theme)
      .render(200)
      .join("\n");
    assert.match(withPath, /fig\.html/);

    const inlineOnly = tool.renderCall({ html: HTML }, theme).render(200).join("\n");
    assert.equal(inlineOnly.includes("<html>"), false);
  });

  test("renderResult 一行：id + 标题 + 体积", async () => {
    const { tool } = fixture();
    const result = await run(tool, { html: HTML, title: "图一" });
    const line = tool.renderResult(result, { expanded: false }, theme).render(200).join("\n");
    assert.match(line, /已投递/);
    assert.equal(line.includes("<html>"), false);
    assert.match(line, new RegExp(String(result.details?.id)));
  });

  test("失败时 renderResult 走错误色分支", async () => {
    const { tool } = fixture({ connected: false });
    const result = await run(tool, { html: HTML });
    const line = tool.renderResult(result, { expanded: false }, theme).render(200).join("\n");
    assert.match(line, /✗/);
    assert.match(line, /记录连接/);
  });
});
