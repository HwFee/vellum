import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  HeartbeatManager,
  getSidecarPath,
  readSidecar,
  removeSidecar,
  setAnchorLost,
  updateHeartbeat,
  updateLastWrite,
  writeSidecar,
} from "../src/sidecar.ts";
import type { SidecarData } from "../src/types.ts";

function fixture(): { dir: string; logFile: string; data: SidecarData } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-sidecar-"));
  const logFile = path.join(dir, "session.md");
  fs.writeFileSync(logFile, "<!-- mdlog:v1 s=s -->\n\n", "utf8");
  const now = Date.now();
  return {
    dir,
    logFile,
    data: {
      version: 1,
      sessionId: "s",
      pid: process.pid,
      connectedAt: now,
      lastWriteAt: now,
      heartbeatAt: now,
    },
  };
}

describe("sidecar module", () => {
  test("writes sidecar JSON at the exact path contract <file>.mdlog", () => {
    const { dir, logFile, data } = fixture();
    const sidecarPath = getSidecarPath(logFile);
    assert.equal(sidecarPath, `${logFile}.mdlog`);
    assert.equal(writeSidecar(sidecarPath, data), true);

    const parsed = JSON.parse(fs.readFileSync(sidecarPath, "utf8")) as SidecarData;
    assert.equal(parsed.sessionId, "s");
    assert.equal(parsed.pid, process.pid);
    assert.equal(readSidecar(sidecarPath)?.sessionId, "s");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("separates heartbeatAt and lastWriteAt updates (Z1)", () => {
    const { dir, logFile, data } = fixture();
    const sidecarPath = getSidecarPath(logFile);
    writeSidecar(sidecarPath, data);

    const hb = Date.now() + 1000;
    const lw = Date.now() + 2000;
    assert.equal(updateHeartbeat(sidecarPath, hb), true);
    assert.equal(updateLastWrite(sidecarPath, lw), true);

    const parsed = readSidecar(sidecarPath);
    assert.equal(parsed?.heartbeatAt, hb);
    assert.equal(parsed?.lastWriteAt, lw);
    assert.equal(parsed?.connectedAt, data.connectedAt);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("setAnchorLost persists the flag and is readable back", () => {
    const { dir, logFile, data } = fixture();
    const sidecarPath = getSidecarPath(logFile);
    writeSidecar(sidecarPath, data);
    assert.equal(setAnchorLost(sidecarPath, true), true);
    assert.equal(readSidecar(sidecarPath)?.anchorLost, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("writeSidecar isolates errors and cleans up tmp files on failure without bubbling", () => {
    const { dir, logFile, data } = fixture();
    const blocked = getSidecarPath(logFile);
    // 把 sidecar 路径占成目录：rename 必然失败（EPERM/EISDIR）
    fs.mkdirSync(blocked, { recursive: true });

    assert.equal(writeSidecar(blocked, data), false);
    assert.equal(updateHeartbeat(blocked), false);
    assert.equal(updateLastWrite(blocked, Date.now()), false);
    assert.equal(setAnchorLost(blocked, true), false);

    const leftovers = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("removeSidecar is idempotent", () => {
    const { dir, logFile, data } = fixture();
    const sidecarPath = getSidecarPath(logFile);
    writeSidecar(sidecarPath, data);
    assert.equal(removeSidecar(sidecarPath), true);
    assert.equal(removeSidecar(sidecarPath), false);
    assert.equal(readSidecar(sidecarPath), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("HeartbeatManager ticks and stops cleanly without keeping the loop alive", async () => {
    const { dir, logFile, data } = fixture();
    const sidecarPath = getSidecarPath(logFile);
    writeSidecar(sidecarPath, data);
    const before = readSidecar(sidecarPath)?.heartbeatAt ?? 0;

    const manager = new HeartbeatManager();
    manager.start(sidecarPath, 20);
    assert.equal(manager.isRunning(), true);
    await new Promise((r) => setTimeout(r, 80));
    manager.stop();
    assert.equal(manager.isRunning(), false);

    const after = readSidecar(sidecarPath)?.heartbeatAt ?? 0;
    assert.equal(after > before, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
