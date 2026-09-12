#!/usr/bin/env node
/**
 * 真机滚动性能探针（CDP）。
 *
 * 为什么必须真机：滚动卡顿与 iframe scroll-latch 只在打包后的 WebView2 + 跨源沙箱
 * 子帧里成立，jsdom / dev 模式都看不见（同 cdp-verify.mjs 的结论）。
 *
 * 关键方法论（踩过的坑，别再退化）：
 *   1. 必须用 `Input.synthesizeScrollGesture`（带手势语义）。离散 wheel 事件复现不出
 *      scroll-latch —— 锁存只在一次手势内保持，CDP 的孤立 wheel 事件各自成手势。
 *   2. 指针必须真的落在**已挂载**的沙箱 iframe 上：widget 是视口懒挂载的，滚动到
 *      目标位置后必须等该块的 iframe 到达 `--ready`，否则量到的是占位块（假绿）。
 *   3. 跨源 iframe 跑在独立 renderer 进程：`Performance.getMetrics` 只覆盖主帧，
 *      必须 `Target.setAutoAttach({flatten:true})` 挂上子目标分别收指标，否则
 *      沙箱里的动画脚本开销完全不可见。
 *
 * 前置：没有其它 Vellum 实例在跑（多实例后新实例不再被吞，但并存实例的
 *      WebView2 会污染 CPU/帧时序读数，测量纯净性仍要求独占）。
 *
 * 用法：
 *   node scripts/cdp-perf-scroll.mjs                       # 合成压力文档（clean/anim/churn/leak 四种 widget）
 *   node scripts/cdp-perf-scroll.mjs --file <真实.md>       # 用真实文档（复制到临时目录再打开）
 *   node scripts/cdp-perf-scroll.mjs --trace               # 额外抓 devtools trace 并归因到脚本 URL
 *   node scripts/cdp-perf-scroll.mjs --widgets 6           # 逐 widget 相位的个数（默认 4）
 *
 * 产出：控制台报告 + JSON 产物（优化前后对比用）。
 */
import { spawn, execSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXE = path.join(REPO, "src-tauri", "target", "release", "vellum.exe");
const PORT = 9222;
const OUT_DIR = path.join(os.tmpdir(), "vellum-perf");

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const WANT_TRACE = argv.includes("--trace");
const FILE_ARG = argOf("--file");
const WIDGET_PROBES = Number(argOf("--widgets") ?? 4);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n, d = 1) => (typeof n === "number" ? n.toFixed(d) : String(n));

/** 整套 WebView2（含主进程、子 renderer、GPU/utility 进程）累计 CPU 时间（毫秒）。
 *  为什么要它：`Performance.getMetrics` 只覆盖单个 renderer 的 JS/布局，
 *  iframe 子帧、光栅与合成开销都在别的进程里——只有进程级 CPU 能一并看见。 */
function webviewCpuMs() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "(Get-Process msedgewebview2,vellum -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum"',
      { encoding: "utf8", timeout: 20000 }
    );
    const seconds = Number(out.trim());
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

/** 包住一个测量窗口，附带进程级 CPU 增量 */
async function withCpu(fn) {
  const cpuBefore = webviewCpuMs();
  const t0 = Date.now();
  const value = await fn();
  const wallMs = Date.now() - t0;
  const cpuAfter = webviewCpuMs();
  const cpuMs = cpuBefore !== null && cpuAfter !== null ? cpuAfter - cpuBefore : null;
  return { value, wallMs, cpuMs, cpuPerSec: cpuMs !== null && wallMs > 0 ? cpuMs / (wallMs / 1000) : null };
}

// ───────────────────────────── 合成压力文档 ─────────────────────────────

/** 标准通信 IIFE（契约 5 逐字形态） */
const REPORT_IIFE = `
  (function() {
    function report() {
      var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      window.parent.postMessage({ type: "vellum-widget:resize", height: h, title: document.title }, "*");
    }
    window.addEventListener("load", report);
    if (window.ResizeObserver) { new ResizeObserver(report).observe(document.body); }
  })();`;

const BASE_CSS = `<style>
:root{--parchment:#f5f4ed;--ivory:#faf9f5;--dark-warm:#3d3d3a;--brand:#1B365D;--hairline:#dddacc}
html,body{margin:0}body{padding:14px;background:var(--parchment);color:var(--dark-warm);font-family:"TsangerJinKai02","Source Han Serif SC",serif;font-size:15px;line-height:1.6}
.box{background:var(--ivory);border:1px solid var(--hairline);border-radius:4px;padding:14px 16px}
canvas{display:block;width:100%;height:110px}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation:none!important}}
</style>`;

/** 四种 widget 家族：clean=静态基准 / anim=持续动画 / churn=高度抖动 / leak=绝对定位余量 */
function widgetHtml(kind, i) {
  const head = (title) =>
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title>${BASE_CSS}</head><body>`;

  if (kind === "clean") {
    return `${head(`基准图 ${i}`)}
<div class="box">静态基准 ${i}<svg viewBox="0 0 320 110" width="100%" height="110">
${[0, 1, 2].map((k) => `<rect x="${20 + k * 100}" y="${90 - (k + 1) * 22}" width="60" height="${(k + 1) * 22}" fill="#1B365D"/>`).join("")}
</svg></div><script>${REPORT_IIFE}</script></body></html>`;
  }
  if (kind === "anim") {
    return `${head(`动画图 ${i}`)}
<style>@keyframes sweep{0%{transform:translateX(0)}100%{transform:translateX(240px)}}
.ball{width:24px;height:24px;border-radius:50%;background:#1B365D;animation:sweep 2.4s linear infinite}
.grow{height:8px;background:var(--brand);animation:grow 1.6s ease-in-out infinite alternate}
@keyframes grow{0%{width:20%}100%{width:98%}}</style>
<div class="box">动画图 ${i}<div class="ball"></div><div class="grow"></div><canvas id="c"></canvas></div>
<script>${REPORT_IIFE}
(function(){var c=document.getElementById("c"),ctx=c.getContext("2d"),t=0;
(function draw(){t+=0.02;var r=c.getBoundingClientRect();if(c.width!==(r.width|0)||c.height!==(r.height|0)){c.width=r.width;c.height=r.height;}
ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle="#1B365D";ctx.lineWidth=1.6;ctx.beginPath();
for(var x=0;x<c.width;x++){var y=c.height/2+Math.sin(x/26+t*2)*c.height*0.35;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();
requestAnimationFrame(draw);})();})();</script></body></html>`;
  }
  if (kind === "churn") {
    // 每 400ms 增删一行 → ResizeObserver 上报新高度 → 宿主 setHeight（200ms CSS 过渡）：
    // 过渡期子帧内容高于 frame，正是 scroll-latch 的窗口
    return `${head(`高度抖动 ${i}`)}
<div class="box">高度抖动 ${i}<div id="rows"></div></div>
<script>${REPORT_IIFE}
(function(){var n=1;setInterval(function(){var el=document.getElementById("rows");
if(n%2){el.insertAdjacentHTML("beforeend","<p>追加行 "+n+"</p>");}else{var last=el.lastElementChild;if(last)last.remove();}
n++;},400);})();</script></body></html>`;
  }
  // leak：绝对定位元素伸出 html 盒之外 → 上报高度取 html rect，而 frame 的可滚动溢出更大
  return `${head(`余量图 ${i}`)}
<style>.tip{position:absolute;top:120px;left:20px;background:#faf9f5;border:1px solid #dddacc;padding:8px 12px;width:220px}</style>
<div class="box">余量图 ${i}</div><div class="tip">绝对定位浮层（超出 html 盒高 40px）</div>
<script>${REPORT_IIFE}</script></body></html>`;
}

function syntheticFixture() {
  const kinds = ["clean", "anim", "churn", "leak"];
  const parts = ["<!-- mdlog:v1 s=perf-stress -->", ""];
  let seq = 0;
  for (let s = 0; s < 34; s++) {
    parts.push(`<p class="mdlog-who"><strong>Pi</strong> · 21:${String(s % 60).padStart(2, "0")}</p>`, "");
    parts.push(`### 小节 ${s} · 压力样本`, "");
    parts.push(
      `这一段是普通正文，用来撑出真实文档的滚动长度。第 ${s} 节包含行内代码 \`useOutlineSync\`、` +
        `一个列表和一张表，以及行内公式 $E = mc^2$ 与行间公式：`,
      ""
    );
    parts.push(`$$\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$`, "");
    parts.push("- 列表项一：说明 `scrollMemory` 与 `scrollRestore` 的三级锚点", "- 列表项二：说明热重载与视口锚点", "");
    parts.push("| 指标 | 优化前 | 优化后 |", "| --- | --- | --- |", `| 帧时长 p95 | ${28 + s} ms | 待测 |`, "");
    parts.push("```ts", "export function sample(n: number): number {", `  return n * ${s + 1};`, "}", "```", "");
    if (s % 3 === 1) {
      const kind = kinds[seq % kinds.length];
      parts.push("```vellum-widget", widgetHtml(kind, seq), "```", "");
      parts.push(`上图为压力 widget（家族：${kind}）。`, "");
      seq++;
    }
  }
  return parts.join("\n");
}

function prepareFixture() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (FILE_ARG) {
    const src = path.resolve(FILE_ARG);
    const dst = path.join(OUT_DIR, `fixture-real-${Date.now()}.md`);
    copyFileSync(src, dst);
    return { file: dst, label: `真实文档副本 ← ${src}`, source: src, bytes: statSync(src).size };
  }
  const file = path.join(OUT_DIR, "fixture-stress.md");
  writeFileSync(file, syntheticFixture(), "utf8");
  return { file, label: "合成压力文档（clean/anim/churn/leak）", source: null, bytes: statSync(file).size };
}

// ───────────────────────────── CDP 客户端 ─────────────────────────────

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) {
          // 子会话的报错文案里没有 method，补上上下文便于定位
          reject(new Error(JSON.stringify(msg.error)));
        } else {
          resolve(msg.result);
        }
      } else if (msg.method) {
        for (const fn of this.events.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
      }
    });
  }
  on(method, fn) {
    const list = this.events.get(method) ?? [];
    list.push(fn);
    this.events.set(method, list);
  }
  send(method, params = {}, { sessionId, timeoutMs = 20000 } = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      // 护栏：Input.synthesizeScrollGesture 在目标窗口非活动时可能永不返回
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 调用超时（${timeoutMs}ms）：${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      this.ws.send(JSON.stringify(payload));
    });
  }
  async evaluate(expression, opts) {
    const r = await this.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      opts
    );
    if (r.exceptionDetails) {
      const detail = r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "unknown";
      throw new Error(`evaluate failed: ${detail.split("\n")[0]} :: ${expression.replace(/\s+/g, " ").slice(0, 160)}`);
    }
    return r.result?.value;
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function connect(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener("open", res);
          ws.addEventListener("error", rej);
        });
        return new Cdp(ws);
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`CDP 连接超时（${PORT}）`);
}

// ───────────────────────────── 页内仪器 ─────────────────────────────

const INSTRUMENT = `
window.__perf = { frames: [], longtasks: [], loaf: [], loafSupported: true };
(function () {
  var last = performance.now();
  (function loop(t) { window.__perf.frames.push(t - last); last = t; requestAnimationFrame(loop); })(last);
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) { window.__perf.longtasks.push({ start: e.startTime, dur: e.duration }); });
    }).observe({ entryTypes: ["longtask"] });
  } catch (err) {}
  try {
    new PerformanceObserver(function (l) {
      l.getEntries().forEach(function (e) {
        window.__perf.loaf.push({
          start: e.startTime,
          dur: e.duration,
          blocking: e.blockingDuration,
          styleLayout: e.styleAndLayoutDuration,
          scripts: (e.scripts || []).slice(0, 3).map(function (s) {
            return { url: s.sourceURL || "(inline)", dur: s.duration };
          }),
        });
      });
    }).observe({ type: "long-animation-frame" });
  } catch (err) {
    window.__perf.loafSupported = false;
  }
})();
"ok"`;

const RESET = `window.__perf.frames.length = 0; window.__perf.longtasks.length = 0; window.__perf.loaf.length = 0; "ok"`;

const stat = (arr, q) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
};

const METRIC_NAMES = [
  "TaskDuration",
  "ScriptDuration",
  "LayoutDuration",
  "RecalcStyleDuration",
  "LayoutCount",
  "RecalcStyleCount",
];

/** 主帧 + 所有已挂载的 widget 子会话（flatten 模式）*/
class Targets {
  constructor(cdp) {
    this.cdp = cdp;
    this.children = new Map(); // sessionId -> { url }
  }
  async install() {
    this.cdp.on("Target.attachedToTarget", async (params, sessionId) => {
      const info = params.targetInfo ?? {};
      // flatten 模式下子会话事件与命令都走同一个 ws 连接，sessionId 在此给出
      const sid = params.sessionId ?? sessionId;
      this.children.set(sid, { url: info.url ?? "" });
      try {
        // 必须显式恢复：auto-attach 会把新子目标挂起等调试器，不恢复则子帧 JS/rAF 全停
        // （实测：不恢复时 10 个动画沙箱的 CPU 从 523ms/s 直接掉到 0，子会话 ScriptDuration 恒为 0）
        await this.cdp.send("Runtime.runIfWaitingForDebugger", {}, { sessionId: sid });
      } catch {}
      try {
        await this.cdp.send("Performance.enable", {}, { sessionId: sid });
      } catch {}
    });
    this.cdp.on("Target.detachedFromTarget", (params) => {
      this.children.delete(params.sessionId);
    });
    await this.cdp.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    // 已经存在的子目标（首屏 widget）
    try {
      const { targetInfos } = await this.cdp.send("Target.getTargets");
      for (const t of targetInfos) {
        if (t.type === "page" || t.type === "browser") continue;
        try {
          const { sessionId } = await this.cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
          this.children.set(sessionId, { url: t.url ?? "" });
          try {
            await this.cdp.send("Runtime.runIfWaitingForDebugger", {}, { sessionId });
          } catch {}
          await this.cdp.send("Performance.enable", {}, { sessionId });
        } catch {}
      }
    } catch {}
  }
  widgetSessions() {
    // 只认真正的 widget 子帧：WebView2 会把一些子会话的 targetInfo.url 留空，
    // 早期版本把空 URL 一并算进「沙箱 N 个」，导致 per-child 指标实际上是别的目标的总和
    // （实测其 ScriptDuration 恒为 0）——这里按 URL 过滤，空 URL 一律不算。
    return [...this.children.entries()].filter(([, v]) => v.url.includes("vellum-widget.localhost"));
  }

  /** 真机保护生效断言：逐一进入 widget 子帧读 computed style（比抓响应体可靠——
   *  自定义协议响应不受 Network 域缓存，getResponseBody 拿不到）*/
  async verifyGuards() {
    const samples = [];
    for (const [sid, info] of [...this.children.entries()]) {
      try {
        const v = await this.cdp.evaluate(
          `(function(){var u=location.href; if(u.indexOf("vellum-widget.localhost")<0) return null;
            var e=document.documentElement;
            return { id: u.split("/").pop().slice(0,8), overflowY: getComputedStyle(e).overflowY,
                     rootRange: e.scrollHeight - e.clientHeight,
                     headHasGuard: document.head.innerHTML.indexOf("overflow:hidden !important") >= 0 };})()`,
          { sessionId: sid }
        );
        if (v) samples.push(v);
      } catch {
        // 子会话可能在核验途中销毁
      }
      void info;
    }
    return {
      total: samples.length,
      protectedCount: samples.filter((s) => s.overflowY === "hidden").length,
      maxRootRange: samples.reduce((m, s) => Math.max(m, s.rootRange ?? 0), 0),
      samples,
    };
  }
}

async function metricsAll(cdp, targets) {
  const out = { main: null, children: {} };
  try {
    const { metrics: list } = await cdp.send("Performance.getMetrics");
    out.main = Object.fromEntries(list.map((m) => [m.name, m.value]));
  } catch {}
  for (const [sid, info] of targets.widgetSessions()) {
    try {
      const { metrics: list } = await cdp.send("Performance.getMetrics", {}, { sessionId: sid });
      out.children[sid] = { url: info.url, values: Object.fromEntries(list.map((m) => [m.name, m.value])) };
    } catch {
      // 子会话可能在相位期间销毁（LRU 休眠），忽略
    }
  }
  return out;
}

function metricsDiff(before, after) {
  const pick = (v) => v ?? {};
  const delta = (a, b, name) => (pick(b)[name] ?? 0) - (pick(a)[name] ?? 0);
  const main = {};
  for (const n of METRIC_NAMES) main[n] = delta(before.main, after.main, n);
  let childTask = 0;
  let childScript = 0;
  let childLayout = 0;
  let childCount = 0;
  let childFrames = 0; // 有 Frame 类指标的子会话数
  const seen = new Set([...Object.keys(before.children ?? {}), ...Object.keys(after.children ?? {})]);
  for (const sid of seen) {
    const a = before.children?.[sid];
    const b = after.children?.[sid];
    if (!a || !b) continue;
    childCount++;
    childTask += delta(a.values, b.values, "TaskDuration");
    childScript += delta(a.values, b.values, "ScriptDuration");
    childLayout += delta(a.values, b.values, "LayoutDuration");
    if ((b.values.Frames ?? 0) > 0) childFrames = (b.values.Frames ?? 0);
  }
  return { main, childTask, childScript, childLayout, childCount, childFrames };
}

async function snapshot(cdp) {
  const perf = await cdp.evaluate("window.__perf");
  const frames = perf.frames ?? [];
  const dropped = frames.filter((f) => f > 24).length;
  return {
    frames: frames.length,
    frameP50: stat(frames, 0.5),
    frameP95: stat(frames, 0.95),
    frameMax: frames.length ? Math.max(...frames) : 0,
    dropped,
    droppedRatio: frames.length ? dropped / frames.length : 0,
    longtasks: (perf.longtasks ?? []).length,
    longtaskMs: (perf.longtasks ?? []).reduce((a, b) => a + b.dur, 0),
    loafSupported: perf.loafSupported,
    loaf: (perf.loaf ?? []).sort((a, b) => b.dur - a.dur).slice(0, 4),
  };
}

// ───────────────────────────── 文档与 widget 就绪 ─────────────────────────────

async function documentFacts(cdp) {
  return cdp.evaluate(`(function () {
    var c = document.querySelector(".document-scroll");
    var frames = document.querySelectorAll(".mdlog-widget__frame");
    return {
      mdlog: !!document.querySelector(".markdown-body--mdlog"),
      widgetBlocks: document.querySelectorAll(".mdlog-widget").length,
      iframes: frames.length,
      readyIframes: document.querySelectorAll(".mdlog-widget__frame--ready").length,
      staticFrames: document.querySelectorAll(".mdlog-widget__frame--static").length,
      parkedFrames: document.querySelectorAll(".mdlog-widget__frame--parked").length,
      placeholders: document.querySelectorAll(".mdlog-widget__placeholder").length,
      scrollHeight: c ? c.scrollHeight : 0,
      clientHeight: c ? c.clientHeight : 0,
      blocks: document.querySelectorAll(".markdown-body > *").length,
    };
  })()`);
}

const widgetStateExpr = (i) => `(function () {
  var w = document.querySelectorAll(".mdlog-widget")[${i}];
  if (!w) return null;
  var f = w.querySelector("iframe.mdlog-widget__frame");
  var ph = w.querySelector("button.mdlog-widget__placeholder");
  return {
    hasFrame: !!f,
    ready: !!f && f.classList.contains("mdlog-widget__frame--ready"),
    static: !!f && f.classList.contains("mdlog-widget__frame--static"),
    height: f ? Math.round(f.getBoundingClientRect().height) : 0,
    heightStyle: f ? f.style.height : "",
    placeholder: ph ? ph.textContent.trim() : null,
    bar: (w.querySelector(".mdlog-widget__bar .state") || {}).textContent || "",
  };
})()`;

/** 把第 i 个 widget 滚到视口中央并等它的 iframe 就绪（占位块则点击授权后重等）*/
async function readyWidget(cdp, i, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let clicked = false;
  let last = null;
  while (Date.now() < deadline) {
    try {
      await cdp.evaluate(`(function () {
        var c = document.querySelector(".document-scroll");
        var el = document.querySelectorAll(".mdlog-widget")[${i}];
        if (!el) return null;
        var r = el.getBoundingClientRect();
        var top = r.top + c.scrollTop;
        c.scrollTop = Math.max(0, Math.min(c.scrollHeight - c.clientHeight, top - c.clientHeight / 2 + r.height / 2));
        return null;
      })()`);
      last = await cdp.evaluate(widgetStateExpr(i));
    } catch (err) {
      // 单次探测报错不该让整轮测量作废（页面在挂载/休眠切换时偶发异常）
      last = { ...(last ?? {}), probeError: String(err).slice(0, 200) };
    }
    if (last?.ready) return { ...last, waited: timeoutMs - (deadline - Date.now()) };
    if (!clicked && last?.placeholder && /点击加载|点击查看/.test(last.placeholder)) {
      clicked = true;
      try {
        await cdp.evaluate(`(document.querySelectorAll(".mdlog-widget")[${i}].querySelector("button.mdlog-widget__placeholder")?.click(), "clicked"`);
      } catch {}
    }
    await sleep(250);
  }
  return { ...(last ?? {}), ready: false, timedOut: true };
}

/** 逐块拜访：把每个 widget 滚到视口中央并等它挂载，记录是否静态/就绪
 *  —— 只有交互 widget 才会被 scroll-latch 吞掉手势，探针必须优先选它们，
 *  否则量到的全是静态图（pointer-events:none）的假绿 */
async function surveyWidgets(cdp, total) {
  const out = [];
  for (let i = 0; i < total; i++) {
    const state = await readyWidget(cdp, i, 8000);
    out.push({ index: i, ready: !!state.ready, static: !!state.static, height: state.height ?? 0, bar: state.bar ?? "" });
  }
  return out;
}

// ───────────────────────────── 测量相位 ─────────────────────────────

async function measureGesture(cdp, targets, { label, widgetIndex, yDistance, gestureSourceType = "mouse", speed = 900 }) {
  let point;
  if (widgetIndex === null) {
    // 控制组：正文段落
    point = await cdp.evaluate(`(function () {
      var c = document.querySelector(".document-scroll");
      var ps = document.querySelectorAll(".markdown-body p");
      var p = ps[Math.min(ps.length - 1, 14)];
      var r = p.getBoundingClientRect();
      c.scrollTop = Math.max(0, Math.min(c.scrollHeight - c.clientHeight, r.top + c.scrollTop - c.clientHeight / 2));
      var cr = c.getBoundingClientRect();
      var hr = p.getBoundingClientRect();
      return { x: Math.round(cr.x + cr.width / 2), y: Math.round(Math.min(Math.max(hr.y + hr.height / 2, cr.y + 40), cr.bottom - 40)), hitTop: Math.round(hr.y) };
    })()`);
  } else {
    const state = await readyWidget(cdp, widgetIndex);
    const geom = await cdp.evaluate(`(function () {
      var c = document.querySelector(".document-scroll");
      var el = document.querySelectorAll(".mdlog-widget")[${widgetIndex}];
      var r = el.getBoundingClientRect();
      var cr = c.getBoundingClientRect();
      return { x: Math.round(cr.x + cr.width / 2), y: Math.round(r.y + r.height / 2), hitTop: Math.round(r.y), hitHeight: Math.round(r.height) };
    })()`);
    point = { ...geom, widgetState: state };
  }
  await sleep(450);
  await cdp.evaluate(RESET);
  const m0 = await metricsAll(cdp, targets);
  const before = await cdp.evaluate(`document.querySelector(".document-scroll").scrollTop`);
  const cpuBefore = webviewCpuMs();
  const t0 = Date.now();
  await cdp.send("Input.synthesizeScrollGesture", { x: point.x, y: point.y, xDistance: 0, yDistance, speed, gestureSourceType });
  const wall = Date.now() - t0;
  const cpuAfter = webviewCpuMs();
  const during = await cdp.evaluate(`document.querySelector(".document-scroll").scrollTop`);
  await sleep(600);
  const after = await cdp.evaluate(`document.querySelector(".document-scroll").scrollTop`);
  const m1 = await metricsAll(cdp, targets);
  const snap = await snapshot(cdp);
  return {
    kind: "gesture",
    label,
    requested: yDistance,
    gestureSourceType,
    point,
    before,
    during,
    after,
    moved: during - before,
    wallMs: wall,
    cpuMs: cpuBefore !== null && cpuAfter !== null ? cpuAfter - cpuBefore : null,
    cpuPerSec: cpuBefore !== null && cpuAfter !== null && wall > 0 ? (cpuAfter - cpuBefore) / (wall / 1000) : null,
    ...snap,
    metrics: metricsDiff(m0, m1),
  };
}

/** 整篇长滚动：覆盖 widget 挂载/卸载 churn 与大纲同步 */
async function measureLongScroll(cdp, targets) {
  await cdp.evaluate(`document.querySelector(".document-scroll").scrollTop = 0`);
  await sleep(400);
  await cdp.evaluate(RESET);
  const m0 = await metricsAll(cdp, targets);
  const point = await cdp.evaluate(`(function () {
    var cr = document.querySelector(".document-scroll").getBoundingClientRect();
    return { x: Math.round(cr.x + cr.width / 2), y: Math.round(cr.y + cr.height / 2) };
  })()`);
  const before = await cdp.evaluate(`document.querySelector(".document-scroll").scrollTop`);
  const cpuBefore = webviewCpuMs();
  const t0 = Date.now();
  await cdp.send("Input.synthesizeScrollGesture", { x: point.x, y: point.y, xDistance: 0, yDistance: -9000, speed: 3000, gestureSourceType: "mouse" }, { timeoutMs: 30000 });
  const wall = Date.now() - t0;
  const cpuAfter = webviewCpuMs();
  const after = await cdp.evaluate(`document.querySelector(".document-scroll").scrollTop`);
  const m1 = await metricsAll(cdp, targets);
  const snap = await snapshot(cdp);
  const facts = await documentFacts(cdp);
  return {
    kind: "longscroll",
    label: "longscroll/整篇 -9000px",
    requested: -9000,
    before,
    after,
    moved: after - before,
    wallMs: wall,
    cpuMs: cpuBefore !== null && cpuAfter !== null ? cpuAfter - cpuBefore : null,
    cpuPerSec: cpuBefore !== null && cpuAfter !== null && wall > 0 ? (cpuAfter - cpuBefore) / (wall / 1000) : null,
    facts,
    ...snap,
    metrics: metricsDiff(m0, m1),
  };
}

async function measureProgrammatic(cdp, targets, { label, steps = 60, delta = 60 }) {
  const startTop = await cdp.evaluate(`(function () {
    var c = document.querySelector(".document-scroll");
    c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) * 0.35);
    return c.scrollTop;
  })()`);
  await sleep(300);
  await cdp.evaluate(RESET);
  const m0 = await metricsAll(cdp, targets);
  const cpuBefore = webviewCpuMs();
  const t0 = Date.now();
  const after = await cdp.evaluate(`(function () {
    var c = document.querySelector(".document-scroll");
    var n = 0;
    return new Promise(function (done) {
      (function step() {
        c.scrollTop += ${delta};
        if (++n >= ${steps}) return done(c.scrollTop);
        requestAnimationFrame(step);
      })();
    });
  })()`);
  const wall = Date.now() - t0;
  const cpuAfter = webviewCpuMs();
  const m1 = await metricsAll(cdp, targets);
  const snap = await snapshot(cdp);
  return {
    kind: "programmatic",
    label,
    startTop,
    after,
    moved: after - startTop,
    wallMs: wall,
    cpuMs: cpuBefore !== null && cpuAfter !== null ? cpuAfter - cpuBefore : null,
    cpuPerSec: cpuBefore !== null && cpuAfter !== null && wall > 0 ? (cpuAfter - cpuBefore) / (wall / 1000) : null,
    ...snap,
    metrics: metricsDiff(m0, m1),
  };
}

// ───────────────────────────── trace 归因 ─────────────────────────────

async function readStream(cdp, handle) {
  const chunks = [];
  let compressed = false;
  for (;;) {
    const chunk = await cdp.send("IO.read", { handle, size: 1024 * 1024 }, { timeoutMs: 180000 });
    const buf = chunk.base64Encoded ? Buffer.from(chunk.data, "base64") : Buffer.from(chunk.data, "utf8");
    chunks.push(buf);
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) compressed = true;
    if (chunk.eof) break;
  }
  await cdp.send("IO.close", { handle }, { timeoutMs: 20000 });
  const all = Buffer.concat(chunks);
  if (compressed) {
    try {
      return zlib.gunzipSync(all).toString("utf8");
    } catch {
      return all.toString("utf8");
    }
  }
  return all.toString("utf8");
}

function summarizeTrace(raw) {
  const events = JSON.parse(raw).traceEvents ?? [];
  const byName = new Map();
  const byUrl = new Map();
  let droppedFrames = 0;
  const drawFrames = [];
  for (const e of events) {
    if (e.name === "DroppedFrame") droppedFrames++;
    if (e.name === "DrawFrame" && e.ph === "X" && e.dur) drawFrames.push(e.dur / 1000);
    if (e.ph !== "X" || !e.dur) continue;
    byName.set(e.name, (byName.get(e.name) ?? 0) + e.dur / 1000);
    const url = e.args?.data?.url;
    if (e.name === "FunctionCall" && url) byUrl.set(url, (byUrl.get(url) ?? 0) + e.dur / 1000);
  }
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    droppedFrames,
    drawFrameP95: stat(drawFrames, 0.95),
    drawFrameMax: drawFrames.length ? Math.max(...drawFrames) : 0,
    topEvents: top(byName, 12).map(([name, ms]) => ({ name, ms: Math.round(ms) })),
    topScriptUrls: top(byUrl, 10).map(([url, ms]) => ({ url: url.replace(/^https?:\/\/[^/]+/, "").slice(0, 60), ms: Math.round(ms) })),
  };
}

/** --trace 只包住一段被测行为：全量 trace 又大又慢，且 trace 失败不得拖垮测量 */
async function traceAround(cdp, fn, sink) {
  let started = false;
  try {
    await cdp.send(
      "Tracing.start",
      {
        categories: "devtools.timeline,cc,blink",
        transferMode: "ReturnAsStream",
        streamCompression: "gzip",
      },
      { timeoutMs: 20000 }
    );
    started = true;
  } catch (err) {
    console.log(`（trace 启动失败，降级跳过：${String(err).slice(0, 120)}）`);
  }
  const phase = await fn();
  if (!started) return phase;
  try {
    const done = new Promise((res) => cdp.on("Tracing.tracingComplete", res));
    await cdp.send("Tracing.end", {}, { timeoutMs: 30000 });
    const { stream } = await done;
    const raw = await readStream(cdp, stream);
    const tracePath = path.join(OUT_DIR, `trace-${Date.now()}.json`);
    writeFileSync(tracePath, raw);
    sink({ trace: summarizeTrace(raw), traceFile: tracePath });
  } catch (err) {
    console.log(`（trace 采集失败，降级跳过：${String(err).slice(0, 160)}）`);
  }
  return phase;
}

// ───────────────────────────── 主流程 ─────────────────────────────

function preflight() {
  let running = "";
  try {
    running = execSync('tasklist /FI "IMAGENAME eq vellum.exe" /NH', { encoding: "utf8" });
  } catch {}
  const alive = running.split("\n").filter((l) => l.includes("vellum.exe"));
  if (alive.length) {
    console.error("✘ 已有 Vellum 实例在跑，单实例插件会吞掉本次测量：\n" + alive.join("\n"));
    console.error("  先 taskkill /IM vellum.exe /F 再重跑。");
    process.exit(2);
  }
}

function line(p) {
  const latch = p.kind === "gesture" && Math.abs(p.moved) < Math.abs(p.requested) * 0.5;
  const ws = p.point?.widgetState;
  const live = p.kind === "gesture" && p.point?.widgetState !== undefined
    ? ws?.ready
      ? `live${ws.static ? "/static" : "/interactive"} h=${ws.height}`
      : `⚠未就绪(${ws?.bar || "?"})`
    : "";
  return (
    `  ${p.label.padEnd(26)} moved=${String(Math.round(p.moved)).padStart(6)}/${Math.abs(p.requested)} ${p.kind === "gesture" ? (latch ? "⚠疑似锁存" : "✔") : "  "} ${live.padEnd(24)}` +
    `| 帧 ${String(p.frames).padStart(4)} p50=${fmt(p.frameP50)} p95=${fmt(p.frameP95)} max=${fmt(p.frameMax)} 掉帧=${p.dropped}(${fmt(p.droppedRatio * 100)}%)` +
    `| 长任务=${p.longtasks}(${Math.round(p.longtaskMs)}ms)` +
    `| CPU=${p.cpuPerSec === null || p.cpuPerSec === undefined ? "?" : Math.round(p.cpuPerSec)}ms/s` +
    `| 主帧 Task=${fmt(p.metrics.main.TaskDuration * 1000, 0)}ms Script=${fmt(p.metrics.main.ScriptDuration * 1000, 0)}ms Layout=${fmt(p.metrics.main.LayoutDuration * 1000, 0)}ms` +
    `| 沙箱(${p.metrics.childCount}个) Task=${fmt(p.metrics.childTask * 1000, 0)}ms Script=${fmt(p.metrics.childScript * 1000, 0)}ms`
  );
}

async function main() {
  preflight();
  const fixture = prepareFixture();
  console.log(`样本：${fixture.label}\n路径：${fixture.file}（${(fixture.bytes / 1024).toFixed(0)}KB）\n`);

  const exe = spawn(EXE, [fixture.file], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
    detached: false,
  });

  let cdp;
  const result = { fixture, phases: [], document: null, documentAfter: null, trace: null };
  const artifact = path.join(OUT_DIR, `perf-${Date.now()}.json`);
  // 边跑边落盘：trace 或后期相位抄错不应把已采到的数据一起带走；
  // 单个相位出错也不中断整轮（记录 error 后继续）
  const record = (phase) => {
    result.phases.push(phase);
    console.log(line(phase));
    try {
      writeFileSync(artifact, JSON.stringify(result, null, 2));
    } catch {}
  };
  const safely = async (fn, label) => {
    try {
      return await fn();
    } catch (err) {
      const phase = { kind: "error", label, moved: 0, requested: 0, frames: 0, frameP50: 0, frameP95: 0, frameMax: 0, dropped: 0, droppedRatio: 0, longtasks: 0, longtaskMs: 0, metrics: { main: { TaskDuration: 0, ScriptDuration: 0, LayoutDuration: 0, RecalcStyleDuration: 0, LayoutCount: 0, RecalcStyleCount: 0 }, childTask: 0, childScript: 0, childLayout: 0, childCount: 0 } };
      phase.error = String(err).slice(0, 200);
      record(phase);
      return phase;
    }
  };

  try {
    cdp = await connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Performance.enable");

    for (let i = 0; i < 80; i++) {
      const facts = await documentFacts(cdp).catch(() => null);
      if (facts && facts.blocks > 10 && facts.widgetBlocks > 0) break;
      await sleep(300);
    }
    await sleep(2000);
    result.document = await documentFacts(cdp);
    console.log("文档：", result.document, "\n");

    const targets = new Targets(cdp);
    await targets.install();
    await cdp.evaluate(INSTRUMENT);

    // 先按真实阅读方式把整篇滚一遍，让 widget 一一挂载过（也让 LRU/休眠进入稳态）
    record(await measureLongScroll(cdp, targets));
    await sleep(1500);

    const total = result.document.widgetBlocks;
    const survey = await surveyWidgets(cdp, total);
    result.survey = survey;
    console.log(
      `widget 普查：共 ${total} 块，就绪 ${survey.filter((s) => s.ready).length}，` +
        `交互 ${survey.filter((s) => s.ready && !s.static).length}，静态 ${survey.filter((s) => s.ready && s.static).length}` +
        `，未就绪 ${survey.filter((s) => !s.ready).length}\n`
    );

    // 静止基线：不回滚、不输入，只看活着的那批 iframe 自己烧多少 CPU
    result.idle = await withCpu(async () => {
      await cdp.evaluate(RESET);
      await sleep(4000);
      const snap = await snapshot(cdp);
      const facts = await documentFacts(cdp);
      return { facts, snap };
    });
    console.log(
      `静止基线（4s）：CPU ${result.idle.cpuPerSec === null ? "?" : Math.round(result.idle.cpuPerSec)}ms/s` +
        ` | 存活 iframe ${result.idle.value.facts.iframes}（交互 ${result.idle.value.facts.iframes - result.idle.value.facts.staticFrames}）` +
        ` | 帧 p50=${fmt(result.idle.value.snap.frameP50)} p95=${fmt(result.idle.value.snap.frameP95)}\n`
    );

    // 交互 widget 优先（只有它们会被 scroll-latch 吞手势）；不足则用其余就绪块补齐
    const interactive = survey.filter((s) => s.ready && !s.static).map((s) => s.index);
    const others = survey.filter((s) => s.ready).map((s) => s.index);
    const pool = [...interactive, ...others];
    const picks = [];
    for (const idx of pool) {
      if (picks.length >= WIDGET_PROBES) break;
      if (!picks.includes(idx)) picks.push(idx);
    }

    let traced = false;
    for (const idx of picks) {
      // --trace 只包住第一次手势：全量 trace 又大又慢，而这一窗就够做归因
      if (WANT_TRACE && !traced) {
        traced = true;
        const scoped = await safely(
          () =>
            traceAround(
              cdp,
              () => measureGesture(cdp, targets, { label: `gesture/widget#${idx}`, widgetIndex: idx, yDistance: -1200 }),
              (sink) => Object.assign(result, sink)
            ),
          `gesture/widget#${idx}(trace)`
        );
        record(scoped);
        if (result.trace) {
          console.log("\ntrace 归因（首次 widget 手势）：", JSON.stringify(result.trace, null, 2), "\n");
        }
      } else {
        record(await safely(() => measureGesture(cdp, targets, { label: `gesture/widget#${idx}`, widgetIndex: idx, yDistance: -1200 }), `gesture/widget#${idx}`));
      }
      record(await safely(() => measureGesture(cdp, targets, { label: "gesture/text(control)", widgetIndex: null, yDistance: -1200 }), "gesture/text(control)"));
    }
    record(await safely(() => measureLongScroll(cdp, targets), "longscroll"));
    record(await safely(() => measureProgrammatic(cdp, targets, { label: "programmatic/60×60px" }), "programmatic"));
    result.documentAfter = await documentFacts(cdp);
    // 真机断言：根溢出保护必须在每个沙箱子帧里生效（html.overflowY=hidden 且根无滚动余量）
    const guards = await targets.verifyGuards();
    result.guard = guards;
    console.log(
      `根溢出保护真机断言：生效 ${guards.protectedCount}/${guards.total} 个 widget 子帧` +
        `；最大布局溢出 ${guards.maxRootRange}px（>0 是预期：leak 家族那几十 px 正是修复前被锁存吃手势的原因，保护生效后它只是布局溢出，不再构成可滚目标）` +
        (guards.total > 0 && guards.protectedCount === guards.total ? "✔" : "⚠ 需复查") +
        "\n"
    );
  } finally {
    try {
      await cdp?.evaluate(`document.querySelector("header button[aria-label='关闭']")?.click(), "closing"`);
      await sleep(1500);
    } catch {}
    try {
      cdp?.close();
    } catch {}
    if (!exe.killed) exe.kill();
    // 宽厚收尾：点击关闭走应用自身路径，但若它没生效（或 CDP 在窗口销毁瞬间卡住），
    // 必须硬杀，否则残留进程会让下一次 preflight 的独占检查直接拒绝（实测踩过）
    try {
      execSync('powershell -NoProfile -Command "Get-Process vellum -ErrorAction SilentlyContinue | Stop-Process -Force"', { timeout: 20000 });
    } catch {}
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(artifact, JSON.stringify(result, null, 2));
    console.log(`\nJSON 产物：${artifact}`);
  }
}

main().catch((err) => {
  console.error("探针失败：", err);
  process.exit(1);
});
