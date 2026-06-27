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
   * Fetch a person's display name + canonical phone (for the prompt + the reply
   * `to`). `normalized_phone` is the E.164 anchor on `core.people`.
   */
  async getPerson(
    tenantId: string,
    personId: string,
  ): Promise<{ displayName: string | null; phone: string | null } | null> {
    const { rows } = await this.pg.query<{
      display_name: string | null;
      normalized_phone: string | null;
    }>(
      `SELECT display_name, normalized_phone
         FROM core.people WHERE id = $1 AND tenant_id = $2`,
      [personId, tenantId],
    );
    if (!rows[0]) return null;
    return { displayName: rows[0].display_name, phone: rows[0].normalized_phone };
  }
}
