// 一次性探针：把编辑视图的真实 DOM 结构打出来，用来校准 capture.mjs 的选择器。
// 只在调试时手动跑：node video/capture/probe-edit.mjs
import { spawn, execSync } from "node:child_process";
import process from "node:process";

const PORT = 9223;
const EXE = "src-tauri/target/release/vellum.exe";
const DOC = process.argv[2] ?? "video/assets/demo.md";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  execSync("taskkill /IM vellum.exe /F", { stdio: "ignore" });
} catch {
  /* none */
}
await sleep(600);

spawn(EXE, [DOC], {
  detached: true,
  stdio: "ignore",
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
  },
}).unref();

let page = null;
for (let i = 0; i < 60 && !page; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((t) => t.type === "page" && t.url && t.url !== "about:blank");
  } catch {
    /* not up */
  }
}
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) return `ERROR: ${res.result.exceptionDetails.text}`;
  return res.result?.result?.value;
};

await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
  mobile: false,
});
await sleep(3000);

console.log("— 按钮清单 —");
console.log(
  await evaluate(
    `JSON.stringify([...document.querySelectorAll("header button")].map((b) => ({
      label: b.getAttribute("aria-label"), pressed: b.getAttribute("aria-pressed"),
      disabled: b.disabled, icon: b.dataset.icon ?? null })), null, 1)`
  )
);

console.log("— 点编辑按钮 —");
console.log(
  await evaluate(
    `(() => { const b = document.querySelector("header button[aria-label='切换编辑视图']");
      if (!b) return "no button";
      b.click();
      return JSON.stringify({ after: b.getAttribute("aria-pressed"), icon: b.dataset.icon ?? null }); })()`
  )
);
await sleep(1500);

console.log("— 编辑视图 DOM —");
console.log(
  await evaluate(
    `JSON.stringify({
      contentClass: document.querySelector(".document-scroll__content")?.className ?? null,
      editingContent: !!document.querySelector(".document-scroll__content--editing"),
      unitWraps: document.querySelectorAll(".vellum-unit-wrap").length,
      unitAttrs: [...document.querySelectorAll("[data-vellum-unit]")].slice(0, 3).map((e) => ({
        tag: e.tagName, cls: e.className, parentCls: e.parentElement?.className, editable: e.getAttribute("data-vellum-unit") })),
      firstWrapChildTags: [...(document.querySelector(".vellum-unit-wrap")?.children ?? [])].map((c) => c.tagName + "." + c.className),
      marks: document.querySelectorAll(".block-editor__mark").length,
      readOnlyWraps: [...document.querySelectorAll(".vellum-unit-wrap")].slice(0, 12).map((w) => {
        const el = w.firstElementChild; return el ? el.tagName + ":" + (el.dataset?.vellumUnit ?? "?") : "empty"; }),
    }, null, 1)`
  )
);

// 试试点第一个可编辑段落
console.log("— 点第 3 个块 —");
console.log(
  await evaluate(
    `(() => {
      const wraps = [...document.querySelectorAll(".document-scroll__content > .vellum-unit-wrap")];
      if (!wraps.length) return "no wraps as direct children; content children = " + [...document.querySelector(".document-scroll__content").children].map(c=>c.tagName+"."+c.className).slice(0,6).join(" | ");
      const el = wraps[3]?.firstElementChild;
      if (!el) return "no 4th block";
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return JSON.stringify({ tag: el.tagName, cls: el.className, x: Math.round(r.x + 60), y: Math.round(r.y + r.height / 2) }); })()`
  )
);
await sleep(500);
const box = JSON.parse(
  (await evaluate(
    `(() => {
      const wraps = [...document.querySelectorAll(".document-scroll__content > .vellum-unit-wrap")];
      const el = wraps[3]?.firstElementChild; if (!el) return "null";
      const r = el.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.x + 60), y: Math.round(r.y + r.height / 2) }); })()`
  )) || "null"
);
if (box) {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, x: box.x, y: box.y });
  }
  await sleep(900);
}
console.log("— 激活后 —");
console.log(
  await evaluate(
    `JSON.stringify({
      hasTextarea: !!document.querySelector(".block-editor__input"),
      textareaParentCls: document.querySelector(".block-editor__input")?.parentElement?.className ?? null,
      activeMark: document.querySelector(".block-editor__mark")?.textContent ?? null,
      valueHead: document.querySelector(".block-editor__input")?.value?.slice(0, 60) ?? null,
    }, null, 1)`
  )
);

ws.close();
try {
  execSync("taskkill /IM vellum.exe /F", { stdio: "ignore" });
} catch {
  /* gone */
}
