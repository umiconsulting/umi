import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type {
  DashboardConversationMessageEvent,
  DashboardDevicesChangedEvent,
  TenderAttemptChangedEvent,
} from '@umi/contract';

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

  // A second, independent stream for WhatsApp message nudges. Kept separate from
  // the devices stream so the gateway can emit each under its own event name.
  private readonly conversationSubject = new Subject<DashboardConversationMessageEvent>();

  readonly conversationMessage$ = this.conversationSubject.asObservable();

  emitConversationMessage(event: DashboardConversationMessageEvent): void {
    this.conversationSubject.next(event);
  }

  /**
   * A tender attempt resolved at a card terminal. Raised by the database, not by the
   * resolving write: the attempt is settled in the WORKER process (a webhook arrives,
   * a job re-reads the order and writes the outcome), and that process has no socket.
   * `merchant.pos_payment_attempt` raises `umi_tender_attempt` and
   * `TenderAttemptListener` turns it into this event, which is why the nudge reaches
   * the till no matter which process did the writing.
   */
  private readonly tenderSubject = new Subject<TenderAttemptChangedEvent>();

  readonly tenderAttemptChanged$ = this.tenderSubject.asObservable();

  emitTenderAttemptChanged(event: TenderAttemptChangedEvent): void {
    this.tenderSubject.next(event);
  }
}
