import type { ReportPlan } from './schemas/report';
import type { SummaryPlan } from './schemas/summary';
import type { CampaignPlan } from './schemas/plan';
import type { ContentBriefPlan } from './schemas/brief';
import type { GenericDocumentPlan } from './schemas/generic';
import type { ChartSpec, SourcesRow, TableSpec } from './schemas/common';

/**
 * `renderDocx` and `renderPdf` (P6.5) both need to walk "a document" without knowing
 * which of the five prose-artifact kinds (report, summary, plan, brief, generic) they
 * were handed: each has a different schema shape (docs/04-MODULES.md M6, one schema per
 * skill), but a Word document and an HTML-for-PDF template only ever need a title, an
 * ordered list of headed sections, and a sources list. `toDocumentPlan` below is the one
 * place that five-way mapping happens, so both renderers share it instead of each
 * re-deriving "what does a campaign-plan look like as a document" independently.
 *
 * `deck` (client-presentation) and `workbook` (excel-workbook) are deliberately excluded:
 * they always render to pptx/xlsx respectively (docs/PROMPTBOOK.md P6.7), never to
 * docx/pdf, so they have no business going through this adapter.
 */

export type DocumentSection = {
  heading: string;
  body: string; // prose, '\n\n' separates paragraphs; already carries inline [E7]/[F3] citations
  table?: TableSpec;
  chart?: ChartSpec;
};

export type DocumentPlan = {
  title: string;
  preparedFor?: string;
  dateRange?: string;
  sections: DocumentSection[];
  sources: SourcesRow[];
};

export type DocumentPlanKind = 'report' | 'summary' | 'plan' | 'brief' | 'generic';

/**
 * Appends evidence-citation's inline format to `text`, e.g. "Email leads [E1, E4]",
 * skipping any id the text already cites. Authors often write the ids inline
 * themselves ("...rose 60% [E199]."); appending them again produced "[E199]. [E199]" in
 * shipped documents. Ids are matched as whole tokens, so E1 already in the text never
 * hides E12. Returns `text` unchanged when nothing is left to add.
 */
export function cite(text: string, ...idLists: (readonly string[] | undefined)[]): string {
  const missing = [...new Set(idLists.flatMap((ids) => ids ?? []))].filter(
    (id) => !new RegExp(`(^|[^A-Za-z0-9])${id}(?![0-9])`).test(text),
  );
  return missing.length > 0 ? `${text} [${missing.join(', ')}]` : text;
}

function bulletList(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join('\n');
}

function fromReport(plan: ReportPlan): DocumentPlan {
  const sections: DocumentSection[] = [
    { heading: 'Executive Summary', body: plan.executiveSummary },
    { heading: 'What We Looked At', body: plan.whatWeLookedAt },
    ...plan.findings.map((finding) => ({
      heading: finding.statement,
      body: [
        cite(finding.soWhat, finding.evidenceIds),
        ...(finding.caveats ?? []).map((caveat) => `Caveat: ${caveat}`),
      ].join('\n\n'),
    })),
    { heading: 'What Is Not Working', body: plan.whatIsNotWorking },
    ...plan.recommendations.map((rec) => ({
      heading: rec.statement,
      body: [
        cite(rec.expectedEffect, rec.findingIds, rec.evidenceIds),
        `Measured by: ${rec.measurement}`,
        ...(rec.isJudgment ? ['This is a judgment call, not a figure from the data.'] : []),
      ].join('\n\n'),
    })),
    { heading: 'Method', body: plan.method },
    ...(plan.charts ?? []).map((chart) => ({
      heading: chart.title,
      body: `${cite('Chart data', chart.evidenceIds)}.`,
      chart,
    })),
  ];
  return { title: plan.title, preparedFor: plan.preparedFor, dateRange: plan.dateRange, sections, sources: plan.sources };
}

function fromSummary(plan: SummaryPlan): DocumentPlan {
  // skills/summary-document: "No section headings beyond the four [above]" — one line,
  // three findings, one recommendation, what we could not determine. Kept to exactly
  // that shape rather than one heading per finding, unlike a report.
  const sections: DocumentSection[] = [
    { heading: 'Situation', body: `${plan.situation} (as of ${plan.asOfDate})` },
    {
      heading: 'Findings',
      body: plan.findings.map((finding, i) => `${i + 1}. ${cite(finding.statement, finding.evidenceIds)}`).join('\n\n'),
    },
    {
      heading: 'Recommendation',
      body: cite(`${plan.recommendation.statement}\n\n${plan.recommendation.expectedEffect}`, plan.recommendation.evidenceIds),
    },
    ...(plan.whatWeCouldNotDetermine && plan.whatWeCouldNotDetermine.length > 0
      ? [{ heading: 'What We Could Not Determine', body: bulletList(plan.whatWeCouldNotDetermine) }]
      : []),
  ];
  return { title: plan.title, sections, sources: plan.sources };
}

function fromPlan(plan: CampaignPlan): DocumentPlan {
  const channelMixTable: TableSpec = {
    title: 'Channel mix',
    headers: ['Channel', 'Budget share', 'Rationale'],
    rows: plan.channelMix.map((c) => [c.channel, `${Math.round(c.budgetShare * 100)}%`, c.rationale]),
    // Every ChannelMixSchema entry requires a non empty evidenceIds (schemas/plan.ts), so
    // this union is guaranteed non empty and TableSpecSchema's own min(1) always holds.
    evidenceIds: [...new Set(plan.channelMix.flatMap((c) => c.evidenceIds))],
  };
  const budgetTotal = plan.budget.reduce((sum, line) => sum + line.amount, 0);
  const sections: DocumentSection[] = [
    { heading: 'TL;DR', body: plan.tldr },
    { heading: 'Objective', body: `${plan.objective} By ${plan.objectiveDate}.` },
    { heading: 'Why This, Now', body: cite(plan.whyThisNow, plan.whyThisNowFindingIds) },
    { heading: 'Audience', body: plan.audience },
    { heading: 'Message', body: [plan.message.core, bulletList(plan.message.supportingPoints)].join('\n\n') },
    { heading: 'Channel Mix', body: 'Budget split, justified against the performance evidence.', table: channelMixTable },
    {
      heading: 'Timeline',
      body: plan.timeline
        .sort((a, b) => a.week - b.week)
        .map((w) => `Week ${w.week}: ${w.activities.join('; ')}`)
        .join('\n\n'),
    },
    {
      heading: 'Budget',
      body: [
        ...plan.budget.map(
          (line) => cite(`${line.channel}: $${line.amount.toLocaleString()} — ${line.basis}${line.isAssumption ? ' (assumption)' : ''}`, line.evidenceIds),
        ),
        `Total: $${budgetTotal.toLocaleString()}`,
      ].join('\n'),
    },
    {
      heading: 'Success Metrics',
      body: plan.successMetrics
        .map((m) => `${m.isPrimary ? 'Primary' : 'Secondary'}: ${m.metric}, target ${m.target}. Measured by ${m.measurement}.`)
        .join('\n\n'),
    },
    { heading: 'Risks', body: plan.risks.map((r) => `${r.risk} — Mitigation: ${r.mitigation}`).join('\n\n') },
  ];
  return { title: plan.title, sections, sources: plan.sources };
}

function fromBrief(plan: ContentBriefPlan): DocumentPlan {
  const sections: DocumentSection[] = [
    { heading: 'Deliverable', body: `Format: ${plan.deliverable.format}. Length: ${plan.deliverable.length}. Deadline: ${plan.deliverable.deadline}.` },
    {
      heading: 'Audience',
      body: `Who: ${plan.audience.who}\n\nWhat they already know: ${plan.audience.whatTheyKnow}\n\nWhat they care about: ${plan.audience.whatTheyCareAbout}`,
    },
    { heading: 'The One Thing', body: plan.theOneThing },
    { heading: 'Angle', body: plan.angle },
    {
      heading: 'Key Points',
      body: bulletList(plan.keyPoints.map((kp) => (kp.evidenceIds?.length ? cite(kp.point, kp.evidenceIds) : `${kp.point} (framing)`))),
    },
    { heading: 'Outline', body: bulletList(plan.outline.map((o) => `${o.heading} — ${o.line}`)) },
    { heading: 'Tone', body: `${plan.tone.description}\n\nExample: "${plan.tone.example}"` },
    ...(plan.keywords
      ? [
          {
            heading: 'Keywords',
            body: [
              plan.keywords.primary?.length ? `Primary: ${plan.keywords.primary.join(', ')}` : '',
              plan.keywords.secondary?.length ? `Secondary: ${plan.keywords.secondary.join(', ')}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ]
      : []),
    { heading: 'Call To Action', body: plan.callToAction },
    { heading: 'Do Not', body: bulletList(plan.doNot) },
  ];
  return { title: plan.title, sections, sources: plan.sources ?? [] };
}

function fromGeneric(plan: GenericDocumentPlan): DocumentPlan {
  const sections: DocumentSection[] = [
    { heading: 'Purpose', body: `${plan.purpose}\n\nStructure: ${plan.structureRationale}` },
    ...plan.sections.map((s) => ({ heading: s.heading, body: cite(s.body, s.evidenceIds) })),
  ];
  return { title: plan.title, sections, sources: plan.sources ?? [] };
}

/** Converts any of the five document-shaped plan kinds into the common shape `renderDocx`/`renderPdf` render. */
export function toDocumentPlan(
  plan: ReportPlan | SummaryPlan | CampaignPlan | ContentBriefPlan | GenericDocumentPlan,
  kind: DocumentPlanKind,
): DocumentPlan {
  switch (kind) {
    case 'report':
      return fromReport(plan as ReportPlan);
    case 'summary':
      return fromSummary(plan as SummaryPlan);
    case 'plan':
      return fromPlan(plan as CampaignPlan);
    case 'brief':
      return fromBrief(plan as ContentBriefPlan);
    case 'generic':
      return fromGeneric(plan as GenericDocumentPlan);
  }
}
