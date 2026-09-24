import { z } from 'zod';
import { ChartSpecSchema, EvidenceIdSchema, TableSpecSchema } from './common';

/**
 * One slide. Matches docs/03-ARCHITECTURE.md section 4.2's canonical `DeckPlan` shape
 * exactly: `notes` is required (skills/client-presentation: "Speaker notes on every
 * slide, written as what you would actually say"), and `evidenceIds` may be empty
 * because not every slide carries a number (a section divider, a "next steps" slide).
 */
const SlideSchema = z.object({
  title: z.string(), // the message, not a label
  bullets: z.array(z.string()).max(5),
  chart: ChartSpecSchema.optional(),
  table: TableSpecSchema.optional(),
  notes: z.string().min(1), // speaker notes, required
  evidenceIds: z.array(EvidenceIdSchema),
});

/**
 * The authored plan for a `client-presentation` artifact (skills/client-presentation/SKILL.md,
 * docs/03-ARCHITECTURE.md section 4.2). Ten to fourteen slides is the skill's target;
 * the schema's five to fifteen bound is the architecture doc's hard floor and ceiling
 * around that target, kept exactly as specified there.
 */
export const DeckPlanSchema = z.object({
  title: z.string(),
  slides: z.array(SlideSchema).min(5).max(15),
});
export type DeckPlan = z.infer<typeof DeckPlanSchema>;
