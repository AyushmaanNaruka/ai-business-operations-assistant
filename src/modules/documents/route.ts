import type { DocMode } from '@/types';

const FULL_CONTEXT_TOKEN_LIMIT = Number(process.env.DOC_FULL_CONTEXT_TOKEN_LIMIT) || 25000;
const SESSION_DOC_TOKEN_BUDGET = Number(process.env.SESSION_DOC_TOKEN_BUDGET) || 60000;

/**
 * Routes a single document per docs/04-MODULES.md M3's table: over its own
 * token limit, or pushing the session's running full-mode total over
 * budget, means indexed. `sessionTotal` is the sum of tokens already
 * committed to `full` mode in this session, before this document.
 */
export function route(tokenCount: number, sessionTotal: number): DocMode {
  if (tokenCount > FULL_CONTEXT_TOKEN_LIMIT) return 'indexed';
  if (sessionTotal + tokenCount > SESSION_DOC_TOKEN_BUDGET) return 'indexed';
  return 'full';
}

export type DocEntry = {
  sourceId: string;
  tokenCount: number;
  mode: DocMode;
};

/**
 * Enforces `SESSION_DOC_TOKEN_BUDGET` across every document in a session,
 * flipping the largest `full` documents to `indexed` until the total fits,
 * never the newest. `route()` alone only decides a single new document's
 * own mode; this is what makes an earlier, larger document flip instead of
 * the new small one when the two together bust the budget.
 */
export function rebalance(docs: DocEntry[]): DocEntry[] {
  const next = docs.map((d) => ({ ...d }));
  const fullTotal = () => next.filter((d) => d.mode === 'full').reduce((sum, d) => sum + d.tokenCount, 0);

  while (fullTotal() > SESSION_DOC_TOKEN_BUDGET) {
    const fullDocs = next.filter((d) => d.mode === 'full');
    if (fullDocs.length === 0) break;
    const largest = fullDocs.reduce((a, b) => (b.tokenCount > a.tokenCount ? b : a));
    const target = next.find((d) => d.sourceId === largest.sourceId)!;
    target.mode = 'indexed';
  }

  return next;
}
