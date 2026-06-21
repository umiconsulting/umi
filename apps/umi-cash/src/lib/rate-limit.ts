// Simple in-memory sliding-window rate limiter
// TODO: Per-instance only — bypassable across Vercel function instances.
// Migrate to Upstash Redis (or Vercel KV) when traffic justifies it.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const MAX_ENTRIES = 10_000;
const store = new Map<string, RateLimitEntry>();

// Prune expired entries every 5 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  store.forEach((entry, key) => {
    if (entry.resetAt < now) store.delete(key);
  });
}, 5 * 60 * 1000);

function setEntry(key: string, entry: RateLimitEntry) {
  // Evict oldest entries if over cap (Map iteration is insertion order)
  while (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  store.set(key, entry);
}

export function rateLimit(key: string, max: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    setEntry(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
  }

  if (entry.count >= max) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

export function rateLimitResponse(resetAt: number) {
  return new Response(JSON.stringify({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(Math.ceil((resetAt - Date.now()) / 1000)),
    },
  });
}
