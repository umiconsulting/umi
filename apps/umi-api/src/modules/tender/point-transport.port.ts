/**
 * THE ONE FILE THAT CHANGES TO ADD A SECOND TERMINAL BRAND.
 *
 * A transport knows how to talk to ONE device API and nothing else: it creates an
 * order, and it reads an order's current state. It does not decide what a state means,
 * it does not touch our database, and it does not know what a tender is. The meaning is
 * `classifyTerminalStatus` in `tender-domain.ts`, which is pure and property-tested —
 * which is why a wrong mapping is a failing test rather than a wrong charge.
 *
 * THE LIVE TRANSPORT IS NOT WRITTEN YET, ON PURPOSE. The Mercado Pago Point API's
 * order and terminal endpoints cannot be exercised without credentials, and a client
 * written from an unverified reading of documentation is worse than no client: it
 * would be the piece most likely to be subtly wrong in the one path that moves money.
 * What exists here is the SEAM and its first, honest implementation —
 * `UnconfiguredPointTransport` — which makes the provider unavailable and says what is
 * missing. The scripted providers are the second implementation, and they are what the
 * acceptance suite drives.
 */

export interface PointOrderInput {
  /** Ours, and the reason a terminal payment can ever be matched to a sale. */
  readonly externalReference: string;
  /** Whose account this order is for: the credential to ask the vendor with (plan D7). */
  readonly merchantId: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly description: string;
}

/**
 * The terminal's own view of an order. `status` is kept VERBATIM: the documented flow
 * is `created → at_terminal → processed | failed | action_required | canceled |
 * expired`, and a status we have never seen must survive into the record rather than
 * being coerced into something comfortable.
 */
export interface PointOrderSnapshot {
  readonly orderId: string;
  readonly status: string;
  /**
   * The order's own `status_detail`, kept verbatim beside the status for the same reason
   * the status is: it is where the vendor reports the states that are NOT in the status
   * enum — `partially_refunded` among them — and a mapper that cannot see it reads a
   * refunded order as an unrecognised status.
   */
  readonly statusDetail?: string | null;
  readonly paymentId: string | null;
  /**
   * `transactions.payments[].paid_amount` in minor units, when the vendor sent one. It can
   * EXCEED the amount we asked for: the terminal may add a tip, so the amount that actually
   * reached the card — not the number we sent — is the ceiling a refund has to respect
   * (plan §4 phase 4 step 3, note 01 §2.2).
   */
  readonly paidAmountMinorUnits?: number | null;
  /** `transactions.payments[].tip_amount` in minor units — the terminal can add a tip. */
  readonly tipAmountMinorUnits?: number | null;
  readonly failureCode: string | null;
}

/**
 * A refund command, in the seam's own vocabulary. `paymentId` and `amountMinorUnits` are
 * jointly meaningful: a null amount is a TOTAL refund (the vendor documents no body for
 * that), and a non-null amount is a PARTIAL refund that must name the payment it applies
 * to — a partial refund with no payment id is malformed before it leaves (note 01 §4.2).
 */
export interface PointRefundInput {
  readonly orderId: string;
  /** Whose account this refund is for: the credential to ask the vendor with (plan D7). */
  readonly merchantId: string;
  /** The payment to refund; null only when a total refund of the order is asked for. */
  readonly paymentId: string | null;
  /** null means a TOTAL refund (the vendor documents no body for that). */
  readonly amountMinorUnits: number | null;
  /** Our command identity for this refund; the idempotency key derives from it. */
  readonly commandIdentity: string;
}

/**
 * What the vendor said about a refund it has accepted. The status is kept VERBATIM and the
 * snapshot carries no `refunded` boolean: the vendor's reference documents `processing` as
 * the refund status enum while its own guide shows `processed`, so a refund is
 * ASYNCHRONOUS and mapping it here would be a guess the seam has no standing to make
 * (note 01 §4.2).
 */
export interface PointRefundSnapshot {
  /** The vendor's refund id (`transactions.refunds[].id`), when it answered with one. */
  readonly refundId: string | null;
  readonly status: string;
  readonly statusDetail: string | null;
  /** `transactions.refunds[].amount` when present. */
  readonly amountMinorUnits: number | null;
}

export interface PointTransport {
  /** False when this deployment has no credentials or no terminal id. */
  readonly configured: boolean;
  /** Why it is not configured, for the operator's sentence. Never a credential. */
  readonly unavailableReason: string | null;
  /**
   * The terminal this transport speaks to, in the vendor's own `type__serial` shape,
   * or null when there is none. It is here because the attempt row has to NAME the
   * terminal it holds: `merchant.pos_payment_attempt` carries a partial unique index on
   * `(merchant_id, terminal_id)` for open attempts (plan D4), which is our own version
   * of the vendor's `409 already_queued_order_for_terminal` — refused with a named
   * reason before the customer touches the card, rather than learned from a conflict
   * after they have decided.
   */
  readonly terminalId: string | null;
  createOrder(input: PointOrderInput): Promise<PointOrderSnapshot>;
  /**
   * Whether THIS café's account can be charged right now — the per-merchant half of
   * `configured` (plan D7, D8). `configured` answers "does this deployment own a register at
   * all"; this answers "is there an account behind that register for this merchant", which is
   * what decides whether the till may offer the card method. A café whose account is not
   * connected must not be shown a button that fails after the customer has decided.
   */
  canChargeFor(merchantId: string): Promise<boolean>;
  /**
   * Read an order. The merchant is named for the same reason `createOrder` names it: the
   * credential this read is made with is THAT merchant's (plan D7).
   */
  readOrder(orderId: string, merchantId: string): Promise<PointOrderSnapshot>;
  /**
   * Ask the vendor to give money back — `POST /v1/orders/{order_id}/refund` (note 01 §4).
   * It answers with the refund's own status, never with a verdict: the money has been
   * REQUESTED, and whether it moved is a later question.
   */
  refundOrder(input: PointRefundInput): Promise<PointRefundSnapshot>;
  /**
   * READ ONE REFUND BACK — the question a `processing` refund needs answered, and the reason it
   * is a read rather than a second `refundOrder`.
   *
   * The vendor reports refunds inside the ORDER (`transactions.refunds[]`, note 01 §4.2), so the
   * answer is already there to be read. Re-posting the refund to ask about it would lean on the
   * vendor's 24-hour idempotency binding to avoid moving money twice, and it would stop being
   * safe the moment that window closed. A read cannot move money at all.
   *
   * THE REFUND IS NAMED BY THE VENDOR'S OWN ID, and that is the whole point of the signature: an
   * order can carry several partial refunds, and picking one by amount would be guessing at
   * money. `null` is an ANSWER — the order came back and does not contain this refund — and must
   * never be read as a settlement.
   */
  readRefund(
    orderId: string,
    refundId: string,
    merchantId: string,
  ): Promise<PointRefundSnapshot | null>;
}

export class UnconfiguredPointTransport implements PointTransport {
  readonly configured = false;
  readonly terminalId = null;

  constructor(readonly unavailableReason: string) {}

  createOrder(): Promise<PointOrderSnapshot> {
    return Promise.reject(new Error(this.unavailableReason));
  }

  canChargeFor(): Promise<boolean> {
    return Promise.resolve(false);
  }

  readOrder(): Promise<PointOrderSnapshot> {
    return Promise.reject(new Error(this.unavailableReason));
  }

  refundOrder(): Promise<PointRefundSnapshot> {
    return Promise.reject(new Error(this.unavailableReason));
  }

  readRefund(): Promise<PointRefundSnapshot | null> {
    return Promise.reject(new Error(this.unavailableReason));
  }
}
