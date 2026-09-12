// 宣传品导出：把 video/ 里渲染出来的成片与真实界面素材，整理成 promo/assets/ 那一套对外分发的文件。
//
//   node promo/build-assets.mjs            # 全量（中英两套）
//   node promo/build-assets.mjs --skip-stills
//   node promo/build-assets.mjs --lang zh  # 只重做中文那一套
//
// 依赖：ffmpeg（PATH 上）、video/ 的依赖（remotion still 出海报帧）、
//       video/public/capture/*.png（由 video/capture/capture.mjs [--lang zh] 抓取）。
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

const argv = process.argv.slice(2);
const skipStills = argv.includes("--skip-stills");
const only = argv.includes("--lang") ? argv[argv.indexOf("--lang") + 1] : null;

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

const sizeOf = async (p) => (await stat(p)).size;

/**
 * 两套语言的差异集中在这一张表里：
 *   suffix      对外文件名后缀（-zh）
 *   prefix      抓取素材的前缀（capture/capture.mjs --lang zh 产出 zh-*.png）
 *   composition 正片合成（文案与素材由 locale 决定，见 video/src/locale.tsx）
 *   海报帧用「正片合成 + 全局帧号」取：场景在 TransitionSeries 里各自从 0 计帧，
 *   全局帧 = 场景起始帧 + 场景内帧。偏移由 video/src/theme.ts 的 SCENES 推出，
 *   已用 cmp 验证过「正片第 371 帧 == 单独渲染 S3-PaperScroll 第 95 帧」逐字节相同。
 */
const LOCALES = [
  {
    id: "en",
    suffix: "",
    prefix: "",
    composition: "VellumPromo",
    socialCard: "SocialCard",
    film: "out/vellum-promo.mp4",
    // 场景起始帧：S1 0 / S3 276 / S5 542 / S6 690（6 段转场各与相邻场景重叠 12 帧）
    posters: [
      ["poster-title", 100],
      ["poster-rendering", 371],
      ["poster-edit", 692],
      ["poster-session", 770],
    ],
    shots: [
      ["01-window-reading.png", "window-reading.png"],
      ["03-window-search.png", "window-search.png"],
      ["10-window-editing-active.png", "window-editing.png"],
      ["06-window-widget-live.png", "window-widget.png"],
    ],
  },
  {
    id: "zh",
    suffix: "-zh",
    prefix: "zh-",
    composition: "VellumPromoZh",
    socialCard: "SocialCardZh",
    film: "out/vellum-promo-zh.mp4",
    posters: [
      ["poster-title-zh", 100],
      ["poster-rendering-zh", 371],
      ["poster-edit-zh", 692],
      ["poster-session-zh", 770],
    ],
    shots: [
      ["zh-01-window-reading.png", "window-reading-zh.png"],
      ["zh-03-window-search.png", "window-search-zh.png"],
      ["zh-10-window-editing-active.png", "window-editing-zh.png"],
      ["zh-06-window-widget-live.png", "window-widget-zh.png"],
    ],
  },
];

const targets = only ? LOCALES.filter((l) => l.id === only) : LOCALES;
if (targets.length === 0) throw new Error(`--lang 只能是 en / zh，收到：${only}`);

// ------------------------------------------------------------------ 0. 前置
for (const loc of targets) {
  const film = path.join(VIDEO, loc.film);
  if (!(await exists(film))) {
    throw new Error(
      `缺 ${film}——先在 video/ 里跑 \`npx remotion render ${loc.composition} ${loc.film}\``
    );
  }
}
if (!(await exists(path.join(VIDEO, "public/capture")))) {
  throw new Error(`缺 video/public/capture——先在 video/ 里跑 \`npm run capture\`（中文素材用 \`npm run capture:zh\`）`);
}

await mkdir(OUT_DIR, { recursive: true });

const written = [];

for (const loc of targets) {
  log(`── ${loc.id} ────────────────────────────────────────`);

  // -------------------------------------------------- 1. 窗口截图（真实界面）
  for (const [from, to] of loc.shots) {
    const src = path.join(VIDEO, "public/capture", from);
    if (!(await exists(src))) {
      log(`! 缺素材 ${from}，跳过（跑 npm run capture${loc.prefix ? ":zh" : ""}）`);
      continue;
    }
    const dst = path.join(OUT_DIR, to);
    await copyFile(src, dst);
    log(`窗口截图 ${to} ${mb(await sizeOf(dst))}`);
    written.push(to);
  }

  // -------------------------------------------------------- 2. 正片（重编码）
  // Remotion 默认 CRF 18 是给母版留的余量；对外分发的这一份用 CRF 22 + faststart，
  // 体积减掉约 40%，肉眼无差（画面以纸色大面积平涂为主，码率需求本来就不高）。
  const filmOut = `vellum-promo${loc.suffix}.mp4`;
  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", path.join(VIDEO, loc.film),
    "-c:v", "libx264", "-crf", "22", "-preset", "slow", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "128k",
    path.join(OUT_DIR, filmOut),
  ]);
  log(`正片 ${filmOut} ${mb(await sizeOf(path.join(OUT_DIR, filmOut)))}`);
  written.push(filmOut);

  // -------------------------------------------------------------- 3. 循环 GIF
  // 取 13.8s–22.3s：长图推进的收尾 → 大纲搜索 → 就地编辑，是全片信息密度最高的一段，
  // 三段特征各自完整、且以「窗口」开场与收尾，循环时不会跳。
  //
  // 尺寸是权衡过的：1920 原尺寸直接转要 24 MB，900px/12fps/192 色仍有 11.5 MB。
  // 中英两版统一走 700px / 10 fps / 112 色 + bayer 抖动，各落在 5 MB 以内，
  // 正文大字在 README 宽度下仍可读。纸底噪点是 GIF 压缩的天敵（帧间全在变），
  // 想再瘦只能动裁篇幅或提帧间隔，别动色彩数。
  //
  // 音轨在这一步被丢弃（GIF 没有声音），所以素材直接用带配乐的正片，
  // 不必为了 GIF 多渲一版静音成片。
  const gifOut = `vellum-promo${loc.suffix}.gif`;
  run("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", "13.8", "-t", "8.5", "-i", path.join(VIDEO, loc.film),
    "-vf",
    "fps=10,scale=700:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=112:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
    "-loop", "0",
    path.join(OUT_DIR, gifOut),
  ]);
  log(`GIF ${gifOut} ${mb(await sizeOf(path.join(OUT_DIR, gifOut)))}`);
  written.push(gifOut);

  // ------------------------------------------------------- 4. 海报帧 / 社交卡
  if (skipStills) {
    log("跳过海报帧（--skip-stills）");
  } else {
    for (const [name, frame] of loc.posters) {
      const png = path.join(VIDEO, "out", `${name}.png`);
      run("npx", ["remotion", "still", loc.composition, `out/${name}.png`, `--frame=${String(frame)}`], {
        cwd: VIDEO,
      });
      // 1920×1080 的 PNG 每张 1 MB 上下；海报是「看」的不是「用」的，JPEG q92 足够
      run("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-q:v", "2", path.join(OUT_DIR, `${name}.jpg`)]);
      log(`海报 ${name}.jpg ${mb(await sizeOf(path.join(OUT_DIR, `${name}.jpg`)))}`);
      written.push(`${name}.jpg`);
    }

    // 社交分享卡（1280×640）保留 PNG：细字与发丝线经不起 JPEG 的振铃
    const cardOut = `social-preview${loc.suffix}.png`;
    run("npx", ["remotion", "still", loc.socialCard, `out/${cardOut}`, "--frame=0"], { cwd: VIDEO });
    await copyFile(path.join(VIDEO, "out", cardOut), path.join(OUT_DIR, cardOut));
    log(`社交卡 ${cardOut} ${mb(await sizeOf(path.join(OUT_DIR, cardOut)))}`);
    written.push(cardOut);
  }
}

// ------------------------------------------------------------------ 5. 汇总
let total = 0;
log("─".repeat(52));
for (const f of [...new Set(written)].sort()) {
  const p = path.join(OUT_DIR, f);
  if (!(await exists(p))) continue;
  const s = await sizeOf(p);
  total += s;
  log(`${f.padEnd(30)} ${mb(s)}`);
}
log("─".repeat(52));
log(`本次写出 ${written.length} 件，合计 ${mb(total)} → ${OUT_DIR}`);
if (targets.length === 1) {
  log("注意：--lang 只重做了一套，目录里另一套是旧文件；全量重建请不带参数跑。");
}
