// ============================================================
// Production hardening — lightweight per-IP rate limiter.
// Token bucket, generous defaults so a live jury demo never
// trips it; protects the backend from accidental runaway
// loops or scripted abuse.
// ============================================================

const buckets = new Map<string, { tokens: number; last: number }>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * @param key      unique bucket key (usually client IP + route group)
 * @param capacity bucket size (burst allowance)
 * @param refillPerSec tokens added per second
 */
export function rateLimit(
  key: string,
  capacity = 60,
  refillPerSec = 10,
): RateLimitResult {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, last: now };
  const elapsedSec = (now - b.last) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsedSec * refillPerSec);
  b.last = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return {
      ok: false,
      remaining: 0,
      retryAfterSec: Math.ceil((1 - b.tokens) / refillPerSec),
    };
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return { ok: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
}

/** Best-effort client IP extraction behind the Caddy gateway. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Occasional sweep so idle buckets don't accumulate forever. */
let lastSweep = Date.now();
export function sweepBuckets(): void {
  const now = Date.now();
  if (now - lastSweep < 300_000) return; // every 5 min
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (now - b.last > 3_600_000) buckets.delete(k);
  }
}

/**
 * One-line guard for API routes.
 * Returns a 429 Response when the caller is over limit, else null.
 */
export function guard(
  req: Request,
  group: string,
  capacity = 90,
  refillPerSec = 15,
): Response | null {
  sweepBuckets();
  const rl = rateLimit(`${group}:${clientIp(req)}`, capacity, refillPerSec);
  if (!rl.ok) {
    return Response.json(
      { error: "Too many requests — slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }
  return null;
}
