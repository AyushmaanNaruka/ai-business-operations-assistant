/**
 * Which sources a specialist tool call may read (docs/DECISIONS.md D-72). One process
 * serves every conversation, so the registry, the DuckDB session and the document
 * store hold every user's files at once; without a scope, one chat's analyst could list,
 * read or query another chat's uploads. `delegate()` (src/mastra/agents/contracts.ts)
 * puts the task's source ids on the call's RequestContext under SOURCE_SCOPE_KEY, and
 * every data and document tool checks it through these helpers.
 *
 * A call with no scope set (Mastra Studio, a direct test) is unscoped: everything is
 * readable, as before. A scope that is set but empty allows nothing.
 */
export const SOURCE_SCOPE_KEY = 'sourceIds';

export type SourceScope = ReadonlySet<string> | null;

type ContextWithRequestContext = { requestContext?: { get?: (key: string) => unknown } };

/** The allowed source ids for this tool call, or null when the call is unscoped. */
export function sourceScope(context: unknown): SourceScope {
  const value = (context as ContextWithRequestContext | undefined)?.requestContext?.get?.(SOURCE_SCOPE_KEY);
  if (!Array.isArray(value)) return null;
  return new Set(value.filter((id): id is string => typeof id === 'string'));
}

export function inScope(scope: SourceScope, sourceId: string): boolean {
  return scope === null || scope.has(sourceId);
}
