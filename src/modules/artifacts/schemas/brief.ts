import { z } from 'zod';
import { EvidenceIdSchema, SourcesRowSchema } from './common';

/** Format, length, deadline, per skills/content-brief step 1 ("Deliverable"). */
const DeliverableSchema = z.object({
  format: z.string(),
  length: z.string(),
  deadline: z.string(),
});

/** Who reads this, what they know, what they care about, per skills/content-brief step 2 ("Audience"). */
const BriefAudienceSchema = z.object({
  who: z.string(),
  whatTheyKnow: z.string(),
  whatTheyCareAbout: z.string(),
});

/**
 * One key point. skills/content-brief: "Key points carry evidence IDs, so the writer
 * knows which claims are backed and which are framing." Absent or empty `evidenceIds`
 * is meaningful here, not an omission: it tells the writer this point is framing, not a
 * backed claim, so it is left optional rather than required-with-a-minimum.
 */
const KeyPointSchema = z.object({
  point: z.string(),
  evidenceIds: z.array(EvidenceIdSchema).optional(),
});

/** One outline entry: a heading and the one line describing it, per skills/content-brief step 6. */
const OutlineEntrySchema = z.object({
  heading: z.string(),
  line: z.string(),
});

/**
 * Tone "shown, not described" per skills/content-brief: the skill explicitly rejects an
 * adjective like "professional yet approachable" in favor of a real example sentence.
 */
const ToneSchema = z.object({
  description: z.string(),
  example: z.string(),
});

/** Primary and secondary keywords, both optional, per skills/content-brief step 8. */
const KeywordsSchema = z.object({
  primary: z.array(z.string()).optional(),
  secondary: z.array(z.string()).optional(),
});

/**
 * The authored plan for a `content-brief` artifact (skills/content-brief/SKILL.md).
 * `doNot` is required, not optional, because the skill says so explicitly: "The 'do
 * not' section is not optional. It is where most rework comes from."
 */
export const ContentBriefPlanSchema = z.object({
  title: z.string(),
  deliverable: DeliverableSchema,
  audience: BriefAudienceSchema,
  theOneThing: z.string().min(1),
  angle: z.string(),
  keyPoints: z.array(KeyPointSchema).min(3).max(5),
  outline: z.array(OutlineEntrySchema).min(1),
  tone: ToneSchema,
  keywords: KeywordsSchema.optional(),
  callToAction: z.string(),
  doNot: z.array(z.string()).min(1),
  sources: z.array(SourcesRowSchema).optional(),
});
export type ContentBriefPlan = z.infer<typeof ContentBriefPlanSchema>;
