#!/usr/bin/env node
/**
 * svg-lint.mjs — vellum-widget 静态 SVG 图几何检查（契约 6 的确定性兜底）
 *
 * 用法：node svg-lint.mjs <文件.html | 文件.svg | ->
 *   - 传入完整 HTML 时自动提取全部 <svg> 块，并解析 <style> 中的 font-size 规则
 *   - 传入 "-" 时从 stdin 读取
 *
 * 退出码：存在「错误」级问题 → 1；仅警告或全部通过 → 0
 *
 * 检查项：
 *   [错误] 框内文字估算宽度超出框（字超框 / 溢出）
 *   [错误] 文字与文字估算 bbox 重叠
 *   [错误] 字号 < 12.5px
 *   [警告] 宽 < 56px 小图元内塞多字符标签（应放形外）
 *   [警告] 文字骑压框线（未垫底的骑线标签）
 *   [警告] 连线/折线穿过文字 bbox
 *   [警告] 图元越出 viewBox
 *   [警告] 12.5px ≤ 字号 < 15px（图注可忽略，标注应 ≥15px）
 *
 * 宽度估算（保守方向：宁可误报加宽，不放过溢出）：
 *   CJK/全角/箭头符号 1.0em，大写 0.68em，数字 0.62em，希腊字母 0.65em，
 *   小写 0.52em（m/w 0.80em），窄符号 0.36em，空格 0.30em，其他 0.60em，整体 ×1.06
 */

import { readFileSync } from "node:fs";

// ---------- 入口 ----------

function main() {
  const arg = process.argv[2];
  if (!arg || arg === "-h" || arg === "--help") {
    console.log("用法: node svg-lint.mjs <文件.html|文件.svg|->");
    process.exit(arg ? 0 : 2);
  }
  const content = arg === "-" ? readFileSync(0, "utf8") : readFileSync(arg, "utf8");

  const cssRules = parseCssRules(extractStyleTexts(content));
  const svgBlocks = extractSvgBlocks(content);
  if (svgBlocks.length === 0) {
    console.error("svg-lint: 未找到 <svg> 块");
    process.exit(2);
  }

  const issues = [];
  let assumedFontCount = 0;
  svgBlocks.forEach((src, idx) => {
    const scene = { rules: cssRules, issues, svgIndex: idx, boxes: [], texts: [], segments: [], viewBox: null };
    const tree = parseXml(src);
    // 根 svg 的 viewBox
    const svgEl = findFirst(tree, "svg");
    if (svgEl) scene.viewBox = parseViewBox(svgEl.attrs);
    walk(tree, { fontSize: null, transform: IDENTITY }, scene);
    assumedFontCount += scene.assumedFonts || 0;
    checkScene(scene);
  });

  // 输出
  const errors = issues.filter((i) => i.level === "错误");
  const warnings = issues.filter((i) => i.level === "警告");
  const many = svgBlocks.length > 1;
  for (const it of issues) {
    const loc = many ? `[svg#${it.svg}] ` : "";
    console.log(`[${it.level}] ${loc}${it.msg}`);
  }
  if (assumedFontCount > 0) {
    console.log(`[提示] ${assumedFontCount} 处文字未解析到字号，按 16px 估算`);
  }
  console.log(`\n结果：${errors.length} 错误 / ${warnings.length} 警告 ${errors.length ? "→ 未通过" : "→ 通过"}`);
  process.exit(errors.length ? 1 : 0);
}

// ---------- <svg> 块提取 ----------

function extractSvgBlocks(content) {
  const blocks = [];
  const re = /<svg\b|<\/svg\s*>/gi;
  let m, depth = 0, start = -1;
  while ((m = re.exec(content))) {
    if (m[0][1] === "/") {
      depth--;
      if (depth === 0 && start >= 0) {
        blocks.push(content.slice(start, re.lastIndex));
        start = -1;
      }
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return blocks;
}

// ---------- CSS（实用子集：tag / .class / #id / 后代选择器，只取 font-size 与 :root 变量） ----------

function extractStyleTexts(html) {
  const out = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out.join("\n");
}

function parseCssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = []; // {parts:[compound], spec:[i,c,t], fontSize:{kind:'px'|'em',v}}
  const rootProps = {};
  let i = 0;
  while (i < text.length) {
    const brace = text.indexOf("{", i);
    if (brace < 0) break;
    const prelude = text.slice(i, brace).trim();
    // 找配对 }
    let depth = 1, j = brace + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(brace + 1, j - 1);
    i = j;
    if (!prelude || prelude.startsWith("@")) continue; // @media/@font-face 整块跳过
    // 解析声明
    const decls = {};
    for (const d of body.split(";")) {
      const ci = d.indexOf(":");
      if (ci < 0) continue;
      decls[d.slice(0, ci).trim()] = d.slice(ci + 1).trim();
    }
    for (const sel of prelude.split(",")) {
      const s = sel.trim();
      if (!s) continue;
      if (s === ":root" || s === "html") {
        for (const [k, v] of Object.entries(decls)) if (k.startsWith("--")) rootProps[k] = v;
        // :root 上的 font-size 也会继承给 svg，按 tag 级处理
      }
      const fsRaw = decls["font-size"];
      if (!fsRaw) continue;
      const fs = parseFontSizeValue(fsRaw, rootProps);
      if (!fs) continue;
      const parts = s.split(/\s*>\s*|\s+/).filter(Boolean).map(parseCompound);
      if (parts.some((p) => !p)) continue;
      let spec = [0, 0, 0];
      for (const p of parts) spec = [spec[0] + p.spec[0], spec[1] + p.spec[1], spec[2] + p.spec[2]];
      rules.push({ parts, spec, fontSize: fs, order: rules.length });
    }
  }
  return { rules, rootProps };
}

function parseCompound(s) {
  if (s === "*") return { tag: "*", classes: [], ids: [], spec: [0, 0, 0] };
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(s);
  if (!m) return null;
  const tag = m[1] ? m[1].toLowerCase() : null;
  const classes = [], ids = [];
  const re = /([.#])([\w-]+)/g;
  let mm;
  while ((mm = re.exec(m[2] || ""))) (mm[1] === "." ? classes : ids).push(mm[2]);
  return { tag, classes, ids, spec: [ids.length, classes.length, tag ? 1 : 0] };
}

function parseFontSizeValue(v, rootProps) {
  let s = v.trim();
  const varM = /^var\((--[\w-]+)\)$/.exec(s);
  if (varM) {
    s = (rootProps[varM[1]] || "").trim();
    if (!s) return null;
  }
  let m = /^([\d.]+)px$/.exec(s) || /^([\d.]+)$/.exec(s);
  if (m) return { kind: "px", v: parseFloat(m[1]) };
  m = /^([\d.]+)(em|rem)$/.exec(s);
  if (m) return { kind: "em", v: parseFloat(m[1]) };
  return null;
}

// 元素是否匹配一条 CSS 规则（简化后代匹配）
function matchRule(el, rule) {
  const chain = [];
  for (let n = el; n; n = n.parent) if (n.tag && n.tag[0] !== "#") chain.push(n);
  let idx = 0; // chain 下标（0 = 元素自身）
  for (let p = rule.parts.length - 1; p >= 0; p--) {
    const comp = rule.parts[p];
    let found = -1;
    for (let k = idx; k < chain.length; k++) {
      if (matchCompound(chain[k], comp)) { found = k; break; }
    }
    if (found < 0) return false;
    if (p === rule.parts.length - 1 && found !== 0) return false; // 最后一段必须命中元素自身
    idx = found + 1;
  }
  return true;
}

function matchCompound(el, comp) {
  if (comp.tag && comp.tag !== "*" && el.tag !== comp.tag) return false;
  const cls = (el.attrs.class || "").split(/\s+/).filter(Boolean);
  for (const c of comp.classes) if (!cls.includes(c)) return false;
  for (const id of comp.ids) if (el.attrs.id !== id) return false;
  return true;
}

// ---------- 极简 XML 解析 ----------

function parseXml(src) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[^>]+>|[^<]+/g;
  let m;
  while ((m = re.exec(src))) {
    const tok = m[0];
    if (tok.startsWith("<!--") || tok.startsWith("<!") || tok.startsWith("<?")) continue;
    if (tok.startsWith("</")) {
      const name = tok.slice(2, -1).trim().toLowerCase();
      // 宽松回退到匹配标签
      let n = cur;
      while (n !== root && n.tag !== name) n = n.parent;
      if (n !== root) cur = n.parent;
      continue;
    }
    if (tok.startsWith("<")) {
      const selfClose = /\/>$/.test(tok);
      const inner = tok.slice(1, tok.length - (selfClose ? 2 : 1));
      const sp = inner.search(/[\s/]/);
      const name = (sp < 0 ? inner : inner.slice(0, sp)).toLowerCase();
      const attrStr = sp < 0 ? "" : inner.slice(sp);
      const attrs = {};
      const are = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let am;
      while ((am = are.exec(attrStr))) attrs[am[1].toLowerCase()] = decodeEntities(am[2] ?? am[3] ?? "");
      const el = { tag: name, attrs, children: [], parent: cur };
      cur.children.push(el);
      if (!selfClose) cur = el;
      continue;
    }
    // 文本节点
    cur.children.push({ tag: "#text", text: decodeEntities(tok), parent: cur, attrs: {}, children: [] });
  }
  return root;
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function findFirst(node, tag) {
  if (node.tag === tag) return node;
  for (const c of node.children || []) {
    const r = findFirst(c, tag);
    if (r) return r;
  }
  return null;
}

// ---------- 几何：变换矩阵与图形收集 ----------

const IDENTITY = [1, 0, 0, 1, 0, 0];
function matMul(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
function applyMat(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function parseTransform(s) {
  if (!s) return IDENTITY;
  let m = IDENTITY;
  const re = /(translate|scale|matrix|rotate)\s*\(([^)]*)\)/g;
  let mm;
  while ((mm = re.exec(s))) {
    const nums = mm[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t = IDENTITY;
    if (mm[1] === "translate") t = [1, 0, 0, 1, nums[0] || 0, nums[1] || 0];
    else if (mm[1] === "scale") t = [nums[0] ?? 1, 0, 0, nums[1] ?? nums[0] ?? 1, 0, 0];
    else if (mm[1] === "matrix" && nums.length === 6) t = nums;
    else if (mm[1] === "rotate") {
      const r = ((nums[0] || 0) * Math.PI) / 180, c = Math.cos(r), si = Math.sin(r);
      t = [c, si, -si, c, 0, 0];
      if (nums.length === 3) {
        t = matMul(matMul([1, 0, 0, 1, nums[1], nums[2]], t), [1, 0, 0, 1, -nums[1], -nums[2]]);
      }
    }
    m = matMul(m, t);
  }
  return m;
}
function bboxOfPoints(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
function rectBBox(attrs, m) {
  const x = num(attrs.x), y = num(attrs.y), w = num(attrs.width), h = num(attrs.height);
  if (!(w > 0) || !(h > 0)) return null;
  return bboxOfPoints([applyMat(m, x, y), applyMat(m, x + w, y), applyMat(m, x, y + h), applyMat(m, x + w, y + h)]);
}
function num(v, d = 0) {
  if (v == null || v === "") return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function parseViewBox(attrs) {
  if (attrs.viewbox) {
    const p = attrs.viewbox.split(/[\s,]+/).map(Number);
    if (p.length === 4 && p.every(Number.isFinite)) return { x0: p[0], y0: p[1], x1: p[0] + p[2], y1: p[1] + p[3] };
  }
  const w = parseFloat(attrs.width), h = parseFloat(attrs.height);
  if (Number.isFinite(w) && Number.isFinite(h)) return { x0: 0, y0: 0, x1: w, y1: h };
  return null;
}

// 收集 rect/circle/ellipse/text/line/polyline/polygon/path
function walk(node, ctx, scene) {
  for (const el of node.children || []) {
    if (el.tag === "#text") continue;
    if (["defs", "style", "title", "desc", "script", "metadata"].includes(el.tag)) continue;

    // 计算字号：内联 style > CSS 规则 > 表现属性 > 继承
    let fontSize = ctx.fontSize;
    let ownFs = null;
    if (el.attrs.style) {
      const m = /font-size\s*:\s*([^;]+)/.exec(el.attrs.style);
      if (m) {
        const v = parseFontSizeValue(m[1], scene.rules.rootProps);
        if (v) ownFs = v.kind === "px" ? v.v : v.v * (ctx.fontSize || 16);
      }
    }
    if (ownFs == null) {
      let best = null;
      for (const rule of scene.rules.rules) {
        if (!matchRule(el, rule)) continue;
        if (!best || cmpSpec(rule.spec, best.spec) > 0 || (cmpSpec(rule.spec, best.spec) === 0 && rule.order > best.order)) {
          best = rule;
        }
      }
      if (best) ownFs = best.fontSize.kind === "px" ? best.fontSize.v : best.fontSize.v * (ctx.fontSize || 16);
    }
    if (ownFs == null && el.attrs["font-size"]) {
      const v = parseFontSizeValue(el.attrs["font-size"], scene.rules.rootProps);
      if (v) ownFs = v.kind === "px" ? v.v : v.v * (ctx.fontSize || 16);
    }
    if (ownFs != null) fontSize = ownFs;

    const transform = matMul(ctx.transform, parseTransform(el.attrs.transform));
    const childCtx = { fontSize, transform };

    if (el.tag === "rect") {
      const bb = rectBBox(el.attrs, transform);
      if (bb && isVisible(el)) {
        scene.boxes.push({ kind: "rect", bb, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0, el });
      }
    } else if (el.tag === "circle" || el.tag === "ellipse") {
      const cx = num(el.attrs.cx), cy = num(el.attrs.cy);
      const rx = el.tag === "circle" ? num(el.attrs.r) : num(el.attrs.rx);
      const ry = el.tag === "circle" ? num(el.attrs.r) : num(el.attrs.ry);
      if (rx > 0 && ry > 0 && isVisible(el)) {
        const bb = bboxOfPoints([applyMat(transform, cx - rx, cy - ry), applyMat(transform, cx + rx, cy + ry)]);
        scene.boxes.push({ kind: "ellipse", bb, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0, rx, ry, el });
      }
    } else if (el.tag === "text") {
      collectText(el, childCtx, scene);
    } else if (el.tag === "line") {
      const p1 = applyMat(transform, num(el.attrs.x1), num(el.attrs.y1));
      const p2 = applyMat(transform, num(el.attrs.x2), num(el.attrs.y2));
      scene.segments.push([p1, p2]);
    } else if (el.tag === "polyline" || el.tag === "polygon") {
      const pts = (el.attrs.points || "").trim().split(/[\s,]+/).map(Number);
      const pp = [];
      for (let k = 0; k + 1 < pts.length; k += 2) pp.push(applyMat(transform, pts[k], pts[k + 1]));
      for (let k = 0; k + 1 < pp.length; k++) scene.segments.push([pp[k], pp[k + 1]]);
      if (el.tag === "polygon" && pp.length > 2) scene.segments.push([pp[pp.length - 1], pp[0]]);
    } else if (el.tag === "path") {
      for (const seg of pathStraightSegments(el.attrs.d || "", transform)) scene.segments.push(seg);
    }

    walk(el, childCtx, scene);
  }
}

function cmpSpec(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function isVisible(el) {
  const fill = (el.attrs.fill || "").trim().toLowerCase();
  const stroke = (el.attrs.stroke || "").trim().toLowerCase();
  if (el.attrs.display === "none" || el.attrs.visibility === "hidden") return false;
  if (fill === "none" && (stroke === "" || stroke === "none")) return false;
  if (el.attrs.opacity === "0") return false;
  return true;
}

// ---------- 文字行提取（含 tspan 多行） ----------

function collectText(el, ctx, scene) {
  const fs = ctx.fontSize || 16;
  if (ctx.fontSize == null) scene.assumedFonts = (scene.assumedFonts || 0) + 1;
  const anchor = (el.attrs["text-anchor"] || "start").trim();
  const baseline = (el.attrs["dominant-baseline"] || (el.attrs.style && /dominant-baseline\s*:\s*([\w-]+)/.exec(el.attrs.style)?.[1]) || "").trim();

  // 行：{text, x, y}；x/y 为 SVG 用户坐标（未变换）
  const lines = [];
  let cur = { text: "", x: num(el.attrs.x), y: num(el.attrs.y), hasPos: true };
  const pushLine = () => {
    const t = cur.text.replace(/\s+/g, " ").trim();
    if (t) lines.push({ text: t, x: cur.x, y: cur.y });
    cur.text = "";
  };
  const visit = (node) => {
    for (const c of node.children || []) {
      if (c.tag === "#text") {
        cur.text += c.text;
      } else if (c.tag === "tspan") {
        const hasX = c.attrs.x != null, hasY = c.attrs.y != null, hasDy = c.attrs.dy != null;
        if (hasX || hasY || hasDy) {
          pushLine();
          if (hasX) cur.x = num(c.attrs.x);
          if (hasY) cur.y = num(c.attrs.y);
          if (hasDy) cur.y += parseLengthEm(c.attrs.dy, fs);
        }
        visit(c);
      } else {
        visit(c);
      }
    }
  };
  visit(el);
  pushLine();

  for (const ln of lines) {
    const w = estimateWidth(ln.text, fs);
    const [tx, ty] = applyMat(ctx.transform, ln.x, ln.y);
    const x0 = anchor === "middle" ? tx - w / 2 : anchor === "end" ? tx - w : tx;
    let top, bottom;
    if (baseline === "middle" || baseline === "central") { top = ty - 0.42 * fs; bottom = ty + 0.42 * fs; }
    else if (baseline === "hanging" || baseline === "text-before-edge") { top = ty; bottom = ty + 0.95 * fs; }
    else { top = ty - 0.78 * fs; bottom = ty + 0.24 * fs; }
    scene.texts.push({ text: ln.text, fs, bb: { x0, y0: top, x1: x0 + w, y1: bottom }, cx: x0 + w / 2, cy: (top + bottom) / 2 });
  }
}

function parseLengthEm(v, fs) {
  const s = String(v).trim();
  const m = /^(-?[\d.]+)(em|px)?$/.exec(s);
  if (!m) return 0;
  return m[2] === "em" ? parseFloat(m[1]) * fs : parseFloat(m[1]);
}

function estimateWidth(text, fs) {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * fs * 1.06;
}

function charEm(ch) {
  const cp = ch.codePointAt(0);
  if (cp === 0x20 || cp === 0xa0) return 0.3;
  if (cp >= 0x2e80) return 1.0;                     // CJK、全角、扩展
  if (cp >= 0x2190 && cp <= 0x2bff) return 1.0;     // 箭头/符号常走 CJK 回退
  if (cp >= 0x370 && cp <= 0x3ff) return 0.65;      // 希腊字母
  if (cp >= 0x30 && cp <= 0x39) return 0.62;        // 数字
  if (cp >= 0x41 && cp <= 0x5a) return 0.68;        // 大写
  if (ch === "m" || ch === "w") return 0.8;
  if ("iljtf.,:;'\"!|()[]{}/\\-`°".includes(ch)) return 0.36;
  if (cp >= 0x61 && cp <= 0x7a) return 0.52;        // 小写
  return 0.6;
}

// ---------- path 直线段提取（曲线取弦近似） ----------

function pathStraightSegments(d, m) {
  const tokens = d.match(/[MmLlHhVvZzCcSsQqTtAa]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) || [];
  const segs = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = "";
  const readN = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) { cmd = tokens[i++]; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "M") {
      const x = readN(), y = readN();
      cx = rel ? cx + x : x; cy = rel ? cy + y : y; sx = cx; sy = cy;
      cmd = rel ? "l" : "L"; // 后续隐式 L
    } else if (C === "L") {
      const x = readN(), y = readN();
      const nx = rel ? cx + x : x, ny = rel ? cy + y : y;
      segs.push([applyMat(m, cx, cy), applyMat(m, nx, ny)]);
      cx = nx; cy = ny;
    } else if (C === "H") {
      const x = readN();
      const nx = rel ? cx + x : x;
      segs.push([applyMat(m, cx, cy), applyMat(m, nx, cy)]);
      cx = nx;
    } else if (C === "V") {
      const y = readN();
      const ny = rel ? cy + y : y;
      segs.push([applyMat(m, cx, cy), applyMat(m, cx, ny)]);
      cy = ny;
    } else if (C === "Z") {
      segs.push([applyMat(m, cx, cy), applyMat(m, sx, sy)]);
      cx = sx; cy = sy;
    } else if (C === "C" || C === "S" || C === "Q" || C === "T" || C === "A") {
      const need = C === "C" ? 6 : C === "S" || C === "Q" ? 4 : C === "A" ? 7 : 2;
      const vals = [];
      for (let k = 0; k < need; k++) vals.push(readN());
      const nx = rel ? cx + vals[need - 2] : vals[need - 2];
      const ny = rel ? cy + vals[need - 1] : vals[need - 1];
      segs.push([applyMat(m, cx, cy), applyMat(m, nx, ny)]); // 弦近似
      cx = nx; cy = ny;
    } else {
      i++;
    }
  }
  return segs;
}

// ---------- 检查 ----------

function issue(scene, level, msg) {
  scene.issues.push({ level, msg, svg: scene.svgIndex + 1, svgCount: 0 });
}
const fmt = (n) => Math.round(n);
const clip = (s, n = 26) => (s.length > n ? s.slice(0, n) + "…" : s);

function checkScene(scene) {
  const { boxes, texts, segments, viewBox } = scene;

  for (const t of texts) {
    // E3/W5 字号
    if (t.fs < 12.5) issue(scene, "错误", `字号 ${t.fs}px < 12.5px："${clip(t.text)}" @ (${fmt(t.cx)}, ${fmt(t.cy)})`);
    else if (t.fs < 15) issue(scene, "警告", `字号 ${t.fs}px < 15px（图注可忽略）："${clip(t.text)}" @ (${fmt(t.cx)}, ${fmt(t.cy)})`);

    // 所属容器：与文字 bbox 重叠面积 > 50% 的最小 box
    const tArea = Math.max(1, (t.bb.x1 - t.bb.x0) * (t.bb.y1 - t.bb.y0));
    let owner = null;
    for (const b of boxes) {
      const ow = Math.min(t.bb.x1, b.bb.x1) - Math.max(t.bb.x0, b.bb.x0);
      const oh = Math.min(t.bb.y1, b.bb.y1) - Math.max(t.bb.y0, b.bb.y0);
      if (ow > 0 && oh > 0 && ow * oh > 0.5 * tArea) {
        if (!owner || b.w * b.h < owner.w * owner.h) owner = b;
      }
    }

    if (owner) {
      const tw = t.bb.x1 - t.bb.x0, th = t.bb.y1 - t.bb.y0;
      const isBadge = owner.w <= tw + 16 && owner.h <= t.fs * 2.0;
      if (isBadge) {
        // 垫底徽章：文字不得露出徽章
        if (t.bb.x0 < owner.bb.x0 - 2 || t.bb.x1 > owner.bb.x1 + 2 || t.bb.y0 < owner.bb.y0 - 2 || t.bb.y1 > owner.bb.y1 + 2) {
          issue(scene, "错误", `文字露出垫底徽章："${clip(t.text)}" 文字 bbox (${fmt(t.bb.x0)},${fmt(t.bb.y0)})-(${fmt(t.bb.x1)},${fmt(t.bb.y1)})，徽章 (${fmt(owner.bb.x0)},${fmt(owner.bb.y0)})-(${fmt(owner.bb.x1)},${fmt(owner.bb.y1)})`);
        }
      } else {
        // 容器：横向可用宽 = 框宽 − 2×12 内边距（椭圆内接按 0.85 弦宽）
        const usable = owner.kind === "ellipse" ? owner.w * 0.85 : owner.w - 2 * 12;
        if (tw > usable) {
          issue(scene, "错误", `文字超框："${clip(t.text)}" 估算宽 ${fmt(tw)}px > 框可用宽 ${fmt(usable)}px（框宽 ${fmt(owner.w)}px）@ (${fmt(t.cx)}, ${fmt(t.cy)})`);
        }
        if (t.bb.y0 < owner.bb.y0 - 4 || t.bb.y1 > owner.bb.y1 + 4) {
          issue(scene, "错误", `文字纵向溢出框："${clip(t.text)}" 文字纵向 (${fmt(t.bb.y0)}~${fmt(t.bb.y1)})，框纵向 (${fmt(owner.bb.y0)}~${fmt(owner.bb.y1)})`);
        }
        // W1 小图元多字符
        if (owner.w < 56 && tw > t.fs * 1.2) {
          issue(scene, "警告", `小图元（宽 ${fmt(owner.w)}px < 56px）内多字符标签："${clip(t.text)}"——应移到形外（契约 6-4）`);
        }
      }
    }

    // W2 骑压框线：中心不在框内，但 bbox 与框边线相交（bbox 先内缩 2px 防视觉间隙误报）
    const rideBB = { x0: t.bb.x0 + 2, y0: t.bb.y0 + 2, x1: t.bb.x1 - 2, y1: t.bb.y1 - 2 };
    for (const b of boxes) {
      if (owner === b) continue;
      const inside = t.cx >= b.bb.x0 && t.cx <= b.bb.x1 && t.cy >= b.bb.y0 && t.cy <= b.bb.y1;
      if (inside) continue;
      const edges = [
        [[b.bb.x0, b.bb.y0], [b.bb.x1, b.bb.y0]],
        [[b.bb.x0, b.bb.y1], [b.bb.x1, b.bb.y1]],
        [[b.bb.x0, b.bb.y0], [b.bb.x0, b.bb.y1]],
        [[b.bb.x1, b.bb.y0], [b.bb.x1, b.bb.y1]],
      ];
      if (rideBB.x1 > rideBB.x0 && rideBB.y1 > rideBB.y0 && edges.some(([p, q]) => segHitsBBox(p, q, rideBB, 0))) {
        issue(scene, "警告", `文字骑压框线："${clip(t.text)}" @ (${fmt(t.cx)}, ${fmt(t.cy)}) 与框 (${fmt(b.bb.x0)},${fmt(b.bb.y0)})-(${fmt(b.bb.x1)},${fmt(b.bb.y1)}) 边线相交——应垫底或错开（契约 6-3）`);
      }
    }

    // W4 viewBox 越界
    if (viewBox && (t.bb.x0 < viewBox.x0 - 0.5 || t.bb.x1 > viewBox.x1 + 0.5 || t.bb.y0 < viewBox.y0 - 0.5 || t.bb.y1 > viewBox.y1 + 0.5)) {
      issue(scene, "警告", `文字越出 viewBox："${clip(t.text)}" bbox (${fmt(t.bb.x0)},${fmt(t.bb.y0)})-(${fmt(t.bb.x1)},${fmt(t.bb.y1)})`);
    }
  }

  // E2 文字重叠
  for (let a = 0; a < texts.length; a++) {
    for (let b = a + 1; b < texts.length; b++) {
      const A = texts[a].bb, B = texts[b].bb;
      const ow = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
      const oh = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (ow > 2 && oh > 2) {
        issue(scene, "错误", `文字重叠："${clip(texts[a].text)}" 与 "${clip(texts[b].text)}" bbox 相交 ${fmt(ow)}×${fmt(oh)}px @ (${fmt((Math.max(A.x0, B.x0) + Math.min(A.x1, B.x1)) / 2)}, ${fmt((Math.max(A.y0, B.y0) + Math.min(A.y1, B.y1)) / 2)})`);
      }
    }
  }

  // W3 连线穿字
  for (const t of texts) {
    const shrunk = { x0: t.bb.x0 + 2, y0: t.bb.y0 + 2, x1: t.bb.x1 - 2, y1: t.bb.y1 - 2 };
    if (shrunk.x1 <= shrunk.x0 || shrunk.y1 <= shrunk.y0) continue;
    for (const [p, q] of segments) {
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 3) continue;
      if (segHitsBBox(p, q, shrunk, 0)) {
        issue(scene, "警告", `连线穿过文字："${clip(t.text)}" @ (${fmt(t.cx)}, ${fmt(t.cy)})——连线应走沟槽（契约 6-5）`);
        break;
      }
    }
  }

  // 框越出 viewBox
  if (viewBox) {
    for (const b of boxes) {
      if (b.bb.x0 < viewBox.x0 - 0.5 || b.bb.x1 > viewBox.x1 + 0.5 || b.bb.y0 < viewBox.y0 - 0.5 || b.bb.y1 > viewBox.y1 + 0.5) {
        issue(scene, "警告", `图元越出 viewBox：框 (${fmt(b.bb.x0)},${fmt(b.bb.y0)})-(${fmt(b.bb.x1)},${fmt(b.bb.y1)})`);
      }
    }
  }
}

// 线段与 bbox 相交（含端点在框内）
function segHitsBBox(p, q, bb, pad) {
  const x0 = bb.x0 - pad, y0 = bb.y0 - pad, x1 = bb.x1 + pad, y1 = bb.y1 + pad;
  const inP = p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const inQ = q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1;
  if (inP || inQ) return true;
  // 与四条边求交
  const edges = [
    [[x0, y0], [x1, y0]], [[x0, y1], [x1, y1]],
    [[x0, y0], [x0, y1]], [[x1, y0], [x1, y1]],
  ];
  return edges.some(([a, b]) => segsIntersect(p, q, a, b));
}
function segsIntersect(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

main();
