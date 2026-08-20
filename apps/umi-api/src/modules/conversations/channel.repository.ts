import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface ResolvedChannelAccount {
  tenantId: string;
  locationId: string | null;
  channelAccountId: string;
}

/**
 * Reads `tenant.whatsapp_number` (build-v2 — folds the old `ops.channel_accounts`
 * + `ops.channels` pair into one relation) to map an inbound provider address (the
 * business's WhatsApp number) to its tenant. The Twilio webhook is unauthenticated
 * (no member user → can't satisfy the RLS `can_access_tenant` check), so this runs
 * on the BYPASSRLS worker pool with explicit predicates — there is no tenant
 * context yet; resolving it is the whole point.
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
      `SELECT wn.tenant_id::text        AS "tenantId",
              wn.branch_id::text       AS "locationId",
              wn.id::text              AS "channelAccountId"
       FROM tenant.whatsapp_number AS wn
       WHERE wn.channel_key = 'whatsapp'
         AND wn.status = 'active'
         AND ( $1 IN (wn.provider_account_id, wn.phone_number)
            OR $2 IN (wn.provider_account_id, wn.phone_number) )
       ORDER BY wn.updated_at DESC
       LIMIT 2`,
      [bareNumber, prefixedNumber],
    );
    // Fail CLOSED on ambiguity: two active accounts claiming the same number is a
    // misconfiguration, and silently picking the newest could route a tenant's
    // messages to another tenant. Throw so the webhook drops the message rather
    // than guessing (a DB partial-unique on the active provider id is the durable
    // guard — tracked as a follow-up migration).
    if (rows.length > 1) {
      throw new Error(`ambiguous WhatsApp channel account: ${rows.length} active rows match "${bareNumber}"`);
    }
    return rows[0] ?? null;
  }
}
