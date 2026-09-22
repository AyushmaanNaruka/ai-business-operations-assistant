import type { Artifact } from './artifact';
import type { Finding } from './finding';
import type { Source } from './source';

/**
 * Lives in Mastra working memory. The orchestrator reads it first, every turn.
 * Small enough to keep permanently in context, structured enough to route on.
 * A reference like "the other one" or "this" resolves against this, not against
 * re-reading the conversation.
 */
export type SessionManifest = {
  sources: Source[]; // rendered as source cards
  findings: Finding[];
  artifacts: Artifact[];
  openGaps: string[]; // things the system could not determine this session
};
