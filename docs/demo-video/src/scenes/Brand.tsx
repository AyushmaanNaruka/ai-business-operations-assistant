import { TIMELINE } from "../timeline";
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { STAGE } from "../theme";
import { Icon } from "../ui/Icons";
import { Stage } from "../ui/parts";
import { pop, progress, sceneFade } from "../ui/motion";

export const BRAND_DURATION = TIMELINE.brand;

export const Logo: React.FC<{ size: number; scale?: number }> = ({ size, scale = 1 }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.28,
      background: STAGE.ink,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transform: `scale(${scale})`,
      boxShadow: `0 0 0 ${size * 0.08}px ${STAGE.accentSoft}, 0 30px 80px rgba(255,178,36,0.25)`,
    }}
  >
    <Icon name="briefcase" size={size * 0.52} color={STAGE.bg} stroke={2.2} />
  </div>
);

export const Brand: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = pop(frame, 2, 11);
  const name = progress(frame, 14, 22);
  const tag = progress(frame, 30, 20);
  const chips = ["TypeScript", "Mastra agents", "DuckDB SQL", "Next.js"];
  return (
    <Stage glow={[50, 40]}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: sceneFade(frame, BRAND_DURATION, 1, 10) }}>
        <Logo size={132} scale={logo} />
        <div
          style={{
            marginTop: 44,
            fontSize: 88,
            fontWeight: 800,
            letterSpacing: "-0.05em",
            color: STAGE.ink,
            clipPath: `inset(0 ${(1 - name) * 100}% 0 0)`,
          }}
        >
          Business Operations Assistant
        </div>
        <div style={{ marginTop: 14, fontSize: 34, color: STAGE.dim, letterSpacing: "-0.015em", opacity: tag, transform: `translateY(${(1 - tag) * 14}px)` }}>
          Upload. Ask. Get computed, cited answers and client ready deliverables.
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 36 }}>
          {chips.map((c, i) => {
            const p = pop(frame, 44 + i * 4, 15);
            return (
              <span
                key={c}
                style={{
                  padding: "10px 20px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.04)",
                  color: STAGE.ink,
                  fontSize: 22,
                  opacity: p,
                  transform: `translateY(${(1 - p) * 16}px)`,
                }}
              >
                {c}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
