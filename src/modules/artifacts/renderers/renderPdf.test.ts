import { describe, expect, it } from 'vitest';
import type { DocumentPlan } from '../documentPlan';
import { renderPdf } from './renderPdf';

const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // "%PDF"

// A plan with no chart: fully offline, no CDN dependency, must always pass.
const noChartPlan: DocumentPlan = {
  title: 'Q3 Channel Performance',
  preparedFor: 'Acme Marketing',
  dateRange: 'Jul 2026 - Sep 2026',
  sections: [
    {
      heading: 'Executive Summary',
      body: 'Email outperformed paid social this quarter.\n\nBudget should shift accordingly.',
    },
    {
      heading: 'Risks & Assumptions <check this>',
      body: 'Some figures assume a & b hold; see "caveats" below.',
    },
    {
      heading: 'Channel Mix',
      body: 'Budget split by channel.',
      table: {
        title: 'Channel mix',
        headers: ['Channel', 'Budget share'],
        rows: [
          ['Email', '40%'],
          ['Paid social', 30],
        ],
        evidenceIds: ['E1'],
      },
    },
  ],
  sources: [
    {
      evidenceId: 'E1',
      claim: 'Email converts at 4.2 percent',
      sourceName: 'campaigns.xlsx',
      locator: 'computed',
      method: 'SQL aggregate',
    },
  ],
};

// A plan with one bigNumber chart: also offline (bigNumber skips Chart.js/canvas entirely).
const bigNumberPlan: DocumentPlan = {
  title: 'Headline Metric',
  sections: [
    {
      heading: 'Total Conversions',
      body: 'The topline number for the quarter.',
      chart: {
        kind: 'bigNumber',
        title: 'Total Conversions',
        data: [{ label: 'Conversions', value: 12345, evidenceIds: ['E1'] }],
        evidenceIds: ['E1'],
      },
    },
  ],
  sources: [],
};

describe('renderPdf (no network / offline cases)', () => {
  it('resolves with escaped HTML and a valid PDF buffer for a plan with no chart', async () => {
    const result = await renderPdf(noChartPlan);

    expect(result.html).toEqual(expect.any(String));
    expect(result.html.length).toBeGreaterThan(0);
    expect(result.html).toContain('Q3 Channel Performance');
    expect(result.html).toContain('Executive Summary');
    expect(result.html).toContain('Channel Mix');

    // The heading with '<' must be escaped, not left as raw markup.
    expect(result.html).not.toContain('<check this>');
    expect(result.html).toContain('Risks &amp; Assumptions &lt;check this&gt;');

    // The body containing '&' and '"' must also come through escaped.
    expect(result.html).toContain('Some figures assume a &amp; b hold; see &quot;caveats&quot; below.');

    expect(Buffer.isBuffer(result.pdf)).toBe(true);
    expect(result.pdf.length).toBeGreaterThan(0);
    expect(result.pdf.subarray(0, 4).equals(PDF_MAGIC)).toBe(true);
  }, 30_000);

  it('renders a bigNumber chart as styled text with no canvas or Chart.js script', async () => {
    const result = await renderPdf(bigNumberPlan);

    expect(result.html).toContain('Total Conversions');
    expect(result.html).toContain('12,345');
    expect(result.html).not.toContain('<canvas');
    expect(result.html).not.toContain('chart.js');

    expect(Buffer.isBuffer(result.pdf)).toBe(true);
    expect(result.pdf.subarray(0, 4).equals(PDF_MAGIC)).toBe(true);
  }, 30_000);
});

describe('renderPdf (chart section, requires reaching the Chart.js CDN)', () => {
  // This case needs outbound network access to https://cdn.jsdelivr.net for Chart.js,
  // since page.setContent uses waitUntil: 'networkidle0'. Isolated in its own test with a
  // generous timeout so a sandboxed/offline environment fails visibly here rather than
  // hanging the rest of the suite or being silently swallowed.
  it('renders a bar chart section via the Chart.js CDN and still produces a valid PDF', async () => {
    const plan: DocumentPlan = {
      title: 'Channel Spend',
      sections: [
        {
          heading: 'Spend by Channel',
          body: 'Paid social led spend this quarter.',
          chart: {
            kind: 'bar',
            title: 'Spend by channel',
            data: [
              { label: 'Email', value: 1000, evidenceIds: ['E1'] },
              { label: 'Paid social', value: 4000, evidenceIds: ['E1'] },
              { label: 'Organic', value: 500, evidenceIds: ['E1'] },
            ],
            xLabel: 'Channel',
            yLabel: 'Spend ($)',
            evidenceIds: ['E1'],
          },
        },
      ],
      sources: [],
    };

    const result = await renderPdf(plan);

    expect(result.html).toContain('<canvas');
    expect(result.html).toContain('chart.js');
    expect(Buffer.isBuffer(result.pdf)).toBe(true);
    expect(result.pdf.subarray(0, 4).equals(PDF_MAGIC)).toBe(true);
  }, 30_000);
});
