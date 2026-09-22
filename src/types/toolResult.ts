/** Every tool returns this. No tool throws; an exception reaching the agent loop is a bug. */

/** Every failure mode a tool can report, mapped to a retry class by `classify()` in the reliability module. */
export type ErrorCode =
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_PENDING'
  | 'QUERY_INVALID'
  | 'QUERY_TIMEOUT'
  | 'NO_DATA'
  | 'PARSE_FAILED'
  | 'SCANNED_PDF'
  | 'FILE_TOO_LARGE'
  | 'ENCRYPTED'
  | 'UNSUPPORTED_FORMAT'
  | 'SEARCH_QUOTA'
  | 'PAGE_BLOCKED'
  | 'NETWORK'
  | 'RATE_LIMIT'
  | 'RENDER_FAILED'
  | 'PLAN_INVALID'
  | 'UNSUPPORTED';

/** A tool failure, safe to show the user directly. */
export type ToolFailure = {
  code: ErrorCode;
  message: string; // plain language, safe to show the user
  recoverable: boolean;
  suggestion?: string; // what to try instead
};

/** The discriminated union every tool in this system returns instead of throwing. */
export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: ToolFailure };
