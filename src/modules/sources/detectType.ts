import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { SourceKind, ToolResult } from '@/types';
import { fail, ok } from '@/modules/reliability';

const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// OOXML zips store their entry names as cleartext ASCII in each local file
// header, ahead of the (possibly compressed) entry data, so a plain byte
// search for the package's marker file tells xlsx and docx apart without a
// full zip parse.
const XLSX_ENTRY = Buffer.from('xl/workbook.xml', 'ascii');
const DOCX_ENTRY = Buffer.from('word/document.xml', 'ascii');

const TEXT_KIND_BY_EXTENSION: Record<string, SourceKind> = {
  '.csv': 'csv',
  '.json': 'json',
  '.txt': 'txt',
};

/**
 * Detects a file's real type from its extension AND its magic bytes, never
 * from a model. Magic bytes win: a zip based Office file or a legacy OLE
 * compound file is identified from its content even when the extension is
 * missing or misleading (docs/04-MODULES.md M1).
 */
export async function detectType(path: string): Promise<ToolResult<SourceKind>> {
  let buffer: Buffer;
  try {
    buffer = await readFile(path);
  } catch (err) {
    return fail('PARSE_FAILED', `Could not read ${path}: ${(err as Error).message}`, {
      recoverable: false,
    });
  }

  const ext = extname(path).toLowerCase();

  if (startsWith(buffer, PDF_MAGIC)) return ok('pdf');

  if (startsWith(buffer, ZIP_MAGIC)) {
    if (buffer.includes(XLSX_ENTRY)) return ok('xlsx');
    if (buffer.includes(DOCX_ENTRY)) return ok('docx');
    return fail(
      'UNSUPPORTED_FORMAT',
      'This is a zip based Office file this system does not parse (expected .xlsx or .docx).',
      { suggestion: 'Re-export the file as .xlsx (Excel) or .docx (Word) and upload that instead.' },
    );
  }

  if (startsWith(buffer, OLE_MAGIC)) {
    // Legacy binary Office (.xls, .doc): a different format from its modern
    // successor, and the only maintained parsers for it are abandoned.
    const modern = ext === '.doc' ? '.docx' : '.xlsx';
    return fail(
      'UNSUPPORTED_FORMAT',
      `This is a legacy binary Office file${ext ? ` (${ext})` : ''}, which this system does not read.`,
      { suggestion: `Save it as ${modern} and upload that instead.` },
    );
  }

  const textKind = TEXT_KIND_BY_EXTENSION[ext];
  if (textKind) return ok(textKind);

  return fail(
    'UNSUPPORTED_FORMAT',
    `Unrecognised file type${ext ? ` (${ext})` : ''}. Supported types: .xlsx, .csv, .pdf, .docx, .txt, .json.`,
    { suggestion: 'Convert the file to one of the supported formats.' },
  );
}

function startsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}
