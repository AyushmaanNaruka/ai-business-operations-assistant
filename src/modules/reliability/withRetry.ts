import type { ToolResult } from '@/types';
import { classify } from './classify';

export type RetryPolicy = {
  /**
   * Maximum retry attempts after the first call. Defaults to the class based policy:
   * 2 for transient failures, 0 for everything else (correctable self corrects at the
   * agent level, terminal never retries).
   */
  maxRetries?: number;
  /** Base delay before the first retry, doubled on each subsequent attempt. Default 200ms. */
  baseDelayMs?: number;
  /** Injectable sleep, so tests can assert backoff without waiting in real time. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, and on a failed ToolResult, retries per the classification of the error
 * code it returned: transient failures retry with exponential backoff, correctable
 * and terminal failures return immediately so the caller (the model, for correctable
 * errors) can react. Never throws; `fn` itself must return a ToolResult, never throw.
 */
export async function withRetry<T>(fn: () => Promise<ToolResult<T>>, policy: RetryPolicy = {}): Promise<ToolResult<T>> {
  const baseDelayMs = policy.baseDelayMs ?? 200;
  const sleep = policy.sleep ?? defaultSleep;

  let attempt = 0;
  let last: ToolResult<T>;

  do {
    last = await fn();
    if (last.ok) return last;

    const maxRetries = policy.maxRetries ?? (classify(last.error.code) === 'transient' ? 2 : 0);
    if (attempt >= maxRetries) return last;

    await sleep(baseDelayMs * 2 ** attempt);
    attempt += 1;
  } while (true);
}
