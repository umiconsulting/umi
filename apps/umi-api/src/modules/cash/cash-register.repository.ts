import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { IdentityResolver } from '../identity/identity.resolver';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface RegisterTenantConfig {
  name: string;
  cardPrefix: string | null;
  selfRegistration: boolean | null;
  /** build-v2 is program-less — loyalty is "configured" iff a settings row exists. */
  loyaltyConfigured: boolean;
}

/**
 * Customer registration reads/writes (build-v2). Identity goes through the
 * canonical {@link IdentityResolver} (deterministic contact/contact_identity/
 * customer graph, replacing `core.resolve_contact`). Loyalty is PROGRAM-LESS:
 * `loyalty.accounts`/`loyalty.programs` are gone — a card keys directly on
 * `tenant.customer.id`, and per-tenant loyalty config lives in
 * `tenant.loyalty_program`. The returned `personId` is the `tenant.customer.id`
 * (also the customer session principal). Ported from umi-cash customers/route.ts.
 */
@Injectable()
export class CashRegisterRepository {
  constructor(
    private readonly pg: PgService,
    private readonly resolver: IdentityResolver,
  ) {}

  async tenantConfig(tenantId: string): Promise<RegisterTenantConfig | null> {
    const { rows } = await this.pg.workerTx((c) =>
      c.query<Row>(
        `SELECT t.name,
                ls.card_prefix       AS card_prefix,
                ls.self_registration AS self_registration,
                (ls.id IS NOT NULL)  AS loyalty_configured
         FROM tenant.business AS t
         LEFT JOIN tenant.loyalty_program AS ls ON ls.business_id = t.id
         WHERE t.id = $1::uuid LIMIT 1`,
        [tenantId],
      ),
    );
    const r = rows[0];
    if (!r) return null;
    return {
      name: r.name,
      cardPrefix: r.card_prefix,
      selfRegistration: r.self_registration,
      loyaltyConfigured: !!r.loyalty_configured,
    };
  }

  async normalizePhone(raw: string): Promise<string | null> {
    const { rows } = await this.pg.workerTx((c) =>
      c.query<{ n: string | null }>(`SELECT tenant.normalize_phone($1) AS n`, [raw]),
    );
    return rows[0]?.n ?? null;
  }

  /**
   * Existing customer + whether they already hold an active card. Looks the
   * customer up by the phone-family (e164) normalized value across the identity
   * spine, so a WhatsApp-only contact and a cash-phone contact resolve to the same
   * customer (the resolver's cross-channel unification).
   */
  async findExisting(
    tenantId: string,
    normalizedPhone: string,
  ): Promise<{ personId: string; displayName: string | null; hasCard: boolean } | null> {
    const { rows } = await this.pg.query<Row>(
      `SELECT cu.id::text  AS person_id,
              cu.name      AS display_name,
              EXISTS (
                SELECT 1 FROM tenant.loyalty_card ca
                 WHERE ca.business_id = cu.business_id
                   AND ca.customer_id = cu.id
                   AND ca.status = 'active'
              )            AS has_card
         FROM tenant.contact ct
         JOIN umi.channel_type ch ON ch.id = ct.channel_id
         JOIN tenant.customer cu ON cu.id = ct.customer_id
        WHERE ct.business_id = $1::uuid
          AND ct.normalized_value = $2
          AND ch.key IN ('phone', 'whatsapp', 'sms')
        ORDER BY ct.is_primary DESC, ct.updated_at DESC
        LIMIT 1`,
      [tenantId, normalizedPhone],
    );
    const r = rows[0];
    if (!r) return null;
    return { personId: r.person_id, displayName: r.display_name, hasCard: !!r.has_card };
  }

  /** Find-or-create the customer via the identity resolver (raw phone in). */
  async resolveContact(
    tenantId: string,
    rawPhone: string,
    displayName: string,
  ): Promise<string> {
    const resolved = await this.resolver.resolveIdentity({
      tenantId,
      channelKey: 'phone',
      rawValue: rawPhone,
      displayName,
      collectedVia: 'umi-cash',
    });
    return resolved.customerId;
  }

  async updatePerson(
    personId: string,
    name: string,
    birthDate: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.pg.query(
      `UPDATE tenant.customer
          SET name = $2, born_at = $3::date, metadata = $4::jsonb, updated_at = now()
        WHERE id = $1::uuid`,
      [personId, name, birthDate, JSON.stringify(metadata)],
    );
  }

  /**
   * Find-or-create a fresh loyalty card for the customer, in one transaction. No
   * account/program layer any more — the card keys straight on `customer_id`.
   * Idempotent: a customer already holding an active card gets it back rather than
   * a second card (re-registration with the same phone).
   */
  async createCard(input: {
    tenantId: string;
    personId: string;
    cardNumber: string;
    qrToken: string;
  }): Promise<{ cardId: string; cardNumber: string }> {
    return this.pg.workerTx(async (c) => {
      // Serialize concurrent/duplicate registrations for the same customer so the
      // find-or-create below can't race into duplicate cards.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `register:${input.tenantId}:${input.personId}`,
      ]);
      const existing = (
        await c.query<{ id: string; card_number: string }>(
          `SELECT id::text, card_number FROM tenant.loyalty_card
           WHERE business_id=$1::uuid AND customer_id=$2::uuid AND status='active'
           ORDER BY created_at LIMIT 1`,
          [input.tenantId, input.personId],
        )
      ).rows[0];
      if (existing) {
        return { cardId: existing.id, cardNumber: existing.card_number };
      }
      const card = (
        await c.query<{ id: string; card_number: string }>(
          `INSERT INTO tenant.loyalty_card
             (business_id, customer_id, card_number, qr_token, qr_issued_at, status)
           VALUES ($1::uuid, $2::uuid, $3, $4, now(), 'active')
           RETURNING id::text, card_number`,
          [input.tenantId, input.personId, input.cardNumber, input.qrToken],
        )
      ).rows[0];
      return { cardId: card.id, cardNumber: card.card_number };
    });
  }
}
