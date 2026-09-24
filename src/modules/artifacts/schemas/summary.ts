import { z } from 'zod';
import { EvidenceIdSchema, SourcesRowSchema } from './common';

/** One of the three findings a summary document is allowed, per skills/summary-document. */
const SummaryFindingSchema = z.object({
  statement: z.string(),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});

/** The single recommendation a summary document carries, with its expected effect. */
const SummaryRecommendationSchema = z.object({
  statement: z.string(),
  expectedEffect: z.string(),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});

/**
 * The authored plan for a `summary-document` artifact (skills/summary-document/SKILL.md).
 * "A summary document is not a short report." Structurally smaller than a report on
 * purpose: exactly three findings ("Three findings, not five. The constraint is the
 * value."), one recommendation, and an `asOfDate` naming how current the data is, which
 * is the P6.1 house rule added to the skill's opening line.
 */
export const SummaryPlanSchema = z.object({
  title: z.string(),
  asOfDate: z.string().min(1),
  situation: z.string(),
  findings: z.array(SummaryFindingSchema).length(3),
  recommendation: SummaryRecommendationSchema,
  whatWeCouldNotDetermine: z.array(z.string()).optional(),
  sources: z.array(SourcesRowSchema).min(1),
});
export type SummaryPlan = z.infer<typeof SummaryPlanSchema>;
