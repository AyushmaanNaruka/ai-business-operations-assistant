import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import PptxGenJS from 'pptxgenjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cellText, previewFile, slideParagraphs } from './preview';

const ROOT = resolve(__dirname, '../../..');
const FIXTURES = resolve(__dirname, '../sources/__fixtures__');

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'preview-test-'));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('previewFile', () => {
  it('previews a workbook as a table with its header and true row count', async () => {
    const result = await previewFile(resolve(ROOT, 'samples/campaigns.xlsx'));
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.type !== 'table') throw new Error('expected a table preview');
    const [sheet] = result.data.sheets;
    expect(sheet!.columns.length).toBeGreaterThan(0);
    expect(sheet!.rows.length).toBeGreaterThan(0);
    expect(sheet!.rows.length).toBeLessThanOrEqual(100);
    expect(sheet!.totalRows).toBeGreaterThanOrEqual(sheet!.rows.length);
  });

  it('previews a CSV with its header row separated from the data', async () => {
    const result = await previewFile(resolve(FIXTURES, 'sample.csv'));
    if (!result.ok || result.data.type !== 'table') throw new Error('expected a table preview');
    expect(result.data.sheets[0]!.columns).toEqual(['campaign_name', 'channel', 'spend', 'conversions']);
    expect(result.data.sheets[0]!.rows[0]).toEqual(['Spring Launch', 'Email', '1200', '45']);
  });

  it('previews a Word document as HTML with a no script CSP', async () => {
    const result = await previewFile(resolve(ROOT, 'samples/customer-notes.docx'));
    if (!result.ok || result.data.type !== 'html') throw new Error('expected an html preview');
    expect(result.data.html).toContain("default-src 'none'");
    expect(result.data.html).not.toMatch(/<script/i);
    expect(result.data.html.length).toBeGreaterThan(200);
  });

  it('hands a PDF to the browser viewer rather than extracting it', async () => {
    const result = await previewFile(resolve(ROOT, 'samples/northwind-brief.pdf'));
    expect(result).toEqual({ ok: true, data: { type: 'pdf' } });
  });

  it('shows a text file verbatim, instructions and all, as data', async () => {
    const result = await previewFile(resolve(FIXTURES, 'hostile-instruction.txt'));
    if (!result.ok || result.data.type !== 'text') throw new Error('expected a text preview');
    expect(result.data.format).toBe('plain');
    expect(result.data.truncated).toBe(false);
    expect(result.data.text.length).toBeGreaterThan(0);
  });

  it('pretty prints JSON', async () => {
    const result = await previewFile(resolve(FIXTURES, 'sample.json'));
    if (!result.ok || result.data.type !== 'text') throw new Error('expected a text preview');
    expect(result.data.format).toBe('json');
    expect(result.data.text).toContain('\n  ');
  });

  it('reads each slide of a deck in order, first paragraph as the title', async () => {
    const pptx = new PptxGenJS();
    const first = pptx.addSlide();
    first.addText('Q3 Campaign Review', { x: 0.5, y: 0.5, w: 9, h: 1 });
    first.addText('Email & Paid Search led', { x: 0.5, y: 2, w: 9, h: 1 });
    const second = pptx.addSlide();
    second.addText('Next steps', { x: 0.5, y: 0.5, w: 9, h: 1 });
    const path = join(tmp, 'deck.pptx');
    await writeFile(path, (await pptx.write({ outputType: 'nodebuffer' })) as Buffer);

    const result = await previewFile(path);
    if (!result.ok || result.data.type !== 'slides') throw new Error('expected a slides preview');
    expect(result.data.slides.map((s) => s.title)).toEqual(['Q3 Campaign Review', 'Next steps']);
    expect(result.data.slides[0]!.body).toEqual(['Email & Paid Search led']);
  });

  it('reports a missing file as a failure instead of throwing', async () => {
    const result = await previewFile(join(tmp, 'gone.xlsx'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SOURCE_NOT_FOUND');
  });

  it('reports an unsupported extension as a failure', async () => {
    const path = join(tmp, 'thing.bin');
    await writeFile(path, 'x');
    const result = await previewFile(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('reports a corrupt workbook as a parse failure', async () => {
    const result = await previewFile(resolve(FIXTURES, 'corrupt.xlsx'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_FAILED');
  });
});

describe('slideParagraphs', () => {
  it('joins runs within a paragraph and decodes XML entities', () => {
    const xml = '<a:p><a:r><a:t>Spend &amp; </a:t></a:r><a:r><a:t>ROI &lt;2x</a:t></a:r></a:p><a:p><a:r><a:t> </a:t></a:r></a:p>';
    expect(slideParagraphs(xml)).toEqual(['Spend & ROI <2x']);
  });
});

describe('cellText', () => {
  it('renders formula results, rich text, hyperlinks and dates', () => {
    expect(cellText({ formula: 'A1+B1', result: 42 })).toBe('42');
    expect(cellText({ richText: [{ text: 'a' }, { text: 'b' }] })).toBe('ab');
    expect(cellText({ text: 'site', hyperlink: 'https://example.com' })).toBe('site');
    expect(cellText(new Date('2026-09-26T00:00:00Z'))).toBe('2026-09-26');
    expect(cellText(null)).toBe('');
  });
});
