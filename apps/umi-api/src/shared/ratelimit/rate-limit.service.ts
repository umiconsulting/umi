import { Injectable } from '@nestjs/common';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const MAX_ENTRIES = 10_000;

/**
 * Fixed-window rate limiter — ported verbatim from umi-cash `rate-limit.ts`
 * (same Map store, eviction, and semantics). On umi-cash (many ephemeral Vercel
 * instances) the Map was per-instance and thus looser than nominal; on the
 * single long-lived umi-api VPS process it is actually global and slightly
 * stricter — an acceptable, infra-free port. Swap the Map for Redis if/when
 * umi-api scales horizontally, keeping the exact key scheme.
 */
@Injectable()
export class RateLimitService {
  private readonly store = new Map<string, RateLimitEntry>();

  constructor() {
    // Sweep expired entries every 5 min. unref() so it never keeps the process
    // (or a test runner) alive.
    setInterval(() => {
      const now = Date.now();
      this.store.forEach((entry, key) => {
        if (entry.resetAt < now) this.store.delete(key);
      });
    }, 5 * 60 * 1000).unref();
  }

  private setEntry(key: string, entry: RateLimitEntry): void {
    while (this.store.size >= MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
    this.store.set(key, entry);
  }

  hit(key: string, max: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt < now) {
      this.setEntry(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: max - 1, resetAt: now + windowMs };
    }
    if (entry.count >= max) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }
    entry.count++;
    return { allowed: true, remaining: max - entry.count, resetAt: entry.resetAt };
  }
}
