import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import { LOYALTY_CARD_STATE_SQL, type LoyaltyCardState } from '../../shared/loyalty/card-state.sql';

/** The card itself — identity only, because state is derived, not stored. */
export interface CustomerCardRow {
  id: string;
  qr_token: string | null;
  customer_name: string | null;
}

export interface RecentVisit {
  id: string;
  occurred_at: Date;
}

export interface RecentLedgerEntry {
  id: string;
  reason: string;
  delta: number;
  note: string | null;
  created_at: Date;
}

/**
 * Card reads, scoped to one merchant and one card.
 *
 * TWO AUDIENCES, ONE SET OF NUMBERS. The customer's own page reads these, and so
 * does the staff customer-detail screen — the same visits and the same ledger,
 * shown to the barista instead of to her. Two copies would let the two screens
 * disagree about the same customer while she is standing at the counter.
 *
 * `cardForCustomer` is the exception and is customer-scoped on purpose: RLS
 * confines the query to the café, and the customer predicate is what stops one
 * customer reading another's card inside it.
 */
@Injectable()
export class CashCardRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Her card at this café, or null.
   *
   * build-v3 hangs the card off the customer directly (`loyalty_card.customer_id`).
   * umi-cash walked person → account → card, an indirection this schema does not
   * have — so the "reach the card via person → account" comment it carries does
   * not survive the port, and neither does the join.
   */
  async cardForCustomer(merchantId: string, customerId: string): Promise<CustomerCardRow | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<CustomerCardRow>(
        `SELECT c.id::text, c.qr_token, cu.name AS customer_name
           FROM merchant.loyalty_card AS c
           JOIN merchant.customer AS cu ON cu.id = c.customer_id
          WHERE c.merchant_id = $1::uuid AND c.customer_id = $2::uuid
          ORDER BY c.created_at
          LIMIT 1`,
        [merchantId, customerId],
      ),
    );
    return rows[0] ?? null;
  }

  /**
   * The four numbers, from the one formula. Her phone and the barista's register
   * must never disagree, so neither computes them itself.
   */
  async cardState(merchantId: string, cardId: string): Promise<LoyaltyCardState | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<LoyaltyCardState>(LOYALTY_CARD_STATE_SQL, [merchantId, cardId]),
    );
    return rows[0] ?? null;
  }

  /** Her last few visits — "you came in on these days". */
  async recentVisits(merchantId: string, cardId: string, limit: number): Promise<RecentVisit[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<RecentVisit>(
        `SELECT id::text, occurred_at FROM merchant.loyalty_visit
          WHERE merchant_id = $1::uuid AND card_id = $2::uuid
          ORDER BY occurred_at DESC LIMIT $3`,
        [merchantId, cardId, limit],
      ),
    );
    return rows;
  }

  /** Her last few Saldo movements. The card page only shows these when the café sells it. */
  async recentLedger(
    merchantId: string,
    cardId: string,
    limit: number,
  ): Promise<RecentLedgerEntry[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<RecentLedgerEntry>(
        `SELECT id::text, reason, delta::int, note, created_at
           FROM merchant.loyalty_stored_value_ledger
          WHERE merchant_id = $1::uuid AND card_id = $2::uuid
          ORDER BY created_at DESC LIMIT $3`,
        [merchantId, cardId, limit],
      ),
    );
    return rows;
  }
}
