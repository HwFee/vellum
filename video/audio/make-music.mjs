// 生成宣传片配乐：纯 Node 合成，零依赖，输出 44.1kHz / 16-bit 立体声 WAV。
//
// 为什么自己合成而不是找现成曲目：版权干净、时长可精确对齐 30s 分镜、
// 情绪可以按画面段落调节，且不引入任何外部资产。
//
// 用法：node video/audio/make-music.mjs [--out video/public/music.wav] [--seconds 30]
//
// 声音设计（纸墨书斋气质，克制、无鼓点）：
//   pad   —— 每个和弦音用数个微失谐正弦叠出，1.7s 慢起音、长释放
//   bass  —— 根音下方八度正弦
//   motif —— 稀疏的「电钢」动机：基频 + 二/三次谐波，双指数衰减 + 轻颤音
//   空间  —— Schroeder 混响（4 comb + 3 allpass），湿声略偏左、干声立体声
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const get = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const VIDEO_DIR = path.resolve(import.meta.dirname, "..");
// 默认输出锚定到脚本位置而不是 cwd：`npm run music` 的 cwd 是 video/，
// 早先按 cwd 解析会把 wav 写到 video/video/public/ 去。
const OUT = path.resolve(get("out", path.join(VIDEO_DIR, "public/music.wav")));
const SECONDS = Number(get("seconds", "30"));
const SR = 44100;
const N = Math.floor(SECONDS * SR);

const NOTE_HZ = {
  A2: 110.0, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0,
  A3: 220.0, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
  G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.26,
};
const n = (name) => {
  const hz = NOTE_HZ[name];
  if (!hz) throw new Error(`未定义音名：${name}`);
  return hz;
};

const L = new Float64Array(N);
const R = new Float64Array(N);
const at = (i, l, r) => {
  if (i < 0 || i >= N) return;
  L[i] += l;
  R[i] += r;
};

// --- pad：和声铺底 -----------------------------------------------------------
// 分镜对齐：0-4 引子 / 4-8 阅读面 / 8-12 大纲 / 12-16 代码数学 / 16-20 编辑 /
//          20-24 交互块 / 24-27 现场日志 / 27-30 收尾
const PROGRESSION = [
  { at: 0, bass: "A2", chord: ["A3", "C4", "E4", "B4"] },
  { at: 4, bass: "F3", chord: ["F3", "A3", "C4", "E4"] },
  { at: 8, bass: "C3", chord: ["C4", "E4", "G4", "D5"] },
  { at: 12, bass: "G3", chord: ["G3", "B3", "D4", "C4"] },
  { at: 16, bass: "A2", chord: ["A3", "C4", "E4", "B4"] },
  { at: 20, bass: "F3", chord: ["F3", "A3", "C4", "E4"] },
  { at: 24, bass: "G3", chord: ["G3", "B3", "D4", "B3"] },
  { at: 27, bass: "C3", chord: ["C4", "E4", "G4", "E4"] },
];
const CHORD_LEN = 4.8;

const padEnv = (t, dur) => {
  const attack = Math.min(1, t / 1.7);
  const release = t > dur - 2.8 ? Math.max(0, (dur - t) / 2.8) : 1;
  return attack * attack * release * release;
};

for (const seg of PROGRESSION) {
  const voices = [seg.bass, ...seg.chord];
  voices.forEach((name, vi) => {
    const base = n(name);
    const isBass = vi === 0;
    const gain = (isBass ? 0.17 : 0.075) / Math.sqrt(vi + 1);
    const partials = isBass ? [1.0, 1.0018] : [1.0, 1.0016, 0.9986];
    partials.forEach((ratio, p) => {
      const f = base * ratio;
      const phase = Math.random() * Math.PI * 2;
      const pan = isBass ? 0 : (p - 1) * 0.24;
      const gl = Math.sqrt((1 - pan) / 2);
      const gr = Math.sqrt((1 + pan) / 2);
      // 极慢的音高漂移，避免长音听出「合成器静止感」
      const drift = 0.32 * Math.sin(2 * Math.PI * 0.037 * (seg.at + p));
      const i0 = Math.floor(seg.at * SR);
      const i1 = Math.min(N, Math.floor((seg.at + CHORD_LEN) * SR));
      for (let i = i0; i < i1; i++) {
        const t = (i - i0) / SR;
        const env = padEnv(t, CHORD_LEN);
        if (env <= 0) continue;
        const v = Math.sin(2 * Math.PI * (f + drift) * t + phase) * gain * env;
        at(i, v * gl, v * gr);
      }
    });
  });
}

// --- motif：稀疏动机 ---------------------------------------------------------
const MOTIF = [
  { at: 5.0, note: "E5", vel: 0.5 },
  { at: 7.0, note: "C5", vel: 0.42 },
  { at: 9.0, note: "G4", vel: 0.4 },
  { at: 11.0, note: "D5", vel: 0.46 },
  { at: 13.0, note: "C5", vel: 0.4 },
  { at: 15.0, note: "A4", vel: 0.44 },
  { at: 17.5, note: "B4", vel: 0.4 },
  { at: 19.5, note: "C5", vel: 0.46 },
  { at: 22.0, note: "G4", vel: 0.38 },
  { at: 24.5, note: "D5", vel: 0.44 },
  { at: 27.0, note: "E5", vel: 0.5 },
];

for (const m of MOTIF) {
  const f = n(m.note);
  const i0 = Math.floor(m.at * SR);
  const i1 = Math.min(N, Math.floor((m.at + 2.8) * SR));
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / SR;
    const attack = Math.min(1, t / 0.012);
    const decay = Math.exp(-t * 1.5) * 0.72 + Math.exp(-t * 0.42) * 0.28;
    const vib = 1 + 0.0016 * Math.sin(2 * Math.PI * 5.2 * t) * Math.min(1, t / 0.6);
    const env = attack * decay * m.vel;
    const w = 2 * Math.PI * f * vib;
    const v =
      Math.sin(w * t) * 0.72 + Math.sin(2 * w * t) * 0.14 + Math.sin(3 * w * t) * 0.09;
    const s = v * env * 0.07;
    at(i, s, s * 0.97);
  }
}

// --- 空间：Schroeder 混响 ----------------------------------------------------
const dry = new Float64Array(N);
for (let i = 0; i < N; i++) dry[i] = (L[i] + R[i]) * 0.5;

const wet = new Float64Array(N);
for (const ms of [1557, 1617, 1491, 1422]) {
  const d = Math.round(ms * (SR / 44100));
  const buf = new Float64Array(d);
  let idx = 0;
  for (let i = 0; i < N; i++) {
    const b = buf[idx];
    buf[idx] = dry[i] * 0.25 + b * 0.8;
    wet[i] += b * 0.25;
    idx = (idx + 1) % d;
  }
}
for (const d of [225, 556, 441]) {
  const buf = new Float64Array(d);
  let idx = 0;
  for (let i = 0; i < N; i++) {
    const b = buf[idx];
    const v = wet[i] + b * 0.5;
    buf[idx] = v;
    wet[i] = b - v * 0.5;
    idx = (idx + 1) % d;
  }
}

const outL = new Float64Array(N);
const outR = new Float64Array(N);
for (let i = 0; i < N; i++) {
  outL[i] = L[i] + wet[i] * 0.5;
  outR[i] = R[i] + wet[i] * 0.46;
}

// --- 母带：淡入淡出 + 软限幅归一 ---------------------------------------------
const FADE_IN = 1.2;
const FADE_OUT = 3.2;
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = 1;
  if (t < FADE_IN) g *= t / FADE_IN;
  if (t > SECONDS - FADE_OUT) g *= Math.max(0, (SECONDS - t) / FADE_OUT);
  outL[i] *= g;
  outR[i] *= g;
  peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
}
const norm = peak > 0 ? 0.82 / peak : 1;

// --- 写 WAV ------------------------------------------------------------------
const dataBytes = N * 2 * 2;
const buf = Buffer.alloc(44 + dataBytes);
buf.write("RIFF", 0, "ascii");
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write("WAVE", 8, "ascii");
buf.write("fmt ", 12, "ascii");
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 2 * 2, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36, "ascii");
buf.writeUInt32LE(dataBytes, 40);

let off = 44;
for (let i = 0; i < N; i++) {
  const l = Math.tanh(outL[i] * norm * 1.05);
  const r = Math.tanh(outR[i] * norm * 1.05);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), off);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), off + 2);
  off += 4;
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, buf);
console.log(
  `已写出 ${OUT}（${SECONDS}s, ${(buf.length / 1024 / 1024).toFixed(1)} MB, 归一前峰值 ${peak.toFixed(3)}）`
);
