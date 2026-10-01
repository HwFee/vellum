import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ANCHOR_RE,
  FINGERPRINT_RE,
  TRUNCATION_NOTE,
  extractMessageText,
  formatAssistantMessage,
  formatHeader,
  formatTimestamp,
  formatTurnDelimiter,
  formatUserMessage,
  isEmptyText,
  renderTurnBlock,
  scanCodeFences,
  userBody,
} from "../src/format.ts";

describe("format module", () => {
  describe("extractMessageText", () => {
    test("handles string content", () => {
      assert.equal(extractMessageText("hello world"), "hello world");
    });

    test("handles array content with text chunks joined by blank line", () => {
      const chunks = [
        { type: "text", text: "line 1" },
        { type: "image", image: "base64..." },
        { type: "text", text: "line 2" },
      ];
      assert.equal(extractMessageText(chunks), "line 1\n\nline 2");
    });

    test("handles empty or non-text chunks", () => {
      assert.equal(extractMessageText([]), "");
      assert.equal(extractMessageText(undefined), "");
      assert.equal(extractMessageText([{ type: "image" }]), "");
    });

    test("isEmptyText treats whitespace-only as empty", () => {
      assert.equal(isEmptyText("   \n\t "), true);
      assert.equal(isEmptyText("x"), false);
    });
  });

  describe("formatTimestamp", () => {
    test("formats same-day timestamp as HH:MM", () => {
      const d = new Date(2026, 8, 5, 14, 32);
      assert.equal(formatTimestamp(d.getTime()), "14:32");
    });

    test("formats cross-day timestamp as MM-DD HH:MM", () => {
      const prev = new Date(2026, 8, 4, 23, 50).getTime();
      const curr = new Date(2026, 8, 5, 14, 32).getTime();
      assert.equal(formatTimestamp(curr, prev), "09-05 14:32");
    });
  });

  describe("scanCodeFences", () => {
    test("detects fully balanced backtick code block", () => {
      const md = "Some text\n```ts\nconsole.log(1);\n```\nMore text";
      assert.equal(scanCodeFences(md).isUnclosed, false);
    });

    test("detects unclosed backtick fence at end of text", () => {
      const result = scanCodeFences("Some text\n```ts\nconsole.log('truncation...");
      assert.equal(result.isUnclosed, true);
      assert.equal(result.fenceChar, "`");
      assert.equal(result.fenceLength, 3);
    });

    test("detects tilde fences and checks length match", () => {
      const result = scanCodeFences("~~~~\ncode\n~~~");
      assert.equal(result.isUnclosed, true);
      assert.equal(result.fenceChar, "~");
      assert.equal(result.fenceLength, 4);
    });

    test("longer closing fence closes the block", () => {
      assert.equal(scanCodeFences("~~~\ncode\n~~~~~").isUnclosed, false);
    });

    test("ignores inline backticks inside paragraphs", () => {
      const md = "Here is `inline code` and ```not a fence line``` middle";
      assert.equal(scanCodeFences(md).isUnclosed, false);
    });
  });

  describe("formatHeader", () => {
    test("outputs byte-exact header without visible title (v3.1)", () => {
      const header = formatHeader("sess-abc-123");
      assert.equal(header, "<!-- mdlog:v1 s=sess-abc-123 -->\n\n");
      assert.equal(header.includes("# Pi 对话记录"), false);
      assert.match(header, FINGERPRINT_RE);
    });

    test("carries exactly one trailing blank line", () => {
      assert.equal(formatHeader("s").endsWith("-->\n\n"), true);
      assert.equal(formatHeader("s").endsWith("-->\n\n\n"), false);
    });
  });

  describe("formatUserMessage", () => {
    test("quotes every line including blank lines with anchor", () => {
      const msg = formatUserMessage("第一行\n\n第二行", "14:32", "entry001");
      assert.equal(msg, "> **你** · 14:32\n>\n> 第一行\n>\n> 第二行\n\n<!-- mdlog:m=entry001 -->\n\n");
      assert.match(msg, ANCHOR_RE);
    });

    test("omits anchor line when entryId is undefined (anchorLost)", () => {
      const msg = formatUserMessage("单行输入", "14:32");
      assert.equal(msg, "> **你** · 14:32\n>\n> 单行输入\n\n");
      assert.equal(ANCHOR_RE.test(msg), false);
    });

    test("rstrips trailing whitespace before quoting", () => {
      assert.equal(userBody("正文   \n\n"), "> 正文");
    });
  });

  describe("formatAssistantMessage", () => {
    test("uses mdlog-who label class with anchor and turn delimiter", () => {
      const msg = formatAssistantMessage("这是回答正文。", "14:33", "entry002", true);
      assert.equal(
        msg,
        '<p class="mdlog-who"><strong>Pi</strong> · 14:33</p>\n\n这是回答正文。\n\n<!-- mdlog:m=entry002 -->\n\n---\n\n'
      );
    });

    test("appends fence completion matching opening fenceChar and fenceLength", () => {
      const msg = formatAssistantMessage("代码片段：\n~~~python\nprint(1)", "14:33", "entry003", true, {
        unclosedFence: true,
        fenceChar: "~",
        fenceLength: 3,
      });
      assert.equal(
        msg,
        `<p class="mdlog-who"><strong>Pi</strong> · 14:33</p>\n\n代码片段：\n~~~python\nprint(1)\n~~~\n${TRUNCATION_NOTE}\n\n<!-- mdlog:m=entry003 -->\n\n---\n\n`
      );
      assert.equal(msg.includes("```"), false);
    });

    test("four-backtick fence is closed with four backticks", () => {
      const msg = formatAssistantMessage("````md\nbody", "14:33", "e", false, {
        unclosedFence: true,
        fenceChar: "`",
        fenceLength: 4,
      });
      assert.equal(msg.includes("\n````\n" + TRUNCATION_NOTE), true);
    });

    test("appends unreferenced extra images before anchor", () => {
      const msg = formatAssistantMessage("生成了一张图。", "14:33", "entry004", true, {
        extraImages: ["diagram.png", "chart-2.png"],
      });
      assert.equal(
        msg,
        '<p class="mdlog-who"><strong>Pi</strong> · 14:33</p>\n\n生成了一张图。\n\n![生成的图片](mdlog-assets/diagram.png)\n\n![生成的图片](mdlog-assets/chart-2.png)\n\n<!-- mdlog:m=entry004 -->\n\n---\n\n'
      );
    });

    test("handles anchorLost without anchor comment", () => {
      const msg = formatAssistantMessage("未命中条目回答", "14:33", undefined, false);
      assert.equal(msg, '<p class="mdlog-who"><strong>Pi</strong> · 14:33</p>\n\n未命中条目回答\n\n');
      assert.equal(ANCHOR_RE.test(msg), false);
    });
  });

  describe("formatTurnDelimiter", () => {
    test("returns horizontal rule with blank lines", () => {
      assert.equal(formatTurnDelimiter(), "---\n\n");
    });
  });

  describe("renderTurnBlock", () => {
    test("merges same-role user texts into one label with quoted blank separator", () => {
      const block = {
        role: "user" as const,
        time: "10:00",
        texts: ["A", "B"],
        images: [],
        entryId: "e1",
      };
      assert.equal(renderTurnBlock(block, true), "> **你** · 10:00\n>\n> A\n>\n> B\n\n<!-- mdlog:m=e1 -->\n\n");
    });

    test("merges same-role assistant texts with a single label and single delimiter", () => {
      const block = {
        role: "assistant" as const,
        time: "10:01",
        texts: ["first", "second"],
        images: [],
        entryId: "e2",
      };
      const rendered = renderTurnBlock(block, true);
      assert.equal(
        rendered,
        '<p class="mdlog-who"><strong>Pi</strong> · 10:01</p>\n\nfirst\n\nsecond\n\n<!-- mdlog:m=e2 -->\n\n---\n\n'
      );
      assert.equal(rendered.split("mdlog-who").length - 1, 1);
      assert.equal(rendered.split("---").length - 1, 1);
    });

    test("closed fence in merged assistant block cancels the truncation note", () => {
      const open = renderTurnBlock(
        { role: "assistant", time: "10:00", texts: ["```ts\nconst a = 1;"], images: [] },
        true
      );
      assert.equal(open.includes(TRUNCATION_NOTE), true);
      const closed = renderTurnBlock(
        { role: "assistant", time: "10:00", texts: ["```ts\nconst a = 1;", "```"], images: [] },
        true
      );
      assert.equal(closed.includes(TRUNCATION_NOTE), false);
    });
  });
});
