import {
  PaymentState as PaymentStateSchema,
  type PaymentAmbiguity,
  type TenderProofSource,
} from '@umi/contract';
import type { z } from 'zod';
import type { PointOrderSnapshot } from './point-transport.port';
import type { ProviderOutcome } from './tender-provider.port';
import type { ProviderRefundOutcome } from './tender-provider.port';

/**
 * The contract exports `PaymentState` as a schema AND as `z.infer` of it, but the API
 * resolves only the value, so a `import type { PaymentState }` here fails with TS2749
 * ("refers to a value"). Deriving the type from the schema is the convention the rest of
 * this codebase already uses — see `platform-elevation.controller.ts` and
 * `dashboard-catalog.controller.ts`, both `z.infer<typeof X>`.
 */
export type PaymentState = z.infer<typeof PaymentStateSchema>;

/**
 * THE PURE PART OF THE TENDER PATH — every decision that must be identical whether it
 * was made from a live terminal, a scripted fake, or a replay. No database, no clock,
 * no Nest: `tender-domain.spec.ts` drives these with `fast-check`, which is §8G step 7's
 * property test and the reason a wrong mapping fails a test instead of taking money.
 *
 * THE THREE TOTALS THIS FILE GUARANTEES, and each one is a property below rather than
 * a comment:
 *
 *   1. `fromProviderOutcome` is TOTAL. Every outcome, every family, and every field
 *      combination resolves to a state — there is no input that returns nothing and
 *      no input that throws.
 *   2. It can NEVER produce a capture without proof. A non-cash success that arrived
 *      without a payment id is DOWNGRADED to unknown, because a success we cannot
 *      point at is exactly the assertion-wearing-a-provider's-clothes this workstream
 *      exists to prevent.
 *   3. An unresolved state is ALWAYS query-only, and `ambiguityFor` can never offer to
 *      retry it as a new payment.
 */

/** What the terminal's own status means to us. The one place a status is interpreted. */
export function classifyTerminalStatus(snapshot: {
  readonly status: string;
  readonly statusDetail?: string | null;
  readonly paymentId?: string | null;
  readonly failureCode?: string | null;
  readonly orderId?: string | null;
  /** What the customer actually paid, when the terminal said. A tip raises it. */
  readonly paidAmountMinorUnits?: number | null;
  /** The tip the terminal added, when it added one. */
  readonly tipAmountMinorUnits?: number | null;
}): ProviderOutcome {
  const providerStatus = snapshot.status;
  const providerOrderId = snapshot.orderId ?? null;
  const paymentId = snapshot.paymentId ?? null;
  const statusDetail = snapshot.statusDetail ?? null;
  // The payment's own facts travel with EVERY branch that has an order behind it:
  // they are what a refund is measured against (§4 Phase 4 step 3), and they cannot
  // be recovered from the vendor later than three months (note 01 §2.1).
  const money = {
    paidAmountMinorUnits: snapshot.paidAmountMinorUnits ?? null,
    tipAmountMinorUnits: snapshot.tipAmountMinorUnits ?? null,
  };

  switch (providerStatus) {
    case 'processed':
      // The terminal says it took the money. Without a payment id this is not a
      // capture — see property 2 — and `fromProviderOutcome` is what applies that.
      //
      // `status_detail = partially_refunded` is the SAME answer, not a different one: the
      // capture happened and part of it was given back, which the vendor reports in the
      // detail because `partially_refunded` is not in the status enum. Reading it as an
      // unrecognised status would turn a captured sale into an unknown.
      return {
        kind: 'succeeded',
        providerStatus,
        providerOrderId,
        providerPaymentId: paymentId,
        ...money,
      };
    case 'refunded':
    case 'partially_refunded':
      // The money moved and came back. The SALE is still a capture — it was taken, and
      // the row that holds it must not read as an unknown, because an unknown is a
      // question and this is an answer. The giving-back is its own act with its own
      // attempt (plan D6) and its own amount, which is why nothing about it is written
      // here beyond the outcome it proves.
      return {
        kind: 'succeeded',
        providerStatus,
        providerOrderId,
        providerPaymentId: paymentId,
        ...money,
      };
    case 'failed':
      return {
        kind: 'declined',
        providerStatus,
        code: snapshot.failureCode ?? 'TERMINAL_REFUSED',
        message: null,
        providerOrderId,
      };
    case 'canceled':
      return {
        kind: 'declined',
        providerStatus,
        code: 'TERMINAL_CANCELED',
        message: null,
        providerOrderId,
      };
    case 'expired':
      return {
        kind: 'declined',
        providerStatus,
        code: 'TERMINAL_ORDER_EXPIRED',
        message: null,
        providerOrderId,
      };
    case 'created':
    case 'at_terminal':
      // The customer has not finished yet. It is not a failure and it is certainly
      // not a success; it is a question we keep asking.
      return {
        kind: 'unknown',
        providerStatus,
        code: 'TERMINAL_STILL_WORKING',
        message: null,
        providerOrderId,
        queryAfterSeconds: TERMINAL_ANSWER_SECONDS,
        ...money,
      };
    case 'action_required':
      // The status the ADR names, in the terminal's words: it did not answer within
      // the window and the status does not change. It must NOT be read as a failure.
      return {
        kind: 'unknown',
        providerStatus,
        code: 'TERMINAL_ACTION_REQUIRED',
        message: null,
        providerOrderId,
        queryAfterSeconds: TERMINAL_ANSWER_SECONDS,
      };
    default:
      // The detail set is easy to confuse with the status set — `partially_refunded` and
      // `refunded` appear in both vocabularies, and the vendor's own order detail list
      // contains statuses. A detail this version knows is therefore still read as the
      // capture it implies, rather than as ignorance.
      if (statusDetail === 'refunded' || statusDetail === 'partially_refunded') {
        return {
          kind: 'succeeded',
          providerStatus,
          providerOrderId,
          providerPaymentId: paymentId,
        };
      }
      // A status we have never seen. Our ignorance is not the customer's decline.
      return {
        kind: 'unknown',
        providerStatus,
        code: 'TERMINAL_STATUS_UNRECOGNIZED',
        message: `The terminal reported a status this version does not recognise: ${providerStatus}`,
        providerOrderId,
        queryAfterSeconds: TERMINAL_ANSWER_SECONDS,
      };
  }
}

/** The terminal's documented window: 40 seconds before `action_required`. */
export const TERMINAL_ANSWER_SECONDS = 40;

export interface ResolvedOutcome {
  readonly state: PaymentState;
  readonly proofSource: TenderProofSource | null;
  readonly providerStatus: string;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly code: string | null;
  readonly message: string | null;
  readonly queryAfterSeconds: number | null;
  /**
   * What the customer actually paid, and the tip the terminal added, when the
   * provider's answer carried them (plan §4 Phase 4 step 3). Recorded on the attempt
   * because the vendor's own read window is three months and a refund needs a ceiling
   * long after that.
   */
  readonly providerPaidMinorUnits: number | null;
  readonly providerTipMinorUnits: number | null;
  /**
   * Set when a provider's answer had to be downgraded. It is recorded rather than
   * swallowed, because "the terminal said processed and we did not believe it" is a
   * fact an operator debugging a missing charge needs.
   */
  readonly downgradedBecause: string | null;
}

/**
 * THE ARITHMETIC OF AN ATTEMPT'S OUTCOME. Total, and incapable of an unproven capture.
 */
export function fromProviderOutcome(
  outcome: ProviderOutcome,
  family: TenderFamilyLike,
): ResolvedOutcome {
  if (outcome.kind === 'succeeded') {
    const cash = family === 'cash';
    if (!cash && (outcome.providerPaymentId === null || outcome.providerPaymentId === '')) {
      // Property 2. A non-cash success with no payment id becomes an unknown that can
      // be queried, never a capture. `provider_proof_has_id_ck` in SQL says the same.
      return {
        state: 'unknown',
        proofSource: null,
        providerStatus: outcome.providerStatus,
        providerOrderId: outcome.providerOrderId,
        providerPaymentId: null,
        code: 'PROVIDER_SUCCESS_WITHOUT_PAYMENT_ID',
        message:
          'The provider reported a successful capture without a payment id. Nothing was recorded as captured.',
        queryAfterSeconds: TERMINAL_ANSWER_SECONDS,
        providerPaidMinorUnits: outcome.paidAmountMinorUnits ?? null,
        providerTipMinorUnits: outcome.tipAmountMinorUnits ?? null,
        downgradedBecause: 'provider_proof_missing',
      };
    }
    return {
      state: 'succeeded',
      proofSource: cash ? 'cash' : 'provider',
      providerStatus: outcome.providerStatus,
      providerOrderId: outcome.providerOrderId,
      providerPaymentId: outcome.providerPaymentId,
      code: null,
      message: null,
      queryAfterSeconds: null,
      providerPaidMinorUnits: outcome.paidAmountMinorUnits ?? null,
      providerTipMinorUnits: outcome.tipAmountMinorUnits ?? null,
      downgradedBecause: null,
    };
  }

  if (outcome.kind === 'declined') {
    return {
      state: 'declined',
      proofSource: null,
      providerStatus: outcome.providerStatus,
      providerOrderId: outcome.providerOrderId,
      providerPaymentId: null,
      code: outcome.code,
      message: outcome.message,
      queryAfterSeconds: null,
      // A decline has nothing to reconcile: no money moved, so there is nothing to
      // measure a refund against. Null is the honest answer, not zero.
      providerPaidMinorUnits: null,
      providerTipMinorUnits: null,
      downgradedBecause: null,
    };
  }

  // unknown. `timeout` when the provider never answered at all; `unknown` when it did
  // answer and the answer is not yet an outcome. Both are query-only, which is what
  // makes the distinction safe to draw at all.
  const silent =
    outcome.code === 'TERMINAL_UNREACHABLE' || outcome.code === 'PROVIDER_TRANSPORT_FAILURE';
  return {
    state: silent ? 'timeout' : 'unknown',
    proofSource: null,
    providerStatus: outcome.providerStatus,
    providerOrderId: outcome.providerOrderId,
    providerPaymentId: null,
    code: outcome.code,
    message: outcome.message,
    queryAfterSeconds: outcome.queryAfterSeconds,
    providerPaidMinorUnits: outcome.paidAmountMinorUnits ?? null,
    providerTipMinorUnits: outcome.tipAmountMinorUnits ?? null,
    downgradedBecause: null,
  };
}

type TenderFamilyLike =
  | 'cash'
  | 'card_present'
  | 'card_not_present'
  | 'stored_value'
  | 'gift_card'
  // A person operates and reads the terminal. It is NOT a card capture: see the
  // family's note in `packages/contract/src/tender.ts`.
  | 'operator_attested';

/** A provider that threw, stated as an outcome rather than as an exception. */
export function transportFailureOutcome(reason: string): ProviderOutcome {
  return {
    kind: 'unknown',
    providerStatus: 'unreachable',
    code: 'PROVIDER_TRANSPORT_FAILURE',
    message: reason,
    providerOrderId: null,
    queryAfterSeconds: TERMINAL_ANSWER_SECONDS,
  };
}

/**
 * THE ARITHMETIC OF A REFUND'S ANSWER, which is deliberately NOT the capture's.
 *
 * A capture's success is a payment id. A refund's success is a REFUND id — the vendor's
 * own handle for the money it gave back — and the two are different facts about
 * different acts, which is why this maps the refund's answer rather than pretending it
 * is a capture of a negative amount.
 *
 * A REFUND THAT IS STILL PROCESSING IS NOT MONEY THAT MOVED. The vendor's own reference
 * lists the refund status `processing` while its guide's example shows `processed`
 * (note 01 §4.2), so anything that is not a finished refund stays `unknown` and is
 * query-only — the state an operator can be told the truth about.
 */
export function fromRefundOutcome(
  outcome: ProviderRefundOutcome,
  context: { readonly providerPaymentId: string | null },
): ResolvedOutcome {
  if (outcome.kind === 'refunded') {
    // THE PROVIDER'S PROOF IS THE REFUND ID, and the row also names the payment it was
    // made against: `payment_attempt_provider_proof_has_id_ck` wants a payment id on
    // any provider-proofed row (70_tender.sql) and `73_mp_refund.sql` wants the refund
    // id on any provider-proofed REFUND. Both are true here, and both are recorded.
    return {
      state: 'succeeded',
      proofSource: 'provider',
      providerStatus: outcome.providerStatus,
      providerOrderId: null,
      providerPaymentId: context.providerPaymentId,
      code: null,
      message: null,
      queryAfterSeconds: null,
      providerPaidMinorUnits: null,
      providerTipMinorUnits: null,
      downgradedBecause: null,
    };
  }

  if (outcome.kind === 'declined') {
    return {
      state: 'declined',
      proofSource: null,
      providerStatus: outcome.providerStatus,
      providerOrderId: null,
      providerPaymentId: null,
      code: outcome.code,
      message: outcome.message,
      queryAfterSeconds: null,
      providerPaidMinorUnits: null,
      providerTipMinorUnits: null,
      downgradedBecause: null,
    };
  }

  // Still processing, or we could not reach the vendor at all. `timeout` when the
  // provider never answered, `unknown` when it answered that it is working — the same
  // distinction the capture path draws, for the same reason: both are questions, and
  // neither is a decline.
  const silent =
    outcome.code === 'TERMINAL_UNREACHABLE' || outcome.code === 'PROVIDER_TRANSPORT_FAILURE';
  return {
    state: silent ? 'timeout' : 'unknown',
    proofSource: null,
    providerStatus: outcome.providerStatus,
    providerOrderId: null,
    providerPaymentId: null,
    code: outcome.code,
    message: outcome.message,
    queryAfterSeconds: TERMINAL_ANSWER_SECONDS,
    providerPaidMinorUnits: null,
    providerTipMinorUnits: null,
    downgradedBecause: null,
  };
}

/**
 * `PaymentAmbiguity` for an unresolved attempt — or null when the attempt is settled.
 * A proposal to retry as a NEW payment is never made for an unknown: the whole point
 * is that we do not know whether the first one took.
 */
export function ambiguityFor(attempt: {
  readonly id: string;
  readonly state: PaymentState;
  readonly correlationId: string;
  readonly queryAfterSeconds: number | null;
  readonly now: Date;
}): PaymentAmbiguity | null {
  if (attempt.state !== 'unknown' && attempt.state !== 'timeout') return null;
  const queryAfter =
    attempt.queryAfterSeconds === null
      ? null
      : new Date(attempt.now.getTime() + attempt.queryAfterSeconds * 1000).toISOString();
  return {
    paymentRef: attempt.id,
    status: 'unknown',
    queryOnly: true,
    canRetryAsNew: false,
    queryAfter,
    correlationId: attempt.correlationId,
  };
}

/** What the terminal's snapshot means, given that we asked it. */
export const outcomeFromSnapshot = (snapshot: PointOrderSnapshot): ProviderOutcome =>
  classifyTerminalStatus({
    status: snapshot.status,
    statusDetail: snapshot.statusDetail ?? null,
    paymentId: snapshot.paymentId,
    failureCode: snapshot.failureCode,
    orderId: snapshot.orderId,
    // The money that actually moved, carried into the outcome so the attempt can record
    // it: a refund's ceiling is `paid_amount`, not the amount we asked for (§4 Phase 4
    // step 3), and the vendor's own read window is three months (note 01 §2.1).
    paidAmountMinorUnits: snapshot.paidAmountMinorUnits ?? null,
    tipAmountMinorUnits: snapshot.tipAmountMinorUnits ?? null,
  });

/**
 * THE FISCAL CLOCK. 24 hours from the operation for a per-ticket CFDI; 24 hours after
 * the period closes for a factura global. The deadline is always a value, never implied:
 * `FiscalDocument.deadlineAt` is non-nullable and so is the column.
 */
export const CFDI_DEADLINE_HOURS = 24;

export function fiscalDeadline(
  kind: 'operation' | 'period_close',
  operationAt: Date,
  periodCloseAt: Date | null,
): Date {
  const base = kind === 'period_close' ? (periodCloseAt ?? operationAt) : operationAt;
  return new Date(base.getTime() + CFDI_DEADLINE_HOURS * 60 * 60 * 1000);
}

/**
 * The SAT's cancellation motives, and which one a till can justify without asking for
 * more than it has. 01 needs a related CFDI's UUID, which a counter sale has no way to
 * supply, so 02 — "comprobante emitido con errores sin relación" — is the only one that
 * is always well-formed from a till. The operator may choose any of the four; this is
 * the default, not the rule.
 */
export const DEFAULT_CANCELLATION_MOTIVE = '02' as const;
export type CancellationMotive = '01' | '02' | '03' | '04';

/**
 * The SAT allows cancellation WITHOUT the receiver's acceptance when the total is up to
 * $1,000 MXN — which is most café tickets, and it is the difference between a
 * cancellation an operator can complete and one that waits on a customer.
 */
export const CANCELLATION_WITHOUT_ACCEPTANCE_MAX_MINOR_UNITS = 100_000;

export const needsReceiverAcceptance = (totalMinorUnits: number): boolean =>
  totalMinorUnits > CANCELLATION_WITHOUT_ACCEPTANCE_MAX_MINOR_UNITS;

/**
 * The till's four-value `PaymentMethod` from a provider's own family. This is the ONE
 * mapping between the two vocabularies and it exists because the receipt prints
 * `PaymentMethod` while the attempt record stores the provider's family: `cash` stays
 * cash, and every card tender — present or not — is what `external_terminal` has always
 * meant to a receipt ("a terminal that is not this device").
 */
export function methodForFamily(family: TenderFamilyLike): MethodLike {
  switch (family) {
    case 'cash':
      return 'cash';
    case 'stored_value':
      return 'stored_value';
    case 'gift_card':
      return 'gift_card';
    default:
      return 'external_terminal';
  }
}

type MethodLike = 'cash' | 'external_terminal' | 'stored_value' | 'gift_card';

/**
 * The family of an attempt read back from the database. A row written through a provider
 * adapter names its provider, so the registry answers; a row written by the till's
 * pre-existing cash and manual-terminal paths carries no provider, and its `method`
 * already says what it was — `external_terminal` has always meant "a card machine that is
 * not this device", which is a card-present tender. The mapping is total, which is what
 * matters: no attempt can read back without a family.
 */
export function familyForStoredAttempt(
  method: string,
  knownFamily: TenderFamilyLike | null,
): TenderFamilyLike {
  if (knownFamily) return knownFamily;
  switch (method) {
    case 'cash':
      return 'cash';
    case 'stored_value':
      return 'stored_value';
    case 'gift_card':
      return 'gift_card';
    default:
      return 'card_present';
  }
}
