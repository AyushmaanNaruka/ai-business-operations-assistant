import { TIMELINE } from "../timeline";
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { FONT, STAGE } from "../theme";
import { Stage } from "../ui/parts";
import { progress, sceneFade } from "../ui/motion";

export const HOOK_DURATION = TIMELINE.hook;

const Line: React.FC<{ words: string[]; start: number; size: number; accentIndex?: number; strikeAt?: number }> = ({
  words,
  start,
  size,
  accentIndex,
  strikeAt,
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ fontSize: size, fontWeight: 700, letterSpacing: "-0.045em", color: STAGE.ink, lineHeight: 1.08 }}>
      {words.map((w, i) => {
        const p = progress(frame, start + i * 4, 18);
        const accent = i === accentIndex;
        const strike = accent && strikeAt !== undefined ? progress(frame, strikeAt, 12) : 0;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              position: "relative",
              marginRight: "0.24em",
              opacity: p,
              filter: `blur(${(1 - p) * 10}px)`,
              transform: `translateY(${(1 - p) * 40}px)`,
              fontFamily: accent ? FONT.serif : undefined,
              fontStyle: accent ? "italic" : undefined,
              fontWeight: accent ? 400 : undefined,
              color: accent ? (strike > 0.5 ? STAGE.dim : STAGE.danger) : undefined,
              fontSize: accent ? "1.12em" : undefined,
            }}
          >
            {w}
            {accent && strikeAt !== undefined && (
              <span
                style={{
                  position: "absolute",
                  left: "-4%",
                  top: "54%",
                  height: size * 0.07,
                  width: `${strike * 108}%`,
                  background: STAGE.danger,
                  borderRadius: 4,
                }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
};

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const third = progress(frame, 74, 18);
  return (
    <Stage glow={[50, 50]}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          opacity: sceneFade(frame, HOOK_DURATION, 1, 10),
          transform: `scale(${1 + frame * 0.0006})`,
        }}
      >
        <Line words={["Your", "files", "hold", "the", "answers."]} start={4} size={104} />
        <Line words={["Most", "AI", "just", "guesses", "them."]} start={28} size={104} accentIndex={3} strikeAt={62} />
        <div
          style={{
            marginTop: 40,
            fontSize: 44,
            fontWeight: 500,
            color: STAGE.accent,
            letterSpacing: "-0.02em",
            opacity: third,
            transform: `translateY(${(1 - third) * 20}px)`,
          }}
        >
          This one computes them.
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
