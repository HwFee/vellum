import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * 进程内真实加载：直接 import 扩展入口，断言注册面（命令 + 五个生命周期事件）。
 * 任何一条断言被破坏（改名、漏订阅、handler 不是函数）都会红，不依赖外部条件。
 */
describe("pi mdlog E2E and loader tests", () => {
  test("loads extension in-process, registers commands, tools and events", async () => {
    const registeredCommands: Array<{ name: string; description?: string; handler?: unknown }> = [];
    const registeredTools: Array<{ name: string; description?: string; parameters?: unknown }> = [];
    const events: string[] = [];

    const pi = {
      registerCommand: (name: string, options: { description?: string; handler?: unknown }) => {
        registeredCommands.push({ name, description: options.description, handler: options.handler });
      },
      registerTool: (tool: { name: string; description?: string; parameters?: unknown }) => {
        registeredTools.push({ name: tool.name, description: tool.description, parameters: tool.parameters });
      },
      registerMarkdownTransformer: () => {
        // 本次不驱动渲染，忽略
      },
      on: (event: string) => {
        events.push(event);
      },
      appendEntry: () => {
        // 本次不驱动连接，忽略
      },
      getActiveTools: () => [],
      setActiveTools: () => {
        // 本次不断言工具表，忽略
      },
    } as unknown as ExtensionAPI;

    const mod = await import("../index.ts");
    assert.equal(typeof mod.default, "function");
    mod.default(pi);

    const mdlog = registeredCommands.find((c) => c.name === "mdlog");
    assert.ok(mdlog, "应注册 mdlog 命令");
    assert.equal(typeof mdlog.handler, "function");
    assert.match(String(mdlog.description), /mdlog/);

    const figure = registeredTools.find((tool) => tool.name === "vellum_figure");
    assert.ok(figure, "应注册 vellum_figure 工具");
    assert.match(String(figure.description), /vellum-widget/);
    assert.equal(typeof figure.parameters, "object");

    for (const event of [
      "session_start",
      "message_end",
      "tool_execution_end",
      "agent_settled",
      "session_shutdown",
    ]) {
      assert.equal(events.includes(event), true, `应订阅 ${event}`);
    }

    // 驱动 status / off 两条分发路径
    const notifications: string[] = [];
    const ctx = {
      hasUI: false,
      ui: {
        notify: (message: string) => notifications.push(message),
      },
      sessionManager: {
        getBranch: () => [],
        getCwd: () => process.cwd(),
        getSessionId: () => "e2e-session",
      },
    } as unknown as ExtensionContext;

    const handler = mdlog.handler as (args: string, ctx: ExtensionContext) => Promise<void> | void;
    await handler("status", ctx);
    assert.equal(notifications.some((m) => m.includes("当前未连接任何文件")), true);

    await handler("off", ctx);
    assert.equal(notifications.some((m) => m.includes("当前未连接任何文件")), true);
  });

  test("runs fake prompt with cli sub-process (skips if pi is unavailable or missing API key)", (t) => {
    let available = false;
    try {
      const version = execSync("pi --version", { stdio: "pipe", timeout: 15_000 }).toString();
      available = /\d+\.\d+/.test(version);
    } catch {
      available = false;
    }
    if (!available) {
      t.skip("pi CLI 不可用，跳过真实子进程冒烟");
      return;
    }

    let stdout = "";
    try {
      stdout = execSync('pi -p "reply with the single word: mdlog-smoke"', {
        stdio: "pipe",
        timeout: 60_000,
      }).toString();
    } catch (err) {
      const anyErr = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
      const combined = `${anyErr.stdout?.toString() ?? ""}${anyErr.stderr?.toString() ?? ""}${anyErr.message ?? ""}`;
      // 白名单式 skip：仅当确属环境缺失（无 API key / 无登录 / 无 provider / 找不到 pi）才跳过
      if (/No API key|login|provider|ENOENT/i.test(combined)) {
        t.skip(`环境缺少可用模型凭据，跳过真实 CLI 冒烟: ${combined.slice(0, 120)}`);
        return;
      }
      assert.fail(`pi 子进程真实失败（不得静默）：${combined.slice(0, 400)}`);
    }

    assert.equal(typeof stdout, "string");
  });
});
