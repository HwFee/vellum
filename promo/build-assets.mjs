// 宣传品导出：把 video/ 里渲染出来的成片与真实界面素材，整理成 promo/assets/ 那一套对外分发的文件。
//
//   node promo/build-assets.mjs            # 全量
//   node promo/build-assets.mjs --skip-stills
//
// 依赖：ffmpeg（PATH 上）、video/ 的依赖（remotion still 出海报帧）、
//       video/public/capture/*.png（由 video/capture/capture.mjs 抓取）。
//
// 为什么不让渲染直接产出这些文件：成片是「一次渲染、多处分发」——
// 仓库里只放重新编码过、体积可控的一份，落地页 / README / 社交卡各自取自己需要的那件。
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PROMO = import.meta.dirname;
const ROOT = path.resolve(PROMO, "..");
const VIDEO = path.join(ROOT, "video");
const OUT_DIR = path.join(PROMO, "assets");

const skipStills = process.argv.includes("--skip-stills");

const log = (...a) => console.log("[promo]", ...a);
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function run(cmd, args, { cwd } = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 退出码 ${r.status}`);
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function sizeOf(p) {
  return (await stat(p)).size;
}

// ------------------------------------------------------------------ 0. 前置
const FILM = path.join(VIDEO, "out/vellum-promo.mp4");
const FILM_SILENT = path.join(VIDEO, "out/vellum-promo-silent.mp4");
const CAPTURE = path.join(VIDEO, "public/capture");

for (const f of [FILM, FILM_SILENT]) {
  if (!(await exists(f))) {
    throw new Error(`缺 ${f}——先在 video/ 里跑 \`npm run render\` 与 \`npm run render:silent\``);
  }
}
if (!(await exists(CAPTURE))) {
  throw new Error(`缺 ${CAPTURE}——先在 video/ 里跑 \`npm run capture\``);
}

await mkdir(OUT_DIR, { recursive: true });

// --------------------------------------------------- 1. 窗口截图（真实界面）
const SHOTS = [
  ["01-window-reading.png", "window-reading.png"],
  ["03-window-search.png", "window-search.png"],
  ["10-window-editing-active.png", "window-editing.png"],
  ["06-window-widget-live.png", "window-widget.png"],
];
for (const [from, to] of SHOTS) {
  await copyFile(path.join(CAPTURE, from), path.join(OUT_DIR, to));
  log(`窗口截图 ${to} ${mb(await sizeOf(path.join(OUT_DIR, to)))}`);
}

// ------------------------------------------------------------ 2. 正片（重编码）
// Remotion 默认 CRF 18 是给母版留的余量；对外分发的这一份用 CRF 22 + faststart，
// 体积减掉约 40%，肉眼无差（画面以纸色大面积平涂为主，码率需求本来就不高）。
const FILM_OUT = path.join(OUT_DIR, "vellum-promo.mp4");
run("ffmpeg", [
  "-y", "-loglevel", "error",
  "-i", FILM,
  "-c:v", "libx264", "-crf", "22", "-preset", "slow", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "-c:a", "aac", "-b:a", "128k",
  FILM_OUT,
]);
log(`正片 ${mb(await sizeOf(FILM_OUT))}`);

// ------------------------------------------------------------------ 3. 循环 GIF
// 取 13.6s–22.6s：长图推进的收尾 → 大纲搜索 → 就地编辑，是全片信息密度最高的一段，
// 三段特征各自完整、且以「窗口」开场与收尾，循环时不会跳。
//
// 尺寸是权衡过的：1920 原尺寸直接转 GIF 要 24 MB，900px/12fps/192 色仍有 11.5 MB；
// 720px / 10 fps / 128 色 + bayer 抖动落在 6 MB 以内，而正文大字在 README 宽度下仍可读。
// 纸底噪点是 GIF 压缩的天敵（帧间全在变），想再瘦只能动裁篇幅或提帧间隔，别动色彩数。
const GIF_OUT = path.join(OUT_DIR, "vellum-promo.gif");
run("ffmpeg", [
  "-y", "-loglevel", "error",
  "-ss", "13.6", "-t", "9", "-i", FILM_SILENT,
  "-vf",
  "fps=10,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
  "-loop", "0",
  GIF_OUT,
]);
log(`GIF ${mb(await sizeOf(GIF_OUT))}`);

// --------------------------------------------------------- 4. 海报帧 + 社交卡
if (skipStills) {
  log("跳过海报帧（--skip-stills）");
} else {
  const POSTERS = [
    ["S1-ColdOpen", 100, "poster-title"],
    ["S3-PaperScroll", 95, "poster-rendering"],
    ["S5-EditInPlace", 150, "poster-edit"],
    ["S6-LiveBlocks", 80, "poster-session"],
  ];
  for (const [id, frame, name] of POSTERS) {
    const png = path.join(VIDEO, "out", `${name}.png`);
    run("npx", ["remotion", "still", id, `out/${name}.png`, `--frame=${String(frame)}`], { cwd: VIDEO });
    // 1920×1080 的 PNG 每张 1.3 MB 上下；海报是「看」的不是「用」的，JPEG q92 足够
    run("ffmpeg", [
      "-y", "-loglevel", "error",
      "-i", png,
      "-q:v", "2",
      path.join(OUT_DIR, `${name}.jpg`),
    ]);
    log(`海报 ${name}.jpg ${mb(await sizeOf(path.join(OUT_DIR, `${name}.jpg`)))}`);
  }

  // 社交分享卡（1280×640）保留 PNG：细字与发丝线经不起 JPEG 的振铃
  run("npx", ["remotion", "still", "SocialCard", "out/social-preview.png", "--frame=0"], { cwd: VIDEO });
  await copyFile(
    path.join(VIDEO, "out/social-preview.png"),
    path.join(OUT_DIR, "social-preview.png")
  );
  log(`社交卡 social-preview.png ${mb(await sizeOf(path.join(OUT_DIR, "social-preview.png")))}`);
}

// ------------------------------------------------------------------ 5. 汇总
const files = [
  "vellum-promo.mp4",
  "vellum-promo.gif",
  "social-preview.png",
  "poster-title.jpg",
  "poster-rendering.jpg",
  "poster-edit.jpg",
  "poster-session.jpg",
  "window-reading.png",
  "window-search.png",
  "window-editing.png",
  "window-widget.png",
];
let total = 0;
log("─".repeat(48));
for (const f of files) {
  const p = path.join(OUT_DIR, f);
  if (!(await exists(p))) {
    log(`! ${f} 缺失`);
    continue;
  }
  const s = await sizeOf(p);
  total += s;
  log(`${f.padEnd(26)} ${mb(s)}`);
}
log("─".repeat(48));
log(`合计 ${mb(total)} → ${OUT_DIR}`);
