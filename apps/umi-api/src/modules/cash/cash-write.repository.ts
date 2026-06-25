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
  account_id: string | null;
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
 * Customer-facing cash writes on canonical `loyalty.*`. Money moves ONLY through
 * `applyWalletDelta` (append-only `points_ledger` → `wallet_transactions` history
 * → `balances`/`cards` cache recomputed as `SUM(delta)`), faithfully porting
 * umi-cash `wallet.ts`. Idempotency keys + `UNIQUE(idempotency_key)` make retries
 * safe; balances are an absolute SUM so concurrent writers can't corrupt them.
 */
@Injectable()
export class CashWriteRepository {
  constructor(private readonly pg: PgService) {}

  /** The operational staff_members row for the authed user (audit attribution). */
  async getStaffMemberId(tenantId: string, userId: string): Promise<string | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<{ id: string }>(
        `SELECT id::text AS id FROM core.staff_members
         WHERE tenant_id = $1::uuid AND user_id = $2::uuid AND status = 'active'
         LIMIT 1`,
        [tenantId, userId],
      ),
    );
    return rows[0]?.id ?? null;
  }

  /** The person identity linked to the authed login user (self-card guard). */
  async getUserPersonId(userId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ person_id: string | null }>(
      `SELECT person_id::text AS person_id FROM core.users WHERE id = $1::uuid LIMIT 1`,
      [userId],
    );
    return rows[0]?.person_id ?? null;
  }

  /** Find a card by uuid id or card_number, scoped to tenant, with its person. */
  async findCard(tenantId: string, identifier: string): Promise<CardRow | null> {
    const isUuid = UUID_RE.test(identifier);
    const { rows } = await this.pg.withTenant((c) =>
      c.query<CardRow>(
        `SELECT c.id::text, c.account_id::text, c.card_number, c.balance_cents,
                c.total_visits, c.visits_this_cycle, c.pending_rewards, c.qr_token,
                a.person_id::text AS person_id, p.display_name, p.normalized_email
         FROM loyalty.cards AS c
         LEFT JOIN loyalty.accounts AS a ON a.id = c.account_id
         LEFT JOIN core.people AS p ON p.id = a.person_id
         WHERE c.tenant_id = $1::uuid
           AND (c.card_number = $2 ${isUuid ? 'OR c.id = $2::uuid' : ''})
         LIMIT 1`,
        [tenantId, identifier],
      ),
    );
    return rows[0] ?? null;
  }

  /** Today's top-up aggregates for the anti-fraud limits. */
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
              `SELECT COALESCE(sum(amount_cents),0)::bigint AS s
               FROM loyalty.wallet_transactions
               WHERE tenant_id=$1::uuid AND staff_member_id=$2::uuid AND type='topup' AND created_at>=$3`,
              [tenantId, staffMemberId, dayStart],
            )
          ).rows[0].s
        : 0;
      const card = (
        await c.query<Row>(
          `SELECT COALESCE(sum(amount_cents),0)::bigint AS s, count(*)::int AS n
           FROM loyalty.wallet_transactions
           WHERE tenant_id=$1::uuid AND loyalty_card_id=$2::uuid AND type='topup' AND created_at>=$3`,
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

  /** Append a wallet delta on an existing transaction client; returns new balance. */
  private async applyWalletDelta(c: PoolClient, d: WalletDelta): Promise<number> {
    await c.query(
      `INSERT INTO loyalty.points_ledger
         (tenant_id, loyalty_card_id, delta, reason, source_type, source_id, idempotency_key)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
      [d.tenantId, d.cardId, d.deltaCents, d.reason ?? d.type, d.sourceType ?? d.type, d.sourceId ?? null, d.idempotencyKey],
    );
    await c.query(
      `INSERT INTO loyalty.wallet_transactions
         (tenant_id, loyalty_card_id, staff_member_id, type, amount_cents, description)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
      [d.tenantId, d.cardId, d.staffMemberId ?? null, d.type, d.deltaCents, d.description ?? null],
    );
    const balance = Number(
      (
        await c.query<Row>(
          `SELECT COALESCE(sum(delta),0)::int AS balance
           FROM loyalty.points_ledger WHERE tenant_id=$1::uuid AND loyalty_card_id=$2::uuid`,
          [d.tenantId, d.cardId],
        )
      ).rows[0].balance,
    );
    await c.query(
      `INSERT INTO loyalty.balances (tenant_id, loyalty_card_id, balance)
       VALUES ($1::uuid, $2::uuid, $3)
       ON CONFLICT (loyalty_card_id) DO UPDATE SET balance=$3, updated_at=now()`,
      [d.tenantId, d.cardId, balance],
    );
    await c.query(
      `UPDATE loyalty.cards SET balance_cents=$3, updated_at=now()
       WHERE tenant_id=$1::uuid AND id=$2::uuid`,
      [d.tenantId, d.cardId, balance],
    );
    return balance;
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
      const { rows } = await c.query<Row>(
        `SELECT balance_cents FROM loyalty.cards
         WHERE tenant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
        [d.tenantId, d.cardId],
      );
      if (!rows[0]) throw new CardNotFoundError();
      const available = Number(rows[0].balance_cents);
      if (available < d.amountCents) throw new InsufficientBalanceError(available);

      const balance = await this.applyWalletDelta(c, d);
      await c.query(
        `UPDATE loyalty.cards SET qr_token=$3, qr_issued_at=now()
         WHERE tenant_id=$1::uuid AND id=$2::uuid`,
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
        `INSERT INTO loyalty.gift_cards
           (tenant_id, code, amount_cents, balance_cents, created_by_staff_member_id,
            sender_name, message, recipient_email, recipient_phone, recipient_name)
         VALUES ($1::uuid, $2, $3, $3, $4::uuid, $5, $6, $7, $8, $9)
         RETURNING id::text, code, amount_cents`,
        [
          input.tenantId, input.code, input.amountCents, input.staffMemberId,
          input.senderName, input.message, input.recipientEmail, input.recipientPhone, input.recipientName,
        ],
      );
      const gc = rows[0];
      await c.query(
        // reason must satisfy gift_card_ledger_reason_check (load/redeem/
        // adjustment/expire) — umi-cash's 'issue' is rejected by the canonical
        // schema; 'load' is the issuance reason.
        `INSERT INTO loyalty.gift_card_ledger
           (tenant_id, gift_card_id, delta, reason, source_type, source_id, idempotency_key)
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
         FROM loyalty.gift_cards
         WHERE tenant_id=$1::uuid AND code=$2 LIMIT 1`,
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
         FROM loyalty.gift_cards
         WHERE tenant_id=$1::uuid AND code=$2 LIMIT 1`,
        [tenantId, code],
      ),
    );
    return rows[0] ?? null;
  }

  /** Resolve a person + their card by phone (normalized) or email. */
  async findPersonCard(
    tenantId: string,
    by: { phone?: string; email?: string },
  ): Promise<{ personId: string; displayName: string | null; cardId: string } | null> {
    return this.pg.workerTx(async (c) => {
      let personRow: Row | undefined;
      if (by.phone) {
        const norm = (
          await c.query<Row>(`SELECT core.normalize_phone($1) AS n`, [by.phone])
        ).rows[0]?.n;
        if (!norm) return null;
        personRow = (
          await c.query<Row>(
            `SELECT id::text, display_name FROM core.people
             WHERE tenant_id=$1::uuid AND normalized_phone=$2 LIMIT 1`,
            [tenantId, norm],
          )
        ).rows[0];
      } else if (by.email) {
        personRow = (
          await c.query<Row>(
            `SELECT id::text, display_name FROM core.people
             WHERE tenant_id=$1::uuid AND normalized_email=$2 LIMIT 1`,
            [tenantId, by.email.trim().toLowerCase()],
          )
        ).rows[0];
      }
      if (!personRow) return null;
      const card = (
        await c.query<Row>(
          `SELECT c.id::text FROM loyalty.cards c
           JOIN loyalty.accounts a ON a.id=c.account_id
           WHERE c.tenant_id=$1::uuid AND a.person_id=$2::uuid LIMIT 1`,
          [tenantId, personRow.id],
        )
      ).rows[0];
      if (!card) return null;
      return { personId: personRow.id, displayName: personRow.display_name, cardId: card.id };
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
        `UPDATE loyalty.gift_cards
         SET redeemed_at=now(), redeemed_loyalty_card_id=$3::uuid
         WHERE tenant_id=$1::uuid AND id=$2::uuid AND redeemed_at IS NULL
         RETURNING id`,
        [args.tenantId, args.giftCardId, args.cardId],
      );
      if (!claim.rows[0]) throw new GiftCardAlreadyRedeemedError();

      await c.query(
        // gift_card_ledger.reason='redeem' (canonical CHECK) — the wallet credit
        // below still uses points_ledger reason 'gift_card_redeem' (its own CHECK
        // allows it).
        `INSERT INTO loyalty.gift_card_ledger
           (tenant_id, gift_card_id, delta, reason, source_type, source_id, idempotency_key)
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
