import type { JS } from '@duckdb/node-api';

/** A query result value, guaranteed JSON serialisable. */
export type QueryValue = string | number | boolean | null | QueryValue[] | { [key: string]: QueryValue };

/**
 * Converts a raw DuckDB JS value into something safe to put in a ToolResult
 * and send back through a Zod-typed tool. BIGINT/HUGEINT columns (COUNT,
 * SUM over integers) arrive as `bigint`, which JSON.stringify throws on;
 * they become a plain number when safe, otherwise a decimal string rather
 * than silently losing precision.
 */
export function toJsonSafeValue(value: JS): QueryValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') {
    return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(toJsonSafeValue);
  if (typeof value === 'object') {
    const out: { [key: string]: QueryValue } = {};
    for (const [key, v] of Object.entries(value)) out[key] = toJsonSafeValue(v as JS);
    return out;
  }
  return value;
}

export function rowToJsonSafe(row: Record<string, JS>): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  for (const [key, value] of Object.entries(row)) out[key] = toJsonSafeValue(value);
  return out;
}
