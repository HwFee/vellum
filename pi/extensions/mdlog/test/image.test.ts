import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildImagePathRegex,
  cleanAssetRetention,
  extractImageCandidates,
  loadMdlogConfig,
  processTurnImages,
  sanitizeImageFilename,
} from "../src/image.ts";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath: string, content: string | Buffer = "x"): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (typeof content === "string") fs.writeFileSync(filePath, content, "utf8");
  else fs.writeFileSync(filePath, content);
}

/** 造一张最小 PNG（内容无关紧要，管线只看路径与字节数） */
function pngBytes(size = 68): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(Math.max(0, size - 4))]);
}

describe("image module", () => {
  describe("buildImagePathRegex", () => {
    test("excludes svg even when configured", () => {
      const re = buildImagePathRegex(["png", "svg"]);
      const matches = ["a.png", "b.svg"].filter((f) => re.test(` ${f} `));
      assert.deepEqual(matches, ["a.png"]);
    });

    test("falls back to defaults when the extension list is empty or invalid", () => {
      const re = buildImagePathRegex(["", "  ", "*"]);
      assert.equal(re.test(" shot.png "), true);
    });
  });

  describe("extractImageCandidates", () => {
    test("extracts image paths from tool output with various quotes and spaces", () => {
      const out = 'saved "assets/result 1.png" and \'/tmp/plot.jpg\' plus img.webp';
      const list = extractImageCandidates(out, undefined, undefined, ["png", "jpg", "webp", "svg"]);
      assert.equal(list.some((p) => p.endsWith("result 1.png")), true);
      assert.equal(list.some((p) => p.endsWith("plot.jpg")), true);
      assert.equal(list.some((p) => p.endsWith("img.webp")), true);
      assert.equal(list.some((p) => p.endsWith("diagram.svg")), false);
    });

    test("filters tools when toolNames is specified in config", () => {
      const out = "result.png";
      assert.deepEqual(extractImageCandidates(out, ["screenshot"], "bash"), []);
      assert.deepEqual(extractImageCandidates(out, ["screenshot"], "screenshot"), ["result.png"]);
    });
  });

  describe("sanitizeImageFilename", () => {
    test("purges non-ascii characters and spaces to single dashes", () => {
      assert.equal(sanitizeImageFilename("图片 1 final.png"), "---1-final.png");
    });

    test("falls back to image.ext if all base characters are non-ascii", () => {
      assert.equal(sanitizeImageFilename("图片.png"), "image.png");
    });
  });

  describe("loadMdlogConfig", () => {
    test("clamps negative and zero values and excludes svg from imageExtensions", () => {
      const dir = tmpDir("mdlog-img-");
      const cfgPath = path.join(dir, "config.json");
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({ maxImageBytes: -1, assetRetentionMb: 0, imageExtensions: ["png", "svg", "PNG"] }),
        "utf8"
      );
      const cfg = loadMdlogConfig(cfgPath);
      assert.equal(cfg.maxImageBytes, 20 * 1024 * 1024);
      assert.equal(cfg.assetRetentionMb, 200);
      assert.deepEqual(cfg.imageExtensions, ["png"]);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("processTurnImages", () => {
    test("processes valid image and rewrites assistant text to the asset path", async () => {
      const dir = tmpDir("mdlog-img-");
      const cwd = path.join(dir, "work");
      const logDir = path.join(dir, "notes");
      writeFile(path.join(cwd, "shot.png"), pngBytes(256));

      const result = await processTurnImages(["shot.png"], "看图 shot.png", {
        cwd,
        logDir,
        turnStartTime: Date.now(),
      });
      assert.equal(result.copiedFiles.length, 1);
      assert.equal(result.rewrittenAssistantText, "看图 mdlog-assets/shot.png");
      assert.equal(fs.existsSync(path.join(logDir, "mdlog-assets", "shot.png")), true);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("rejects path traversal outside cwd without copying or rewriting", async () => {
      const dir = tmpDir("mdlog-img-");
      const cwd = path.join(dir, "work");
      const logDir = path.join(dir, "notes");
      fs.mkdirSync(cwd, { recursive: true });
      writeFile(path.join(dir, "outside.png"), pngBytes(256));

      const result = await processTurnImages(["../outside.png"], "越界图 ../outside.png", {
        cwd,
        logDir,
        turnStartTime: Date.now(),
      });
      assert.deepEqual(result.copiedFiles, []);
      assert.equal(result.rewrittenAssistantText, "越界图 ../outside.png");
      assert.equal(fs.existsSync(path.join(logDir, "mdlog-assets")), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("handles unreferenced image by adding to unreferencedCleanNames", async () => {
      const dir = tmpDir("mdlog-img-");
      const cwd = path.join(dir, "work");
      const logDir = path.join(dir, "notes");
      writeFile(path.join(cwd, "extra.png"), pngBytes(128));

      const result = await processTurnImages(["extra.png"], "正文完全没提图", {
        cwd,
        logDir,
        turnStartTime: Date.now(),
      });
      assert.deepEqual(result.unreferencedCleanNames, ["extra.png"]);
      assert.equal(result.copiedFiles.length, 1);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("skips images exceeding configured maxImageBytes and inserts warning placeholder", async () => {
      const dir = tmpDir("mdlog-img-");
      const cwd = path.join(dir, "work");
      const logDir = path.join(dir, "notes");
      writeFile(path.join(cwd, "big.png"), pngBytes(4096));

      const result = await processTurnImages(["big.png"], "大图 big.png", {
        cwd,
        logDir,
        turnStartTime: Date.now(),
        maxImageBytes: 128,
      });
      assert.deepEqual(result.copiedFiles, []);
      assert.match(result.rewrittenAssistantText, /图片超过体积上限/);
      assert.equal(fs.existsSync(path.join(logDir, "mdlog-assets")), false);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("handles image copy failure and writes failure placeholder", async () => {
      const dir = tmpDir("mdlog-img-");
      const cwd = path.join(dir, "work");
      const logDir = path.join(dir, "notes");
      writeFile(path.join(cwd, "shot.png"), pngBytes(128));

      // 把 mdlog-assets 占成文件：目录创建被跳过，复制必然失败
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, "mdlog-assets"), "not a dir", "utf8");

      const result = await processTurnImages(["shot.png"], "图 shot.png", {
        cwd,
        logDir,
        turnStartTime: Date.now(),
      });
      assert.deepEqual(result.copiedFiles, []);
      assert.match(result.rewrittenAssistantText, /图片同步失败/);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("allows weird filenames starting with dots like ..weird.png within cwd", async () => {
      const dir = tmpDir("mdlog-img-");
      const cwd = path.join(dir, "work");
      const logDir = path.join(dir, "notes");
      writeFile(path.join(cwd, "..weird.png"), pngBytes(64));

      const result = await processTurnImages(["..weird.png"], "看 ..weird.png", {
        cwd,
        logDir,
        turnStartTime: Date.now(),
      });
      assert.equal(result.copiedFiles.length, 1);
      assert.equal(result.rewrittenAssistantText.includes("mdlog-assets/"), true);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("deduplicates identical file referred by different candidate paths using realpath", async () => {
      const dir = tmpDir("mdlog-img-");
      const cwd = path.join(dir, "work");
      const logDir = path.join(dir, "notes");
      writeFile(path.join(cwd, "shot.png"), pngBytes(64));

      const result = await processTurnImages(["shot.png", "./shot.png"], "shot.png 与 ./shot.png", {
        cwd,
        logDir,
        turnStartTime: Date.now(),
      });
      assert.equal(result.copiedFiles.length, 1);
      assert.equal(result.rewrittenAssistantText, "mdlog-assets/shot.png 与 mdlog-assets/shot.png");
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("avoids nested double-prefix mdlog-assets/mdlog-assets with single-pass rewriting", async () => {
      const dir = tmpDir("mdlog-img-");
      const cwd = path.join(dir, "work");
      const logDir = path.join(dir, "notes");
      writeFile(path.join(cwd, "dup.png"), pngBytes(64));
      writeFile(path.join(cwd, "sub", "dup.png"), pngBytes(96));

      const result = await processTurnImages(["dup.png", "sub/dup.png"], "先看 dup.png，再看 sub/dup.png", {
        cwd,
        logDir,
        turnStartTime: Date.now(),
      });
      assert.equal(result.rewrittenAssistantText.includes("mdlog-assets/mdlog-assets"), false);
      assert.equal(result.rewrittenAssistantText.includes("先看 mdlog-assets/dup.png"), true);
      assert.equal(result.copiedFiles.length, 2);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("cleanAssetRetention", () => {
    test("removes oldest files when assets directory exceeds byte quota", () => {
      const dir = tmpDir("mdlog-img-");
      const oldFile = path.join(dir, "old.png");
      const newFile = path.join(dir, "new.png");
      fs.writeFileSync(oldFile, Buffer.alloc(700 * 1024));
      fs.writeFileSync(newFile, Buffer.alloc(700 * 1024));
      const past = Date.now() - 60_000;
      fs.utimesSync(oldFile, past / 1000, past / 1000);

      const deleted = cleanAssetRetention(dir, 1024 * 1024);
      assert.equal(deleted.length, 1);
      assert.equal(deleted[0], oldFile);
      assert.equal(fs.existsSync(newFile), true);
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test("never clears assets when the quota argument is invalid (clamped floor)", () => {
      const dir = tmpDir("mdlog-img-");
      fs.writeFileSync(path.join(dir, "a.png"), Buffer.alloc(4096));
      assert.deepEqual(cleanAssetRetention(dir, 0), []);
      assert.deepEqual(cleanAssetRetention(dir, -1), []);
      assert.equal(fs.existsSync(path.join(dir, "a.png")), true);
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });
});
