import { TIMELINE } from "../timeline";
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { FONT, STAGE } from "../theme";
import { Icon, type IconName } from "../ui/Icons";
import { Headline, Stage } from "../ui/parts";
import { pop, progress, sceneFade } from "../ui/motion";

export const AGENTS_DURATION = TIMELINE.agents;

const ORCH = { x: 960, y: 370, w: 560, h: 116 };
const LEDGER = { x: 960, y: 918, w: 1560, h: 104 };
const CHILD_Y = 650;
const CHILD_W = 356;
const CHILD_H = 176;

const CHILDREN: { title: string; icon: IconName; tools: string[]; foot: string; x: number }[] = [
  { title: "Data Analyst", icon: "database", tools: ["describe_dataset", "run_sql", "compute_stats"], foot: "DuckDB · numbers by SQL", x: 300 },
  { title: "Document Agent", icon: "file", tools: ["get_document", "search_documents"], foot: "Whole doc or RAG, by size", x: 740 },
  { title: "Research Agent", icon: "globe", tools: ["web_search", "read_page", "crawl_site"], foot: "Public URLs, dated", x: 1180 },
  { title: "Artifact Workflow", icon: "slides", tools: ["8 steps", "1 model call"], foot: "xlsx · pptx · docx · pdf", x: 1620 },
];

const EVIDENCE = [
  "E4 · SQL · campaigns.xlsx",
  "E9 · p.3 · northwind-brief.pdf",
  "E12 · customer-notes.docx",
  "E17 · URL · read 26 Sep",
  "E21 · stats · conversion_rate",
  "E24 · SQL · campaigns.xlsx",
];

function curve(x1: number, y1: number, x2: number, y2: number) {
  const my = (y1 + y2) / 2;
  return { d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`, pts: [x1, y1, x1, my, x2, my, x2, y2] };
}

function bez(t: number, p: number[]) {
  const u = 1 - t;
  const x = u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6];
  const y = u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7];
  return [x, y];
}

const Wire: React.FC<{ c: ReturnType<typeof curve>; drawAt: number; pulses: number[]; color?: string }> = ({ c, drawAt, pulses, color = STAGE.accent }) => {
  const frame = useCurrentFrame();
  const draw = progress(frame, drawAt, 24);
  return (
    <g>
      <path d={c.d} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={2} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} />
      {pulses.map((start, i) => {
        const t = progress(frame, start, 30);
        if (t <= 0 || t >= 1) return null;
        const [x, y] = bez(t, c.pts);
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={14} fill={color} opacity={0.18} />
            <circle cx={x} cy={y} r={6} fill={color} />
          </g>
        );
      })}
    </g>
  );
};

const Box: React.FC<{ x: number; y: number; w: number; h: number; at: number; children: React.ReactNode; strong?: boolean }> = ({
  x,
  y,
  w,
  h,
  at,
  children,
  strong,
}) => {
  const frame = useCurrentFrame();
  const p = pop(frame, at, 14);
  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        borderRadius: 22,
        background: strong ? "rgba(255,178,36,0.10)" : "rgba(255,255,255,0.045)",
        border: `1px solid ${strong ? "rgba(255,178,36,0.55)" : "rgba(255,255,255,0.13)"}`,
        boxShadow: strong ? "0 0 80px rgba(255,178,36,0.18)" : "0 20px 60px rgba(0,0,0,0.4)",
        opacity: p,
        transform: `translateY(${(1 - p) * 30}px) scale(${0.92 + p * 0.08})`,
        color: STAGE.ink,
        padding: "20px 24px",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
};

export const Agents: React.FC = () => {
  const frame = useCurrentFrame();
  const orchBottom = ORCH.y + ORCH.h / 2;
  const down = CHILDREN.map((c) => curve(ORCH.x, orchBottom, c.x, CHILD_Y - CHILD_H / 2));
  const toLedger = CHILDREN.map((c) => curve(c.x, CHILD_Y + CHILD_H / 2, c.x, LEDGER.y - LEDGER.h / 2));
  const tick = frame > 150 ? Math.floor((frame - 150) / 16) : -1;
  return (
    <Stage glow={[50, 30]}>
      <div style={{ position: "absolute", inset: 0, opacity: sceneFade(frame, AGENTS_DURATION, 8, 10) }}>
        <Headline
          text="One orchestrator. Three specialists."
          accent="specialists"
          top={56}
          size={60}
          start={2}
          sub="They talk in typed contracts, not shared chat history. Two levels deep, by design."
        />
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          {down.map((c, i) => (
            <Wire key={`d${i}`} c={c} drawAt={40 + i * 5} pulses={[78 + i * 6, 190 + i * 7]} />
          ))}
          {toLedger.map((c, i) => (
            <Wire key={`l${i}`} c={c} drawAt={70 + i * 5} pulses={[128 + i * 8, 236 + i * 5]} color={STAGE.good} />
          ))}
        </svg>

        <Box {...ORCH} x={ORCH.x} y={ORCH.y} at={20} strong>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ width: 52, height: 52, borderRadius: 14, background: STAGE.accent, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Icon name="cpu" size={28} color={STAGE.bg} />
            </span>
            <div>
              <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>Orchestrator</div>
              <div style={{ fontSize: 17, color: STAGE.dim, marginTop: 2 }}>Reads the session, plans, delegates, assembles from evidence</div>
            </div>
          </div>
        </Box>

        {CHILDREN.map((c, i) => (
          <Box key={c.title} x={c.x} y={CHILD_Y} w={CHILD_W} h={CHILD_H} at={50 + i * 6}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Icon name={c.icon} size={26} color={STAGE.accent} />
              <div style={{ fontSize: 25, fontWeight: 700, letterSpacing: "-0.02em" }}>{c.title}</div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 16 }}>
              {c.tools.map((t) => (
                <span
                  key={t}
                  style={{
                    fontFamily: FONT.mono,
                    fontSize: 14,
                    padding: "4px 9px",
                    borderRadius: 8,
                    background: "rgba(255,255,255,0.07)",
                    color: "#e4e4e7",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
            <div style={{ fontSize: 15, color: STAGE.dim, marginTop: 14 }}>{c.foot}</div>
          </Box>
        ))}

        <Box x={LEDGER.x} y={LEDGER.y} w={LEDGER.w} h={LEDGER.h} at={96}>
          <div style={{ display: "flex", alignItems: "center", gap: 24, height: "100%", marginTop: -6 }}>
            <div style={{ flexShrink: 0 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: STAGE.good, letterSpacing: "-0.02em" }}>Evidence Ledger</div>
              <div style={{ fontSize: 15, color: STAGE.dim }}>every fact, its origin, its method</div>
            </div>
            <div style={{ display: "flex", gap: 10, overflow: "hidden", flex: 1 }}>
              {EVIDENCE.map((e, i) => {
                const p = interpolate(tick, [i - 1, i], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
                return (
                  <span
                    key={e}
                    style={{
                      flexShrink: 0,
                      fontFamily: FONT.mono,
                      fontSize: 15,
                      padding: "8px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(61,220,132,0.35)",
                      background: "rgba(61,220,132,0.08)",
                      color: "#c9f7dc",
                      opacity: p,
                      transform: `translateY(${(1 - p) * 14}px)`,
                    }}
                  >
                    {e}
                  </span>
                );
              })}
            </div>
          </div>
        </Box>
      </div>
    </Stage>
  );
};
