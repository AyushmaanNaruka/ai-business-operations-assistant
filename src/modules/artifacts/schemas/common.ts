import { z } from 'zod';

/**
 * Shared primitives every artifact plan schema is built from. docs/04-MODULES.md M6:
 * "the Zod schema owns what shape it must be". These are the pieces that recur across
 * kinds (a chart, a table, a sources row, the two id formats), kept in one place so a
 * change to, say, the evidence id format only has to happen once.
 */

/** The ledger's evidence id format ("E7"). Referenced everywhere a claim needs grounding. */
export const EvidenceIdSchema = z.string().regex(/^E\d+$/, 'an evidence id must look like "E7"');
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;

/** The ledger's finding id format ("F3"). Referenced wherever a plan traces back to a conclusion. */
export const FindingIdSchema = z.string().regex(/^F\d+$/, 'a finding id must look like "F3"');
export type FindingId = z.infer<typeof FindingIdSchema>;

/** The chart kinds a renderer knows how to draw, per skills/client-presentation and skills/excel-workbook. */
export const ChartKindSchema = z.enum(['bar', 'line', 'stackedBar', 'scatter', 'pie', 'bigNumber']);
export type ChartKind = z.infer<typeof ChartKindSchema>;

/** One plotted point: a label, a number, and the evidence that number came from. */
export const ChartDataPointSchema = z.object({
  label: z.string().min(1),
  value: z.number(),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});
export type ChartDataPoint = z.infer<typeof ChartDataPointSchema>;

/**
 * A whole chart: its kind, its data, and the evidence ids behind the chart as a whole
 * (separate from the per point evidence ids, since a chart can cite a query or a date
 * range that applies to every point). A pie chart is capped at four categories per
 * skills/client-presentation, "never a pie with more than four slices".
 */
export const ChartSpecSchema = z
  .object({
    kind: ChartKindSchema,
    title: z.string().min(1),
    data: z.array(ChartDataPointSchema).min(1),
    xLabel: z.string().optional(),
    yLabel: z.string().optional(),
    evidenceIds: z.array(EvidenceIdSchema).min(1),
  })
  .refine((c) => c.kind !== 'pie' || c.data.length <= 4, {
    message: 'a pie chart may have at most 4 categories',
    path: ['data'],
  });
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

/** A table: headers, rows of string or number cells, and the evidence the rows came from. */
export const TableSpecSchema = z.object({
  title: z.string().min(1),
  headers: z.array(z.string().min(1)).min(1),
  rows: z.array(z.array(z.union([z.string(), z.number()]))).min(1),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});
export type TableSpec = z.infer<typeof TableSpecSchema>;

/** One row of a Sources section or sheet, per skills/evidence-citation's citation format. */
export const SourcesRowSchema = z.object({
  evidenceId: EvidenceIdSchema,
  claim: z.string().min(1),
  sourceName: z.string().min(1),
  locator: z.string().min(1),
  method: z.string().optional(),
});
export type SourcesRow = z.infer<typeof SourcesRowSchema>;
