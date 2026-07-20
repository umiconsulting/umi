import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export type WalletTxnType = 'topup' | 'purchase' | 'adjustment' | 'gift_card_redeem';

export interface WalletDelta {
  tenantId: string;
  cardId: string;
  /** signed centavos: positive = credit, negative = debit */
  deltaCents: number;
  type: WalletTxnType;
  idempotencyKey: string;
  reason?: string;
  staffMemberId?: string | null;
  description?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface CardRow {
  id: string;
  customer_id: string | null;
  card_number: string;
  balance_cents: number;
  total_visits: number;
  visits_this_cycle: number;
  pending_rewards: number;
  qr_token: string | null;
  person_id: string | null;
  display_name: string | null;
  normalized_email: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Customer-facing cash writes on the canonical `tenant.*` schema. Money moves
 * ONLY through `applyWalletDelta`, which appends to the insert-only
 * `tenant.loyalty_stored_value_ledger` (idempotency_key + UNIQUE(business_id, idempotency_key)
 * make retries safe) — there is NO balance cache to keep in sync. Balance is
 * always `SUM(card_ledger.delta)`; visit/reward counts derive from
 * `tenant.loyalty_visit` / `tenant.loyalty_redemption` (identity-only card).
 */
@Injectable()
export class CashWriteRepository {
  constructor(private readonly pg: PgService) {}

  /** The operational staff row for the authed login (audit attribution). */
  async getStaffMemberId(tenantId: string, userId: string): Promise<string | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<{ id: string }>(
        `SELECT id::text AS id FROM tenant.staff
         WHERE business_id = $1::uuid AND login_id = $2::uuid AND status = 'active'
         LIMIT 1`,
        [tenantId, userId],
      ),
    );
    return rows[0]?.id ?? null;
  }

  /**
   * The contact linked to the authed customer principal (self-card guard). In
   * build-v3 the umi-cash session `sub` IS the `tenant.customer.id`
   * (customer-session.service: principal_type='person'), and `tenant.customer`
   * carries `contact_id` directly — so we resolve the person here exactly as
   * `findCard` exposes the card owner's contact as `person_id`. A staff userId
   * (a `umi.user.id`) matches no customer row → null → not-self (staff path),
   * matching the old behavior where staff logins had no contact_id.
   */
  async getUserPersonId(userId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ contact_id: string | null }>(
      `SELECT contact_id::text AS contact_id FROM tenant.customer WHERE id = $1::uuid LIMIT 1`,
      [userId],
    );
    return rows[0]?.contact_id ?? null;
  }

  /**
   * Find a card by uuid id or card_number, scoped to tenant, with its owner and
   * DERIVED loyalty state (balance = SUM(card_ledger); visits = COUNT(visit);
   * cycle/pending computed against the active reward_rule threshold).
   */
  async findCard(tenantId: string, identifier: string): Promise<CardRow | null> {
    const isUuid = UUID_RE.test(identifier);
    const { rows } = await this.pg.withTenant((c) =>
      c.query<CardRow>(
        `WITH vr AS (
           SELECT COALESCE((
             SELECT visits_required FROM tenant.loyalty_reward
             WHERE business_id = $1::uuid AND is_active
             ORDER BY activated_at DESC NULLS LAST LIMIT 1), 10) AS n
         )
         SELECT c.id::text, c.customer_id::text, c.card_number, c.qr_token,
                agg.balance_cents::int                                   AS balance_cents,
                agg.total_visits::int                                    AS total_visits,
                (agg.total_visits % vr.n)::int                           AS visits_this_cycle,
                (agg.total_visits / vr.n - agg.redemptions)::int         AS pending_rewards,
                cu.contact_id::text                                      AS person_id,
                cu.name                                                  AS display_name,
                NULL::text                                               AS normalized_email
                -- normalized_email lives in tenant.contact_identity → PR4 identity resolver
         FROM tenant.loyalty_card AS c
         LEFT JOIN tenant.customer AS cu
           ON cu.business_id = c.business_id AND cu.id = c.customer_id
         CROSS JOIN vr
         CROSS JOIN LATERAL (
           SELECT
             (SELECT COUNT(*) FROM tenant.loyalty_visit v
               WHERE v.business_id = c.business_id AND v.card_id = c.id)              AS total_visits,
             (SELECT COUNT(*) FROM tenant.loyalty_redemption r
               WHERE r.business_id = c.business_id AND r.card_id = c.id)             AS redemptions,
             COALESCE((SELECT SUM(l.delta) FROM tenant.loyalty_stored_value_ledger l
               WHERE l.business_id = c.business_id AND l.card_id = c.id), 0)         AS balance_cents
         ) AS agg
         WHERE c.business_id = $1::uuid
           AND (c.card_number = $2 ${isUuid ? 'OR c.id = $2::uuid' : ''})
         LIMIT 1`,
        [tenantId, identifier],
      ),
    );
    return rows[0] ?? null;
  }

  /** Today's top-up aggregates for the anti-fraud limits (from the ledger). */
  async topupGuards(
    tenantId: string,
    cardId: string,
    staffMemberId: string | null,
    dayStart: Date,
  ): Promise<{ staffSum: number; cardSum: number; cardCount: number }> {
    return this.pg.withTenant(async (c) => {
      const staff = staffMemberId
        ? (
            await c.query<Row>(
              `SELECT COALESCE(sum(delta),0)::bigint AS s
               FROM tenant.loyalty_stored_value_ledger
               WHERE business_id=$1::uuid AND staff_id=$2::uuid AND reason='topup' AND created_at>=$3`,
              [tenantId, staffMemberId, dayStart],
            )
          ).rows[0].s
        : 0;
      const card = (
        await c.query<Row>(
          `SELECT COALESCE(sum(delta),0)::bigint AS s, count(*)::int AS n
           FROM tenant.loyalty_stored_value_ledger
           WHERE business_id=$1::uuid AND card_id=$2::uuid AND reason='topup' AND created_at>=$3`,
          [tenantId, cardId, dayStart],
        )
      ).rows[0];
      return {
        staffSum: Number(staff),
        cardSum: Number(card.s),
        cardCount: Number(card.n),
      };
    });
  }

  /**
   * Append a wallet delta on an existing transaction client; returns new balance.
   * Insert-only: writes ONE card_ledger row; balance is SUM(delta), never cached.
   */
  private async applyWalletDelta(c: PoolClient, d: WalletDelta): Promise<number> {
    const ledger = await c.query(
      `INSERT INTO tenant.loyalty_stored_value_ledger
         (business_id, card_id, staff_id, delta, reason, source_type, source_id, idempotency_key)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)
       ON CONFLICT (business_id, idempotency_key) DO NOTHING`,
      [
        d.tenantId, d.cardId, d.staffMemberId ?? null, d.deltaCents,
        d.reason ?? d.type, d.sourceType ?? d.type, d.sourceId ?? null, d.idempotencyKey,
      ],
    );
    // Whether newly inserted or an idempotent replay, the balance is the current
    // SUM — no wallet_transactions / balances / cards.balance_cents to reconcile.
    const { rows } = await c.query<Row>(
      `SELECT COALESCE(sum(delta),0)::int AS balance
       FROM tenant.loyalty_stored_value_ledger WHERE business_id=$1::uuid AND card_id=$2::uuid`,
      [d.tenantId, d.cardId],
    );
    void ledger;
    return Number(rows[0].balance);
  }

  /** Credit a wallet in its own transaction (top-up). */
  creditWallet(d: WalletDelta): Promise<number> {
    return this.pg.withTenant((c) => this.applyWalletDelta(c, d));
  }

  /** Debit for a purchase: lock the card, check balance, debit, rotate QR. */
  async purchase(
    d: WalletDelta & { amountCents: number; newQrToken: string },
  ): Promise<number> {
    return this.pg.withTenant(async (c) => {
      // Lock the card row so concurrent purchases on the same card serialize.
      const locked = await c.query<Row>(
        `SELECT id FROM tenant.loyalty_card
         WHERE business_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
        [d.tenantId, d.cardId],
      );
      if (!locked.rows[0]) throw new CardNotFoundError();

      // Idempotent replay: if this idempotencyKey already produced a ledger row the
      // debit already committed. Return the current balance WITHOUT re-checking funds
      // (a later spend could drop the balance below amountCents and throw a false
      // InsufficientBalanceError on a retry) or re-rotating qr_token (which would
      // invalidate the QR the original call already issued).
      const replay = await c.query<Row>(
        `SELECT 1 AS balance FROM tenant.loyalty_stored_value_ledger
         WHERE business_id=$1::uuid AND idempotency_key=$2 LIMIT 1`,
        [d.tenantId, d.idempotencyKey],
      );
      if (replay.rows[0]) {
        const { rows } = await c.query<Row>(
          `SELECT COALESCE(sum(delta),0)::int AS balance
           FROM tenant.loyalty_stored_value_ledger WHERE business_id=$1::uuid AND card_id=$2::uuid`,
          [d.tenantId, d.cardId],
        );
        return Number(rows[0].balance);
      }

      const available = Number(
        (
          await c.query<Row>(
            `SELECT COALESCE(sum(delta),0)::int AS balance
             FROM tenant.loyalty_stored_value_ledger WHERE business_id=$1::uuid AND card_id=$2::uuid`,
            [d.tenantId, d.cardId],
          )
        ).rows[0].balance,
      );
      if (available < d.amountCents) throw new InsufficientBalanceError(available);

      const balance = await this.applyWalletDelta(c, d);
      await c.query(
        `UPDATE tenant.loyalty_card SET qr_token=$3, qr_issued_at=now()
         WHERE business_id=$1::uuid AND id=$2::uuid`,
        [d.tenantId, d.cardId, d.newQrToken],
      );
      return balance;
    });
  }

  /** Insert a gift card + seed its ledger (+amount). Throws on code collision (23505). */
  async insertGiftCard(input: {
    tenantId: string;
    code: string;
    amountCents: number;
    staffMemberId: string | null;
    senderName: string | null;
    message: string | null;
    recipientEmail: string | null;
    recipientPhone: string | null;
    recipientName: string | null;
  }): Promise<{ id: string; code: string; amount_cents: number }> {
    return this.pg.withTenant(async (c) => {
      const { rows } = await c.query<{ id: string; code: string; amount_cents: number }>(
        // balance_cents cache DROPPED — remaining value = SUM(gift_card_ledger.delta).
        `INSERT INTO tenant.loyalty_gift_card
           (business_id, code, amount_cents, created_by_staff_id,
            sender_name, message, recipient_email, recipient_phone, recipient_name)
         VALUES ($1::uuid, $2, $3, $4::uuid, $5, $6, $7, $8, $9)
         RETURNING id::text, code, amount_cents`,
        [
          input.tenantId, input.code, input.amountCents, input.staffMemberId,
          input.senderName, input.message, input.recipientEmail, input.recipientPhone, input.recipientName,
        ],
      );
      const gc = rows[0];
      await c.query(
        // gift_card_ledger reason CHECK is (migration_initial_load/load/redeem/
        // adjustment/expire) — 'load' is the issuance reason.
        `INSERT INTO tenant.loyalty_gift_card_ledger
           (business_id, gift_card_id, delta, reason, source_type, source_id, idempotency_key)
         VALUES ($1::uuid, $2::uuid, $3, 'load', 'gift_card', $2::text, $4)`,
        [input.tenantId, gc.id, input.amountCents, `giftissue_${gc.id}`],
      );
      return gc;
    });
  }

  /** Minimal-leak gift-card info for the PUBLIC GET (no amount/sender exposure). */
  async giftCardInfo(
    tenantId: string,
    code: string,
  ): Promise<{ code: string; isRedeemed: boolean; hasMessage: boolean } | null> {
    const { rows } = await this.pg.workerTx((c) =>
      c.query<Row>(
        `SELECT code, (redeemed_at IS NOT NULL) AS is_redeemed, (message IS NOT NULL) AS has_message
         FROM tenant.loyalty_gift_card
         WHERE business_id=$1::uuid AND code=$2 LIMIT 1`,
        [tenantId, code],
      ),
    );
    const r = rows[0];
    if (!r) return null;
    return { code: r.code, isRedeemed: r.is_redeemed, hasMessage: r.has_message };
  }

  async findGiftCardByCode(tenantId: string, code: string): Promise<Row | null> {
    const { rows } = await this.pg.workerTx((c) =>
      c.query<Row>(
        `SELECT id::text, amount_cents, sender_name, redeemed_at, expires_at
         FROM tenant.loyalty_gift_card
         WHERE business_id=$1::uuid AND code=$2 LIMIT 1`,
        [tenantId, code],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * Resolve a customer + their card by phone (normalized) or email over the
   * flat identity model: `tenant.contact` → `tenant.customer` →
   * `tenant.loyalty_card` by `customer_id`. Phone matches across the e164 family (a
   * WhatsApp-only contact resolves the same customer); email matches the `email`
   * channel. `personId` is the `tenant.customer.id`.
   */
  async findPersonCard(
    tenantId: string,
    by: { phone?: string; email?: string },
  ): Promise<{ personId: string; displayName: string | null; cardId: string } | null> {
    return this.pg.workerTx(async (c) => {
      let customer: Row | undefined;
      if (by.phone) {
        const norm = (
          await c.query<Row>(`SELECT tenant.normalize_phone($1) AS n`, [by.phone])
        ).rows[0]?.n;
        if (!norm) return null;
        customer = (
          await c.query<Row>(
            `SELECT cu.id::text AS id, cu.name AS display_name
               FROM tenant.contact ct
               JOIN umi.channel_type ch ON ch.id = ct.channel_id
               JOIN tenant.customer cu ON cu.id = ct.customer_id
              WHERE ct.business_id = $1::uuid AND ct.normalized_value = $2
                AND ch.key IN ('phone', 'whatsapp', 'sms')
              ORDER BY ct.is_primary DESC, ct.updated_at DESC LIMIT 1`,
            [tenantId, norm],
          )
        ).rows[0];
      } else if (by.email) {
        customer = (
          await c.query<Row>(
            `SELECT cu.id::text AS id, cu.name AS display_name
               FROM tenant.contact ct
               JOIN umi.channel_type ch ON ch.id = ct.channel_id
               JOIN tenant.customer cu ON cu.id = ct.customer_id
              WHERE ct.business_id = $1::uuid AND ct.normalized_value = $2 AND ch.key = 'email'
              ORDER BY ct.is_primary DESC, ct.updated_at DESC LIMIT 1`,
            [tenantId, by.email.trim().toLowerCase()],
          )
        ).rows[0];
      }
      if (!customer) return null;
      const card = (
        await c.query<Row>(
          `SELECT id::text FROM tenant.loyalty_card
            WHERE business_id=$1::uuid AND customer_id=$2::uuid AND status='active'
            ORDER BY created_at LIMIT 1`,
          [tenantId, customer.id],
        )
      ).rows[0];
      if (!card) return null;
      return { personId: customer.id, displayName: customer.display_name, cardId: card.id };
    });
  }

  /**
   * Redeem a gift card → credit the recipient's wallet. Atomically claims the
   * card (`redeemed_at IS NULL` guard) so it can't be double-redeemed, then
   * debits the gift ledger and credits the wallet in one transaction.
   */
  async redeemGiftCard(args: {
    tenantId: string;
    giftCardId: string;
    cardId: string;
    amountCents: number;
    senderName: string | null;
  }): Promise<number> {
    return this.pg.workerTx(async (c) => {
      const claim = await c.query<Row>(
        `UPDATE tenant.loyalty_gift_card
         SET redeemed_at=now(), redeemed_card_id=$3::uuid
         WHERE business_id=$1::uuid AND id=$2::uuid AND redeemed_at IS NULL
         RETURNING id`,
        [args.tenantId, args.giftCardId, args.cardId],
      );
      if (!claim.rows[0]) throw new GiftCardAlreadyRedeemedError();

      await c.query(
        // gift_card_ledger.reason='redeem'; the wallet credit below uses card_ledger
        // reason 'gift_card_redeem' (its own CHECK allows it).
        `INSERT INTO tenant.loyalty_gift_card_ledger
           (business_id, gift_card_id, delta, reason, source_type, source_id, idempotency_key)
         VALUES ($1::uuid, $2::uuid, $3, 'redeem', 'loyalty_card', $4::text, $5)`,
        [args.tenantId, args.giftCardId, -args.amountCents, args.cardId, `giftledger_${args.giftCardId}`],
      );

      return this.applyWalletDelta(c, {
        tenantId: args.tenantId,
        cardId: args.cardId,
        deltaCents: args.amountCents,
        type: 'gift_card_redeem',
        idempotencyKey: `giftredeem_${args.giftCardId}`,
        sourceType: 'gift_card',
        sourceId: args.giftCardId,
        description: args.senderName ? `Tarjeta de regalo de ${args.senderName}` : 'Tarjeta de regalo',
      });
    });
  }
}

export class CardNotFoundError extends Error {}
export class InsufficientBalanceError extends Error {
  constructor(public availableCents: number) {
    super('Saldo insuficiente');
  }
}
export class GiftCardAlreadyRedeemedError extends Error {}
