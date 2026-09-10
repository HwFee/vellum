// 真机验收自动验证（CDP）：① CSP 是否还拦 ipc.localhost ② 编辑按钮笔⇄书与单位块数量 ③ 点 ✕ 是否真能关掉进程
// 前置：以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动 release exe
// 用法：node scripts/cdp-verify.mjs
// 为何必须真机跑：ACL / CSP 两条缺陷只在打包后的 WebView2 里暴露，jsdom 与 dev 均看不见（见 AGENTS.md 注意事项）
const LIST_URL = "http://127.0.0.1:9222/json/list";

async function targets() {
  try {
    return await (await fetch(LIST_URL, { signal: AbortSignal.timeout(3000) })).json();
  } catch {
    return [];
  }
}

const pages = await targets();
const page = pages.find((t) => t.type === "page");
if (!page) {
  console.log("NO_PAGE_TARGET");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.consoleAPICalled" || msg.method === "Log.entryAdded") {
    logs.push(msg);
  }
});
await new Promise((r) => ws.addEventListener("open", r));

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) return `ERROR: ${res.result.exceptionDetails.text}`;
  return res.result?.result?.value;
}

await send("Runtime.enable");
await send("Log.enable");

const state = `JSON.stringify({
  icon: document.querySelector("header button[aria-label='切换编辑视图']")?.dataset.icon ?? null,
  pressed: document.querySelector("header button[aria-label='切换编辑视图']")?.getAttribute("aria-pressed") ?? null,
  units: document.querySelectorAll("[data-vellum-unit]").length,
  article: document.querySelector("article")?.className ?? null,
})`;

console.log("[1] 初始（应为 reading / pen / units 0）:", await evaluate(state));

console.log(
  "[2] 点编辑按钮:",
  await evaluate(`document.querySelector("header button[aria-label='切换编辑视图']").click(), "clicked"`)
);
await new Promise((r) => setTimeout(r, 700));
console.log("[3] 编辑视图（应为 editing / book / units>0）:", await evaluate(state));

console.log(
  "[4] 再点一次回阅读:",
  await evaluate(`document.querySelector("header button[aria-label='切换编辑视图']").click(), "clicked"`)
);
await new Promise((r) => setTimeout(r, 700));
console.log("[5] 回阅读视图（应为 reading / pen / units 0）:", await evaluate(state));

const ipcViolations = logs.filter((entry) => JSON.stringify(entry).includes("ipc.localhost"));
console.log("[6] ipc.localhost 违规条数（应为 0）:", ipcViolations.length);
const aclErrors = logs.filter((entry) => JSON.stringify(entry).includes("not allowed by ACL"));
console.log("[7] ACL 拒绝条数（应为 0）:", aclErrors.length);
console.log(
  "[8] destroy 相关错误（应为 0）:",
  logs.filter((e) => JSON.stringify(e).includes("destroy")).length
);

console.log("[9] 点 ✕ 关窗（进程应随后消失）:", await evaluate(
  `document.querySelector("header button[aria-label='关闭']").click(), "close-clicked"`
));

await new Promise((r) => setTimeout(r, 2500));
const after = await targets();
console.log("[10] 关窗后还剩几个 page target（应为 0）:", after.filter((t) => t.type === "page").length);

try {
  ws.close();
} catch {
  /* 窗口已销毁时连接自然断开 */
}
