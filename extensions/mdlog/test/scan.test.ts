import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  extractSessionFingerprint,
  findLastBranchAnchor,
  insertHeaderAtTopAtomic,
  normalizeTrailingNewlines,
  resolveAppendPlan,
} from "../src/scan.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("scan module", () => {
  describe("normalizeTrailingNewlines", () => {
    test("normalizes zero / one / two trailing newlines to exactly one blank line", () => {
      assert.equal(normalizeTrailingNewlines("原文本"), "原文本\n\n");
      assert.equal(normalizeTrailingNewlines("原文本\n"), "原文本\n\n");
      assert.equal(normalizeTrailingNewlines("原文本\n\n"), "原文本\n\n");
      assert.equal(normalizeTrailingNewlines("原文本\n\n\n"), "原文本\n\n\n");
      assert.equal(normalizeTrailingNewlines(""), "");
    });
  });

  describe("findLastBranchAnchor", () => {
    const branch = new Set(["e1", "e2"]);

    test("finds the latest anchor that belongs to the current branch", () => {
      const md = "<!-- mdlog:m=e1 -->\n\n正文\n\n<!-- mdlog:m=e2 -->\n\n尾巴";
      assert.equal(findLastBranchAnchor(md, branch).matchedEntryId, "e2");
    });

    test("skips pseudo anchors inside code fences (Y6-d)", () => {
      const md = "<!-- mdlog:m=e1 -->\n\n```md\n<!-- mdlog:m=e2 -->\n```\n\n";
      assert.equal(findLastBranchAnchor(md, branch).matchedEntryId, "e1");
    });

    test("skips inline pseudo anchors that are part of a text line", () => {
      const md = "<!-- mdlog:m=e1 -->\n\n正文里提到 <!-- mdlog:m=e2 --> 但不在独立行\n";
      assert.equal(findLastBranchAnchor(md, branch).matchedEntryId, "e1");
    });

    test("rolls back until finding a branch-belonging anchor (Y6-a)", () => {
      const md = "<!-- mdlog:m=e1 -->\n\n<!-- mdlog:m=other -->\n\n<!-- mdlog:m=another -->\n";
      assert.equal(findLastBranchAnchor(md, branch).matchedEntryId, "e1");
    });

    test("returns null when no anchor belongs to the branch", () => {
      assert.equal(findLastBranchAnchor("<!-- mdlog:m=x -->\n\n正文\n", branch).matchedEntryId, null);
    });
  });

  describe("extractSessionFingerprint", () => {
    test("extracts sessionId from standard header", () => {
      assert.equal(extractSessionFingerprint("<!-- mdlog:v1 s=sess-42 -->\n\n正文"), "sess-42");
    });

    test("extracts sessionId with BOM and extra spaces", () => {
      assert.equal(extractSessionFingerprint("\uFEFF  <!--   mdlog:v1   s=s-9 -->\n"), "s-9");
    });

    test("returns null for non-mdlog files", () => {
      assert.equal(extractSessionFingerprint("# 我的笔记\n\n正文"), null);
    });
  });

  describe("resolveAppendPlan", () => {
    const branch = new Set(["e1"]);
    const opts = { hasUI: false };

    test("honors forceFull flag", () => {
      assert.deepEqual(resolveAppendPlan("<!-- mdlog:m=e1 -->", "s", branch, { ...opts, forceFull: true }), {
        mode: "full",
      });
    });

    test("honors forceAppend flag", () => {
      assert.deepEqual(resolveAppendPlan("<!-- mdlog:m=e1 -->", "s", branch, { ...opts, forceAppend: true }), {
        mode: "append_only",
      });
    });

    test("returns full for empty file", () => {
      assert.deepEqual(resolveAppendPlan("   \n", "s", branch, opts), { mode: "full" });
    });

    test("returns increment when a valid branch anchor is hit", () => {
      assert.deepEqual(resolveAppendPlan("<!-- mdlog:m=e1 -->\n\nx", "s", branch, opts), {
        mode: "increment",
        fromEntryId: "e1",
      });
    });

    test("returns ask_user for branch 4a with UI", () => {
      assert.deepEqual(
        resolveAppendPlan("<!-- mdlog:v1 s=s -->\n\n正文无锚点", "s", branch, { hasUI: true }),
        { mode: "ask_user" }
      );
    });

    test("skips branch anchors and falls back to 4a when anchorLost is true (Y6-e / Item 14)", () => {
      assert.deepEqual(
        resolveAppendPlan("<!-- mdlog:v1 s=s -->\n\n<!-- mdlog:m=e1 -->", "s", branch, {
          hasUI: false,
          anchorLost: true,
        }),
        { mode: "append_only" }
      );
      assert.deepEqual(
        resolveAppendPlan("<!-- mdlog:v1 s=s -->\n\n<!-- mdlog:m=e1 -->", "s", branch, {
          hasUI: true,
          anchorLost: true,
        }),
        { mode: "ask_user" }
      );
    });

    test("returns append_only for branch 4a without UI", () => {
      assert.deepEqual(resolveAppendPlan("<!-- mdlog:v1 s=s -->\n\n正文", "s", branch, opts), {
        mode: "append_only",
      });
    });

    test("returns full for branch 4b (foreign session or missing header)", () => {
      assert.deepEqual(resolveAppendPlan("# 别人的笔记\n\n内容", "s", branch, opts), { mode: "full" });
      assert.deepEqual(resolveAppendPlan("<!-- mdlog:v1 s=other -->\n\n内容", "s", branch, opts), {
        mode: "full",
      });
    });
  });

  describe("insertHeaderAtTopAtomic", () => {
    test("inserts header at line 1 of foreign non-empty file atomically", () => {
      const dir = tmpDir("mdlog-scan-");
      const file = path.join(dir, "note.md");
      fs.writeFileSync(file, "# 我的旧笔记\n\n最后一行\n", "utf8");

      insertHeaderAtTopAtomic(file, "sess-new");

      const content = fs.readFileSync(file, "utf8");
      assert.equal(content.startsWith("<!-- mdlog:v1 s=sess-new -->\n\n"), true);
      assert.equal(content.endsWith("# 我的旧笔记\n\n最后一行\n\n"), true);
      assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("normalizes non-empty file without trailing newlines to end with double newline", () => {
      const dir = tmpDir("mdlog-scan-");
      const file = path.join(dir, "note.md");
      fs.writeFileSync(file, "# 无换行结尾", "utf8");

      insertHeaderAtTopAtomic(file, "s");

      assert.equal(fs.readFileSync(file, "utf8"), "<!-- mdlog:v1 s=s -->\n\n# 无换行结尾\n\n");
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("is idempotent for the same sessionId", () => {
      const dir = tmpDir("mdlog-scan-");
      const file = path.join(dir, "note.md");
      fs.writeFileSync(file, "<!-- mdlog:v1 s=s -->\n\n正文\n\n", "utf8");

      insertHeaderAtTopAtomic(file, "s");

      assert.equal(fs.readFileSync(file, "utf8"), "<!-- mdlog:v1 s=s -->\n\n正文\n\n");
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
