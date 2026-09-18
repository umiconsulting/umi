import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { MetricsService } from '../../shared/operations/metrics.service';
import {
  PointAttemptHealthService,
  TENDER_UNRESOLVED_METRIC,
} from './point-attempt-health.service';

/**
 * §7 ITEM 3, WHICH IS ONE SENTENCE OF THE PLAN: "the attempts that stay unresolved past their
 * `queryAfter` window are a countable metric. That number is the health of the integration." What
 * this file pins is that the number reaches BOTH places it is useful — the metric snapshot an
 * operator scrapes and the log line an operator reads — and that zero is reported as normal while
 * anything else is not.
 */
describe('PointAttemptHealthService', () => {
  const withCount = (count: number) => {
    const repo = { countUnresolvedPastQueryWindow: vi.fn().mockResolvedValue(count) };
    const metrics = new MetricsService();
    return {
      repo,
      metrics,
      service: new PointAttemptHealthService(repo as never, metrics),
    };
  };

  it('publishes the count as a GAUGE, so it is a level rather than an integral', async () => {
    const { service, metrics } = withCount(7);

    const reported = await service.report();

    expect(reported).toBe(7);
    // Set, never incremented: two reports of seven are seven waiting attempts, not fourteen.
    expect(metrics.snapshot()).toMatchObject({ gauges: { [TENDER_UNRESOLVED_METRIC]: 7 } });
    await service.report();
    expect(metrics.snapshot()).toMatchObject({ gauges: { [TENDER_UNRESOLVED_METRIC]: 7 } });
  });

  it('warns when the number is not zero, and only logs when it is', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const healthy = withCount(0);
      await healthy.service.report();
      expect(log).toHaveBeenCalledWith('tender_unresolved_past_query_window count=0');
      expect(warn).not.toHaveBeenCalled();

      const unhealthy = withCount(2);
      await unhealthy.service.report();
      // A WARNING, because an attempt past the moment the machine said it would come back for is
      // the failure this metric exists to surface — burying it among the successes is how it goes
      // unnoticed until a customer says so.
      expect(warn).toHaveBeenCalledWith('tender_unresolved_past_query_window count=2');
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });
});
