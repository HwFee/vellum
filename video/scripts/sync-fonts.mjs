// 把应用 public/fonts 里的三个字体文件复制进 Remotion 的 public/fonts。
//
// 为什么复制而不是让 Remotion 指向应用目录：Remotion 的 staticFile() 只认
// publicDir 下的路径，而把 publicDir 指到应用根会把 dist/ 之类的无关内容一起
// 挂进打包。字体只有 17MB，复制一份最省事，且 .gitignore 已排除。
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const VIDEO_DIR = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(VIDEO_DIR, "..");
const SRC = path.join(REPO_ROOT, "public", "fonts");
const DST = path.join(VIDEO_DIR, "public", "fonts");

const FILES = [
  "TsangerJinKai02-W04.woff2",
  "TsangerJinKai02-W05.woff2",
  "JetBrainsMono.woff2",
];

await mkdir(DST, { recursive: true });
for (const file of FILES) {
  await copyFile(path.join(SRC, file), path.join(DST, file));
  const { size } = await stat(path.join(DST, file));
  console.log(`synced fonts/${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
}
console.log(`字体已同步 → ${DST}`);
process.exit(0);
