import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '../../shared/operations/metrics.service';
import { TenderRepository } from './tender.repository';

/**
 * THE NAME OF THE NUMBER, STATED ONCE. A dashboard that reads the metric and the code that writes
 * it cannot drift apart if there is one string.
 */
export const TENDER_UNRESOLVED_METRIC = 'tender.attempts_unresolved_past_query_window';

/**
 * THE HEALTH OF THE INTEGRATION, AS A NUMBER — plan §7 item 3.
 *
 * "The attempts that stay unresolved past their `queryAfter` window are a countable metric. That
 * number is the health of the integration." Everything else a deployment can measure about this
 * workstream is a count of things that WORKED: captures, resolutions, refunds. This is the only
 * one that counts the failure mode that matters — money in a state nobody has settled — and it is
 * the only one an operator cannot get from a success counter, because a broken terminal makes
 * captures stop rather than fail.
 *
 * ZERO IS THE ONLY HEALTHY READING. A single attempt past its window is normal for a minute: the
 * nudge and the poll are both in flight. A number that stays up is the vendor not answering, the
 * notification path being down, or our own resolution writing failing — three different problems
 * that all look like "one customer waiting" from the till.
 */
@Injectable()
export class PointAttemptHealthService {
  private readonly logger = new Logger(PointAttemptHealthService.name);

  constructor(
    private readonly repo: TenderRepository,
    private readonly metrics: MetricsService,
  ) {}

  /** Count, publish, and report — the whole job. Returns the number so a caller can assert it. */
  async report(): Promise<number> {
    const count = await this.repo.countUnresolvedPastQueryWindow();
    this.metrics.gauge(TENDER_UNRESOLVED_METRIC, count);
    const line = `tender_unresolved_past_query_window count=${count}`;
    // A WARNING WHEN IT IS NOT ZERO, because that is what it is: an attempt the machine said it
    // would come back for, and did not. Logging it at `log` would bury it among the successes.
    if (count === 0) this.logger.log(line);
    else this.logger.warn(line);
    return count;
  }
}
