import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { KitchenBoardEvents } from './kitchen-board.events';

/**
 * Turns `NOTIFY umi_kitchen_board` into a wake-up on the board's watch route.
 *
 * WHO EMITS IT, AND WHY THAT IS NOT A TRIGGER. The tender nudge is raised by a database trigger
 * because the write that resolves an attempt happens in the WORKER process, which has no HTTP
 * listener. Kitchen tickets are the opposite case: the projector, the KDS commands and every other
 * write run in the WEB process, and `supabase/README.md` makes the API the only business write
 * boundary. So the notification is raised by the writes themselves, with `pg_notify` inside their
 * own transaction — which is also what makes it correct: Postgres delivers a transaction's
 * notifications at COMMIT, so a wake-up can never arrive before the row it is about is visible, and
 * a rolled-back write never wakes anybody. A ticket written by hand in SQL would not nudge; the
 * till's own poll is the floor for exactly that case.
 *
 * The channel is `umi_kitchen_board` and the payload is IDS ONLY. A dedicated connection holds the
 * LISTEN and reconnects itself, like `TenderAttemptListener` and `MessageNotifyListener` before it.
 */
const CHANNEL = 'umi_kitchen_board';
const RECONNECT_MS = 2_000;

interface KitchenBoardNotification {
  merchant_id?: string;
  location_id?: string;
  kitchen_order_id?: string | null;
}

@Injectable()
export class KitchenBoardListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KitchenBoardListener.name);
  private client: Client | null = null;
  private stopped = false;

  constructor(private readonly events: KitchenBoardEvents) {}

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
      const parsed = JSON.parse(payload) as KitchenBoardNotification;
      // Merchant and location are what a watcher filters on; a payload missing one is a writer
      // mismatch rather than a kitchen fact, so it is logged and dropped rather than guessed at.
      if (!parsed.merchant_id || !parsed.location_id) {
        this.logger.warn(`ignoring ${CHANNEL} payload without ids`);
        return;
      }
      this.events.emitBoardChanged({
        merchantId: parsed.merchant_id,
        locationId: parsed.location_id,
        kitchenOrderId: parsed.kitchen_order_id ?? null,
        changedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error(`bad ${CHANNEL} payload`, err as Error);
    }
  }
}
