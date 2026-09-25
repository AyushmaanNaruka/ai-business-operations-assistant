/**
 * A fixed window request limiter, in memory, for the chat UI's API routes
 * (docs/DECISIONS.md D-56). With paid model keys configured, an unthrottled
 * /api/chat is a way to spend the company's money; the limit caps how many turns
 * one client can start per window. In memory is deliberate: this is a single
 * process deployment (D-42), and a limiter that forgets on restart only ever
 * errs towards letting a request through.
 */

export type RateLimitDecision = { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = {
  check(key: string, now?: number): RateLimitDecision;
};

export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, { start: number; count: number }>();

  return {
    check(key, now = Date.now()) {
      if (limit <= 0) return { allowed: true, remaining: Number.POSITIVE_INFINITY }; // 0 disables the limit
      let entry = windows.get(key);
      if (!entry || now - entry.start >= windowMs) {
        // Bound memory: drop expired windows once the table is large.
        if (!entry && windows.size >= maxKeys) {
          for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
          if (windows.size >= maxKeys) windows.delete(windows.keys().next().value as string);
        }
        entry = { start: now, count: 0 };
        windows.set(key, entry);
      }
      if (entry.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000)) };
      }
      entry.count += 1;
      return { allowed: true, remaining: limit - entry.count };
    },
  };
}
