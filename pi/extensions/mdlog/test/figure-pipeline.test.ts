import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LiveLogWriter } from "../src/writer.ts";
import { figureMarker } from "../src/figures.ts";
import type { FigureRecord } from "../src/figures.ts";
import type { SessionManagerLike } from "../src/types.ts";

const HTML = "<!DOCTYPE html>\n<html><body><p>图</p></body></html>";

function figure(id: string, title?: string): FigureRecord {
  return { id, html: HTML, title, createdAt: 1 };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-figpipe-"));
}

function makeSession(cwd: string): SessionManagerLike {
  return { getBranch: () => [], getCwd: () => cwd, getSessionId: () => "sess-1" };
}

function assistantMessage(text: string) {
  return { role: "assistant", content: text, timestamp: Date.now() };
}

function makeWriter(dir: string, figures: FigureRecord[]) {
  const file = path.join(dir, "live.md");
  fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");
  const map = new Map(figures.map((f) => [f.id, f]));
  const writer = new LiveLogWriter({
    filePath: file,
    sessionId: "sess-1",
    sessionManager: makeSession(dir),
    figureLookup: (id) => map.get(id),
  });
  return { file, writer, read: () => fs.readFileSync(file, "utf8") };
}

describe("图示投递：写入器管线", () => {
  test("正文里的标记原地展开成围栏（引子 → 图 → 图注）", async () => {
    const dir = tmpDir();
    const { writer, read } = makeWriter(dir, [figure("f1", "图一")]);

    writer.enqueueMessage({
      message: assistantMessage(`引子。\n\n${figureMarker("f1")}\n\n图注。`),
    });
    await writer.flush({ turnEnd: true });

    const content = read();
    assert.equal(content.includes("mdlog-fig"), false, "标记不该落进日志");
    const prose = content.indexOf("引子。");
    const fence = content.indexOf("```vellum-widget");
    const caption = content.indexOf("图注。");
    assert.ok(prose >= 0 && fence > prose && caption > fence, "图应落在引子与图注之间");
    assert.equal(content.includes(HTML), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("中途 flush 不做兜底：标记可能还在下一条消息里", async () => {
    const dir = tmpDir();
    const { writer, read } = makeWriter(dir, [figure("f1")]);

    writer.enqueueFigure(figure("f1"));
    writer.enqueueMessage({ message: assistantMessage("正文 A") });
    await writer.flush(); // 防抖中途，不是回合末

    assert.equal(read().includes("```vellum-widget"), false);

    // 回合末：队列已空，走文件尾重写把未落位的图补上
    await writer.flush({ turnEnd: true });
    const content = read();
    assert.equal(content.includes("```vellum-widget"), true);
    assert.ok(content.indexOf("```vellum-widget") > content.indexOf("正文 A"));
    assert.equal(content.split("mdlog-who").length - 1, 1, "补写不得重复助手标签");
    assert.equal(content.split("---").length - 1, 1, "补写不得重复回合分隔线");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("回合末同批：投递了却没放标记的图挂到本回合末尾", async () => {
    const dir = tmpDir();
    const { writer, read } = makeWriter(dir, [figure("f1")]);

    writer.enqueueFigure(figure("f1"));
    writer.enqueueMessage({ message: assistantMessage("正文 B") });
    await writer.flush({ turnEnd: true });

    const content = read();
    assert.equal(content.includes("```vellum-widget"), true);
    assert.ok(content.indexOf("```vellum-widget") > content.indexOf("正文 B"));
    assert.equal(content.includes(HTML), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("同一 id 重复引用只落一份（防同图复制）", async () => {
    const dir = tmpDir();
    const { writer, read } = makeWriter(dir, [figure("f1")]);

    writer.enqueueMessage({
      message: assistantMessage(`${figureMarker("f1")}\n\n中间\n\n${figureMarker("f1")}`),
    });
    await writer.flush({ turnEnd: true });

    const content = read();
    assert.equal(content.split("```vellum-widget").length - 1, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("未知标记被移除，正文其余部分不动", async () => {
    const dir = tmpDir();
    const { writer, read } = makeWriter(dir, []);

    writer.enqueueMessage({ message: assistantMessage(`上文\n\n${figureMarker("nope")}\n\n下文`) });
    await writer.flush({ turnEnd: true });

    const content = read();
    assert.equal(content.includes("mdlog-fig"), false);
    assert.equal(content.includes("```vellum-widget"), false);
    assert.equal(content.includes("上文"), true);
    assert.equal(content.includes("下文"), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("断开（destroy）时把未落位的图补进文档，不留给下次连接", async () => {
    const dir = tmpDir();
    const { writer, read } = makeWriter(dir, [figure("f1")]);

    writer.enqueueMessage({ message: assistantMessage("正文 C") });
    writer.enqueueFigure(figure("f1"));
    await writer.destroy();

    const content = read();
    assert.equal(content.includes("```vellum-widget"), true);
    assert.ok(content.indexOf("```vellum-widget") > content.indexOf("正文 C"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("没有图投递时行为不变（空队列的回合末 flush 是空操作）", async () => {
    const dir = tmpDir();
    const { writer, read } = makeWriter(dir, []);

    writer.enqueueMessage({ message: assistantMessage("只有正文") });
    await writer.flush({ turnEnd: true });
    const before = read();

    await writer.flush({ turnEnd: true }); // 队列空、无挂起图
    assert.equal(read(), before);
    assert.equal(before.includes("vellum-widget"), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
