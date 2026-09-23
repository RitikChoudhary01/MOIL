// ============================================================
// Production hardening — in-memory TTL response cache.
// Zero-dependency (local memory per skill constraints).
// Prevents repeated heavy work (DB scans / artifact reads)
// during jury demos — repeated clicks are instant.
// ============================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();
// Stampede protection: concurrent callers of cached() share one in-flight load.
const inFlight = new Map<string, Promise<unknown>>();

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key) as CacheEntry<T> | undefined;
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return e.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Get-or-load helper with in-flight dedup (cache stampede protection).
 *  On error, nothing is cached — the next caller retries. */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const p = loader()
    .then((value) => {
      cacheSet(key, value, ttlMs);
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, p);
  return p;
}

/** Invalidate all entries whose key starts with prefix. */
export function cacheInvalidate(prefix: string): number {
  let n = 0;
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      n++;
    }
  }
  return n;
}

export function cacheStats(): { keys: number } {
  return { keys: store.size };
}
