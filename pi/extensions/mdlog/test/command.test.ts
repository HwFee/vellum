import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import {
  formatStatusOutput,
  openInVellum,
  parseMdlogCommand,
  resolveVellumInvocation,
} from "../src/command.ts";

describe("command module", () => {
  describe("parseMdlogCommand", () => {
    test("returns status if no arguments provided", () => {
      assert.equal(parseMdlogCommand("").action, "status");
      assert.equal(parseMdlogCommand("   ").action, "status");
    });

    test("dispatches reserved subcommands off and status", () => {
      assert.equal(parseMdlogCommand("off").action, "off");
      assert.equal(parseMdlogCommand("status").action, "status");
      assert.equal(parseMdlogCommand("--full off").action, "off");
    });

    test("parses target path with spaces and quotes and flags", () => {
      const parsed = parseMdlogCommand('--append "C:\\My Notes\\session.md" --no-open');
      assert.equal(parsed.action, "connect");
      assert.equal(parsed.targetPath, "C:\\My Notes\\session.md");
      assert.deepEqual(parsed.flags, { full: false, append: true, noOpen: true });
    });

    test("rejects invalid non-markdown extension", () => {
      const parsed = parseMdlogCommand("notes.txt");
      assert.equal(parsed.error, "目标文件扩展名必须为 .md 或 .markdown");
      assert.equal(parseMdlogCommand("notes.markdown").error, undefined);
    });

    test("rejects path with internal quotes or newline injection attempts", () => {
      const injected = parseMdlogCommand('a.md" & calc.exe & "b.md');
      assert.equal(injected.error, "目标路径包含非法字符（引号或换行），已拒绝");
    });
  });

  describe("formatStatusOutput", () => {
    test("formats disconnected status", () => {
      assert.equal(formatStatusOutput(null), "当前未连接任何文件。使用 /mdlog <文件路径> 开始记录。");
    });

    test("formats connected status with written count and formatted time", () => {
      const out = formatStatusOutput({
        active: true,
        targetPath: "C:\\notes\\session.md",
        sessionId: "sess-1",
        connectedAt: Date.now(),
        lastWriteAt: new Date(2026, 8, 5, 14, 32, 5).getTime(),
        writtenCount: 14,
      });
      assert.equal(
        out,
        [
          "连接文件: C:\\notes\\session.md",
          "已写消息: 14 条",
          "最近写入: 2026-09-05 14:32:05",
          "会话标识: sess-1",
        ].join("\n")
      );
    });
  });

  describe("resolveVellumInvocation", () => {
    test("prefers config.vellumPath over env and system association", () => {
      const invoked = resolveVellumInvocation("C:\\notes\\a.md", { vellumPath: "C:\\V\\custom.exe" }, {
        env: { MDLOG_VELLUM_PATH: "C:\\V\\env.exe", LOCALAPPDATA: "C:\\LA" } as NodeJS.ProcessEnv,
        existsSync: () => true,
      });
      assert.deepEqual(invoked, { command: "C:\\V\\custom.exe", args: ["C:\\notes\\a.md"], mode: "vellum" });
    });

    test("falls back to env then LOCALAPPDATA install location", () => {
      const env = resolveVellumInvocation("C:\\n\\a.md", {}, {
        env: { MDLOG_VELLUM_PATH: "C:\\V\\env.exe", LOCALAPPDATA: "C:\\LA" } as NodeJS.ProcessEnv,
        existsSync: (p) => p === "C:\\V\\env.exe",
      });
      assert.equal("command" in env && env.command, "C:\\V\\env.exe");

      const local = resolveVellumInvocation("C:\\n\\a.md", {}, {
        env: { LOCALAPPDATA: "C:\\LA" } as NodeJS.ProcessEnv,
        existsSync: (p) => p === path.join("C:\\LA", "Programs", "Vellum", "Vellum.exe"),
      });
      assert.equal(
        "command" in local && local.command,
        path.join("C:\\LA", "Programs", "Vellum", "Vellum.exe")
      );
    });

    test("falls back to system association with argument array", () => {
      const invoked = resolveVellumInvocation("C:\\n\\a.md", {}, {
        env: {} as NodeJS.ProcessEnv,
        existsSync: () => false,
      });
      assert.deepEqual(invoked, { command: "cmd", args: ["/c", "start", "", "C:\\n\\a.md"], mode: "system" });
    });

    test("rejects paths containing internal quotes or newline characters", () => {
      const bad = resolveVellumInvocation('a.md" & calc.exe', {}, { existsSync: () => true });
      assert.equal("error" in bad, true);
    });
  });

  describe("openInVellum", () => {
    test("rejects dangerous paths without executing anything", async () => {
      const result = await openInVellum('C:\\x" & calc.exe & "y.md', {});
      assert.equal(result.success, false);
      assert.match(String(result.error), /非法字符/);
    });
  });
});
