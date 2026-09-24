import { z } from 'zod';
import { ChartSpecSchema, EvidenceIdSchema, FindingIdSchema, SourcesRowSchema } from './common';

/** One finding as it appears in a report body, per skills/campaign-report step 3 ("Findings"). */
const ReportFindingSchema = z.object({
  statement: z.string(),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
  soWhat: z.string(),
  caveats: z.array(z.string()).optional(),
});

/**
 * One recommendation. skills/campaign-report rule: "No recommendation without a
 * supporting figure. If it rests on judgment rather than data, say so explicitly and
 * mark it as such." The refine below is that rule made structural: either evidenceIds
 * is non empty, or isJudgment says plainly that this one does not have a figure behind it.
 */
const ReportRecommendationSchema = z
  .object({
    statement: z.string(),
    findingIds: z.array(FindingIdSchema).min(1),
    expectedEffect: z.string(),
    measurement: z.string(),
    isJudgment: z.boolean().default(false),
    evidenceIds: z.array(EvidenceIdSchema).optional(),
  })
  .refine((r) => r.isJudgment || (r.evidenceIds?.length ?? 0) > 0, {
    message: 'a recommendation must either cite evidenceIds or be marked isJudgment: true',
    path: ['evidenceIds'],
  });

/**
 * The authored plan for a `campaign-report` artifact (skills/campaign-report/SKILL.md).
 * Mirrors that skill's seven required sections in order: executive summary, what we
 * looked at, findings, what is not working, recommendations, method, sources.
 */
export const ReportPlanSchema = z.object({
  title: z.string(),
  preparedFor: z.string().optional(),
  dateRange: z.string().optional(),
  executiveSummary: z.string().min(1),
  whatWeLookedAt: z.string(),
  findings: z.array(ReportFindingSchema).min(1),
  whatIsNotWorking: z.string(),
  recommendations: z.array(ReportRecommendationSchema).min(1),
  method: z.string(),
  sources: z.array(SourcesRowSchema).min(1),
  charts: z.array(ChartSpecSchema).optional(),
});
export type ReportPlan = z.infer<typeof ReportPlanSchema>;
