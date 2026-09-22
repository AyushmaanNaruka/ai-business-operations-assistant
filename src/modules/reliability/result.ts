import type { ErrorCode, ToolFailure, ToolResult } from '@/types';
import { classify } from './classify';

/** Wraps a successful value in the ToolResult union. */
export function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

export type FailOptions = {
  recoverable?: boolean;
  suggestion?: string;
};

/** Builds a failed ToolResult. Never throw; return this instead. */
export function fail(code: ErrorCode, message: string, opts: FailOptions = {}): ToolResult<never> {
  const failure: ToolFailure = {
    code,
    message,
    recoverable: opts.recoverable ?? classify(code) !== 'terminal',
    ...(opts.suggestion !== undefined ? { suggestion: opts.suggestion } : {}),
  };
  return { ok: false, error: failure };
}
