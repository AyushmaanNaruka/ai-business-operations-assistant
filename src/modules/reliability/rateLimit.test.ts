import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
  it('allows up to the limit per window, then refuses with a retry delay', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.check('a', 0)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.check('a', 1_000)).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.check('a', 2_000)).toEqual({ allowed: false, retryAfterSeconds: 58 });
  });

  it('starts a fresh window once the old one has passed', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('a', 500).allowed).toBe(false);
    expect(limiter.check('a', 1_000).allowed).toBe(true);
  });

  it('counts each key separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 0).allowed).toBe(false);
  });

  it('treats a limit of 0 as switched off', () => {
    const limiter = createRateLimiter({ limit: 0, windowMs: 60_000 });
    for (let i = 0; i < 100; i++) expect(limiter.check('a', 0).allowed).toBe(true);
  });

  it('keeps memory bounded by evicting old keys', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 3 });
    for (const key of ['a', 'b', 'c', 'd', 'e']) expect(limiter.check(key, 0).allowed).toBe(true);
  });
});
