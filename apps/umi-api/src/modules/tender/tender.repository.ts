import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenderProofSource } from '@umi/contract';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import { PosCheckoutRepository } from '../pos-checkout/pos-checkout.repository';
// The contract's `PaymentState` is a value here, so the type comes from the domain that
// derives it — see the note there.
import type { PaymentState } from './tender-domain';

/**
 * Reading and writing the attempt record.
 *
 * THE ATTEMPT TABLE IS THE ONE THAT ALREADY EXISTED. `merchant.pos_payment_attempt` has
 * carried an attempt since 20_merchant.sql and was already keyed by cart and tender with
 * `unknown`/`timeout` as first-class outcomes; `70_tender.sql` adds the command identity,
 * the provider, the provider's own ids, the proof source and the capture claim to it. No
 * parallel model was created — the procurement work's rule, applied here, and the reason
 * the till's existing cash and manual-terminal rows keep working unchanged.
 *
 * THE TWO UNIQUE INDEXES ARE THE MONEY GUARD, and they are why the insert uses
 * `on conflict do nothing` rather than a check in TypeScript: a concurrent double-capture
 * of one command identity, or of one tender draft, cannot create a second row, so it
 * cannot reach the provider twice. Losing the race is not an error — it is a replay, and
 * the loser reads the winner's row.
 */

/** One attempt, as stored. The service composes the contract model from this. */
export interface TenderAttemptRow {
  id: string;
  /**
   * The merchant that owns the attempt. It is here for the ONE path that runs without
   * an authenticated operator — the terminal's own notification, which arrives with
   * nobody logged in and is resolved on the BYPASSRLS worker pool. Every other reader
   * already knows the merchant it asked for.
   */
  merchantId: string;
  commandIdentity: string | null;
  cartId: string;
  locationId: string;
  method: 'cash' | 'external_terminal' | 'stored_value' | 'gift_card';
  provider: string | null;
  state: PaymentState;
  queryOnly: boolean;
  amountMinorUnits: string;
  currency: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerStatus: string | null;
  proofSource: TenderProofSource | null;
  correlationId: string;
  queryAfter: string | null;
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  providerCaptureAt: string | null;
  providerQueryCount: number;
  tenderDraftId: string | null;
  terminalId: string | null;
  /**
   * Set when this row IS a refund: the capture it gives back (plan D6). A refund is
   * its own attempt, and this is the fact that makes it one rather than a note
   * attached to the sale.
   */
  refundOfAttemptId: string | null;
  /** The vendor's refund id — a refund's own proof (`provider_refund_id`). */
  providerRefundId: string | null;
  /** What the customer actually paid, as the terminal reported it. The refund ceiling. */
  providerPaidMinorUnits: string | null;
  /** The tip the terminal added, when it added one. */
  providerTipMinorUnits: string | null;
}

const ATTEMPT_COLUMNS = `
  id::text AS "id", merchant_id::text AS "merchantId",
  command_identity::text AS "commandIdentity", cart_id::text AS "cartId",
  location_id::text AS "locationId", method, provider, status AS "state",
  query_only AS "queryOnly", amount_minor_units::text AS "amountMinorUnits", currency,
  provider_order_id AS "providerOrderId", provider_payment_id AS "providerPaymentId",
  provider_status AS "providerStatus", proof_source AS "proofSource",
  correlation_id AS "correlationId", query_after::text AS "queryAfter",
  expires_at::text AS "expiresAt", created_at::text AS "createdAt",
  resolved_at::text AS "resolvedAt", provider_capture_at::text AS "providerCaptureAt",
  provider_query_count AS "providerQueryCount", tender_draft_id::text AS "tenderDraftId",
  terminal_id AS "terminalId", refund_of_attempt_id::text AS "refundOfAttemptId",
  provider_refund_id AS "providerRefundId",
  provider_paid_minor_units::text AS "providerPaidMinorUnits",
  provider_tip_minor_units::text AS "providerTipMinorUnits"`;

export interface BeginAttemptInput {
  locationId: string;
  cartId: string;
  tenderDraftId: string;
  method: 'cash' | 'external_terminal' | 'stored_value' | 'gift_card';
  provider: string;
  /**
   * The terminal this attempt will hold, when the provider has one. Null for the drawer
   * and for an operator-attested terminal, which hold no device. Non-null is what makes
   * the D4 index bite: one open attempt per terminal, per merchant.
   */
  terminalId: string | null;
  amountMinorUnits: number;
  currency: string;
  commandIdentity: string;
  correlationId: string;
  /** How long an attempt may sit unanswered before it is a `timeout` awaiting a query. */
  expiresInSeconds: number;
}

export interface BeginAttemptResult {
  attempt: TenderAttemptRow;
  /**
   * True only for the writer whose INSERT created the row. The loser of the race — a
   * replay, or a concurrent second capture — gets false and must NOT call the provider.
   */
  owned: boolean;
}

/**
 * A REFUND'S OWN ATTEMPT (plan D6). It is the same table and the same shape as a
 * capture, with three differences that are the whole of "a refund is a second act":
 * it names the capture it gives back, it carries the payment id the vendor's refund
 * call needs, and it deliberately does NOT hold a terminal — a refund is not an order
 * waiting on a device, so it must not take the one-open-order-per-terminal lock of
 * D4 against a till that is trying to sell something.
 */
export interface BeginRefundInput {
  locationId: string;
  cartId: string;
  tenderDraftId: string | null;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string;
  /** The capture being given back. */
  refundOfAttemptId: string;
  amountMinorUnits: number;
  currency: string;
  commandIdentity: string;
  correlationId: string;
  expiresInSeconds: number;
}

/** What a resolved outcome writes. Every field is the provider's answer or our evidence. */
export interface ResolveAttemptInput {
  state: PaymentState;
  queryOnly: boolean;
  proofSource: TenderProofSource | null;
  providerStatus: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  /** A refund's own proof. Null for everything that is not a refund. */
  providerRefundId?: string | null;
  /** What the customer actually paid, when this answer carries it (the refund ceiling). */
  providerPaidMinorUnits?: number | null;
  /** The tip the terminal added, when this answer carries it. */
  providerTipMinorUnits?: number | null;
  queryAfterSeconds: number | null;
  /** True when this write came from asking the provider about an existing attempt. */
  isQuery: boolean;
}

@Injectable()
export class TenderRepository {
  constructor(
    private readonly pg: PgService,
    // The authorization for `checkout.commit` lives in one place. Duplicating that SQL
    // in a second module would be a second security gate to keep in step, and gates
    // drift — which is exactly how a permission gets quietly widened.
    private readonly checkout: PosCheckoutRepository,
  ) {}

  authorize(
    userId: string,
    sessionId: string,
    deviceId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ) {
    return this.checkout.authorize(
      userId,
      sessionId,
      deviceId,
      merchantId,
      locationId,
      operatorSessionId,
    );
  }

  /** The cart must exist at this location and still be editable for an attempt to be made. */
  async loadOpenCart(
    merchantId: string,
    locationId: string,
    cartId: string,
  ): Promise<{ id: string; businessDate: string; status: string }> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        const { rows } = await client.query<{ id: string; businessDate: string; status: string }>(
          `SELECT id::text AS "id", business_date::text AS "businessDate", status
             FROM merchant.pos_cart
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid`,
          [merchantId, locationId, cartId],
        );
        const cart = rows[0];
        if (!cart) throw new NotFoundException({ code: 'CART_NOT_FOUND' });
        if (cart.status === 'committed' || cart.status === 'abandoned') {
          throw new ConflictException({ code: 'CART_NOT_OPEN', details: { status: cart.status } });
        }
        return cart;
      },
      locationId,
    );
  }

  /**
   * Persist the attempt. `on conflict do nothing` covers BOTH unique indexes — the
   * command identity and the tender draft — and either conflict means someone else got
   * there first, so the loser reads what exists instead of creating a second attempt.
   *
   * `on conflict do nothing` also swallows the third unique index, the D4 one on
   * `(merchant_id, terminal_id)` for open attempts — and that is why the loser path
   * below asks the terminal question explicitly. A busy terminal is not a race with
   * ourselves: it is the vendor's own `409 already_queued_order_for_terminal`, and the
   * operator gets a named reason for it instead of the generic conflict a genuine
   * tangle deserves.
   */
  async beginAttempt(
    client: PoolClient,
    merchantId: string,
    input: BeginAttemptInput,
  ): Promise<BeginAttemptResult> {
    const inserted = await client.query<TenderAttemptRow>(
      `INSERT INTO merchant.pos_payment_attempt
         (merchant_id,location_id,cart_id,method,provider,amount_minor_units,currency,
          status,query_only,correlation_id,command_identity,tender_draft_id,expires_at,
          terminal_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,'pending',false,$8,$9::uuid,$10::uuid,
               clock_timestamp() + make_interval(secs => $11), $12)
       ON CONFLICT DO NOTHING
       RETURNING ${ATTEMPT_COLUMNS}`,
      [
        merchantId,
        input.locationId,
        input.cartId,
        input.method,
        input.provider,
        input.amountMinorUnits,
        input.currency,
        input.correlationId,
        input.commandIdentity,
        input.tenderDraftId,
        input.expiresInSeconds,
        input.terminalId,
      ],
    );
    if (inserted.rows[0]) return { attempt: inserted.rows[0], owned: true };

    // Lost the race, or a replay. Either way the existing attempt is the answer, and by
    // the command identity first: a retry of the SAME command identity is the case §8G
    // step 3 names, and it must return the first attempt's own outcome.
    const existing = await client.query<TenderAttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid
          AND (command_identity=$3::uuid
               OR (tender_draft_id=$4::uuid AND cart_id=$5::uuid))
        ORDER BY (command_identity IS NOT DISTINCT FROM $3::uuid) DESC, created_at ASC
        LIMIT 1`,
      [merchantId, input.locationId, input.commandIdentity, input.tenderDraftId, input.cartId],
    );
    const attempt = existing.rows[0];
    if (attempt) return { attempt, owned: false };

    // Not a replay of this command, and not this draft: if a terminal was named, the
    // answer is almost certainly that it is holding someone else's order. Asked only
    // after the replay question, so a retry of the SAME command keeps its own answer.
    if (input.terminalId) {
      const busy = await client.query<{ id: string; cart_id: string }>(
        `SELECT id::text AS "id", cart_id::text AS "cart_id"
           FROM merchant.pos_payment_attempt
          WHERE merchant_id=$1::uuid AND terminal_id=$2
            AND status IN ('pending','unknown','timeout')
          LIMIT 1`,
        [merchantId, input.terminalId],
      );
      if (busy.rows[0]) {
        throw new ConflictException({
          code: 'TERMINAL_BUSY',
          details: {
            terminalId: input.terminalId,
            holdingAttemptId: busy.rows[0].id,
            holdingCartId: busy.rows[0].cart_id,
          },
        });
      }
    }

    throw new ConflictException({ code: 'TENDER_ATTEMPT_CONFLICT' });
  }

  /**
   * Persist a REFUND attempt, and answer whether this caller is the one that created
   * it — the same contract `beginAttempt` has, for the same reason: the loser of the
   * race (a retry of the same refund, a second tab) must read instead of asking the
   * vendor twice.
   *
   * The unique index it loses to is the command identity's, which is the refund's own
   * identity and not the capture's: two refunds of one sale are two attempts, and the
   * second one is legitimate.
   */
  async beginRefundAttempt(
    client: PoolClient,
    merchantId: string,
    input: BeginRefundInput,
  ): Promise<BeginAttemptResult> {
    const inserted = await client.query<TenderAttemptRow>(
      `INSERT INTO merchant.pos_payment_attempt
         (merchant_id,location_id,cart_id,method,provider,amount_minor_units,currency,
          status,query_only,correlation_id,command_identity,expires_at,
          provider_order_id,provider_payment_id,refund_of_attempt_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,'external_terminal',$4,$5,$6,'pending',false,$7,
               $8::uuid, clock_timestamp() + make_interval(secs => $9),
               $10,$11,$12::uuid)
       ON CONFLICT DO NOTHING
       RETURNING ${ATTEMPT_COLUMNS}`,
      [
        merchantId,
        input.locationId,
        input.cartId,
        input.provider,
        input.amountMinorUnits,
        input.currency,
        input.correlationId,
        input.commandIdentity,
        input.expiresInSeconds,
        input.providerOrderId,
        input.providerPaymentId,
        input.refundOfAttemptId,
      ],
    );
    if (inserted.rows[0]) return { attempt: inserted.rows[0], owned: true };

    const existing = await client.query<TenderAttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS}
         FROM merchant.pos_payment_attempt
        WHERE merchant_id=$1::uuid AND command_identity=$2::uuid
        LIMIT 1`,
      [merchantId, input.commandIdentity],
    );
    const attempt = existing.rows[0];
    if (attempt) return { attempt, owned: false };
    throw new ConflictException({ code: 'TENDER_ATTEMPT_CONFLICT' });
  }

  /**
   * How much of one capture has ALREADY been given back, in minor units.
   *
   * Summed from the refund attempts themselves rather than cached on the capture: the
   * attempts are the record of what was asked for, and a cached total is a second
   * answer that can disagree with them. Only `succeeded` refunds count — a refund the
   * vendor declined did not give anything back, and counting it would refuse a second
   * refund that is still legal.
   */
  async refundedAmount(merchantId: string, refundOfAttemptId: string): Promise<number> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<{ refunded: string | null }>(
        `SELECT COALESCE(SUM(amount_minor_units), 0)::text AS "refunded"
           FROM merchant.pos_payment_attempt
          WHERE merchant_id=$1::uuid AND refund_of_attempt_id=$2::uuid AND status='succeeded'`,
        [merchantId, refundOfAttemptId],
      );
      return Number(rows[0]?.refunded ?? '0');
    });
  }

  /**
   * HOW MANY ATTEMPTS ARE WAITING FOR AN ANSWER THEY SHOULD ALREADY HAVE (plan §7 item 3).
   *
   * "The attempts that stay unresolved past their `queryAfter` window are a countable metric.
   * That number is the health of the integration." This is that count: an attempt that asked to
   * be re-read at a time which has passed, and is still in one of the three not-yet-answered
   * states. ZERO IS THE ONLY HEALTHY READING, and a number that climbs is the terminal, the
   * vendor, or our own resolution path failing — which is exactly the thing an operator cannot
   * see from a counter of successes.
   *
   * IT COUNTS EVERY CAFÉ, so it is the background job's read and never a route's: there is no
   * membership to narrow by, and request paths here are merchant-scoped by construction. It runs
   * on the worker pool for the same reason `dueForRenewal` does.
   */
  async countUnresolvedPastQueryWindow(): Promise<number> {
    const { rows } = await this.pg.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM merchant.pos_payment_attempt
        WHERE status IN ('pending','unknown','timeout')
          AND query_after IS NOT NULL
          AND query_after <= clock_timestamp()`,
    );
    return Number(rows[0]?.count ?? '0');
  }

  /**
   * A REFUND OF THIS CAPTURE THAT IS STILL WAITING FOR AN ANSWER (plan §12.4 item 3, §14.2 D34).
   *
   * `unknown` and `timeout` are the two states a refund sits in when the vendor has not said the
   * money moved, and they are the only ones worth asking about: a `succeeded` refund is settled,
   * a `declined` one is answered, and a `cancelled` one was never a refund.
   *
   * THE TWO `IS NOT NULL` PREDICATES ARE THE WHOLE USABILITY OF THE ROW, not tidiness. A refund
   * with no vendor id cannot be looked up — the read would have to guess which entry of
   * `transactions.refunds[]` is ours — and one with no order id has nothing to read. Both are
   * therefore not "questions we might answer later" but questions that cannot be asked, and this
   * method returns them as nothing rather than handing the caller a lookup that would have to
   * invent an attribution.
   *
   * NEWEST FIRST, the same rule `findAttemptForNotification` states: an order names one refund,
   * so the ordering decides nothing in production, and in a reused database it keeps the current
   * run's row away from an earlier one's.
   */
  async findOpenRefundFor(
    merchantId: string,
    refundOfAttemptId: string,
  ): Promise<TenderAttemptRow | null> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<TenderAttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS}
           FROM merchant.pos_payment_attempt
          WHERE merchant_id=$1::uuid
            AND refund_of_attempt_id=$2::uuid
            AND status IN ('unknown','timeout')
            AND provider_refund_id IS NOT NULL
            AND provider_order_id IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [merchantId, refundOfAttemptId],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Claim the right to call the provider, EXACTLY ONCE, before calling it.
   *
   * This is the durable half of "persisted before the provider is called". The row is
   * committed with `provider_capture_at` null; whoever's UPDATE finds it null owns the
   * call, and everyone else — a replay, a second tab, a retry after a crash — is told to
   * read instead of ask. A process killed between the claim and the answer leaves an
   * attempt that is queryable and can never be silently captured a second time.
   */
  async claimProviderCapture(merchantId: string, attemptId: string): Promise<boolean> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE merchant.pos_payment_attempt
            SET provider_capture_at=clock_timestamp()
          WHERE merchant_id=$1::uuid AND id=$2::uuid
            AND provider_capture_at IS NULL AND status='pending'`,
        [merchantId, attemptId],
      );
      return rowCount === 1;
    });
  }

  /**
   * Write what the provider said. The guard makes resolution MONOTONIC: an attempt that
   * already succeeded or was cancelled is never rewritten. The one deliberate exception
   * is a decline that a later query proves was actually captured — money that moved must
   * be recorded, and freezing the decline would hide a charge.
   */
  async resolveAttempt(
    client: PoolClient,
    merchantId: string,
    attemptId: string,
    input: ResolveAttemptInput,
  ): Promise<TenderAttemptRow | null> {
    const { rows } = await client.query<TenderAttemptRow>(
      `UPDATE merchant.pos_payment_attempt
          SET status=$3,
              query_only=$4,
              proof_source=$5,
              provider_status=COALESCE($6, provider_status),
              provider_order_id=COALESCE($7, provider_order_id),
              provider_payment_id=COALESCE($8, provider_payment_id),
              provider_refund_id=COALESCE($11, provider_refund_id),
              provider_paid_minor_units=COALESCE($12, provider_paid_minor_units),
              provider_tip_minor_units=COALESCE($13, provider_tip_minor_units),
              query_after=CASE WHEN $9::int IS NULL THEN query_after
                               ELSE clock_timestamp() + make_interval(secs => $9::int) END,
              expires_at=CASE WHEN $3 IN ('unknown','timeout')
                              THEN COALESCE(expires_at, clock_timestamp() + interval '30 minutes')
                              ELSE expires_at END,
              provider_query_count=provider_query_count + CASE WHEN $10 THEN 1 ELSE 0 END,
              resolved_at=CASE WHEN $3 IN ('succeeded','declined','cancelled')
                               THEN clock_timestamp() ELSE resolved_at END
        WHERE merchant_id=$1::uuid AND id=$2::uuid
          AND (status IN ('pending','unknown','timeout')
               OR (status='declined' AND $3='succeeded'))
        RETURNING ${ATTEMPT_COLUMNS}`,
      [
        merchantId,
        attemptId,
        input.state,
        input.queryOnly,
        input.proofSource,
        input.providerStatus,
        input.providerOrderId,
        input.providerPaymentId,
        input.queryAfterSeconds,
        input.isQuery,
        input.providerRefundId ?? null,
        input.providerPaidMinorUnits ?? null,
        input.providerTipMinorUnits ?? null,
      ],
    );
    return rows[0] ?? null;
  }

  async readByCommandIdentity(
    merchantId: string,
    locationId: string,
    commandIdentity: string,
  ): Promise<TenderAttemptRow | null> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        // An attempt whose window has closed is a `timeout` — the same rule the till's
        // existing `paymentStatus` applies, so there is one definition of "unanswered".
        await client.query(
          `UPDATE merchant.pos_payment_attempt
              SET status='timeout', query_only=true
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid
              AND command_identity=$3::uuid AND status='pending' AND expires_at<=now()`,
          [merchantId, locationId, commandIdentity],
        );
        const { rows } = await client.query<TenderAttemptRow>(
          `SELECT ${ATTEMPT_COLUMNS}
             FROM merchant.pos_payment_attempt
            WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND command_identity=$3::uuid`,
          [merchantId, locationId, commandIdentity],
        );
        return rows[0] ?? null;
      },
      locationId,
    );
  }

  async readById(merchantId: string, attemptId: string): Promise<TenderAttemptRow | null> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<TenderAttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS}
           FROM merchant.pos_payment_attempt
          WHERE merchant_id=$1::uuid AND id=$2::uuid`,
        [merchantId, attemptId],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * The attempt a terminal NOTIFICATION names, found with nobody logged in.
   *
   * This is the only reader in this file that runs on the BYPASSRLS worker pool, and it
   * has to: a notification arrives from the vendor with no operator session, no location
   * and no merchant — the two handles it does carry are the order id we stored and our
   * own `external_reference`, which IS the command identity. So the lookup is by those,
   * and the row's `merchantId` is what every later step uses to run under the ordinary
   * RLS path. Isolation here is the explicit `merchant_id = $1` predicate on every write
   * that follows, exactly as `PgService.workerTx` documents.
   *
   * The order id is asked first because it is the vendor's primary handle and the one
   * that survives a capture whose response never reached us; the command identity is the
   * fallback for the same notification arriving before we ever learned the order id.
   *
   * NEWEST FIRST, and that ordering is a correctness rule rather than a preference: in
   * production an order id names exactly one attempt, so the sort decides nothing there —
   * but a database that has been reused (a rehearsal clone, a harness) can hold a settled
   * attempt carrying the same order id from an earlier life, and answering the OLDEST
   * match would hand the current notification the previous run's row.
   */
  async findAttemptForNotification(input: {
    providerOrderId: string | null;
    commandIdentity: string | null;
  }): Promise<TenderAttemptRow | null> {
    if (!input.providerOrderId && !input.commandIdentity) return null;
    return this.pg.workerTx(async (client) => {
      const { rows } = await client.query<TenderAttemptRow>(
        `SELECT ${ATTEMPT_COLUMNS}
           FROM merchant.pos_payment_attempt
          WHERE ($1::text IS NOT NULL AND provider_order_id = $1::text)
             OR ($2::uuid IS NOT NULL AND command_identity = $2::uuid)
          ORDER BY (provider_order_id IS NOT DISTINCT FROM $1::text) DESC, created_at DESC
          LIMIT 1`,
        [input.providerOrderId, input.commandIdentity],
      );
      return rows[0] ?? null;
    });
  }
}
