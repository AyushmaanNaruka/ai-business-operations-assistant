import React from "react";
import { Composition } from "remotion";
import { Demo, DEMO_DURATION } from "./Demo";
import { Teaser, TEASER_DURATION } from "./Teaser";
import { FPS, H, W } from "./theme";

export const Root: React.FC = () => (
  <>
    <Composition id="Demo" component={Demo} durationInFrames={DEMO_DURATION} fps={FPS} width={W} height={H} />
    <Composition id="Teaser" component={Teaser} durationInFrames={TEASER_DURATION} fps={FPS} width={W} height={H} />
  </>
);
