import React from "react";
import { useCurrentFrame } from "remotion";
import { FONT, UI } from "../theme";
import { Icon } from "./Icons";
import { progress } from "./motion";

export const APP_W = 1600;
export const APP_H = 900;
export const CHROME_H = 44;
export const SIDEBAR_W = 260;

const CHATS_TODAY = ["Northwind Q3 campaign review", "Research acme.io positioning", "Pricing page teardown", "Webinar funnel check"];
const CHATS_YESTERDAY = ["Board pack numbers", "Churn notes summary"];

type Props = {
  title?: string;
  fileCount?: number;
  filesActive?: boolean;
  /** Which "Today" chat is highlighted; -1 for none. */
  activeChat?: number;
  panel?: React.ReactNode;
  panelWidth?: number;
  /** 0 to 1: how far the right panel has slid in. */
  panelIn?: number;
  composerText?: string;
  composerCaret?: boolean;
  /** True: the empty chat layout, composer centred under the welcome line. */
  welcome?: boolean;
  /** Pixels the thread has scrolled. */
  scroll?: number;
  children?: React.ReactNode;
};

/** The real chat UI (app/app/assistant.tsx) in a browser window, drawn frame by frame. */
export const AppShell: React.FC<Props> = ({
  title = "Business Operations Assistant",
  fileCount = 0,
  filesActive = false,
  activeChat = 0,
  panel,
  panelWidth = 320,
  panelIn = 1,
  composerText = "",
  composerCaret = false,
  welcome = false,
  scroll = 0,
  children,
}) => {
  const frame = useCurrentFrame();
  const pw = panel ? panelWidth * panelIn : 0;
  return (
    <div
      style={{
        width: APP_W,
        height: APP_H + CHROME_H,
        borderRadius: 18,
        overflow: "hidden",
        background: UI.background,
        boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 40px 120px rgba(0,0,0,0.6), 0 12px 30px rgba(0,0,0,0.35)",
        fontFamily: FONT.sans,
        color: UI.foreground,
        position: "relative",
      }}
    >
      {/* Browser chrome */}
      <div
        style={{
          height: CHROME_H,
          background: "#ececec",
          borderBottom: `1px solid ${UI.border}`,
          display: "flex",
          alignItems: "center",
          padding: "0 18px",
          gap: 8,
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
        ))}
        <div
          style={{
            margin: "0 auto",
            width: 460,
            height: 28,
            borderRadius: 8,
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontSize: 13,
            color: UI.mutedForeground,
          }}
        >
          <Icon name="shield" size={13} />
          ops.northwind.internal
        </div>
        <span style={{ width: 52 }} />
      </div>

      <div style={{ display: "flex", height: APP_H }}>
        {/* Sidebar */}
        <nav style={{ width: SIDEBAR_W, background: UI.sidebar, display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: UI.foreground,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="briefcase" size={16} color="#fff" />
              </span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Business Ops</span>
            </div>
            <Icon name="panel" size={18} color={UI.mutedForeground} />
          </div>
          <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
            <SideItem icon="pen" label="New chat" bold />
            <SideItem icon="search" label="Search chats" muted />
          </div>
          <div style={{ padding: "0 8px", flex: 1 }}>
            <Group label="Today" />
            {CHATS_TODAY.map((c, i) => (
              <ChatRow key={c} label={c} active={i === activeChat} />
            ))}
            <Group label="Yesterday" />
            {CHATS_YESTERDAY.map((c) => (
              <ChatRow key={c} label={c} />
            ))}
          </div>
          <div style={{ borderTop: `1px solid ${UI.accent}`, padding: "12px 16px", fontSize: 12, color: UI.mutedForeground, lineHeight: 1.6 }}>
            Answers are computed from your files and cited.
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ width: 7, height: 7, borderRadius: 9, background: "#12a150" }} />
              Model: claude-sonnet-5, 3 fallbacks
            </div>
          </div>
        </nav>

        {/* Main */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
          <header style={{ height: 56, display: "flex", alignItems: "center", padding: "0 20px", flexShrink: 0 }}>
            <h1 style={{ fontSize: 15, fontWeight: 500, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {title}
            </h1>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 36,
                padding: "0 12px",
                borderRadius: 999,
                fontSize: 14,
                background: filesActive ? UI.muted : "transparent",
              }}
            >
              <Icon name="folder" size={16} />
              Files
              {fileCount > 0 && (
                <span
                  style={{
                    minWidth: 20,
                    height: 20,
                    borderRadius: 99,
                    background: UI.foreground,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 6px",
                  }}
                >
                  {fileCount}
                </span>
              )}
            </div>
          </header>

          <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            {welcome ? (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em" }}>What can I help with?</div>
                <div style={{ fontSize: 14, color: UI.mutedForeground, marginTop: 8, marginBottom: 32 }}>
                  Upload a spreadsheet, a PDF or a Word file, or name a company to research.
                </div>
                <Composer text={composerText} caret={composerCaret} frame={frame} />
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  {["Analyse my data", "Summarise a document", "Research a company", "Build a client deck"].map((s) => (
                    <span key={s} style={{ border: `1px solid ${UI.border}`, borderRadius: 999, padding: "8px 14px", fontSize: 14 }}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div style={{ position: "absolute", left: 0, right: 0, top: 0, transform: `translateY(${-scroll}px)` }}>
                  <div style={{ width: 768, margin: "0 auto", padding: "16px 16px 240px", display: "flex", flexDirection: "column", gap: 20 }}>
                    {children}
                  </div>
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: "linear-gradient(to bottom, rgba(255,255,255,0), #fff 28%)",
                    paddingTop: 36,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                  }}
                >
                  <Composer text={composerText} caret={composerCaret} frame={frame} />
                  <div style={{ fontSize: 12, color: UI.mutedForeground, padding: "10px 0 18px" }}>
                    Figures are computed from your files and cited. Check anything important.
                  </div>
                </div>
              </>
            )}
          </div>
        </main>

        {/* Right panel */}
        {panel && (
          <aside style={{ width: pw, flexShrink: 0, borderLeft: `1px solid ${UI.border}`, overflow: "hidden", position: "relative" }}>
            <div style={{ width: panelWidth, height: "100%", position: "absolute", left: 0, top: 0, opacity: panelIn }}>{panel}</div>
          </aside>
        )}
      </div>
    </div>
  );
};

const SideItem: React.FC<{ icon: "pen" | "search"; label: string; bold?: boolean; muted?: boolean }> = ({ icon, label, bold, muted }) => (
  <div
    style={{
      height: 36,
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "0 10px",
      fontSize: 14,
      fontWeight: bold ? 500 : 400,
      color: muted ? UI.mutedForeground : UI.foreground,
    }}
  >
    <Icon name={icon} size={16} color={muted ? UI.mutedForeground : UI.foreground} />
    {label}
  </div>
);

const Group: React.FC<{ label: string }> = ({ label }) => (
  <div style={{ padding: "18px 10px 6px", fontSize: 12, fontWeight: 500, color: UI.mutedForeground }}>{label}</div>
);

const ChatRow: React.FC<{ label: string; active?: boolean }> = ({ label, active }) => (
  <div
    style={{
      height: 36,
      display: "flex",
      alignItems: "center",
      padding: "0 10px",
      borderRadius: 8,
      fontSize: 14,
      background: active ? UI.accent : "transparent",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
    }}
  >
    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
  </div>
);

export const Composer: React.FC<{ text: string; caret?: boolean; frame: number; width?: number }> = ({ text, caret, frame, width = 736 }) => {
  const blink = Math.floor(frame / 15) % 2 === 0;
  const has = text.length > 0;
  return (
    <div
      style={{
        width,
        borderRadius: 28,
        border: `1px solid ${has || caret ? "#cfcfcf" : UI.border}`,
        boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
        background: "#fff",
        padding: "16px 12px 10px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ fontSize: 16, minHeight: 24, lineHeight: 1.5, color: has ? UI.foreground : UI.mutedForeground, paddingRight: 10 }}>
        {has ? text : "Ask anything"}
        {caret && blink && <span style={{ display: "inline-block", width: 2, height: 20, background: UI.foreground, marginLeft: 2, verticalAlign: -4 }} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Icon name="clip" size={18} />
        <span
          style={{
            width: 34,
            height: 34,
            borderRadius: 99,
            background: has ? UI.foreground : "#e5e5e5",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="arrowUp" size={18} color="#fff" />
        </span>
      </div>
    </div>
  );
};

/** Places the app on the stage under a moving, tilting camera. */
export const CameraRig: React.FC<{ transform: string; rx: number; ry: number; opacity?: number; children: React.ReactNode }> = ({
  transform,
  rx,
  ry,
  opacity = 1,
  children,
}) => (
  <div style={{ position: "absolute", inset: 0, perspective: 2400, opacity }}>
    <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform }}>
      <div style={{ transform: `rotateX(${rx}deg) rotateY(${ry}deg)`, transformOrigin: "50% 50%" }}>{children}</div>
    </div>
  </div>
);

/** Used by scenes for the app's entrance: a small rise and settle. */
export function useEntrance(start = 0) {
  const frame = useCurrentFrame();
  return progress(frame, start, 28);
}
