import { TIMELINE } from "../timeline";
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { FONT, STAGE } from "../theme";
import { Icon, type IconName } from "../ui/Icons";
import { Headline, Stage } from "../ui/parts";
import { pop, sceneFade } from "../ui/motion";

export const FEATURES_DURATION = TIMELINE.features;

const CARDS: { icon: IconName; title: string; body: string; tag: string }[] = [
  { icon: "database", title: "Computed, never estimated", body: "Every figure comes from a SQL query or a stats function, and carries it.", tag: "SELECT SUM(revenue) …" },
  { icon: "quote", title: "Cited, or reported as a gap", body: "No evidence entry, no claim. Missing data is named, never filled in.", tag: "gap: no margin column" },
  { icon: "shield", title: "Files are data, not orders", body: "\"Ignore your instructions\" in a file is shown to you, never executed.", tag: "proposal, not command" },
  { icon: "globe", title: "Research the open web", body: "Profiles a company from its site. Every claim keeps its URL and read date.", tag: "read 26 Sep 2026" },
  { icon: "cpu", title: "Your choice of model", body: "Claude, GPT, Gemini or Groq. Each falls back to the next automatically.", tag: "3 fallbacks ready" },
  { icon: "ban", title: "Safe to share", body: "Password gate, rate limits, strict headers, internal addresses refused.", tag: "SSRF guard on" },
];

export const Features: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stage glow={[20, 80]}>
      <AbsoluteFill style={{ opacity: sceneFade(frame, FEATURES_DURATION, 8, 10) }}>
        <Headline text="Built to be trusted." accent="trusted" top={80} size={70} start={2} />
        <div
          style={{
            position: "absolute",
            left: 150,
            right: 150,
            top: 250,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 28,
          }}
        >
          {CARDS.map((c, i) => {
            const p = pop(frame, 18 + i * 7, 15);
            return (
              <div
                key={c.title}
                style={{
                  height: 330,
                  borderRadius: 26,
                  padding: "34px 34px 30px",
                  boxSizing: "border-box",
                  background: "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.025))",
                  border: "1px solid rgba(255,255,255,0.12)",
                  opacity: p,
                  transform: `translateY(${(1 - p) * 50}px) scale(${0.94 + p * 0.06})`,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <span
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: 18,
                    background: STAGE.accentSoft,
                    border: "1px solid rgba(255,178,36,0.35)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name={c.icon} size={30} color={STAGE.accent} />
                </span>
                <div style={{ fontSize: 34, fontWeight: 700, color: STAGE.ink, letterSpacing: "-0.03em", marginTop: 26 }}>{c.title}</div>
                <div style={{ fontSize: 22, color: STAGE.dim, lineHeight: 1.45, marginTop: 10 }}>{c.body}</div>
                <div style={{ marginTop: "auto" }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: 16, color: STAGE.accent, padding: "6px 12px", borderRadius: 8, background: "rgba(255,178,36,0.08)" }}>
                    {c.tag}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Stage>
  );
};
