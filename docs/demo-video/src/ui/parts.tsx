import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { FONT, KIND, STAGE, UI, type Kind } from "../theme";
import { Icon, type IconName } from "./Icons";
import { pop, progress } from "./motion";

/* ---------- Stage: the dark world the product floats in ---------- */

export const Stage: React.FC<{ children: React.ReactNode; glow?: [number, number] }> = ({ children, glow = [70, 20] }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 4;
  return (
    <AbsoluteFill style={{ background: STAGE.bg, fontFamily: FONT.sans, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 600px at ${glow[0] + drift}% ${glow[1]}%, rgba(255,178,36,0.16), transparent 70%),
            radial-gradient(700px 500px at ${100 - glow[0]}% 100%, rgba(255,255,255,0.05), transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

/* ---------- Headline: words rise in, one accent word in serif italic ---------- */

export const Headline: React.FC<{
  text: string;
  accent?: string;
  start?: number;
  size?: number;
  top?: number;
  sub?: string;
  exitAt?: number;
  align?: "center" | "left";
  left?: number;
}> = ({ text, accent, start = 0, size = 64, top = 70, sub, exitAt, align = "center", left = 0 }) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  const exit = exitAt === undefined ? 0 : progress(frame, exitAt, 12);
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: align === "center" ? 0 : left,
        right: align === "center" ? 0 : undefined,
        textAlign: align,
        opacity: 1 - exit,
        transform: `translateY(${-exit * 20}px)`,
        zIndex: 50,
      }}
    >
      <div style={{ fontSize: size, fontWeight: 700, letterSpacing: "-0.035em", color: STAGE.ink, lineHeight: 1.05 }}>
        {words.map((w, i) => {
          const p = progress(frame, start + i * 3, 16);
          const isAccent = accent !== undefined && w.replace(/[.,!?]/g, "") === accent;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: "0.26em",
                opacity: p,
                filter: `blur(${(1 - p) * 8}px)`,
                transform: `translateY(${(1 - p) * 26}px)`,
                fontFamily: isAccent ? FONT.serif : undefined,
                fontStyle: isAccent ? "italic" : undefined,
                fontWeight: isAccent ? 400 : undefined,
                color: isAccent ? STAGE.accent : undefined,
                fontSize: isAccent ? "1.12em" : undefined,
                letterSpacing: isAccent ? "-0.01em" : undefined,
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      {sub && (
        <div
          style={{
            marginTop: 16,
            fontSize: size * 0.36,
            color: STAGE.dim,
            fontWeight: 400,
            letterSpacing: "-0.01em",
            opacity: progress(frame, start + words.length * 3 + 4, 18),
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
};

/* ---------- Caption pill: a lower third over a zoomed shot ---------- */

export const Caption: React.FC<{ text: string; start: number; end: number; icon?: IconName; bottom?: number }> = ({
  text,
  start,
  end,
  icon = "sparkle",
  bottom = 64,
}) => {
  const frame = useCurrentFrame();
  const inP = pop(frame, start, 16);
  const out = progress(frame, end - 10, 10);
  if (frame < start || frame > end) return null;
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom, display: "flex", justifyContent: "center", zIndex: 60 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "18px 30px",
          borderRadius: 999,
          background: "rgba(9,9,11,0.86)",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          color: STAGE.ink,
          fontSize: 32,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          opacity: inP * (1 - out),
          transform: `translateY(${(1 - inP) * 30}px) scale(${0.94 + inP * 0.06})`,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            width: 40,
            height: 40,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            background: STAGE.accentSoft,
          }}
        >
          <Icon name={icon} size={22} color={STAGE.accent} />
        </span>
        {text}
      </div>
    </div>
  );
};

/* ---------- App level pieces, drawn to match the real UI ---------- */

const KIND_ICON: Record<Kind, IconName> = { pdf: "file", xlsx: "sheet", docx: "file", pptx: "slides", txt: "file", web: "globe" };

export const FileTile: React.FC<{ kind: Kind; size?: number }> = ({ kind, size = 32 }) => (
  <span
    style={{
      display: "inline-flex",
      width: size,
      height: size,
      borderRadius: size * 0.25,
      alignItems: "center",
      justifyContent: "center",
      background: KIND[kind],
      flexShrink: 0,
    }}
  >
    <Icon name={KIND_ICON[kind]} size={size * 0.5} color="#fff" />
  </span>
);

export const Spinner: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = UI.mutedForeground }) => {
  const frame = useCurrentFrame();
  return (
    <span style={{ display: "inline-flex", transform: `rotate(${frame * 18}deg)` }}>
      <Icon name="loader" size={size} color={color} />
    </span>
  );
};

/** "Used tool: <name>" exactly as the app shows it, with a running state that shimmers. */
export const ToolRow: React.FC<{ name: string; start: number; done: number; note?: string }> = ({ name, start, done, note }) => {
  const frame = useCurrentFrame();
  if (frame < start) return null;
  const p = progress(frame, start, 10);
  const running = frame < done;
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(frame / 7));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        fontSize: 14,
        color: UI.mutedForeground,
        opacity: p,
        transform: `translateY(${(1 - p) * 6}px)`,
      }}
    >
      {running ? <Spinner /> : <Icon name="check" size={16} />}
      <span style={{ opacity: running ? pulse : 1 }}>
        {running ? "Using tool" : "Used tool"}: <b style={{ color: "#3f3f3f" }}>{name}</b>
      </span>
      {note && (
        <span
          style={{
            fontSize: 12,
            padding: "2px 8px",
            borderRadius: 999,
            background: UI.muted,
            color: "#3f3f3f",
            fontWeight: 500,
          }}
        >
          {note}
        </span>
      )}
      <Icon name="chevron" size={16} />
    </div>
  );
};

export const UserBubble: React.FC<{ text: string; at: number }> = ({ text, at }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const p = pop(frame, at, 16);
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", opacity: p, transform: `translateY(${(1 - p) * 20}px)` }}>
      <div
        style={{
          maxWidth: "72%",
          background: UI.muted,
          borderRadius: 24,
          padding: "12px 20px",
          fontSize: 16,
          lineHeight: 1.6,
          color: UI.foreground,
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** Reveals text word by word, the way a streamed answer lands. */
export const Stream: React.FC<{ text: string; start: number; wps?: number; style?: React.CSSProperties }> = ({
  text,
  start,
  wps = 22,
  style,
}) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  const shown = Math.max(0, Math.floor(((frame - start) / 30) * wps));
  if (frame < start) return null;
  return (
    <span style={style}>
      {words.map((w, i) => (
        <span key={i} style={{ opacity: i < shown ? 1 : i === shown ? 0.35 : 0 }}>
          {w}{" "}
        </span>
      ))}
    </span>
  );
};

export const FadeUp: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties; dist?: number }> = ({
  at,
  children,
  style,
  dist = 14,
}) => {
  const frame = useCurrentFrame();
  const p = progress(frame, at, 14);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * dist}px)`, ...style }}>{children}</div>;
};

export function useCount(to: number, start: number, duration: number, decimals = 0): string {
  const frame = useCurrentFrame();
  const v = interpolate(progress(frame, start, duration), [0, 1], [0, to]);
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
