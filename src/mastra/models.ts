/**
 * Model tiers, not model names. Every agent and tool in this codebase imports MODELS.*
 * and never a hardcoded model string, so swapping provider or model is a one file
 * change. Enforced by convention: `grep -r "gemini\|llama\|groq/" src --include=*.ts`
 * should return only this file.
 */
export const MODELS = {
  // Cheap and fast. Intent classification and other short, low stakes decisions.
  // groq/openai/gpt-oss-120b, not the originally planned llama-3.3-70b-versatile:
  // see docs/DECISIONS.md D-24, that model is not in this project's live Groq
  // account's model catalog.
  ROUTER: 'groq/openai/gpt-oss-120b',
  // Reasoning over evidence: the data analyst, document and research agents, synthesis.
  ANALYST: 'google/gemini-2.5-flash',
  // Authoring the one model step in the artifact workflow, where output quality matters most.
  WRITER: 'google/gemini-2.5-flash',
  // Re-scoring retrieved passages down to the top few. Small, fast, run often.
  // groq/openai/gpt-oss-20b, not the originally planned llama-3.1-8b-instant:
  // see docs/DECISIONS.md D-24, same account-catalog issue as ROUTER above.
  RERANK: 'groq/openai/gpt-oss-20b',
} as const;
