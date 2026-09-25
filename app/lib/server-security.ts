import { randomUUID } from "node:crypto";
import { createRateLimiter, type RateLimiter } from "@/modules/reliability";
import { isValidSessionId } from "@/modules/session";

/**
 * Shared request hardening for the API routes (docs/DECISIONS.md D-56): per client
 * rate limits, session id validation, and error responses that never echo an
 * internal message (paths, SQL, provider errors) back to the browser.
 */

type Bucket = "chat" | "upload" | "read";

const DEFAULT_LIMITS: Record<Bucket, { env: string; perMinute: number }> = {
  // A chat turn can spend real money once paid model keys are configured.
  chat: { env: "RATE_LIMIT_CHAT_PER_MINUTE", perMinute: 20 },
  upload: { env: "RATE_LIMIT_UPLOAD_PER_MINUTE", perMinute: 30 },
  // Manifest polling (every 2 to 5 seconds per open tab), previews, history.
  read: { env: "RATE_LIMIT_READ_PER_MINUTE", perMinute: 300 },
};

// On globalThis so Next's Fast Refresh does not reset the counters on every save.
const g = globalThis as typeof globalThis & { __rateLimiters__?: Map<Bucket, RateLimiter> };
const limiters = (g.__rateLimiters__ ??= new Map());

function limiterFor(bucket: Bucket): RateLimiter {
  let limiter = limiters.get(bucket);
  if (!limiter) {
    const { env, perMinute } = DEFAULT_LIMITS[bucket];
    // Empty or unset means the default; only an explicit number (0 included, which
    // switches the limit off) overrides it. Number("") is 0, so check the raw value.
    const raw = process.env[env]?.trim();
    const configured = raw ? Number(raw) : Number.NaN;
    limiter = createRateLimiter({ limit: Number.isFinite(configured) && configured >= 0 ? configured : perMinute, windowMs: 60_000 });
    limiters.set(bucket, limiter);
  }
  return limiter;
}

/**
 * Who is asking. Behind a reverse proxy the first X-Forwarded-For hop is the client;
 * run directly, route handlers see no socket address, so every caller shares one
 * bucket, which still caps total spend. Only trust X-Forwarded-For when a proxy you
 * control sets it (TRUST_PROXY=1); otherwise a client could rotate it freely.
 */
export function clientKey(req: Request): string {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return "local";
}

/** A 429 response when the caller is over the bucket's limit, otherwise null. */
export function enforceRateLimit(req: Request, bucket: Bucket): Response | null {
  const decision = limiterFor(bucket).check(`${bucket}:${clientKey(req)}`);
  if (decision.allowed) return null;
  return Response.json(
    { error: `Too many requests. Please wait ${decision.retryAfterSeconds} seconds and try again.` },
    { status: 429, headers: { "Retry-After": String(decision.retryAfterSeconds) } },
  );
}

/** The session id from a query parameter or body field, or null when it is missing or malformed. */
export function readSessionId(value: unknown): string | null {
  return isValidSessionId(value) ? value : null;
}

export function invalidSessionIdResponse(): Response {
  return Response.json({ error: "Missing or malformed conversation id." }, { status: 400 });
}

/**
 * Logs the real error on the server under a short reference id and returns a
 * generic message carrying only that id, so a user can report it without the
 * response leaking internals.
 */
export function internalError(context: string, err: unknown, status = 500): Response {
  const ref = randomUUID().slice(0, 8);
  console.error(`[${ref}] ${context}:`, err);
  return Response.json({ error: `${context}. Reference ${ref}.` }, { status });
}
