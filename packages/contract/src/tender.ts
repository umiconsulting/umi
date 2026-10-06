import { z } from 'zod';
import { CfdiDocument, CfdiStampRequest } from './fiscal';
import {
  CorrelationId,
  IsoTimestamp,
  MerchantDate,
  Money,
  PaymentAmbiguity,
  Uuid,
} from './platform';
import { PaymentMethod, PaymentState } from './pos-checkout';

/**
 * The tender path — workstream G steps 2, 3, 5 and 7 of the plan, and the invariants
 * `docs/architecture/2026-09-16-tender-path-adr.md` fixes.
 *
 * THE ONE IDEA IN THIS FILE: an attempt at taking money is a RECORD WITH A COMMAND
 * IDENTITY, and it ends in exactly one of THREE outcomes — succeeded, declined, or
 * unknown. The third is the one that costs money when it is modelled wrong, so it is
 * modelled first:
 *
 *   · An unknown is NOT an error to retry blindly. It is a state with an obligation,
 *     queryable by the same command identity that started it, and never stored as paid.
 *   · An operator's assertion is NOT provider proof. "The customer says it went
 *     through" is evidence, not a capture, and `TenderAssertionResult.effect` says so
 *     in the response itself.
 *   · A success must NAME what proved it — `proofSource`. A provider's proof is a
 *     payment id; the drawer is its own proof; and an operator's word declares itself
 *     as `operator_attested` rather than passing for a capture. The database enforces
 *     the same three rules (see `70_tender.sql`), because a rule that lives only in
 *     the service is a promise and a CHECK constraint is enforcement.
 *
 * WHY `TenderProviderId` IS A SLUG AND NOT AN ENUM. §8G step 6 says a second terminal
 * brand must not touch checkout. An enum here would make a new brand a contract
 * change, a regeneration and a client release. A slug plus a registry in the API means
 * a new brand is a new adapter and one row of configuration.
 *
 * MONEY IS INTEGER MINOR UNITS everywhere in this file — `Money.minorUnits` is
 * `z.number().int().safe()`, and no amount is ever a fraction.
 */

/** An adapter identity, e.g. `cash`, `manual_terminal`, `mercado_pago_point`, `conekta`. */
export const TenderProviderId = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
export type TenderProviderId = z.infer<typeof TenderProviderId>;

/**
 * Which kind of tender a provider accepts. This is NOT `PaymentMethod` from
 * `pos-checkout.ts`: that one is the till's four-value view of how a sale was paid
 * (`cash`, `external_terminal`, `stored_value`, `gift_card`), and it is what the
 * receipt prints. This is the provider's own family, which is finer — a card can be
 * present at a terminal or not present at all — and it is what decides whether a
 * provider can serve a sale.
 */
export const TenderFamily = z.enum([
  'cash',
  'card_present',
  'card_not_present',
  'stored_value',
  'gift_card',
  /**
   * A terminal a PERSON operates and reads: the till records what the operator
   * says it did, and nothing in the platform ever asks it anything. It is a
   * family of its own rather than `card_present` for one reason that cost a
   * native run to learn: `card_present` means "a device that ANSWERS", and a
   * provider that can only ever answer `unknown` is not one. Grouped with the
   * real card integrations, it was the first available `card_present` provider
   * the till found — so the till captured against a terminal that had no order
   * and waited for an answer no device was ever going to give.
   */
  'operator_attested',
]);
export type TenderFamily = z.infer<typeof TenderFamily>;

/**
 * WHAT PROVED A SUCCESS — the question `payment_attempt_success_provenance_ck` makes
 * every success answer. Four sources, and the distinction between them is the point:
 *
 *   · `provider` — a payment id from the provider that took the money. The only source
 *     the capture adapters (Mercado Pago Point, Conekta) may write.
 *   · `cash` — the drawer, and the count that reconciles it. Cash needs no provider and
 *     never will, which is why "every success carries a provider token" was never the
 *     rule; the rule is that every success NAMES what proved it.
 *   · `internal_ledger` — our own ledger is the proof: a stored-value or gift-card
 *     redemption is authorized by the wallet's own transaction, which is verifiable by
 *     anybody, and calling that an operator's word would be a lie.
 *   · `operator_attested` — a person read a screen or was told by the customer. This is
 *     the one that is NOT a capture, and it says so in its own name.
 */
export const TenderProofSource = z.enum([
  'provider',
  'cash',
  'internal_ledger',
  'operator_attested',
]);
export type TenderProofSource = z.infer<typeof TenderProofSource>;

/** The three answers an attempt can end in. `unknown` is an ANSWER, not an error. */
export const TenderOutcomeKind = z.enum(['succeeded', 'declined', 'unknown']);
export type TenderOutcomeKind = z.infer<typeof TenderOutcomeKind>;

export const TenderOutcome = z
  .object({
    kind: TenderOutcomeKind,
    /** The provider's own status verbatim, kept for the audit trail (`action_required`). */
    providerStatus: z.string().max(120).nullable(),
    /** A machine code for a refusal, when the provider gave one. */
    code: z.string().max(80).nullable(),
    /** A sentence for the operator, when the provider gave one. Never a raw payload. */
    message: z.string().max(500).nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A declined attempt without a code could not be told apart from any other refusal,
    // which is what the Caja screen's "a failed load looked like a hang" defect was.
    if (value.kind === 'declined' && value.code === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A declined outcome must carry a code.',
      });
    }
    if (value.kind === 'succeeded' && value.providerStatus === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A succeeded outcome must carry the provider status that said so.',
      });
    }
  });
export type TenderOutcome = z.infer<typeof TenderOutcome>;

/**
 * One attempt at one tender, as the platform reads it back.
 *
 * `commandIdentity` is the identity the attempt was started with, and it is what
 * makes a retry safe: a second command with the same identity returns the FIRST
 * attempt's own outcome and does not call the provider again.
 */
export const TenderAttempt = z
  .object({
    id: Uuid,
    commandIdentity: Uuid.nullable(),
    cartId: Uuid,
    locationId: Uuid,
    /** The till's view of how this was paid; `family` is the provider's own. */
    method: PaymentMethod,
    family: TenderFamily,
    provider: TenderProviderId.nullable(),
    state: PaymentState,
    queryOnly: z.boolean(),
    amount: Money,
    providerOrderId: z.string().max(200).nullable(),
    providerPaymentId: z.string().max(200).nullable(),
    providerStatus: z.string().max(120).nullable(),
    proofSource: TenderProofSource.nullable(),
    correlationId: CorrelationId,
    /** When an unresolved attempt should next be asked about (the terminal's own 40s rule). */
    queryAfter: IsoTimestamp.nullable(),
    expiresAt: IsoTimestamp.nullable(),
    createdAt: IsoTimestamp,
    resolvedAt: IsoTimestamp.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.state === 'unknown' || value.state === 'timeout') && !value.queryOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An unresolved outcome must be query-only: it can be asked about, never retried.',
      });
    }
    // The same rule as `payment_attempt_success_provenance_ck`, stated for readers of
    // the API: a success names its proof.
    if (value.state === 'succeeded' && value.proofSource === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A succeeded attempt must name the proof that made it a success.',
      });
    }
    // …and the harder half of it: proof a provider gave us IS a payment id.
    if (value.proofSource === 'provider' && value.providerPaymentId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provider proof is a payment id; an operator attestation is not one.',
      });
    }
    if (value.proofSource === 'provider' && value.provider === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provider proof requires the provider that gave it.',
      });
    }
    // NOT a rule, deliberately: "a success through a provider adapter is never an operator
    // attestation". It looks like the ADR's last sentence, and it is wrong — the MANUAL
    // TERMINAL is a tender whose resolver IS a person (`ManualTerminalProvider` answers
    // `unknown` forever, because the card machine is outside our integration), so its
    // settlement is legitimately `operator_attested` against a real provider slug, and a
    // rule forbidding that would make a manual terminal unsettleable. What actually keeps
    // the ADR's promise is two things already enforced above and in SQL: the CAPTURE path
    // cannot produce `operator_attested` at all (`fromProviderOutcome` is property-tested
    // never to), and provider proof must BE a payment id.
  });
export type TenderAttempt = z.infer<typeof TenderAttempt>;

/**
 * Start an attempt. The attempt is persisted BEFORE the provider is called, so a
 * crash or a transport failure leaves a record to query rather than a mystery.
 *
 * `tenderId` is the tender draft's own id — the money this attempt is trying to
 * collect — and it is what lets the commit link the attempt to the tender it paid.
 */
export const TenderCaptureRequest = z
  .object({
    cartId: Uuid,
    tenderId: Uuid,
    locationId: Uuid,
    operatorSessionId: Uuid,
    commandIdentity: Uuid,
    provider: TenderProviderId,
    amount: Money.refine((value) => value.minorUnits > 0, 'A capture amount must be positive.'),
    idempotencyKey: Uuid,
  })
  .strict();
export type TenderCaptureRequest = z.infer<typeof TenderCaptureRequest>;

export const TenderCaptureResult = z
  .object({
    attempt: TenderAttempt,
    outcome: TenderOutcome,
    ambiguity: PaymentAmbiguity.nullable(),
    /**
     * True when this request found an attempt already recorded for its command
     * identity and returned that attempt instead of starting a new one. This is the
     * observable half of "a retried payment never charges twice".
     */
    idempotentReplay: z.boolean(),
    /** Whether THIS request was the one that reached the provider. False on any replay. */
    providerCalled: z.boolean(),
    capturedAt: IsoTimestamp,
  })
  .strict();
export type TenderCaptureResult = z.infer<typeof TenderCaptureResult>;

export const TenderAttemptQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    /**
     * Ask the provider what happened, rather than reading what we last knew. An
     * unresolved attempt is a question waiting to be asked; this is the asking.
     */
    refresh: z
      .preprocess(
        (value) => (value === 'true' ? true : value === 'false' ? false : value),
        z.boolean(),
      )
      .default(false),
  })
  .strict();
export type TenderAttemptQuery = z.infer<typeof TenderAttemptQuery>;

export const TenderAttemptResult = z
  .object({
    attempt: TenderAttempt,
    outcome: TenderOutcome.nullable(),
    ambiguity: PaymentAmbiguity.nullable(),
    providerAsked: z.boolean(),
    /** True when asking changed what we know — the unresolved became resolved. */
    resolvedNow: z.boolean(),
  })
  .strict();
export type TenderAttemptResult = z.infer<typeof TenderAttemptResult>;

/**
 * What an operator may assert about an attempt. Every member of this enum is
 * something a person saw or was told — none of them is a provider's answer.
 */
export const TenderOperatorAssertion = z.enum([
  'customer_reports_paid',
  'terminal_screen_shows_paid',
  'receipt_shown',
]);
export type TenderOperatorAssertion = z.infer<typeof TenderOperatorAssertion>;

export const TenderAssertionRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    assertion: TenderOperatorAssertion,
    note: z.string().trim().max(500).nullable().default(null),
    idempotencyKey: Uuid,
  })
  .strict();
export type TenderAssertionRequest = z.infer<typeof TenderAssertionRequest>;

/**
 * The answer to an assertion, and the whole point of this model: `effect` is
 * `none`. The attempt is returned UNCHANGED — still unknown, still query-only — and
 * the assertion is recorded as evidence. There is deliberately no field here that a
 * caller could mistake for a capture, because a capture is only ever a provider's.
 */
export const TenderAssertionResult = z
  .object({
    attempt: TenderAttempt,
    assertion: TenderOperatorAssertion,
    note: z.string().nullable(),
    effect: z.literal('none'),
    recordedAt: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type TenderAssertionResult = z.infer<typeof TenderAssertionResult>;

/**
 * A SETTLEMENT — the difference between an operator's belief and an operator's
 * decision, and the route that was missing.
 *
 * `TenderAssertionResult` above records what a person SAW and changes nothing.
 * That is right while the question is still open, and it is not enough once
 * nobody else can answer it: a manual terminal has no adapter to ask, so when the
 * screen has moved on and the customer has gone with it, the person who was
 * standing there is the only witness there will ever be. Without a way to turn
 * that witness into a final state, an attempt stays unresolved for good — its
 * tender cannot be dropped from the checkout draft, the cart can be neither paid
 * nor cancelled, and every route refuses it. That is not a description of a risk:
 * it is what happened to a cart in the rehearsal, and it left the till unable to
 * take money on that sale and the operator unable to leave the screen.
 *
 * So this one DOES move the attempt, and it says what moved it: `proofSource` is
 * the literal `operator_attested`, never `provider`. A provider's proof is a
 * payment id, and no amount of certainty in a human voice can manufacture one —
 * the database enforces the same distinction
 * (`payment_attempt_provider_proof_has_id_ck`).
 */
export const TenderSettlementOutcome = z.enum(['paid', 'not_paid']);
export type TenderSettlementOutcome = z.infer<typeof TenderSettlementOutcome>;

/**
 * What the operator SAW that produced the settlement. Every member is something a
 * person observed — none of them is a provider's answer, and `paid` is not
 * available to `receipt_shown` alone in the service, because a receipt proves a
 * printer worked, not that money moved.
 */
export const TenderSettlementEvidence = z.enum([
  'terminal_screen_shows_paid',
  'terminal_screen_shows_declined',
  'receipt_shown',
  'customer_reports_paid',
  'customer_reports_declined',
]);
export type TenderSettlementEvidence = z.infer<typeof TenderSettlementEvidence>;

export const TenderSettlementRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    outcome: TenderSettlementOutcome,
    evidence: TenderSettlementEvidence,
    note: z.string().trim().max(500).nullable().default(null),
    idempotencyKey: Uuid,
  })
  .strict();
export type TenderSettlementRequest = z.infer<typeof TenderSettlementRequest>;

export const TenderSettlementResult = z
  .object({
    attempt: TenderAttempt,
    outcome: TenderSettlementOutcome,
    /** Always `operator_attested`: what settled this was a person, and it says so. */
    proofSource: z.literal('operator_attested'),
    evidence: TenderSettlementEvidence,
    note: z.string().nullable(),
    /** The state the attempt had BEFORE this settled it, kept for the audit trail. */
    previousState: z.string().min(1).max(40),
    settledAt: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type TenderSettlementResult = z.infer<typeof TenderSettlementResult>;

/**
 * ASK THE TERMINAL TO GIVE MONEY BACK — plan §4 Phase 4, and D6's "a refund is its
 * own command, with its own attempt".
 *
 * THE REFUND IS NOT A MUTATION OF THE SALE. It is a second act with its own amount,
 * its own command identity and its own answer from the vendor, recorded as its own
 * attempt linked to the capture it gives back. That is why it carries an
 * `attemptId` rather than a sale id: what is being refunded is a capture, and a
 * capture is the thing that has a payment id at the terminal — which is what a
 * partial refund needs (`transactions.payments[].id`, research note 01 §4.3), and
 * the reason the plan has the till save both ids in the first place.
 *
 * `amount` is what to give back, in integer minor units, and it is always explicit:
 * the vendor distinguishes a total refund (no body at all) from a partial one (a
 * body naming the payment and the amount), and the transport makes that choice from
 * whether `amount` equals what was captured — the caller says how much, not which
 * kind.
 */
export const TenderRefundRequest = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    /** The capture attempt being given back. */
    attemptId: Uuid,
    /** This refund's own identity: a retry reuses it and reaches the same refund. */
    commandIdentity: Uuid,
    amount: Money.refine((value) => value.minorUnits > 0, 'A refund amount must be positive.'),
    idempotencyKey: Uuid,
  })
  .strict();
export type TenderRefundRequest = z.infer<typeof TenderRefundRequest>;

export const TenderRefundResult = z
  .object({
    /** The refund is its OWN attempt (D6): its own id, its own amount, its own answer. */
    refundAttempt: TenderAttempt,
    outcome: TenderOutcome,
    /** The vendor's refund id, when it answered with one. This is a refund's proof. */
    providerRefundId: z.string().min(1).max(120).nullable(),
    /**
     * What the customer ACTUALLY paid, when the terminal said: the ceiling a refund
     * is measured against, because the terminal can add a tip and `paid_amount` can
     * exceed the amount we asked for (research note 01 §2.2).
     */
    paidAmountMinorUnits: z.number().int().nonnegative().nullable(),
    /** True when this request found the refund already recorded and returned it. */
    idempotentReplay: z.boolean(),
    requestedAt: IsoTimestamp,
    correlationId: CorrelationId,
  })
  .strict();
export type TenderRefundResult = z.infer<typeof TenderRefundResult>;

export const TenderProviderQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
  })
  .strict();
export type TenderProviderQuery = z.infer<typeof TenderProviderQuery>;

export const TenderProviderOption = z
  .object({
    id: TenderProviderId,
    family: TenderFamily,
    /**
     * Whether this deployment can actually reach the provider. A method offered
     * without credentials is a button that fails after the customer has decided.
     */
    available: z.boolean(),
    /** Why it is not available, when it is not. Never a credential. */
    unavailableReason: z.string().max(200).nullable(),
  })
  .strict();
export type TenderProviderOption = z.infer<typeof TenderProviderOption>;

export const TenderProviderList = z
  .object({
    providers: z.array(TenderProviderOption).max(20),
  })
  .strict();
export type TenderProviderList = z.infer<typeof TenderProviderList>;

// ── The fiscal record ────────────────────────────────────────────────────────

/**
 * Which clock a fiscal document runs on. The SAT gives 24 hours from the OPERATION
 * for a per-ticket CFDI, and 24 hours after the PERIOD closes for a factura global —
 * so a café that invoices in the aggregate has a different clock than one that stamps
 * per ticket, and the owner has to be able to see which one is running.
 */
export const CfdiDeadlineKind = z.enum(['operation', 'period_close']);
export type CfdiDeadlineKind = z.infer<typeof CfdiDeadlineKind>;

/** SAT c_FormaPago, the two digits the PAC requires ('01' efectivo, '04' crédito, '28' débito). */
export const CfdiPaymentForm = z.string().regex(/^\d{2}$/);
export type CfdiPaymentForm = z.infer<typeof CfdiPaymentForm>;

/** SAT c_MetodoPago: PUE (payment in one exhibition) or PPD (deferred). */
export const CfdiPaymentMethod = z.enum(['PUE', 'PPD']);
export type CfdiPaymentMethod = z.infer<typeof CfdiPaymentMethod>;

/**
 * The platform's own fiscal record: the CFDI as OUR state machine holds it.
 *
 * It extends `CfdiDocument` — the PAC's view — with the facts the PAC does not own:
 * the deadline and which clock it runs on, the SAT payment form and method the
 * auditor asks for, the PAC's invoice id (needed to cancel), and the cancellation's
 * motive. The UUID, the RFC, the payment form and the payment method are stored ON
 * THE SALE in the sense the ADR means, because this row IS the fiscal lens on a sale:
 * duplicating them onto the order would create a second copy that can disagree.
 */
export const FiscalDocument = CfdiDocument.extend({
  locationId: Uuid,
  deadlineAt: IsoTimestamp,
  deadlineKind: CfdiDeadlineKind,
  paymentForm: CfdiPaymentForm.nullable(),
  paymentMethod: CfdiPaymentMethod.nullable(),
  /** The PAC's own document id; without it a stamped document cannot be cancelled. */
  providerDocumentId: z.string().max(200).nullable(),
  cancelledAt: IsoTimestamp.nullable(),
  cancellationMotive: z.enum(['01', '02', '03', '04']).nullable(),
  cancellationReason: z.string().max(500).nullable(),
  /**
   * Whether cancelling this document needs the receiver's acceptance.
   *
   * It is on the model rather than computed by each reader because the answer is a SAT rule
   * about the TOTAL, and a screen that recomputed it would be a second opinion about a
   * fiscal threshold. The SAT lets the issuer cancel without the receiver's acceptance at up
   * to $1,000 MXN, which is most café tickets: the operator needs to know whether pressing
   * cancel finishes the job or starts a wait for the customer.
   */
  needsReceiverAcceptance: z.boolean(),
})
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === 'stamped' && (value.uuid === null || value.issuedAt === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A stamped document carries a UUID and its stamping time.',
      });
    }
    if (
      value.status === 'cancelled' &&
      (value.cancelledAt === null || value.cancellationMotive === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A cancelled document records when and why it was cancelled.',
      });
    }
    // The factura global's receptor is público en general. A global document carrying a
    // named customer is a modelling error, and the SAT rejects it.
    if (value.kind === 'global' && value.receptorRfc !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A global document aggregates public sales and has no named receptor.',
      });
    }
  });
export type FiscalDocument = z.infer<typeof FiscalDocument>;

/**
 * Ask for a nominative CFDI on a committed sale. The sale is identified the way the
 * rest of the platform identifies it — by its CART id — so this is the fiscal lens on
 * the sale the till just committed, not a parallel notion of "sale".
 */
export const FiscalStampSaleRequest = CfdiStampRequest.extend({
  locationId: Uuid,
  operatorSessionId: Uuid,
  paymentForm: CfdiPaymentForm,
  paymentMethod: CfdiPaymentMethod.default('PUE'),
  deadlineKind: CfdiDeadlineKind.default('operation'),
  idempotencyKey: Uuid,
}).strict();
export type FiscalStampSaleRequest = z.infer<typeof FiscalStampSaleRequest>;

export const FiscalStampSaleResult = z
  .object({
    document: FiscalDocument,
    /** True when the stamping already happened for this sale and was not attempted again. */
    idempotentReplay: z.boolean(),
  })
  .strict();
export type FiscalStampSaleResult = z.infer<typeof FiscalStampSaleResult>;

export const FiscalDocumentQuery = z
  .object({
    locationId: Uuid,
    operatorSessionId: Uuid,
    status: z
      .enum(['not_invoiced', 'pending_self_invoice', 'in_global', 'stamped', 'cancelled', 'error'])
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type FiscalDocumentQuery = z.infer<typeof FiscalDocumentQuery>;

/**
 * The owner's view of the fiscal clock: every document still inside its deadline, and
 * the count of the ones that are not. "Visible rather than implied" is §8G step 5's
 * own sentence, and this is the model that makes it visible.
 */
export const FiscalDocumentList = z
  .object({
    documents: z.array(FiscalDocument).max(200),
    counts: z
      .object({
        total: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        stamped: z.number().int().nonnegative(),
        cancelled: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        withinDeadline: z.number().int().nonnegative(),
        pastDeadline: z.number().int().nonnegative(),
      })
      .strict(),
    /** The trading day the deadline is measured against, for the reader's benefit. */
    businessDate: MerchantDate,
  })
  .strict();
export type FiscalDocumentList = z.infer<typeof FiscalDocumentList>;

export const tenderModels = {
  TenderProviderId,
  TenderFamily,
  TenderProofSource,
  TenderOutcomeKind,
  TenderOutcome,
  TenderAttempt,
  TenderCaptureRequest,
  TenderCaptureResult,
  TenderAttemptQuery,
  TenderAttemptResult,
  TenderOperatorAssertion,
  TenderAssertionRequest,
  TenderAssertionResult,
  TenderSettlementOutcome,
  TenderSettlementEvidence,
  TenderSettlementRequest,
  TenderSettlementResult,
  TenderRefundRequest,
  TenderRefundResult,
  TenderProviderQuery,
  TenderProviderOption,
  TenderProviderList,
  CfdiDeadlineKind,
  CfdiPaymentForm,
  CfdiPaymentMethod,
  FiscalDocument,
  FiscalStampSaleRequest,
  FiscalStampSaleResult,
  FiscalDocumentQuery,
  FiscalDocumentList,
} as const;
