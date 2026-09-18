import { Injectable } from '@nestjs/common';
import { Subject, filter, firstValueFrom, map, of, timeout } from 'rxjs';

/**
 * A kitchen ticket changed, said once, to whoever is listening.
 *
 * The till's board has no socket: it holds a watch request open (`pos.kitchenBoardWatch`) and this
 * bus is what releases it. The event carries IDS AND NOTHING ELSE — no item names, no quantities,
 * no money — because the nudge is a wake-up and not a delivery gate: the board re-reads over RLS
 * REST and renders what the database says, so a wake-up that arrives before a slow write is visible
 * costs one wasted read rather than a wrong screen.
 *
 * Single-process, exactly like `DashboardRealtimeEvents`: the worker does not serve HTTP and the
 * web process is the only writer of kitchen tickets, so the process that emits and the process that
 * watches are the same one. Before a second API replica runs, this must fan out through the Redis
 * adapter the same way the dashboard bus must — that is the scaling gate recorded in §8K.
 */
export interface KitchenBoardChangedEvent {
  merchantId: string;
  locationId: string;
  kitchenOrderId: string | null;
  changedAt: string;
}

@Injectable()
export class KitchenBoardEvents {
  private readonly subject = new Subject<KitchenBoardChangedEvent>();

  readonly boardChanged$ = this.subject.asObservable();

  emitBoardChanged(event: KitchenBoardChangedEvent): void {
    this.subject.next(event);
  }

  /**
   * Resolve when THIS location's board changes, or when the hold expires.
   *
   * `true` means "re-read the board now"; `false` means the hold ran out with nothing to say, which
   * is the poll the till keeps as its floor. Expiry is an ANSWER and not an error — that is what
   * lets one route serve as both the realtime channel and the fallback, with no special case in the
   * client for "the server had nothing to tell me".
   *
   * The filter is why a busy café's till is not woken by a neighbour's kitchen: the event names its
   * merchant and location, and a watcher only hears its own.
   */
  waitForChange(merchantId: string, locationId: string, holdMs: number): Promise<boolean> {
    return firstValueFrom(
      this.subject.pipe(
        filter((event) => event.merchantId === merchantId && event.locationId === locationId),
        map(() => true),
        timeout({ first: holdMs, with: () => of(false) }),
      ),
    );
  }
}
