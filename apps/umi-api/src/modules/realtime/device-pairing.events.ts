import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { DevicePairingRealtimeEvent } from '@umi/contract';

/**
 * In-process bus between the devices domain and the socket gateway. It is a
 * `Subject`, not a replay subject: a nudge is only useful to a socket that is
 * connected now, and a device that was offline recovers through the poll route.
 *
 * Single-process only. Before a second API replica runs, the gateway must fan
 * out through `@socket.io/redis-adapter` — see the scaling gate in
 * docs/product/UMIPOS_REALTIME_PAIRING_SPEC.md.
 */
@Injectable()
export class DevicePairingEvents {
  private readonly subject = new Subject<DevicePairingRealtimeEvent>();

  readonly stream$ = this.subject.asObservable();

  emitPairingChanged(event: DevicePairingRealtimeEvent): void {
    this.subject.next(event);
  }
}
