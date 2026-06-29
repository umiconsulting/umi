import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/**
 * Identity resolution via the canonical `core.resolve_contact` SECURITY DEFINER
 * RPC (preflight §4). This replaces the legacy `getOrCreateCustomer` +
 * `resolve_person` TS logic: the RPC creates `core.people` + `core.contact_methods`
 * idempotently and returns the `person_id`. Phone normalization happens INSIDE
 * the RPC (`core.normalize_phone`) — never re-implemented in TS for identity
 * (the old `_shared/normalize-phone.ts` diverges; preflight §4).
 *
 * Worker pool — the WhatsApp ingress is unauthenticated.
 */
@Injectable()
export class IdentityRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * @param kind contact method kind, e.g. `'whatsapp'`.
   * @param rawValue the raw contact value (the RPC normalizes it).
   */
  async resolveContact(params: {
    tenantId: string;
    kind: string;
    rawValue: string;
    displayName?: string | null;
    sourceSystem?: string | null;
    externalId?: string | null;
  }): Promise<string | null> {
    const { rows } = await this.pg.query<{ person_id: string | null }>(
      `SELECT core.resolve_contact($1, $2, $3, $4, $5, $6) AS person_id`,
      [
        params.tenantId,
        params.kind,
        params.rawValue,
        params.displayName ?? null,
        params.sourceSystem ?? null,
        params.externalId ?? null,
      ],
    );
    return rows[0]?.person_id ?? null;
  }

  /** Fetch a person's display name (for prompt context). */
  async getPersonName(
    tenantId: string,
    personId: string,
  ): Promise<string | null> {
    const { rows } = await this.pg.query<{ display_name: string | null }>(
      `SELECT display_name FROM core.people WHERE id = $1 AND tenant_id = $2`,
      [personId, tenantId],
    );
    return rows[0]?.display_name ?? null;
  }

  /**
   * Fetch a person's display name + phones. `phone` is the canonical E.164 anchor
   * (`core.people.normalized_phone`) used for identity/prompt. `replyAddress` is the
   * WhatsApp channel address AS RECEIVED (`contact_methods.display_value`, kind
   * 'whatsapp') — that, not the normalized anchor, is what Twilio must reply to.
   * Mexican mobiles arrive as `+521…` (WhatsApp's extra `1`) but normalize to
   * `+52…`; replying to the normalized form fails Twilio **63015** ("number hasn't
   * joined the sandbox"). Falls back to `normalized_phone` when there is no
   * WhatsApp contact method.
   */
  async getPerson(
    tenantId: string,
    personId: string,
  ): Promise<{
    displayName: string | null;
    phone: string | null;
    replyAddress: string | null;
  } | null> {
    const { rows } = await this.pg.query<{
      display_name: string | null;
      normalized_phone: string | null;
      reply_address: string | null;
    }>(
      `SELECT p.display_name,
              p.normalized_phone,
              (SELECT cm.display_value
                 FROM core.contact_methods cm
                WHERE cm.person_id = p.id
                  AND cm.tenant_id = p.tenant_id
                  AND cm.kind = 'whatsapp'
                ORDER BY cm.is_primary DESC NULLS LAST, cm.created_at DESC
                LIMIT 1) AS reply_address
         FROM core.people p
        WHERE p.id = $1 AND p.tenant_id = $2`,
      [personId, tenantId],
    );
    if (!rows[0]) return null;
    return {
      displayName: rows[0].display_name,
      phone: rows[0].normalized_phone,
      replyAddress: rows[0].reply_address ?? rows[0].normalized_phone,
    };
  }
}
