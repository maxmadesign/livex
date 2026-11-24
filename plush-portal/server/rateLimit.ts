/**
 * In-memory token bucket per client. Good enough for a kiosk or a small
 * public deployment behind one process; it protects the paid endpoints from
 * loops and casual abuse (it is not a distributed limiter).
 */
export interface RateLimiter {
  /** Takes `cost` tokens for `key`. Returns ok=false plus the wait time when the bucket is empty. */
  take(key: string, cost?: number): { ok: boolean; retryAfterSec: number; remaining: number };
  size(): number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const MAX_BUCKETS = 5000;

export function createRateLimiter(perMinute: number, now: () => number = () => Date.now()): RateLimiter {
  const capacity = Math.max(1, perMinute);
  const refillPerMs = capacity / 60_000;
  const buckets = new Map<string, Bucket>();

  const prune = (t: number) => {
    // Full buckets carry no information: forget them first.
    for (const [key, bucket] of buckets) {
      const tokens = Math.min(capacity, bucket.tokens + (t - bucket.updatedAt) * refillPerMs);
      if (tokens >= capacity) buckets.delete(key);
      if (buckets.size <= MAX_BUCKETS / 2) return;
    }
    while (buckets.size > MAX_BUCKETS / 2) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined) break;
      buckets.delete(oldest);
    }
  };

  return {
    take(key: string, cost = 1) {
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= MAX_BUCKETS) prune(t);
        bucket = { tokens: capacity, updatedAt: t };
        buckets.set(key, bucket);
      } else {
        bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, t - bucket.updatedAt) * refillPerMs);
        bucket.updatedAt = t;
      }
      if (bucket.tokens >= cost) {
        bucket.tokens -= cost;
        return { ok: true, retryAfterSec: 0, remaining: Math.floor(bucket.tokens) };
      }
      const waitMs = (cost - bucket.tokens) / refillPerMs;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)), remaining: 0 };
    },
    size: () => buckets.size,
  };
}
