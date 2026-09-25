import { Easing, interpolate, spring } from "remotion";
import { FPS } from "../theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const EASE = Easing.bezier(0.22, 1, 0.36, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 to 1 over [start, start + duration], eased. */
export function progress(frame: number, start: number, duration: number, ease = EASE): number {
  return interpolate(frame, [start, start + duration], [0, 1], { ...clamp, easing: ease });
}

export function pop(frame: number, start: number, damping = 14): number {
  return spring({ frame: frame - start, fps: FPS, config: { damping, mass: 0.7, stiffness: 140 } });
}

/** Fade in over the first frames of a scene and out over the last. */
export function sceneFade(frame: number, duration: number, inFrames = 10, outFrames = 10): number {
  return interpolate(frame, [0, inFrames, duration - outFrames, duration], [0, 1, 1, 0], clamp);
}

/** How many characters of `text` are typed by `frame`, at `cps` characters per second. */
export function typed(text: string, frame: number, start: number, cps = 42): string {
  const n = Math.max(0, Math.floor(((frame - start) / FPS) * cps));
  return text.slice(0, n);
}

export type CamKey = { f: number; s: number; fx: number; fy: number; tx?: number; ty?: number; rx?: number; ry?: number };

/**
 * A camera over the app. Each key says: at frame f, show app point (fx, fy) at
 * canvas point (tx, ty), scaled by s, tilted by rx/ry degrees.
 */
export function camera(frame: number, keys: CamKey[]) {
  const fs = keys.map((k) => k.f);
  const pick = (get: (k: CamKey) => number) =>
    keys.length === 1 ? get(keys[0]) : interpolate(frame, fs, keys.map(get), { ...clamp, easing: EASE_IN_OUT });
  const s = pick((k) => k.s);
  const fx = pick((k) => k.fx);
  const fy = pick((k) => k.fy);
  const tx = pick((k) => k.tx ?? 960);
  const ty = pick((k) => k.ty ?? 600);
  const rx = pick((k) => k.rx ?? 0);
  const ry = pick((k) => k.ry ?? 0);
  return { transform: `translate(${tx - fx * s}px, ${ty - fy * s}px) scale(${s})`, rx, ry };
}
