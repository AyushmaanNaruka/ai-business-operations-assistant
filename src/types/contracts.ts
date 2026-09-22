import type { Evidence } from './evidence';
import type { ToolFailure } from './toolResult';

/**
 * Specialists never see chat history. They receive a typed task and return a typed
 * result. This is the lesson from Mastra deprecating `.network()`.
 */
export type SpecialistTask = {
  objective: string; // one sentence, what to determine
  sourceIds: string[]; // what is in scope
  knownFacts: Evidence[]; // only what matters here, not the conversation
  expect: string; // shape of answer wanted
  constraints?: string[]; // "Q3 only", "exclude paid social"
};

/** `gaps` is the anti hallucination mechanism: a specialist that cannot determine something says so here. */
export type SpecialistResult = {
  answer: string;
  evidence: Evidence[];
  gaps: string[]; // what it could NOT determine, and why
  failures: ToolFailure[];
};
