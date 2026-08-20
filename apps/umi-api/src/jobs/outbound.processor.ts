import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from './queues';
import { workerOptions } from './job-options';
import { BaseProcessor } from './base.processor';
import { DeadLetterService } from './dead-letter.service';
import { TwilioAdapter } from '../shared/adapters/twilio.adapter';
import { TraceService } from '../shared/logging/trace.service';
import { toWhatsAppMarkdown } from '../shared/format/whatsapp';

/**
 * Outbound queue consumer (Phase 3d) — the delivery side of the transactional
 * outbox. The relay drains `runtime.outbox_events` into this queue; each job is a
 * WhatsApp send via the Twilio adapter. `toWhatsAppMarkdown` is re-applied here
 * (it was dropped in the Phase-1 adapter port; preflight §8). A null adapter
 * result throws → BullMQ retries (outbound attempts=5) → dead-letter.
 *
 * Job names = outbox event types: twilio.reply, twilio.status_notification,
 * twilio.cancel_notification, twilio.location_pin, whatsapp.lifecycle.
 */
@Processor(QUEUES.outbound, workerOptions(QUEUES.outbound))
export class OutboundProcessor extends BaseProcessor {
  constructor(
    deadLetters: DeadLetterService,
    private readonly twilio: TwilioAdapter,
    private readonly trace: TraceService,
  ) {
    super(deadLetters);
  }

  async process(job: Job): Promise<void> {
    const p = (job.data ?? {}) as Record<string, unknown>;
    const to = String(p.to ?? '');

    switch (job.name) {
      case 'twilio.location_pin': {
        const from = String(p.from ?? '');
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        // Fail fast on a malformed job rather than coercing to ''/NaN and
        // handing Twilio a bad request (which it would reject anyway).
        if (!to || !from || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          throw new Error(`twilio.location_pin missing/invalid fields (to/from/lat/lng) #${job.id}`);
        }
        const res = await this.twilio.sendLocationPin({
          to,
          from,
          body: toWhatsAppMarkdown(String(p.body ?? '')),
          lat,
          lng,
          label: String(p.label ?? ''),
        });
        if (!res) throw new Error('twilio sendLocationPin returned null');
        return;
      }
      case 'twilio.reply':
      case 'twilio.status_notification':
      case 'twilio.cancel_notification':
      case 'whatsapp.lifecycle': {
        const body = toWhatsAppMarkdown(String(p.body ?? ''));
        if (!to || !body.trim()) {
          throw new Error(`${job.name} missing 'to' or empty body #${job.id}`);
        }
        const res = await this.twilio.sendWhatsAppMessage({ to, body });
        if (!res) throw new Error(`twilio sendWhatsAppMessage returned null (${job.name})`);
        if (job.name === 'twilio.reply' && typeof p.trace_id === 'string') {
          await this.trace.logPipelineTrace({
            trace_id: p.trace_id,
            conversation_id: typeof p.conversation_id === 'string' ? p.conversation_id : undefined,
            turn_id: typeof p.turn_id === 'string' ? p.turn_id : undefined,
            stage: 'dispatch',
            event: 'delivered',
            detail: { sid: res.sid },
          });
        }
        return;
      }
      default:
        this.logger.warn(`unknown outbound job: ${job.name} #${job.id}`);
    }
  }
}
