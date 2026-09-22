import type { Source, TableRef } from '@/types';

export type SourceCardOptions = {
  tables?: TableRef[];
  doc?: Source['doc'];
};

/**
 * The dense, factual summary the orchestrator reads every turn
 * (docs/03-ARCHITECTURE.md section 4.1). Written for a model to route on,
 * not for a human, so it stays compact: id, name, kind, size, columns, then
 * every quality warning so the analyst has no excuse to miss one.
 *
 * A source can be both prose and tabular at once (docs/03-ARCHITECTURE.md
 * Part 9, gap A: a table found inside a PDF or Word file registers in
 * DuckDB alongside the document). When both are present the card shows a
 * compact "table extracted" line rather than the full column/warning list a
 * primary tabular source (an uploaded spreadsheet) gets, since a table
 * pulled out of a document is a secondary fact about that source, not the
 * source itself.
 */
export function buildSourceCard(source: Pick<Source, 'id' | 'name'>, opts: SourceCardOptions): string {
  const tables = opts.tables ?? [];
  const doc = opts.doc;
  const lines: string[] = [];

  const kindLabel = doc ? (tables.length > 0 ? 'document + tabular' : 'document') : 'tabular';
  lines.push(`${source.id}  ${source.name}  ${kindLabel}`);

  if (doc) {
    const parts: string[] = [];
    if (doc.pageCount !== undefined) parts.push(`${doc.pageCount} pages`);
    parts.push(`${doc.tokenCount.toLocaleString('en-US')} tokens`);
    parts.push(`${doc.mode} mode`);
    lines.push(`       ${parts.join(', ')}`);
  }

  if (doc) {
    if (tables.length === 1) {
      lines.push(`       1 table extracted -> ${tableLine(tables[0]!)}`);
    } else if (tables.length > 1) {
      lines.push(`       ${tables.length} tables extracted:`);
      for (const table of tables) lines.push(`         -> ${tableLine(table)}`);
    }
  } else {
    for (const table of tables) {
      const columnCount = table.columns.length;
      lines.push(`       ${table.rowCount.toLocaleString('en-US')} rows, ${columnCount} columns`);
      lines.push(`       columns: ${table.columns.map((c) => c.name).join(', ')}`);
      if (table.qualityWarnings.length > 0) {
        lines.push('       warnings:');
        for (const warning of table.qualityWarnings) lines.push(`         - ${warning}`);
      }
    }
  }

  return lines.join('\n');
}

function tableLine(table: TableRef): string {
  return `${table.tableName} (${table.rowCount.toLocaleString('en-US')} rows, ${table.columns.length} columns)`;
}
