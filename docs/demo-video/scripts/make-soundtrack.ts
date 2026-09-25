/**
 * Writes public/soundtrack.wav: an original music bed plus sound effects synced
 * to the video. Pure synthesis, no samples and no dependencies, so the track is
 * royalty free and regenerates identically (the noise is seeded).
 *
 * Run: node scripts/make-soundtrack.ts   (Node 22.18+ runs TypeScript directly)
 *
 * Every effect is placed at a scene-local frame, the same frame numbers the scene
 * files animate on, offset by the scene's start from src/timeline.ts.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TOTAL_FRAMES, sceneStart, type SceneId } from "../src/timeline.ts";

const SR = 44100;
const FPS = 30;
const DURATION = TOTAL_FRAMES / FPS;
const N = Math.ceil(DURATION * SR);
const TAU = Math.PI * 2;

const music = { L: new Float32Array(N), R: new Float32Array(N) };
const sfx = { L: new Float32Array(N), R: new Float32Array(N) };
/** Kick envelope per sample, used to duck the pad and bass (sidechain). */
const duck = new Float32Array(N);

let seed = 0x9e3779b9;
function rand(): number {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const noise = () => rand() * 2 - 1;

/** Absolute seconds for a scene-local frame. */
const at = (scene: SceneId, frame: number) => (sceneStart(scene) + frame) / FPS;

type Bus = { L: Float32Array; R: Float32Array };

/** Adds a mono voice to a bus with a constant pan (-1 left, 1 right). */
function voice(bus: Bus, t0: number, dur: number, pan: number, gen: (t: number, i: number) => number) {
  const s0 = Math.max(0, Math.floor(t0 * SR));
  const s1 = Math.min(N, Math.floor((t0 + dur) * SR));
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let s = s0, i = 0; s < s1; s++, i++) {
    const v = gen(s / SR - t0, i);
    bus.L[s] += v * gl;
    bus.R[s] += v * gr;
  }
}

/** A state variable filter step; returns [low, band, high]. */
function svf() {
  let low = 0;
  let band = 0;
  return (x: number, cutoff: number, q = 0.7) => {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff, SR / 6)) / SR);
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    return [low, band, high] as const;
  };
}

/* ------------------------------ music ------------------------------ */

const BPM = 112;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// vi IV I V in C, two bars each: Am, F, C, G.
const CHORDS = [
  { root: 45, pad: [57, 60, 64, 71] },
  { root: 41, pad: [53, 57, 60, 67] },
  { root: 48, pad: [55, 60, 64, 71] },
  { root: 43, pad: [55, 59, 62, 69] },
];
const chordAt = (t: number) => CHORDS[Math.floor(t / (BAR * 2)) % CHORDS.length];

// Section boundaries in seconds, from the scene timeline.
const T_BRAND = at("brand", 0);
const T_UPLOAD = at("upload", 0);
const T_ANALYSIS = at("analysis", 0);
const T_CONFLICT = at("conflict", 0);
const T_AGENTS = at("agents", 0);
const T_FEATURES = at("features", 0);
const T_OUTRO = at("outro", 0);

const drumsOn = (t: number) => t >= T_UPLOAD && t < T_OUTRO;
const snareOn = (t: number) => (t >= T_ANALYSIS && t < T_CONFLICT) || (t >= T_AGENTS && t < T_OUTRO);
const arpOn = (t: number) => (t >= T_ANALYSIS && t < T_CONFLICT) || (t >= T_AGENTS && t < T_OUTRO);

// Pad: soft saw-like stacks, one per chord, overlapping at the changes.
{
  const chordLen = BAR * 2;
  const count = Math.ceil(DURATION / chordLen) + 1;
  for (let c = 0; c < count; c++) {
    const t0 = c * chordLen;
    const chord = CHORDS[c % CHORDS.length];
    const last = t0 + chordLen >= T_OUTRO;
    const dur = last ? DURATION - t0 : chordLen + 1.2;
    if (t0 >= DURATION) break;
    // The outro holds a C major chord and lets it ring.
    const notes = last ? [48, 55, 60, 64, 67, 71] : chord.pad;
    notes.forEach((m, k) => {
      const f = midi(m);
      const pan = (k / (notes.length - 1)) * 1.2 - 0.6;
      const lp = svf();
      voice(music, t0, dur, pan, (t) => {
        const abs = t0 + t;
        const env = Math.min(1, t / 0.9) * Math.min(1, (dur - t) / 1.1);
        let x = 0;
        for (let h = 1; h <= 6; h++) {
          const a = 1 / Math.pow(h, 1.35);
          x += a * Math.sin(TAU * f * h * t * 1.0012) + a * Math.sin(TAU * f * h * t * 0.9988 + h);
        }
        const open = abs < T_BRAND ? 900 : abs >= T_CONFLICT && abs < T_AGENTS ? 1100 : 1900;
        const [low] = lp(x, open + 400 * Math.sin(abs * 0.4));
        const level = abs < T_BRAND ? 0.05 : abs >= T_OUTRO ? 0.052 : 0.045;
        return low * env * level;
      });
    });
  }
}

// Drums and bass on a beat grid.
for (let b = 0; b * BEAT < DURATION; b++) {
  const t = b * BEAT;
  const inBar = b % 4;

  if (drumsOn(t)) {
    // Kick on every beat.
    voice(music, t, 0.45, 0, (u) => {
      const ph = TAU * (46 * u + (120 / 30) * (1 - Math.exp(-u * 30)));
      return Math.sin(ph) * Math.exp(-u * 7.5) * 0.55 + (u < 0.004 ? noise() * 0.12 : 0);
    });
    for (let s = Math.floor(t * SR), i = 0; s < Math.min(N, Math.floor((t + 0.3) * SR)); s++, i++) {
      duck[s] = Math.max(duck[s], Math.exp(-(i / SR) * 9));
    }
    // Offbeat hat.
    const hp = svf();
    voice(music, t + BEAT / 2, 0.08, 0.35, (u) => hp(noise(), 7000)[2] * Math.exp(-u * 55) * 0.09);
    if (t >= T_FEATURES) {
      const hp2 = svf();
      voice(music, t + BEAT / 4, 0.05, -0.35, (u) => hp2(noise(), 8000)[2] * Math.exp(-u * 80) * 0.05);
      const hp3 = svf();
      voice(music, t + (3 * BEAT) / 4, 0.05, -0.35, (u) => hp3(noise(), 8000)[2] * Math.exp(-u * 80) * 0.05);
    }
  }

  if (snareOn(t) && (inBar === 1 || inBar === 3)) {
    const bp = svf();
    voice(music, t, 0.25, -0.1, (u) => {
      const body = Math.sin(TAU * 185 * u) * Math.exp(-u * 30) * 0.18;
      const snap = bp(noise(), 2200, 0.5)[1] * Math.exp(-u * 18) * 0.32;
      return body + snap;
    });
  }

  // Bass: root on the beat, octave on the "and", from the brand reveal on.
  if (t >= T_BRAND && t < T_OUTRO) {
    const chord = chordAt(t);
    const f = midi(chord.root);
    for (const [off, mult, g] of [
      [0, 1, 0.3],
      [BEAT / 2, 2, 0.12],
    ] as const) {
      voice(music, t + off, 0.42, 0, (u) => {
        const x = Math.sin(TAU * f * mult * u) + 0.35 * Math.sin(TAU * f * mult * 2 * u);
        return x * Math.exp(-u * 5.5) * Math.min(1, u / 0.006) * g;
      });
    }
  }

  // Arp: chord tones an octave up, eighth notes, with a ping pong echo.
  if (arpOn(t)) {
    const chord = chordAt(t);
    const tones = [chord.pad[0] + 12, chord.pad[1] + 12, chord.pad[2] + 12, chord.pad[1] + 12];
    for (let e = 0; e < 2; e++) {
      const m = tones[(b * 2 + e) % 4];
      const f = midi(m);
      const tt = t + e * (BEAT / 2);
      for (let echo = 0; echo < 3; echo++) {
        const g = 0.07 * Math.pow(0.45, echo);
        voice(music, tt + echo * BEAT * 0.75, 0.35, echo % 2 === 0 ? -0.45 : 0.45, (u) => {
          const x = Math.sin(TAU * f * u) + 0.25 * Math.sin(TAU * f * 3 * u);
          return x * Math.exp(-u * 11) * Math.min(1, u / 0.003) * g;
        });
      }
    }
  }
}

// Riser into the brand reveal.
{
  const t0 = T_BRAND - 2.2;
  const bp = svf();
  voice(music, t0, 2.2, 0, (u) => {
    const p = u / 2.2;
    const [, band] = bp(noise(), 400 + 5200 * p * p, 0.35);
    return band * p * p * 0.35 + Math.sin(TAU * (180 + 520 * p * p) * u) * p * p * 0.05;
  });
}

// Duck the music under every kick.
for (let s = 0; s < N; s++) {
  const g = 1 - duck[s] * 0.35;
  music.L[s] *= g;
  music.R[s] *= g;
}

/* ------------------------------ effects ------------------------------ */

function whoosh(t0: number, dur = 0.55, gain = 0.22) {
  const bp = svf();
  voice(sfx, t0 - dur * 0.55, dur, 0, (u) => {
    const p = u / dur;
    const env = Math.sin(Math.PI * p) ** 2;
    return bp(noise(), 300 * Math.pow(18, p), 0.45)[1] * env * gain * 2.4;
  });
}

function pop(t0: number, f = 900, gain = 0.16) {
  voice(sfx, t0, 0.14, (rand() - 0.5) * 0.6, (u) => {
    const fr = f * (1 + 0.6 * Math.exp(-u * 60));
    return Math.sin(TAU * fr * u) * Math.exp(-u * 30) * Math.min(1, u / 0.002) * gain;
  });
}

function tick(t0: number, gain = 0.07) {
  voice(sfx, t0, 0.03, 0.2, (u) => Math.sin(TAU * 2400 * u) * Math.exp(-u * 160) * gain * 2);
}

function keys(t0: number, t1: number, perSecond = 13, gain = 0.05) {
  let t = t0;
  while (t < t1) {
    const bp = svf();
    const f = 2500 + rand() * 1800;
    voice(sfx, t, 0.02, (rand() - 0.5) * 0.4, (u) => bp(noise(), f, 0.6)[1] * Math.exp(-u * 260) * gain * 4 * (0.7 + rand() * 0.6));
    t += (1 / perSecond) * (0.6 + rand() * 0.8);
  }
}

function chime(t0: number, notes: number[], gain = 0.08) {
  notes.forEach((m, i) => {
    const f = midi(m);
    voice(sfx, t0 + i * 0.07, 1.6, i % 2 ? 0.3 : -0.3, (u) => {
      const x = Math.sin(TAU * f * u) + 0.4 * Math.sin(TAU * f * 2.76 * u) * Math.exp(-u * 4) + 0.2 * Math.sin(TAU * f * 5.4 * u) * Math.exp(-u * 8);
      return x * Math.exp(-u * 3) * Math.min(1, u / 0.002) * gain;
    });
  });
}

function impact(t0: number, gain = 0.5) {
  const lp = svf();
  voice(sfx, t0, 1.8, 0, (u) => {
    const boom = Math.sin(TAU * (38 + 50 * Math.exp(-u * 12)) * u) * Math.exp(-u * 2.2);
    const air = lp(noise(), 1800)[0] * Math.exp(-u * 5);
    return (boom * 0.8 + air * 0.4) * gain;
  });
}

function strike(t0: number) {
  const bp = svf();
  voice(sfx, t0, 0.4, 0.1, (u) => {
    const p = u / 0.4;
    return (bp(noise(), 3000 - 2400 * p, 0.5)[1] * 0.5 + Math.sin(TAU * (700 - 450 * p) * u) * 0.15) * (1 - p) * 0.35;
  });
}

function thud(t0: number) {
  voice(sfx, t0, 0.9, 0, (u) => {
    const tom = Math.sin(TAU * (60 + 50 * Math.exp(-u * 18)) * u) * Math.exp(-u * 6) * 0.55;
    const tense = (Math.sin(TAU * midi(69) * u) + Math.sin(TAU * midi(70) * u)) * Math.exp(-u * 3.5) * 0.045;
    return tom + tense;
  });
}

// Hook
strike(at("hook", 62));
chime(at("hook", 76), [76, 79, 84], 0.05);

// Brand
impact(T_BRAND);
pop(at("brand", 4), 520, 0.14);
[44, 48, 52, 56].forEach((f, i) => pop(at("brand", f), 1100 + i * 120, 0.08));

// Upload
whoosh(T_UPLOAD);
[30, 37, 44, 51].forEach((f) => whoosh(at("upload", f + 14), 0.45, 0.1));
[56, 63, 70, 77].forEach((f, i) => pop(at("upload", f), 700 + i * 90));
[86, 96, 102, 110].forEach((f) => tick(at("upload", f)));
whoosh(at("upload", 150), 0.7, 0.15);
pop(at("upload", 165), 620, 0.12);

// Analysis
whoosh(T_ANALYSIS);
keys(at("analysis", 10), at("analysis", 73));
pop(at("analysis", 74), 1250, 0.12);
[84, 104, 112, 128, 204].forEach((f) => tick(at("analysis", f), 0.05));
[100, 126, 200, 222, 228].forEach((f) => tick(at("analysis", f), 0.08));
keys(at("analysis", 132), at("analysis", 199), 22, 0.03);
whoosh(at("analysis", 152), 0.7, 0.15);
pop(at("analysis", 162), 620, 0.12);
whoosh(at("analysis", 240), 0.6, 0.1);
[0, 1, 2, 3, 4, 5].forEach((i) => pop(at("analysis", 256 + i * 4), 520 + i * 70, 0.07));
[0, 1, 2, 3].forEach((i) => tick(at("analysis", 320 + i * 9), 0.07));
whoosh(at("analysis", 384), 0.7, 0.15);
pop(at("analysis", 398), 620, 0.12);

// Conflict
whoosh(T_CONFLICT);
keys(at("conflict", 6), at("conflict", 51));
pop(at("conflict", 53), 1250, 0.12);
[60, 76, 80].forEach((f) => tick(at("conflict", f), 0.05));
[72, 118, 122].forEach((f) => tick(at("conflict", f), 0.08));
thud(at("conflict", 140));
whoosh(at("conflict", 152), 0.7, 0.12);
pop(at("conflict", 188), 620, 0.12);

// Agents
whoosh(T_AGENTS);
pop(at("agents", 20), 440, 0.16);
[50, 56, 62, 68].forEach((f, i) => pop(at("agents", f), 660 + i * 110, 0.11));
pop(at("agents", 96), 520, 0.13);
[0, 1, 2, 3, 4, 5].forEach((i) => tick(at("agents", 150 + i * 16), 0.07));

// Artifacts
whoosh(at("artifacts", 0));
keys(at("artifacts", 6), at("artifacts", 71));
pop(at("artifacts", 73), 1250, 0.12);
[108, 112].forEach((f) => tick(at("artifacts", f), 0.05));
[0, 1, 2, 3, 4, 5, 6, 7].forEach((i) => tick(at("artifacts", 124 + 13 * (i + 1)), 0.07));
chime(at("artifacts", 232), [72, 76, 79], 0.07);
chime(at("artifacts", 250), [74, 79, 83], 0.07);
whoosh(at("artifacts", 280), 0.6, 0.16);
pop(at("artifacts", 300), 620, 0.12);
whoosh(at("artifacts", 362), 0.5, 0.12);
whoosh(at("artifacts", 372), 0.7, 0.12);
pop(at("artifacts", 384), 620, 0.12);

// Features
whoosh(T_FEATURES);
[0, 1, 2, 3, 4, 5].forEach((i) => pop(at("features", 18 + i * 7), 600 + i * 80, 0.1));

// Outro
impact(T_OUTRO, 0.4);
chime(at("outro", 4), [72, 76, 79, 84], 0.06);

/* ------------------------------ master ------------------------------ */

const out = new Int16Array(N * 2);
let peak = 0;
const mixL = new Float32Array(N);
const mixR = new Float32Array(N);
for (let s = 0; s < N; s++) {
  const t = s / SR;
  const fadeIn = Math.min(1, t / 0.05);
  const fadeOut = Math.min(1, (DURATION - t) / 1.6);
  const l = Math.tanh((music.L[s] * 0.9 + sfx.L[s]) * 1.3) * fadeIn * fadeOut;
  const r = Math.tanh((music.R[s] * 0.9 + sfx.R[s]) * 1.3) * fadeIn * fadeOut;
  mixL[s] = l;
  mixR[s] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const norm = 0.89 / peak;
for (let s = 0; s < N; s++) {
  out[s * 2] = Math.round(mixL[s] * norm * 32767);
  out[s * 2 + 1] = Math.round(mixR[s] * norm * 32767);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + out.byteLength, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(out.byteLength, 40);

const file = resolve(dirname(fileURLToPath(import.meta.url)), "../public/soundtrack.wav");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, Buffer.concat([header, Buffer.from(out.buffer)]));
console.log(`soundtrack.wav: ${DURATION.toFixed(2)}s, peak before normalise ${peak.toFixed(3)}`);
