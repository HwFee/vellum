#!/usr/bin/env node
/**
 * check-widgets.mjs — vellum-widget 契约的确定性检查（交互块 + 静态图一次过）
 *
 * 用法：node check-widgets.mjs <文章.md | 草稿.html>
 *   - .md：逐个抽出 ```vellum-widget 围栏逐块检查，并识别写错标识的围栏
 *   - .html：整份当作一个 widget（mdlog 记录态的草稿）
 *   - 文中含 <svg> 时，再调用同目录 svg-lint.mjs 做几何检查
 *
 * 退出码：任一「错误」→ 1；仅警告或全通过 → 0；用法错误 → 2
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MAX_BYTES = 524288; // 宿主 512KB 预检，超限降级成代码块
const LIVE_LIMIT = 10; // 全局最多 10 个存活 iframe，超出触发 LRU 休眠
const NEAR_MISS = new Set(["html", "widget", "vellum_widget", "vellum-widgets", "vellum", "vellumwidget"]);

const file = process.argv[2];
if (!file || file === "-h" || file === "--help") {
  console.log("用法: node check-widgets.mjs <文章.md|草稿.html>");
  process.exit(file ? 0 : 2);
}
const text = readFileSync(file, "utf8");

// ---------- 抽取 ----------
function extractFences(src) {
  const lines = src.split(/\r?\n/);
  const out = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!open) {
      const m = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/.exec(line);
      if (m) open = { ch: m[1][0], len: m[1].length, lang: m[2].toLowerCase(), start: i + 1, body: [] };
    } else {
      const m = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (m && m[1][0] === open.ch && m[1].length >= open.len) {
        out.push({ ...open, body: open.body.join("\n"), closed: true });
        open = null;
      } else open.body.push(line);
    }
  }
  if (open) out.push({ ...open, body: open.body.join("\n"), closed: false });
  return out;
}

const items = [];
const problems = []; // { level, where, msg }
const add = (level, where, msg) => problems.push({ level, where, msg });

if (file.toLowerCase().endsWith(".html")) {
  items.push({ where: "草稿", body: text, line: 1 });
} else {
  for (const f of extractFences(text)) {
    if (f.lang === "vellum-widget") {
      const where = `交互块（第 ${f.start} 行）`;
      if (!f.closed) add("错误", where, "围栏没有闭合");
      items.push({ where, body: f.body, line: f.start });
    } else if (NEAR_MISS.has(f.lang) && /<!doctype html/i.test(f.body)) {
      add("错误", `第 ${f.start} 行`, `围栏标识「${f.lang}」写错，会渲染成普通代码块：应逐字写 vellum-widget（契约 1）`);
    }
  }
}

if (items.length === 0 && problems.length === 0) {
  console.log("没有找到 vellum-widget 围栏。");
  process.exit(0);
}

// ---------- 逐块检查 ----------
const interactiveOf = (html) => {
  const s = html.replace(/\(function\s*\(\s*\)\s*\{[\s\S]*?vellum-widget:resize[\s\S]*?\}\s*\)\s*\(\s*\)\s*;?/g, "");
  return (
    /<script\b[^>]*>\s*\S[\s\S]*?<\/script\s*>/i.test(s) ||
    /\son[a-z]+\s*=/i.test(s) ||
    /<(button|input|select|textarea|details|summary|canvas|video|audio)\b/i.test(s) ||
    /<a\b[^>]*\bhref\s*=/i.test(s)
  );
};
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

let interactiveCount = 0;
for (const it of items) {
  const { where, body } = it;
  const code = stripComments(body);
  const E = (m) => add("错误", where, m);
  const W = (m) => add("警告", where, m);

  if (!/^\s*<!doctype html/i.test(body)) E("须以 <!DOCTYPE html> 开头（契约 2）");
  if (!/<\/html>\s*$/i.test(body.trim())) E("没有以 </html> 结尾：围栏可能被内部反引号提前截断（契约 1）");
  if (Buffer.byteLength(body, "utf8") > MAX_BYTES) E("超过 512KB，宿主会降级成代码块");
  if (!body.includes('"vellum-widget:resize"') && !body.includes("'vellum-widget:resize'"))
    E("缺通信 IIFE：高度会坍缩（契约 5，照抄 assets 模板）");
  else if (!/addEventListener\(\s*["']load["']/.test(body) || !body.includes("ResizeObserver"))
    E("通信 IIFE 不完整：须含 load 监听与 ResizeObserver（契约 5）");

  for (const api of ["localStorage", "sessionStorage", "indexedDB", "document.cookie"])
    if (code.includes(api)) E(`用了 ${api}：Opaque Origin 下会抛 SecurityError 让脚本崩掉（契约 3）`);
  if (/https?:\/\/(?!www\.w3\.org\/)/i.test(code)) E("含外部 URL：CSP 会拦，须全部内联（契约 2）");
  if (/<script[^>]+\bsrc\s*=|<link\b|@import\b|\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource/i.test(code))
    E("含外部请求/外链资源：CSP 全拦（契约 2）");
  if (/<img\b[^>]+src\s*=\s*["'](?!data:)/i.test(code)) E("<img> 只能用 data: 源（契约 2）");
  if (!code.includes("prefers-reduced-motion")) E("缺 @media (prefers-reduced-motion: reduce) 豁免（契约 4）");

  if (!/#faf9f5/i.test(code)) W("没有象牙底 #faf9f5：确认 body 用了 kami token（契约 4）");
  if (!/TsangerJinKai02/.test(code) && /<(p|div|span|text|body)\b/.test(code)) W("没有照抄衬线字体栈（契约 4）");
  if (/font-weight\s*[:=]\s*["']?(600|700|800|900|bold)/i.test(code)) W("字重超过 500（契约 4）");
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(code)) W("含 emoji：换发丝线 SVG 或汉字（契约 4）");
  for (const m of code.matchAll(/font-size\s*[:=]\s*["']?(\d+(?:\.\d+)?)/g))
    if (Number(m[1]) < 12.5) { W(`字号 ${m[1]}px 低于下限 12.5px（契约 4）`); break; }
  if (/\bcanvas\b/i.test(code) && !/addEventListener\(\s*["']resize["']/.test(code))
    W("有 canvas 但没监听 window resize：变宽后画面会模糊（契约 5）");
  if (/requestAnimationFrame/.test(code) && !/\b(33|34|40|50|66|100)\b/.test(code))
    W("用了 rAF：确认已按 ≥33ms 节流（契约 4 帧预算）");
  if (/setInterval\s*\(/.test(code)) W("setInterval：优先 CSS 动画；确认间隔 ≥33ms 且离屏不空转（契约 4）");
  if (/\bheight\s*:\s*100vh|min-height\s*:\s*100vh/i.test(code)) W("100vh 会与 iframe 高度上报互相撑大（契约 5）");

  if (interactiveOf(body)) interactiveCount++;
}

if (items.length > LIVE_LIMIT)
  add("警告", "全文", `共 ${items.length} 个 widget，超过存活上限 ${LIVE_LIMIT}：滚动时会休眠，回视野才恢复（契约 7）`);
if (interactiveCount > 1)
  add("警告", "全文", `共 ${interactiveCount} 个交互块：单次产出建议至多 1 个，其余改静态图（SKILL §3）`);

// ---------- 报告 ----------
for (const p of problems) console.log(`[${p.level}] ${p.where}：${p.msg}`);
const errors = problems.filter((p) => p.level === "错误").length;
const warns = problems.length - errors;
console.log(`契约检查：${items.length} 个 widget（交互 ${interactiveCount}）· ${errors} 错误 / ${warns} 警告`);

let failed = errors > 0;
if (/<svg\b/i.test(text)) {
  const lint = path.join(path.dirname(fileURLToPath(import.meta.url)), "svg-lint.mjs");
  const r = spawnSync(process.execPath, [lint, file], { encoding: "utf8" });
  process.stdout.write("\n[svg-lint]\n" + (r.stdout || "") + (r.stderr || ""));
  if (r.status === 1) failed = true;
}
process.exit(failed ? 1 : 0);
