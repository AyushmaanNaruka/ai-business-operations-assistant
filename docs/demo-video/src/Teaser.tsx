import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { STAGE } from "./theme";
import { Upload } from "./scenes/Upload";
import { Analysis } from "./scenes/Analysis";
import { Conflict } from "./scenes/Conflict";
import { Artifacts } from "./scenes/Artifacts";
import { Outro } from "./scenes/Outro";

/** A short loop for the README: slices of the full cut, [scene, from frame, length]. */
const CUTS: [React.FC, number, number][] = [
  [Upload, 36, 84],
  [Analysis, 150, 66],
  [Analysis, 256, 70],
  [Conflict, 150, 80],
  [Artifacts, 290, 60],
  [Artifacts, 380, 50],
  [Outro, 10, 70],
];

export const TEASER_DURATION = CUTS.reduce((n, c) => n + c[2], 0);

export const Teaser: React.FC = () => {
  let at = 0;
  return (
    <AbsoluteFill style={{ background: STAGE.bg }}>
      {CUTS.map(([Scene, from, len], i) => {
        const start = at;
        at += len;
        return (
          <Sequence key={i} from={start} durationInFrames={len}>
            <Sequence from={-from}>
              <Scene />
            </Sequence>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
