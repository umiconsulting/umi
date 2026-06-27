import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Canonical reads for the scheduled lifecycle WhatsApp journeys (3d-lifecycle),
 * rebound from the legacy umi_cash Prisma schema + RPCs (`get_streak_cards`,
 * `get_winback_cards`) to direct SQL on `loyalty.*` / `core.*`:
 *
 *   umi_cash."LoyaltyCard"  → loyalty.cards            (account_id → accounts → people)
 *   umi_cash."Visit"        → loyalty.visit_events     (loyalty_card_id, occurred_at)
 *   umi_cash."BirthdayReward" → loyalty.birthday_rewards (status 'active', lowercase)
 *   umi_cash."User".name/phone → core.people.display_name / normalized_phone
 *   umi_cash."Tenant"       → core.tenants (status 'active') + loyalty.programs config
 *   RewardConfig            → loyalty.reward_configs (is_active, latest activated_at)
 *   WhatsAppOutbox+LifecycleEvent dedup → loyalty.lifecycle_sends UNIQUE(tenant,card,journey)
 *
 * The Apple/Google wallet-push journeys (birthday issuance, expire, goal-proximity)
 * are intentionally NOT here — they have no WhatsApp output and stay in umi-cash.
 *
 * Worker pool (BYPASSRLS): cross-tenant batch with no authenticated user, like
 * every other bot read.
 */

export interface LifecycleTenant {
  id: string;
  name: string;
  slug: string | null;
  timezone: string | null;
}

export interface LifecycleTenantConfig {
  lifecycleCopy: unknown; // programs.branding.lifecycle_copy (jsonb) or null
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

// Card → person join shared by every journey (phone is required to message).
const CARD_PERSON_JOIN = `
  JOIN loyalty.accounts a ON a.id = c.account_id
  JOIN core.people pe     ON pe.id = a.person_id`;
const HAS_PHONE = `pe.normalized_phone IS NOT NULL AND pe.normalized_phone <> ''`;

@Injectable()
export class LifecycleRepository {
  constructor(private readonly pg: PgService) {}

  /** Active tenants (mirrors the legacy `subscriptionStatus = 'ACTIVE'` filter). */
  async activeTenants(): Promise<LifecycleTenant[]> {
    const { rows } = await this.pg.query<LifecycleTenant>(
      `SELECT id::text, name, slug, timezone
         FROM core.tenants WHERE status = 'active'`,
    );
    return rows;
  }

  /** Program branding + active reward config (visits goal, reward name). */
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
         FROM core.tenants t
         LEFT JOIN loyalty.programs p ON p.tenant_id = t.id
         LEFT JOIN LATERAL (
           SELECT visits_required, reward_name
             FROM loyalty.reward_configs
            WHERE tenant_id = t.id AND is_active = true
            ORDER BY activated_at DESC LIMIT 1
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
      `SELECT c.id::text AS card_id, pe.display_name AS name, pe.normalized_phone AS phone,
              c.visits_this_cycle, br.year, br.expires_at
         FROM loyalty.birthday_rewards br
         JOIN loyalty.cards c ON c.id = br.loyalty_card_id ${CARD_PERSON_JOIN}
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
      `SELECT c.id::text AS card_id, pe.display_name AS name, pe.normalized_phone AS phone,
              c.visits_this_cycle
         FROM loyalty.cards c ${CARD_PERSON_JOIN}
        WHERE c.tenant_id = $1::uuid AND c.status = 'active' AND ${HAS_PHONE}
          AND $2::int = (
            SELECT count(DISTINCT date_trunc('week', ve.occurred_at))
              FROM loyalty.visit_events ve
             WHERE ve.loyalty_card_id = c.id
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
      `SELECT c.id::text AS card_id, pe.display_name AS name, pe.normalized_phone AS phone,
              c.visits_this_cycle
         FROM loyalty.cards c ${CARD_PERSON_JOIN}
        WHERE c.tenant_id = $1::uuid AND c.status = 'active' AND ${HAS_PHONE}
          AND c.total_visits = 0
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
      `SELECT c.id::text AS card_id, pe.display_name AS name, pe.normalized_phone AS phone,
              c.visits_this_cycle
         FROM loyalty.cards c ${CARD_PERSON_JOIN}
        WHERE c.tenant_id = $1::uuid AND c.status = 'active' AND ${HAS_PHONE}
          AND EXISTS (
            SELECT 1 FROM loyalty.visit_events ve
             WHERE ve.loyalty_card_id = c.id
               AND ve.occurred_at >= now() - (($2::int + 1) || ' days')::interval
               AND ve.occurred_at <  now() - ($2::int || ' days')::interval
          )
          AND NOT EXISTS (
            SELECT 1 FROM loyalty.visit_events ve2
             WHERE ve2.loyalty_card_id = c.id
               AND ve2.occurred_at >= now() - ($2::int || ' days')::interval
          )`,
      [tenantId, days],
    );
    return rows.map(this.toCandidate);
  }

  /**
   * Atomically claim a (tenant, card, journey) send. Returns true on the first
   * claim (caller should enqueue the message), false if already sent — the
   * canonical dedup that replaces the legacy outbox idempotency + LifecycleEvent.
   */
  async claimSend(
    tenantId: string,
    cardId: string,
    journey: string,
    body: string,
  ): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `INSERT INTO loyalty.lifecycle_sends (tenant_id, card_id, journey, sent_at, body, metadata)
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
      `DELETE FROM loyalty.lifecycle_sends
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
