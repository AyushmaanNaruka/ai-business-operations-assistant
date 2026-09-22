import { describe, expect, it, vi } from 'vitest';
import type { ToolResult } from '@/types';
import { fail, ok } from './result';
import { withRetry } from './withRetry';

function noSleep() {
  return vi.fn(async () => {});
}

describe('withRetry', () => {
  it('returns the successful result immediately without retrying', async () => {
    const fn = vi.fn(async (): Promise<ToolResult<number>> => ok(42));
    const result = await withRetry(fn, { sleep: noSleep() });
    expect(result).toEqual({ ok: true, data: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure up to the default of two attempts, then gives up', async () => {
    const fn = vi.fn(async (): Promise<ToolResult<number>> => fail('NETWORK', 'offline'));
    const result = await withRetry(fn, { sleep: noSleep() });

    expect(fn).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure');
    expect(result.error.code).toBe('NETWORK'); // the last error, not a thrown exception
  });

  it('does not retry a correctable failure, since the agent self corrects', async () => {
    const fn = vi.fn(async (): Promise<ToolResult<number>> => fail('QUERY_INVALID', 'bad sql'));
    const result = await withRetry(fn, { sleep: noSleep() });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it('does not retry a terminal failure', async () => {
    const fn = vi.fn(async (): Promise<ToolResult<number>> => fail('ENCRYPTED', 'password protected'));
    const result = await withRetry(fn, { sleep: noSleep() });

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on a later attempt without exhausting all retries', async () => {
    let calls = 0;
    const fn = vi.fn(async (): Promise<ToolResult<string>> => {
      calls += 1;
      return calls < 2 ? fail('RATE_LIMIT', 'slow down') : ok('done');
    });

    const result = await withRetry(fn, { sleep: noSleep() });
    expect(result).toEqual({ ok: true, data: 'done' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honours an explicit maxRetries override regardless of classification', async () => {
    const fn = vi.fn(async (): Promise<ToolResult<number>> => fail('ENCRYPTED', 'nope'));
    const result = await withRetry(fn, { sleep: noSleep(), maxRetries: 3 });

    expect(fn).toHaveBeenCalledTimes(4);
    expect(result.ok).toBe(false);
  });

  it('backs off with doubling delay between transient retries', async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async (): Promise<ToolResult<number>> => fail('NETWORK', 'offline'));

    await withRetry(fn, { sleep, baseDelayMs: 10 });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('actually delays in real time when no sleep override is given', async () => {
    const fn = vi.fn(async (): Promise<ToolResult<number>> => fail('NETWORK', 'offline'));
    const start = Date.now();

    await withRetry(fn, { maxRetries: 1, baseDelayMs: 30 });

    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });
});
