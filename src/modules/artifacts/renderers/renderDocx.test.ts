import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { DocumentPlan } from '../documentPlan';
import { renderDocx } from './renderDocx';

/**
 * `jszip` is not a direct dependency of this project, but it is already present in
 * node_modules transitively (pulled in by `pptxgenjs`/`exceljs`) and is resolvable and
 * typed on its own (`node_modules/jszip/index.d.ts`), so it is used here to unzip the
 * `.docx` (a zip container) rather than adding a new top level dependency, per
 * docs/PROMPTBOOK.md P6.5's instruction to check for an existing transitive zip reader
 * before adding one.
 */

const ZIP_SIGNATURE = [0x50, 0x4b];

function basePlan(overrides: Partial<DocumentPlan> = {}): DocumentPlan {
  return {
    title: 'Q3 Channel Performance Review',
    preparedFor: 'Northwind Retail',
    dateRange: 'January to August 2026',
    sections: [
      {
        heading: 'Executive Summary',
        body: 'Email converts at twice the blended average, on a fraction of the spend.\n\nWe recommend shifting budget toward email.',
      },
      {
        heading: 'Channel Mix',
        body: 'Budget split by channel, justified against the performance evidence.',
        table: {
          title: 'Channel mix',
          headers: ['Channel', 'Budget share', 'Rationale'],
          rows: [
            ['Email', '40%', 'Highest ROI'],
            ['Paid Social', '30%', 'Broad reach'],
          ],
          evidenceIds: ['E1'],
        },
      },
    ],
    sources: [
      { evidenceId: 'E1', claim: 'Email converts at 4.2 percent', sourceName: 'campaigns.xlsx', locator: 'computed', method: 'SQL' },
    ],
    ...overrides,
  };
}

describe('renderDocx: buffer shape', () => {
  it('returns a non empty buffer starting with the ZIP signature (a .docx is a zip container)', async () => {
    const buffer = await renderDocx(basePlan());
    expect(buffer.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect([buffer[0], buffer[1]]).toEqual(ZIP_SIGNATURE);
  });
});

describe('renderDocx: document.xml content (offline, no chart)', () => {
  it('includes each section heading and the table header text in word/document.xml', async () => {
    const buffer = await renderDocx(basePlan());
    const zip = await JSZip.loadAsync(buffer);

    const documentXmlFile = zip.file('word/document.xml');
    expect(documentXmlFile).not.toBeNull();
    const documentXml = await documentXmlFile!.async('string');

    expect(documentXml).toContain('Q3 Channel Performance Review');
    expect(documentXml).toContain('Prepared for: Northwind Retail');
    expect(documentXml).toContain('Date range: January to August 2026');
    expect(documentXml).toContain('Executive Summary');
    expect(documentXml).toContain('Channel Mix');
    // Table header cells (bold row from TableSpec.headers).
    expect(documentXml).toContain('Channel');
    expect(documentXml).toContain('Budget share');
    expect(documentXml).toContain('Rationale');
    // A body row, to confirm the table body rendered too, not just headers.
    expect(documentXml).toContain('Highest ROI');
  });

  it('includes a Sources heading and its rows when plan.sources is non empty', async () => {
    const buffer = await renderDocx(basePlan());
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')!.async('string');

    expect(documentXml).toContain('Sources');
    expect(documentXml).toContain('Evidence ID');
    expect(documentXml).toContain('campaigns.xlsx');
  });

  it('omits the Sources section entirely when plan.sources is empty', async () => {
    const plan = basePlan({ sources: [] });
    const buffer = await renderDocx(plan);
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file('word/document.xml')!.async('string');

    // "Sources" as a heading run would appear as its own <w:t>Sources</w:t> text run;
    // nothing else in this fixture plan uses that exact word, so its absence is a safe check.
    expect(documentXml).not.toContain('>Sources<');
  });

  it('does not create a word/media folder when no section has a chart', async () => {
    const buffer = await renderDocx(basePlan());
    const zip = await JSZip.loadAsync(buffer);
    const mediaEntries = Object.keys(zip.files).filter((name) => name.startsWith('word/media/'));
    expect(mediaEntries).toEqual([]);
  });
});

// Separate from the offline suite above by design (docs/PROMPTBOOK.md P6.5 test instructions):
// `renderChart` calls the hosted QuickChart API over the network. If this sandbox has no
// network access this test is EXPECTED to fail, and that failure should be reported
// honestly rather than papered over with a try/catch that turns it into a silent pass.
// It does not block or slow down the offline suite above, which always runs.
describe('renderDocx: chart embedding (requires network access to QuickChart)', () => {
  it(
    'embeds a chart section as a PNG under word/media/ when a section has a chart',
    async () => {
      const plan = basePlan({
        sections: [
          {
            heading: 'Conversion Trend',
            body: 'Conversion rate by channel.',
            chart: {
              kind: 'bar',
              title: 'Conversion rate by channel',
              data: [
                { label: 'Email', value: 4.2, evidenceIds: ['E1'] },
                { label: 'Blended', value: 2.1, evidenceIds: ['E1'] },
              ],
              evidenceIds: ['E1'],
            },
          },
        ],
      });

      const buffer = await renderDocx(plan);
      const zip = await JSZip.loadAsync(buffer);
      // docx names embedded media by content hash, not sequentially (e.g.
      // "word/media/132e7d9a....png"), so this matches any PNG under word/media/ rather
      // than assuming an "imageN.png" naming scheme.
      const mediaEntries = Object.keys(zip.files).filter((name) => /^word\/media\/.+\.png$/.test(name));
      expect(mediaEntries.length).toBeGreaterThan(0);
    },
    20000,
  );
});
