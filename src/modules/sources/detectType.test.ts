import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectType } from './detectType';

const FIXTURES = join(import.meta.dirname, '__fixtures__');
// Real samples built in Phase 1 double as fixtures here so the detector is
// proven against actual xlsx/docx/pdf/txt files, not synthetic stand-ins.
const SAMPLES = join(import.meta.dirname, '..', '..', '..', 'samples');

describe('detectType', () => {
  it('identifies a real .xlsx from its zip contents', async () => {
    const result = await detectType(join(SAMPLES, 'campaigns.xlsx'));
    expect(result).toEqual({ ok: true, data: 'xlsx' });
  });

  it('identifies a real .docx from its zip contents', async () => {
    const result = await detectType(join(SAMPLES, 'customer-notes.docx'));
    expect(result).toEqual({ ok: true, data: 'docx' });
  });

  it('identifies a real .pdf from its magic bytes', async () => {
    const result = await detectType(join(SAMPLES, 'northwind-brief.pdf'));
    expect(result).toEqual({ ok: true, data: 'pdf' });
  });

  it('identifies a .txt file by extension', async () => {
    const result = await detectType(join(SAMPLES, 'research-requirements.txt'));
    expect(result).toEqual({ ok: true, data: 'txt' });
  });

  it('identifies a .csv file by extension', async () => {
    const result = await detectType(join(FIXTURES, 'sample.csv'));
    expect(result).toEqual({ ok: true, data: 'csv' });
  });

  it('identifies a .json file by extension', async () => {
    const result = await detectType(join(FIXTURES, 'sample.json'));
    expect(result).toEqual({ ok: true, data: 'json' });
  });

  // docs/08-DEMO-SCENARIOS.md Scenario C / docs/PROMPTBOOK.md P7.4: a real,
  // checked-in .xls fixture (not the ephemeral one built below), so the
  // "upload a .xls" breakage-pass case is provable against an on-disk file
  // like the one a reviewer would actually pick from their filesystem.
  it('rejects the checked-in legacy.xls fixture, naming .xlsx as the fix', async () => {
    const result = await detectType(join(FIXTURES, 'legacy.xls'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
    expect(result.error.message.toLowerCase()).toContain('legacy');
    expect(result.error.suggestion?.toLowerCase()).toContain('.xlsx');
  });

  it('rejects a missing file with PARSE_FAILED, not a crash', async () => {
    const result = await detectType(join(FIXTURES, 'does-not-exist.xlsx'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARSE_FAILED');
  });

  describe('synthetic binary fixtures', () => {
    let dir: string;

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'detect-type-'));
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('rejects a legacy .xls (OLE compound file) with a helpful error naming .xlsx', async () => {
      const path = join(dir, 'legacy.xls');
      // The real OLE compound file signature, real workbook bytes are not needed
      // to prove the detector reads the header rather than trusting the name.
      const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      await writeFile(path, Buffer.concat([oleHeader, Buffer.alloc(64)]));

      const result = await detectType(path);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
        expect(result.error.message.toLowerCase()).toContain('legacy');
        expect(result.error.suggestion?.toLowerCase()).toContain('.xlsx');
      }
    });

    it('catches a misleading extension: real xlsx bytes saved as .txt', async () => {
      const path = join(dir, 'not-actually-text.txt');
      const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      const entryName = Buffer.from('xl/workbook.xml', 'ascii');
      await writeFile(path, Buffer.concat([zipMagic, Buffer.alloc(4), entryName, Buffer.alloc(32)]));

      const result = await detectType(path);

      expect(result).toEqual({ ok: true, data: 'xlsx' });
    });

    it('catches a misleading extension: a PDF saved as .csv', async () => {
      const path = join(dir, 'not-actually-csv.csv');
      await writeFile(path, Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'binary'));

      const result = await detectType(path);

      expect(result).toEqual({ ok: true, data: 'pdf' });
    });

    it('reports an unrecognised extension as UNSUPPORTED_FORMAT rather than guessing', async () => {
      const path = join(dir, 'photo.png');
      await writeFile(path, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const result = await detectType(path);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_FORMAT');
    });
  });
});
