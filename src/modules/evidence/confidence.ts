import type { EvidenceKind } from '@/types';

export type Confidence = 'high' | 'medium' | 'low';

export type ConfidenceContext = {
  /** For kind 'document': true when read via the RAG chunk + rerank path rather than quoted from full context. */
  retrieved?: boolean;
  /** True when this fact was inferred by combining other evidence rather than sourced directly. */
  inferred?: boolean;
};

/**
 * Assigns confidence by rule, exactly the table in docs/05-DATA-MODEL.md.
 * Never a caller-supplied value: `addEvidence` calls this and discards any
 * confidence the caller tried to pass in.
 *
 *   computed                              -> high
 *   document, quoted from full context    -> high
 *   document, retrieved chunk (reranked)  -> medium
 *   web page content                      -> medium
 *   inferred across sources (any kind)    -> low
 */
export function assignConfidence(kind: EvidenceKind, context: ConfidenceContext = {}): Confidence {
  if (context.inferred) return 'low';

  switch (kind) {
    case 'computed':
      return 'high';
    case 'document':
      return context.retrieved ? 'medium' : 'high';
    case 'web':
      return 'medium';
  }
}
