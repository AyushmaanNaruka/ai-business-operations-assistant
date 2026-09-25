import { TIMELINE } from "../timeline";
import React from "react";
import { useCurrentFrame } from "remotion";
import { CHANNELS, DATASET, SMALL_SAMPLE } from "../data";

import { AppShell, CameraRig } from "../ui/AppShell";
import { Caption, FadeUp, Headline, Stage, Stream, ToolRow, UserBubble } from "../ui/parts";
import { Bars, SpecialistCard, SqlBlock, Warnings, useScroll } from "../ui/thread";
import { camera, sceneFade, typed } from "../ui/motion";

export const ANALYSIS_DURATION = TIMELINE.analysis;

export const Q1 = "Analyze this campaign data and tell me what performed well and what didn't";

const SQL = `SELECT channel,
       SUM(revenue) / SUM(spend)          AS revenue_per_dollar,
       SUM(conversions) * 100.0 / SUM(clicks) AS conversion_pct
FROM campaigns
GROUP BY channel
ORDER BY revenue_per_dollar DESC;`;

export const AnalysisThread: React.FC<{ t0?: number }> = ({ t0 = 0 }) => {
  const at = (f: number) => f + t0;
  return (
    <>
      <UserBubble text={Q1} at={at(76)} />
      <div>
        <ToolRow name="read_session_manifest" start={at(84)} done={at(100)} />
        <ToolRow name="handle_request" note="Data Analyst" start={at(104)} done={at(228)} />
        <SpecialistCard agent="Data Analyst · typed task, no chat history" at={at(110)} collapseAt={at(232)} height={316}>
          <ToolRow name="describe_dataset" start={at(112)} done={at(126)} />
          <ToolRow name="run_sql" start={at(128)} done={at(200)} />
          <SqlBlock sql={SQL} start={at(132)} />
          <ToolRow name="compute_stats" start={at(204)} done={at(222)} />
        </SpecialistCard>
      </div>
      <div style={{ fontSize: 16, lineHeight: 1.7, minHeight: 56 }}>
        <Stream
          start={at(236)}
          wps={26}
          style={{ fontWeight: 600 }}
          text="Email (214×) and Webinar (178×) return the most revenue per dollar. Paid Social returns the least, 26×, on 35% of total spend."
        />
      </div>
      <FadeUp at={at(252)}>
        <Bars
          start={at(256)}
          title="Revenue per $1 of spend, by channel"
          footer={`campaigns.xlsx · run_sql over ${DATASET.rows.toLocaleString()} clean rows · every bar cites its evidence`}
          rows={CHANNELS.map((c, i) => ({
            name: c.name,
            value: c.roas,
            label: `${Math.round(c.roas)}×`,
            tone: i < 2 ? "good" : c.name === "Paid Social" ? "bad" : undefined,
          }))}
        />
      </FadeUp>
      <FadeUp at={at(316)}>
        <Warnings
          start={at(320)}
          items={[
            `${DATASET.duplicates} exact duplicate rows removed (${DATASET.rawRows.toLocaleString()} → ${DATASET.rows.toLocaleString()}).`,
            `start_date is written ${DATASET.dateFormats} different ways. Normalised before grouping by month.`,
            `${DATASET.missingRevenue} rows have no revenue. Excluded from totals, not filled in.`,
            `Top converter "${SMALL_SAMPLE.name}" shows ${SMALL_SAMPLE.cvr}% on only ${SMALL_SAMPLE.clicks} clicks. Too small to rank.`,
          ]}
        />
      </FadeUp>
    </>
  );
};

export const Analysis: React.FC = () => {
  const frame = useCurrentFrame();
  const scroll = useScroll([
    [236, 0],
    [270, 120],
    [300, 176],
  ]);
  const cam = camera(frame, [
    { f: 0, s: 0.76, fx: 800, fy: 472, ty: 640 },
    { f: 56, s: 0.76, fx: 800, fy: 472, ty: 640 },
    { f: 84, s: 1.02, fx: 930, fy: 470, ty: 540 },
    { f: 140, s: 1.02, fx: 930, fy: 470, ty: 540 },
    { f: 160, s: 1.6, fx: 900, fy: 450, ty: 520 },
    { f: 226, s: 1.6, fx: 900, fy: 450, ty: 520 },
    { f: 250, s: 1.08, fx: 930, fy: 470, ty: 540 },
    { f: 370, s: 1.08, fx: 930, fy: 470, ty: 540 },
    { f: 396, s: 1.42, fx: 930, fy: 600, ty: 500 },
    { f: 480, s: 1.47, fx: 930, fy: 600, ty: 500 },
  ]);
  const text = frame < 74 ? typed(Q1, frame, 10, 64) : "";
  return (
    <Stage>
      <div style={{ opacity: sceneFade(frame, ANALYSIS_DURATION, 8, 8) }}>
        <Headline text="Ask it like you'd ask an analyst." accent="analyst" start={2} exitAt={60} sub="Plain English in. Real numbers out." />
        <CameraRig {...cam}>
          <AppShell title="Northwind Q3 campaign review" fileCount={4} composerText={text} composerCaret={frame < 74} scroll={scroll}>
            <AnalysisThread />
          </AppShell>
        </CameraRig>
        <Caption text="Every figure is computed by SQL. Never estimated by a model." icon="database" start={162} end={232} />
        <Caption text="Messy data is flagged, never quietly smoothed over." icon="alert" start={398} end={480} />
      </div>
    </Stage>
  );
};

