import { TIMELINE } from "../timeline";
import React from "react";
import { useCurrentFrame } from "remotion";
import { CHANNELS } from "../data";
import { FONT, UI } from "../theme";
import { AppShell, CameraRig } from "../ui/AppShell";
import { DEMO_SOURCES, FilesPanel } from "../ui/FilesPanel";
import { Icon } from "../ui/Icons";
import { Caption, FadeUp, FileTile, Headline, Spinner, Stage, Stream, ToolRow, UserBubble } from "../ui/parts";
import { camera, pop, progress, sceneFade, typed } from "../ui/motion";

export const ARTIFACTS_DURATION = TIMELINE.artifacts;

const Q3 = "Put the campaign metrics into an Excel file and create a presentation for the client";

const STEPS: { name: string; model?: boolean }[] = [
  { name: "Resolve kind" },
  { name: "Gather evidence" },
  { name: "Load skill" },
  { name: "Author typed plan", model: true },
  { name: "Validate schema + house rules" },
  { name: "Render charts" },
  { name: "Render file" },
  { name: "Store and link" },
];

const Workflow: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const step = Math.floor((frame - start) / 13);
  return (
    <div style={{ border: `1px solid ${UI.border}`, borderRadius: 16, padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        <span>Artifact workflow · 2 files in parallel</span>
        <span style={{ color: UI.mutedForeground, fontWeight: 500 }}>{Math.min(8, Math.max(0, step))} / 8</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 18px" }}>
        {STEPS.map((s, i) => {
          const done = step > i;
          const active = step === i;
          return (
            <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: done || active ? UI.foreground : "#b4b4b4" }}>
              {done ? (
                <Icon name="check" size={15} color="#12a150" />
              ) : active ? (
                <Spinner size={15} />
              ) : (
                <span style={{ width: 15, height: 15, borderRadius: 99, border: "1.5px solid #d4d4d4", boxSizing: "border-box" }} />
              )}
              {s.name}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: 6,
                  background: s.model ? "#fff4d6" : UI.muted,
                  color: s.model ? "#8a5a00" : UI.mutedForeground,
                }}
              >
                {s.model ? "MODEL" : "CODE"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ---------- Preview panel: the deck, then the workbook ---------- */

const SlidePreview: React.FC = () => {
  const frame = useCurrentFrame();
  const max = Math.max(...CHANNELS.map((c) => c.roas));
  return (
    <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ aspectRatio: "16 / 9", width: "100%", background: "#fff", borderRadius: 10, boxShadow: "0 0 0 1px #e5e5e5, 0 10px 30px rgba(0,0,0,0.08)", padding: "28px 32px", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#e8710a" }}>CHANNEL PERFORMANCE · 04</div>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", marginTop: 6, lineHeight: 1.15 }}>
          Paid Social is scaling spend, not revenue
        </div>
        <div style={{ display: "flex", gap: 24, flex: 1, marginTop: 16 }}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7, color: "#3f3f3f", width: "38%" }}>
            <li>Spend up 39% in the last 8 months</li>
            <li>Revenue down 12% over the same period</li>
            <li>Email and Webinar return 7× to 8× more per dollar</li>
          </ul>
          <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 12, borderBottom: "1px solid #d4d4d4", paddingBottom: 2 }}>
            {CHANNELS.map((c, i) => {
              const p = progress(frame, 300 + i * 4, 24);
              return (
                <div key={c.name} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
                  <div style={{ fontSize: 10, fontWeight: 600, opacity: p }}>{Math.round(c.roas)}×</div>
                  <div
                    style={{
                      width: "100%",
                      height: `${(c.roas / max) * 78 * p}%`,
                      background: c.name === "Paid Social" ? "#e8710a" : "#0d0d0d",
                      borderRadius: "4px 4px 0 0",
                    }}
                  />
                  <div style={{ fontSize: 9, color: UI.mutedForeground, whiteSpace: "nowrap" }}>{c.name}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize: 9, color: UI.mutedForeground, marginTop: 10 }}>Source: campaigns.xlsx, evidence E4 to E9</div>
      </div>
      <div style={{ background: UI.muted, borderRadius: 12, padding: "12px 16px", fontSize: 13, lineHeight: 1.55 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: UI.mutedForeground, marginBottom: 4 }}>SPEAKER NOTES</div>
        The team's sense that Paid Social is our strongest channel is not supported by the data. Recommend pausing the increase until attribution is checked.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{ flex: 1, aspectRatio: "16 / 9", borderRadius: 4, background: i === 3 ? "#fff" : "#f4f4f4", outline: i === 3 ? "2px solid #e8710a" : "1px solid #e5e5e5" }} />
        ))}
      </div>
    </div>
  );
};

const SHEET_ROWS = [
  ["Email", "15,855", "3,397,115", "=C2/B2", "214.27"],
  ["Webinar", "11,215", "2,000,553", "=C3/B3", "178.38"],
  ["Partner", "27,371", "2,422,844", "=C4/B4", "88.52"],
  ["Content", "25,603", "1,175,197", "=C5/B5", "45.90"],
  ["Paid Search", "523,607", "17,445,997", "=C6/B6", "33.32"],
  ["Paid Social", "322,726", "8,412,534", "=C7/B7", "26.07"],
];

const SheetPreview: React.FC = () => {
  const selected = 6;
  const cell: React.CSSProperties = { borderRight: "1px solid #e5e5e5", borderBottom: "1px solid #e5e5e5", padding: "0 10px", height: 34, display: "flex", alignItems: "center", fontSize: 13 };
  return (
    <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", border: "1px solid #e5e5e5", borderRadius: 10, overflow: "hidden", fontFamily: FONT.mono, fontSize: 15 }}>
        <span style={{ padding: "10px 14px", borderRight: "1px solid #e5e5e5", background: UI.muted, fontWeight: 500 }}>D7</span>
        <span style={{ padding: "10px 14px", color: "#12a150", fontStyle: "italic", fontFamily: FONT.serif, fontSize: 18 }}>fx</span>
        <span style={{ padding: "10px 4px", fontWeight: 500 }}>=C7/B7</span>
      </div>
      <div style={{ border: "1px solid #e5e5e5", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1.2fr 1.1fr", background: "#f9f9f9", fontWeight: 600 }}>
          {["Channel", "Spend", "Revenue", "Revenue per $"].map((h) => (
            <div key={h} style={{ ...cell, fontSize: 12 }}>
              {h}
            </div>
          ))}
        </div>
        {SHEET_ROWS.map((r, i) => (
          <div key={r[0]} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1.2fr 1.1fr", fontVariantNumeric: "tabular-nums" }}>
            <div style={cell}>{r[0]}</div>
            <div style={{ ...cell, justifyContent: "flex-end" }}>{r[1]}</div>
            <div style={{ ...cell, justifyContent: "flex-end" }}>{r[2]}</div>
            <div
              style={{
                ...cell,
                justifyContent: "flex-end",
                background: i + 1 === selected ? "#e8f7ee" : undefined,
                outline: i + 1 === selected ? "2px solid #12a150" : undefined,
                outlineOffset: -2,
                fontWeight: i + 1 === selected ? 600 : 400,
              }}
            >
              {r[4]}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 2, fontSize: 13 }}>
        {["Summary", "Recommendations", "Data", "Calculations", "Sources"].map((s) => (
          <span
            key={s}
            style={{
              padding: "8px 14px",
              borderRadius: "0 0 8px 8px",
              background: s === "Calculations" ? "#fff" : UI.muted,
              borderTop: s === "Calculations" ? "2px solid #12a150" : "2px solid transparent",
              fontWeight: s === "Calculations" ? 600 : 400,
              color: s === "Calculations" ? "#0d0d0d" : UI.mutedForeground,
            }}
          >
            {s}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 12, color: UI.mutedForeground }}>Every recommendation links to the rows that support it.</div>
    </div>
  );
};

const PreviewPanel: React.FC<{ mode: "deck" | "sheet" }> = ({ mode }) => (
  <section style={{ height: "100%", background: "#fff", display: "flex", flexDirection: "column" }}>
    <header style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${UI.border}` }}>
      <FileTile kind={mode === "deck" ? "pptx" : "xlsx"} size={28} />
      <span style={{ fontSize: 14, fontWeight: 600 }}>{mode === "deck" ? "northwind-q3-review.pptx" : "northwind-campaign-metrics.xlsx"}</span>
      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: UI.muted, color: UI.mutedForeground, fontWeight: 600 }}>v1</span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 12px", borderRadius: 99, background: UI.foreground, color: "#fff" }}>
        <Icon name="download" size={14} color="#fff" /> Download
      </span>
    </header>
    {mode === "deck" ? <SlidePreview /> : <SheetPreview />}
  </section>
);

export const Artifacts: React.FC = () => {
  const frame = useCurrentFrame();
  const previewAt = 276;
  const sheetAt = 360;
  const inPreview = frame >= previewAt;
  const artifacts = [
    { title: "northwind-campaign-metrics.xlsx", kind: "xlsx" as const, detail: "Workbook · 5 sheets · v1", at: 232 },
    { title: "northwind-q3-review.pptx", kind: "pptx" as const, detail: "Deck · 10 slides · v1", at: 250 },
  ];
  const count = 4 + artifacts.filter((a) => frame >= a.at).length;
  const sources = DEMO_SOURCES(-200);
  const cam = camera(frame, [
    { f: 0, s: 0.76, fx: 800, fy: 472, ty: 640, ry: -4 },
    { f: 56, s: 0.76, fx: 800, fy: 472, ty: 640 },
    { f: 84, s: 1.02, fx: 900, fy: 440, ty: 540 },
    { f: 200, s: 1.02, fx: 900, fy: 440, ty: 540 },
    { f: 226, s: 1.05, fx: 1080, fy: 400, ty: 540 },
    { f: 270, s: 1.05, fx: 1080, fy: 400, ty: 540 },
    { f: 296, s: 1.12, fx: 1220, fy: 470, ty: 540 },
    { f: 356, s: 1.12, fx: 1220, fy: 470, ty: 540 },
    { f: 380, s: 1.55, fx: 1220, fy: 300, ty: 520 },
    { f: 450, s: 1.6, fx: 1220, fy: 300, ty: 520 },
  ]);
  const panelIn = inPreview ? pop(frame, previewAt, 18) : 1;
  return (
    <Stage glow={[80, 20]}>
      <div style={{ opacity: sceneFade(frame, ARTIFACTS_DURATION, 8, 10) }}>
        <Headline text="From answer to deliverable." accent="deliverable" start={2} exitAt={58} sub="The model writes a typed plan. Code renders the file." />
        <CameraRig {...cam}>
          <AppShell
            title="Northwind Q3 campaign review"
            fileCount={count}
            filesActive={!inPreview}
            composerText={frame < 72 ? typed(Q3, frame, 6, 66) : ""}
            composerCaret={frame < 72}
            panel={inPreview ? <PreviewPanel mode={frame >= sheetAt ? "sheet" : "deck"} /> : <FilesPanel sources={sources} artifacts={artifacts} />}
            panelWidth={inPreview ? 760 : 320}
            panelIn={panelIn}
          >
            <UserBubble text={Q3} at={74} />
            <div style={{ fontSize: 16, lineHeight: 1.7 }}>
              <Stream start={84} wps={30} text="Here is the plan. Both files are built from the evidence already gathered:" />
              <FadeUp at={96}>
                <ol style={{ margin: "6px 0 0", paddingLeft: 22 }}>
                  <li>
                    <b>Excel workbook</b>: Summary, Recommendations, Data, Calculations, Sources. Live formulas.
                  </li>
                  <li>
                    <b>Client deck</b>: 10 slides, native charts, speaker notes on every slide.
                  </li>
                </ol>
              </FadeUp>
            </div>
            <div>
              <ToolRow name="request_artifact" note="workbook" start={108} done={226} />
              <ToolRow name="request_artifact" note="deck" start={112} done={244} />
            </div>
            <FadeUp at={118}>
              <Workflow start={124} />
            </FadeUp>
          </AppShell>
        </CameraRig>
        <Caption text="Native, editable charts. Speaker notes on every slide." icon="slides" start={300} end={358} />
        <Caption text="Live formulas you can click and check." icon="sheet" start={384} end={450} />
      </div>
    </Stage>
  );
};
