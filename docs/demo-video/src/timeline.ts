/**
 * Scene lengths in frames at 30 fps. The single source for both the video
 * (src/Demo.tsx) and the soundtrack (scripts/make-soundtrack.ts), so a scene
 * that grows or shrinks moves its sound effects with it.
 */
export const TIMELINE = {
  hook: 120,
  brand: 96,
  upload: 240,
  analysis: 480,
  conflict: 270,
  agents: 285,
  artifacts: 450,
  features: 250,
  outro: 180,
} as const;

export type SceneId = keyof typeof TIMELINE;

export const SCENE_ORDER: SceneId[] = ["hook", "brand", "upload", "analysis", "conflict", "agents", "artifacts", "features", "outro"];

export const TOTAL_FRAMES = SCENE_ORDER.reduce((n, id) => n + TIMELINE[id], 0);

/** First frame of a scene in the full cut. */
export function sceneStart(id: SceneId): number {
  let n = 0;
  for (const s of SCENE_ORDER) {
    if (s === id) return n;
    n += TIMELINE[s];
  }
  return 0;
}
