---
name: campaign-analytics
description: How to analyse marketing campaign data properly. Load when answering questions about campaign performance, channels, segments or trends.
---

# Campaign analytics

## Metric definitions

Compute these in SQL. Never estimate them.

| Metric | Formula |
|---|---|
| CTR | clicks / impressions |
| Conversion rate | conversions / clicks |
| CPC | spend / clicks |
| CPA | spend / conversions |
| ROAS | revenue / spend |
| CPM | (spend / impressions) * 1000 |
| AOV | revenue / conversions |

Always compute rates from summed numerators and denominators, never as the average of per row rates. `SUM(conversions) / SUM(clicks)` is correct; `AVG(conversions / clicks)` is a different and usually wrong number (on the sample data it inflates conversion rate by about a quarter). This is checked in code: `run_sql` returns a `warnings` entry for any AVG over a ratio, including a ratio aliased in a CTE, and `record_evidence` refuses that SQL unless the claim says "average of per-row ..." (or per-day, per-campaign). When you see the warning, rewrite the query.

## Before any query

Call `describe_dataset`. Every time. Hallucinated column names are the main failure mode of text to SQL, and one look at the schema removes most of them.

Read the source card's quality warnings and **report them in your answer**. A column with a high null rate or three date formats will produce a confidently wrong aggregate.

## Open ended questions need a method, not one query

"What trends do you see" and "how did we do" are not single queries. Work the checklist:

1. **Overall shape.** Totals and blended rates across the whole period.
2. **By channel.** Which channels lead on volume, on efficiency, and on revenue. These are usually different channels, and saying so is the insight.
3. **By segment and region.** Same comparison, different cut.
4. **Over time.** Monthly or quarterly. Use `compute_stats` for a regression and report the R squared, not just the direction.
5. **Efficiency outliers.** High spend with low return, and the reverse.
6. **Divergences.** Spend rising while revenue is flat is the single most valuable pattern in campaign data. Look for it explicitly.

Then report the three or four findings that would change a decision. Not all of them.

## Two hard rules

**Flag small samples.** Under 100 clicks or under 30 conversions, a rate is noise. Say so. "This segment shows the highest conversion rate but on 47 clicks, which is not enough to act on" is a correct and valuable answer. Reporting it as the winner is bad analysis, and the demo dataset contains exactly this trap.

**Use a significance test before calling a difference real.** To compare two segments' conversion rate or CTR, use `compute_stats` with `twoProportionZTest` (successes column, trials column, group column, the two groups); it sums per group and returns z, the two sided p value and `significantAt05`. For a per-row metric such as daily spend, use `tTestTwoSample` (Welch: t, df, p value). Report the p value; above 0.05, say the difference is not established. A five percent gap on small volumes usually is not a gap.

## Reporting

Order findings by business impact, not by the order you computed them. Lead with what would change a decision. Every number carries its evidence ID. Every recommendation carries a finding ID.
