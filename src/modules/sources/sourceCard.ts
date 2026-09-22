import type { Source, TableRef } from '@/types';

/**
 * The dense, factual summary the orchestrator reads every turn
 * (docs/03-ARCHITECTURE.md section 4.1). Written for a model to route on,
 * not for a human, so it stays compact: id, name, kind, size, columns, then
 * every quality warning so the analyst has no excuse to miss one.
 */
export function buildSourceCard(source: Pick<Source, 'id' | 'name'>, tables: TableRef[]): string {
  const lines: string[] = [];

  for (const table of tables) {
    const columnCount = table.columns.length;
    lines.push(`${source.id}  ${source.name}  tabular`);
    lines.push(`       ${table.rowCount.toLocaleString('en-US')} rows, ${columnCount} columns`);
    lines.push(`       columns: ${table.columns.map((c) => c.name).join(', ')}`);
    if (table.qualityWarnings.length > 0) {
      lines.push('       warnings:');
      for (const warning of table.qualityWarnings) lines.push(`         - ${warning}`);
    }
  }

  return lines.join('\n');
}
