import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { DashboardRealtimeEvents } from './dashboard-realtime.events';

/**
 * Turns a Postgres `NOTIFY umi_tender_attempt` into a dashboard socket nudge.
 *
 * WHY THIS EXISTS INSTEAD OF EMITTING FROM THE WRITE. The write that resolves a tender
 * attempt happens in the WORKER process — a Point notification is queued by the web
 * process and the job re-reads the order and settles the attempt — and the worker has no
 * HTTP listener and therefore no socket. The nudge is driven from the DATABASE, the same
 * way the conversation nudge is (`MessageNotifyListener`), so the process that owns the
 * write and the process that owns the socket do not have to be the same one. The trigger
 * is in `72_mp_point.sql` and carries IDS ONLY: the amount, the provider's status and the
 * proof are re-read from the attempt over REST, which is the "a socket is a wake-up, not
 * a delivery gate" rule the POS already lives under for pairing.
 *
 * A dedicated connection (not a pool client) holds the LISTEN. It self-heals: a dropped
 * connection reconnects, and the till's own poll at `queryAfterSeconds` covers any nudge
 * missed while it was down — which is also the till's delivery path until Phase 3 gives
 * the native client a device socket to subscribe on.
 */
const CHANNEL = 'umi_tender_attempt';
const RECONNECT_MS = 2_000;

interface TenderAttemptNotification {
  merchant_id?: string;
  attempt_id?: string;
  command_identity?: string | null;
  cart_id?: string;
  location_id?: string;
  status?: string;
}

@Injectable()
export class TenderAttemptListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenderAttemptListener.name);
  private client: Client | null = null;
  private stopped = false;

  constructor(private readonly events: DashboardRealtimeEvents) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.client?.end().catch(() => undefined);
    this.client = null;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const connectionString = process.env.DATABASE_URL_APP;
    if (!connectionString) {
      this.logger.error(`${CHANNEL} listener disabled: DATABASE_URL_APP is unset`);
      return;
    }
    const client = new Client({ connectionString });
    this.client = client;
    client.on('notification', (msg) => this.handle(msg.channel, msg.payload));
    client.on('error', (err) => {
      this.logger.error(`${CHANNEL} listen client error — reconnecting`, err);
      this.reconnect();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.logger.log(`listening on ${CHANNEL}`);
    } catch (err) {
      this.logger.error(`${CHANNEL} listen connect failed — retrying`, err as Error);
      this.reconnect();
    }
  }

  private reconnect(): void {
    if (this.stopped) return;
    const dead = this.client;
    this.client = null;
    void dead?.end().catch(() => undefined);
    setTimeout(() => void this.connect(), RECONNECT_MS);
  }

  private handle(channel: string, payload: string | undefined): void {
    if (channel !== CHANNEL || !payload) return;
    try {
      const parsed = JSON.parse(payload) as TenderAttemptNotification;
      // Every field the nudge needs is an id. A payload missing one is a trigger/database
      // mismatch rather than a tender fact, so it is logged and dropped instead of being
      // guessed at.
      if (!parsed.merchant_id || !parsed.attempt_id || !parsed.cart_id) {
        this.logger.warn(`ignoring ${CHANNEL} payload without ids`);
        return;
      }
      this.events.emitTenderAttemptChanged({
        merchantId: parsed.merchant_id,
        attemptId: parsed.attempt_id,
        commandIdentity: parsed.command_identity ?? null,
        cartId: parsed.cart_id,
      });
    } catch (err) {
      this.logger.error(`bad ${CHANNEL} payload`, err as Error);
    }
  }
}
