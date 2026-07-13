import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Canonical reads for the scheduled lifecycle WhatsApp journeys (3d-lifecycle),
 * on build-v2:
 *
 *   loyalty.cards          → tenant.loyalty_card           (customer_id — no account layer)
 *   core.people            → tenant.customer       (name; phone via contact_identity)
 *   loyalty.visit_events   → tenant.loyalty_visit          (card_id, occurred_at)
 *   loyalty.birthday_rewards → tenant.birthday_reward (card_id, status 'active')
 *   core.tenants           → tenant.business         (status 'active')
 *   loyalty.programs       → tenant.loyalty_program (branding.lifecycle_copy)
 *   loyalty.reward_configs → tenant.loyalty_reward    (is_active, latest activated_at)
 *   loyalty.lifecycle_sends→ runtime.reminder_sent    UNIQUE(tenant_id, card_id, journey)
 *
 * DERIVED (no cache columns): visits_this_cycle = COUNT(visit) % visits_required;
 * the phone is the WhatsApp as-received reply address (contact_identity.display_value,
 * avoids Twilio 63015) else the phone E.164. The Apple/Google wallet-push journeys
 * stay in umi-cash. Worker pool (BYPASSRLS): cross-tenant batch, no auth user, and
 * runtime.reminder_sent is sealed from umi_app.
 */

export interface LifecycleTenant {
  id: string;
  name: string;
  slug: string | null;
  timezone: string | null;
}

export interface LifecycleTenantConfig {
  lifecycleCopy: unknown; // loyalty_settings.branding.lifecycle_copy (jsonb) or null
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
// is required to message). `pe` = tenant.customer; `ph.phone` = best reply address.
const CARD_PERSON_JOIN = `
  JOIN tenant.customer pe ON pe.tenant_id = c.tenant_id AND pe.id = c.customer_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(ci.display_value, ci.normalized_value) AS phone
      FROM tenant.contact_identity ci
      JOIN tenant.channel ch ON ch.id = ci.channel_id
     WHERE ci.tenant_id = c.tenant_id AND ci.contact_id = pe.contact_id
       AND ch.key IN ('whatsapp', 'phone') AND ci.normalized_value IS NOT NULL
     ORDER BY (ch.key = 'whatsapp') DESC, ci.is_primary DESC, ci.last_seen_at DESC
     LIMIT 1
  ) ph ON true`;
const HAS_PHONE = `ph.phone IS NOT NULL`;
// visits_this_cycle = COUNT(visit) % active visits_required (default 10).
const VISITS_THIS_CYCLE = `(
  (SELECT count(*) FROM tenant.loyalty_visit v WHERE v.tenant_id = c.tenant_id AND v.card_id = c.id)
  % COALESCE((SELECT visits_required FROM tenant.loyalty_reward
       WHERE tenant_id = c.tenant_id AND is_active
       ORDER BY activated_at DESC NULLS LAST LIMIT 1), ${DEFAULT_VISITS_REQUIRED})
)::int`;

@Injectable()
export class LifecycleRepository {
  constructor(private readonly pg: PgService) {}

  /** Active tenants (mirrors the legacy `subscriptionStatus = 'ACTIVE'` filter). */
  async activeTenants(): Promise<LifecycleTenant[]> {
    const { rows } = await this.pg.query<LifecycleTenant>(
      `SELECT id::text, name, slug, timezone
         FROM tenant.business WHERE status = 'active'`,
    );
    return rows;
  }

  /** Loyalty branding + active reward rule (visits goal, reward name). */
  async tenantConfig(tenantId: string): Promise<LifecycleTenantConfig> {
    const { rows } = await this.pg.query<{
      lifecycle_copy: unknown;
      birthday_reward_name: string | null;
      visits_required: number | null;
      reward_name: string | null;
    }>(
      `SELECT
          p.branding->'lifecycle_copy' AS lifecycle_copy,
          p.birthday_reward_name       AS birthday_reward_name,
          rc.visits_required           AS visits_required,
          rc.reward_name               AS reward_name
         FROM tenant.business t
         LEFT JOIN tenant.loyalty_program p ON p.tenant_id = t.id
         LEFT JOIN LATERAL (
           SELECT visits_required, reward_name
             FROM tenant.loyalty_reward
            WHERE tenant_id = t.id AND is_active = true
            ORDER BY activated_at DESC NULLS LAST LIMIT 1
         ) rc ON true
        WHERE t.id = $1::uuid
        LIMIT 1`,
      [tenantId],
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
  async rewardExpiringCandidates(tenantId: string): Promise<RewardExpiringCandidate[]> {
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
         FROM tenant.birthday_reward br
         JOIN tenant.loyalty_card c ON c.tenant_id = br.tenant_id AND c.id = br.card_id ${CARD_PERSON_JOIN}
        WHERE br.tenant_id = $1::uuid
          AND br.status = 'active'
          AND br.redeemed_at IS NULL
          AND br.expires_at >= now()
          AND br.expires_at <= now() + interval '3 days'
          AND ${HAS_PHONE}`,
      [tenantId],
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
  async streakCandidates(tenantId: string, weeks: number): Promise<LifecycleCandidate[]> {
    const { rows } = await this.pg.query<{
      card_id: string;
      name: string | null;
      phone: string;
      visits_this_cycle: number;
    }>(
      `SELECT c.id::text AS card_id, pe.name AS name, ph.phone AS phone,
              ${VISITS_THIS_CYCLE} AS visits_this_cycle
         FROM tenant.loyalty_card c ${CARD_PERSON_JOIN}
        WHERE c.tenant_id = $1::uuid AND c.status = 'active' AND ${HAS_PHONE}
          AND $2::int = (
            SELECT count(DISTINCT date_trunc('week', ve.occurred_at))
              FROM tenant.loyalty_visit ve
             WHERE ve.tenant_id = c.tenant_id AND ve.card_id = c.id
               AND ve.occurred_at >= date_trunc('week', now()) - (($2::int - 1) || ' weeks')::interval
          )`,
      [tenantId, weeks],
    );
    return rows.map(this.toCandidate);
  }

  /** Cards created 7–8 days ago with zero visits (welcome nudge). */
  async welcomeNoVisitCandidates(tenantId: string): Promise<LifecycleCandidate[]> {
    const { rows } = await this.pg.query<{
      card_id: string;
      name: string | null;
      phone: string;
      visits_this_cycle: number;
    }>(
      `SELECT c.id::text AS card_id, pe.name AS name, ph.phone AS phone,
              ${VISITS_THIS_CYCLE} AS visits_this_cycle
         FROM tenant.loyalty_card c ${CARD_PERSON_JOIN}
        WHERE c.tenant_id = $1::uuid AND c.status = 'active' AND ${HAS_PHONE}
          AND NOT EXISTS (
            SELECT 1 FROM tenant.loyalty_visit v WHERE v.tenant_id = c.tenant_id AND v.card_id = c.id
          )
          AND c.created_at >= now() - interval '8 days'
          AND c.created_at <  now() - interval '7 days'`,
      [tenantId],
    );
    return rows.map(this.toCandidate);
  }

  /**
   * Cards whose most recent visit fell exactly in the tier window and have not
   * visited since (faithful port of `get_winback_cards`).
   */
  async winbackCandidates(tenantId: string, days: number): Promise<LifecycleCandidate[]> {
    const { rows } = await this.pg.query<{
      card_id: string;
      name: string | null;
      phone: string;
      visits_this_cycle: number;
    }>(
      `SELECT c.id::text AS card_id, pe.name AS name, ph.phone AS phone,
              ${VISITS_THIS_CYCLE} AS visits_this_cycle
         FROM tenant.loyalty_card c ${CARD_PERSON_JOIN}
        WHERE c.tenant_id = $1::uuid AND c.status = 'active' AND ${HAS_PHONE}
          AND EXISTS (
            SELECT 1 FROM tenant.loyalty_visit ve
             WHERE ve.tenant_id = c.tenant_id AND ve.card_id = c.id
               AND ve.occurred_at >= now() - (($2::int + 1) || ' days')::interval
               AND ve.occurred_at <  now() - ($2::int || ' days')::interval
          )
          AND NOT EXISTS (
            SELECT 1 FROM tenant.loyalty_visit ve2
             WHERE ve2.tenant_id = c.tenant_id AND ve2.card_id = c.id
               AND ve2.occurred_at >= now() - ($2::int || ' days')::interval
          )`,
      [tenantId, days],
    );
    return rows.map(this.toCandidate);
  }

  /**
   * Atomically claim a (tenant, card, journey) send. Returns true on the first
   * claim (caller should enqueue the message), false if already sent — the
   * canonical dedup (runtime.reminder_sent) that replaces the legacy outbox
   * idempotency + LifecycleEvent.
   */
  async claimSend(
    tenantId: string,
    cardId: string,
    journey: string,
    body: string,
  ): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `INSERT INTO runtime.reminder_sent (tenant_id, card_id, journey, sent_at, body, metadata)
       VALUES ($1::uuid, $2::uuid, $3, now(), $4, '{}'::jsonb)
       ON CONFLICT (tenant_id, card_id, journey) DO NOTHING`,
      [tenantId, cardId, journey, body],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Compensating delete for a claim whose downstream enqueue failed (so the
   *  next cron run can retry the send rather than skipping it forever). */
  async deleteSend(tenantId: string, cardId: string, journey: string): Promise<void> {
    await this.pg.query(
      `DELETE FROM runtime.reminder_sent
        WHERE tenant_id = $1::uuid AND card_id = $2::uuid AND journey = $3`,
      [tenantId, cardId, journey],
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
