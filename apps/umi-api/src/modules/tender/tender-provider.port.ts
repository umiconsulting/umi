import type { TenderFamily } from '@umi/contract';

/**
 * THE TERMINAL PORT. §8G steps 2 and 6 in one file: a terminal is ONE adapter behind
 * ONE interface, so a second brand does not touch checkout.
 *
 * What a provider is allowed to say is deliberately narrow. It cannot say "paid" —
 * it can say `succeeded` with the payment id that proves it, `declined` with a code,
 * or `unknown`, which is an ANSWER rather than an error. A provider that throws, times
 * out, or returns anything we cannot read becomes `unknown`; it never becomes a
 * decline, because a decline is a statement about the customer's money and an
 * unreadable answer is not one.
 *
 * MONEY IS INTEGER MINOR UNITS in this file. There is no float and no decimal string;
 * the contract's `Money.minorUnits` is a safe integer and the database's column is a
 * bigint, and every provider's amount is carried as that integer.
 */

export interface ProviderCaptureRequest {
  /** The identity that started the attempt; the provider's idempotency is our duty, so it travels. */
  readonly commandIdentity: string;
  /**
   * The merchant whose money this is. It travels because the CREDENTIAL does: in the
   * third-party model each café authorizes Umi separately (plan D7), so a provider that talks
   * to a terminal has to know whose account it is acting for. Without it the transport could
   * only ever use one deployment-wide token, which is the shape this decision removes.
   */
  readonly merchantId: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly cartId: string;
  readonly locationId: string;
  readonly tenderId: string;
  readonly correlationId: string;
}

export interface ProviderQueryRequest {
  readonly commandIdentity: string;
  /** See `ProviderCaptureRequest.merchantId`: the credential is the merchant's, not ours. */
  readonly merchantId: string;
  /** Both ids are null until the provider has given them to us. */
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly correlationId: string;
}

export interface ProviderRefundRequest {
  readonly commandIdentity: string;
  /** See `ProviderCaptureRequest.merchantId`: the credential is the merchant's, not ours. */
  readonly merchantId: string;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  /** null means a total refund. */
  readonly amountMinorUnits: number | null;
  /**
   * The vendor's own refund id, when we have one. Null on a FIRST refund — that is the answer
   * being asked for — and non-null on the read that closes a `processing` one, where it is the
   * only unambiguous way to say which entry of `transactions.refunds[]` is ours (plan §14.2 D34).
   */
  readonly providerRefundId?: string | null;
  readonly correlationId: string;
}

/**
 * A refund is a THIRD answer, and it is deliberately not `ProviderOutcome`: a refund that
 * has been accepted is not a capture and not a decline, and the vendor's own vocabulary
 * (`processing` vs `processed`) makes "requested" and "moved" different facts (note 01
 * §4.2). `refunded` is only ever returned WITH a refund id, for the same reason a capture
 * needs a payment id: the id is the proof, and "the vendor says so" is not (plan §8G step 3).
 */
export type ProviderRefundOutcome =
  | {
      readonly kind: 'refunded';
      readonly providerStatus: string;
      readonly providerRefundId: string;
      readonly amountMinorUnits: number | null;
    }
  | {
      readonly kind: 'declined';
      readonly providerStatus: string;
      readonly code: string;
      readonly message: string | null;
    }
  | {
      readonly kind: 'unknown';
      readonly providerStatus: string;
      readonly code: string | null;
      readonly message: string | null;
      /**
       * THE VENDOR'S OWN REFUND ID, EVEN WHEN THE REFUND HAS NOT SETTLED — and this is the
       * field that makes `processing` resolvable rather than permanent.
       *
       * A refund the vendor accepted but has not finished is `unknown`, by the same rule that
       * keeps a capture's "requested" apart from its "moved", and the first cut of this pass
       * threw the id away with it. The consequence was that nothing could ever close the
       * question: the
       * vendor reports refunds inside the ORDER (`transactions.refunds[]`, note 01 §4.2), and
       * without the id there was no way to say WHICH entry in that array is ours — the one
       * thing an unattributable answer must not be guessed at. Keeping it means the later read
       * is a lookup by the vendor's own proof rather than a match on an amount.
       *
       * Null when the vendor gave none: a word without an id still proves nothing, and
       * `refundOutcomeFromSnapshot` already refuses to call such an answer a refund.
       */
      readonly providerRefundId: string | null;
    };

/**
 * `succeeded` carries the payment id when the provider has one, because that IS the
 * proof (§8G step 3 and `payment_attempt_provider_proof_has_id_ck`). It is nullable
 * for exactly one reason: the drawer. Cash's proof is the drawer itself and its
 * `proofSource` is `cash`, not `provider` — so the rule the DATABASE enforces, and the
 * one the service applies here, is "a success that claims PROVIDER proof must carry a
 * payment id". A card capture that came back without one is treated as unknown, never
 * as a capture.
 */
export type ProviderOutcome =
  | {
      readonly kind: 'succeeded';
      readonly providerStatus: string;
      readonly providerOrderId: string | null;
      readonly providerPaymentId: string | null;
      /** What the customer actually paid, when the vendor's answer carried it (a tip can raise it above our amount). */
      readonly paidAmountMinorUnits?: number | null;
      /** The tip the terminal added, when the vendor's answer carried it. */
      readonly tipAmountMinorUnits?: number | null;
    }
  | {
      readonly kind: 'declined';
      readonly providerStatus: string;
      readonly code: string;
      readonly message: string | null;
      readonly providerOrderId: string | null;
    }
  | {
      readonly kind: 'unknown';
      readonly providerStatus: string;
      readonly code: string | null;
      readonly message: string | null;
      readonly providerOrderId: string | null;
      /**
       * The amount the vendor reported for a capture we have not settled on. It is carried
       * because a question about a tip is still a question about money that may have moved.
       */
      readonly paidAmountMinorUnits?: number | null;
      readonly tipAmountMinorUnits?: number | null;
      /**
       * When to ask again. The Point terminal's own flow is the source: `action_required`
       * means it did not answer within 40 seconds and its status does not change.
       */
      readonly queryAfterSeconds: number;
    };

export interface TenderProviderPort {
  /** The registry key, e.g. `cash`, `mercado_pago_point`, `conekta`. */
  readonly id: string;
  readonly family: TenderFamily;
  /**
   * False when this deployment cannot actually reach the provider. A method offered
   * without credentials is a button that fails after the customer has decided.
   */
  readonly available: boolean;
  /** Why it is unavailable, when it is. Never a credential and never a raw payload. */
  readonly unavailableReason: string | null;
  /**
   * The same question, asked for ONE merchant (plan D7, D8). `available` is the deployment's
   * answer — has this build a register, and any token at all — and it is what a caller with no
   * merchant in hand sees. A card reader's real answer depends on WHOSE account is charged, so
   * a provider with a per-merchant credential overrides this; a provider whose reach is not
   * merchant-specific leaves it out and the registry falls back to `available`.
   */
  availabilityFor?(merchantId: string): Promise<ProviderAvailability>;
  /**
   * The one terminal this provider will actually ask, in the vendor's own `type__serial`
   * shape, or null/absent when the provider has no device (the drawer, an
   * operator-attested terminal, a scripted fake). It is here so the ATTEMPT can record
   * which terminal it holds: the database's partial unique index over open attempts
   * (plan D4) is what lets a busy terminal be refused with a named reason before the
   * customer is asked to pay, instead of after the vendor answers
   * `409 already_queued_order_for_terminal`.
   */
  readonly terminalId?: string | null;

  /** Ask for the money. Called at most once per attempt — see the service's claim. */
  capture(request: ProviderCaptureRequest): Promise<ProviderOutcome>;

  /**
   * Ask what happened to an attempt the provider already knows about. A provider that
   * simply does not implement this answers `unknown` rather than throwing: the
   * obligation to answer belongs to us, and a provider without a status endpoint is
   * exactly the case where the operator has to be told so.
   */
  query(request: ProviderQueryRequest): Promise<ProviderOutcome>;

  /**
   * Ask the provider to give money back. ABSENT on a provider that cannot: the drawer has
   * nothing to reverse, and an operator reading a terminal is not a refund channel. A
   * caller must therefore test for the method rather than assume it exists.
   */
  refund?(request: ProviderRefundRequest): Promise<ProviderRefundOutcome>;

  /**
   * ASK WHAT HAPPENED TO A REFUND WE ALREADY ASKED FOR. The refund half of `query`, and it
   * exists for the one state a refund can sit in forever without it: the vendor accepted the
   * request and has not finished, which is `unknown` and must not harden into a fact.
   *
   * A REFUND (READ), NEVER A SECOND `refund` (WRITE). Re-posting the same refund to ask about
   * it would lean on the vendor's idempotency window to avoid moving money twice, and that
   * window is 24 hours — after which the "question" is a second refund. The vendor reports
   * refunds inside the order, so the answer is already readable, and a read cannot move money.
   *
   * ABSENT on a provider that cannot answer it, exactly as `refund` is absent where a refund
   * is not a thing (the drawer). A caller must test for the method.
   */
  refundQuery?(request: ProviderRefundRequest): Promise<ProviderRefundOutcome>;
}

/** DI token for the registered providers. The registry is built once, from config. */
export const TENDER_PROVIDER_PORTS = 'TENDER_PROVIDER_PORTS';

/**
 * WHOSE ACCOUNT IS BEHIND THE METHOD. `available` alone cannot answer a card question: the
 * register is the deployment's and the account is the merchant's (plan D7), so "can this
 * deployment reach a terminal" and "can this café be charged" are different questions and the
 * till needs the second. Both fields have the same shape as the deployment-level pair, so a
 * screen renders one or the other without a branch of its own.
 */
export interface ProviderAvailability {
  readonly available: boolean;
  readonly unavailableReason: string | null;
}

/**
 * The one sentence every provider must be able to answer, so the till can offer a
 * method only when it will work.
 */
export const providerIsUsable = (provider: TenderProviderPort): boolean => provider.available;
