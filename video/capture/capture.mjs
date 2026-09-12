// 宣传片素材抓取：以 CDP 驱动真实 Vellum 窗口，截取用于 Remotion 合成的高分屏图。
//
// 用法（工作目录不限，路径一律以脚本自身位置为准）：
//   node capture/capture.mjs [--exe <path>] [--out <dir>] [--keep]
//   node video/capture/capture.mjs [--exe <path>] [--out <dir>] [--keep]
//
// 前置：脚本会自己 taskkill 既有实例（并存实例会互相抢占远程调试端口）。
// 产物默认写入 video/public/capture/，Remotion 侧用 staticFile("capture/xxx.png") 取。
//
// 两个关键设计决定：
//
// ① 长图 plate 用「临时把视口撑到全文高」抓，而不是 captureBeyondViewport。
//    `.document-scroll` 是 overflow:auto 的滚动盒，它的 bounding box 高度只有视口高；
//    在盒外再取 2929px 只能截到空白（第一版就踩了这个坑：5858px 的图里正文只占顶部
//    900px，其余全是纸色）。撑高视口能让整篇真正布局出来，`captureBeyondViewport`
//    则不会触发行盒扩展。
//
// ② 长图交给 Remotion 推进视口，而不是逐帧录屏。
//    截图的耗时不可控，帧间隔会抖；一张全高 plate 在 Remotion 里按帧号推进是确定性
//    的，滚动速度 / 缓动 / 停顿全部精确到帧。
import { spawn, execSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const get = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

// 脚本位置锚定：以前这里用 process.cwd()，于是 `npm run capture`（cwd = video/）
// 会去找 video/video/assets/demo.md 而 ENOENT；现在从脚本自身推仓库根，
// 从仓库根跑、从 video/ 跑、从任何地方跑，结果一致。
const VIDEO_DIR = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(VIDEO_DIR, "..");
const EXE = path.resolve(get("exe", path.join(ROOT, "src-tauri/target/release/vellum.exe")));
const OUT = path.resolve(get("out", path.join(VIDEO_DIR, "public/capture")));
const PORT = Number(get("port", "9222"));
const VIEW = { width: 1440, height: 900, dsf: 2 };
/** 素材文档的落地目录：不要用仓库路径，顶栏会把绝对路径原样显示出来。 */
const STAGE = path.resolve(get("stage", path.join(os.homedir(), "Documents", "Notes")));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[capture ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------- CDP plumbing
const listUrl = () => `http://127.0.0.1:${PORT}/json/list`;

async function findPage(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = [];
  while (Date.now() < deadline) {
    try {
      const res = await fetch(listUrl(), { signal: AbortSignal.timeout(2000) });
      const targets = await res.json();
      lastSeen = targets.filter((t) => t.type === "page").map((t) => t.url);
      // 启动瞬间 WebView2 先给 about:blank 再导航到真文档；此时挂上去会在导航的
      // 一刹那收到 Execution context was destroyed，所以必须等 URL 落定。
      const page = targets.find(
        (t) =>
          t.type === "page" &&
          t.webSocketDebuggerUrl &&
          t.url &&
          t.url !== "about:blank" &&
          !t.url.startsWith("devtools://")
      );
      if (page) return page;
    } catch {
      /* 端口还没起来 */
    }
    await sleep(400);
  }
  throw new Error(
    `等待 CDP page target 超时（${timeoutMs}ms，端口 ${PORT}）；最后看到：${JSON.stringify(lastSeen)}`
  );
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const send = (method, params = {}, timeoutMs = 120_000) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      const timer = setTimeout(() => {
        pending.delete(mid);
        reject(new Error(`CDP ${method} 超时`));
      }, timeoutMs);
      pending.set(mid, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send, events, ready };
}

let saved = 0;

async function shoot(cdp, name, { clip } = {}) {
  const params = { format: "png", captureBeyondViewport: false };
  if (clip) {
    params.clip = { ...clip, scale: 1 };
    params.captureBeyondViewport = true;
  }
  const { data } = await cdp.send("Page.captureScreenshot", params, 240_000);
  const buffer = Buffer.from(data, "base64");
  await writeFile(path.join(OUT, `${name}.png`), buffer);
  saved += 1;
  log(`saved ${name}.png (${(buffer.length / 1024).toFixed(0)} KB)`);
}

async function evaluate(cdp, expression, attempts = 8) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await cdp.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (res.exceptionDetails) throw new Error(`页面求值异常：${res.exceptionDetails.text}`);
      return res.result?.value;
    } catch (error) {
      lastError = error;
      const msg = String(error?.message ?? error);
      const recoverable =
        /Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(msg);
      if (!recoverable) throw error;
      log(`求值上下文被替换，重试 ${i + 1}/${attempts}：${msg.slice(0, 80)}`);
      await sleep(600);
    }
  }
  throw lastError;
}

const setViewport = (cdp, width, height) =>
  cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: VIEW.dsf,
    mobile: false,
  });

async function clickSelector(cdp, selector, { wait = 350 } = {}) {
  const ok = await evaluate(
    cdp,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false; el.click(); return true; })()`
  );
  if (!ok) throw new Error(`点击失败，未命中：${selector}`);
  await sleep(wait);
}

async function scrollToElement(cdp, selector, { block = "start", settle = 700 } = {}) {
  const ok = await evaluate(
    cdp,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: "instant" });
      return true; })()`
  );
  if (!ok) throw new Error(`滚动失败，未命中：${selector}`);
  await sleep(settle);
}

/** 把某元素整体收进临时撑高的视口里抓下来（见文件头 ①）。 */
async function shootPlate(cdp, name, selector, maxHeight = 7000) {
  const full = await evaluate(
    cdp,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null; return Math.ceil(el.scrollHeight); })()`
  );
  if (!full) throw new Error(`plate 选择器没命中：${selector}`);
  const height = Math.min(full, maxHeight);
  await evaluate(cdp, `document.documentElement.classList.add("capture-clean"), true`);
  await setViewport(cdp, VIEW.width, height);
  // 撑高后需要重新布局 + 触发 loading="lazy" 的图片 + widget 高度上报
  await sleep(1600);
  const box = await evaluate(
    cdp,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(el.scrollHeight) }; })()`
  );
  log(`plate ${name}: viewport ${VIEW.width}x${height}, clip ${box.width}x${box.height} @ (${box.x},${box.y})`);
  await shoot(cdp, name, { clip: box });
  await setViewport(cdp, VIEW.width, VIEW.height);
  await evaluate(cdp, `document.documentElement.classList.remove("capture-clean"), true`);
  await sleep(900);
  return box;
}

// ------------------------------------------------------------------ 文档暂存
async function stageDoc(source, targetName) {
  await mkdir(STAGE, { recursive: true });
  const target = path.join(STAGE, targetName);
  // source 一律写作「相对仓库根」的路径（video/assets/xxx.md），与 cwd 无关
  const from = path.resolve(ROOT, source);
  await copyFile(from, target);
  // 文档同目录的图片资源一并搬过去（相对路径才能解析）
  const dir = path.dirname(from);
  for (const asset of ["figure.png"]) {
    try {
      await copyFile(path.join(dir, asset), path.join(STAGE, asset));
    } catch {
      /* 没有就跳过 */
    }
  }
  log(`已暂存素材文档 → ${target}`);
  return target;
}

// --------------------------------------------------------------------- 单次会话
async function launch(docPath) {
  const child = spawn(EXE, [docPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT} --force-device-scale-factor=${VIEW.dsf}`,
    },
  });
  child.unref();
  log(`已启动 vellum.exe（pid ${child.pid}）→ ${docPath}`);

  const target = await findPage();
  log(`page target: ${target.url}`);
  if (/localhost:1420/.test(target.url)) {
    log("⚠️  目标 URL 是 dev server —— 这不是生产构建（Cargo.toml 缺 custom-protocol）");
  }

  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  for (const [method, params] of [
    ["Page.enable", {}],
    ["Runtime.enable", {}],
  ]) {
    for (let attempt = 1; ; attempt++) {
      try {
        await cdp.send(method, params);
        break;
      } catch (error) {
        if (attempt >= 6) throw error;
        log(`${method} 失败（${String(error?.message).slice(0, 60)}），重试 ${attempt}/6`);
        await sleep(700);
      }
    }
  }
  await setViewport(cdp, VIEW.width, VIEW.height);

  await evaluate(
    cdp,
    `(async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 25000) {
        const article = document.querySelector(".markdown-body, article");
        if (article && article.textContent.length > 200) {
          await document.fonts.ready;
          await new Promise((r) => setTimeout(r, 600));
          return true;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return false;
    })()`
  );

  // 注入「抓图干净模式」：plate 里不要出现跳底浮钮等与正文无关的浮层
  await evaluate(
    cdp,
    `(() => {
      if (document.getElementById("capture-clean-style")) return true;
      const style = document.createElement("style");
      style.id = "capture-clean-style";
      style.textContent = ".capture-clean .jump-bottom, .capture-clean .reload-note, .capture-clean .editor-toast, .capture-clean .block-editor__mark { display: none !important; }";
      document.head.appendChild(style);
      return true;
    })()`
  );

  const probe = await evaluate(
    cdp,
    `JSON.stringify({
      headings: document.querySelectorAll("h1,h2,h3").length,
      outlineLinks: document.querySelectorAll(".outline-panel__link").length,
      widgets: document.querySelectorAll(".mdlog-widget").length,
      placeholders: document.querySelectorAll(".mdlog-widget__placeholder").length,
      codeBlocks: document.querySelectorAll(".markdown-body pre").length,
      tables: document.querySelectorAll(".markdown-body table").length,
      katex: document.querySelectorAll(".katex").length,
      images: document.querySelectorAll(".markdown-body img").length,
      docHeight: document.querySelector(".document-scroll")?.scrollHeight ?? null,
    })`
  );
  log("页面探针:", probe);

  // 通篇滚一遍：触发图片加载 / widget 预载视距 / 懒挂载
  await evaluate(
    cdp,
    `(async () => {
      const sc = document.querySelector(".document-scroll");
      if (!sc) return false;
      for (let y = 0; y <= sc.scrollHeight + 400; y += 380) {
        sc.scrollTop = y;
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 24)));
      }
      await new Promise((r) => setTimeout(r, 1200));
      sc.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 700));
      return true;
    })()`
  );

  const afterCounts = await evaluate(
    cdp,
    `JSON.stringify({
      images: document.querySelectorAll(".markdown-body img").length,
      widgetFrames: document.querySelectorAll(".mdlog-widget iframe").length,
      placeholders: document.querySelectorAll(".mdlog-widget__placeholder").length,
    })`
  );
  log("滚动后:", afterCounts);

  return cdp;
}

function killVellum() {
  try {
    execSync("taskkill /IM vellum.exe /F", { stdio: "ignore" });
  } catch {
    /* 已经退出 */
  }
}

// --------------------------------------------------------------------- 主流程
async function main() {
  log(`exe = ${EXE}`);
  log(`out = ${OUT}`);
  log(`stage = ${STAGE}`);
  await mkdir(OUT, { recursive: true });

  if (!flag("keep")) {
    killVellum();
    await sleep(700);
  }

  // ============================ 会话 A：正文文档 ============================
  const docA = await stageDoc("video/assets/demo.md", "the-paper-interface.md");
  let cdp = await launch(docA);

  await evaluate(cdp, `document.querySelector(".document-scroll").scrollTop = 0, true`);
  await sleep(700);
  await shoot(cdp, "01-window-reading");

  await shootPlate(cdp, "02-article-plate", ".document-scroll__content");

  // 大纲搜索
  await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector(".outline-search__input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "paper");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await sleep(1100);
  await shoot(cdp, "03-window-search");
  await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector(".outline-search__input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`
  );
  await sleep(700);

  // 数学 / 图
  await scrollToElement(cdp, ".katex-display", { block: "center" });
  await shoot(cdp, "04-window-math");

  // 交互块：先占位，再点开
  await scrollToElement(cdp, ".mdlog-widget", { block: "center" });
  await shoot(cdp, "05-window-widget-placeholder");
  const clicked = await evaluate(
    cdp,
    `(() => { const b = document.querySelector(".mdlog-widget__placeholder"); if (!b) return false; b.click(); return true; })()`
  );
  await sleep(1800);
  await scrollToElement(cdp, ".mdlog-widget", { block: "center" });
  await shoot(cdp, "06-window-widget-live");
  log(clicked ? "交互块已点开" : "没有占位按钮（可能已自动挂载）");

  // 代码块
  await scrollToElement(cdp, ".markdown-body pre", { block: "center" });
  await shoot(cdp, "07-window-code");

  // 收起侧栏后的宽正文
  await clickSelector(cdp, "header button[aria-label='切换大纲']", { wait: 900 });
  await sleep(900);
  await shoot(cdp, "08-window-no-outline");
  await clickSelector(cdp, "header button[aria-label='切换大纲']", { wait: 900 });
  await sleep(600);

  // 编辑视图
  await evaluate(cdp, `document.querySelector(".document-scroll").scrollTop = 0, true`);
  await sleep(500);
  // 切换按钮有时一次点不中（视图切换与重渲染撞在一起），落定后校验再补点。
  let editOk = false;
  for (let i = 0; i < 3 && !editOk; i += 1) {
    await clickSelector(cdp, "header button[aria-label='切换编辑视图']", { wait: 1300 });
    editOk = await evaluate(cdp, `!!document.querySelector(".document-scroll__content--editing")`);
    if (!editOk) log(`编辑视图未生效，重试 ${i + 1}/3`);
  }
  log(`编辑视图已生效：${editOk}`);

  // 可编辑块的选择器是 `[data-vellum-unit]`（直接在 markdown-body--editing 下）；
  // `.vellum-unit-wrap` 只在需要定位的块上出现，不能当遍历入口。
  const para = await evaluate(
    cdp,
    `(() => {
      const el = document.querySelector('[data-vellum-unit="1"]') ?? document.querySelector("[data-vellum-unit]");
      if (!el) return null;
      el.scrollIntoView({ block: "center", behavior: "instant" });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + 120), y: Math.round(r.y + r.height / 2) };
    })()`
  );
  await sleep(800);

  if (para) {
    // 先只移动指针：页边的 ¶ 是 hover 态，没有这一步第二张图就没有编辑语汇
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: para.x,
      y: para.y,
      button: "none",
      buttons: 0,
    });
    await sleep(600);
  }
  await shoot(cdp, "09-window-editing");

  if (para) {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp.send("Input.dispatchMouseEvent", {
        type,
        button: "left",
        clickCount: 1,
        x: para.x,
        y: para.y,
      });
    }
    await sleep(1000);
    await shoot(cdp, "10-window-editing-active");

    // 光标移到草稿末尾再输入：默认插在句子中间会把原文切断，看起来像 bug
    const ready = await evaluate(
      cdp,
      `(() => { const ta = document.querySelector(".block-editor__input");
        if (!ta) return false;
        ta.focus();
        ta.selectionStart = ta.selectionEnd = ta.value.length;
        return true; })()`
    );
    log(`就地编辑面已打开：${ready}`);
    if (ready) {
      for (const ch of " Paper is the opposite of chrome.") {
        await cdp.send("Input.dispatchKeyEvent", { type: "char", text: ch });
        await sleep(44);
      }
      await sleep(800);
      // 输入后视口会被宿主的「阅读位置落位守护」拽回它记录的锚点——它把程序化滚动
      // 一律当成布局漂移，只有真实用户输入才交还控制权。所以先派一次真滚轮收工，
      // 再自己把编辑面钉回画面中央（上一版只用一次 scrollIntoView，被随后的重锚覆盖，
      // 结果这张图拍到了几百行开外的公式区，编辑器与刚打的字都不在画面里）。
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 1200,
        y: 600,
        deltaX: 0,
        deltaY: 120,
        button: "none",
        buttons: 0,
      });
      await sleep(700);
      // 连量几轮：每轮都重新取 rect（长高的 textarea 会让上一次的坐标立刻过期）
      for (let i = 0; i < 5; i += 1) {
        const box = await evaluate(
          cdp,
          `(() => { const ta = document.querySelector(".block-editor__input");
            if (!ta) return null;
            const sc = document.querySelector(".document-scroll");
            const r = ta.getBoundingClientRect();
            const cr = sc.getBoundingClientRect();
            sc.scrollTop += (r.top - cr.top) - (cr.height - r.height) / 2;
            return { top: Math.round(r.top), ctop: Math.round(cr.top), h: Math.round(cr.height) }; })()`
        );
        await sleep(320);
        if (box && box.top > box.ctop + 60 && box.top < box.ctop + box.h - 240) break;
      }
      await sleep(500);
      await shoot(cdp, "11-window-editing-typed");
      // 撤销草稿：素材文档是暂存副本，但把编辑会话留在原地会让后续镜头带着改动
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
      });
      await sleep(600);
    }
  } else {
    log("⚠️  没定位到可编辑块");
  }

  // 回阅读 + 顶部定格
  for (let i = 0; i < 3; i += 1) {
    await clickSelector(cdp, "header button[aria-label='切换编辑视图']", { wait: 1000 });
    const backToReading = await evaluate(
      cdp,
      `!document.querySelector(".document-scroll__content--editing")`
    );
    if (backToReading) break;
  }
  await evaluate(cdp, `document.querySelector(".document-scroll").scrollTop = 0, true`);
  await sleep(900);
  await shoot(cdp, "12-window-hero");

  const errors = cdp.events.filter(
    (e) => e.method === "Log.entryAdded" || e.method === "Runtime.exceptionThrown"
  );
  log(`会话 A 页面错误/异常事件数：${errors.length}`);
  for (const e of errors.slice(0, 6)) log("  ", JSON.stringify(e.params).slice(0, 220));
  cdp.ws.close();
  killVellum();
  await sleep(1500);

  // ============================ 会话 B：mdlog 日志 ==========================
  const docB = await stageDoc("video/assets/session-log.md", "session-log.md");
  cdp = await launch(docB);
  // mdlog 未连接时交互块停在占位块（信任门禁），片子里要看到真内容就得逐个点开。
  const opened = await evaluate(
    cdp,
    `(async () => {
      const btns = [...document.querySelectorAll(".mdlog-widget__placeholder")];
      for (const b of btns) { b.click(); await new Promise((r) => setTimeout(r, 140)); }
      return btns.length;
    })()`
  );
  log(`日志文档点开了 ${opened} 个交互块`);
  await sleep(2600);
  await evaluate(cdp, `document.querySelector(".document-scroll").scrollTop = 0, true`);
  await sleep(900);
  await shoot(cdp, "13-log-top");
  await scrollToElement(cdp, ".mdlog-widget", { block: "center" }).catch(() =>
    log("日志文档里没有交互块")
  );
  await sleep(700);
  await shoot(cdp, "14-log-widget");
  await shootPlate(cdp, "15-log-plate", ".document-scroll__content");
  cdp.ws.close();
  killVellum();

  log(`完成，共 ${saved} 张 → ${OUT}`);
}

await main();
