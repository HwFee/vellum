// 真机验收（CDP）：Obsidian 三族语法（frontmatter 属性卡 / wikilink / callout）在**打包后的
// WebView2** 里是否真的零残留，以及点一个库内链接能否加载目标笔记。
// 用法：node scripts/cdp-obsidian-verify.mjs [--file <md>] [--port 9222] [--keep]
// 前置：release exe 已构建（npm run tauri build）。脚本会**独占式**启动它：
// 先 taskkill 同名进程（并存实例的 WebView2 会污染读数，见 AGENTS.md 的性能探针约定），
// 跑完再点顶栏 ✕ 关窗（--keep 保留窗口）。
//
// 为何必须真机跑：jsdom 里渲染管线是同一套，但 WebView2 才有 CSP/ACL 与真实字体度量；
// 语料检查（scripts/check-obsidian-corpus.mjs）证明的是渲染结果，这里证明的是「打包后照旧」。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const NOTE = argOf("--file", "C:/Users/17445/Desktop/Wisdom/wiki/projects/checkin-archive/2026-07-17--2026-09-06.md");
const PORT = argOf("--port", "9222");
const EXE = argOf("--exe", "src-tauri/target/release/vellum.exe");
const KEEP = args.includes("--keep");
const LIST_URL = `http://127.0.0.1:${PORT}/json/list`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (label, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(label);
};

async function targets() {
  try {
    return await (await fetch(LIST_URL, { signal: AbortSignal.timeout(3000) })).json();
  } catch {
    return [];
  }
}

async function evaluate(send, expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text);
  return res.result?.result?.value;
}

if (!fs.existsSync(EXE)) {
  console.log(`FAIL  找不到 release exe：${EXE}（先跑 npm run tauri build）`);
  process.exit(1);
}
const source = fs.readFileSync(NOTE, "utf8");
/// 正文首行的大标题取自文件名（`fileNameToTitle` 只剥 .md）——真机断言的期望值
const expectedTitle = path.basename(NOTE).replace(/\.(md|markdown)$/i, "");
const expectedCallouts = source.split("\n").filter((line) => /^> \[![A-Za-z]/.test(line)).length;
const expectedFrontmatter = source.startsWith("---");

spawn("taskkill", ["/IM", "vellum.exe", "/F"], { stdio: "ignore" }).on("error", () => {});
await sleep(1200);

const child = spawn(EXE, [NOTE], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  detached: true,
  stdio: "ignore",
});
child.unref();
console.log(`[启动] ${EXE} ${NOTE}`);
console.log(`[语料] ${path.basename(NOTE)}：frontmatter=${expectedFrontmatter} callout 标记行=${expectedCallouts}`);

let page = null;
for (let attempt = 0; attempt < 40 && !page; attempt++) {
  await sleep(1000);
  page = (await targets()).find((target) => target.type === "page") ?? null;
}
if (!page) {
  console.log("FAIL  40 秒内没等到 page target（远程调试端口没起来）");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleLogs = [];
ws.addEventListener("message", (ev) => {
  const message = JSON.parse(ev.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else if (message.method === "Runtime.consoleAPICalled" || message.method === "Log.entryAdded") {
    consoleLogs.push(message);
  }
});
await new Promise((resolve) => ws.addEventListener("open", resolve));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
await send("Runtime.enable");
await send("Log.enable");

// 等文档渲染完（属性卡与正文都就位）
for (let attempt = 0; attempt < 30; attempt++) {
  const ready = await evaluate(
    send,
    `!!document.querySelector(".md-props") && (document.querySelector(".markdown-body")?.innerText ?? "").length > 200`
  );
  if (ready) break;
  await sleep(1000);
}

const report = await evaluate(
  send,
  `JSON.stringify({
    // 顶栏不再显示文件名（2026-09-18）：换文档的判据一律改用正文首行的大标题
    defunctTitle: document.querySelector(".top-bar__title")?.textContent ?? null,
    docTitle: document.querySelector("h1.document-title")?.textContent ?? null,
    cardStyle: (() => {
      const card = document.querySelector(".md-props");
      if (!card) return null;
      const style = getComputedStyle(card);
      return {
        background: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
        borderLeftWidth: style.borderLeftWidth,
        borderTopStyle: style.borderTopStyle,
      };
    })(),
    calloutStyle: (() => {
      const callout = document.querySelector("blockquote.callout");
      if (!callout) return null;
      const style = getComputedStyle(callout);
      return { background: style.backgroundColor, borderLeftWidth: style.borderLeftWidth };
    })(),
    card: !!document.querySelector(".md-props"),
    rows: document.querySelectorAll(".md-props__row").length,
    chips: document.querySelectorAll(".md-props__chip").length,
    relatedAnchors: document.querySelectorAll(".md-props__row--related a.wikilink").length,
    anchors: document.querySelectorAll("a.wikilink").length,
    missing: document.querySelectorAll(".wikilink--missing").length,
    callouts: document.querySelectorAll(".callout").length,
    calloutTypes: [...new Set([...document.querySelectorAll(".callout")].map((el) => el.dataset.callout))].sort(),
    titles: [...document.querySelectorAll(".callout__title")].slice(0, 3).map((el) => el.textContent),
    literalOpenBrackets: (document.body.innerText.match(/\\[\\[/g) ?? []).length,
    literalMarkers: (document.body.innerText.match(/\\[![a-z]/gi) ?? []).length,
    article: document.querySelector("article")?.className ?? null,
    units: document.querySelectorAll("[data-vellum-unit]").length,
    titleTop: (() => {
      const title = document.querySelector("h1.document-title");
      const bar = document.querySelector(".top-bar");
      if (!title || !bar) return null;
      return Math.round(title.getBoundingClientRect().top - bar.getBoundingClientRect().bottom);
    })(),
  })`
);
const state = JSON.parse(report);
console.log("[读数]", JSON.stringify(state, null, 2));

// 标题贴顶（2026-09-18）：正文区顶部留白 42px 由 :has() 规则给出；掉回 110px 说明那两条被删了
check(
  "标题贴着顶栏下方（不是正文原本的位置）",
  state.titleTop !== null && state.titleTop <= 60,
  `gap=${state.titleTop}px`
);
check("属性卡存在（frontmatter 不再是裸 YAML）", state.card === true);
check("属性卡有多行键值与 tags 项", state.rows >= 5 && state.chips >= 2, `rows=${state.rows} chips=${state.chips}`);
check("related 行是库内可点链接", state.relatedAnchors >= 1, `count=${state.relatedAnchors}`);
// 2026-09-18 定稿形态的真机证据：算出来的样式必须是「无底色 + 发丝线」，而不是只在源码里改了
check(
  "文档标题（inline title）取自文件名",
  state.docTitle === expectedTitle,
  `dom=${state.docTitle} 期望=${expectedTitle}`
);
check(
  "顶栏不再重复显示文件名（只报目录）",
  state.defunctTitle === null,
  `top-bar__title=${state.defunctTitle}`
);
// 边框宽度按**区间**判，不认死 1px / 2px：真机 DPI 缩放 150% 下 computed style 会把 1px
// 折算成 0.666667px（2px → 1.333…，实测本机就是这组数），死等式会在别人的机器上假红。
// 「有没有框」才是断言的本意：属性卡必须**没有左边框**、上边是一条细线。
const cardTopWidth = parseFloat(state.cardStyle?.borderTopWidth ?? "0");
check(
  "属性卡定稿形态：无底色、无左框，仅上边一条发丝线",
  state.cardStyle?.background === "rgba(0, 0, 0, 0)" &&
    state.cardStyle?.borderLeftWidth === "0px" &&
    state.cardStyle?.borderTopStyle === "solid" &&
    cardTopWidth > 0 &&
    cardTopWidth <= 1.5,
  JSON.stringify(state.cardStyle)
);
const calloutLeftWidth = parseFloat(state.calloutStyle?.borderLeftWidth ?? "0");
check(
  "提示块定稿形态：无底色 + 一道细竖线",
  state.calloutStyle?.background === "rgba(0, 0, 0, 0)" &&
    calloutLeftWidth >= 1.5 &&
    calloutLeftWidth <= 3,
  JSON.stringify(state.calloutStyle)
);
check("正文零字面 [[", state.literalOpenBrackets === 0, `count=${state.literalOpenBrackets}`);
check("正文零字面 [!type] 标记", state.literalMarkers === 0, `count=${state.literalMarkers}`);
check(
  "callout 全部换形且数量与语料一致",
  state.callouts === expectedCallouts && state.callouts > 0,
  `dom=${state.callouts} 语料=${expectedCallouts} 类型=${state.calloutTypes.join("/")}`
);
check("阅读视图不带块标记", state.units === 0, `units=${state.units}`);

// 点一个库内链接 → 目标笔记必须真的被加载（顶栏文件名换掉）
const clicked = await evaluate(
  send,
  `(() => {
     const anchor = [...document.querySelectorAll("a.wikilink[data-wikilink]")]
       .find((el) => (el.getAttribute("href") ?? "").startsWith("wikilink:"));
     if (!anchor) return "NO_ANCHOR";
     const target = anchor.getAttribute("data-wikilink");
     anchor.scrollIntoView({ block: "center" });
     anchor.click();
     return target;
   })()`
);
check("找得到可点的库内链接（不是降级纯文本）", clicked !== "NO_ANCHOR" && typeof clicked === "string", `target=${clicked}`);

if (typeof clicked === "string" && clicked !== "NO_ANCHOR") {
  // 判据是正文首行的大标题（顶栏自 2026-09-18 起不再显示文件名）
  const expectTitle = path.basename(clicked).replace(/\.(md|markdown)$/i, "");
  let after = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(500);
    after = await evaluate(
      send,
      `JSON.stringify({ docTitle: document.querySelector("h1.document-title")?.textContent ?? null,
                       text: (document.querySelector(".markdown-body")?.innerText ?? "").slice(0, 120) })`
    );
    if (JSON.parse(after).docTitle === expectTitle) break;
  }
  const afterState = JSON.parse(after);
  check(
    "点击 wikilink 打开了目标笔记",
    afterState.docTitle === expectTitle,
    `期望标题 ${expectTitle}，实到 ${afterState.docTitle}`
  );
}

const cspViolations = consoleLogs.filter((entry) => JSON.stringify(entry).includes("ipc.localhost")).length;
check("CSP 没拦 ipc.localhost（0 条违规）", cspViolations === 0, `count=${cspViolations}`);

if (!KEEP) {
  await evaluate(send, `document.querySelector("header button[aria-label='关闭']")?.click(), "closed"`);
  await sleep(2500);
  const left = (await targets()).filter((target) => target.type === "page").length;
  check("点 ✕ 后 page target 归零（窗口真的关了）", left === 0, `left=${left}`);
  if (left > 0) spawn("taskkill", ["/IM", "vellum.exe", "/F"], { stdio: "ignore" });
}

console.log(failures.length === 0 ? "\n真机验收：全部通过" : `\n真机验收：${failures.length} 项失败 → ${failures.join("；")}`);
process.exit(failures.length === 0 ? 0 : 1);
