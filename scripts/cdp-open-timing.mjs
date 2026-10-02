// 冷启动计时探针：从 spawn vellum.exe 那一刻起，到正文 DOM 出现 h1.document-title 为止分段打点。
// 前置：release 构建（npm run tauri build -- --debug 或 release exe）；先 taskkill /IM vellum.exe /F。
// 用法：node scripts/cdp-open-timing.mjs <path-to-md>
// 分段：spawn → webview 可连（CDP target 出现）→ React 挂载（#root 有子节点）→ 正文渲染（h1.document-title）。
// 为何必须真机：「点击 → 渲染」的耗时大头在 WebView2 初始化 + IPC 串行，jsdom 与 dev server 都看不见。

import { spawn } from "node:child_process";

const target = process.argv[2] ?? String.raw`C:\Users\17445\Desktop\test\issue-body.md`;
const exe = String.raw`src-tauri\target\release\vellum.exe`;
const PORT = 9223;
const LIST_URL = `http://127.0.0.1:${PORT}/json/list`;

const t0 = performance.now();
const stamp = (label) => console.log(`[${(performance.now() - t0).toFixed(0).padStart(5)}ms] ${label}`);

stamp(`spawn ${exe} ${target}`);
const child = spawn(exe, [target], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: "ignore",
});
child.unref();

async function getPage() {
  try {
    const list = await (await fetch(LIST_URL, { signal: AbortSignal.timeout(800) })).json();
    return list.find((t) => t.type === "page" && t.url?.includes("tauri.localhost"));
  } catch {
    return null;
  }
}

// 1. 等 CDP target 出现（WebView2 初始化 + 前端开始加载）
let page = null;
while (!page && performance.now() - t0 < 20_000) {
  page = await getPage();
  if (!page) await new Promise((r) => setTimeout(r, 120));
}
if (!page) {
  stamp("FAIL: 20s 内没有 CDP page target");
  child.kill();
  process.exit(1);
}
stamp(`CDP page target: ${page.url}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleLogs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled") {
    consoleLogs.push(msg.params.args?.map((a) => a.value ?? a.description).join(" "));
  } else if (msg.method === "Runtime.exceptionThrown") {
    consoleLogs.push(`EXC: ${msg.params.exceptionDetails?.text} ${msg.params.exceptionDetails?.exception?.description?.slice(0, 200) ?? ""}`);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
await new Promise((r) => ws.addEventListener("open", r));
await send("Runtime.enable");
const evalJs = async (expr, awaitPromise = false) => {
  const res = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise,
  });
  const v = res.result?.result?.value;
  return typeof v === "string" && v.startsWith("{") ? v : v;
};

// 2. React 挂载（#root 有子节点）
let mounted = false;
while (!mounted && performance.now() - t0 < 15_000) {
  mounted = await evalJs(`document.getElementById("root")?.childElementCount > 0`);
  if (!mounted) await new Promise((r) => setTimeout(r, 80));
}
stamp(`React mounted (#root has children)`);

// 3. 正文渲染（h1.document-title 出现 = 文档进 DOM 可交互）
let title = null;
while (!title && performance.now() - t0 < 15_000) {
  title = await evalJs(`document.querySelector("h1.document-title")?.textContent ?? null`);
  if (!title) await new Promise((r) => setTimeout(r, 80));
}
stamp(`document rendered: h1.document-title = ${title}`);

// 4. 首次绘制（requestAnimationFrame 打完一帧 = 正文真正可见）
await evalJs(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`, true);
stamp(`first paint after title`);

// IPC 耗时探针：Tauri 内部桥在 window.__TAURI__.internals.invoke（不是裸 specifier）。
// 同路径再开一次，把三个串行 invoke 的实际耗时分开量。
const ipcTiming = await evalJs(`
  (async () => {
    const invoke = window.__TAURI__?.internals?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) return "no-invoke-bridge";
    const path = ${JSON.stringify(target)};
    const t = async (label, fn) => {
      const s = performance.now();
      try { await fn(); return [label, Math.round(performance.now() - s)]; }
      catch (e) { return [label, -1, String(e).slice(0, 80)]; }
    };
    // 先打一个轻量 invoke 把 IPC 通道握手成本抖掉，再量真实耗时——
    // 否则首个 invoke（无论哪个命令）都会多吃 ~100ms 的通道建立开销。
    await invoke("read_mdlog_state");
    const out = [];
    out.push(await t("load_document", () => invoke("load_document", { path })));
    out.push(await t("resolve_wikilinks", () => invoke("resolve_wikilinks", { fromPath: path, targets: [] })));
    out.push(await t("read_mdlog_state", () => invoke("read_mdlog_state")));
    return JSON.stringify(out);
  })()
`, true);
console.log(`[ipc] ${ipcTiming}`);

const total = performance.now() - t0;
stamp(`TOTAL spawn→render+paint: ${total.toFixed(0)}ms`);
if (consoleLogs.length) console.log("[console]", consoleLogs.slice(0, 20));

ws.close();
child.kill();
process.exit(0);
