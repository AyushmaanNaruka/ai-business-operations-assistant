import { z } from 'zod';
import { ReportPlanSchema } from './report';
import { SummaryPlanSchema } from './summary';
import { WorkbookPlanSchema } from './workbook';
import { DeckPlanSchema } from './deck';
import { CampaignPlanSchema } from './plan';
import { ContentBriefPlanSchema } from './brief';
import { GenericDocumentPlanSchema } from './generic';

export * from './common';
export * from './report';
export * from './summary';
export * from './workbook';
export * from './deck';
export * from './plan';
export * from './brief';
export * from './generic';

/**
 * The seven artifact plan kinds this module knows how to validate, one per skill. Named
 * `ArtifactPlanKind` deliberately, not `ArtifactKind`: `src/types/artifact.ts` already
 * owns `ArtifactKind` for the rendered file format (xlsx/pptx/docx/pdf), a different
 * axis entirely (a `report` plan kind can render to docx or pdf; the two never collide).
 */
export const ArtifactPlanKindSchema = z.enum(['report', 'summary', 'workbook', 'deck', 'plan', 'brief', 'generic']);
export type ArtifactPlanKind = z.infer<typeof ArtifactPlanKindSchema>;

/** Looks up the right schema for a given plan kind, so callers never hand-map kind to schema themselves. */
export const PLAN_SCHEMAS: Record<ArtifactPlanKind, z.ZodTypeAny> = {
  report: ReportPlanSchema,
  summary: SummaryPlanSchema,
  workbook: WorkbookPlanSchema,
  deck: DeckPlanSchema,
  plan: CampaignPlanSchema,
  brief: ContentBriefPlanSchema,
  generic: GenericDocumentPlanSchema,
};
