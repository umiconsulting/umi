import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import type { AppConfig } from '../shared/config/config.schema';
import { PgService } from '../shared/database/pg.service';
import { expireCycleReward } from '../shared/loyalty/reward-entitlements';
import { TwilioAdapter } from '../shared/adapters/twilio.adapter';
import { StampRewardExpiryWallet } from './stamp-reward-expiry.wallet';

export const STAMP_REWARD_EXPIRY_JOB = 'stamp_reward_expiry';
export const STAMP_REWARD_REMINDER_TOPIC = 'stamp.reward_expiry.reminder';
export type ReminderGroup = { merchantId: string; cardId: string; expiresAt: string };
type Unit = {
  id: string;
  reward_name: string;
  reminder_enqueued_at: Date | null;
  restoration_identity: string | null;
};
type Recipient = { name: string; phone: string; merchant: string; timezone: string };

export function stampRewardReminderKey(merchant: string, card: string, expiry: string): string {
  return `stamp-reward-expiry:${merchant}:${card}:${expiry}`;
}
export function stampRewardReminderBody(
  input: Recipient & { expiresAt: string; units: { reward_name: string }[] },
): string {
  const names = new Map<string, number>();
  for (const unit of input.units)
    names.set(unit.reward_name, (names.get(unit.reward_name) ?? 0) + 1);
  const rewards = Array.from(names, ([name, quantity]) => `${quantity} × ${name}`).join(', ');
  const date = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: input.timezone,
  }).format(new Date(input.expiresAt));
  return `${input.name}, tus recompensas en ${input.merchant} vencen pronto: ${rewards}. Vence: ${date} (${input.timezone}). Canjéalas en tienda antes del vencimiento.`;
}

/** The existing system and outbound consumers delegate these policy jobs here. */
@Injectable()
export class StampRewardExpiryProcessor {
  constructor(
    private readonly pg: PgService,
    private readonly wallet: StampRewardExpiryWallet,
    private readonly twilio: TwilioAdapter,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async sweep(batchSize = 100): Promise<{
    expiredUnits: number;
    refreshedCards: number;
    queuedReminders: number;
    refreshFailures: number;
  }> {
    const limit = Number.isInteger(batchSize) ? Math.min(500, Math.max(1, batchSize)) : 100;
    const result = { expiredUnits: 0, refreshedCards: 0, queuedReminders: 0, refreshFailures: 0 };
    const cards = await this.pg.worker.query<{ merchant_id: string; card_id: string }>(
      `SELECT e.merchant_id::text, e.card_id::text,
              bool_or(e.redeemed_at IS NULL AND e.expired_at IS NULL AND e.expires_at <= clock_timestamp()) AS due,
              min(e.pass_refresh_requested_at) AS refresh_requested
       FROM merchant.loyalty_reward_entitlement e
       JOIN merchant.loyalty_reward_policy p ON p.merchant_id=e.merchant_id AND p.mode='single_cycle'
       JOIN merchant.merchant m ON m.id=e.merchant_id AND m.status='active'
       WHERE (e.redeemed_at IS NULL AND e.expired_at IS NULL AND e.expires_at <= clock_timestamp())
          OR (e.pass_refresh_requested_at IS NOT NULL AND
             (e.pass_refreshed_at IS NULL OR e.pass_refreshed_at < e.pass_refresh_requested_at))
       GROUP BY e.merchant_id,e.card_id
       ORDER BY due DESC, refresh_requested NULLS FIRST, e.merchant_id::text, e.card_id::text LIMIT $1`,
      [limit],
    );
    for (const card of cards.rows) {
      const pending = await this.pg.workerTx(async (c) => {
        if (!(await this.lockCard(c, card.merchant_id, card.card_id))) return [];
        const expiry = await expireCycleReward(c, card.merchant_id, card.card_id);
        result.expiredUnits += expiry.units;
        if (expiry.changed)
          await c.query(
            `UPDATE merchant.loyalty_card SET updated_at=clock_timestamp() WHERE merchant_id=$1::uuid AND id=$2::uuid`,
            [card.merchant_id, card.card_id],
          );
        const rows = await c.query<{ id: string; requested: string }>(
          `SELECT id::text, pass_refresh_requested_at::text AS requested
           FROM merchant.loyalty_reward_entitlement WHERE merchant_id=$1::uuid AND card_id=$2::uuid
             AND pass_refresh_requested_at IS NOT NULL
             AND (pass_refreshed_at IS NULL OR pass_refreshed_at < pass_refresh_requested_at)`,
          [card.merchant_id, card.card_id],
        );
        return rows.rows;
      });
      if (!pending.length) continue;
      const refreshed = await this.wallet.refresh(card.card_id);
      await this.pg.workerTx(async (c) => {
        if (!(await this.lockCard(c, card.merchant_id, card.card_id))) return;
        for (const marker of pending) {
          // Move a failed request behind older pending requests. Keep its marker open.
          await c.query(
            `UPDATE merchant.loyalty_reward_entitlement
             SET pass_refreshed_at=CASE WHEN $4::boolean THEN clock_timestamp() ELSE pass_refreshed_at END,
                 pass_refresh_requested_at=CASE WHEN $4::boolean THEN pass_refresh_requested_at ELSE clock_timestamp() END
             WHERE merchant_id=$1::uuid AND id=$2::uuid AND pass_refresh_requested_at=$3::timestamptz`,
            [card.merchant_id, marker.id, marker.requested, refreshed],
          );
        }
      });
      if (refreshed) result.refreshedCards++;
      else result.refreshFailures++;
    }
    if (!this.config.get('LIFECYCLE_CRONS_ENABLED', { infer: true })) return result;
    const groups = await this.pg.worker.query<{
      merchant_id: string;
      card_id: string;
      expires_at: string;
    }>(
      `SELECT DISTINCT e.merchant_id::text, e.card_id::text,
              to_char(e.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at
       FROM merchant.loyalty_reward_entitlement e
       JOIN merchant.loyalty_reward_policy p ON p.merchant_id=e.merchant_id AND p.mode='single_cycle'
       JOIN merchant.merchant m ON m.id=e.merchant_id AND m.status='active'
       JOIN merchant.loyalty_card lc ON lc.merchant_id=e.merchant_id AND lc.id=e.card_id
       WHERE e.redeemed_at IS NULL AND e.expired_at IS NULL AND e.reminder_enqueued_at IS NULL
         AND e.reminder_sent_at IS NULL AND e.expires_at > clock_timestamp()
         AND e.expires_at <= clock_timestamp()+interval '7 days'
         AND EXISTS (SELECT 1 FROM merchant.contact ct JOIN umi.channel_type ch ON ch.id=ct.channel_id
           WHERE ct.merchant_id=e.merchant_id AND ct.customer_id=lc.customer_id
             AND ch.key IN ('whatsapp','phone') AND ct.normalized_value IS NOT NULL)
       ORDER BY e.merchant_id::text, e.card_id::text, expires_at LIMIT $1`,
      [limit],
    );
    for (const group of groups.rows)
      if (
        await this.enqueueReminder({
          merchantId: group.merchant_id,
          cardId: group.card_id,
          expiresAt: group.expires_at,
        })
      )
        result.queuedReminders++;
    return result;
  }

  private async lockCard(c: PoolClient, merchantId: string, cardId: string): Promise<boolean> {
    const card = await c.query(
      `SELECT c.id FROM merchant.loyalty_card c
       JOIN merchant.loyalty_reward_policy p ON p.merchant_id=c.merchant_id AND p.mode='single_cycle'
       JOIN merchant.merchant m ON m.id=c.merchant_id AND m.status='active'
       WHERE c.merchant_id=$1::uuid AND c.id=$2::uuid FOR UPDATE OF c`,
      [merchantId, cardId],
    );
    return card.rows.length > 0;
  }
  private async units(c: PoolClient, group: ReminderGroup): Promise<Unit[]> {
    const rows = await c.query<Unit>(
      `SELECT id::text, COALESCE(CASE WHEN (CASE WHEN recovery THEN COALESCE(recovery_tier,tier) ELSE tier END)='top' THEN top_reward_name ELSE base_reward_name END,'Recompensa') AS reward_name, reminder_enqueued_at,
              (SELECT to_char(max(l.restored_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                 FROM merchant.loyalty_reward_redemption_link l
                 WHERE l.merchant_id=merchant.loyalty_reward_entitlement.merchant_id
                   AND l.entitlement_id=merchant.loyalty_reward_entitlement.id) AS restoration_identity
       FROM merchant.loyalty_reward_entitlement
       WHERE merchant_id=$1::uuid AND card_id=$2::uuid AND expires_at=$3::timestamptz
         AND redeemed_at IS NULL AND expired_at IS NULL AND reminder_sent_at IS NULL
         AND expires_at > clock_timestamp() AND expires_at <= clock_timestamp()+interval '7 days'
       ORDER BY id`,
      [group.merchantId, group.cardId, group.expiresAt],
    );
    return rows.rows;
  }
  private async recipient(c: PoolClient, group: ReminderGroup): Promise<Recipient | null> {
    const rows = await c.query<Recipient>(
      `SELECT COALESCE(cu.name,'Cliente') AS name, m.name AS merchant,
              COALESCE(m.timezone,'America/Mexico_City') AS timezone,
              COALESCE(ct.raw_phone_number,ct.normalized_value) AS phone
       FROM merchant.loyalty_card lc
       JOIN merchant.customer cu ON cu.merchant_id=lc.merchant_id AND cu.id=lc.customer_id
       JOIN merchant.merchant m ON m.id=lc.merchant_id
       JOIN merchant.contact ct ON ct.merchant_id=lc.merchant_id AND ct.customer_id=cu.id
       JOIN umi.channel_type ch ON ch.id=ct.channel_id
       WHERE lc.merchant_id=$1::uuid AND lc.id=$2::uuid
         AND ch.key IN ('whatsapp','phone') AND ct.normalized_value IS NOT NULL
       ORDER BY (ch.key='whatsapp') DESC, ct.is_primary DESC, ct.updated_at DESC LIMIT 1`,
      [group.merchantId, group.cardId],
    );
    return rows.rows[0] ?? null;
  }
  private async enqueueReminder(group: ReminderGroup): Promise<boolean> {
    return this.pg.workerTx(async (c) => {
      if (!(await this.lockCard(c, group.merchantId, group.cardId))) return false;
      const units = await this.units(c, group);
      if (!units.some((unit) => !unit.reminder_enqueued_at) || !(await this.recipient(c, group)))
        return false;
      const inserted = await c.query(
        `INSERT INTO runtime.outbox_event (merchant_id,topic,aggregate_id,idempotency_key,payload)
         VALUES($1::uuid,$2,$3::uuid,$4,$5::jsonb)
         ON CONFLICT (merchant_id,idempotency_key) DO NOTHING RETURNING id`,
        [
          group.merchantId,
          STAMP_REWARD_REMINDER_TOPIC,
          group.cardId,
          // A new unsent membership must not conflict with an already completed group.
          `${stampRewardReminderKey(group.merchantId, group.cardId, group.expiresAt)}:units:${createHash(
            'sha256',
          )
            .update(
              units
                .map((unit) => `${unit.id}:${unit.restoration_identity ?? ''}`)
                .sort()
                .join(','),
            )
            .digest('hex')}`,
          JSON.stringify(group),
        ],
      );
      await c.query(
        `UPDATE merchant.loyalty_reward_entitlement SET reminder_enqueued_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=ANY($2::uuid[]) AND reminder_enqueued_at IS NULL`,
        [group.merchantId, units.map((unit) => unit.id)],
      );
      return inserted.rows.length > 0;
    });
  }

  /** A session lock serializes delivery without a transaction across provider I/O. */
  async deliverReminder(group: ReminderGroup): Promise<boolean> {
    if (!this.config.get('LIFECYCLE_CRONS_ENABLED', { infer: true })) return false;
    if (!group?.merchantId || !group?.cardId || !group?.expiresAt)
      throw new Error('Invalid stamp reward reminder');
    const c = await this.pg.worker.connect();
    const key = stampRewardReminderKey(group.merchantId, group.cardId, group.expiresAt);
    let locked = false;
    try {
      const lock = await c.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked`,
        [key],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) throw new Error('Stamp reward reminder already in progress');
      await c.query('BEGIN');
      let units: Unit[] = [];
      let recipient: Recipient | null = null;
      if (await this.lockCard(c, group.merchantId, group.cardId)) {
        units = (await this.units(c, group)).filter((unit) => unit.reminder_enqueued_at !== null);
        recipient = await this.recipient(c, group);
      }
      await c.query('COMMIT');
      if (!units.length || !recipient) return false;
      const sent = await this.twilio.sendWhatsAppMessage({
        to: recipient.phone,
        body: stampRewardReminderBody({ ...recipient, expiresAt: group.expiresAt, units }),
      });
      if (!sent) throw new Error('Stamp reward reminder delivery failed');
      await c.query('BEGIN');
      await this.lockCard(c, group.merchantId, group.cardId);
      await c.query(
        `UPDATE merchant.loyalty_reward_entitlement SET reminder_sent_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND id=ANY($2::uuid[]) AND reminder_sent_at IS NULL`,
        [group.merchantId, units.map((unit) => unit.id)],
      );
      await c.query('COMMIT');
      return true;
    } catch (error) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      let discard = false;
      if (locked)
        await c.query(`SELECT pg_advisory_unlock(hashtextextended($1,0))`, [key]).catch(() => {
          discard = true;
        });
      c.release(discard);
    }
  }
}
