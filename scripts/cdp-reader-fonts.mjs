// 真机验收（CDP）：字体三槽 + Ctrl+滚轮改字号。
// 前置：以 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 启动应用
// 用法：node scripts/cdp-reader-fonts.mjs
// 为何必须真机跑：① list_system_fonts 走 GDI，命令的 ACL / CSP 只在打包后的 WebView2 里暴露；
// ② 字体选择器是 fixed 定位的面板，「会不会被滚动容器裁掉」只有真机能判；
// ③ Ctrl+滚轮要验证的是 WebView2 有没有在正文缩放之外再叠一层整页缩放（devicePixelRatio 会变）。
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
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.result?.exceptionDetails) return `ERROR: ${res.result.exceptionDetails.text}`;
  return res.result?.result?.value;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/// 等条件成立（React 的状态提交不是同步的，固定睡一觉容易采到旧一帧）
async function waitFor(expression, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await wait(100);
  }
  return false;
}

await send("Runtime.enable");
await send("Log.enable");

// [1] 命令可达：GDI 枚举 + Tauri 命令注册 + ACL
console.log(
  "[1] list_system_fonts:",
  await evaluate(`(async () => {
    const fonts = await window.__TAURI_INTERNALS__.invoke("list_system_fonts");
    return JSON.stringify({
      count: fonts.length,
      cjk: fonts.filter((f) => f.cjk).length,
      mono: fonts.filter((f) => f.mono).length,
      hasSimSun: fonts.some((f) => f.name === "SimSun"),
      hasYahei: fonts.some((f) => f.name === "Microsoft YaHei"),
      vertical: fonts.filter((f) => f.name.startsWith("@")).length,
      sample: fonts.slice(0, 6).map((f) => f.name),
    });
  })()`)
);

// [2] 默认栈与拆分前一致：--font-latin 跟随中文槽，--serif 仍是楷体打头
console.log(
  "[2] 出厂字体栈:",
  await evaluate(`JSON.stringify({
    serif: getComputedStyle(document.documentElement).getPropertyValue("--serif").trim(),
    latin: getComputedStyle(document.documentElement).getPropertyValue("--font-latin").trim(),
    mono: getComputedStyle(document.documentElement).getPropertyValue("--mono").trim(),
    fontSize: getComputedStyle(document.documentElement).getPropertyValue("--reader-font-size").trim(),
    dpr: window.devicePixelRatio,
  })`)
);

// [3] 进设置视图（幂等：上一轮探针可能已经把它开着，再点一下反而会关掉）
const settingsWasOpen = await evaluate(`!!document.querySelector(".settings-view")`);
if (!settingsWasOpen) {
  await evaluate(`document.querySelector("header button[aria-label='阅读设置']").click(), "clicked"`);
  await waitFor(`!!document.querySelector(".settings-view")`);
}
// 把阅读一节滚到眼前：面板是锚在按钮上的，锚在视口外时量出来的位置没有意义
await evaluate(`document.getElementById("settings-section-reading").scrollIntoView({ block: "start" }), "scrolled"`);
await wait(300);
console.log(
  "[3] 设置视图:",
  await evaluate(`JSON.stringify({
    settingsOpen: !!document.querySelector(".settings-view"),
    rows: Array.from(document.querySelectorAll(".settings-view__label")).map((el) => el.textContent),
    value: document.querySelector(".font-picker__value")?.textContent ?? null,
    anchorRect: (() => { const r = document.querySelectorAll(".font-picker__value")[0].getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })(),
  })`)
);

// [4] 打开「中文字体」面板：真机看 fixed 定位有没有被滚动容器裁掉
await evaluate(`document.querySelectorAll(".font-picker__value")[0].click(), "clicked"`);
const panelOpened = await waitFor(`!!document.querySelector(".font-picker__panel")`);
console.log("[4] 面板出现:", panelOpened);
console.log(
  "[4b] 面板几何:",
  await evaluate(`(() => {
    const panel = document.querySelector(".font-picker__panel");
    if (!panel) return "NO_PANEL";
    const rect = panel.getBoundingClientRect();
    const scroller = document.querySelector(".document-scroll").getBoundingClientRect();
    const options = panel.querySelectorAll(".font-picker__option");
    return JSON.stringify({
      options: options.length,
      insideViewport: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth,
      rect: { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left) },
      scrollerBottom: Math.round(scroller.bottom),
      firstOption: options[0]?.textContent ?? null,
      sampleFontFamily: options[2]?.querySelector(".font-picker__option-name")?.style.fontFamily ?? null,
    });
  })()`)
);

// [5] 搜索框过滤（用本机真有的中文字体名）
const probeName = await evaluate(
  `(async () => {
    const fonts = await window.__TAURI_INTERNALS__.invoke("list_system_fonts");
    const cjk = fonts.filter((f) => f.cjk).map((f) => f.name);
    return cjk.find((n) => n === "宋体") ?? cjk.find((n) => n === "Microsoft YaHei") ?? cjk[0];
  })()`
);
console.log("[5] 取一款真机中文字体作为测试对象:", probeName);
await evaluate(`(() => {
  const input = document.querySelector(".font-picker__search");
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, ${JSON.stringify(probeName)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return "typed";
})()`);
await wait(300);
console.log(
  "[5b] 过滤结果:",
  await evaluate(`JSON.stringify(
    Array.from(document.querySelectorAll(".font-picker__option-name")).map((el) => el.textContent)
  )`)
);

// [6] 选中该字体 → 根变量应写成「字面 + 尾巴」，尾巴仍在 CSS 手里
await evaluate(`(() => {
  const target = Array.from(document.querySelectorAll(".font-picker__option")).find((el) => el.textContent.includes(${JSON.stringify(probeName)}));
  target.click();
  return "clicked";
})()`);
await waitFor(`!document.querySelector(".font-picker__panel")`);
console.log(
  "[6] 选中后:",
  await evaluate(`JSON.stringify({
    cjkVar: document.documentElement.style.getPropertyValue("--font-cjk"),
    serif: getComputedStyle(document.documentElement).getPropertyValue("--serif").trim(),
    pickerValue: document.querySelector(".font-picker__value")?.textContent ?? null,
    panelClosed: !document.querySelector(".font-picker__panel"),
  })`)
);

// [7] Ctrl + 滚轮：字号进一档，且不叠整页缩放
const wheel = async (deltaY) => {
  await send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 700,
    y: 400,
    deltaX: 0,
    deltaY,
    modifiers: 2, // Ctrl
  });
  await wait(400);
};
await wheel(-120);
console.log(
  "[7] Ctrl+滚轮向上:",
  await evaluate(`JSON.stringify({
    fontSize: getComputedStyle(document.documentElement).getPropertyValue("--reader-font-size").trim(),
    dpr: window.devicePixelRatio,
  })`)
);
await wheel(120);
console.log(
  "[8] Ctrl+滚轮向下（应回到原档）:",
  await evaluate(`JSON.stringify({
    fontSize: getComputedStyle(document.documentElement).getPropertyValue("--reader-font-size").trim(),
    dpr: window.devicePixelRatio,
  })`)
);
// 不按 Ctrl 的普通滚轮：字号不动、滚动容器照常动（先记一次，再比一次）
const plainBefore = await evaluate(
  `JSON.stringify({ fontSize: getComputedStyle(document.documentElement).getPropertyValue("--reader-font-size").trim(), scrollTop: Math.round(document.querySelector(".document-scroll").scrollTop) })`
);
await send("Input.dispatchMouseEvent", {
  type: "mouseWheel",
  x: 700,
  y: 400,
  deltaX: 0,
  deltaY: 120,
  modifiers: 0,
});
await wait(400);
console.log(
  "[9] 普通滚轮（字号必须不动；scrollTop 变化仅作参考——聚焦按钮本身会滚动容器）:",
  await evaluate(`JSON.stringify({
    fontSize: getComputedStyle(document.documentElement).getPropertyValue("--reader-font-size").trim(),
    scrollTop: Math.round(document.querySelector(".document-scroll").scrollTop),
  })`),
  "← 之前:",
  plainBefore
);

// [10] 恢复默认字面（把用户的 settings.json 放回原样）
await evaluate(`document.querySelectorAll(".font-picker__value")[0].click(), "clicked"`);
await waitFor(`!!document.querySelector(".font-picker__panel")`);
await evaluate(`(() => {
  const target = Array.from(document.querySelectorAll(".font-picker__option")).find((el) => el.textContent.includes("默认 · 倉頡楷體"));
  target.click();
  return "clicked";
})()`);
await wait(500);
console.log(
  "[10] 恢复默认字面:",
  await evaluate(`JSON.stringify({
    cjkVar: document.documentElement.style.getPropertyValue("--font-cjk"),
    hasInline: (document.documentElement.getAttribute("style") ?? "").includes("--font-cjk"),
  })`)
);

// [11] 关掉滚轮开关后，Ctrl+滚轮不该再改字号
const toggleOff = await evaluate(`(() => {
  const group = document.querySelector('.segments[aria-label="Ctrl + 滚轮改字号"]');
  group.querySelectorAll("button")[1].click();
  return "off";
})()`);
console.log("[11] 开关拨到「关」:", toggleOff);
await wait(400);
await wheel(-120);
console.log(
  "[11b] 开关关掉后 Ctrl+滚轮（字号应维持 14px）:",
  await evaluate(`JSON.stringify({
    fontSize: getComputedStyle(document.documentElement).getPropertyValue("--reader-font-size").trim(),
    dpr: window.devicePixelRatio,
  })`)
);
// 把开关拨回出厂态（开）
await evaluate(`(() => {
  const group = document.querySelector('.segments[aria-label="Ctrl + 滚轮改字号"]');
  group.querySelectorAll("button")[0].click();
  return "on";
})()`);
await wait(400);
console.log(
  "[11c] 拨回「开」后再滚（应进一档 16px）:",
  await (async () => {
    await wheel(-120);
    return evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--reader-font-size").trim()`);
  })()
);
// 字号复位到出厂档（Ctrl+0 那条快捷键本身也是真机验收的一部分）
await send("Input.dispatchKeyEvent", {
  type: "keyDown",
  key: "0",
  code: "Digit0",
  windowsVirtualKeyCode: 48,
  modifiers: 2,
});
await send("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "0",
  code: "Digit0",
  windowsVirtualKeyCode: 48,
  modifiers: 2,
});
await wait(400);
console.log(
  "[11d] Ctrl+0 复位:",
  await evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--reader-font-size").trim()`)
);

// 探针开始时设置视图是关的就把它关回去（不改动用户当下的界面状态）
if (!settingsWasOpen) {
  await evaluate(`document.querySelector("header button[aria-label='阅读设置']").click(), "clicked"`);
  await waitFor(`!document.querySelector(".settings-view")`);
}
console.log("[12] 退出设置视图（恢复探针前的状态）:", !(await evaluate(`!!document.querySelector(".settings-view")`)));

const aclErrors = logs.filter((entry) => JSON.stringify(entry).includes("not allowed by ACL"));
const ipcViolations = logs.filter((entry) => JSON.stringify(entry).includes("ipc.localhost"));
const fontWarnings = logs.filter((entry) => JSON.stringify(entry).includes("list_system_fonts"));
console.log("[13] ACL 拒绝条数（应为 0）:", aclErrors.length);
console.log("[14] ipc.localhost 违规条数（应为 0）:", ipcViolations.length);
console.log("[15] list_system_fonts 告警条数（应为 0）:", fontWarnings.length);

try {
  ws.close();
} catch {
  /* 连接自然断开 */
}
