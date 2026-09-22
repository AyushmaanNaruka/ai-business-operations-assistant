/**
 * Converts samples/src/northwind-brief.md to samples/northwind-brief.pdf via
 * Puppeteer, per P1.5 in docs/PROMPTBOOK.md. Reused later as the shape of
 * renderPdf.ts in Phase 6 (one HTML template serving both preview and PDF).
 *
 * The markdown-to-HTML step here is a small hand-rolled converter, not a new
 * dependency: it only needs to handle the exact subset of markdown used in the
 * brief (headings, paragraphs, bold, numbered lists, one pipe table), so pulling
 * in a full markdown library for sample generation isn't worth the added
 * dependency per docs/06-RESEARCH-STACK.md.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const html: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.startsWith('# ')) {
      html.push(`<h1>${inline(line.slice(2))}</h1>`);
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      html.push(`<h2>${inline(line.slice(3))}</h2>`);
      i++;
      continue;
    }

    // Pipe table: a header row, a separator row, then data rows.
    if (line.trim().startsWith('|') && lines[i + 1]?.trim().match(/^\|[\s:|-]+\|$/)) {
      const headerCells = line
        .trim()
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      html.push('<div class="tablewrap"><table><thead><tr>');
      for (const cell of headerCells) html.push(`<th>${inline(cell)}</th>`);
      html.push('</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        const cells = lines[i]!
          .trim()
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        html.push('<tr>');
        for (const cell of cells) html.push(`<td>${inline(cell)}</td>`);
        html.push('</tr>');
        i++;
      }
      html.push('</tbody></table></div>');
      continue;
    }

    // Numbered list: consecutive "1. text" lines.
    if (/^\d+\.\s/.test(line)) {
      html.push('<ol>');
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        html.push(`<li>${inline(lines[i]!.replace(/^\d+\.\s/, ''))}</li>`);
        i++;
      }
      html.push('</ol>');
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: consume until a blank line or a new block starts.
    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.startsWith('#') && !/^\d+\.\s/.test(lines[i]!) && !lines[i]!.trim().startsWith('|')) {
      paragraph.push(lines[i]!);
      i++;
    }
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return html.join('\n');
}

const PAGE_STYLE = `
  @page { size: A4; margin: 22mm 20mm; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; line-height: 1.55; font-size: 11.5pt; }
  h1 { font-size: 20pt; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 4px; }
  h1 + p { color: #555; font-style: italic; margin-top: 0; }
  h2 { font-size: 14.5pt; margin-top: 28px; border-left: 4px solid #2c5f7c; padding-left: 10px; }
  p { text-align: justify; }
  .tablewrap { position: relative; margin: 14px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 10.5pt; }
  th, td { border: none; padding: 6px 8px; text-align: left; }
  th { background: #2c5f7c; color: white; }
  tr:nth-child(even) td { background: #f2f6f8; }
  .tablewrap svg { position: absolute; inset: 0; pointer-events: none; }
  ol { padding-left: 22px; }
  li { margin-bottom: 6px; }
`;

async function main() {
  const mdPath = resolve(process.cwd(), 'samples/src/northwind-brief.md');
  const pdfPath = resolve(process.cwd(), 'samples/northwind-brief.pdf');

  const markdown = await readFile(mdPath, 'utf8');
  const bodyHtml = markdownToHtml(markdown);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}</style></head><body>${bodyHtml}</body></html>`;

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });

    // Puppeteer paints CSS table borders (`border: 1px solid`) as filled
    // rectangles in the PDF's content stream, not stroked vector paths, so
    // pdf-parse's getTable() (which only scans stroke operators, since it
    // walks each page's operator list and skips anything that is not
    // `OPS.stroke`) finds nothing. Drawing the grid as an SVG overlay with a
    // real `stroke` produces genuine vector line/rectangle operators that
    // getTable() can detect, which the P3.2 table-extraction path depends on
    // (docs/03-ARCHITECTURE.md Part 9, gap A).
    await page.evaluate(() => {
      for (const wrap of Array.from(document.querySelectorAll<HTMLElement>('.tablewrap'))) {
        const table = wrap.querySelector('table');
        if (!table) continue;
        const wrapRect = wrap.getBoundingClientRect();
        const rows = Array.from(table.querySelectorAll('tr'));
        const rowYs = rows.map((row) => row.getBoundingClientRect().top - wrapRect.top);
        const lastRow = rows[rows.length - 1]!;
        rowYs.push(lastRow.getBoundingClientRect().bottom - wrapRect.top);

        const firstRowCells = Array.from(rows[0]!.children) as HTMLElement[];
        const colXs = firstRowCells.map((cell) => cell.getBoundingClientRect().left - wrapRect.left);
        const lastCell = firstRowCells[firstRowCells.length - 1]!;
        colXs.push(lastCell.getBoundingClientRect().right - wrapRect.left);

        const width = wrapRect.width;
        const height = wrapRect.height;
        const lines: string[] = [];
        for (const y of rowYs) lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#999" stroke-width="1" />`);
        for (const x of colXs) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="#999" stroke-width="1" />`);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.innerHTML = lines.join('');
        wrap.appendChild(svg);
      }
    });

    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '22mm', bottom: '22mm', left: '20mm', right: '20mm' },
    });
  } finally {
    await browser.close();
  }

  console.log(`Wrote ${pdfPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
