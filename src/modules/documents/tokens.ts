import { countTokens as gptCountTokens } from 'gpt-tokenizer';

/** Counts tokens the same way the model context is measured, so routing decisions match reality (docs/04-MODULES.md M3). */
export function countTokens(markdown: string): number {
  return gptCountTokens(markdown);
}
