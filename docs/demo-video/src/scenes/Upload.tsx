import { TIMELINE } from "../timeline";
import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { AppShell, CameraRig } from "../ui/AppShell";
import { DEMO_SOURCES, FilesPanel } from "../ui/FilesPanel";
import { Caption, FileTile, Headline, Stage } from "../ui/parts";
import { EASE_IN_OUT, camera, progress, sceneFade } from "../ui/motion";
import type { Kind } from "../theme";

export const UPLOAD_DURATION = TIMELINE.upload;

const FLYING: { name: string; kind: Kind; from: [number, number]; at: number }[] = [
  { name: "campaigns.xlsx", kind: "xlsx", from: [-420, 120], at: 30 },
  { name: "northwind-brief.pdf", kind: "pdf", from: [-380, 520], at: 37 },
  { name: "customer-notes.docx", kind: "docx", from: [-460, 860], at: 44 },
  { name: "research-requirements.txt", kind: "txt", from: [-300, 320], at: 51 },
];
const DROP: [number, number] = [1400, 170];

export const Upload: React.FC = () => {
  const frame = useCurrentFrame();
  const sources = DEMO_SOURCES(52).map((s, i) => (i === 3 ? { ...s, highlight: frame > 160 } : s));
  const count = sources.filter((s) => frame >= s.at).length;
  const cam = camera(frame, [
    { f: 0, s: 0.66, fx: 800, fy: 472, ty: 640, rx: 12, ry: -16 },
    { f: 36, s: 0.76, fx: 800, fy: 472, ty: 640, rx: 3, ry: -4 },
    { f: 130, s: 0.76, fx: 800, fy: 472, ty: 640, rx: 2, ry: -3 },
    { f: 160, s: 1.45, fx: 1040, fy: 330, tx: 960, ty: 480 },
    { f: 240, s: 1.5, fx: 1040, fy: 330, tx: 960, ty: 480 },
  ]);
  return (
    <Stage>
      <div style={{ opacity: sceneFade(frame, UPLOAD_DURATION, 8, 8) }}>
        <Headline text="Drop in everything." accent="everything" sub="Spreadsheets, PDFs, Word docs, notes, or just a company website." start={4} exitAt={134} />
        <CameraRig {...cam}>
          <AppShell
            welcome
            fileCount={count}
            filesActive
            activeChat={-1}
            panel={<FilesPanel sources={sources} dropActive={frame > 40 && frame < 80} />}
            panelIn={1}
          />
          {FLYING.map((f) => {
            const p = progress(frame, f.at, 26, EASE_IN_OUT);
            if (p <= 0 || p >= 1) return null;
            const x = interpolate(p, [0, 1], [f.from[0], DROP[0]]);
            const y = interpolate(p, [0, 1], [f.from[1], DROP[1]]) - Math.sin(p * Math.PI) * 120;
            return (
              <div
                key={f.name}
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 18px 12px 12px",
                  background: "#fff",
                  borderRadius: 14,
                  boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
                  fontSize: 18,
                  fontWeight: 500,
                  transform: `rotate(${(1 - p) * -10}deg) scale(${1.2 - p * 0.5})`,
                  opacity: p > 0.9 ? (1 - p) * 10 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                <FileTile kind={f.kind} size={40} />
                {f.name}
              </div>
            );
          })}
        </CameraRig>
        <Caption text="Instructions inside a file become proposals, never commands." icon="shield" start={165} end={240} />
      </div>
    </Stage>
  );
};
