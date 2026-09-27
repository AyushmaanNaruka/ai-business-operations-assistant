import { z } from 'zod';
import { ChartSpecSchema, EvidenceIdSchema, FindingIdSchema, SourcesRowSchema } from './common';

/**
 * This is the authored plan only. The Data sheet's actual rows come from the real
 * dataset at render time (docs/04-MODULES.md M6: renderXlsx reads the source, it does
 * not invent rows), so this schema deliberately has no raw data-rows field. What the
 * model authors is the Summary framing, the Recommendations, and which Calculations to
 * derive, all pointed at ranges in a Data sheet the renderer builds separately.
 */

/** One headline number on the Summary sheet, per skills/excel-workbook's "five sheet convention". */
const HeadlineStatSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string()]),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});

/** The Summary sheet's content: headline numbers plus the two or three findings that matter. */
const WorkbookSummarySchema = z.object({
  headline: z.array(HeadlineStatSchema).min(1),
  findings: z.array(z.string()).min(2).max(3),
});

/** One row of the Recommendations sheet, shaped exactly as skills/excel-workbook lays it out. */
const WorkbookRecommendationSchema = z.object({
  findingId: FindingIdSchema,
  recommendation: z.string(),
  rationale: z.string(),
  supportingDataRange: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});

/**
 * One row of the Calculations sheet. skills/excel-workbook: "The rule that matters
 * most: Calculations contain formulas, not values." The regex enforces the leading "="
 * in the schema itself, exactly the house rule named "the single clearest proof the
 * file was constructed rather than transcribed".
 */
const CalculationSchema = z.object({
  label: z.string(),
  formula: z.string().regex(/^=/, 'Calculations cells must be live formulas starting with "="'),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});

/**
 * The authored plan for an `excel-workbook` artifact (skills/excel-workbook/SKILL.md).
 * The Summary sheet header block shows title, client, date range, and generated date
 * so "a reviewer opening the file cold should not have to ask what this is or how
 * current it is". The generated date is deliberately NOT a plan field: `renderXlsx`
 * stamps it from the clock at render time, because a model guessing today's date once
 * shipped a workbook "Generated: 2024-05-13". A stray `generatedAt` in model output is
 * stripped by Zod's default object parsing and never reaches the file.
 */
export const WorkbookPlanSchema = z.object({
  title: z.string(),
  preparedFor: z.string().optional(),
  dateRange: z.string().optional(),
  summary: WorkbookSummarySchema,
  recommendations: z.array(WorkbookRecommendationSchema).min(1),
  calculations: z.array(CalculationSchema).min(1),
  sources: z.array(SourcesRowSchema).min(1),
  chart: ChartSpecSchema.optional(),
});
export type WorkbookPlan = z.infer<typeof WorkbookPlanSchema>;
