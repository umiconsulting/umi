import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Canonical reads for the scheduled lifecycle WhatsApp journeys (3d-lifecycle),
 * on build-v2:
 *
 *   loyalty.cards          → merchant.loyalty_card           (customer_id — no account layer)
 *   core.people            → merchant.customer       (name; phone via contact_identity)
 *   loyalty.visit_events   → merchant.loyalty_visit          (card_id, occurred_at)
 *   loyalty.birthday_rewards → merchant.loyalty_birthday_grant (card_id, status 'active')
 *   core.tenants           → merchant.merchant         (status 'active')
 *   loyalty.programs       → merchant.loyalty_program (lifecycle_copy)
 *   loyalty.reward_configs → merchant.loyalty_reward    (active, latest created_at, type='stamps_free_item')
 *   loyalty.lifecycle_sends→ runtime.reminder_sent    UNIQUE(merchant_id, card_id, reminder_type)
 *
 * DERIVED (no cache columns): visits_this_cycle = COUNT(visit) % visits_required;
 * the phone is the WhatsApp as-received reply address (contact_identity.display_value,
 * avoids Twilio 63015) else the phone E.164. The Apple/Google wallet-push journeys
 * stay in umi-cash. Worker pool (BYPASSRLS): cross-merchant batch, no auth user, and
 * runtime.reminder_sent is sealed from umi_app.
 */

export interface LifecycleMerchant {
  id: string;
  name: string;
  timezone: string | null;
}

export interface LifecycleMerchantConfig {
  lifecycleCopy: unknown; // loyalty_program.lifecycle_copy (jsonb) or null
  birthdayRewardName: string | null;
  visitsRequired: number;
  rewardName: string;
}

export interface LifecycleCandidate {
  cardId: string;
  name: string | null;
  phone: string;
  visitsThisCycle: number;
}

export interface RewardExpiringCandidate extends LifecycleCandidate {
  year: number;
  expiresAt: Date;
}

const DEFAULT_VISITS_REQUIRED = 10;
const DEFAULT_REWARD_NAME = 'Recompensa de temporada';

// Card → customer join + the reply-phone lateral, shared by every journey (a phone
// is required to message). `pe` = merchant.customer; `ph.phone` = best reply address.
const CARD_PERSON_JOIN = `
  JOIN merchant.customer pe ON pe.merchant_id = c.merchant_id AND pe.id = c.customer_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(ct.raw_phone_number, ct.normalized_value) AS phone
      FROM merchant.contact ct
      JOIN umi.channel_type ch ON ch.id = ct.channel_id
     WHERE ct.merchant_id = c.merchant_id AND ct.customer_id = pe.id
       AND ch.key IN ('whatsapp', 'phone') AND ct.normalized_value IS NOT NULL
     ORDER BY (ch.key = 'whatsapp') DESC, ct.is_primary DESC, ct.updated_at DESC
     LIMIT 1
  ) ph ON true`;
const HAS_PHONE = `ph.phone IS NOT NULL`;
// visits_this_cycle = COUNT(visit) % active visits_required (default 10).
const VISITS_THIS_CYCLE = `(
  (SELECT count(*) FROM merchant.loyalty_visit v WHERE v.merchant_id = c.merchant_id AND v.card_id = c.id)
  % COALESCE((SELECT stamps_required FROM merchant.loyalty_reward
       WHERE merchant_id = c.merchant_id AND active AND type = 'stamps_free_item'
       ORDER BY created_at DESC NULLS LAST LIMIT 1), ${DEFAULT_VISITS_REQUIRED})
)::int`;

@Injectable()
export class LifecycleRepository {
  constructor(private readonly pg: PgService) {}

  /** Active merchants (mirrors the legacy `subscriptionStatus = 'ACTIVE'` filter). */
  async activeMerchants(): Promise<LifecycleMerchant[]> {
    const { rows } = await this.pg.query<LifecycleMerchant>(
      `SELECT id::text, name, timezone
         FROM merchant.merchant WHERE status = 'active'`,
    );
    return rows;
  }

  /** Loyalty branding + active reward rule (visits goal, reward name). */
  async merchantConfig(merchantId: string): Promise<LifecycleMerchantConfig> {
    const { rows } = await this.pg.query<{
      lifecycle_copy: unknown;
      birthday_reward_name: string | null;
      visits_required: number | null;
      reward_name: string | null;
    }>(
      `SELECT
          p.lifecycle_copy             AS lifecycle_copy,
          p.birthday_reward_name       AS birthday_reward_name,
          rc.stamps_required           AS visits_required,
          rc.name                      AS reward_name
         FROM merchant.merchant t
         LEFT JOIN merchant.loyalty_program p ON p.merchant_id = t.id
         LEFT JOIN LATERAL (
           SELECT stamps_required, name
             FROM merchant.loyalty_reward
            WHERE merchant_id = t.id AND active = true AND type = 'stamps_free_item'
            ORDER BY created_at DESC NULLS LAST LIMIT 1
         ) rc ON true
        WHERE t.id = $1::uuid
        LIMIT 1`,
      [merchantId],
    );
    const r = rows[0];
    return {
      lifecycleCopy: r?.lifecycle_copy ?? null,
      birthdayRewardName: r?.birthday_reward_name ?? null,
      visitsRequired: r?.visits_required ?? DEFAULT_VISITS_REQUIRED,
      rewardName: r?.reward_name ?? DEFAULT_REWARD_NAME,
    };
  }

  /** Birthday rewards expiring within 3 days, not yet redeemed. */
  async rewardExpiringCandidates(merchantId: string): Promise<RewardExpiringCandidate[]> {
    const { rows } = await this.pg.query<{
      card_id: string;
      name: string | null;
      phone: string;
      visits_this_cycle: number;
      year: number;
      expires_at: Date;
    }>(
      `SELECT c.id::text AS card_id, pe.name AS name, ph.phone AS phone,
              ${VISITS_THIS_CYCLE} AS visits_this_cycle, br.year, br.expires_at
         FROM merchant.loyalty_birthday_grant br
         JOIN merchant.loyalty_card c ON c.merchant_id = br.merchant_id AND c.id = br.card_id ${CARD_PERSON_JOIN}
        WHERE br.merchant_id = $1::uuid
          AND br.status = 'active'
          AND br.redeemed_at IS NULL
          AND br.expires_at >= now()
          AND br.expires_at <= now() + interval '3 days'
          AND ${HAS_PHONE}`,
      [merchantId],
    );
    return rows.map((r) => ({
      cardId: r.card_id,
      name: r.name,
      phone: r.phone,
      visitsThisCycle: r.visits_this_cycle,
      year: r.year,
      expiresAt: r.expires_at,
    }));
  }

  /**
   * Cards with a visit in each of the last N ISO weeks (faithful port of
   * `get_streak_cards`: `weeks = COUNT(DISTINCT date_trunc('week', occurred_at))`
   * over visits since `date_trunc('week', now()) - (weeks-1) weeks`).
   */
  async streakCandidates(merchantId: string, weeks: number): Promise<LifecycleCandidate[]> {
    const { rows } = await this.pg.query<{
      card_id: string;
      name: string | null;
      phone: string;
      visits_this_cycle: number;
    }>(
      `SELECT c.id::text AS card_id, pe.name AS name, ph.phone AS phone,
              ${VISITS_THIS_CYCLE} AS visits_this_cycle
         FROM merchant.loyalty_card c ${CARD_PERSON_JOIN}
        WHERE c.merchant_id = $1::uuid AND c.status = 'active' AND ${HAS_PHONE}
          AND $2::int = (
            SELECT count(DISTINCT date_trunc('week', ve.occurred_at))
              FROM merchant.loyalty_visit ve
             WHERE ve.merchant_id = c.merchant_id AND ve.card_id = c.id
               AND ve.occurred_at >= date_trunc('week', now()) - (($2::int - 1) || ' weeks')::interval
          )`,
      [merchantId, weeks],
    );
    return rows.map(this.toCandidate);
  }

  /** Cards created 7–8 days ago with zero visits (welcome nudge). */
  async welcomeNoVisitCandidates(merchantId: string): Promise<LifecycleCandidate[]> {
    const { rows } = await this.pg.query<{
      card_id: string;
      name: string | null;
      phone: string;
      visits_this_cycle: number;
    }>(
      `SELECT c.id::text AS card_id, pe.name AS name, ph.phone AS phone,
              ${VISITS_THIS_CYCLE} AS visits_this_cycle
         FROM merchant.loyalty_card c ${CARD_PERSON_JOIN}
        WHERE c.merchant_id = $1::uuid AND c.status = 'active' AND ${HAS_PHONE}
          AND NOT EXISTS (
            SELECT 1 FROM merchant.loyalty_visit v WHERE v.merchant_id = c.merchant_id AND v.card_id = c.id
          )
          AND c.created_at >= now() - interval '8 days'
          AND c.created_at <  now() - interval '7 days'`,
      [merchantId],
    );
    return rows.map(this.toCandidate);
  }

  /**
   * Cards whose most recent visit fell exactly in the tier window and have not
   * visited since (faithful port of `get_winback_cards`).
   */
  async winbackCandidates(merchantId: string, days: number): Promise<LifecycleCandidate[]> {
    const { rows } = await this.pg.query<{
      card_id: string;
      name: string | null;
      phone: string;
      visits_this_cycle: number;
    }>(
      `SELECT c.id::text AS card_id, pe.name AS name, ph.phone AS phone,
              ${VISITS_THIS_CYCLE} AS visits_this_cycle
         FROM merchant.loyalty_card c ${CARD_PERSON_JOIN}
        WHERE c.merchant_id = $1::uuid AND c.status = 'active' AND ${HAS_PHONE}
          AND EXISTS (
            SELECT 1 FROM merchant.loyalty_visit ve
             WHERE ve.merchant_id = c.merchant_id AND ve.card_id = c.id
               AND ve.occurred_at >= now() - (($2::int + 1) || ' days')::interval
               AND ve.occurred_at <  now() - ($2::int || ' days')::interval
          )
          AND NOT EXISTS (
            SELECT 1 FROM merchant.loyalty_visit ve2
             WHERE ve2.merchant_id = c.merchant_id AND ve2.card_id = c.id
               AND ve2.occurred_at >= now() - ($2::int || ' days')::interval
          )`,
      [merchantId, days],
    );
    return rows.map(this.toCandidate);
  }

  /**
   * Atomically claim a (merchant, card, journey) send. Returns true on the first
   * claim (caller should enqueue the message), false if already sent — the
   * canonical dedup (runtime.reminder_sent) that replaces the legacy outbox
   * idempotency + LifecycleEvent.
   */
  async claimSend(
    merchantId: string,
    cardId: string,
    journey: string,
    _body: string,
  ): Promise<boolean> {
    // reminder_sent is the dedup KEY only (no body/metadata columns in build-v3); the
    // journey value is the `reminder_type`. The message itself lives in merchant.message.
    const { rowCount } = await this.pg.query(
      `INSERT INTO runtime.reminder_sent (merchant_id, card_id, reminder_type, sent_at)
       VALUES ($1::uuid, $2::uuid, $3, now())
       ON CONFLICT (merchant_id, card_id, reminder_type) DO NOTHING`,
      [merchantId, cardId, journey],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Compensating delete for a claim whose downstream enqueue failed (so the
   *  next cron run can retry the send rather than skipping it forever). */
  async deleteSend(merchantId: string, cardId: string, journey: string): Promise<void> {
    await this.pg.query(
      `DELETE FROM runtime.reminder_sent
        WHERE merchant_id = $1::uuid AND card_id = $2::uuid AND reminder_type = $3`,
      [merchantId, cardId, journey],
    );
  }

  private toCandidate = (r: {
    card_id: string;
    name: string | null;
    phone: string;
    visits_this_cycle: number;
  }): LifecycleCandidate => ({
    cardId: r.card_id,
    name: r.name,
    phone: r.phone,
    visitsThisCycle: r.visits_this_cycle,
  });
}
