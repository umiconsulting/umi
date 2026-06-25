import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface RegisterTenantConfig {
  name: string;
  programId: string | null;
  cardPrefix: string | null;
  selfRegistration: boolean | null;
}

/**
 * Customer registration reads/writes. Person identity goes through the canonical
 * `core.resolve_contact`/`normalize_phone` RPCs (single normalizer shared with
 * the migration); account/card creation is one tenant transaction. Ported from
 * umi-cash customers/route.ts.
 */
@Injectable()
export class CashRegisterRepository {
  constructor(private readonly pg: PgService) {}

  async tenantConfig(tenantId: string): Promise<RegisterTenantConfig | null> {
    const { rows } = await this.pg.workerTx((c) =>
      c.query<Row>(
        `SELECT t.name,
                p.id::text         AS program_id,
                p.card_prefix      AS card_prefix,
                p.self_registration AS self_registration
         FROM core.tenants AS t
         LEFT JOIN loyalty.programs AS p ON p.tenant_id = t.id
         WHERE t.id = $1::uuid LIMIT 1`,
        [tenantId],
      ),
    );
    const r = rows[0];
    if (!r) return null;
    return {
      name: r.name,
      programId: r.program_id,
      cardPrefix: r.card_prefix,
      selfRegistration: r.self_registration,
    };
  }

  async normalizePhone(raw: string): Promise<string | null> {
    const { rows } = await this.pg.workerTx((c) =>
      c.query<{ n: string | null }>(`SELECT core.normalize_phone($1) AS n`, [raw]),
    );
    return rows[0]?.n ?? null;
  }

  /** Existing person + whether they already hold a card in this program. */
  async findExisting(
    tenantId: string,
    normalizedPhone: string,
    programId: string,
  ): Promise<{ personId: string; displayName: string | null; hasCard: boolean } | null> {
    return this.pg.workerTx(async (c) => {
      const person = (
        await c.query<Row>(
          `SELECT id::text, display_name FROM core.people
           WHERE tenant_id=$1::uuid AND normalized_phone=$2 LIMIT 1`,
          [tenantId, normalizedPhone],
        )
      ).rows[0];
      if (!person) return null;
      const card = (
        await c.query<Row>(
          `SELECT c.id FROM loyalty.cards c
           JOIN loyalty.accounts a ON a.id=c.account_id
           WHERE c.tenant_id=$1::uuid AND a.person_id=$2::uuid AND a.program_id=$3::uuid
           LIMIT 1`,
          [tenantId, person.id, programId],
        )
      ).rows[0];
      return { personId: person.id, displayName: person.display_name, hasCard: !!card };
    });
  }

  /** Find-or-create the person via core.resolve_contact (raw phone in). */
  async resolveContact(
    tenantId: string,
    rawPhone: string,
    displayName: string,
  ): Promise<string> {
    const { rows } = await this.pg.workerTx((c) =>
      c.query<{ person_id: string }>(
        `SELECT core.resolve_contact($1::uuid, 'phone', $2, $3, 'umi-cash', NULL) AS person_id`,
        [tenantId, rawPhone, displayName],
      ),
    );
    return rows[0].person_id;
  }

  async updatePerson(
    personId: string,
    name: string,
    birthDate: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.pg.workerTx((c) =>
      c.query(
        `UPDATE core.people
         SET display_name=$2, birth_date=$3::date, metadata=$4::jsonb, updated_at=now()
         WHERE id=$1::uuid`,
        [personId, name, birthDate, JSON.stringify(metadata)],
      ),
    );
  }

  /** Account find-or-create + a fresh card, in one transaction. */
  async createAccountCard(input: {
    tenantId: string;
    personId: string;
    programId: string;
    cardNumber: string;
    qrToken: string;
  }): Promise<{ cardId: string; cardNumber: string }> {
    return this.pg.workerTx(async (c) => {
      let accountId = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM loyalty.accounts
           WHERE tenant_id=$1::uuid AND person_id=$2::uuid AND program_id=$3::uuid LIMIT 1`,
          [input.tenantId, input.personId, input.programId],
        )
      ).rows[0]?.id;
      if (!accountId) {
        accountId = (
          await c.query<{ id: string }>(
            `INSERT INTO loyalty.accounts (tenant_id, person_id, program_id, status)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'active') RETURNING id::text`,
            [input.tenantId, input.personId, input.programId],
          )
        ).rows[0].id;
      }
      const card = (
        await c.query<{ id: string; card_number: string }>(
          `INSERT INTO loyalty.cards
             (tenant_id, account_id, card_number, qr_token, qr_issued_at, status, visits_this_cycle, total_visits)
           VALUES ($1::uuid, $2::uuid, $3, $4, now(), 'active', 0, 0)
           RETURNING id::text, card_number`,
          [input.tenantId, accountId, input.cardNumber, input.qrToken],
        )
      ).rows[0];
      return { cardId: card.id, cardNumber: card.card_number };
    });
  }
}
