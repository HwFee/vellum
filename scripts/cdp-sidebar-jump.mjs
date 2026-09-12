#!/usr/bin/env node
/**
 * 真机探针：侧边栏开关时的滚动/视口跳动归因（CDP）。
 *
 * 为什么必须真机：跳动的根因候选全在浏览器布局与滚动锚定层（margin 过渡逐帧重排 +
 * Chromium 原生 scroll anchoring），jsdom 无布局，量不到。
 *
 * 前置：没有其它 Vellum 实例在跑（多实例后新实例不再被吞，但并存实例会污染逐帧读数）。
 * 用法：
 *   node scripts/cdp-sidebar-jump.mjs [--file <真实.md>]
 *
 * 量什么：
 *   - 相位（关侧栏 / 开侧栏）内逐帧记录「钉住元素相对容器顶的偏移」（这就是「读者看到的
 *     内容有没有动」的地面真值）、scrollTop / scrollHeight / 正文宽 / margin-left；
 *   - 两组对照实验：瞬时改 `.markdown-body` 宽度（无过渡）、侧栏开关但关停全部 CSS 过渡
 *     ——用于区分「原生锚定在本容器失效」与「是逐帧过渡把它拖坏」；
 *   - 仪表化 scrollTop 的写入来源栈（脚本写入会带栈；浏览器原生锚定不经过 setter）。
 *
 * 踩过的坑：
 *   1. 阅读位置的「落位守护」（scrollRestore.ts，ResizeObserver + 缓动动画，5s 或用户输入
 *      结束）会在内容尺寸一变化时就抢 scrollTop，把测量污染成「平滑漂移」。探针里先派一次
 *      wheel 再等 6s，两条退出条件都踩中。
 *   2. 滚动容器不要用 scrollIntoView/离散 scrollTop 当「用户滚动」——真机滚动请用
 *      Input.synthesizeScrollGesture（见 cdp-perf-scroll.mjs 的方法论）。
 *
 * 产出：控制台报告 + JSON 到 %TEMP%/vellum-perf/sidebar-jump-*.json
 */
import { spawn, execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXE = path.join(REPO, "src-tauri", "target", "release", "vellum.exe");
const PORT = 9222;
const OUT_DIR = path.join(os.tmpdir(), "vellum-perf");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, timeoutMs = 20000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
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
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`
      );
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
        return new Cdp(ws);
      }
    } catch {}
    await sleep(250);
  }
  throw new Error(`CDP 连接超时（${PORT}）`);
}

function preflight() {
  let running = "";
  try {
    running = execSync('tasklist /FI "IMAGENAME eq vellum.exe" /NH', { encoding: "utf8" });
  } catch {}
  const alive = running.split("\n").filter((l) => l.includes("vellum.exe"));
  if (alive.length) {
    console.error("✘ 已有 Vellum 实例在跑，并存实例会污染逐帧读数。先 taskkill /IM vellum.exe /F。");
    process.exit(2);
  }
}

/** 合成样本：足够长、多种块型（标题/段落/代码/引用/列表/图片占位），宽窄视觉差明显 */
function makeFixture() {
  const parts = ["# 侧栏跳动探针\n"];
  for (let i = 1; i <= 60; i++) {
    parts.push(`## 第 ${i} 节 标题\n`);
    parts.push(
      `第 ${i} 节正文。素笺是一份以纸墨为意象的 Markdown 阅读器，这一段用来占据足够的行数，` +
        `使正文在容器宽度变化时发生回流（换行数改变），从而暴露滚动锚定与像素恢复之间的差异。\n`
    );
    if (i % 4 === 0) {
      parts.push("```js\nconst vellum = { section: " + i + ", ink: 'wet' };\n```\n");
    }
    if (i % 5 === 0) {
      parts.push(`> 引用块 ${i}：用于检验块级锚点在宽度变化时的稳定性。\n`);
    }
    if (i % 6 === 0) {
      parts.push(`- 列表项 ${i}-A\n- 列表项 ${i}-B\n- 列表项 ${i}-C\n`);
    }
  }
  const file = path.join(os.tmpdir(), "vellum-sidebar-jump-fixture.md");
  writeFileSync(file, parts.join("\n"), "utf8");
  return file;
}

const PROBE = (tag) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const container = document.querySelector('.document-scroll');
  if (!container) return { error: 'no .document-scroll' };
  const body = document.querySelector('.markdown-body');
  if (!body || body.children.length === 0) return { error: 'no markdown body' };

  // 钉住一个元素：相位开始时视口顶部的首个顶层块，之后逐帧量它相对容器顶的偏移。
  // pinTop 就是「读者看到的内容有没有动」的地面真值——scrollTop 变了但 pinTop 不变＝无跳动。
  let pinned = null;
  let pinnedText = '';
  const pin = () => {
    const crect = container.getBoundingClientRect();
    pinned = null;
    for (const k of Array.from(body.children)) {
      const r = k.getBoundingClientRect();
      if (r.bottom > crect.top + 1) {
        pinned = k;
        pinnedText = (k.textContent || '').trim().slice(0, 16);
        break;
      }
    }
    return snap('pin');
  };
  const widgetStats = () => {
    const frames = Array.from(document.querySelectorAll('.mdlog-widget__frame'));
    let sum = 0;
    let parked = 0;
    for (const f of frames) {
      sum += f.getBoundingClientRect().height;
      if (f.classList.contains('mdlog-widget__frame--parked')) parked += 1;
    }
    return { count: frames.length, sumH: Math.round(sum), parked };
  };
  const snap = (label) => {
    const crect = container.getBoundingClientRect();
    let anchor = null;
    for (const k of Array.from(body.children)) {
      const r = k.getBoundingClientRect();
      if (r.bottom > crect.top + 1) {
        anchor = { tag: k.tagName, top: Math.round(r.top - crect.top), text: (k.textContent || '').trim().slice(0, 16) };
        break;
      }
    }
    const cs = getComputedStyle(container);
    const w = widgetStats();
    return {
      label,
      t: Math.round(performance.now()),
      scrollTop: Math.round(container.scrollTop),
      scrollHeight: Math.round(container.scrollHeight),
      clientHeight: Math.round(container.clientHeight),
      bodyWidth: Math.round(body.getBoundingClientRect().width),
      bodyLeft: Math.round(body.getBoundingClientRect().left - crect.left),
      marginLeft: cs.marginLeft,
      winW: window.innerWidth,
      open: !!document.querySelector('.outline-sidebar--open'),
      anchor,
      pinTop: pinned ? Math.round(pinned.getBoundingClientRect().top - crect.top) : null,
      pinText: pinnedText,
      widgets: w,
    };
  };

  const out = { tag: ${JSON.stringify(tag)}, frames: [], snaps: [] };
  out.snaps.push(snap('initial'));

  // 先滚到中段（避开顶部/底部边界效应）
  const max = container.scrollHeight - container.clientHeight;
  container.scrollTop = Math.round(max * 0.45);
  await sleep(600);
  out.snaps.push(snap('scrolled'));

  // 排除「阅读位置落位守护」干扰：它随时长（5s）与用户输入（wheel/keydown）结束，
  // 这里两者都做——先派一次 wheel，再等过守护窗口上限
  container.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
  await sleep(6000);
  out.snaps.push(snap('guard-cleared'));

  // 仪表化：谁在写 scrollTop（脚本调用会带 stack；浏览器内部滚动锚定不会经过 setter）
  window.__scrollSets = [];
  const proto = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  Object.defineProperty(container, 'scrollTop', {
    configurable: true,
    get() { return proto.get.call(container); },
    set(v) {
      const stack = (new Error().stack || '').split('\\n').slice(1, 4).join(' | ');
      window.__scrollSets.push({ t: Math.round(performance.now()), from: Math.round(proto.get.call(container)), to: Math.round(v), stack });
      proto.set.call(container, v);
    },
  });

  const toggle = () => document.querySelector('.outline-toggle').click();

  const runPhase = async (name) => {
    const phase = { name, frames: [], snaps: [] };
    phase.snaps.push(pin());
    // 逐帧采样 1.6s（覆盖 250ms 过渡 + 迟到的 widget 高度上报 + 200ms 高度过渡）
    // 每个 rAF 采两个值：pinTop 是「修正前」的帧内读数（受采样回调与修正回调的先后影响），
    // pinTopPost 是该帧绘制完成后（setTimeout 任务里）的读数——后者才是用户真正看到的画面。
    let stop = false;
    const loop = () => {
      const rec = snap('f');
      phase.frames.push(rec);
      if (pinned) {
        const el = pinned;
        setTimeout(() => {
          const c = container.getBoundingClientRect();
          rec.pinTopPost = Math.round(el.getBoundingClientRect().top - c.top);
        }, 0);
      }
      if (!stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    toggle();
    await sleep(1600);
    stop = true;
    await sleep(50);
    phase.snaps.push(snap(name + ':1600ms'));
    await sleep(2400);
    phase.snaps.push(snap(name + ':4000ms'));
    return phase;
  };

  out.closePhase = await runPhase('close');
  out.openPhase = await runPhase('open');
  // ── 微实验：区分「浏览器原生锚定在本容器根本失效」与「是过渡逐帧重排把它拖坏」──
  const exp = [];
  const settle = async (ms) => { await sleep(ms); };
  const exp1 = {};
  const max2 = container.scrollHeight - container.clientHeight;
  container.scrollTop = Math.round(max2 * 0.45);
  await sleep(500);
  exp1.before = snap('e1:before');
  body.style.maxWidth = '720px'; // 瞬时变窄：文档整体变高
  await sleep(400);
  exp1.narrow = snap('e1:narrow');
  body.style.maxWidth = '';
  await sleep(400);
  exp1.restored = snap('e1:restored');
  exp.push({ name: '瞬时宽度变化（无过渡）', steps: exp1 });

  // 实验 2：同一次侧栏开关，但把所有 CSS 过渡关掉（瞬时重排）
  const killCss = document.createElement('style');
  killCss.textContent = '.document-scroll{transition:none!important} .outline-sidebar{transition:none!important} .mdlog-widget__frame{transition:none!important}';
  document.head.appendChild(killCss);
  const exp2 = {};
  exp2.before = snap('e2:before');
  document.querySelector('.outline-toggle').click();
  await sleep(400);
  exp2.closed = snap('e2:closed');
  document.querySelector('.outline-toggle').click();
  await sleep(400);
  exp2.reopened = snap('e2:reopened');
  exp.push({ name: '侧栏开关（过渡全部关停）', steps: exp2 });
  killCss.remove();

  out.experiments = exp;
  out.scrollSets = window.__scrollSets;
  // 窗口尺寸变化（与侧栏开关同源：都改正文宽度 ⇒ 行重排）的身份锚：钉一个标题 id，
  // 前后量同一元素相对容器顶的偏移。供 node 侧 resize 相位调用。
  window.__probe2 = {
    mark: null,
    snap(label) {
      const c = document.querySelector('.document-scroll');
      const body = document.querySelector('.markdown-body');
      const cr = c.getBoundingClientRect();
      if (!this.mark) {
        const hs = Array.from(body.querySelectorAll('h1[id], h2[id], h3[id]'));
        let best = hs.length ? hs[0].id : null;
        for (const h of hs) {
          if (h.getBoundingClientRect().top <= cr.top + 2) best = h.id;
          else break;
        }
        this.mark = best;
      }
      const el = this.mark ? document.getElementById(this.mark) : null;
      return {
        label,
        top: Math.round(c.scrollTop),
        h: Math.round(c.scrollHeight),
        bodyW: body ? Math.round(body.getBoundingClientRect().width) : null,
        winW: window.innerWidth,
        markId: this.mark,
        markOffset: el ? Math.round(el.getBoundingClientRect().top - cr.top) : null,
      };
    },
  };
  out.overflows = {
    overflowAnchor: getComputedStyle(container).overflowAnchor,
    scrollBehavior: getComputedStyle(container).scrollBehavior,
  };
  out.widgetCounts = {
    widget: document.querySelectorAll('.mdlog-widget').length,
    frame: document.querySelectorAll('.mdlog-widget__frame').length,
    placeholder: document.querySelectorAll('.mdlog-widget__placeholder').length,
    iframes: document.querySelectorAll('iframe').length,
  };
  return out;
})()`;

async function main() {
  preflight();
  const fileArg = argOf("--file");
  const file = fileArg ? path.resolve(fileArg) : makeFixture();
  console.log(`样本：${file}\n`);

  const exe = spawn(EXE, [file], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
    detached: false,
  });

  let cdp;
  try {
    cdp = await connect();
    // 等文档渲染完成
    const deadline = Date.now() + 30000;
    let ready = false;
    while (Date.now() < deadline) {
      const r = await cdp.evaluate(
        `!!document.querySelector('.markdown-body') && document.querySelector('.markdown-body').children.length > 5`
      );
      if (r === true) {
        ready = true;
        break;
      }
      await sleep(400);
    }
    if (!ready) throw new Error("文档未在 30s 内渲染");
    await sleep(600);

    const result = await cdp.evaluate(PROBE(path.basename(file)));
    mkdirSync(OUT_DIR, { recursive: true });
    const artifact = path.join(OUT_DIR, `sidebar-jump-${Date.now()}.json`);
    writeFileSync(artifact, JSON.stringify(result, null, 2));

    for (const [name, phase] of [
      ["CLOSE", result.closePhase],
      ["OPEN", result.openPhase],
    ]) {
      console.log(`\n===== ${name} =====`);
      for (const s of phase.snaps) {
        console.log(
          `  ${s.label.padEnd(16)} top=${String(s.scrollTop).padStart(7)} h=${String(s.scrollHeight).padStart(7)}` +
            ` bodyW=${String(s.bodyWidth).padStart(4)} mL=${s.marginLeft.padStart(7)} open=${s.open ? "Y" : "N"}` +
            ` pinTop=${String(s.pinTop).padStart(6)}「${s.pinText}」` +
            ` anchor=${s.anchor ? `${s.anchor.tag}@${s.anchor.top}「${s.anchor.text}」` : "-"}` +
            ` frames=${s.widgets.count}(h=${s.widgets.sumH},parked=${s.widgets.parked})`
        );
      }
      // 逐帧轨迹：每 100ms 采一帧 + 「绘制后读数」抖动帧
      // 关键指标是 pinTopPost（该帧绘制完成后读到的高偏移）：修正回调位于 rAF 内、
      // 早于本探针的采样回调时，pinTop 会记录「修正前」的帧内状态，不代表用户看到了跳。
      console.log(`  逐帧采样 ${phase.frames.length} 帧（每 100ms 一采 + 绘制后偏移突变帧）：`);
      const base = phase.snaps[0].pinTop;
      let lastBucket = -1;
      let lastPost = null;
      let maxPost = 0;
      let maxPostStep = 0;
      let maxRaw = 0;
      for (const f of phase.frames) {
        if (f.pinTop != null) maxRaw = Math.max(maxRaw, Math.abs(f.pinTop - base));
        if (f.pinTopPost != null) {
          maxPost = Math.max(maxPost, Math.abs(f.pinTopPost - base));
          if (lastPost !== null) maxPostStep = Math.max(maxPostStep, Math.abs(f.pinTopPost - lastPost));
          lastPost = f.pinTopPost;
        }
        const bucket = Math.round(f.t / 100) * 100;
        const post = f.pinTopPost ?? f.pinTop;
        const jitter = lastPost !== null && Math.abs(post - lastPost) > 4;
        if (bucket !== lastBucket || jitter) {
          console.log(
            `    t=${String(f.t).padStart(6)}ms top=${String(f.scrollTop).padStart(7)} h=${String(f.scrollHeight).padStart(7)}` +
              ` bodyW=${String(f.bodyWidth).padStart(4)} mL=${f.marginLeft.padStart(7)}` +
              ` pinTop=${String(f.pinTop).padStart(6)} 绘制后=${String(f.pinTopPost ?? "-").padStart(6)}${jitter ? "  ◀ 内容位移" : ""}`
          );
          lastBucket = bucket;
        }
      }
      console.log(
        `  ⇒ 基准 pinTop=${base}px：绘制后最大偏移 ${maxPost}px（单帧最大突变 ${maxPostStep}px）` +
          `；帧内（修正前）读数最大 ${maxRaw}px`
      );
    }
    console.log(`\nJSON: ${artifact}`);

    // 窗口缩放相位：Emulation.setDeviceMetricsOverride 展改布局视口宽（等价拖窗口边）
    await cdp.evaluate(`window.__probe2.snap('resize:install')`);
    const size = await cdp.evaluate(`({ w: window.innerWidth, h: window.innerHeight })`);
    const before = await cdp.evaluate(`window.__probe2.snap('resize:before')`);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: Math.max(760, size.w - 260),
      height: size.h,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(900);
    const after = await cdp.evaluate(`window.__probe2.snap('resize:after')`);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await sleep(400);
    const back = await cdp.evaluate(`window.__probe2.snap('resize:restored')`);
    console.log(`\n===== 窗口尺寸变化（同一身份锚：标题 #${before.markId}） =====`);
    for (const s of [before, after, back]) {
      console.log(
        `  ${s.label.padEnd(18)} winW=${String(s.winW).padStart(5)} bodyW=${String(s.bodyW).padStart(4)}` +
          ` top=${String(s.top).padStart(7)} h=${String(s.h).padStart(7)} markOffset=${String(s.markOffset).padStart(6)}`
      );
    }
    const jump = Math.abs((after.markOffset ?? 0) - (before.markOffset ?? 0));
    const verdict = jump < 4 ? "（未跳）" : jump < 60 ? "（轻微漂移：原生锚定自行补偿，本修复不介入）" : "（★确实会跳，本修复未覆盖）";
    console.log(`  ⇒ 缩放引起的视口内容位移 ${jump}px ${verdict}`);

    // 拖宽相位：真指针事件拖侧栏手柄（pointerdown/move/up 由 CDP 合成）
    const dragBefore = await cdp.evaluate(`window.__probe2.snap('drag:before')`);
    const handle = await cdp.evaluate(
      `(() => { const h = document.querySelector('.outline-resize-handle'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 200) }; })()`
    );
    if (handle) {
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: handle.x, y: handle.y, button: "none" });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: handle.x, y: handle.y, button: "left", buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 8; i++) {
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: handle.x + i * 8,
          y: handle.y,
          button: "left",
          buttons: 1,
        });
        await sleep(35);
      }
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: handle.x + 64,
        y: handle.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      await sleep(900);
      const dragAfter = await cdp.evaluate(`window.__probe2.snap('drag:after')`);
      console.log(`\n===== 拖宽手柄（同一身份锚：标题 #${dragBefore.markId}） =====`);
      for (const s of [dragBefore, dragAfter]) {
        console.log(
          `  ${s.label.padEnd(14)} bodyW=${String(s.bodyW).padStart(4)} top=${String(s.top).padStart(7)} h=${String(s.h).padStart(7)} markOffset=${String(s.markOffset).padStart(6)}`
        );
      }
      const dragJump = Math.abs((dragAfter.markOffset ?? 0) - (dragBefore.markOffset ?? 0));
      console.log(`  ⇒ 拖宽引起的视口内容位移 ${dragJump}px ${dragJump < 4 ? "（未跳）" : "（★会跳）"}`);
      // 复位宽度，避免影响后续实验
      await cdp.evaluate(
        `document.querySelector('.outline-resize-handle')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), null`
      );
      await sleep(500);
    } else {
      console.log("\n（未找到 .outline-resize-handle，跳过拖宽相位）");
    }
    for (const e of result.experiments) {
      console.log(`\n===== 实验：${e.name} =====`);
      for (const s of Object.values(e.steps)) {
        console.log(
          `  ${s.label.padEnd(14)} top=${String(s.scrollTop).padStart(7)} h=${String(s.scrollHeight).padStart(7)}` +
            ` bodyW=${String(s.bodyWidth).padStart(4)} pinTop=${String(s.pinTop).padStart(6)}「${s.pinText}」` +
            ` anchor=${s.anchor ? `${s.anchor.tag}@${s.anchor.top}「${s.anchor.text}」` : "-"}`
        );
      }
    }
    console.log(`overflows: ${JSON.stringify(result.overflows)}`);
    console.log(`widgetCounts: ${JSON.stringify(result.widgetCounts)}`);
    console.log(`\nscrollTop 写入来源（${result.scrollSets.length} 次）：`);
    for (const s of result.scrollSets.slice(0, 30)) {
      console.log(`  t=${s.t}ms ${s.from}→${s.to}  ${s.stack}`);
    }
  } finally {
    cdp?.close();
    try {
      exe.kill();
    } catch {}
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
