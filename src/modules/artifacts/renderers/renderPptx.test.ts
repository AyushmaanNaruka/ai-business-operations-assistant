import { describe, expect, it } from 'vitest';
// jszip is not a project dependency; it ships transitively as pptxgenjs's own zip
// engine (see node_modules/jszip, pulled in by node_modules/pptxgenjs's package.json).
// It is used here, in the test only, to open the .pptx this module writes and prove
// its internals, never imported by `renderPptx.ts` itself and never added to
// package.json, so this does not touch docs/06-RESEARCH-STACK.md or docs/DECISIONS.md.
import JSZip from 'jszip';
import { DeckPlanSchema, type DeckPlan } from '@/modules/artifacts/schemas';
import type { Evidence } from '@/types/evidence';
import { deckEvidenceIds, renderPptx } from './renderPptx';

const E1: Evidence = {
  id: 'E1',
  claim: 'Email converts at 4.2 percent',
  kind: 'computed',
  sourceId: 'src_1',
  sourceName: 'campaigns.xlsx',
  locator: 'computed',
  method: "SELECT SUM(conversions)::FLOAT / SUM(clicks) FROM campaigns WHERE channel = 'email'",
  value: 4.2,
  confidence: 'high',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const E2: Evidence = {
  id: 'E2',
  claim: 'Paid social spend rose 60 percent since June',
  kind: 'computed',
  sourceId: 'src_1',
  sourceName: 'campaigns.xlsx',
  locator: 'computed',
  method: "SELECT SUM(spend) FROM campaigns WHERE channel = 'paid_social' GROUP BY month",
  value: 60,
  confidence: 'high',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const E3: Evidence = {
  id: 'E3',
  claim: 'Positioning document names three target segments',
  kind: 'document',
  sourceId: 'src_2',
  sourceName: 'positioning.docx',
  locator: 'page 2, Positioning',
  value: 'three segments',
  confidence: 'medium',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const evidence: Evidence[] = [E1, E2, E3];

// Distinct, greppable tokens so the ZIP-level notes assertion can prove each slide's
// exact notes text made it into the archive, not just that some notes text exists.
const NOTES = [
  'NOTES_TOKEN_SITUATION Email is the strongest channel this quarter, open with it.',
  'NOTES_TOKEN_TREND Conversion has climbed steadily since March, call out the inflection in May.',
  'NOTES_TOKEN_TABLE Walk the client through each channel row before jumping to the total.',
  'NOTES_TOKEN_BIGNUMBER Pause here. This is the headline number of the whole deck.',
  'NOTES_TOKEN_NEXT Confirm owners and dates out loud before moving to the appendix.',
];

const rawPlan = {
  title: 'Q3 Channel Performance Review',
  slides: [
    {
      title: 'Email converts at twice the blended average, on a tenth of the spend',
      bullets: ['Email: 4.2% conversion on $8k spend', 'Blended: 2.1% conversion on $80k spend', 'Paid social lags at 0.9%'],
      chart: {
        kind: 'bar',
        title: 'Conversion rate by channel',
        data: [
          { label: 'Email', value: 4.2, evidenceIds: ['E1'] },
          { label: 'Blended', value: 2.1, evidenceIds: ['E1'] },
          { label: 'Paid Social', value: 0.9, evidenceIds: ['E2'] },
        ],
        yLabel: 'Conversion %',
        evidenceIds: ['E1', 'E2'],
      },
      notes: NOTES[0],
      evidenceIds: ['E1', 'E2'],
    },
    {
      title: 'Conversion has climbed every month since March',
      bullets: ['March: 1.8%', 'April: 2.4%', 'May: 3.6%'],
      chart: {
        kind: 'line',
        title: 'Monthly conversion rate',
        data: [
          { label: 'March', value: 1.8, evidenceIds: ['E1'] },
          { label: 'April', value: 2.4, evidenceIds: ['E1'] },
          { label: 'May', value: 3.6, evidenceIds: ['E1'] },
        ],
        xLabel: 'Month',
        yLabel: 'Conversion %',
        evidenceIds: ['E1'],
      },
      notes: NOTES[1],
      evidenceIds: ['E1'],
    },
    {
      title: 'Channel mix, in full',
      bullets: ['Every channel logged this quarter, for the appendix'],
      table: {
        title: 'Channel performance',
        headers: ['Channel', 'Spend', 'Conversion'],
        rows: [
          ['Email', '$8,000', '4.2%'],
          ['Paid Social', '$32,000', '0.9%'],
          ['Organic', '$0', '3.1%'],
        ],
        evidenceIds: ['E1', 'E2'],
      },
      notes: NOTES[2],
      evidenceIds: ['E1', 'E2'],
    },
    {
      title: 'Email delivered 4.2% conversion this quarter',
      bullets: [],
      chart: {
        kind: 'bigNumber',
        title: 'Email conversion rate',
        data: [{ label: 'Email conversion rate', value: 4.2, evidenceIds: ['E1'] }],
        evidenceIds: ['E1'],
      },
      notes: NOTES[3],
      evidenceIds: ['E1'],
    },
    {
      title: 'Shift 15% of paid social budget to email by end of quarter',
      bullets: ['Owner: Growth lead', 'Target date: end of Q3', 'Success metric: blended conversion above 2.5%'],
      notes: NOTES[4],
      evidenceIds: [],
    },
  ],
};

describe('renderPptx', () => {
  const plan: DeckPlan = DeckPlanSchema.parse(rawPlan);

  it('produces a non empty buffer starting with the ZIP signature', async () => {
    const buffer = await renderPptx(plan, evidence);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer[0]).toBe(0x50); // 'P'
    expect(buffer[1]).toBe(0x4b); // 'K'
  });

  it('writes native chart parts for the bar and line slides, never an image', async () => {
    const buffer = await renderPptx(plan, evidence);
    const zip = await JSZip.loadAsync(buffer);
    const entryNames = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir);

    const chartEntries = entryNames.filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name));
    // Two chart-bearing slides (bar, line); bigNumber deliberately adds no chart part.
    expect(chartEntries.length).toBeGreaterThanOrEqual(2);

    // The deck never adds an image anywhere (no logos, no chart-as-picture fallback),
    // so any media entry at all would mean a chart, or something else, was rasterized
    // instead of rendered as a native, editable pptx object.
    const imageEntries = entryNames.filter((name) => /^ppt\/media\//.test(name));
    expect(imageEntries).toHaveLength(0);
  });

  it('gives every slide non empty speaker notes containing the authored text', async () => {
    const buffer = await renderPptx(plan, evidence);
    const zip = await JSZip.loadAsync(buffer);
    const entryNames = Object.keys(zip.files).filter((name) => !zip.files[name]?.dir);

    const notesEntries = entryNames.filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
    // One notes part per content slide, plus the code-rendered Sources slide.
    expect(notesEntries).toHaveLength(plan.slides.length + 1);

    const notesContents = await Promise.all(notesEntries.map((name) => zip.file(name)!.async('text')));
    for (const content of notesContents) {
      expect(content.length).toBeGreaterThan(0);
    }

    // Every authored notes string shows up verbatim in exactly one notes part; this is
    // the proof that `addNotes` carried the plan's actual text through, not a restated
    // or truncated version of it.
    for (const expectedNote of NOTES) {
      const matches = notesContents.filter((content) => content.includes(expectedNote));
      expect(matches).toHaveLength(1);
    }
  });

  it('resolves without throwing for a deck at the schema maximum of slides', async () => {
    const manySlides: DeckPlan['slides'] = Array.from({ length: 15 }, (_, i) => ({
      title: `Slide ${i + 1} message`,
      bullets: [`Point ${i + 1}`],
      notes: `Notes for slide ${i + 1}, never left empty.`,
      evidenceIds: [],
    }));
    const bigPlan = DeckPlanSchema.parse({ title: 'Stress deck', slides: manySlides });
    const buffer = await renderPptx(bigPlan, []);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it('closes with a code-rendered Sources slide listing each cited evidence entry once', async () => {
    const buffer = await renderPptx(plan, evidence);
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slideNames).toHaveLength(plan.slides.length + 1);

    const xml = await zip.file(`ppt/slides/slide${plan.slides.length + 1}.xml`)!.async('text');
    // autoPage splits cell text into one run per word; join the runs back into text.
    const last = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
    expect(last).toContain('Sources');
    // E1 and E2 are cited by the deck; E3 is gathered but never cited, so it is not listed.
    expect(last).toContain(E1.claim);
    expect(last).toContain(E2.claim);
    expect(last).not.toContain(E3.claim);
    expect(last).toContain('campaigns.xlsx');
  });

  it('collects cited evidence ids in first-appearance order across slides, charts and tables', () => {
    expect(deckEvidenceIds(plan)).toEqual(['E1', 'E2']);
  });

  it('adds no Sources slide when the deck cites nothing the ledger holds', async () => {
    const buffer = await renderPptx(plan, []);
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slideNames).toHaveLength(plan.slides.length);
  });
});
