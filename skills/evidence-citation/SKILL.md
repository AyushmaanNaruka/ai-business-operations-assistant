---
name: evidence-citation
description: The grounding rules every artifact and every answer inherits. Load this whenever producing content a business user will act on.
---

# Evidence and citation rules

These rules are inherited by every other skill in this project. They are not style preferences.

## The rules

1. **Never state a number that has no evidence ID.** If a figure is not in the gathered evidence, it does not go in the output. Not as an estimate, not as "approximately", not as a round number.

2. **Every conclusion cites findings, every finding cites evidence.** A recommendation without a finding ID behind it is an opinion, and this system does not produce opinions.

3. **Report gaps explicitly.** When something asked for cannot be determined from the available information, say so in the output, in the place where it would have gone. A section reading "Segment level ROAS is not available; the uploaded data has no cost column broken out by segment" is correct. A section quietly omitting it is not.

4. **Where sources disagree, present both.** Never silently prefer one. State both values, name both sources, and say which is more likely to be current and why.

5. **Label inferences as inferences.** A claim assembled across sources is not a fact from either of them. Mark it.

6. **Planning artifacts may state a labeled assumption instead of a number with no evidence.** This is the one narrow exception to rule 1. A campaign plan needing a CPA for a channel with no history may state one, provided the output marks it as an assumption in the same place it appears, not as a fact. This never applies to a report, summary, or answer describing what already happened; it only ever describes a forward-looking plan for something that has not happened yet.

6. **Attach the method to important numbers.** For a computed figure, the query that produced it is available in the evidence entry. Reference it where a reader would reasonably want to check.

## Citation format

| Evidence kind | Cite as |
|---|---|
| Computed | `[E7: campaigns.xlsx, computed]` |
| Document | `[E12: northwind-brief.pdf, p.2, Positioning]` |
| Web | `[E19: acme.com/pricing, read 22 Sep 2026]` |

In artifacts, put citations in a Sources section or sheet, and reference the IDs inline.

## What good looks like

Bad: "Email is clearly our strongest channel and we should invest more."

Good: "Email converts at 4.2 percent against a 2.1 percent blended average [E1, E4]. It is also the smallest channel by spend, so the headroom is untested above its current volume [E6]."

The second version is shorter, more useful, and every part of it can be checked.
