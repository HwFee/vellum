import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LiveLogWriter } from "../src/writer.ts";
import type { SessionManagerLike } from "../src/types.ts";

interface FakeEntry {
  id: string;
  type?: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
}

function tmpDir(prefix = "mdlog-writer-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeSession(entries: FakeEntry[], cwd: string, sessionId = "sess-1"): SessionManagerLike {
  return {
    getBranch: () => entries,
    getCwd: () => cwd,
    getSessionId: () => sessionId,
  };
}

function userMessage(text: string, timestamp = Date.now()) {
  return { role: "user", content: text, timestamp };
}

function assistantMessage(text: string, timestamp = Date.now()) {
  return { role: "assistant", content: text, timestamp };
}

describe("LiveLogWriter", () => {
  test("batches messages with 150ms debounce and matches branch entryId", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");

    const message = userMessage("你好", new Date(2026, 8, 5, 14, 32).getTime());
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession([{ id: "e1", message }], dir),
    });

    writer.enqueueMessage({ message });
    await new Promise((r) => setTimeout(r, 300));

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.includes("> **你** · 14:32"), true);
    assert.equal(content.includes("<!-- mdlog:m=e1 -->"), true);
    assert.equal(writer.getWrittenCount(), 1);
    await writer.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("handles degraded match when entryId is not found (anchorLost: true)", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");

    let anchorLostCalls = 0;
    const message = assistantMessage("未命中条目的回答");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession([], dir),
      onAnchorLost: () => {
        anchorLostCalls++;
      },
    });

    writer.enqueueMessage({ message });
    await writer.flush();

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.includes("<!-- mdlog:m="), false);
    assert.equal(anchorLostCalls, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("does not trigger anchorLost when at least one message matches in the batch", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");

    let anchorLostCalls = 0;
    const matched = userMessage("命中");
    const orphan = userMessage("未命中");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession([{ id: "e1", message: matched }], dir),
      onAnchorLost: () => {
        anchorLostCalls++;
      },
    });

    writer.enqueueMessage({ message: orphan });
    writer.enqueueMessage({ message: matched });
    await writer.flush();

    assert.equal(anchorLostCalls, 0);
    assert.equal(fs.readFileSync(file, "utf8").includes("<!-- mdlog:m=e1 -->"), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("retries up to 3 times on simulated file lock and disconnects after 3 failed batches", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");

    const fatals: string[] = [];
    const message = userMessage("写不进去");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession([{ id: "e1", message }], dir),
      onFatalError: (msg) => fatals.push(msg),
    });
    writer._testInjectAppendFailure = () => {
      throw new Error("EPERM: file locked");
    };

    writer.enqueueMessage({ message });
    await writer.flush();
    assert.equal(fs.readFileSync(file, "utf8").includes("写不进去"), false);
    await writer.flush();
    assert.equal(fatals.length, 0);
    await writer.flush();
    assert.equal(fatals.length, 1);
    assert.match(fatals[0], /连续失败 3 次/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("does not duplicate messages when onWriteSuccess throws error (narrow transaction boundary)", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");

    const a = userMessage("A");
    const b = userMessage("B");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession(
        [
          { id: "e1", message: a },
          { id: "e2", message: b },
        ],
        dir
      ),
      onWriteSuccess: () => {
        throw new Error("sidecar 写失败");
      },
    });

    writer.enqueueMessage({ message: a });
    await writer.flush();
    writer.enqueueMessage({ message: b });
    await writer.flush();
    await writer.flush();

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.split("> A").length - 1, 1);
    assert.equal(content.split("> B").length - 1, 1);
    assert.equal(writer.getWrittenCount(), 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("normalizes existing file lacking double trailing newlines before first append", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n# 我的旧笔记\n最后一行没有换行符", "utf8");

    const message = userMessage("接缝后的新消息");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession([{ id: "e1", message }], dir),
    });
    writer.enqueueMessage({ message });
    await writer.flush();

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.endsWith("# 我的旧笔记\n最后一行没有换行符\n\n> **你**"), false);
    assert.equal(content.includes("最后一行没有换行符\n\n> **你**"), true);
    assert.equal(content.includes("\n> **你**"), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("processes turn images once per batch across multiple assistant messages without duplication", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");
    fs.writeFileSync(path.join(dir, "shot.png"), Buffer.alloc(256, 7));

    const m1 = assistantMessage("第一段");
    const m2 = assistantMessage("第二段");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession(
        [
          { id: "e1", message: m1 },
          { id: "e2", message: m2 },
        ],
        dir
      ),
    });

    writer.enqueueImageCandidates(["shot.png"], Date.now());
    writer.enqueueMessage({ message: m1 });
    writer.enqueueMessage({ message: m2 });
    await writer.flush();

    const assets = fs.readdirSync(path.join(dir, "mdlog-assets"));
    assert.deepEqual(assets, ["shot.png"]);
    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.split("![生成的图片]").length - 1, 1);
    assert.equal(content.split("mdlog-who").length - 1, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("does not discard candidate images in an image-only batch", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");
    fs.writeFileSync(path.join(dir, "shot.png"), Buffer.alloc(256, 7));

    const message = assistantMessage("图在这里：shot.png");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession([{ id: "e1", message }], dir),
    });

    writer.enqueueImageCandidates(["shot.png"], Date.now());
    await writer.flush(); // 图片-only 批次：候选必须留在队列

    writer.enqueueMessage({ message });
    await writer.flush();

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.includes("mdlog-assets/shot.png"), true);
    assert.deepEqual(fs.readdirSync(path.join(dir, "mdlog-assets")), ["shot.png"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("throttles cleanAssetRetention to run at most once per 30 seconds", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");
    const assetsDir = path.join(dir, "mdlog-assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    const big = path.join(assetsDir, "big.png");
    fs.writeFileSync(big, Buffer.alloc(2 * 1024 * 1024));

    const message = userMessage("触发清理");
    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession([{ id: "e1", message }], dir),
      config: { assetRetentionMb: 1 },
    });

    // 窗口内：跳过清理，文件仍在
    writer._testSetLastAssetCleanTime(Date.now());
    writer.enqueueMessage({ message });
    await writer.flush();
    assert.equal(fs.existsSync(big), true);

    // 窗口外：执行清理
    writer._testSetLastAssetCleanTime(Date.now() - 60_000);
    writer.enqueueMessage({ message });
    await writer.flush();
    assert.equal(fs.existsSync(big), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("ignores non-conversation roles and empty text silently", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");

    const writer = new LiveLogWriter({
      filePath: file,
      sessionId: "sess-1",
      sessionManager: makeSession([], dir),
    });
    writer.enqueueMessage({ message: { role: "toolResult", content: "工具输出" } });
    writer.enqueueMessage({ message: { role: "user", content: "   \n\n " } });
    await writer.flush();

    assert.equal(fs.readFileSync(file, "utf8"), "<!-- mdlog:v1 s=sess-1 -->\n\n");
    assert.equal(writer.getWrittenCount(), 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
