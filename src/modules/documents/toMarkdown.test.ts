import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { toMarkdown } from './toMarkdown';
import { formatPageMarker, formatSourceMarker } from './marker';

const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');
const FIXTURES = join(import.meta.dirname, '..', 'sources', '__fixtures__');

describe('toMarkdown (pdf)', () => {
  it('places page markers at the correct boundaries and cites the right page for a known sentence', async () => {
    const result = await toMarkdown(join(SAMPLES, 'northwind-brief.pdf'), 'pdf');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { markdown, pageCount } = result.data;
    expect(pageCount).toBeGreaterThanOrEqual(3);

    // Every page must have its own marker, and markers must appear in order
    // (docs/04-MODULES.md M3: a page boundary marker at every page).
    const markerIndexes = Array.from({ length: pageCount! }, (_, i) => {
      const index = markdown.indexOf(formatPageMarker('northwind-brief.pdf', i + 1));
      expect(index).toBeGreaterThan(-1);
      return index;
    });
    for (let i = 1; i < markerIndexes.length; i++) {
      expect(markerIndexes[i]).toBeGreaterThan(markerIndexes[i - 1]!);
    }

    // The document's opening sentence must fall within page 1's own bounds,
    // before the page 2 marker starts.
    const openingSentence = 'Northwind Analytics builds a product analytics platform';
    const openingIndex = markdown.indexOf(openingSentence);
    expect(openingIndex).toBeGreaterThan(markerIndexes[0]!);
    expect(openingIndex).toBeLessThan(markerIndexes[1]!);

    // A sentence from the pricing table, several pages later, must fall
    // strictly inside its own page's marker pair, never a different one.
    const laterSentence = 'Self-Serve is priced per tracked user';
    const laterIndex = markdown.indexOf(laterSentence);
    expect(laterIndex).toBeGreaterThan(-1);
    const enclosingPage = markerIndexes.filter((index) => index <= laterIndex).length; // 1-based page number
    expect(enclosingPage).toBeGreaterThan(1);
    const nextMarkerIndex = markerIndexes[enclosingPage]; // undefined if it's the last page
    if (nextMarkerIndex !== undefined) expect(laterIndex).toBeLessThan(nextMarkerIndex);
  });

  it('reports SCANNED_PDF rather than returning empty markdown when a PDF has no real text layer', async () => {
    vi.doMock('unpdf', async () => {
      const actual = await vi.importActual<typeof import('unpdf')>('unpdf');
      return {
        ...actual,
        extractTextItems: vi.fn().mockResolvedValue({
          totalPages: 3,
          items: [[], [], []],
        }),
      };
    });

    vi.resetModules();
    const { toMarkdown: toMarkdownMocked } = await import('./toMarkdown');
    const result = await toMarkdownMocked(join(SAMPLES, 'northwind-brief.pdf'), 'pdf');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCANNED_PDF');
    expect(result.error.recoverable).toBe(false);

    vi.doUnmock('unpdf');
    vi.resetModules();
  });

  it('fails with PARSE_FAILED, not a throw, for a file that does not exist', async () => {
    const result = await toMarkdown(join(SAMPLES, 'does-not-exist.pdf'), 'pdf');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PARSE_FAILED');
  });

  // docs/08-DEMO-SCENARIOS.md Scenario C / docs/PROMPTBOOK.md P7.4: real,
  // checked-in fixtures rather than a mocked unpdf, so "upload a password
  // protected PDF" and "upload a scanned PDF" are provable against actual
  // files a reviewer could pick up and re-upload themselves.
  it('reports ENCRYPTED with a plain English message for a real password-protected PDF fixture', async () => {
    const result = await toMarkdown(join(FIXTURES, 'encrypted.pdf'), 'pdf');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ENCRYPTED');
    expect(result.error.recoverable).toBe(false);
    expect(result.error.message).toContain('password protected');
    expect(result.error.message).not.toMatch(/PasswordException|at\s+\S+\.js:\d+/); // no raw exception text or stack frame
    expect(result.error.suggestion?.toLowerCase()).toContain('password');
  });

  it('reports SCANNED_PDF for a real PDF fixture with genuinely blank pages (no text layer)', async () => {
    const result = await toMarkdown(join(FIXTURES, 'scanned.pdf'), 'pdf');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCANNED_PDF');
    expect(result.error.recoverable).toBe(false);
    expect(result.error.message).toContain('no extractable text');
    expect(result.error.suggestion).toBeTruthy();
  });
});

describe('toMarkdown (docx)', () => {
  it('preserves Word headings as markdown headings and adds a single source marker', async () => {
    const result = await toMarkdown(join(SAMPLES, 'customer-notes.docx'), 'docx');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { markdown, pageCount } = result.data;
    expect(pageCount).toBeUndefined();
    expect(markdown.startsWith(formatSourceMarker('customer-notes.docx'))).toBe(true);
    expect(markdown).toMatch(/^#{1,6} /m);
  });
});

describe('toMarkdown (txt)', () => {
  it('passes text through under a single source marker', async () => {
    const result = await toMarkdown(join(SAMPLES, 'research-requirements.txt'), 'txt');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { markdown, pageCount } = result.data;
    expect(pageCount).toBeUndefined();
    expect(markdown.startsWith(formatSourceMarker('research-requirements.txt'))).toBe(true);
  });
});

describe('toMarkdown (unsupported)', () => {
  it('returns UNSUPPORTED_FORMAT for a kind with no document conversion, rather than throwing', async () => {
    const result = await toMarkdown(join(SAMPLES, 'campaigns.xlsx'), 'xlsx');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
  });
});
