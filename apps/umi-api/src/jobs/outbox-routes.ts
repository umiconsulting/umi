import { Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxRouter } from './outbox-relay.service';
import { QUEUES } from './queues';
import { JobPriority } from './job-options';

/**
 * Registers the `event_type → queue` routes the transactional-outbox relay
 * drains into (Phase 3d). Worker-only. Until these exist the relay defers every
 * row (no-route). With them registered + `OUTBOX_RELAY_ENABLED=true`, the relay
 * pushes each `runtime.outbox_event` row into the outbound queue for delivery.
 *
 * All current cross-product side effects are WhatsApp sends → the `outbound`
 * queue / OutboundProcessor.
 */
@Injectable()
export class OutboxRoutesRegistrar implements OnModuleInit {
  constructor(private readonly router: OutboxRouter) {}

  onModuleInit(): void {
    this.router.register('twilio.reply', {
      queue: QUEUES.outbound,
      jobName: 'twilio.reply',
      priority: JobPriority.Interactive,
    });
    this.router.register('twilio.status_notification', {
      queue: QUEUES.outbound,
      jobName: 'twilio.status_notification',
    });
    this.router.register('twilio.cancel_notification', {
      queue: QUEUES.outbound,
      jobName: 'twilio.cancel_notification',
    });
    this.router.register('twilio.location_pin', {
      queue: QUEUES.outbound,
      jobName: 'twilio.location_pin',
    });
    this.router.register('whatsapp.lifecycle', {
      queue: QUEUES.outbound,
      jobName: 'whatsapp.lifecycle',
      priority: JobPriority.Background,
    });
  }
}
