import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { DashboardDevicesChangedEvent } from '@umi/contract';

/**
 * In-process bus between the KDS domain and the dashboard socket gateway. It is
 * a `Subject`, not a replay subject: a nudge is only useful to a dashboard
 * socket that is connected now, and a dashboard that was offline recovers
 * through the poll route.
 *
 * Single-process only. Before a second API replica runs, the gateway must fan
 * out through `@socket.io/redis-adapter` — see the scaling gate in the realtime
 * pairing spec.
 */
@Injectable()
export class DashboardRealtimeEvents {
  private readonly subject = new Subject<DashboardDevicesChangedEvent>();

  readonly stream$ = this.subject.asObservable();

  emitDevicesChanged(event: DashboardDevicesChangedEvent): void {
    this.subject.next(event);
  }
}
