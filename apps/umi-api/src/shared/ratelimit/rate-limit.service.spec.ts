import { describe, expect, it } from 'vitest';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService', () => {
  it('allows up to max then blocks within the window', () => {
    const rl = new RateLimitService();
    const r1 = rl.hit('k', 3, 60_000);
    const r2 = rl.hit('k', 3, 60_000);
    const r3 = rl.hit('k', 3, 60_000);
    const r4 = rl.hit('k', 3, 60_000);
    expect([r1.allowed, r2.allowed, r3.allowed, r4.allowed]).toEqual([
      true, true, true, false,
    ]);
    expect(r1.remaining).toBe(2);
    expect(r4.remaining).toBe(0);
  });

  it('keys are independent', () => {
    const rl = new RateLimitService();
    rl.hit('a', 1, 60_000);
    expect(rl.hit('a', 1, 60_000).allowed).toBe(false);
    expect(rl.hit('b', 1, 60_000).allowed).toBe(true);
  });

  it('reports the reset time on the first hit of a window', () => {
    const rl = new RateLimitService();
    const before = Date.now();
    const r = rl.hit('k', 5, 60_000);
    expect(r.resetAt).toBeGreaterThanOrEqual(before + 60_000);
  });
});
