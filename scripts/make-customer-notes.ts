/**
 * Generates samples/customer-notes.docx: unstructured account notes, per
 * docs/PROMPTBOOK.md P1.5. Deliberately informal, not a structured report, and
 * deliberately contains one claim that contradicts samples/campaigns.xlsx (Paid
 * Social spend climbing, revenue flat): a note asserting Paid Social is the
 * strongest channel this year. Conflict detection (M5) has to catch this.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const heading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 } });
const subheading = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 } });
const para = (text: string) => new Paragraph({ children: [new TextRun(text)], spacing: { after: 140 } });
const bold = (label: string, rest: string) => new Paragraph({ children: [new TextRun({ text: label, bold: true }), new TextRun(rest)], spacing: { after: 140 } });

async function main() {
  const doc = new Document({
    sections: [
      {
        children: [
          heading('Customer & Campaign Notes'),
          para('Running notes from account and success calls, kept informally by the growth team. Not a formal report; pulled together here so nothing said on a call gets lost before quarterly planning.'),

          subheading('Jan 14 — QBR with Meridian Logistics (Mid-Market, Self-Serve Plus)'),
          para(
            'Good call overall. Their PM lead, Dana, said onboarding took "maybe twenty minutes start to finish," which is exactly the message we want. She pushed back a bit on retention window at the Self-Serve Plus tier and asked whether we would ever offer a longer retention add-on without upgrading to Enterprise. Flagging for product, not something I can answer on my own.',
          ),
          bold('Side note: ', 'Dana mentioned she first found us through a LinkedIn ad, not search, which surprised me given how little social spend I thought we were putting behind mid-market.'),

          subheading('Jan 28 — Pipeline review with growth marketing'),
          para(
            'Sat in on the growth team\'s internal pipeline review. General mood is that paid social has been the strongest performing channel for us this year, and a couple of people on the call were pushing to shift more of next quarter\'s budget toward it. Nobody pulled up numbers during the call, this was more a gut read from the team, but it came up twice unprompted so noting it here since it will probably come up again at planning.',
          ),
          para(
            'Worth someone actually pulling the channel numbers before we commit budget on that basis, since "feels like it\'s working" and "is working" are not always the same thing, especially on a channel where a few big-name accounts can skew perception.',
          ),

          subheading('Feb 6 — Call with Alder Health (Enterprise, evaluating)'),
          para(
            'Still in evaluation, this is their third call with us. Their concern is entirely about data residency, not price or onboarding speed. Mentioned they are also talking to both of the big incumbents. I don\'t think self-serve messaging is relevant to this account at all; this is a straight Enterprise sales motion and should probably not be counted against self-serve campaign performance.',
          ),

          subheading('Feb 19 — Churn call, Brightline Software (SMB, Self-Serve)'),
          para(
            'Lost this one. Reason given was mostly price relative to usage; they were a small team and felt the $299 tier was more than they needed once the trial ended. They did say onboarding was fast and they had no complaints about the product itself, which matches what we hear from most SMB churn: it is a fit and willingness-to-pay problem, not a product problem, for this segment specifically.',
          ),

          subheading('Mar 3 — UK team sync'),
          para(
            'Quick note from the UK team: they keep saying leads from that region feel "further along" when they show up, more likely to already have evaluated a competitor and be comparing us directly rather than just browsing. Matches what\'s in the brief about UK converting better. Nobody has a great explanation for why, just wanted it on record since it keeps coming up.',
          ),

          subheading('Mar 17 — Follow-up with Meridian Logistics'),
          para(
            'Dana again. She renewed early and asked if we had a referral program, wants to introduce us to a sister company. Also asked, unprompted, why our ads "follow her everywhere," her words, which is presumably the paid social retargeting. Not sure if that reads as a positive or as mildly annoying to her; I did not get a clear signal either way and did not want to push on it during a renewal call.',
          ),

          subheading('Apr 2 — Win call, Tidewater Analytics (Mid-Market, Self-Serve Plus)'),
          para(
            'New logo, closed after a five week evaluation. Buyer was a Head of Growth, not a PM, slightly different persona than our usual. She said the deciding factor was being able to try the full product before talking to anyone, and specifically called out that our pricing page let her build a rough budget before the trial even started. She mentioned she almost did not fill out the trial form because a paid search ad took her straight to a comparison page instead, and it took her longer than expected to find the actual signup.',
          ),
          para(
            'Worth flagging to whoever owns the paid search landing pages: if a comparison page is intercepting people who already want to sign up, that is friction we do not need. Not sure how big this problem is beyond one anecdote, so treating it as a note rather than a finding.',
          ),

          subheading('Apr 20 — Renewal risk review, internal'),
          para(
            'Went through the at-risk renewal list with CS leadership. Three accounts flagged, all Enterprise, all citing similar reasons: slower time to value than they expected given how the self-serve motion is marketed, since their onboarding involved SSO setup and a data residency review that self-serve customers never see. Good reminder that the "fifteen minutes to first funnel" claim is true for self-serve and not really transferable to how Enterprise accounts actually onboard, and marketing should probably be careful not to let that message leak into Enterprise-facing materials.',
          ),

          subheading('General impressions, not tied to a specific call'),
          para(
            'A few things I keep hearing across calls that feel worth surfacing even though none of them are backed by a number I have personally checked:',
          ),
          para('- Onboarding speed is consistently the thing customers volunteer as the reason they picked us.'),
          para('- Pricing transparency comes up almost as often, usually favorably, sometimes as a direct comparison to a competitor that would not share pricing.'),
          para('- The sense that "social is working" comes up a lot internally, but I have not seen anyone actually walk through the spend and revenue side by side on that channel this year. Someone should before we make a budget call off it.'),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const outPath = resolve(process.cwd(), 'samples/customer-notes.docx');
  await writeFile(outPath, buffer);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
