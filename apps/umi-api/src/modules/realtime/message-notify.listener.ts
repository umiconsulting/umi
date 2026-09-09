import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { DashboardRealtimeEvents } from './dashboard-realtime.events';

/**
 * Turns a Postgres `NOTIFY umi_conversation_message` into a dashboard socket nudge.
 *
 * The nudge is driven from the database, not from the write path, on purpose: a
 * trigger on `merchant.message` catches EVERY message insert — inbound webhook,
 * bot reply, staff reply — so no code path can forget to fire it. The payload is
 * only ids (merchant + conversation); the body is re-read over RLS REST, keeping
 * the "socket is a wake-up, not a delivery gate" contract.
 *
 * A dedicated connection (not a pool client) holds the LISTEN. It self-heals: a
 * dropped connection reconnects, and the browser's REST catch-up on reconnect
 * covers any nudge missed while it was down.
 */
const CHANNEL = 'umi_conversation_message';
const RECONNECT_MS = 2_000;

@Injectable()
export class MessageNotifyListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageNotifyListener.name);
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
      const parsed = JSON.parse(payload) as { merchant_id?: string; conversation_id?: string };
      if (parsed.merchant_id && parsed.conversation_id) {
        this.events.emitConversationMessage({
          merchantId: parsed.merchant_id,
          conversationId: parsed.conversation_id,
        });
      }
    } catch (err) {
      this.logger.error(`bad ${CHANNEL} payload`, err as Error);
    }
  }
}
