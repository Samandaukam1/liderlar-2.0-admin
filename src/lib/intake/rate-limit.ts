/**
 * Lightweight in-memory fixed-window rate limiter.
 *
 * Scope note: state is per server instance, so under horizontal scaling this is
 * a best-effort guard, not a global quota. It intentionally has no external
 * dependency; swap the store for Redis/Postgres if you need cross-instance
 * limits. Keys should be derived from a token HASH or IP hash — never the raw
 * token.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = store.get(key);

  if (!bucket || bucket.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/** Per-action budgets. Each action is limited independently (spec §11). */
export const RATE_LIMITS = {
  resolve: { limit: 40, windowMs: 60_000 },
  autosave: { limit: 150, windowMs: 60_000 },
  upload: { limit: 25, windowMs: 60_000 },
  submit: { limit: 6, windowMs: 60_000 },
  heartbeat: { limit: 90, windowMs: 60_000 },
  photo_edit: { limit: 12, windowMs: 60_000 },
  photo_status: { limit: 40, windowMs: 60_000 },
  photo_confirm: { limit: 12, windowMs: 60_000 },
  ai_text: { limit: 30, windowMs: 60_000 },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

export function enforceRateLimit(action: RateLimitAction, identifier: string): RateLimitResult {
  const { limit, windowMs } = RATE_LIMITS[action];
  // Opportunistic sweep to bound memory.
  if (store.size > 5000) {
    const now = Date.now();
    for (const [k, v] of store) if (v.resetAt <= now) store.delete(k);
  }
  return rateLimit(`${action}:${identifier}`, limit, windowMs);
}
