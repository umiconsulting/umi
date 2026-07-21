import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface ResolvedChannelAccount {
  tenantId: string;
  locationId: string | null;
  channelAccountId: string;
}

/**
 * Maps an inbound provider address — the business's WhatsApp sender number — to its
 * business. The Twilio webhook is unauthenticated (no member user → can't satisfy the
 * RLS `can_access_tenant` check), so this runs on the BYPASSRLS worker pool with
 * explicit predicates: there is no tenant context yet, resolving it is the whole point.
 *
 * build-v3: `tenant.whatsapp_number` (and the `ops.channel_accounts` + `ops.channels`
 * pair before it) dissolved into the generic `tenant.integration` connection, where the
 * number lives in `external_account_id` under `provider='twilio'` (NOT 'whatsapp' —
 * that value is not in the provider CHECK). Branch-level routing is GONE: an
 * integration is per-business, so `locationId` is always null.
 */
@Injectable()
export class ChannelRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Find the active WhatsApp channel account whose provider id (or address)
   * matches either form of the inbound number — bare E.164 (`+1415…`) or the
   * Twilio-prefixed form (`whatsapp:+1415…`). Returns null if no account matches.
   */
  async findWhatsappAccount(
    bareNumber: string,
    prefixedNumber: string,
  ): Promise<ResolvedChannelAccount | null> {
    const { rows } = await this.pg.query<ResolvedChannelAccount>(
      `SELECT i.business_id::text AS "tenantId",
              NULL::text          AS "locationId",
              i.id::text          AS "channelAccountId"
       FROM tenant.integration AS i
       WHERE i.provider = 'twilio'
         AND i.status = 'connected'
         AND i.external_account_id IN ($1, $2)
       ORDER BY i.updated_at DESC
       LIMIT 2`,
      [bareNumber, prefixedNumber],
    );
    // Fail CLOSED on ambiguity: two businesses claiming one number would route a café's
    // customer messages to another café. `unique (provider, external_account_id)` now
    // makes that impossible for a single stored form, and the backfill normalizes to
    // bare E.164 — but we still match TWO string forms here (bare and 'whatsapp:'-
    // prefixed), so a hand-written prefixed row could still collide with a bare one.
    // Keeping the guard: it is three lines, and the failure it prevents is cross-tenant.
    if (rows.length > 1) {
      throw new Error(
        `ambiguous WhatsApp channel account: ${rows.length} active rows match "${bareNumber}"`,
      );
    }
    return rows[0] ?? null;
  }
}
