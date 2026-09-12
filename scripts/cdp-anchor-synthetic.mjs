#!/usr/bin/env node
/**
 * 一次性实验：合成滚动容器里，宽度驱动的回流为何不触发原生滚动锚定（结构变量二分）。
 * 用法：node scripts/cdp-anchor-synthetic.mjs [file.md]
 */
import { spawn, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXE = path.join(REPO, "src-tauri", "target", "release", "vellum.exe");
const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (
        await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(2000) })
      ).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        return ws;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error("CDP 连接超时");
}

function makeClient(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return async (expression) => {
    const mid = ++id;
    const r = await new Promise((resolve, reject) => {
      pending.set(mid, { resolve, reject });
      ws.send(
        JSON.stringify({
          id: mid,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        })
      );
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
    return r.result?.value;
  };
}

const SYNTH = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TEXT = '素笺是一份以纸墨为意象的 Markdown 阅读器，这一段用来占据足够的行数，使正文在容器宽度变化时发生回流。';
  const blocks = (n) => Array.from({ length: n }, (_, i) => '<p style="margin:12px 0">第 ' + i + ' 段。' + TEXT + TEXT + '</p>').join('');

  function build(name, { wrapLayers = false, marginAuto = false, maxWidth = '800px', hostStyle = '' }) {
    const host = document.createElement('div');
    host.dataset.name = name;
    host.style.cssText = 'position:fixed;left:-5000px;top:0;width:1000px;height:400px;overflow-y:auto;' + hostStyle;
    let html;
    if (wrapLayers) {
      html = '<div class="wrap" style="min-height:100%;padding:70px 16px 40px"><div class="mid">' +
        '<div class="body" style="max-width:' + maxWidth + ';' + (marginAuto ? 'margin:0 auto;' : '') + 'padding:40px 32px"></div></div></div>';
    } else {
      html = '<div class="body" style="max-width:' + maxWidth + ';' + (marginAuto ? 'margin:0 auto;' : '') + 'padding:40px 32px"></div>';
    }
    host.innerHTML = html;
    document.body.appendChild(host);
    const body = host.querySelector('.body');
    body.innerHTML = blocks(120);
    return { host, body };
  }

  const results = [];
  const cases = [
    ['纯块（无包裹层）', { wrapLayers: false }],
    ['纯块 + margin:auto 居中', { wrapLayers: false, marginAuto: true }],
    ['三层包裹（同真机结构）', { wrapLayers: true }],
    ['三层包裹 + margin:auto', { wrapLayers: true, marginAuto: true }],
    ['纯块 + 容器 position:relative', { wrapLayers: false, hostStyle: 'position:fixed;' }],
    ['纯块 + 容器 overflow-x:hidden', { wrapLayers: false, hostStyle: 'overflow-x:hidden;' }],
  ];

  for (const [name, opts] of cases) {
    const { host, body } = build(name, opts);
    await sleep(50);
    host.scrollTop = 2000;
    await sleep(200);
    // 钉住视口顶部的块
    const hrect = host.getBoundingClientRect();
    let pin = null;
    for (const p of Array.from(body.children)) {
      if (p.getBoundingClientRect().top <= hrect.top + 2) pin = p;
      else break;
    }
    const pinTop = () => Math.round(pin.getBoundingClientRect().top - host.getBoundingClientRect().top);
    host.scrollTop = 2000;
    await sleep(200);
    const before = { top: host.scrollTop, h: host.scrollHeight, pin: pinTop() };
    body.style.maxWidth = '700px';
    await sleep(400);
    const after = { top: host.scrollTop, h: host.scrollHeight, pin: pinTop() };
    body.style.maxWidth = opts.maxWidth ?? '800px';
    await sleep(200);
    results.push({
      name,
      dH: after.h - before.h,
      dTop: after.top - before.top,
      dPin: after.pin - before.pin,
      anchored: Math.abs(after.pin - before.pin) < 4,
    });
    host.remove();
  }
  return { results, ua: navigator.userAgent };
})()`;

async function main() {
  let running = "";
  try {
    running = execSync('tasklist /FI "IMAGENAME eq vellum.exe" /NH', { encoding: "utf8" });
  } catch {}
  if (running.split("\n").some((l) => l.includes("vellum.exe"))) {
    console.error("✘ 已有 Vellum 实例在跑");
    process.exit(2);
  }
  const file = process.argv[2];
  const exe = spawn(EXE, file ? [path.resolve(file)] : [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
  });
  try {
    const ws = await connect();
    const evaluate = makeClient(ws);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if ((await evaluate(`!!document.querySelector('.document-scroll')`)) === true) break;
      await sleep(400);
    }
    await sleep(1500);
    const r = await evaluate(SYNTH);
    for (const x of r.results) {
      console.log(
        `${x.name.padEnd(28)} Δh=${String(x.dH).padStart(6)} Δtop=${String(x.dTop).padStart(6)} Δpin=${String(x.dPin).padStart(6)} ` +
          `${x.anchored ? "✔锚定生效" : "✘锚定失效"}`
      );
    }
    ws.close();
  } finally {
    try {
      exe.kill();
    } catch {}
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
