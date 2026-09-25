import { TIMELINE } from "../timeline";
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { REPO_URL } from "../data";
import { FONT, STAGE } from "../theme";
import { Stage } from "../ui/parts";
import { pop, progress } from "../ui/motion";
import { Logo } from "./Brand";

export const OUTRO_DURATION = TIMELINE.outro;

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = pop(frame, 4, 12);
  const a = progress(frame, 16, 20);
  const b = progress(frame, 30, 20);
  const c = progress(frame, 48, 20);
  const fadeOut = 1 - progress(frame, OUTRO_DURATION - 16, 16);
  return (
    <Stage glow={[50, 45]}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: fadeOut }}>
        <Logo size={112} scale={logo} />
        <div style={{ marginTop: 40, fontSize: 84, fontWeight: 800, color: STAGE.ink, letterSpacing: "-0.05em", opacity: a, transform: `translateY(${(1 - a) * 20}px)` }}>
          Answers you can <span style={{ fontFamily: FONT.serif, fontStyle: "italic", fontWeight: 400, color: STAGE.accent }}>check.</span>
        </div>
        <div style={{ fontSize: 84, fontWeight: 800, color: STAGE.ink, letterSpacing: "-0.05em", opacity: b, transform: `translateY(${(1 - b) * 20}px)` }}>
          Deliverables you can <span style={{ fontFamily: FONT.serif, fontStyle: "italic", fontWeight: 400, color: STAGE.accent }}>send.</span>
        </div>
        <div style={{ marginTop: 52, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, opacity: c, transform: `translateY(${(1 - c) * 16}px)` }}>
          <div style={{ fontSize: 30, fontWeight: 600, color: STAGE.ink }}>Business Operations Assistant</div>
          <div
            style={{
              fontFamily: FONT.mono,
              fontSize: 24,
              color: STAGE.ink,
              padding: "12px 24px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.05)",
            }}
          >
            {REPO_URL}
          </div>
          <div style={{ fontSize: 20, color: STAGE.dim }}>TypeScript · Mastra · DuckDB · Next.js · assistant-ui</div>
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
