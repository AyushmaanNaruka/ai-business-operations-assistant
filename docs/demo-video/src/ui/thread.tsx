import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { FONT, UI } from "../theme";
import { Icon } from "./Icons";
import { ToolRow } from "./parts";
import { progress } from "./motion";

/** A specialist's run, shown as the nested steps behind one handle_request call. */
export const SpecialistCard: React.FC<{
  agent: string;
  at: number;
  collapseAt: number;
  height: number;
  children: React.ReactNode;
}> = ({ agent, at, collapseAt, height, children }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const open = progress(frame, at, 12) * (1 - progress(frame, collapseAt, 14));
  return (
    <div style={{ height: height * open, overflow: "hidden", opacity: Math.min(1, open * 1.5) }}>
      <div style={{ marginLeft: 7, paddingLeft: 18, borderLeft: `2px solid ${UI.border}`, paddingTop: 4, paddingBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: UI.mutedForeground, padding: "4px 0" }}>
          {agent}
        </div>
        {children}
      </div>
    </div>
  );
};

const KEYWORDS = /\b(SELECT|FROM|GROUP BY|ORDER BY|AS|SUM|WHERE|DESC|AND|ON|WITH|COUNT|DISTINCT)\b/g;

/** A SQL block that types itself out, with light keyword highlighting. */
export const SqlBlock: React.FC<{ sql: string; start: number; cps?: number }> = ({ sql, start, cps = 90 }) => {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.floor(((frame - start) / 30) * cps));
  const shown = sql.slice(0, n);
  const parts = shown.split(KEYWORDS);
  const done = n >= sql.length;
  return (
    <div
      style={{
        margin: "6px 0 8px",
        background: "#0d0d0d",
        color: "#e5e5e5",
        borderRadius: 12,
        padding: "14px 18px",
        fontFamily: FONT.mono,
        fontSize: 14,
        lineHeight: 1.6,
        whiteSpace: "pre",
        position: "relative",
      }}
    >
      <div style={{ position: "absolute", right: 14, top: 10, fontFamily: FONT.sans, fontSize: 11, color: "#8f8f8f", letterSpacing: "0.05em" }}>
        DUCKDB
      </div>
      {parts.map((p, i) =>
        p.match(KEYWORDS) ? (
          <span key={i} style={{ color: "#ffb224" }}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
      {!done && frame >= start && <span style={{ background: "#e5e5e5", width: 8, display: "inline-block", height: 16, verticalAlign: -3 }} />}
    </div>
  );
};

export const Bars: React.FC<{
  rows: { name: string; value: number; label: string; tone?: "bad" | "good" }[];
  start: number;
  title: string;
  footer: string;
}> = ({ rows, start, title, footer }) => {
  const frame = useCurrentFrame();
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div style={{ border: `1px solid ${UI.border}`, borderRadius: 16, padding: "18px 22px 14px", background: "#fff" }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {rows.map((r, i) => {
        const p = progress(frame, start + i * 4, 26);
        const color = r.tone === "bad" ? UI.destructive : r.tone === "good" ? "#0d0d0d" : "#8f8f8f";
        return (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 12, height: 34 }}>
            <div style={{ width: 96, fontSize: 13, color: "#3f3f3f" }}>{r.name}</div>
            <div style={{ flex: 1, height: 20, background: UI.muted, borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${(r.value / max) * 100 * p}%`, height: "100%", background: color, borderRadius: 6 }} />
            </div>
            <div style={{ width: 54, textAlign: "right", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", opacity: p }}>
              {r.label}
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: UI.mutedForeground,
                border: `1px solid ${UI.border}`,
                borderRadius: 6,
                padding: "1px 5px",
                opacity: p,
              }}
            >
              E{i + 4}
            </span>
          </div>
        );
      })}
      <div style={{ fontSize: 12, color: UI.mutedForeground, marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <Icon name="database" size={13} /> {footer}
      </div>
    </div>
  );
};

export const Warnings: React.FC<{ items: string[]; start: number; title?: string }> = ({ items, start, title = "Data quality, handled before any number was computed" }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ background: "#fffaf0", border: "1px solid #fde2a8", borderRadius: 16, padding: "14px 20px" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#8a5a00", marginBottom: 6 }}>{title}</div>
      {items.map((t, i) => {
        const p = progress(frame, start + i * 9, 14);
        return (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              fontSize: 14,
              lineHeight: 1.5,
              padding: "5px 0",
              opacity: p,
              transform: `translateX(${(1 - p) * 12}px)`,
            }}
          >
            <Icon name="alert" size={16} color="#d98a00" style={{ marginTop: 2 }} />
            <span>{t}</span>
          </div>
        );
      })}
    </div>
  );
};

/** Frame-driven vertical scroll for the thread. */
export function useScroll(keys: [number, number][]): number {
  const frame = useCurrentFrame();
  return interpolate(
    frame,
    keys.map((k) => k[0]),
    keys.map((k) => k[1]),
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
}

export { ToolRow };
