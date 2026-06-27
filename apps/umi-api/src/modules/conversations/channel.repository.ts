import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface ResolvedChannelAccount {
  tenantId: string;
  locationId: string | null;
  channelAccountId: string;
}

/**
 * Reads `ops.channel_accounts` to map an inbound provider address (the business's
 * WhatsApp number) to its tenant. The Twilio webhook is unauthenticated (no member
 * user → can't satisfy the RLS `can_access_tenant` check), so this runs on the
 * BYPASSRLS worker pool with explicit predicates — there is no tenant context yet;
 * resolving it is the whole point.
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
      `SELECT ca.tenant_id::text       AS "tenantId",
              ca.location_id::text     AS "locationId",
              ca.id::text              AS "channelAccountId"
       FROM ops.channel_accounts AS ca
       JOIN ops.channels AS ch ON ch.id = ca.channel_id
       WHERE ch.key = 'whatsapp'
         AND ca.status = 'active'
         AND ( $1 IN (ca.provider_account_id, ca.address)
            OR $2 IN (ca.provider_account_id, ca.address) )
       ORDER BY ca.updated_at DESC
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
