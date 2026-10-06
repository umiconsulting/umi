import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ambiguityFor,
  classifyTerminalStatus,
  familyForStoredAttempt,
  fiscalDeadline,
  fromProviderOutcome,
  methodForFamily,
  needsReceiverAcceptance,
} from './tender-domain';
import type { ProviderOutcome } from './tender-provider.port';

/**
 * §8G step 7's property test, and the arithmetic of an attempt.
 *
 * THE PROPERTIES ARE THE POINT, not the examples. §8G asks for "a property test for the
 * tender arithmetic" because the failure this workstream is about is a state that is
 * reachable from ONE unconsidered combination — a terminal that says `processed` without
 * a payment id, a status nobody has seen, a family nobody mapped. Examples test the
 * combinations somebody thought of; the generators below are how the ones nobody thought
 * of get tried.
 *
 * The three properties that matter most, each stated as a sentence:
 *
 *   1. A success with PROVIDER proof always carries a payment id.
 *   2. No provider answer ever produces a `succeeded` state resting on an operator, and
 *      the capture path can NEVER write `operator_attested` — a human's word is not
 *      something an adapter may produce.
 *   3. Every unresolved state is query-only and can never be retried as a new payment.
 */

const FAMILIES = ['cash', 'card_present', 'card_not_present', 'stored_value', 'gift_card'] as const;

const arbitraryOutcome = (): fc.Arbitrary<ProviderOutcome> =>
  fc.oneof(
    fc.record({
      kind: fc.constant('succeeded' as const),
      providerStatus: fc.string({ minLength: 1, maxLength: 40 }),
      providerOrderId: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
      providerPaymentId: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
    }),
    fc.record({
      kind: fc.constant('declined' as const),
      providerStatus: fc.string({ minLength: 1, maxLength: 40 }),
      code: fc.string({ minLength: 1, maxLength: 40 }),
      message: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
      providerOrderId: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
    }),
    fc.record({
      kind: fc.constant('unknown' as const),
      providerStatus: fc.string({ minLength: 1, maxLength: 40 }),
      code: fc.option(fc.string({ minLength: 1, maxLength: 60 }), { nil: null }),
      message: fc.option(fc.string({ maxLength: 100 }), { nil: null }),
      providerOrderId: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
      queryAfterSeconds: fc.integer({ min: 0, max: 3600 }),
    }),
  );

describe('the arithmetic of an attempt (§8G step 7)', () => {
  it('is TOTAL — every provider answer, in every family, resolves to a state', () => {
    fc.assert(
      fc.property(arbitraryOutcome(), fc.constantFrom(...FAMILIES), (outcome, family) => {
        const resolved = fromProviderOutcome(outcome, family);
        expect(['succeeded', 'declined', 'unknown', 'timeout']).toContain(resolved.state);
        // And a resolved outcome never carries a leftover from another branch: a success
        // has no code, a decline has no payment id.
        if (resolved.state === 'succeeded') {
          expect(resolved.code).toBeNull();
        }
        if (resolved.state === 'declined') {
          expect(resolved.providerPaymentId).toBeNull();
          expect(resolved.proofSource).toBeNull();
        }
      }),
      { numRuns: 500 },
    );
  });

  it('never records a success with PROVIDER proof but no payment id', () => {
    fc.assert(
      fc.property(arbitraryOutcome(), fc.constantFrom(...FAMILIES), (outcome, family) => {
        const resolved = fromProviderOutcome(outcome, family);
        if (resolved.proofSource === 'provider') {
          expect(resolved.providerPaymentId).not.toBeNull();
          expect(resolved.providerPaymentId).not.toBe('');
          expect(resolved.state).toBe('succeeded');
        }
        // The downgrade itself: a non-cash success without a payment id is an unknown
        // that can be queried, and it says why in the record.
        if (
          outcome.kind === 'succeeded' &&
          family !== 'cash' &&
          (outcome.providerPaymentId === null || outcome.providerPaymentId === '')
        ) {
          expect(resolved.state).toBe('unknown');
          expect(resolved.downgradedBecause).toBe('provider_proof_missing');
          expect(resolved.proofSource).toBeNull();
        }
      }),
      { numRuns: 500 },
    );
  });

  it('NEVER produces an operator attestation — a capture adapter cannot speak for a person', () => {
    fc.assert(
      fc.property(arbitraryOutcome(), fc.constantFrom(...FAMILIES), (outcome, family) => {
        // This is the structural half of the ADR's last sentence. The only writers of
        // `operator_attested` are the checkout's manual-terminal path and the assertion
        // route, neither of which goes through this function.
        expect(fromProviderOutcome(outcome, family).proofSource).not.toBe('operator_attested');
      }),
      { numRuns: 500 },
    );
  });

  it('gives cash the drawer as its proof, whatever the provider echoed', () => {
    fc.assert(
      fc.property(arbitraryOutcome(), (outcome) => {
        const resolved = fromProviderOutcome(outcome, 'cash');
        if (resolved.state === 'succeeded') {
          // The invariant is the PROOF SOURCE, not the absence of a reference: cash's
          // success rests on the drawer and says so. A provider id echoed alongside it is
          // a reference, and `payment_attempt_provider_proof_has_id_ck` constrains only
          // the rows that claim provider proof.
          expect(resolved.proofSource).toBe('cash');
          expect(resolved.proofSource).not.toBe('provider');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('treats an unrecognised terminal status as unknown, never as a decline', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 40 })
          .filter(
            (status) =>
              ![
                'processed',
                'refunded',
                'partially_refunded',
                'failed',
                'canceled',
                'expired',
                'created',
                'at_terminal',
                'action_required',
              ].includes(status),
          ),
        (status) => {
          const outcome = classifyTerminalStatus({ status });
          expect(outcome.kind).toBe('unknown');
          if (outcome.kind === 'unknown') {
            expect(outcome.code).toBe('TERMINAL_STATUS_UNRECOGNIZED');
            // A status we have never seen must never be read as the customer's failure.
            expect(classifyTerminalStatus({ status }).kind).not.toBe('declined');
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('maps the terminal flow to the three outcomes the ADR names', () => {
    expect(classifyTerminalStatus({ status: 'processed', paymentId: 'pay_1' })).toEqual({
      kind: 'succeeded',
      providerStatus: 'processed',
      providerOrderId: null,
      providerPaymentId: 'pay_1',
      // The payment's own facts ride along on every answer that has an order behind it,
      // and null here is "the terminal did not say", not zero (§4 Phase 4 step 3).
      paidAmountMinorUnits: null,
      tipAmountMinorUnits: null,
    });
    expect(classifyTerminalStatus({ status: 'failed', failureCode: 'FUNDS' })).toMatchObject({
      kind: 'declined',
      code: 'FUNDS',
    });
    // `action_required` is the status the ADR defines in the terminal's own words: it did
    // not answer within 40 seconds and the status does not change.
    expect(classifyTerminalStatus({ status: 'action_required' })).toMatchObject({
      kind: 'unknown',
      code: 'TERMINAL_ACTION_REQUIRED',
      queryAfterSeconds: 40,
    });
    expect(classifyTerminalStatus({ status: 'at_terminal' })).toMatchObject({ kind: 'unknown' });
    expect(classifyTerminalStatus({ status: 'canceled' })).toMatchObject({ kind: 'declined' });
    expect(classifyTerminalStatus({ status: 'expired' })).toMatchObject({ kind: 'declined' });
  });

  it('reads a refunded order as the capture it proves, never as an unknown', () => {
    // Phase 4 of the Point plan. `refunded` is an order STATUS and `partially_refunded` is
    // an order DETAIL, and the two vocabularies overlap — which is exactly how a captured
    // sale ends up in the `default` branch and reads as "we have never seen this". A
    // refunded sale is an answered question: the money moved, and the giving-back has its
    // own attempt.
    expect(classifyTerminalStatus({ status: 'refunded', paymentId: 'pay_1' })).toEqual({
      kind: 'succeeded',
      providerStatus: 'refunded',
      providerOrderId: null,
      providerPaymentId: 'pay_1',
      paidAmountMinorUnits: null,
      tipAmountMinorUnits: null,
    });
    expect(
      classifyTerminalStatus({
        status: 'processed',
        statusDetail: 'partially_refunded',
        paymentId: 'pay_1',
      }),
    ).toMatchObject({ kind: 'succeeded', providerPaymentId: 'pay_1' });
    expect(
      classifyTerminalStatus({
        status: 'partially_refunded',
        statusDetail: 'partially_refunded',
        paymentId: 'pay_1',
      }),
    ).toMatchObject({ kind: 'succeeded' });
    // And the detail is read even when the status is one this version does not know.
    expect(
      classifyTerminalStatus({ status: 'something_new', statusDetail: 'refunded', paymentId: 'p' }),
    ).toMatchObject({ kind: 'succeeded' });
    // A refunded order with no payment id is still proof-less, and property 2 downgrades
    // it — the same rule that governs every other capture.
    expect(classifyTerminalStatus({ status: 'refunded' })).toMatchObject({
      kind: 'succeeded',
      providerPaymentId: null,
    });
  });

  it('rounds NO money, because there is no money arithmetic to round', () => {
    // The amounts in this increment are carried, never computed: a capture stores the
    // integer the caller gave and the provider echoes. This property is the guard that
    // says so — every family maps to a method and back without touching a number.
    fc.assert(
      fc.property(fc.constantFrom(...FAMILIES), (family) => {
        expect(['cash', 'external_terminal', 'stored_value', 'gift_card']).toContain(
          methodForFamily(family),
        );
        const mappedBack = familyForStoredAttempt(methodForFamily(family), family);
        expect(mappedBack).toBe(family);
      }),
      { numRuns: 100 },
    );
  });

  it('always reads a family back from a stored attempt, including the legacy rows', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('cash', 'external_terminal', 'stored_value', 'gift_card'),
        fc.constantFrom(...FAMILIES),
        fc.boolean(),
        (method, family, known) => {
          const resolved = familyForStoredAttempt(method, known ? family : null);
          expect(FAMILIES).toContain(resolved);
          if (known) expect(resolved).toBe(family);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('makes every unresolved state query-only and impossible to retry as new', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('unknown' as const, 'timeout' as const),
        fc.option(fc.integer({ min: 0, max: 3600 }), { nil: null }),
        // Timestamps as integers, not `fc.date`: a bounded date generator can hand back
        // an Invalid Date, and a property about arithmetic must not be defeated by its
        // own input generator.
        fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2026, 11, 31) }),
        (state, queryAfterSeconds, nowMs) => {
          const now = new Date(nowMs);
          const ambiguity = ambiguityFor({
            id: 'attempt-1',
            state,
            correlationId: 'corr-1',
            queryAfterSeconds,
            now,
          });
          expect(ambiguity).not.toBeNull();
          expect(ambiguity?.queryOnly).toBe(true);
          expect(ambiguity?.canRetryAsNew).toBe(false);
          expect(ambiguity?.status).toBe('unknown');
          if (queryAfterSeconds === null) {
            expect(ambiguity?.queryAfter).toBeNull();
          } else {
            expect(new Date(ambiguity!.queryAfter!).getTime()).toBe(
              now.getTime() + queryAfterSeconds * 1000,
            );
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('has no ambiguity at all for a settled attempt', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('succeeded' as const, 'declined' as const, 'cancelled' as const),
        (state) => {
          expect(
            ambiguityFor({
              id: 'attempt-1',
              state,
              correlationId: 'corr-1',
              queryAfterSeconds: 40,
              now: new Date(),
            }),
          ).toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('the fiscal clock (§8G step 5)', () => {
  it('is exactly 24 hours from the operation, or from the period close', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2026, 11, 31) }),
        // A period closes AFTER the operation it contains, so the generator says so: the
        // interesting property is not "any two dates" but "the aggregate clock is never
        // earlier than the per-ticket one when both measure the same sale".
        fc.integer({ min: 0, max: 30 * 24 * 60 * 60 * 1000 }),
        (operationMs, closeOffsetMs) => {
          const operationAt = new Date(operationMs);
          const periodCloseAt = new Date(operationAt.getTime() + closeOffsetMs);
          const perTicket = fiscalDeadline('operation', operationAt, null);
          expect(perTicket.getTime() - operationAt.getTime()).toBe(24 * 60 * 60 * 1000);

          const global = fiscalDeadline('period_close', operationAt, periodCloseAt);
          expect(global.getTime() - periodCloseAt.getTime()).toBe(24 * 60 * 60 * 1000);
          expect(global.getTime()).toBeGreaterThanOrEqual(perTicket.getTime());
        },
      ),
      { numRuns: 500 },
    );
  });

  it('falls back to the operation when a period-close deadline has no period', () => {
    // Defensive, and the reason is worth stating: `deadline_at` is NOT NULL in the
    // database, so a caller that asks for the aggregate clock without a close date must
    // still get a real instant rather than an unrepresentable one.
    const operationAt = new Date('2026-09-16T18:00:00.000Z');
    expect(fiscalDeadline('period_close', operationAt, null).toISOString()).toBe(
      '2026-09-17T18:00:00.000Z',
    );
  });

  it('needs the receiver\u2019s acceptance only above the SAT\u2019s threshold', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (totalMinorUnits) => {
        expect(needsReceiverAcceptance(totalMinorUnits)).toBe(totalMinorUnits > 100_000);
      }),
      { numRuns: 300 },
    );
    // $1,000 MXN is 100,000 minor units, and the boundary is inclusive on the side that
    // lets an operator finish: a ticket of exactly $1,000 cancels without asking.
    expect(needsReceiverAcceptance(100_000)).toBe(false);
    expect(needsReceiverAcceptance(100_001)).toBe(true);
  });
});
