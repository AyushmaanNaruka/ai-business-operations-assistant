import type { ErrorCode } from '@/types';

export type RetryClass = 'transient' | 'correctable' | 'terminal';

/**
 * Maps every ErrorCode to exactly one retry class, per docs/05-DATA-MODEL.md:
 *   transient   - two retries with backoff, then the fallback provider
 *   correctable - returned to the model, which self corrects; withRetry does not retry these
 *   terminal    - never retried, reported clearly, everything else continues
 */
const RETRY_CLASS: Record<ErrorCode, RetryClass> = {
  // transient: the same call is likely to succeed shortly, or a fallback provider can take over
  NETWORK: 'transient',
  RATE_LIMIT: 'transient',
  SEARCH_QUOTA: 'transient', // primary provider exhausted, M4 falls through to Tavily
  PAGE_BLOCKED: 'transient', // Jina blocked, M4 falls through to readability + jsdom
  SOURCE_PENDING: 'transient', // ingestion still running, will resolve on its own shortly
  QUERY_TIMEOUT: 'transient', // may succeed on a quieter run of the same statement

  // correctable: the fix is a different input from the model, not a retry of the same call
  QUERY_INVALID: 'correctable',
  PLAN_INVALID: 'correctable',

  // terminal: retrying changes nothing, report and move on
  SOURCE_NOT_FOUND: 'terminal',
  NO_DATA: 'terminal',
  PARSE_FAILED: 'terminal',
  SCANNED_PDF: 'terminal',
  FILE_TOO_LARGE: 'terminal',
  ENCRYPTED: 'terminal',
  UNSUPPORTED_FORMAT: 'terminal',
  RENDER_FAILED: 'terminal',
  UNSUPPORTED: 'terminal',
};

/** Returns the retry class for an ErrorCode. Every ErrorCode is covered. */
export function classify(code: ErrorCode): RetryClass {
  return RETRY_CLASS[code];
}
