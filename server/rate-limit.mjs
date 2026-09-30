// Simple in-memory sliding-window rate limiter. State is per-process:
// it assumes single-instance deployment. Horizontal scaling would
// require moving these counters to shared storage (Redis / Supabase).
const buckets = new Map(); // key -> { hits: number[], windowMs: number }
const MAX_BUCKETS = 5000;
const SWEEP_BATCH = 64;

export function clientIp(request) {
  // Render's edge (Cloudflare) writes CF-Connecting-IP on every public request
  // and overwrites whatever the caller sent, so the value cannot be spoofed.
  // X-Forwarded-For is only ever appended to by proxies — its leftmost entry
  // stays under caller control — so it is never trusted here. Direct/local
  // traffic (no CF header) falls back to the socket address.
  const platformIp = String(request.headers["cf-connecting-ip"] || "").trim();
  return platformIp || request.socket?.remoteAddress || "unknown";
}

// Returns 0 when the request is allowed, otherwise the number of seconds
// the caller should wait before retrying.
export function rateLimitRetryAfterSeconds(key, { limit, windowMs }) {
  const now = Date.now();
  const cutoff = now - windowMs;
  let entry = buckets.get(key);
  if (!entry) {
    entry = { hits: [], windowMs };
    buckets.set(key, entry);
  }
  const hits = entry.hits;
  while (hits.length && hits[0] <= cutoff) hits.shift();
  if (hits.length >= limit) {
    return Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
  }
  hits.push(now);
  if (buckets.size > MAX_BUCKETS) {
    // Lazy bounded sweep: clean a small batch of the oldest buckets per
    // request instead of scanning the whole map in one go, so a burst of
    // traffic cannot stack a full 5000-entry scan onto every request.
    // Each bucket is judged against its own policy window, not the
    // current request's (policies mix 1-minute and 24-hour windows).
    let swept = 0;
    for (const [bucketKey, bucketEntry] of buckets) {
      const bucketCutoff = now - bucketEntry.windowMs;
      while (bucketEntry.hits.length && bucketEntry.hits[0] <= bucketCutoff) bucketEntry.hits.shift();
      if (!bucketEntry.hits.length) buckets.delete(bucketKey);
      swept += 1;
      if (swept >= SWEEP_BATCH) break;
    }
    // Hard cap: when every swept bucket is still active the sweep frees
    // nothing, so evict the oldest-inserted buckets rather than let the
    // map grow without bound. An evicted key simply starts a fresh bucket.
    while (buckets.size > MAX_BUCKETS) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }
  return 0;
}

export function rateLimitError(retryAfterSeconds, { message = "操作太频繁，请稍后再试", code = "RATE_LIMITED" } = {}) {
  const error = new Error(message);
  error.status = 429;
  error.code = code;
  error.retryable = true;
  error.retryAfter = retryAfterSeconds;
  error.headers = { "Retry-After": String(retryAfterSeconds) };
  return error;
}

export function assertWithinRateLimit(key, options) {
  const retryAfter = rateLimitRetryAfterSeconds(key, options);
  if (retryAfter > 0) throw rateLimitError(retryAfter, options);
}
