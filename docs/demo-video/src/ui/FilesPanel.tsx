import React from "react";
import { useCurrentFrame } from "remotion";
import { UI, type Kind } from "../theme";
import { Icon } from "./Icons";
import { FileTile, Spinner } from "./parts";
import { pop } from "./motion";

export type SourceRow = { name: string; kind: Kind; label: string; detail: string; at: number; readyAt: number; highlight?: boolean };
export type ArtifactRow = { title: string; kind: Kind; detail: string; at: number };

/** The Files panel (app/components/sources-panel.tsx): drop zone, sources with status, generated files. */
export const FilesPanel: React.FC<{ sources: SourceRow[]; artifacts?: ArtifactRow[]; dropActive?: boolean }> = ({
  sources,
  artifacts = [],
  dropActive = false,
}) => {
  const frame = useCurrentFrame();
  return (
    <section style={{ height: "100%", display: "flex", flexDirection: "column", background: "#fff" }}>
      <header style={{ height: 56, display: "flex", alignItems: "center", padding: "0 16px", borderBottom: `1px solid ${UI.border}`, fontSize: 14, fontWeight: 600 }}>
        Files
      </header>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 22 }}>
        <div
          style={{
            border: `1.5px dashed ${dropActive ? UI.foreground : "#d4d4d4"}`,
            background: dropActive ? UI.muted : "#fff",
            borderRadius: 16,
            padding: "20px 12px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
          }}
        >
          <span style={{ width: 36, height: 36, borderRadius: 99, background: UI.muted, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            {dropActive ? <Spinner /> : <Icon name="download" size={16} style={{ transform: "rotate(180deg)" }} />}
          </span>
          <span>
            Drop files or <u style={{ fontWeight: 500 }}>browse</u>
          </span>
          <span style={{ fontSize: 12, color: UI.mutedForeground }}>Excel, CSV, PDF, Word, text or JSON</span>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 500, color: UI.mutedForeground, padding: "0 8px 6px" }}>Sources</div>
          {sources.map((s) => {
            if (frame < s.at) return null;
            const p = pop(frame, s.at, 15);
            const ready = frame >= s.readyAt;
            return (
              <div
                key={s.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 8,
                  borderRadius: 12,
                  background: s.highlight && ready ? "#fff7e6" : "transparent",
                  outline: s.highlight && ready ? "1.5px solid #ffb224" : "none",
                  opacity: p,
                  transform: `translateX(${(1 - p) * 40}px)`,
                }}
              >
                <FileTile kind={s.kind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: UI.mutedForeground, whiteSpace: "nowrap" }}>
                    {s.label} · {ready ? s.detail : "Reading…"}
                  </div>
                </div>
                {ready ? <Icon name="check" size={16} color="#12a150" /> : <Spinner />}
              </div>
            );
          })}
        </div>

        {artifacts.some((a) => frame >= a.at) && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: UI.mutedForeground, padding: "0 8px 6px" }}>Generated</div>
            {artifacts.map((a) => {
              if (frame < a.at) return null;
              const p = pop(frame, a.at, 13);
              return (
                <div
                  key={a.title}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 8,
                    borderRadius: 12,
                    background: UI.muted,
                    marginBottom: 4,
                    opacity: p,
                    transform: `scale(${0.9 + p * 0.1})`,
                  }}
                >
                  <FileTile kind={a.kind} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</div>
                    <div style={{ fontSize: 12, color: UI.mutedForeground }}>{a.detail}</div>
                  </div>
                  <Icon name="download" size={16} color={UI.mutedForeground} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export const DEMO_SOURCES = (t: number): SourceRow[] => [
  { name: "campaigns.xlsx", kind: "xlsx", label: "Spreadsheet", detail: "1,203 rows · 11 columns", at: t, readyAt: t + 34 },
  { name: "northwind-brief.pdf", kind: "pdf", label: "PDF", detail: "4 pages · 1 table", at: t + 8, readyAt: t + 44 },
  { name: "customer-notes.docx", kind: "docx", label: "Document", detail: "Ready", at: t + 16, readyAt: t + 50 },
  { name: "research-requirements.txt", kind: "txt", label: "Text", detail: "6 proposed tasks", at: t + 24, readyAt: t + 58 },
];
