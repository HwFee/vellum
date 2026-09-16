import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LiveLogWriter } from "../src/writer.ts";
import type { SessionManagerLike } from "../src/types.ts";

interface FakeEntry {
  id: string;
  message?: unknown;
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-merge-"));
}

function session(entries: FakeEntry[], cwd: string): SessionManagerLike {
  return { getBranch: () => entries, getCwd: () => cwd, getSessionId: () => "sess-1" };
}

function assistant(text: string, offsetMs = 0) {
  return { role: "assistant", content: text, timestamp: Date.now() + offsetMs };
}

function user(text: string, offsetMs = 0) {
  return { role: "user", content: text, timestamp: Date.now() + offsetMs };
}

function setup(): { dir: string; file: string } {
  const dir = tmpDir();
  const file = path.join(dir, "live.md");
  fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");
  return { dir, file };
}

describe("merge semantics (v3.1 碎片合并)", () => {
  test("merges a second assistant batch into the trailing block: one label, one delimiter", async () => {
    const { dir, file } = setup();
    const m1 = assistant("第一段");
    const m2 = assistant("第二段", 1000);
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: session(
        [
          { id: "e1", message: m1 },
          { id: "e2", message: m2 },
        ],
        dir
      ),
    });

    writer.enqueueMessage({ message: m1 });
    await writer.flush();
    writer.enqueueMessage({ message: m2 });
    await writer.flush();

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.split("mdlog-who").length - 1, 1);
    assert.equal(content.split("\n---\n").length - 1, 1);
    assert.equal(content.includes("第一段\n\n第二段"), true);
    assert.equal(content.includes("<!-- mdlog:m=e2 -->"), true);
    assert.equal(content.includes("<!-- mdlog:m=e1 -->"), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("rewrites atomically without leaving tmp files behind", async () => {
    const { dir, file } = setup();
    const m1 = assistant("A");
    const m2 = assistant("B", 500);
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: session(
        [
          { id: "e1", message: m1 },
          { id: "e2", message: m2 },
        ],
        dir
      ),
    });

    writer.enqueueMessage({ message: m1 });
    await writer.flush();
    writer.enqueueMessage({ message: m2 });
    await writer.flush();

    assert.deepEqual(
      fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")),
      []
    );
    assert.equal(fs.readFileSync(file, "utf8").startsWith("<!-- mdlog:v1 s=sess-1 -->\n\n"), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("degrades to an independent append when the file tail was edited externally", async () => {
    const { dir, file } = setup();
    const m1 = assistant("第一段");
    const m2 = assistant("第二段", 500);
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: session(
        [
          { id: "e1", message: m1 },
          { id: "e2", message: m2 },
        ],
        dir
      ),
    });

    writer.enqueueMessage({ message: m1 });
    await writer.flush();

    // 外部编辑器追加内容并剥掉尾部换行：endsWith 校验失败，降级独立追加
    fs.appendFileSync(file, "<!-- 外部编辑 -->", "utf8");

    writer.enqueueMessage({ message: m2 });
    await writer.flush();

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.includes("<!-- 外部编辑 -->\n\n"), true);
    assert.equal(content.split("mdlog-who").length - 1, 2);
    assert.equal(content.includes("第一段"), true);
    assert.equal(content.includes("第二段"), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("does not merge across different roles", async () => {
    const { dir, file } = setup();
    const a = assistant("回答");
    const u = user("追问", 500);
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: session(
        [
          { id: "e1", message: a },
          { id: "e2", message: u },
        ],
        dir
      ),
    });

    writer.enqueueMessage({ message: a });
    await writer.flush();
    writer.enqueueMessage({ message: u });
    await writer.flush();

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.split("mdlog-who").length - 1, 1);
    assert.equal(content.includes("> **你**"), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("discard during in-flight retry leaves no late write (A10 / 应当修复-2)", async () => {
    const { dir, file } = setup();
    const m1 = assistant("不许落盘的迟到内容");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: session([{ id: "e1", message: m1 }], dir),
    });
    writer._testInjectAppendFailure = () => {
      throw new Error("EPERM: file locked");
    };

    writer.enqueueMessage({ message: m1 });
    const flushing = writer.flush();
    await new Promise((r) => setTimeout(r, 10));
    await writer.destroyDiscard();
    await flushing;
    await new Promise((r) => setTimeout(r, 400));

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.includes("迟到内容"), false);
    assert.equal(content, "<!-- mdlog:v1 s=sess-1 -->\n\n");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("destroy (graceful) flushes the pending batch before returning", async () => {
    const { dir, file } = setup();
    const m1 = assistant("优雅关闭要落盘");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: session([{ id: "e1", message: m1 }], dir),
    });

    writer.enqueueMessage({ message: m1 });
    await writer.destroy();

    assert.equal(fs.readFileSync(file, "utf8").includes("优雅关闭要落盘"), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
