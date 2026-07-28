import { describe, expect, it, vi } from 'vitest';
import { MetricsService } from './metrics.service';
import { redactTelemetry } from './redaction';
import { BoundedConcurrency, CircuitBreaker, OperationalFailure, withTimeout } from './resilience';

describe('operational foundations', () => {
  it('redacts secrets recursively and bounds oversized values', () => {
    const result = redactTelemetry({
      authorization: 'Bearer private',
      nested: { cardNumber: '4111111111111111', safe: 'ok' },
      long: 'x'.repeat(2_100),
    });
    expect(result).toEqual({
      authorization: '[REDACTED]',
      nested: { cardNumber: '[REDACTED]', safe: 'ok' },
      long: `${'x'.repeat(2_000)}[TRUNCATED]`,
    });
  });

  it('records bounded counters and duration summaries', () => {
    const metrics = new MetricsService();
    metrics.increment('http.requests', { route: '/health' });
    metrics.observe('http.duration_ms', 12, { route: '/health' });
    expect(metrics.snapshot()).toEqual({
      counters: { 'http.requests{route=/health}': 1 },
      durations: {
        'http.duration_ms{route=/health}': { count: 1, totalMs: 12, maxMs: 12 },
      },
    });
  });

  it('opens a circuit after bounded failures and allows a later probe', async () => {
    const breaker = new CircuitBreaker(2, 100);
    await expect(breaker.execute(async () => Promise.reject(new Error('one')), 1)).rejects.toThrow(
      'one',
    );
    await expect(breaker.execute(async () => Promise.reject(new Error('two')), 2)).rejects.toThrow(
      'two',
    );
    await expect(breaker.execute(async () => 'blocked', 3)).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN',
    });
    await expect(breaker.execute(async () => 'recovered', 103)).resolves.toBe('recovered');
  });

  it('enforces operation deadlines even when an adapter ignores abort', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(async () => new Promise<string>(() => undefined), 100);
    const assertion = expect(pending).rejects.toBeInstanceOf(OperationalFailure);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    vi.useRealTimers();
  });

  it('rejects excess concurrent work instead of building an unbounded wait queue', async () => {
    const concurrency = new BoundedConcurrency(1);
    let release: () => void = () => undefined;
    const first = concurrency.run(
      async () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await expect(concurrency.run(async () => undefined)).rejects.toMatchObject({
      code: 'BACKPRESSURE_REJECTED',
    });
    release();
    await first;
  });
});
