import { z } from 'zod';
import { EvidenceIdSchema, SourcesRowSchema } from './common';

/** One section of a generic document: a heading, its body, and the evidence it rests on, if any. */
const GenericSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
  evidenceIds: z.array(EvidenceIdSchema).optional(),
});

/**
 * The authored plan for a `generic-document` artifact (skills/generic-document/SKILL.md),
 * the fallback for any business document without a dedicated skill. `structureRationale`
 * is the skill's required one-liner: "State the structure you chose and why... so the
 * choice is reviewable." `purpose` is the skill's step 1: who reads this, when, and what
 * they do afterwards, written down before anything else.
 */
export const GenericDocumentPlanSchema = z.object({
  title: z.string(),
  purpose: z.string(),
  structureRationale: z.string().min(1),
  sections: z.array(GenericSectionSchema).min(1),
  sources: z.array(SourcesRowSchema).optional(),
});
export type GenericDocumentPlan = z.infer<typeof GenericDocumentPlanSchema>;
