import { z } from 'zod';
import { EvidenceIdSchema, FindingIdSchema, SourcesRowSchema } from './common';

/** The core claim plus its one to three supporting points, per skills/campaign-plan step 4 ("Message"). */
const MessageSchema = z.object({
  core: z.string(),
  supportingPoints: z.array(z.string()).min(1).max(3),
});

/** One channel's share of the budget and why, per skills/campaign-plan step 5 ("Channel mix"). */
const ChannelMixSchema = z.object({
  channel: z.string(),
  budgetShare: z.number().min(0).max(1),
  rationale: z.string(),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});

/** One week of the plan, per skills/campaign-plan step 6: "Timeline in weeks, not months." */
const TimelineWeekSchema = z.object({
  week: z.number().int().min(1),
  activities: z.array(z.string()).min(1),
});

/**
 * One budget line. skills/campaign-plan rule: "If there is no history for a channel,
 * say the number is an assumption and mark it as such (see evidence-citation rule 6,
 * the one exception to 'never state a number with no evidence ID')." The refine is
 * that exception made structural, and it is the one place in this module a numeric
 * claim is allowed through without evidenceIds, because a plan describes something
 * that has not happened yet.
 */
const BudgetLineSchema = z
  .object({
    channel: z.string(),
    amount: z.number(),
    basis: z.string(),
    isAssumption: z.boolean().default(false),
    evidenceIds: z.array(EvidenceIdSchema).optional(),
  })
  .refine((b) => b.isAssumption || (b.evidenceIds?.length ?? 0) > 0, {
    message: 'a budget line must either cite evidenceIds or be marked isAssumption: true',
    path: ['evidenceIds'],
  });

/** One of the three success metrics: one primary plus two secondary, per skills/campaign-plan step 8. */
const SuccessMetricSchema = z.object({
  metric: z.string(),
  target: z.union([z.number(), z.string()]),
  measurement: z.string(),
  isPrimary: z.boolean().default(false),
});

/** One risk and its mitigation, per skills/campaign-plan step 9. */
const RiskSchema = z.object({
  risk: z.string(),
  mitigation: z.string(),
});

/**
 * The authored plan for a `campaign-plan` artifact (skills/campaign-plan/SKILL.md).
 * `tldr` is the P6.1 addition: section 0, "one line above the objective: what this plan
 * does, for whom, by when", required so "a reader who stops here should already know
 * whether to keep reading". `whyThisNowFindingIds` makes step 2 ("Why this, now") trace
 * to findings the way every other kind's recommendations do.
 */
export const CampaignPlanSchema = z.object({
  title: z.string(),
  tldr: z.string().min(1),
  objective: z.string(),
  objectiveDate: z.string(),
  whyThisNow: z.string(),
  whyThisNowFindingIds: z.array(FindingIdSchema).min(1),
  audience: z.string(),
  message: MessageSchema,
  channelMix: z.array(ChannelMixSchema).min(1),
  timeline: z.array(TimelineWeekSchema).min(1),
  budget: z.array(BudgetLineSchema).min(1),
  successMetrics: z.array(SuccessMetricSchema).length(3),
  risks: z.array(RiskSchema).min(2).max(3),
  sources: z.array(SourcesRowSchema).min(1),
});
export type CampaignPlan = z.infer<typeof CampaignPlanSchema>;
