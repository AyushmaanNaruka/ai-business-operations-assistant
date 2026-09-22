import { PDFParse } from 'pdf-parse';

let warmup: Promise<void> | null = null;

/**
 * `unpdf` and `pdf-parse` each bundle their own copy of pdf.js and register
 * a shared Node "fake worker" global the first time either one actually
 * parses something; whichever wins that race pins the whole process to its
 * own pdf.js API/Worker version pair, including for the other library's
 * later calls. If `unpdf` (toMarkdown.ts) runs first, every subsequent
 * `pdf-parse` call (extractTables.ts) fails with "The API version ... does
 * not match the Worker version ...", verified against the sample brief:
 * table extraction failed only when a markdown conversion of the same PDF
 * had already run earlier in the process.
 *
 * Running one lightweight `pdf-parse` call before any PDF is touched makes
 * `pdf-parse` win that race instead, which was confirmed to keep both
 * libraries working for the rest of the process regardless of call order
 * afterward. Memoized so it only actually runs once per process.
 */
export function warmUpPdfJs(buffer: Uint8Array): Promise<void> {
  if (!warmup) {
    warmup = (async () => {
      const parser = new PDFParse({ data: buffer });
      try {
        await parser.getInfo();
      } catch {
        // Only the pdf.js worker registration matters here; a parse
        // failure on whatever buffer happened to arrive first is fine.
      } finally {
        await parser.destroy();
      }
    })();
  }
  return warmup;
}
