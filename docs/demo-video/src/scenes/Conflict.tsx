import { TIMELINE } from "../timeline";
import React from "react";
import { useCurrentFrame } from "remotion";
import { NOTES_QUOTE, PAID_SOCIAL_MONTHLY, PAID_SOCIAL_SHIFT } from "../data";
import { UI } from "../theme";
import { AppShell, CameraRig } from "../ui/AppShell";
import { Icon } from "../ui/Icons";
import { Caption, FadeUp, FileTile, Headline, Stage, Stream, ToolRow, UserBubble } from "../ui/parts";
import { camera, pop, progress, sceneFade, typed } from "../ui/motion";

export const CONFLICT_DURATION = TIMELINE.conflict;

const Q2 = "What does the customer notes file say about Paid Social?";

/** Spend and revenue, each scaled to its own peak, drawn left to right. */
const Spark: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const w = 300;
  const h = 86;
  const p = progress(frame, start, 40);
  const line = (idx: 0 | 1) => {
    const vals = PAID_SOCIAL_MONTHLY.map((m) => m[idx]);
    const max = Math.max(...vals);
    const min = Math.min(...vals) * 0.6;
    return vals
      .map((v, i) => `${i === 0 ? "M" : "L"}${(i / (vals.length - 1)) * w},${h - ((v - min) / (max - min)) * (h - 8) - 4}`)
      .join(" ");
  };
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <clipPath id="reveal">
          <rect x={0} y={-10} width={w * p} height={h + 20} />
        </clipPath>
      </defs>
      <line x1={(w * 12) / 19} x2={(w * 12) / 19} y1={0} y2={h} stroke={UI.border} strokeDasharray="3 4" />
      <g clipPath="url(#reveal)">
        <path d={line(1)} fill="none" stroke="#b4b4b4" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={line(0)} fill="none" stroke={UI.destructive} strokeWidth={3} strokeLinejoin="round" />
      </g>
    </svg>
  );
};

const ConflictCard: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  const p = pop(frame, at, 15);
  const left = pop(frame, at + 8, 15);
  const right = pop(frame, at + 18, 15);
  return (
    <div
      style={{
        border: `1.5px solid ${UI.destructive}`,
        borderRadius: 18,
        overflow: "hidden",
        opacity: p,
        transform: `scale(${0.96 + p * 0.04})`,
        boxShadow: "0 12px 40px rgba(217,45,32,0.12)",
      }}
    >
      <div style={{ background: "#fff1f0", padding: "12px 20px", display: "flex", alignItems: "center", gap: 10, fontSize: 15, fontWeight: 600, color: "#a3140a" }}>
        <Icon name="split" size={18} color={UI.destructive} />
        Conflict: the notes and the numbers disagree about Paid Social
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ padding: "18px 20px", borderRight: `1px solid ${UI.border}`, opacity: left, transform: `translateY(${(1 - left) * 12}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: UI.mutedForeground, marginBottom: 12 }}>
            <FileTile kind="docx" size={26} /> customer-notes.docx · growth team call
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Icon name="quote" size={18} color="#b4b4b4" />
            <div style={{ fontSize: 16, lineHeight: 1.55, fontStyle: "italic" }}>{NOTES_QUOTE}</div>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: UI.mutedForeground }}>Stated as a gut read. No figures given.</div>
        </div>
        <div style={{ padding: "18px 20px", opacity: right, transform: `translateY(${(1 - right) * 12}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: UI.mutedForeground, marginBottom: 10 }}>
            <FileTile kind="xlsx" size={26} /> campaigns.xlsx · run_sql
          </div>
          <div style={{ display: "flex", gap: 22, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 30, fontWeight: 700, color: UI.destructive, letterSpacing: "-0.03em" }}>+{PAID_SOCIAL_SHIFT.spendPct}%</div>
              <div style={{ fontSize: 12, color: UI.mutedForeground }}>spend, last 8 months</div>
            </div>
            <div>
              <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>{PAID_SOCIAL_SHIFT.revenuePct}%</div>
              <div style={{ fontSize: 12, color: UI.mutedForeground }}>revenue, same period</div>
            </div>
          </div>
          <Spark start={at + 24} />
          <div style={{ display: "flex", gap: 14, fontSize: 11, color: UI.mutedForeground, marginTop: 4 }}>
            <span style={{ color: UI.destructive, fontWeight: 600 }}>— spend</span>
            <span>— revenue</span>
            <span>Dec 2024 → Jul 2026</span>
          </div>
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${UI.border}`, padding: "10px 20px", fontSize: 13, color: UI.mutedForeground }}>
        Lowest return of any channel: 26× revenue per dollar, against 214× for Email.
      </div>
    </div>
  );
};

export const Conflict: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = camera(frame, [
    { f: 0, s: 0.76, fx: 800, fy: 472, ty: 640, ry: 4 },
    { f: 50, s: 0.76, fx: 800, fy: 472, ty: 640 },
    { f: 76, s: 1.05, fx: 930, fy: 400, ty: 520 },
    { f: 132, s: 1.05, fx: 930, fy: 400, ty: 520 },
    { f: 170, s: 1.38, fx: 930, fy: 520, ty: 500 },
    { f: 270, s: 1.42, fx: 930, fy: 520, ty: 500 },
  ]);
  return (
    <Stage glow={[30, 20]}>
      <div style={{ opacity: sceneFade(frame, CONFLICT_DURATION, 8, 8) }}>
        <Headline text="When sources disagree, you'll know." accent="disagree" start={2} exitAt={56} sub="Documents and data are checked against each other." />
        <CameraRig {...cam}>
          <AppShell title="Northwind Q3 campaign review" fileCount={4} composerText={frame < 52 ? typed(Q2, frame, 6, 60) : ""} composerCaret={frame < 52}>
            <UserBubble text={Q2} at={54} />
            <div>
              <ToolRow name="read_session_manifest" start={60} done={72} />
              <ToolRow name="handle_request" note="Document Agent" start={76} done={118} />
              <ToolRow name="handle_request" note="Data Analyst" start={80} done={122} />
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.7 }}>
              <Stream start={126} wps={24} text="The notes and the spreadsheet disagree, so I am showing both rather than choosing one:" />
            </div>
            <FadeUp at={138}>
              <ConflictCard at={140} />
            </FadeUp>
          </AppShell>
        </CameraRig>
        <Caption text="Both sides, each with its source. No silent winner." icon="split" start={188} end={270} />
      </div>
    </Stage>
  );
};
