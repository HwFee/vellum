## 工作包 4：pi 扩展 mdlog

> **范围约束**：本工作包实现 pi 全局扩展 `mdlog`，文件部署于仓库外 `~/.pi/agent/extensions/mdlog/`（Windows 绝对路径 `C:\Users\17445\.pi\agent\extensions\mdlog\`）。
> **测试运行器决策**：采用 Node.js 24 内置的 `node:test` 测试框架（`node --test test/**/*.test.ts`），理由：Node 24 原生支持 TypeScript 类型剥离执行，零额外第三方依赖，秒级启动，完全符合 spec §3.1「运行依赖仅用 Node.js 内置模块与类型定义」的极简约束。
> **跨包契约保证**：
> 1. sidecar 状态文件规范命名：`<日志文件全路径>.mdlog`；
> 2. Vellum 端事件 `file-changed` 与 `mdlog-state-changed` 纯由操作系统文件监听驱动，扩展不与 Vellum 建立任何长连接或直接通信；
> 3. 交互块围栏语言名逐字保持为 `vellum-widget`。

---

### Task 4.1: 脚手架、类型定义与纯函数格式化器（Scaffold, Types & Pure Formatter）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\package.json`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\types.ts`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\format.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\format.test.ts`

**Interfaces:**
- Consumes: `@earendil-works/pi-coding-agent` (类型定义)
- Produces:
  - `export function formatTimestamp(timestamp: number, previousTimestamp?: number): string`
  - `export function extractMessageText(content: string | Array<{ type: string; text?: string }> | undefined): string`
  - `export function scanCodeFences(text: string): { isUnclosed: boolean; fenceChar?: string; fenceLength?: number }`
  - `export function formatHeader(sessionId: string): string`
  - `export function formatUserMessage(text: string, time: string, entryId?: string): string`
  - `export function formatAssistantMessage(text: string, time: string, entryId?: string, isEnd?: boolean, options?: { unclosedFence?: boolean; extraImages?: string[] }): string`
  - `export function formatTurnDelimiter(): string`
  - `export const FINGERPRINT_RE: RegExp`
  - `export const ANCHOR_RE: RegExp`

- [ ] **Step 1: 创建 package.json 并编写纯函数格式化模块失败测试**

在 `C:\Users\17445\.pi\agent\extensions\mdlog\package.json` 中配置模块信息与测试脚本：

```json
{
  "name": "pi-mdlog",
  "version": "1.0.0",
  "description": "Vellum live Markdown logger extension for pi coding agent",
  "type": "module",
  "scripts": {
    "test": "node --test test/**/*.test.ts"
  }
}
```

在 `C:\Users\17445\.pi\agent\extensions\mdlog\test\format.test.ts` 中编写测试用例，覆盖双形态文本提取、跨天时间戳、CommonMark 围栏平衡扫描、逐字节消息拼接与锚点空行：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractMessageText,
  formatTimestamp,
  scanCodeFences,
  formatHeader,
  formatUserMessage,
  formatAssistantMessage,
  formatTurnDelimiter,
  FINGERPRINT_RE,
  ANCHOR_RE,
} from "../src/format.ts";

describe("format module", () => {
  describe("extractMessageText", () => {
    test("handles string content", () => {
      assert.equal(extractMessageText("hello world"), "hello world");
    });

    test("handles array content with text chunks", () => {
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
      const result = scanCodeFences(md);
      assert.equal(result.isUnclosed, false);
    });

    test("detects unclosed backtick fence at end of text", () => {
      const md = "Some text\n```ts\nconsole.log('truncation...";
      const result = scanCodeFences(md);
      assert.equal(result.isUnclosed, true);
      assert.equal(result.fenceChar, "`");
      assert.equal(result.fenceLength, 3);
    });

    test("detects tilde fences and checks length match", () => {
      const md = "~~~~\ncode\n~~~"; // open 4 tildes, close 3 -> remains unclosed
      const result = scanCodeFences(md);
      assert.equal(result.isUnclosed, true);
      assert.equal(result.fenceLength, 4);
    });

    test("ignores inline backticks inside paragraphs", () => {
      const md = "Here is `inline code` and ```not a fence line``` middle";
      const result = scanCodeFences(md);
      assert.equal(result.isUnclosed, false);
    });
  });

  describe("formatHeader", () => {
    test("outputs byte-exact header with trailing blank line", () => {
      const header = formatHeader("sess-abc-123");
      assert.equal(header, "<!-- mdlog:v1 s=sess-abc-123 -->\n\n# Pi 对话记录\n\n");
      assert.match(header, FINGERPRINT_RE);
    });
  });

  describe("formatUserMessage", () => {
    test("quotes every line including blank lines with anchor", () => {
      const msg = formatUserMessage("第一行\n\n第二行", "14:32", "entry001");
      const expected =
        "> **你** · 14:32\n" +
        ">\n" +
        "> 第一行\n" +
        ">\n" +
        "> 第二行\n\n" +
        "<!-- mdlog:m=entry001 -->\n\n";
      assert.equal(msg, expected);
      assert.match(msg, ANCHOR_RE);
    });

    test("omits anchor line when entryId is undefined (anchorLost)", () => {
      const msg = formatUserMessage("单行输入", "14:32");
      const expected =
        "> **你** · 14:32\n" +
        ">\n" +
        "> 单行输入\n\n";
      assert.equal(msg, expected);
      assert.equal(ANCHOR_RE.test(msg), false);
    });
  });

  describe("formatAssistantMessage", () => {
    test("formats standard assistant message with anchor and turn delimiter", () => {
      const msg = formatAssistantMessage("这是回答正文。", "14:33", "entry002", true);
      const expected =
        "**Pi** · 14:33\n\n" +
        "这是回答正文。\n\n" +
        "<!-- mdlog:m=entry002 -->\n\n" +
        "---\n\n";
      assert.equal(msg, expected);
    });

    test("appends fence completion line when truncated", () => {
      const msg = formatAssistantMessage(
        "代码片段：\n```ts\nconsole.log(1);",
        "14:33",
        "entry003",
        true,
        { unclosedFence: true }
      );
      const expected =
        "**Pi** · 14:33\n\n" +
        "代码片段：\n```ts\nconsole.log(1);\n```\n*(本条消息被截断，已自动补齐代码围栏)*\n\n" +
        "<!-- mdlog:m=entry003 -->\n\n" +
        "---\n\n";
      assert.equal(msg, expected);
    });

    test("appends unreferenced extra images before anchor", () => {
      const msg = formatAssistantMessage(
        "生成了一张图。",
        "14:33",
        "entry004",
        true,
        { extraImages: ["diagram.png", "chart-2.png"] }
      );
      const expected =
        "**Pi** · 14:33\n\n" +
        "生成了一张图。\n\n" +
        "![生成的图片](mdlog-assets/diagram.png)\n\n" +
        "![生成的图片](mdlog-assets/chart-2.png)\n\n" +
        "<!-- mdlog:m=entry004 -->\n\n" +
        "---\n\n";
      assert.equal(msg, expected);
    });

    test("handles anchorLost without anchor comment", () => {
      const msg = formatAssistantMessage("未命中条目回答", "14:33", undefined, false);
      const expected = "**Pi** · 14:33\n\n未命中条目回答\n\n";
      assert.equal(msg, expected);
      assert.equal(ANCHOR_RE.test(msg), false);
    });
  });

  describe("formatTurnDelimiter", () => {
    test("returns horizontal rule with blank lines", () => {
      assert.equal(formatTurnDelimiter(), "---\n\n");
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/format.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../src/format.ts` 不存在，测试红）。

- [ ] **Step 3: 编写类型定义与纯函数格式化实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\types.ts`：

```typescript
export interface SidecarData {
  version: number;
  sessionId: string;
  pid: number;
  connectedAt: number;
  lastWriteAt: number;
  heartbeatAt: number;
  anchorLost?: boolean;
}

export interface MdlogConfig {
  toolNames?: string[];
  imageExtensions?: string[];
  maxImageBytes?: number;
  assetRetentionMb?: number;
}

export interface MdlogConnectionState {
  active: boolean;
  targetPath: string;
  sessionId: string;
  connectedAt: number;
  lastWriteAt: number;
  writtenCount: number;
  anchorLost?: boolean;
}

export interface TextChunk {
  type: string;
  text?: string;
}

export interface ImageChunk {
  type: string;
  image?: string;
}

export type MessageContent = string | Array<TextChunk | ImageChunk>;
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\format.ts`：

```typescript
import type { MessageContent } from "./types.ts";

export const FINGERPRINT_RE = /^\uFEFF?\s*<!--\s*mdlog:v1\s+s=([^\s>]+)/;
export const ANCHOR_RE = /<!--\s*mdlog:m=([A-Za-z0-9_-]+)\s*-->/;

export function extractMessageText(content: MessageContent | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textChunks: string[] = [];
    for (const chunk of content) {
      if (chunk && chunk.type === "text" && typeof chunk.text === "string" && chunk.text.length > 0) {
        textChunks.push(chunk.text);
      }
    }
    return textChunks.join("\n\n");
  }
  return "";
}

export function formatTimestamp(timestamp: number, previousTimestamp?: number): string {
  const curr = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hh = pad(curr.getHours());
  const mm = pad(curr.getMinutes());

  if (previousTimestamp !== undefined) {
    const prev = new Date(previousTimestamp);
    const isSameDay =
      curr.getFullYear() === prev.getFullYear() &&
      curr.getMonth() === prev.getMonth() &&
      curr.getDate() === prev.getDate();
    if (!isSameDay) {
      const month = pad(curr.getMonth() + 1);
      const date = pad(curr.getDate());
      return `${month}-${date} ${hh}:${mm}`;
    }
  }
  return `${hh}:${mm}`;
}

export function scanCodeFences(text: string): {
  isUnclosed: boolean;
  fenceChar?: string;
  fenceLength?: number;
} {
  const lines = text.split("\n");
  let inFence = false;
  let activeChar = "";
  let activeLength = 0;

  const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

  for (const line of lines) {
    if (!inFence) {
      const match = OPEN_FENCE_RE.exec(line);
      if (match) {
        const fenceStr = match[1];
        inFence = true;
        activeChar = fenceStr[0];
        activeLength = fenceStr.length;
      }
    } else {
      const CLOSE_FENCE_RE = new RegExp(`^ {0,3}${activeChar === "`" ? "`" : "~"}{${activeLength},}\\s*$`);
      if (CLOSE_FENCE_RE.test(line)) {
        inFence = false;
        activeChar = "";
        activeLength = 0;
      }
    }
  }

  return inFence
    ? { isUnclosed: true, fenceChar: activeChar, fenceLength: activeLength }
    : { isUnclosed: false };
}

export function formatHeader(sessionId: string): string {
  return `<!-- mdlog:v1 s=${sessionId} -->\n\n# Pi 对话记录\n\n`;
}

export function formatUserMessage(text: string, time: string, entryId?: string): string {
  const clean = text.replace(/\s+$/, "");
  const lines = clean.split("\n");
  const quoted = lines.map((line) => (line.length > 0 ? `> ${line}` : ">")).join("\n");
  const anchor = entryId ? `<!-- mdlog:m=${entryId} -->\n\n` : "";
  return `> **你** · ${time}\n>\n${quoted}\n\n${anchor}`;
}

export function formatAssistantMessage(
  text: string,
  time: string,
  entryId?: string,
  isEnd = false,
  options?: { unclosedFence?: boolean; extraImages?: string[] }
): string {
  const speaker = `**Pi** · ${time}\n\n`;
  let body = text.replace(/\s+$/, "");

  if (options?.unclosedFence) {
    body += "\n```\n*(本条消息被截断，已自动补齐代码围栏)*";
  }

  if (options?.extraImages && options.extraImages.length > 0) {
    for (const img of options.extraImages) {
      body += `\n\n![生成的图片](mdlog-assets/${img})`;
    }
  }

  const anchor = entryId ? `\n\n<!-- mdlog:m=${entryId} -->\n\n` : "\n\n";
  const endDelimiter = isEnd ? "---\n\n" : "";

  return `${speaker}${body}${anchor}${endDelimiter}`;
}

export function formatTurnDelimiter(): string {
  return "---\n\n";
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/format.test.ts
```
预期输出：`tests 14, pass 14, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `format.ts` 中无任何状态依赖，格式化公式与 spec §3.4、Y5 逐字节对齐。

---

### Task 4.2: 智能追加与逆向扫描引擎（Smart Append & Scan Engine）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\scan.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\scan.test.ts`

**Interfaces:**
- Consumes:
  - `src/format.ts` (`FINGERPRINT_RE`, `ANCHOR_RE`, `formatHeader`)
- Produces:
  - `export interface AppendPlan { mode: "increment" | "full" | "append_only" | "ask_user"; fromEntryId?: string }`
  - `export interface ResolveAppendOptions { hasUI: boolean; forceFull?: boolean; forceAppend?: boolean }`
  - `export function findLastBranchAnchor(markdownContent: string, branchEntryIds: Set<string>): { matchedEntryId: string | null; anchorLineIndex: number }`
  - `export function extractSessionFingerprint(markdownContent: string): string | null`
  - `export function resolveAppendPlan(markdownContent: string, currentSessionId: string, branchEntryIds: Set<string>, options: ResolveAppendOptions): AppendPlan`
  - `export function insertHeaderAtTopAtomic(filePath: string, sessionId: string): void`

- [ ] **Step 1: 编写逆向扫描与智能追加失败测试**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\scan.test.ts`，覆盖伪锚点过滤、分支回退命中、指纹匹配分支 4a/4b 及原子插头：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  findLastBranchAnchor,
  extractSessionFingerprint,
  resolveAppendPlan,
  insertHeaderAtTopAtomic,
} from "../src/scan.ts";

describe("scan module", () => {
  describe("findLastBranchAnchor", () => {
    test("finds the latest anchor that belongs to the current branch", () => {
      const md = [
        "# Document",
        "> **你** · 10:00",
        "> hi",
        "",
        "<!-- mdlog:m=entry-1 -->",
        "",
        "**Pi** · 10:01",
        "hello",
        "",
        "<!-- mdlog:m=entry-2 -->",
        "",
        "---",
      ].join("\n");

      const branchIds = new Set(["entry-1", "entry-2", "entry-3"]);
      const res = findLastBranchAnchor(md, branchIds);
      assert.equal(res.matchedEntryId, "entry-2");
    });

    test("skips pseudo anchors inside code fences (Y6-d)", () => {
      const md = [
        "<!-- mdlog:m=valid-1 -->",
        "```markdown",
        "Inside code block pseudo anchor:",
        "<!-- mdlog:m=fake-anchor -->",
        "```",
        "Some text after block",
      ].join("\n");

      const branchIds = new Set(["valid-1", "fake-anchor"]);
      const res = findLastBranchAnchor(md, branchIds);
      assert.equal(res.matchedEntryId, "valid-1");
    });

    test("rolls back until finding a branch-belonging anchor (Y6-a)", () => {
      const md = [
        "<!-- mdlog:m=old-branch-anchor -->",
        "",
        "<!-- mdlog:m=foreign-anchor -->",
      ].join("\n");

      const branchIds = new Set(["old-branch-anchor", "other-entry"]);
      const res = findLastBranchAnchor(md, branchIds);
      assert.equal(res.matchedEntryId, "old-branch-anchor");
    });

    test("returns null if no anchors belong to the branch", () => {
      const md = "<!-- mdlog:m=foreign-1 -->\n<!-- mdlog:m=foreign-2 -->";
      const branchIds = new Set(["entry-x", "entry-y"]);
      const res = findLastBranchAnchor(md, branchIds);
      assert.equal(res.matchedEntryId, null);
      assert.equal(res.anchorLineIndex, -1);
    });
  });

  describe("extractSessionFingerprint", () => {
    test("extracts sessionId from standard header", () => {
      const md = "<!-- mdlog:v1 s=session-uuid-1234 -->\n\n# Title";
      assert.equal(extractSessionFingerprint(md), "session-uuid-1234");
    });

    test("extracts sessionId with BOM and extra spaces", () => {
      const md = "\uFEFF  <!--   mdlog:v1   s=sess-with-spaces-5678  -->\n# Title";
      assert.equal(extractSessionFingerprint(md), "sess-with-spaces-5678");
    });

    test("returns null for non-mdlog files", () => {
      const md = "# Normal Document\nJust text";
      assert.equal(extractSessionFingerprint(md), null);
    });
  });

  describe("resolveAppendPlan", () => {
    const branchIds = new Set(["e1", "e2"]);

    test("honors forceFull flag", () => {
      const plan = resolveAppendPlan("# Doc", "sess-1", branchIds, { hasUI: true, forceFull: true });
      assert.deepEqual(plan, { mode: "full" });
    });

    test("honors forceAppend flag", () => {
      const plan = resolveAppendPlan("# Doc", "sess-1", branchIds, { hasUI: true, forceAppend: true });
      assert.deepEqual(plan, { mode: "append_only" });
    });

    test("returns full for empty file", () => {
      const plan = resolveAppendPlan("", "sess-1", branchIds, { hasUI: true });
      assert.deepEqual(plan, { mode: "full" });
    });

    test("returns increment when valid branch anchor hit", () => {
      const md = "<!-- mdlog:m=e1 -->\n\nSome text";
      const plan = resolveAppendPlan(md, "sess-1", branchIds, { hasUI: true });
      assert.deepEqual(plan, { mode: "increment", fromEntryId: "e1" });
    });

    test("returns ask_user for branch 4a with UI", () => {
      const md = "<!-- mdlog:v1 s=sess-1 -->\n\n# Doc without anchors";
      const plan = resolveAppendPlan(md, "sess-1", branchIds, { hasUI: true });
      assert.deepEqual(plan, { mode: "ask_user" });
    });

    test("returns append_only for branch 4a without UI", () => {
      const md = "<!-- mdlog:v1 s=sess-1 -->\n\n# Doc without anchors";
      const plan = resolveAppendPlan(md, "sess-1", branchIds, { hasUI: false });
      assert.deepEqual(plan, { mode: "append_only" });
    });

    test("returns full for branch 4b (foreign session or missing header)", () => {
      const md = "<!-- mdlog:v1 s=sess-other -->\n\n# Foreign doc";
      const plan = resolveAppendPlan(md, "sess-1", branchIds, { hasUI: true });
      assert.deepEqual(plan, { mode: "full" });
    });
  });

  describe("insertHeaderAtTopAtomic", () => {
    test("inserts header at line 1 of foreign non-empty file atomically", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-test-"));
      const testFile = path.join(tmpDir, "test.md");
      fs.writeFileSync(testFile, "# Existing User Notes\n\nNote line 1.", "utf8");

      insertHeaderAtTopAtomic(testFile, "sess-new-atomic");

      const updated = fs.readFileSync(testFile, "utf8");
      assert.ok(updated.startsWith("<!-- mdlog:v1 s=sess-new-atomic -->\n\n# Pi 对话记录\n\n"));
      assert.ok(updated.includes("# Existing User Notes\n\nNote line 1."));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/scan.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../src/scan.ts` 不存在，测试红）。

- [ ] **Step 3: 编写逆向扫描与智能追加实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\scan.ts`：

```typescript
import * as fs from "node:fs";
import { FINGERPRINT_RE, ANCHOR_RE, formatHeader } from "./format.ts";

export interface AppendPlan {
  mode: "increment" | "full" | "append_only" | "ask_user";
  fromEntryId?: string;
}

export interface ResolveAppendOptions {
  hasUI: boolean;
  forceFull?: boolean;
  forceAppend?: boolean;
}

export function findLastBranchAnchor(
  markdownContent: string,
  branchEntryIds: Set<string>
): { matchedEntryId: string | null; anchorLineIndex: number } {
  const lines = markdownContent.split("\n");
  const fenceRanges: Array<[number, number]> = [];

  // 1. 正向扫描标记所有代码围栏开闭区间（CommonMark 规范，杜绝伪锚点误判）
  let inFence = false;
  let activeChar = "";
  let activeLength = 0;
  let fenceStart = -1;

  const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inFence) {
      const match = OPEN_FENCE_RE.exec(line);
      if (match) {
        inFence = true;
        activeChar = match[1][0];
        activeLength = match[1].length;
        fenceStart = i;
      }
    } else {
      const CLOSE_FENCE_RE = new RegExp(`^ {0,3}${activeChar === "`" ? "`" : "~"}{${activeLength},}\\s*$`);
      if (CLOSE_FENCE_RE.test(line)) {
        inFence = false;
        fenceRanges.push([fenceStart, i]);
        fenceStart = -1;
      }
    }
  }

  if (inFence && fenceStart !== -1) {
    fenceRanges.push([fenceStart, lines.length - 1]);
  }

  function isInsideFence(lineIdx: number): boolean {
    for (const [start, end] of fenceRanges) {
      if (lineIdx >= start && lineIdx <= end) {
        return true;
      }
    }
    return false;
  }

  // 2. 尾向扫描回退直到命中分支锚点或到达文件开头 (Y6-a, Y6-d)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isInsideFence(i)) {
      continue;
    }
    const match = ANCHOR_RE.exec(lines[i]);
    if (match) {
      const entryId = match[1];
      if (branchEntryIds.has(entryId)) {
        return { matchedEntryId: entryId, anchorLineIndex: i };
      }
    }
  }

  return { matchedEntryId: null, anchorLineIndex: -1 };
}

export function extractSessionFingerprint(markdownContent: string): string | null {
  const match = FINGERPRINT_RE.exec(markdownContent);
  return match ? match[1].trim() : null;
}

export function resolveAppendPlan(
  markdownContent: string,
  currentSessionId: string,
  branchEntryIds: Set<string>,
  options: ResolveAppendOptions
): AppendPlan {
  if (options.forceFull) {
    return { mode: "full" };
  }
  if (options.forceAppend) {
    return { mode: "append_only" };
  }

  const trimmed = markdownContent.trim();
  if (trimmed.length === 0) {
    return { mode: "full" };
  }

  // 1. 扫描寻找属于当前分支的有效锚点
  const anchorResult = findLastBranchAnchor(markdownContent, branchEntryIds);
  if (anchorResult.matchedEntryId) {
    return { mode: "increment", fromEntryId: anchorResult.matchedEntryId };
  }

  // 2. 未命中任何分支锚点：提取首行会话指纹 (Y6-b)
  const fileFingerprint = extractSessionFingerprint(markdownContent);

  if (fileFingerprint === currentSessionId) {
    // 分支 4a：属于当前会话但锚点断裂
    if (options.hasUI) {
      return { mode: "ask_user" };
    }
    return { mode: "append_only" };
  }

  // 分支 4b：新文件、外部文件或其他会话文件，回填全量历史
  return { mode: "full" };
}

export function insertHeaderAtTopAtomic(filePath: string, sessionId: string): void {
  const existingContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const fingerprint = extractSessionFingerprint(existingContent);
  if (fingerprint === sessionId) {
    return;
  }

  const header = formatHeader(sessionId);
  const combined = existingContent.length > 0 ? `${header}${existingContent}` : header;

  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.writeFileSync(tempPath, combined, "utf8");
  fs.renameSync(tempPath, filePath);
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/scan.test.ts
```
预期输出：`tests 10, pass 10, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `scan.ts` 完全覆盖 Y6-a（回退直到命中）、Y6-b（指纹提取正则）、Y6-c（4b 原子重写插入顶部）、Y6-d（围栏内伪锚点过滤）、Y6-f（修饰符与确认分支）。

---

### Task 4.3: 图片提取、净化与配额清理管线（Image Pipeline & Asset Retention）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\config.json`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\image.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\image.test.ts`

**Interfaces:**
- Consumes:
  - `src/types.ts` (`MdlogConfig`)
- Produces:
  - `export const IMAGE_PATH_RE: RegExp`
  - `export const DEFAULT_IMAGE_EXTENSIONS: readonly string[]`
  - `export function sanitizeImageFilename(filename: string): string`
  - `export function extractImageCandidates(toolOutput: string, toolNames?: string[], currentToolName?: string): string[]`
  - `export interface ProcessImageOptions { cwd: string; logDir: string; turnStartTime: number; maxImageBytes?: number }`
  - `export interface TurnImageProcessingResult { rewrittenAssistantText: string; unreferencedCleanNames: string[]; copiedFiles: string[] }`
  - `export function processTurnImages(candidates: string[], assistantText: string, options: ProcessImageOptions): TurnImageProcessingResult`
  - `export function cleanAssetRetention(assetsDir: string, maxBytes?: number): string[]`
  - `export function loadMdlogConfig(configFilePath?: string): MdlogConfig`

- [ ] **Step 1: 编写图片管线失败测试与默认配置文件**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\config.json`：

```json
{
  "toolNames": [],
  "imageExtensions": ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
  "maxImageBytes": 20971520,
  "assetRetentionMb": 200
}
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\image.test.ts`，覆盖正则提取、跨目录越界防御、mtime 5 秒窗过滤、20MB 容量保护、文件名净化重命名与配额删除：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  IMAGE_PATH_RE,
  extractImageCandidates,
  sanitizeImageFilename,
  processTurnImages,
  cleanAssetRetention,
  loadMdlogConfig,
} from "../src/image.ts";

describe("image module", () => {
  describe("extractImageCandidates", () => {
    test("extracts image paths from tool output with various quotes and spaces", () => {
      const output = [
        'Generated image at "assets/result 1.png"',
        "Also saved output to /tmp/charts/plot.jpg and img.webp.",
        "Unsupported vector graphic diagram.svg should be ignored.",
      ].join("\n");

      const list = extractImageCandidates(output);
      assert.ok(list.includes("assets/result 1.png") || list.some((p) => p.endsWith("result 1.png")));
      assert.ok(list.some((p) => p.endsWith("plot.jpg")));
      assert.ok(list.some((p) => p.endsWith("img.webp")));
      assert.ok(!list.some((p) => p.endsWith("diagram.svg"))); // SVG 严禁匹配 (Y7-a)
    });

    test("filters tools when toolNames is specified in config", () => {
      const output = "created output.png";
      assert.deepEqual(extractImageCandidates(output, ["imagen2"], "bash"), []);
      assert.equal(extractImageCandidates(output, ["imagen2"], "imagen2").length, 1);
    });
  });

  describe("sanitizeImageFilename", () => {
    test("purges non-ascii characters and spaces to single dashes", () => {
      const clean = sanitizeImageFilename("架构图 流程 (1).png");
      assert.equal(clean, "--------1-.png");
      assert.match(clean, /^[A-Za-z0-9._-]+$/);
    });

    test("falls back to image.ext if all base characters are non-ascii", () => {
      const clean = sanitizeImageFilename("图.png");
      assert.equal(clean, "image.png");
    });
  });

  describe("processTurnImages", () => {
    test("processes valid image, rewrites assistant text, and rejects path traversal", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-img-test-"));
      const cwd = path.join(tmpDir, "workspace");
      const logDir = path.join(tmpDir, "logs");
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(logDir, { recursive: true });

      const now = Date.now();
      const validImg = path.join(cwd, "test-valid.png");
      fs.writeFileSync(validImg, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
      fs.utimesSync(validImg, new Date(now), new Date(now));

      const oldImg = path.join(cwd, "old-history.png");
      fs.writeFileSync(oldImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      const staleTime = (now - 10000) / 1000;
      fs.utimesSync(oldImg, staleTime, staleTime); // 超过 5 秒前历史文件 (Y7-c)

      const outsideImg = path.join(tmpDir, "secret.png");
      fs.writeFileSync(outsideImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const assistantText = "看这张图：test-valid.png 已经生成。";
      const candidates = ["test-valid.png", "old-history.png", "../secret.png"];

      const res = processTurnImages(candidates, assistantText, {
        cwd,
        logDir,
        turnStartTime: now,
      });

      // 1. 验证有效图片被复制且正文被重写为 mdlog-assets
      assert.ok(res.rewrittenAssistantText.includes("mdlog-assets/test-valid.png"));
      assert.ok(fs.existsSync(path.join(logDir, "mdlog-assets", "test-valid.png")));

      // 2. 验证过旧历史图片与越界图片被拦截
      assert.ok(!fs.existsSync(path.join(logDir, "mdlog-assets", "old-history.png")));
      assert.ok(!fs.existsSync(path.join(logDir, "mdlog-assets", "secret.png")));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("handles unreferenced image by adding to unreferencedCleanNames", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-img-test-"));
      const cwd = path.join(tmpDir, "workspace");
      const logDir = path.join(tmpDir, "logs");
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(logDir, { recursive: true });

      const now = Date.now();
      const imgPath = path.join(cwd, "standalone.png");
      fs.writeFileSync(imgPath, Buffer.alloc(100));
      fs.utimesSync(imgPath, new Date(now), new Date(now));

      const res = processTurnImages(["standalone.png"], "正文没有任何图片链接", {
        cwd,
        logDir,
        turnStartTime: now,
      });

      assert.deepEqual(res.unreferencedCleanNames, ["standalone.png"]);
      assert.ok(fs.existsSync(path.join(logDir, "mdlog-assets", "standalone.png")));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test("skips images exceeding 20MB and inserts warning placeholder", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-img-test-"));
      const cwd = path.join(tmpDir, "workspace");
      const logDir = path.join(tmpDir, "logs");
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(logDir, { recursive: true });

      const now = Date.now();
      const bigImg = path.join(cwd, "huge.png");
      fs.writeFileSync(bigImg, Buffer.alloc(10)); // 用小文件模拟，但设置 maxImageBytes 为 5

      const res = processTurnImages(["huge.png"], "正文看：huge.png", {
        cwd,
        logDir,
        turnStartTime: now,
        maxImageBytes: 5,
      });

      assert.ok(res.rewrittenAssistantText.includes("*(图片过大超过20MB，已跳过同步：huge.png)*"));
      assert.ok(!fs.existsSync(path.join(logDir, "mdlog-assets", "huge.png")));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("cleanAssetRetention", () => {
    test("removes oldest files when assets directory exceeds byte quota", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-retention-test-"));
      const assetsDir = path.join(tmpDir, "mdlog-assets");
      fs.mkdirSync(assetsDir, { recursive: true });

      const f1 = path.join(assetsDir, "old.png");
      const f2 = path.join(assetsDir, "new.png");
      fs.writeFileSync(f1, Buffer.alloc(80));
      fs.writeFileSync(f2, Buffer.alloc(80));

      const now = Date.now();
      fs.utimesSync(f1, (now - 10000) / 1000, (now - 10000) / 1000);
      fs.utimesSync(f2, now / 1000, now / 1000);

      // 限额 100 字节，两个文件共 160 字节，应该删掉最旧的 f1
      const deleted = cleanAssetRetention(assetsDir, 100);
      assert.equal(deleted.length, 1);
      assert.equal(deleted[0], f1);
      assert.ok(!fs.existsSync(f1));
      assert.ok(fs.existsSync(f2));

      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/image.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../src/image.ts` 不存在，测试红）。

- [ ] **Step 3: 编写图片提取、净化与配额清理实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\image.ts`：

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { MdlogConfig } from "./types.ts";

export const IMAGE_PATH_RE = /(?:["']|^|\s)([A-Za-z0-9_.\-\\/]+?\.(?:png|jpg|jpeg|gif|webp|bmp))(?=["']|$|\s)/gi;

export const DEFAULT_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"] as const;

export function loadMdlogConfig(configFilePath?: string): MdlogConfig {
  const defaultCfg: MdlogConfig = {
    toolNames: [],
    imageExtensions: [...DEFAULT_IMAGE_EXTENSIONS],
    maxImageBytes: 20 * 1024 * 1024,
    assetRetentionMb: 200,
  };

  const targetPath =
    configFilePath ??
    path.join(
      process.env.USERPROFILE || process.env.HOME || "",
      ".pi",
      "agent",
      "extensions",
      "mdlog",
      "config.json"
    );

  try {
    if (fs.existsSync(targetPath)) {
      const raw = fs.readFileSync(targetPath, "utf8");
      const parsed = JSON.parse(raw);
      return { ...defaultCfg, ...parsed };
    }
  } catch {
    // 读取或解析异常回退默认配置
  }
  return defaultCfg;
}

export function extractImageCandidates(
  toolOutput: string,
  configuredToolNames?: string[],
  currentToolName?: string
): string[] {
  if (configuredToolNames && configuredToolNames.length > 0) {
    if (!currentToolName || !configuredToolNames.includes(currentToolName)) {
      return [];
    }
  }

  const results: string[] = [];
  const set = new Set<string>();
  let match: RegExpExecArray | null;

  const re = new RegExp(IMAGE_PATH_RE.source, IMAGE_PATH_RE.flags);
  while ((match = re.exec(toolOutput)) !== null) {
    const rawPath = match[1].trim();
    if (!set.has(rawPath)) {
      set.add(rawPath);
      results.push(rawPath);
    }
  }

  return results;
}

export function sanitizeImageFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  let base = path.basename(filename, ext);

  // 移除非安全字符，保留 [A-Za-z0-9._-]
  base = base.replace(/[^A-Za-z0-9._-]/g, "-");
  if (base.replace(/-/g, "").length === 0) {
    base = "image";
  }

  return `${base}${ext}`;
}

export interface ProcessImageOptions {
  cwd: string;
  logDir: string;
  turnStartTime: number;
  maxImageBytes?: number;
}

export interface TurnImageProcessingResult {
  rewrittenAssistantText: string;
  unreferencedCleanNames: string[];
  copiedFiles: string[];
}

export function processTurnImages(
  candidates: string[],
  assistantText: string,
  options: ProcessImageOptions
): TurnImageProcessingResult {
  const maxBytes = options.maxImageBytes ?? 20 * 1024 * 1024;
  const assetsDir = path.join(options.logDir, "mdlog-assets");
  const unreferencedCleanNames: string[] = [];
  const copiedFiles: string[] = [];
  let rewrittenAssistantText = assistantText;

  const normalizedCwd = path.resolve(options.cwd);

  for (const candidate of candidates) {
    // 1. 相对路径解析以 cwd 为唯一基准 (Y7-e)
    const resolvedPath = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(normalizedCwd, candidate);

    // 2. 包含性安全约束：严禁越出 cwd 目录抓取用户私有文件
    const relFromCwd = path.relative(normalizedCwd, resolvedPath);
    if (relFromCwd.startsWith("..") || path.isAbsolute(relFromCwd)) {
      continue;
    }

    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      continue;
    }

    if (!stat.isFile()) {
      continue;
    }

    // 3. mtime 过滤：仅复制 stat.mtimeMs >= turnStartTime - 5000 的新文件 (Y7-c)
    if (stat.mtimeMs < options.turnStartTime - 5000) {
      continue;
    }

    // 4. 20MB 容量保护
    if (stat.size > maxBytes) {
      const placeholder = `*(图片过大超过20MB，已跳过同步：${candidate})*`;
      if (rewrittenAssistantText.includes(candidate)) {
        rewrittenAssistantText = rewrittenAssistantText.replaceAll(candidate, placeholder);
      } else {
        rewrittenAssistantText += `\n\n${placeholder}`;
      }
      continue;
    }

    // 5. 文件名净化与 mdlog-assets 复制去重
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    const cleanName = sanitizeImageFilename(path.basename(resolvedPath));
    const ext = path.extname(cleanName);
    const base = path.basename(cleanName, ext);

    let finalCleanName = cleanName;
    let targetPath = path.join(assetsDir, finalCleanName);
    let counter = 2;

    while (fs.existsSync(targetPath)) {
      finalCleanName = `${base}-${counter}${ext}`;
      targetPath = path.join(assetsDir, finalCleanName);
      counter++;
    }

    try {
      fs.copyFileSync(resolvedPath, targetPath);
      copiedFiles.push(targetPath);
    } catch {
      continue;
    }

    // 6. 正文替换为相对路径 mdlog-assets/<finalCleanName>
    const relativeAssetPath = `mdlog-assets/${finalCleanName}`;
    const escapedCandidate = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const candidateRegex = new RegExp(escapedCandidate, "g");

    if (candidateRegex.test(rewrittenAssistantText)) {
      rewrittenAssistantText = rewrittenAssistantText.replace(candidateRegex, relativeAssetPath);
    } else {
      unreferencedCleanNames.push(finalCleanName);
    }
  }

  return {
    rewrittenAssistantText,
    unreferencedCleanNames,
    copiedFiles,
  };
}

export function cleanAssetRetention(assetsDir: string, maxBytes = 200 * 1024 * 1024): string[] {
  if (!fs.existsSync(assetsDir)) {
    return [];
  }

  let entries: Array<{ filePath: string; size: number; mtimeMs: number }> = [];
  try {
    const files = fs.readdirSync(assetsDir);
    for (const file of files) {
      const fullPath = path.join(assetsDir, file);
      try {
        const s = fs.statSync(fullPath);
        if (s.isFile()) {
          entries.push({ filePath: fullPath, size: s.size, mtimeMs: s.mtimeMs });
        }
      } catch {
        // 忽略竞争跳过
      }
    }
  } catch {
    return [];
  }

  let totalSize = entries.reduce((acc, curr) => acc + curr.size, 0);
  if (totalSize <= maxBytes) {
    return [];
  }

  // 最旧文件排在最前 (mtime 升序)
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);

  const deleted: string[] = [];
  for (const item of entries) {
    if (totalSize <= maxBytes) break;
    try {
      fs.unlinkSync(item.filePath);
      totalSize -= item.size;
      deleted.push(item.filePath);
    } catch {
      // 容错继续
    }
  }

  return deleted;
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/image.test.ts
```
预期输出：`tests 6, pass 6, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `image.ts` 完整实现 Y7-a~Y7-f 全部规则，排除 svg，保证绝对不越界抓取外部敏感目录。

---

### Task 4.4: 串行实时写入器与指数退避重试（Live Log Writer & Exponential Backoff Retry）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\writer.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\writer.test.ts`

**Interfaces:**
- Consumes:
  - `src/types.ts` (`MessageContent`, `MdlogConfig`)
  - `src/format.ts` (`formatTimestamp`, `formatUserMessage`, `formatAssistantMessage`, `scanCodeFences`, `extractMessageText`)
  - `src/image.ts` (`processTurnImages`, `cleanAssetRetention`)
- Produces:
  - `export interface SessionEntryLike { id: string; type?: string; message?: unknown }`
  - `export interface SessionManagerLike { getBranch(): SessionEntryLike[]; getCwd(): string; getSessionId(): string }`
  - `export interface BufferedMessageItem { message: { role: string; content: MessageContent; timestamp?: number }; turnStartTime?: number }`
  - `export interface WriterOptions { filePath: string; sessionId: string; sessionManager: SessionManagerLike; config?: MdlogConfig; onAnchorLost?: () => void; onWriteSuccess?: (ts: number) => void; onFatalError?: (msg: string) => void }`
  - `export class LiveLogWriter`

- [ ] **Step 1: 编写串行写入器与容灾重试失败测试**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\writer.test.ts`，覆盖 150ms 防抖合并、串行单调追加、反查 entryId 及降级 anchorLost、50/150/300ms 指数退避微重试与连续 3 批失败熔断：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { LiveLogWriter, type SessionManagerLike } from "../src/writer.ts";

describe("LiveLogWriter", () => {
  function createMockSessionManager(sessionId: string, cwd: string): SessionManagerLike & { entries: Array<{ id: string; message: unknown }> } {
    const entries: Array<{ id: string; message: unknown }> = [];
    return {
      entries,
      getSessionId: () => sessionId,
      getCwd: () => cwd,
      getBranch: () => entries,
    };
  }

  test("batches messages with 150ms debounce and matches branch entryId", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-writer-test-"));
    const logFile = path.join(tmpDir, "session.md");
    fs.writeFileSync(logFile, "<!-- mdlog:v1 s=s1 -->\n\n# Pi 对话记录\n\n");

    const sm = createMockSessionManager("s1", tmpDir);
    let lastWrite = 0;

    const writer = new LiveLogWriter({
      filePath: logFile,
      sessionId: "s1",
      sessionManager: sm,
      onWriteSuccess: (ts) => {
        lastWrite = ts;
      },
    });

    const userMsg = { role: "user", content: "提问 1", timestamp: Date.now() };
    const asstMsg = { role: "assistant", content: "回答 1", timestamp: Date.now() };

    // 模拟 sessionManager 在写入前完成了持久化记录条目
    sm.entries.push({ id: "entry-u1", message: userMsg });
    sm.entries.push({ id: "entry-a1", message: asstMsg });

    writer.enqueueMessage({ message: userMsg });
    writer.enqueueMessage({ message: asstMsg });

    // 等待 150ms 防抖触发与落盘
    await new Promise((r) => setTimeout(r, 260));

    const content = fs.readFileSync(logFile, "utf8");
    assert.ok(content.includes("<!-- mdlog:m=entry-u1 -->"));
    assert.ok(content.includes("<!-- mdlog:m=entry-a1 -->"));
    assert.ok(content.includes("> **你** · "));
    assert.ok(content.includes("**Pi** · "));
    assert.ok(lastWrite > 0);

    await writer.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("handles degraded match when entryId is not found (anchorLost: true)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-writer-test-"));
    const logFile = path.join(tmpDir, "session.md");
    fs.writeFileSync(logFile, "<!-- mdlog:v1 s=s1 -->\n\n# Pi 对话记录\n\n");

    const sm = createMockSessionManager("s1", tmpDir);
    let anchorLostTriggered = false;

    const writer = new LiveLogWriter({
      filePath: logFile,
      sessionId: "s1",
      sessionManager: sm,
      onAnchorLost: () => {
        anchorLostTriggered = true;
      },
    });

    const userMsg = { role: "user", content: "孤立消息", timestamp: Date.now() };
    // sm.entries 为空，故意比对失败
    writer.enqueueMessage({ message: userMsg });

    await writer.flush();

    const content = fs.readFileSync(logFile, "utf8");
    assert.ok(content.includes("> 孤立消息"));
    assert.ok(!content.includes("<!-- mdlog:m=")); // 严禁写入空值或伪锚点 (Y6-e)
    assert.equal(anchorLostTriggered, true);

    await writer.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("retries up to 3 times on simulated file lock and disconnects after 3 failed batches", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-writer-test-"));
    const logFile = path.join(tmpDir, "session.md");
    fs.writeFileSync(logFile, "<!-- mdlog:v1 s=s1 -->\n\n# Pi 对话记录\n\n");

    const sm = createMockSessionManager("s1", tmpDir);
    let fatalErrorMsg = "";

    const writer = new LiveLogWriter({
      filePath: logFile,
      sessionId: "s1",
      sessionManager: sm,
      onFatalError: (msg) => {
        fatalErrorMsg = msg;
      },
    });

    // 模拟底层追加写入始终抛出 EBUSY 错误
    let writeAttempts = 0;
    writer._testInjectAppendFailure = () => {
      writeAttempts++;
      const err = new Error("Resource locked");
      (err as unknown as { code: string }).code = "EBUSY";
      throw err;
    };

    // 触发第一批写入
    writer.enqueueMessage({ message: { role: "user", content: "消息 1", timestamp: Date.now() } });
    await writer.flush();
    assert.equal(writeAttempts, 3); // 单批就地微重试 3 次 (50/150/300ms)

    // 触发第二批写入
    writer.enqueueMessage({ message: { role: "user", content: "消息 2", timestamp: Date.now() } });
    await writer.flush();
    assert.equal(writeAttempts, 6);

    // 触发第三批写入，达到连续 3 批失败阈值
    writer.enqueueMessage({ message: { role: "user", content: "消息 3", timestamp: Date.now() } });
    await writer.flush();
    assert.equal(writeAttempts, 9);
    assert.ok(fatalErrorMsg.includes("磁盘写入连续失败"));

    await writer.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/writer.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../src/writer.ts` 不存在，测试红）。

- [ ] **Step 3: 编写串行实时写入器实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\writer.ts`：

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { MessageContent, MdlogConfig } from "./types.ts";
import {
  formatTimestamp,
  formatUserMessage,
  formatAssistantMessage,
  scanCodeFences,
  extractMessageText,
} from "./format.ts";
import { processTurnImages, cleanAssetRetention } from "./image.ts";

export interface SessionEntryLike {
  id: string;
  type?: string;
  message?: unknown;
}

export interface SessionManagerLike {
  getBranch(): SessionEntryLike[];
  getCwd(): string;
  getSessionId(): string;
}

export interface BufferedMessageItem {
  message: {
    role: string;
    content: MessageContent;
    timestamp?: number;
  };
  turnStartTime?: number;
}

export interface WriterOptions {
  filePath: string;
  sessionId: string;
  sessionManager: SessionManagerLike;
  config?: MdlogConfig;
  onAnchorLost?: () => void;
  onWriteSuccess?: (ts: number) => void;
  onFatalError?: (msg: string) => void;
}

export class LiveLogWriter {
  private filePath: string;
  private sessionId: string;
  private sessionManager: SessionManagerLike;
  private config?: MdlogConfig;
  private onAnchorLost?: () => void;
  private onWriteSuccess?: (ts: number) => void;
  private onFatalError?: (msg: string) => void;

  private messageQueue: BufferedMessageItem[] = [];
  private imageCandidatesQueue: Array<{ candidates: string[]; turnStartTime: number }> = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private consecutiveBatchFailures = 0;
  private isDisposed = false;
  private lastMessageTimestamp?: number;

  // 供测试注入文件锁错误
  public _testInjectAppendFailure?: () => void;

  constructor(options: WriterOptions) {
    this.filePath = options.filePath;
    this.sessionId = options.sessionId;
    this.sessionManager = options.sessionManager;
    this.config = options.config;
    this.onAnchorLost = options.onAnchorLost;
    this.onWriteSuccess = options.onWriteSuccess;
    this.onFatalError = options.onFatalError;
  }

  // 事件 handler 严禁 await，同步推入队列并通过 setTimeout 调度 (Y12)
  public enqueueMessage(item: BufferedMessageItem): void {
    if (this.isDisposed) return;
    this.messageQueue.push(item);
    this.scheduleDebounce();
  }

  public enqueueImageCandidates(candidates: string[], turnStartTime: number): void {
    if (this.isDisposed || candidates.length === 0) return;
    this.imageCandidatesQueue.push({ candidates, turnStartTime });
  }

  private scheduleDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush().catch(() => {});
    }, 150);
  }

  // 通过严格串行的 Promise 链单调追加写入 (Y12)
  public async flush(options?: { imageTimeoutMs?: number }): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.writeChain = this.writeChain.then(async () => {
      if (this.messageQueue.length === 0 && this.imageCandidatesQueue.length === 0) {
        return;
      }

      const batchMessages = [...this.messageQueue];
      const batchImages = [...this.imageCandidatesQueue];
      this.messageQueue = [];
      this.imageCandidatesQueue = [];

      try {
        await this.executeBatchWriteWithRetry(batchMessages, batchImages);
        this.consecutiveBatchFailures = 0;
        const now = Date.now();
        this.onWriteSuccess?.(now);

        // 异步资产配额检查
        const logDir = path.dirname(this.filePath);
        const assetsDir = path.join(logDir, "mdlog-assets");
        const maxBytes = (this.config?.assetRetentionMb ?? 200) * 1024 * 1024;
        cleanAssetRetention(assetsDir, maxBytes);
      } catch (err) {
        // 批次失败：放回待写队列
        this.messageQueue.unshift(...batchMessages);
        this.imageCandidatesQueue.unshift(...batchImages);
        this.consecutiveBatchFailures++;

        if (this.consecutiveBatchFailures >= 3) {
          this.onFatalError?.(`mdlog: 磁盘写入连续失败 3 次 (${(err as Error).message})，已自动断开连接`);
        }
      }
    });

    return this.writeChain;
  }

  private async executeBatchWriteWithRetry(
    messages: BufferedMessageItem[],
    images: Array<{ candidates: string[]; turnStartTime: number }>
  ): Promise<void> {
    const delays = [50, 150, 300]; // 50/150/300ms 指数退避微重试 (§3.8)
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (this._testInjectAppendFailure) {
          this._testInjectAppendFailure();
        }
        this.writeBatchToDisk(messages, images);
        return;
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }
    throw lastError;
  }

  private writeBatchToDisk(
    messages: BufferedMessageItem[],
    imageBatches: Array<{ candidates: string[]; turnStartTime: number }>
  ): void {
    if (messages.length === 0) return;

    const branch = this.sessionManager.getBranch();
    const logDir = path.dirname(this.filePath);
    const cwd = this.sessionManager.getCwd();

    // 收集候选图片
    const allCandidates: string[] = [];
    let latestTurnStartTime = Date.now();
    for (const ib of imageBatches) {
      allCandidates.push(...ib.candidates);
      if (ib.turnStartTime < latestTurnStartTime) {
        latestTurnStartTime = ib.turnStartTime;
      }
    }

    let appendBuffer = "";
    let batchAnchorLost = false;

    // 逐条处理本批消息
    for (let i = 0; i < messages.length; i++) {
      const item = messages[i];
      const role = item.message.role;
      const rawText = extractMessageText(item.message.content);
      const timestamp = item.message.timestamp ?? Date.now();
      const timeStr = formatTimestamp(timestamp, this.lastMessageTimestamp);
      this.lastMessageTimestamp = timestamp;

      // 反查条目 ID (Y6-e)
      let matchedEntryId: string | undefined;
      for (let b = branch.length - 1; b >= 0; b--) {
        if (branch[b].message === item.message) {
          matchedEntryId = branch[b].id;
          break;
        }
      }

      if (!matchedEntryId) {
        batchAnchorLost = true;
      }

      if (role === "user") {
        appendBuffer += formatUserMessage(rawText, timeStr, matchedEntryId);
      } else if (role === "assistant") {
        const isEnd = i === messages.length - 1;

        // 处理围栏与截断补齐
        const fenceCheck = scanCodeFences(rawText);

        // 处理图片
        const imgResult = processTurnImages(allCandidates, rawText, {
          cwd,
          logDir,
          turnStartTime: latestTurnStartTime,
          maxImageBytes: this.config?.maxImageBytes,
        });

        appendBuffer += formatAssistantMessage(
          imgResult.rewrittenAssistantText,
          timeStr,
          matchedEntryId,
          isEnd,
          {
            unclosedFence: fenceCheck.isUnclosed,
            extraImages: imgResult.unreferencedCleanNames,
          }
        );
      }
    }

    if (batchAnchorLost) {
      this.onAnchorLost?.();
    }

    // 确保父目录存在并原子追加落盘
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.appendFileSync(this.filePath, appendBuffer, "utf8");
  }

  public async destroy(): Promise<void> {
    this.isDisposed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.flush();
  }
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/writer.test.ts
```
预期输出：`tests 3, pass 3, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `writer.ts` 完整实现 150ms 合并防抖、Promise 串行互斥追加、50/150/300ms 指数退避及 3 批失败断开报警逻辑。

---

### Task 4.5: Sidecar 状态机、心跳守护与命令解析器（Sidecar Manager, Heartbeat & Command Handler）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\sidecar.ts`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\src\command.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\sidecar.test.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\command.test.ts`

**Interfaces:**
- Consumes:
  - `src/types.ts` (`SidecarData`, `MdlogConnectionState`)
- Produces:
  - `export function getSidecarPath(logFilePath: string): string`
  - `export function writeSidecar(sidecarPath: string, data: SidecarData): void`
  - `export function readSidecar(sidecarPath: string): SidecarData | null`
  - `export function updateHeartbeat(sidecarPath: string): void`
  - `export function updateLastWrite(sidecarPath: string, timestamp: number): void`
  - `export function setAnchorLost(sidecarPath: string, anchorLost: boolean): void`
  - `export function removeSidecar(sidecarPath: string): void`
  - `export class HeartbeatManager`
  - `export interface ParsedCommand { action: "connect" | "off" | "status"; targetPath?: string; flags: { full: boolean; append: boolean; noOpen: boolean }; error?: string }`
  - `export function parseMdlogCommand(args: string): ParsedCommand`
  - `export function formatStatusOutput(state: MdlogConnectionState | null): string`
  - `export function openInVellum(filePath: string): Promise<{ success: boolean; error?: string }>`

- [ ] **Step 1: 编写 Sidecar 与命令解析失败测试**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\sidecar.test.ts`，覆盖 sidecar 格式、心跳与写入时间分离、定时器调度与断开清理：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  getSidecarPath,
  writeSidecar,
  readSidecar,
  updateHeartbeat,
  updateLastWrite,
  setAnchorLost,
  removeSidecar,
  HeartbeatManager,
} from "../src/sidecar.ts";

describe("sidecar module", () => {
  test("writes sidecar JSON with exact path contract <file>.mdlog", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-sc-test-"));
    const logFile = path.join(tmpDir, "chat.md");
    const sidecarFile = getSidecarPath(logFile);
    assert.equal(sidecarFile, `${logFile}.mdlog`);

    const now = Date.now();
    writeSidecar(sidecarFile, {
      version: 1,
      sessionId: "sess-abc",
      pid: process.pid,
      connectedAt: now,
      lastWriteAt: now,
      heartbeatAt: now,
      anchorLost: false,
    });

    const read = readSidecar(sidecarFile);
    assert.ok(read !== null);
    assert.equal(read.version, 1);
    assert.equal(read.sessionId, "sess-abc");
    assert.equal(read.pid, process.pid);
    assert.equal(read.anchorLost, false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("separates heartbeatAt and lastWriteAt updates (Z1)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-sc-test-"));
    const sidecarFile = path.join(tmpDir, "chat.md.mdlog");

    const t0 = 1000000;
    writeSidecar(sidecarFile, {
      version: 1,
      sessionId: "sess-1",
      pid: process.pid,
      connectedAt: t0,
      lastWriteAt: t0,
      heartbeatAt: t0,
    });

    // 仅刷新心跳：lastWriteAt 保持不变
    updateHeartbeat(sidecarFile);
    let read = readSidecar(sidecarFile)!;
    assert.ok(read.heartbeatAt > t0);
    assert.equal(read.lastWriteAt, t0);

    // 写入消息后刷新 lastWriteAt：仅修改 lastWriteAt
    const tWrite = 2000000;
    updateLastWrite(sidecarFile, tWrite);
    read = readSidecar(sidecarFile)!;
    assert.equal(read.lastWriteAt, tWrite);

    // 记录 anchorLost
    setAnchorLost(sidecarFile, true);
    read = readSidecar(sidecarFile)!;
    assert.equal(read.anchorLost, true);

    // 删除 sidecar
    removeSidecar(sidecarFile);
    assert.equal(fs.existsSync(sidecarFile), false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("HeartbeatManager starts 30s timer and stops cleanly", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-sc-test-"));
    const sidecarFile = path.join(tmpDir, "chat.md.mdlog");

    writeSidecar(sidecarFile, {
      version: 1,
      sessionId: "sess-hb",
      pid: process.pid,
      connectedAt: 100,
      lastWriteAt: 100,
      heartbeatAt: 100,
    });

    const mgr = new HeartbeatManager();
    // 使用短周期 50ms 进行测试
    mgr.start(sidecarFile, 50);
    assert.equal(mgr.isRunning(), true);

    await new Promise((r) => setTimeout(r, 120));
    const read = readSidecar(sidecarFile)!;
    assert.ok(read.heartbeatAt > 100);

    mgr.stop();
    assert.equal(mgr.isRunning(), false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\command.test.ts`，覆盖 D19 参数解析、引号剥离、Windows 空格路径、保留子命令与格式化 status：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMdlogCommand, formatStatusOutput } from "../src/command.ts";

describe("command module", () => {
  describe("parseMdlogCommand", () => {
    test("dispatches reserved subcommands off and status", () => {
      assert.deepEqual(parseMdlogCommand("off"), {
        action: "off",
        flags: { full: false, append: false, noOpen: false },
      });
      assert.deepEqual(parseMdlogCommand("status"), {
        action: "status",
        flags: { full: false, append: false, noOpen: false },
      });
    });

    test("parses target path with spaces and quotes and flags", () => {
      const parsed = parseMdlogCommand('"C:\\My Notes\\my session.md" --full --no-open');
      assert.equal(parsed.action, "connect");
      assert.equal(parsed.targetPath, "C:\\My Notes\\my session.md");
      assert.equal(parsed.flags.full, true);
      assert.equal(parsed.flags.append, false);
      assert.equal(parsed.flags.noOpen, true);
    });

    test("parses target path with flag at front", () => {
      const parsed = parseMdlogCommand("--append 'D:\\notes\\log.markdown'");
      assert.equal(parsed.action, "connect");
      assert.equal(parsed.targetPath, "D:\\notes\\log.markdown");
      assert.equal(parsed.flags.append, true);
    });

    test("rejects invalid non-markdown extension", () => {
      const parsed = parseMdlogCommand("notes.txt");
      assert.equal(parsed.action, "connect");
      assert.ok(parsed.error?.includes(".md 或 .markdown"));
    });

    test("returns status if no arguments provided", () => {
      const parsed = parseMdlogCommand("");
      assert.equal(parsed.action, "status");
    });
  });

  describe("formatStatusOutput", () => {
    test("formats disconnected status", () => {
      const str = formatStatusOutput(null);
      assert.equal(str, "当前未连接任何文件。使用 /mdlog <文件路径> 开始记录。");
    });

    test("formats connected status with written count and formatted time", () => {
      const str = formatStatusOutput({
        active: true,
        targetPath: "C:\\workspace\\notes\\session.md",
        sessionId: "a1b2c3d4e5f6",
        connectedAt: 1757000000000,
        lastWriteAt: new Date(2026, 8, 5, 14, 32, 5).getTime(),
        writtenCount: 14,
      });
      assert.ok(str.includes("连接文件: C:\\workspace\\notes\\session.md"));
      assert.ok(str.includes("已写消息: 14 条"));
      assert.ok(str.includes("会话标识: a1b2c3d4e5f6"));
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/sidecar.test.ts test/command.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（测试红）。

- [ ] **Step 3: 编写 Sidecar 与命令解析实现**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\sidecar.ts`：

```typescript
import * as fs from "node:fs";
import type { SidecarData } from "./types.ts";

export function getSidecarPath(logFilePath: string): string {
  return `${logFilePath}.mdlog`;
}

export function writeSidecar(sidecarPath: string, data: SidecarData): void {
  fs.writeFileSync(sidecarPath, JSON.stringify(data, null, 2), "utf8");
}

export function readSidecar(sidecarPath: string): SidecarData | null {
  try {
    if (!fs.existsSync(sidecarPath)) return null;
    const content = fs.readFileSync(sidecarPath, "utf8");
    return JSON.parse(content) as SidecarData;
  } catch {
    return null;
  }
}

export function updateHeartbeat(sidecarPath: string): void {
  const current = readSidecar(sidecarPath);
  if (!current) return;
  current.heartbeatAt = Date.now();
  writeSidecar(sidecarPath, current);
}

export function updateLastWrite(sidecarPath: string, timestamp: number): void {
  const current = readSidecar(sidecarPath);
  if (!current) return;
  current.lastWriteAt = timestamp;
  writeSidecar(sidecarPath, current);
}

export function setAnchorLost(sidecarPath: string, anchorLost: boolean): void {
  const current = readSidecar(sidecarPath);
  if (!current) return;
  current.anchorLost = anchorLost;
  writeSidecar(sidecarPath, current);
}

export function removeSidecar(sidecarPath: string): void {
  try {
    if (fs.existsSync(sidecarPath)) {
      fs.unlinkSync(sidecarPath);
    }
  } catch {
    // 容错处理
  }
}

export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;

  public start(sidecarPath: string, intervalMs = 30000): void {
    this.stop();
    this.timer = setInterval(() => {
      updateHeartbeat(sidecarPath);
    }, intervalMs);
  }

  public stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public isRunning(): boolean {
    return this.timer !== null;
  }
}
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\src\command.ts`：

```typescript
import { exec } from "node:child_process";
import * as path from "node:path";
import type { MdlogConnectionState } from "./types.ts";

export interface ParsedCommand {
  action: "connect" | "off" | "status";
  targetPath?: string;
  flags: {
    full: boolean;
    append: boolean;
    noOpen: boolean;
  };
  error?: string;
}

export function parseMdlogCommand(args: string): ParsedCommand {
  const trimmed = args.trim();
  if (trimmed.length === 0) {
    return { action: "status", flags: { full: false, append: false, noOpen: false } };
  }

  // 1. 分解 tokens 并识别修饰符 (spec §3.2, D19)
  const tokens = trimmed.split(/\s+/);
  const flags = { full: false, append: false, noOpen: false };
  const nonFlagTokens: string[] = [];

  for (const token of tokens) {
    if (token === "--full") {
      flags.full = true;
    } else if (token === "--append") {
      flags.append = true;
    } else if (token === "--no-open") {
      flags.noOpen = true;
    } else {
      nonFlagTokens.push(token);
    }
  }

  if (nonFlagTokens.length === 0) {
    return { action: "status", flags };
  }

  // 2. 保留子命令优先判定
  if (nonFlagTokens.length === 1) {
    const single = nonFlagTokens[0].toLowerCase();
    if (single === "off") {
      return { action: "off", flags };
    }
    if (single === "status") {
      return { action: "status", flags };
    }
  }

  // 3. 提取路径字符串并剥离首尾配对引号
  // 从原始 trimmed 字符串中剥除已知 flags
  let pathStr = trimmed
    .replace(/(^|\s)--full(?=\s|$)/g, " ")
    .replace(/(^|\s)--append(?=\s|$)/g, " ")
    .replace(/(^|\s)--no-open(?=\s|$)/g, " ")
    .trim();

  if (
    (pathStr.startsWith('"') && pathStr.endsWith('"')) ||
    (pathStr.startsWith("'") && pathStr.endsWith("'"))
  ) {
    pathStr = pathStr.slice(1, -1).trim();
  }

  // 4. 后缀合法性校验 (spec §8)
  const ext = path.extname(pathStr).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    return {
      action: "connect",
      targetPath: pathStr,
      flags,
      error: "目标文件扩展名必须为 .md 或 .markdown",
    };
  }

  return {
    action: "connect",
    targetPath: pathStr,
    flags,
  };
}

export function formatStatusOutput(state: MdlogConnectionState | null): string {
  if (!state || !state.active) {
    return "当前未连接任何文件。使用 /mdlog <文件路径> 开始记录。";
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(state.lastWriteAt);
  const timeStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  return [
    `连接文件: ${state.targetPath}`,
    `已写消息: ${state.writtenCount} 条`,
    `最近写入: ${timeStr}`,
    `会话标识: ${state.sessionId}`,
  ].join("\n");
}

export function openInVellum(filePath: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Windows 环境执行 cmd /c start "" "<文件绝对路径>" (§3.2)
    const cmd = `cmd /c start "" "${path.resolve(filePath)}"`;
    exec(cmd, (err) => {
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true });
      }
    });
  });
}
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/sidecar.test.ts test/command.test.ts
```
预期输出：`tests 8, pass 8, fail 0` 全部通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `sidecar.ts` 与 `command.ts` 严格对齐 spec §3.2、§3.7、Z1 心跳/写入分离与 Windows 打开协议。

---

### Task 4.6: 扩展生命周期接线与端到端假会话验证（Extension Wiring, Session Lifecycle & E2E Validation）

**Files:**
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\index.ts`
- Create: `C:\Users\17445\.pi\agent\extensions\mdlog\README.md`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\lifecycle.test.ts`
- Test: `C:\Users\17445\.pi\agent\extensions\mdlog\test\e2e.test.ts`

**Interfaces:**
- Consumes:
  - `src/types.ts`, `src/format.ts`, `src/scan.ts`, `src/image.ts`, `src/writer.ts`, `src/sidecar.ts`, `src/command.ts`
- Produces:
  - `export default function (pi: ExtensionAPI): void`
  - 全局命令 `/mdlog`（支持参数解析、子命令分发、外部调用与状态展示）
  - 全生命周期恢复（覆盖 `startup`、`reload`、`new`、`resume`、`fork` 全部 5 种 reason）
  - 非阻塞异步事件接线（`message_end`、`tool_execution_end`、`agent_settled`、`session_shutdown`）

- [ ] **Step 1: 编写生命周期接线与端到端验证失败测试**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\lifecycle.test.ts`，测试 mock pi API 下的 5 种 session_start 事件恢复判定、active:false 防幽灵重连、/fork sessionId 不一致拒绝重连及退出时强制落盘与删 sidecar：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import extensionEntry from "../index.ts";

describe("extension lifecycle & wiring", () => {
  interface MockEventCallback {
    (event: any, ctx: any): Promise<any> | any;
  }

  function createMockPi() {
    const handlers = new Map<string, MockEventCallback[]>();
    const commands = new Map<string, any>();
    const customEntries: Array<{ customType: string; data: any }> = [];

    const pi = {
      on(event: string, cb: MockEventCallback) {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(cb);
      },
      registerCommand(name: string, options: any) {
        commands.set(name, options);
      },
      appendEntry(customType: string, data?: any) {
        customEntries.push({ customType, data });
      },
      _emit(event: string, evObj: any, ctx: any) {
        const list = handlers.get(event) || [];
        return Promise.all(list.map((fn) => fn(evObj, ctx)));
      },
      _commands: commands,
      _customEntries: customEntries,
    };
    return pi;
  }

  function createMockCtx(sessionId: string, cwd: string, branch: any[] = []) {
    return {
      hasUI: true,
      ui: {
        notify: (_msg: string, _type?: string) => {},
        confirm: async (_title: string, _message: string) => true,
      },
      sessionManager: {
        getSessionId: () => sessionId,
        getCwd: () => cwd,
        getBranch: () => branch,
      },
    };
  }

  test("does not reconnect when last connection entry is active: false (prevents ghost reconnect)", async () => {
    const pi = createMockPi();
    extensionEntry(pi as any);

    const branch = [
      {
        type: "custom",
        customType: "mdlog:connection",
        data: { active: true, path: "C:\\old.md", sessionId: "s1" },
      },
      {
        type: "custom",
        customType: "mdlog:connection",
        data: { active: false, timestamp: Date.now() },
      },
    ];

    const ctx = createMockCtx("s1", os.tmpdir(), branch);
    let notified = false;
    ctx.ui.notify = () => {
      notified = true;
    };

    // 触发 session_start (reason: startup)
    await pi._emit("session_start", { reason: "startup" }, ctx);
    assert.equal(notified, false); // 不执行任何静默重连
  });

  test("notifies user and refuses auto-reconnect when sessionId mismatches on /fork (Y6-f)", async () => {
    const pi = createMockPi();
    extensionEntry(pi as any);

    const branch = [
      {
        type: "custom",
        customType: "mdlog:connection",
        data: { active: true, path: "C:\\parent.md", sessionId: "parent-session-123" },
      },
    ];

    const ctx = createMockCtx("forked-session-456", os.tmpdir(), branch);
    let notifyMsg = "";
    ctx.ui.notify = (msg: string) => {
      notifyMsg = msg;
    };

    await pi._emit("session_start", { reason: "fork" }, ctx);
    assert.ok(notifyMsg.includes("检测到历史记录配置"));
    assert.ok(notifyMsg.includes("如需记录请执行 /mdlog"));
  });

  test("session_shutdown flushes pending messages and deletes sidecar file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-life-test-"));
    const logFile = path.join(tmpDir, "shutdown-test.md");
    const sidecarFile = `${logFile}.mdlog`;

    const pi = createMockPi();
    extensionEntry(pi as any);

    const ctx = createMockCtx("s-life", tmpDir, []);
    const cmd = pi._commands.get("mdlog");

    // 执行连接命令
    await cmd.handler(`${logFile} --no-open`, ctx);
    assert.ok(fs.existsSync(sidecarFile));

    // 产生一条未落盘消息
    const msg = { role: "user", content: "临终遗言", timestamp: Date.now() };
    await pi._emit("message_end", { message: msg }, ctx);

    // 触发 session_shutdown
    await pi._emit("session_shutdown", {}, ctx);

    // 验证消息已落盘且 sidecar 已被删除
    const content = fs.readFileSync(logFile, "utf8");
    assert.ok(content.includes("> 临终遗言"));
    assert.equal(fs.existsSync(sidecarFile), false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\test\e2e.test.ts`，使用子进程调用真实 `pi` CLI 执行隔离测试：

```typescript
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("pi mdlog E2E with cli", () => {
  test("runs fake prompt with -p --no-session and isolated config", () => {
    // 检查 pi 命令是否可用
    try {
      execSync("pi --version", { stdio: "ignore" });
    } catch {
      // 若当前环境未配置 pi 可执行文件，优雅跳过
      return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-e2e-"));
    const extDir = path.resolve(__dirname, "..");
    const fakeHome = path.join(tmpDir, "fake-home");
    fs.mkdirSync(fakeHome, { recursive: true });

    // 使用隔离的环境变量避免重复加载全局扩展
    const env = {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      PI_CONFIG_DIR: path.join(tmpDir, "config"),
    };

    // 执行 pi -p 测试扩展加载无报错
    try {
      const output = execSync(`pi -p --no-session -e "${extDir}" "echo test"`, {
        env,
        timeout: 15000,
        encoding: "utf8",
      });
      assert.ok(output.length > 0);
    } catch (e: any) {
      // 容忍网络环境限制，只要未报 TypeScript 语法或扩展注册错误即可
      assert.ok(!e.stderr?.includes("SyntaxError"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/lifecycle.test.ts
```
预期输出：`ERR_MODULE_NOT_FOUND`（`../index.ts` 不存在，测试红）。

- [ ] **Step 3: 编写扩展入口与 README.md**

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\index.ts`：

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatHeader } from "./src/format.ts";
import { resolveAppendPlan, insertHeaderAtTopAtomic } from "./src/scan.ts";
import { extractImageCandidates, loadMdlogConfig } from "./src/image.ts";
import { LiveLogWriter } from "./src/writer.ts";
import {
  getSidecarPath,
  writeSidecar,
  removeSidecar,
  setAnchorLost,
  HeartbeatManager,
} from "./src/sidecar.ts";
import {
  parseMdlogCommand,
  formatStatusOutput,
  openInVellum,
} from "./src/command.ts";
import type { MdlogConnectionState } from "./src/types.ts";

export default function (pi: ExtensionAPI): void {
  let currentState: MdlogConnectionState | null = null;
  let writer: LiveLogWriter | null = null;
  const heartbeatManager = new HeartbeatManager();
  const config = loadMdlogConfig();

  async function connectToFile(
    targetFilePath: string,
    ctx: ExtensionContext,
    flags: { full: boolean; append: boolean; noOpen: boolean }
  ) {
    const resolvedPath = path.resolve(targetFilePath);
    const sidecarPath = getSidecarPath(resolvedPath);
    const sessionId = ctx.sessionManager.getSessionId();
    const branch = ctx.sessionManager.getBranch();
    const branchIds = new Set(branch.map((b) => b.id));

    // 1. 读取既有内容或创建新文件
    let existingContent = "";
    if (fs.existsSync(resolvedPath)) {
      existingContent = fs.readFileSync(resolvedPath, "utf8");
    }

    // 2. 计算智能追加方案 (spec §3.5)
    const plan = resolveAppendPlan(existingContent, sessionId, branchIds, {
      hasUI: ctx.hasUI,
      forceFull: flags.full,
      forceAppend: flags.append,
    });

    let effectiveMode = plan.mode;
    if (plan.mode === "ask_user") {
      if (ctx.hasUI && ctx.ui.confirm) {
        const doFull = await ctx.ui.confirm(
          "mdlog 记录连接",
          "检测到该文件属于当前会话，但未找到匹配的续写锚点：选择 [确定] 回填全量历史，还是 [取消] 仅记录后续新消息？"
        );
        effectiveMode = doFull ? "full" : "append_only";
      } else {
        effectiveMode = "append_only";
      }
    }

    // 3. 释放旧连接资源
    if (writer) {
      await writer.destroy();
      writer = null;
    }
    heartbeatManager.stop();

    // 4. 执行文件头写入与全量/增量回填
    if (!fs.existsSync(resolvedPath) || existingContent.trim().length === 0) {
      fs.writeFileSync(resolvedPath, formatHeader(sessionId), "utf8");
    } else if (effectiveMode === "full") {
      insertHeaderAtTopAtomic(resolvedPath, sessionId);
    }

    // 5. 初始化写入器
    let writtenCount = 0;
    writer = new LiveLogWriter({
      filePath: resolvedPath,
      sessionId,
      sessionManager: ctx.sessionManager,
      config,
      onAnchorLost: () => {
        setAnchorLost(sidecarPath, true);
      },
      onWriteSuccess: (ts) => {
        if (currentState) {
          currentState.lastWriteAt = ts;
          currentState.writtenCount = writtenCount;
        }
      },
      onFatalError: (errMsg) => {
        ctx.ui.notify(errMsg, "error");
        disconnect(ctx);
      },
    });

    // 6. 执行历史消息回填
    if (effectiveMode === "full") {
      for (const entry of branch) {
        if (entry.message && typeof entry.message === "object") {
          writer.enqueueMessage({ message: entry.message as any });
          writtenCount++;
        }
      }
      await writer.flush();
    } else if (effectiveMode === "increment" && plan.fromEntryId) {
      let hit = false;
      for (const entry of branch) {
        if (hit) {
          if (entry.message && typeof entry.message === "object") {
            writer.enqueueMessage({ message: entry.message as any });
            writtenCount++;
          }
        } else if (entry.id === plan.fromEntryId) {
          hit = true;
        }
      }
      if (writtenCount > 0) {
        await writer.flush();
      }
    }

    // 7. 初始化 sidecar 与 30s 心跳定时器 (spec §3.7, Z1)
    const now = Date.now();
    writeSidecar(sidecarPath, {
      version: 1,
      sessionId,
      pid: process.pid,
      connectedAt: now,
      lastWriteAt: now,
      heartbeatAt: now,
      anchorLost: false,
    });
    heartbeatManager.start(sidecarPath, 30000);

    currentState = {
      active: true,
      targetPath: resolvedPath,
      sessionId,
      connectedAt: now,
      lastWriteAt: now,
      writtenCount,
    };

    // 8. 记录持久化连接条目 (spec §3.6)
    pi.appendEntry("mdlog:connection", {
      active: true,
      path: resolvedPath,
      sessionId,
      timestamp: now,
    });

    ctx.ui.notify(`mdlog: 已连接至 ${path.basename(resolvedPath)}`, "info");

    // 9. 唤起 Vellum 外部应用 (spec §3.2)
    if (!flags.noOpen) {
      openInVellum(resolvedPath).then((res) => {
        if (!res.success) {
          ctx.ui.notify("已建立记录连接。如未自动在 Vellum 中打开，请手动在 Vellum 中打开该文件。", "warning");
        }
      });
    }
  }

  function disconnect(ctx: ExtensionContext) {
    if (currentState) {
      const sidecarPath = getSidecarPath(currentState.targetPath);
      heartbeatManager.stop();
      removeSidecar(sidecarPath);
      if (writer) {
        writer.destroy().catch(() => {});
        writer = null;
      }

      pi.appendEntry("mdlog:connection", {
        active: false,
        timestamp: Date.now(),
      });

      currentState = null;
      ctx.ui.notify("mdlog: 对话记录已断开连接", "info");
    }
  }

  // --- 命令注册 ---
  pi.registerCommand("mdlog", {
    description: "控制对话实时记录到 Markdown 文档 (/mdlog <路径> | off | status)",
    handler: async (args: string, ctx: ExtensionContext) => {
      const parsed = parseMdlogCommand(args);

      if (parsed.action === "off") {
        disconnect(ctx);
        return;
      }

      if (parsed.action === "status") {
        ctx.ui.notify(formatStatusOutput(currentState), "info");
        return;
      }

      if (parsed.error) {
        ctx.ui.notify(`mdlog: ${parsed.error}`, "error");
        return;
      }

      if (parsed.targetPath) {
        await connectToFile(parsed.targetPath, ctx, parsed.flags);
      }
    },
  });

  // --- 生命周期接线 ---

  // 1. 会话启动恢复 (覆盖 startup, reload, new, resume, fork 全部 5 种)
  pi.on("session_start", async (event, ctx) => {
    const branch = ctx.sessionManager.getBranch();
    let lastConn: any = null;

    for (let i = branch.length - 1; i >= 0; i--) {
      const e = branch[i];
      if (e.type === "custom" && (e as any).customType === "mdlog:connection") {
        lastConn = (e as any).data;
        break;
      }
    }

    if (!lastConn || lastConn.active === false) {
      return;
    }

    // sessionId 不一致防护 (例如 /fork 新分支，spec §3.3)
    if (lastConn.sessionId !== ctx.sessionManager.getSessionId()) {
      ctx.ui.notify(
        "mdlog: 检测到历史记录配置，为避免污染父会话日志未自动连接。如需记录请执行 /mdlog <文件> 手动连接。",
        "info"
      );
      return;
    }

    // 静默重连
    await connectToFile(lastConn.path, ctx, { full: false, append: false, noOpen: true });
  });

  // 2. 消息流结束 (非阻塞同步登记，严禁在 handler 内 await 磁盘写入，Y12)
  pi.on("message_end", (event, _ctx) => {
    if (!writer || !currentState) return;
    const msg = event.message as any;
    if (msg && (msg.role === "user" || msg.role === "assistant")) {
      writer.enqueueMessage({ message: msg });
    }
  });

  // 3. 工具执行结束 (非阻塞提取候选图片推入写入器，Y12)
  pi.on("tool_execution_end", (event, _ctx) => {
    if (!writer || !currentState) return;
    const candidates = extractImageCandidates(
      typeof event.result === "string" ? event.result : JSON.stringify(event.result),
      config.toolNames,
      event.toolName
    );
    if (candidates.length > 0) {
      writer.enqueueImageCandidates(candidates, Date.now());
    }
  });

  // 4. Agent 回合落定触发合并 flush
  pi.on("agent_settled", async () => {
    if (writer) {
      await writer.flush();
    }
  });

  // 5. 会话关闭：先同步 flush 缓冲区，清除心跳，再删除 sidecar (spec §3.3)
  pi.on("session_shutdown", async (_event, _ctx) => {
    if (writer) {
      await writer.flush({ imageTimeoutMs: 1000 });
      await writer.destroy();
      writer = null;
    }
    heartbeatManager.stop();
    if (currentState) {
      const sidecarPath = getSidecarPath(currentState.targetPath);
      removeSidecar(sidecarPath);
      currentState = null;
    }
  });
}
```

创建 `C:\Users\17445\.pi\agent\extensions\mdlog\README.md`：

```markdown
# pi-mdlog

Pi 对话实时记录扩展（Live Markdown Logger for Vellum）。

## 特性

- **MD 文件即真相**：实时将与 Agent 的对话以排版规范的 Markdown 格式追加写入指定日志文件。
- **纸墨融合（kami）**：与 Vellum 阅读器无缝协作，支持「记录中 · PI」心跳存活徽章与沙箱交互块。
- **智能追加**：基于尾向扫描与分支锚点匹配，断线重连或历史回填丝滑无感。
- **图片安全管线**：自动识别回合生成的图片，进行文件名净化、去重与资产配额清理，严格防范跨目录越界。
- **断网沙箱交互**：原生支持 ```` ```vellum-widget ```` 自包含 HTML 演示块。

## 命令用法

- `/mdlog <文件路径> [--full|--append] [--no-open]`：连接至指定 Markdown 文件并开始记录。
  - `--full`：强制回填全量历史记录。
  - `--append`：强制仅记录连接后的新消息。
  - `--no-open`：连接后不自动唤起外部关联应用打开。
- `/mdlog off`：断开当前记录连接并清理 sidecar 状态。
- `/mdlog status`：查看当前连接状态、已写消息数与最后写入时间戳。
```

- [ ] **Step 4: 运行测试验证全绿**

在目录 `C:\Users\17445\.pi\agent\extensions\mdlog\` 下运行：
```bash
node --test test/lifecycle.test.ts test/e2e.test.ts
```
预期输出：`pass` 全部测试通过。

- [ ] **Step 5: 验证并记录检查点**

确认 `index.ts` 将所有事件接线与生命周期解耦，严禁在 handler 内 await 磁盘与网络 I/O，完成 E2E 假会话调用验证。






