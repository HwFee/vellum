import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import mdlogExtension from "../index.ts";
import { readSidecar } from "../src/sidecar.ts";

interface FakeEntry {
  id: string;
  type?: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
}

export interface Harness {
  pi: ExtensionAPI;
  commands: Map<string, { description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }>;
  tools: Map<string, FigureToolLike>;
  transformers: Array<(markdown: string, context: { messageType?: string }) => string>;
  activeTools: string[];
  entries: Array<{ type: string; data?: unknown }>;
  emit: (event: string, payload: unknown, ctx: ExtensionContext) => Promise<void>;
  hasHandler: (event: string) => boolean;
}

/** 测试只用到工具定义的这几个成员 */
export interface FigureToolLike {
  name: string;
  execute: (
    toolCallId: string,
    params: { path?: string; html?: string; title?: string },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext
  ) => Promise<{ content: Array<{ type: string; text: string }>; details?: { id?: string; error?: string } }>;
}

export function harness(): Harness {
  const commands = new Map<
    string,
    { description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }
  >();
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>();
  const entries: Array<{ type: string; data?: unknown }> = [];
  const tools = new Map<string, FigureToolLike>();
  const transformers: Array<(markdown: string, context: { messageType?: string }) => string> = [];
  // 新注册的扩展工具默认进激活表（与 pi 运行期一致），setActiveTools 覆盖它
  const activeTools: string[] = [];

  const pi = {
    registerCommand: (name: string, options: unknown) => {
      commands.set(
        name,
        options as { description?: string; handler: (args: string, ctx: ExtensionContext) => Promise<void> | void }
      );
    },
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    appendEntry: (type: string, data?: unknown) => {
      entries.push({ type, data });
    },
    registerTool: (tool: FigureToolLike) => {
      tools.set(tool.name, tool);
      if (!activeTools.includes(tool.name)) activeTools.push(tool.name);
    },
    registerMarkdownTransformer: (
      transformer: (markdown: string, context: { messageType?: string }) => string
    ) => {
      transformers.push(transformer);
    },
    getActiveTools: () => [...activeTools],
    setActiveTools: (names: string[]) => {
      activeTools.length = 0;
      activeTools.push(...names);
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    commands,
    tools,
    transformers,
    activeTools,
    entries,
    hasHandler: (event: string) => (handlers.get(event) ?? []).length > 0,
    emit: async (event: string, payload: unknown, ctx: ExtensionContext) => {
      for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
    },
  };
}

interface CtxOptions {
  branch: FakeEntry[];
  sessionId?: string;
  hasUI?: boolean;
  confirmResult?: boolean;
}

function makeCtx(cwd: string, options: CtxOptions) {
  const notifications: Array<{ message: string; type?: string }> = [];
  const ctx = {
    hasUI: options.hasUI ?? false,
    cwd,
    ui: {
      notify: (message: string, type?: string) => {
        notifications.push({ message, type });
      },
      confirm: async () => options.confirmResult ?? true,
    },
    sessionManager: {
      getBranch: () => options.branch,
      getCwd: () => cwd,
      getSessionId: () => options.sessionId ?? "sess-1",
    },
  } as unknown as ExtensionContext;
  return { ctx, notifications };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mdlog-life-"));
}

describe("extension lifecycle & wiring", () => {
  test("registers the mdlog command and subscribes all lifecycle events", () => {
    const h = harness();
    mdlogExtension(h.pi);

    const command = h.commands.get("mdlog");
    assert.equal(typeof command?.handler, "function");
    assert.match(String(command?.description), /mdlog/);
    for (const event of ["session_start", "message_end", "tool_execution_end", "agent_settled", "session_shutdown"]) {
      assert.equal(h.hasHandler(event), true);
    }
    assert.equal(h.tools.has("vellum_figure"), true, "应注册 vellum_figure 工具");
    assert.equal(h.transformers.length, 1, "应注册对话记录里的标记改写器");
  });

  test("figure tool follows the connection: inactive when idle, active while recording", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "session.md");
    const { ctx } = makeCtx(dir, { branch: [] });

    const h = harness();
    mdlogExtension(h.pi);
    // 未连接：session_start 把工具摘出工具表（全局扩展不该在无关项目里多一个工具）
    await h.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
    assert.equal(h.activeTools.includes("vellum_figure"), false);

    await h.commands.get("mdlog")!.handler(`${file} --no-open`, ctx);
    assert.equal(h.activeTools.includes("vellum_figure"), true);

    await h.commands.get("mdlog")!.handler("off", ctx);
    assert.equal(h.activeTools.includes("vellum_figure"), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("connects, writes header + sidecar, and backfills only user/assistant messages", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "session.md");

    const userMsg = { role: "user", content: "问题", timestamp: Date.now() };
    const toolMsg = { role: "toolResult", content: "工具输出", timestamp: Date.now() };
    const assistantMsg = { role: "assistant", content: "回答", timestamp: Date.now() + 10 };

    const { ctx, notifications } = makeCtx(dir, {
      branch: [
        { id: "u1", message: userMsg },
        { id: "t1", message: toolMsg },
        { id: "custom1", type: "custom", customType: "other" },
        { id: "a1", message: assistantMsg },
      ],
    });

    const h = harness();
    mdlogExtension(h.pi);
    await h.commands.get("mdlog")!.handler(`${file} --no-open`, ctx);

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.startsWith("<!-- mdlog:v1 s=sess-1 -->\n\n"), true);
    assert.equal(content.split("> **你**").length - 1, 1);
    assert.equal(content.split("mdlog-who").length - 1, 1);
    assert.equal(content.includes("工具输出"), false);
    assert.equal(content.includes("<!-- mdlog:m=u1 -->"), true);

    const sidecar = readSidecar(`${file}.mdlog`);
    assert.equal(sidecar?.sessionId, "sess-1");
    assert.equal(sidecar?.pid, process.pid);
    assert.equal(notifications.some((n) => n.message.includes("已连接至")), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("端到端接线：工具投递的图经标记落进日志，源码与标记都不进日志", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "session.md");
    const h = harness();
    mdlogExtension(h.pi);

    const { ctx } = makeCtx(dir, { branch: [] });
    await h.commands.get("mdlog")!.handler(`${file} --no-open`, ctx);

    // 1) Agent 把草稿文件交给工具（源码不经过对话）
    const draft = path.join(dir, "draft.html");
    const html = "<!DOCTYPE html><html><body><p>图</p></body></html>";
    fs.writeFileSync(draft, html, "utf8");

    const tool = h.tools.get("vellum_figure")!;
    const result = await tool.execute("call-1", { path: draft, title: "图一" }, undefined, undefined, ctx);
    const marker = String(result.content[0]?.text ?? "").match(/<!-- mdlog-fig:[^>]+-->/)?.[0];
    assert.ok(marker, "工具回执必须给出可整枚照抄的标记");

    // 2) 回合同样是普通消息，只是用标记指定了图的位置
    const message = {
      role: "assistant",
      content: `引子。\n\n${marker}\n\n图注。`,
      timestamp: Date.now(),
    };
    await h.emit("message_end", { type: "message_end", message }, ctx);
    await h.emit("agent_settled", { type: "agent_settled" }, ctx);

    const content = fs.readFileSync(file, "utf8");
    assert.equal(content.includes("mdlog-fig"), false, "标记不该出现在日志里");
    const prose = content.indexOf("引子。");
    const fence = content.indexOf("```vellum-widget");
    const caption = content.indexOf("图注。");
    assert.ok(prose >= 0 && fence > prose && caption > fence, "图应落在引子与图注之间");
    assert.equal(content.includes(html), true, "围栏里应是完整 HTML");

    // 3) 图条目落进会话：--full 回填时标记仍能展开
    assert.equal(
      h.entries.some((entry) => entry.type === "mdlog:figure"),
      true
    );

    // 4) 对话记录里标记被改写成一行可读标签（落盘路径不受影响）
    const transcript = h.transformers[0](`引子。\n\n${marker}\n\n图注。`, { messageType: "assistant" });
    assert.equal(transcript.includes("mdlog-fig"), false);
    assert.match(transcript, /▤ \*\*图\*\* · 图一/);
    assert.equal(h.transformers[0]("用户发言", { messageType: "user" }), "用户发言");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("未连接时工具拒绝投递（工具本就不该在工具表里）", async () => {
    const dir = tmpDir();
    const h = harness();
    mdlogExtension(h.pi);

    const { ctx } = makeCtx(dir, { branch: [] });
    const tool = h.tools.get("vellum_figure")!;
    const result = await tool.execute("call-1", { html: "<!DOCTYPE html><html></html>" }, undefined, undefined, ctx);
    assert.match(String(result.content[0]?.text ?? ""), /投递失败/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("creates non-existent parent directory automatically without ENOENT error", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "deep", "nested", "session.md");
    const { ctx, notifications } = makeCtx(dir, { branch: [] });

    const h = harness();
    mdlogExtension(h.pi);
    await h.commands.get("mdlog")!.handler(`${file} --no-open`, ctx);

    assert.equal(fs.existsSync(file), true);
    assert.equal(notifications.some((n) => n.type === "error"), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("rejects non-markdown targets on both manual and automatic paths (v3.1 gate)", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "notes.txt");
    const { ctx, notifications } = makeCtx(dir, { branch: [] });

    const h = harness();
    mdlogExtension(h.pi);
    await h.commands.get("mdlog")!.handler(`${file} --no-open`, ctx);

    assert.equal(fs.existsSync(file), false);
    assert.equal(notifications.some((n) => String(n.type) === "error"), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("increments writtenCount on live message events and reflects in status", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");

    const branch: FakeEntry[] = [];
    const { ctx, notifications } = makeCtx(dir, { branch });

    const h = harness();
    mdlogExtension(h.pi);
    await h.commands.get("mdlog")!.handler(`${file} --append --no-open`, ctx);

    const message = { role: "user", content: "实时消息", timestamp: Date.now() };
    branch.push({ id: "e1", message });
    await h.emit("message_end", { type: "message_end", message }, ctx);
    await h.emit("agent_settled", { type: "agent_settled" }, ctx);

    await h.commands.get("mdlog")!.handler("status", ctx);
    const status = notifications.reverse().find((n) => n.message.includes("已写消息"));
    assert.match(String(status?.message), /已写消息: 1 条/);
    const liveContent = fs.readFileSync(file, "utf8");
    assert.equal(liveContent.includes("实时消息"), true);
    // 实时消息必须按对象引用命中 entryId：handler 不得复制消息对象（否则锚点全丢）
    assert.equal(liveContent.includes("<!-- mdlog:m=e1 -->"), true);
    await h.emit("session_shutdown", { type: "session_shutdown" }, ctx);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("skips empty text messages and disconnect notifies when disconnected", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");

    const branch: FakeEntry[] = [];
    const { ctx, notifications } = makeCtx(dir, { branch });
    const h = harness();
    mdlogExtension(h.pi);
    await h.commands.get("mdlog")!.handler(`${file} --append --no-open`, ctx);

    const empty = { role: "assistant", content: "   \n  ", timestamp: Date.now() };
    branch.push({ id: "e1", message: empty });
    await h.emit("message_end", { type: "message_end", message: empty }, ctx);
    await h.emit("agent_settled", { type: "agent_settled" }, ctx);
    assert.equal(fs.readFileSync(file, "utf8").includes("mdlog-who"), false);

    await h.commands.get("mdlog")!.handler("off", ctx);
    assert.equal(notifications.some((n) => n.message.includes("已断开连接")), true);

    await h.commands.get("mdlog")!.handler("off", ctx);
    assert.equal(notifications.some((n) => n.message.includes("当前未连接任何文件")), true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("session_shutdown flushes pending messages and deletes sidecar file", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    fs.writeFileSync(file, "<!-- mdlog:v1 s=sess-1 -->\n\n", "utf8");

    const branch: FakeEntry[] = [];
    const { ctx } = makeCtx(dir, { branch });
    const h = harness();
    mdlogExtension(h.pi);
    await h.commands.get("mdlog")!.handler(`${file} --append --no-open`, ctx);

    const message = { role: "assistant", content: "收尾消息", timestamp: Date.now() };
    branch.push({ id: "e1", message });
    await h.emit("message_end", { type: "message_end", message }, ctx);

    assert.equal(fs.existsSync(`${file}.mdlog`), true);
    await h.emit("session_shutdown", { type: "session_shutdown" }, ctx);

    assert.equal(fs.readFileSync(file, "utf8").includes("收尾消息"), true);
    assert.equal(fs.existsSync(`${file}.mdlog`), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("does not auto-reconnect when the last connection entry is active: false", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "session.md");
    const { ctx } = makeCtx(dir, {
      branch: [{ id: "c1", type: "custom", customType: "mdlog:connection", data: { active: false } }],
    });

    const h = harness();
    mdlogExtension(h.pi);
    await h.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(`${file}.mdlog`), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("notifies and refuses auto-reconnect when sessionId mismatches on /fork (Y6-f)", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "parent.md");
    const { ctx, notifications } = makeCtx(dir, {
      branch: [
        {
          id: "c1",
          type: "custom",
          customType: "mdlog:connection",
          data: { active: true, path: file, sessionId: "parent-session" },
        },
      ],
      sessionId: "forked-session",
    });

    const h = harness();
    mdlogExtension(h.pi);
    await h.emit("session_start", { type: "session_start", reason: "fork" }, ctx);

    assert.equal(fs.existsSync(file), false);
    assert.equal(
      notifications.some((n) => n.message.includes("为避免污染父会话日志未自动连接")),
      true
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("silently reconnects when the last connection entry is active and sessionId matches", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "resume.md");
    const { ctx, notifications } = makeCtx(dir, {
      branch: [
        {
          id: "c1",
          type: "custom",
          customType: "mdlog:connection",
          data: { active: true, path: file, sessionId: "sess-1" },
        },
      ],
    });

    const h = harness();
    mdlogExtension(h.pi);
    await h.emit("session_start", { type: "session_start", reason: "resume" }, ctx);

    assert.equal(fs.existsSync(file), true);
    assert.equal(fs.existsSync(`${file}.mdlog`), true);
    assert.equal(notifications.some((n) => n.message.includes("已连接至")), true);
    await h.emit("session_shutdown", { type: "session_shutdown" }, ctx);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("treats anchorLost sidecar as 4a: append-only without re-backfill", async () => {
    const dir = tmpDir();
    const file = path.join(dir, "live.md");
    const existing = "<!-- mdlog:v1 s=sess-1 -->\n\n<!-- mdlog:m=e1 -->\n\n已有内容\n\n";
    fs.writeFileSync(file, existing, "utf8");
    fs.writeFileSync(
      `${file}.mdlog`,
      JSON.stringify({
        version: 1,
        sessionId: "sess-1",
        pid: 1,
        connectedAt: 1,
        lastWriteAt: 1,
        heartbeatAt: 1,
        anchorLost: true,
      }),
      "utf8"
    );

    const branch: FakeEntry[] = [{ id: "e1", message: { role: "user", content: "旧消息", timestamp: 1 } }];
    const { ctx } = makeCtx(dir, { branch });

    const h = harness();
    mdlogExtension(h.pi);
    await h.commands.get("mdlog")!.handler(`${file} --no-open`, ctx);

    const content = fs.readFileSync(file, "utf8");
    // anchorLost ⇒ 跳过增量回填，旧内容不被重复写入
    assert.equal(content, existing);
    await h.emit("session_shutdown", { type: "session_shutdown" }, ctx);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
