import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  TenderAssertionRequest,
  TenderAssertionResult,
  TenderAttempt,
  TenderAttemptQuery,
  TenderAttemptResult,
  TenderCaptureRequest,
  TenderCaptureResult,
  TenderOutcome,
  TenderProviderList,
  TenderProviderQuery,
  TenderRefundRequest,
  TenderRefundResult,
  TenderSettlementRequest,
  TenderSettlementResult,
} from '@umi/contract';
import { getRequestContext, runWithRequestContext } from '../../shared/database/request-context';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import {
  ambiguityFor,
  familyForStoredAttempt,
  fromRefundOutcome,
  fromProviderOutcome,
  methodForFamily,
  TERMINAL_ANSWER_SECONDS,
  type ResolvedOutcome,
} from './tender-domain';
import { TenderProviderRegistry } from './tender-provider.registry';
import type { ProviderOutcome, TenderProviderPort } from './tender-provider.port';
import type { ProviderRefundOutcome, ProviderRefundRequest } from './tender-provider.port';
import type { TenderAttemptRow } from './tender.repository';
import { TenderRepository } from './tender.repository';

/**
 * THE TENDER PATH — §8G steps 2, 3 and 7, and the invariants of the tender ADR.
 *
 * THE ORDER OF OPERATIONS IS THE DESIGN, so it is written out here rather than
 * discovered by reading four methods:
 *
 *   1. The attempt is PERSISTED, in its own committed command, before anything is asked
 *      of a provider. From that moment the attempt exists and can be found.
 *   2. The right to call the provider is CLAIMED — a single `update ... where
 *      provider_capture_at is null` — before the call. Whoever wins the claim is the only
 *      caller; a replay, a second tab and a retry after a crash all lose it and read
 *      instead. That is what makes "a retried payment never charges twice" a fact in the
 *      row rather than a promise in a service.
 *   3. The provider is asked OUTSIDE any transaction, so a crash cannot roll the attempt
 *      away along with the call.
 *   4. The answer is recorded in a second command, which is MONOTONIC: an attempt that
 *      already succeeded, declined or was cancelled is never rewritten — with one
 *      deliberate exception, a decline a later query proves was captured, because money
 *      that moved must be recorded.
 *
 * WHY THE START IS NOT ONE COMMAND WITH THE PROVIDER CALL INSIDE IT. A provider call
 * inside the transaction that created the attempt means a process killed mid-call rolls
 * the attempt back, and the retry then starts a SECOND attempt against a provider that may
 * already be holding the customer's money. The extra transaction is the price of that
 * never being possible. It is not free: a crash between the claim and the answer leaves an
 * attempt that has to be asked about, which is exactly why the query route exists.
 *
 * WHAT THIS SERVICE CANNOT DO, said out loud because the acceptance does not require it: it
 * does not compare the capture amount against the cart's tax-inclusive due. That arithmetic
 * belongs to `checkout-calculator`, which the commit already applies, and a second
 * implementation here would be a second answer that can disagree with the first. The money
 * guarantee this model provides is about the ATTEMPT'S IDENTITY, not its amount: one
 * identity cannot reach the provider twice. A wrong amount is refused by the commit's
 * existing tender checks (`REMAINING_BALANCE`, `TENDER_OVERALLOCATION`).
 */
/**
 * The attempt states that are FINAL: money either moved, moved and came back, or
 * never moved, and every one of them was decided by something other than a
 * pending question. A settlement may only be applied to an attempt that is not
 * here, which is what makes a retried settlement answer with the existing state
 * instead of rewriting whether money moved.
 */
const FINISHED_ATTEMPT_STATES: ReadonlySet<string> = new Set([
  'succeeded',
  'declined',
  'cancelled',
]);

/**
 * The permission a terminal refund demands — and it is NOT a new key.
 *
 * A card tender is `manual_terminal` on the wire (the only tender type that maps to
 * the `external_terminal` payment method), so this is the same key the platform
 * already refuses to refund a terminal tender without, through the exception flow.
 * A second key would be a second gate to keep in step, and a permission no role
 * holds is a feature nobody can use.
 */
const TERMINAL_REFUND_PERMISSION = 'sale.refund.manual_terminal';

/**
 * What a terminal notification did, reported back to the job that carried it. `state` is
 * the attempt's state AFTER the call, so a job can log a resolution it caused and a
 * duplicate it merely observed without re-reading the row.
 */
export interface TenderNotificationResolution {
  readonly attemptId: string;
  readonly merchantId: string;
  readonly state: TenderAttempt['state'];
  /** False for a duplicate, for a settled attempt, and for a provider we cannot reach. */
  readonly providerAsked: boolean;
  /**
   * True when this call CHANGED the attempt into a final state — including the one
   * deliberate rewrite, a decline a later `processed` proves was actually captured. A
   * second delivery of the same news moves nothing and reports false.
   */
  readonly resolvedNow: boolean;
}

@Injectable()
export class TenderService {
  /**
   * The provider-call log line of §7 item 1 lives here rather than in the transport: the transport
   * owns the socket but not the attempt, and an `unknown` that arrives as a thrown transport has no
   * HTTP status to report. See `logProviderCall`.
   */
  private readonly logger = new Logger(TenderService.name);

  constructor(
    private readonly repo: TenderRepository,
    private readonly registry: TenderProviderRegistry,
    private readonly integrity: IntegrityService,
  ) {}

  async capture(
    user: AuthUser,
    merchantId: string,
    dto: TenderCaptureRequest,
  ): Promise<TenderCaptureResult> {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    const provider = this.registry.require(dto.provider);
    await this.repo.loadOpenCart(merchantId, dto.locationId, dto.cartId);
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();

    // ── 1. The attempt, persisted before the provider is called ──────────────
    const started = await this.integrity.execute<{ attemptId: string }>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'tender.capture_requested',
        payload: { ...dto, provider: provider.id },
        correlationId,
      },
      async (context) => {
        const begun = await this.repo.beginAttempt(context.client, merchantId, {
          locationId: dto.locationId,
          cartId: dto.cartId,
          tenderDraftId: dto.tenderId,
          method: methodForFamily(provider.family),
          provider: provider.id,
          // Which terminal this attempt holds, when the provider has one. It is the
          // half of the D4 guard that lives in the ROW: a second order for a terminal
          // already holding one is refused by the database, not by a check we hoped a
          // second caller would run.
          terminalId: provider.terminalId ?? null,
          amountMinorUnits: dto.amount.minorUnits,
          currency: dto.amount.currency,
          commandIdentity: dto.commandIdentity,
          correlationId: context.correlationId,
          expiresInSeconds: TERMINAL_ANSWER_SECONDS * 3,
        });
        await context.appendAudit({
          eventType: 'tender.capture_requested',
          entityType: 'pos_payment_attempt',
          entityId: begun.attempt.id,
          outcome: 'success',
          publicData: {
            commandIdentity: dto.commandIdentity,
            provider: provider.id,
            amountMinorUnits: dto.amount.minorUnits,
            currency: dto.amount.currency,
            // A second request for the same identity or the same draft is recorded as
            // what it is — a replay — and not passed off as a fresh attempt.
            replay: !begun.owned,
          },
        });
        return { ok: true as const, value: { attemptId: begun.attempt.id } };
      },
    );
    const attemptId = started.result?.attemptId;
    if (started.status !== 'succeeded' || !attemptId) {
      throw new ConflictException({ code: started.failureCode ?? 'TENDER_CAPTURE_REFUSED' });
    }

    const created = await this.repo.readById(merchantId, attemptId);
    if (!created) throw new NotFoundException({ code: 'TENDER_ATTEMPT_NOT_FOUND' });

    // Settled already: this is a retry of a command we have answered, and the answer we
    // gave is the one it gets back. The provider is not asked again.
    if (created.state !== 'pending') {
      return this.captureResult(created, provider, null, {
        providerCalled: false,
        idempotentReplay: true,
      });
    }

    // ── 2. The claim: exactly one caller reaches the provider ───────────────
    const claimed = await this.repo.claimProviderCapture(merchantId, created.id);
    if (!claimed) {
      const current = (await this.repo.readById(merchantId, created.id)) ?? created;
      return this.captureResult(current, provider, null, {
        providerCalled: false,
        idempotentReplay: true,
      });
    }

    // ── 3. The provider is asked, outside any transaction ───────────────────
    const providerOutcome = await this.askProvider(
      provider,
      {
        commandIdentity: dto.commandIdentity,
        // Whose account this charge is for: the provider resolves THAT merchant's credential
        // and never the deployment's alone (plan D7).
        merchantId,
        amountMinorUnits: dto.amount.minorUnits,
        currency: dto.amount.currency,
        cartId: dto.cartId,
        locationId: dto.locationId,
        tenderId: dto.tenderId,
        correlationId,
      },
      created.id,
    );
    const resolved = fromProviderOutcome(providerOutcome, provider.family);

    // ── 4. The answer is recorded, in its own command ───────────────────────
    const recorded = await this.record(merchantId, created, dto.locationId, resolved, false);

    return this.captureResult(recorded, provider, resolved, {
      providerCalled: true,
      idempotentReplay: started.duplicate,
    });
  }

  /**
   * ASK WHAT HAPPENED — §8G step 3's second sentence, and the obligation an unknown
   * carries. The command identity is the lookup key on purpose: the question is asked of
   * the SAME identity that started the attempt, never of a neighbouring one.
   */
  async attempt(
    user: AuthUser,
    merchantId: string,
    commandIdentity: string,
    query: TenderAttemptQuery,
  ): Promise<TenderAttemptResult> {
    await this.authorize(user, merchantId, query.locationId, query.operatorSessionId);
    const attempt = await this.repo.readByCommandIdentity(
      merchantId,
      query.locationId,
      commandIdentity,
    );
    if (!attempt) throw new NotFoundException({ code: 'TENDER_ATTEMPT_NOT_FOUND' });

    const provider = attempt.provider ? this.registry.resolve(attempt.provider) : null;
    const settled = attempt.state === 'succeeded' || attempt.state === 'declined';
    const canAsk = query.refresh && !settled && provider !== null && provider.available;

    if (!canAsk) {
      return {
        attempt: this.toAttempt(attempt),
        outcome: this.toProviderOutcome(attempt),
        ambiguity: this.ambiguityOf(attempt),
        providerAsked: false,
        resolvedNow: false,
      };
    }

    const providerOutcome = await this.askQuery(
      provider,
      {
        commandIdentity,
        merchantId: attempt.merchantId,
        providerOrderId: attempt.providerOrderId,
        providerPaymentId: attempt.providerPaymentId,
        amountMinorUnits: Number(attempt.amountMinorUnits),
        currency: attempt.currency,
        correlationId: getRequestContext()?.correlationId ?? randomUUID(),
      },
      attempt.id,
    );
    const resolved = fromProviderOutcome(providerOutcome, provider.family);
    const recorded = await this.record(merchantId, attempt, query.locationId, resolved, true);
    const wasUnresolved = attempt.state === 'unknown' || attempt.state === 'timeout';
    return {
      attempt: this.toAttempt(recorded),
      outcome: this.toProviderOutcome(recorded),
      ambiguity: this.ambiguityOf(recorded),
      providerAsked: true,
      resolvedNow:
        wasUnresolved && (recorded.state === 'succeeded' || recorded.state === 'declined'),
    };
  }

  /**
   * THE OPERATOR'S WORD, RECORDED AND NOT BELIEVED.
   *
   * A customer will say the payment went through, and an operator has to be able to write
   * that down. What they must not be able to do is turn it into a capture. So this writes
   * an audit event and returns the attempt UNCHANGED — `effect: 'none'` — and the only
   * routes from a person's sentence into a sale are the provider's own answer through
   * `pos.tenderAttempt`, or the commit's `operator_attested` path, which declares itself
   * as such in the row.
   */
  async assert(
    user: AuthUser,
    merchantId: string,
    commandIdentity: string,
    dto: TenderAssertionRequest,
  ): Promise<TenderAssertionResult> {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();

    const result = await this.integrity.execute<{ attemptId: string }>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'tender.operator_asserted',
        payload: { commandIdentity, ...dto },
        correlationId,
      },
      async (context) => {
        const attempt = await this.repo.readByCommandIdentity(
          merchantId,
          dto.locationId,
          commandIdentity,
        );
        if (!attempt) {
          return {
            ok: false as const,
            code: 'TENDER_ATTEMPT_NOT_FOUND',
            failureClass: 'validation' as const,
            retryable: false,
          };
        }
        // The event type says assertion, the reason code names what was asserted, and
        // `stateUnchanged` records that this command moved no money. An auditor reading
        // the trail can therefore tell an operator's belief from a provider's fact.
        await context.appendAudit({
          eventType: 'tender.operator_asserted',
          entityType: 'pos_payment_attempt',
          entityId: attempt.id,
          outcome: 'success',
          reasonCode: dto.assertion,
          publicData: {
            commandIdentity,
            assertion: dto.assertion,
            note: dto.note,
            stateUnchanged: attempt.state,
            effect: 'none',
          },
        });
        return { ok: true as const, value: { attemptId: attempt.id } };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new NotFoundException({ code: result.failureCode ?? 'TENDER_ATTEMPT_NOT_FOUND' });
    }
    const attempt = await this.repo.readById(merchantId, result.result.attemptId);
    if (!attempt) throw new NotFoundException({ code: 'TENDER_ATTEMPT_NOT_FOUND' });

    return {
      attempt: this.toAttempt(attempt),
      assertion: dto.assertion,
      note: dto.note,
      effect: 'none',
      recordedAt: new Date().toISOString(),
      correlationId,
    };
  }

  /**
   * Turn an operator's word into a FINAL state (workstream G step 4's remainder).
   *
   * `assert` above records what a person saw and changes nothing, which is right
   * while the question is still open. It stops being enough when nobody else can
   * answer it: a manual terminal has no adapter to ask, and once the screen has
   * moved on the person who was standing there is the only witness there will
   * ever be. Without this, an unresolved attempt stays unresolved for good, its
   * tender cannot be dropped from the checkout draft, and the cart can be neither
   * paid nor cancelled — every route refuses it, which is what happened to a cart
   * in the rehearsal and left a cashier unable to take money for that sale or to
   * leave the screen.
   *
   * Two things keep this honest. The proof source is the literal
   * `operator_attested`, never `provider`: a provider's proof is a payment id and
   * a human voice cannot manufacture one, and the database says the same in
   * `payment_attempt_provider_proof_has_id_ck`. And a settlement is IDEMPOTENT in
   * the direction that matters — an attempt that is already final answers with
   * itself instead of being rewritten, so a retry cannot flip a paid terminal to
   * unpaid or the reverse.
   */
  async settle(
    user: AuthUser,
    merchantId: string,
    commandIdentity: string,
    dto: TenderSettlementRequest,
  ): Promise<TenderSettlementResult> {
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
    );
    // Settling decides whether money moved, so it asks for the permission the till
    // already requires to put a card terminal on a sale at all. An operator who
    // may not confirm a terminal may not silently resolve one either.
    if (
      !authorization.permissions.includes('checkout.terminal.confirm') &&
      !authorization.permissions.includes('*')
    ) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();

    const result = await this.integrity.execute<{
      attemptId: string;
      previousState: string;
    }>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'tender.settled',
        payload: { commandIdentity, ...dto },
        correlationId,
      },
      async (context) => {
        const attempt = await this.repo.readByCommandIdentity(
          merchantId,
          dto.locationId,
          commandIdentity,
        );
        if (!attempt) {
          return {
            ok: false as const,
            code: 'TENDER_ATTEMPT_NOT_FOUND',
            failureClass: 'validation' as const,
            retryable: false,
          };
        }
        // Already final: answer with what is there. A settlement is a decision
        // about an OPEN question, and re-deciding it would let a retry rewrite
        // whether money moved.
        if (FINISHED_ATTEMPT_STATES.has(attempt.state)) {
          return {
            ok: true as const,
            value: { attemptId: attempt.id, previousState: attempt.state },
          };
        }
        const next = await this.repo.resolveAttempt(context.client, merchantId, attempt.id, {
          state: dto.outcome === 'paid' ? 'succeeded' : 'declined',
          queryOnly: false,
          proofSource: 'operator_attested',
          providerStatus: null,
          providerOrderId: null,
          providerPaymentId: null,
          queryAfterSeconds: null,
          isQuery: false,
        });
        if (!next) {
          return {
            ok: false as const,
            code: 'TENDER_ALREADY_SETTLED',
            failureClass: 'conflict' as const,
            retryable: false,
          };
        }
        // The trail says who decided, what they saw, and what the attempt was
        // before they did. An auditor can therefore tell a settlement from a
        // capture without reading the code that wrote it.
        await context.appendAudit({
          eventType: 'tender.operator_settled',
          entityType: 'pos_payment_attempt',
          entityId: attempt.id,
          outcome: 'success',
          reasonCode: dto.outcome,
          publicData: {
            commandIdentity,
            outcome: dto.outcome,
            evidence: dto.evidence,
            note: dto.note,
            proofSource: 'operator_attested',
            previousState: attempt.state,
          },
        });
        return {
          ok: true as const,
          value: { attemptId: attempt.id, previousState: attempt.state },
        };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      const code = result.failureCode ?? 'TENDER_ALREADY_SETTLED';
      if (code === 'TENDER_ATTEMPT_NOT_FOUND') throw new NotFoundException({ code });
      throw new ConflictException({ code });
    }
    const attempt = await this.repo.readById(merchantId, result.result.attemptId);
    if (!attempt) throw new NotFoundException({ code: 'TENDER_ATTEMPT_NOT_FOUND' });
    return {
      attempt: this.toAttempt(attempt),
      outcome: dto.outcome,
      proofSource: 'operator_attested',
      evidence: dto.evidence,
      note: dto.note,
      previousState: result.result.previousState,
      settledAt: new Date().toISOString(),
      correlationId,
    };
  }

  async providers(
    user: AuthUser,
    merchantId: string,
    query: TenderProviderQuery,
  ): Promise<TenderProviderList> {
    await this.authorize(user, merchantId, query.locationId, query.operatorSessionId);
    // Asked FOR THIS MERCHANT: since the credential became the café's (plan D7), "which
    // providers exist" and "which of them can charge THIS café" are different questions.
    return this.registry.list(merchantId);
  }

  /**
   * THE TERMINAL TELLING US WHAT IT DID, WITH NOBODY LOGGED IN.
   *
   * This is the one entry point that is not an operator's request, and it exists because
   * the customer is not the only actor here: the terminal answers in its own time, up to
   * forty seconds later and sometimes after the till has moved on. A notification arrives
   * at the API, is queued, and the worker calls this.
   *
   * THE NOTIFICATION IS NOT THE TRUTH (plan D5). What it gives us is a REASON TO ASK: the
   * attempt to resolve (by the order id we stored, or by our own command identity when the
   * capture's answer never reached us), and the terminal's own status as a hint that is
   * never written. The outcome comes from `GET /v1/orders/{order_id}` through the same
   * provider adapter the capture used, so a notification that arrives early, a duplicate
   * delivery, and a replayed body all end in the same monotonic write.
   *
   * Returns null when the notification names an attempt this deployment has never
   * recorded — a notification for another environment's order, or one that arrived after
   * the row was purged. That is a fact to log, not a row to invent.
   */
  async resolveFromNotification(input: {
    providerOrderId: string | null;
    commandIdentity: string | null;
    statusHint: string | null;
    correlationId: string;
  }): Promise<TenderNotificationResolution | null> {
    const attempt = await this.repo.findAttemptForNotification({
      providerOrderId: input.providerOrderId,
      commandIdentity: input.commandIdentity,
    });
    if (!attempt) return null;

    // A CAPTURE AND A CANCELLATION ARE ANSWERS; A DECLINE IS NOT ALWAYS FINAL. `succeeded`
    // and `cancelled` are ends of the story, so a duplicate delivery is answered from the
    // row instead of spending a vendor call to be told the same thing. `declined` is
    // deliberately NOT in that set: the plan's D5 records the one exception the repository
    // allows (`declined → succeeded`), because a terminal can report a refusal and then,
    // on a later notification, the payment that actually went through — and freezing the
    // decline would hide a charge. Asking again costs one call and can only ever correct
    // the row, never undo it: the repository's guard refuses every other rewrite.
    const answered = attempt.state === 'succeeded' || attempt.state === 'cancelled';
    const provider = attempt.provider ? this.registry.resolve(attempt.provider) : null;

    // ── THE OTHER QUESTION THIS NOTIFICATION CAN ANSWER ───────────────────────
    //
    // A notification names an ORDER, and an order carries its refunds. So a refund the terminal
    // accepted but has not finished — `processing`, which is `unknown` and would otherwise stay
    // that way for good — is resolved by the same wake-up that resolves the capture, and written
    // through the same monotonic guard. It runs BEFORE the capture's own gate below, and that
    // order is not cosmetic: after a refund the capture is ordinarily already `succeeded`, so the
    // gate would return early and this question would never be asked.
    await this.resolveOpenRefund(attempt, input.correlationId);

    if (answered || !provider || !provider.available) {
      return {
        attemptId: attempt.id,
        merchantId: attempt.merchantId,
        state: attempt.state,
        providerAsked: false,
        resolvedNow: false,
      };
    }

    const providerOutcome = await this.askQuery(
      provider,
      {
        commandIdentity: attempt.commandIdentity ?? input.commandIdentity ?? attempt.id,
        merchantId: attempt.merchantId,
        // The order id we stored wins; the notification's own is the fallback for a
        // capture whose response never reached us, and `resolveAttempt` coalesces it into
        // the row so the next reader has it.
        providerOrderId: attempt.providerOrderId ?? input.providerOrderId,
        providerPaymentId: attempt.providerPaymentId,
        amountMinorUnits: Number(attempt.amountMinorUnits),
        currency: attempt.currency,
        correlationId: input.correlationId,
      },
      attempt.id,
    );
    const resolved = fromProviderOutcome(providerOutcome, provider.family);
    // THE CONTEXT THE COMMAND LAYER NEEDS, AND NOTHING MORE. A resolution is written
    // through `IntegrityService`, which finds the merchant's RLS scope in the request
    // context (`PgService.withMerchant`) — and a notification arrives with no request at
    // all. So the context is stated explicitly here: the merchant and location the attempt
    // belongs to, `userId: null` because NO PERSON acted (the terminal did, and an audit
    // row naming a cashier for it would be a lie the trail keeps), no device, and the
    // delivery's own correlation id so the notification and its write can be followed
    // together. `merchant.audit_log.actor_user_id` is nullable and the integrity repository
    // already records a null actor when there is none.
    const recorded = await runWithRequestContext(
      {
        merchantId: attempt.merchantId,
        locationId: attempt.locationId,
        deviceId: null,
        userId: null,
        requestId: input.correlationId,
        correlationId: input.correlationId,
      },
      () => this.record(attempt.merchantId, attempt, attempt.locationId, resolved, true),
    );
    return {
      attemptId: recorded.id,
      merchantId: attempt.merchantId,
      state: recorded.state,
      providerAsked: true,
      resolvedNow:
        recorded.state !== attempt.state &&
        (recorded.state === 'succeeded' || recorded.state === 'declined'),
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * GIVE THE MONEY BACK, AT THE TERMINAL — plan §4 Phase 4, and D6's sentence turned
   * into a command: "a refund is its own command, with its own attempt".
   *
   * WHY THIS IS NOT A MUTATION OF THE SALE. What the vendor needs for a partial refund
   * is `transactions.payments[].id` — the id of the capture, not of the order and not
   * of the sale (research note 01 §4.3) — and the vendor says in its own words to save
   * both ids. So this takes the CAPTURE's attempt id, and it writes a SECOND attempt
   * row linked to it. The sale keeps saying what it always said; the giving-back is a
   * new fact with its own amount, its own identity and its own answer.
   *
   * THE CEILING IS WHAT THE CUSTOMER PAID (Phase 4 step 3). The terminal can add a tip,
   * so `paid_amount` can exceed the amount we asked for, and a refund of that tip is
   * legal — which is why the paid amount is recorded on the capture when the vendor
   * says it, and why `refunded_amount + this refund` is measured against THAT and not
   * against our own request. The vendor enforces the same rule with
   * `refund_amount_exceeds`; ours exists so the operator is told before the call.
   *
   * THE ORDER OF OPERATIONS IS THE CAPTURE'S, for the capture's reason: the attempt is
   * PERSISTED first, the right to call the provider is CLAIMED exactly once, and the
   * answer is written afterwards. A till that dies mid-refund leaves a refund attempt
   * that can be found by its command identity rather than nothing at all.
   */
  async refund(
    user: AuthUser,
    merchantId: string,
    attemptId: string,
    dto: TenderRefundRequest,
  ): Promise<TenderRefundResult> {
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
    );
    // An operator who may take money is not automatically one who may give it back.
    if (
      !authorization.permissions.includes(TERMINAL_REFUND_PERMISSION) &&
      !authorization.permissions.includes('*')
    ) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const correlationId = getRequestContext()?.correlationId ?? randomUUID();

    const capture = await this.repo.readById(merchantId, attemptId);
    if (!capture || capture.locationId !== dto.locationId) {
      throw new NotFoundException({ code: 'TENDER_ATTEMPT_NOT_FOUND' });
    }
    // Only a capture the PROVIDER proved can be given back at a terminal. An
    // operator-attested success has no payment id to refund, cash is refunded out of
    // the drawer, and an attempt that never succeeded has nothing to give back.
    if (
      capture.refundOfAttemptId !== null ||
      capture.state !== 'succeeded' ||
      capture.proofSource !== 'provider' ||
      capture.providerOrderId === null ||
      capture.providerPaymentId === null
    ) {
      throw new ConflictException({
        code: 'TENDER_REFUND_NOT_REFUNDABLE',
        details: {
          attemptId: capture.id,
          state: capture.state,
          proofSource: capture.proofSource,
          isRefund: capture.refundOfAttemptId !== null,
        },
      });
    }
    if (dto.amount.currency !== capture.currency) {
      throw new ConflictException({
        code: 'TENDER_REFUND_NOT_REFUNDABLE',
        details: {
          attemptId: capture.id,
          reason: 'currency_mismatch',
          captureCurrency: capture.currency,
          requestedCurrency: dto.amount.currency,
        },
      });
    }
    const provider = capture.provider ? this.registry.resolve(capture.provider) : null;
    // A provider that cannot refund says so here rather than at the vendor, and the
    // caller is left with the operator-attested path it already had.
    if (!provider || !provider.refund || !provider.available) {
      throw new ConflictException({
        code: 'TENDER_REFUND_UNSUPPORTED',
        details: {
          provider: capture.provider,
          reason: !provider
            ? 'not_registered'
            : !provider.refund
              ? 'no_refund_capability'
              : 'unavailable',
        },
      });
    }

    const alreadyRefunded = await this.repo.refundedAmount(merchantId, capture.id);
    const ceiling =
      capture.providerPaidMinorUnits === null
        ? Number(capture.amountMinorUnits)
        : Number(capture.providerPaidMinorUnits);
    if (alreadyRefunded + dto.amount.minorUnits > ceiling) {
      throw new ConflictException({
        code: 'PAID_AMOUNT_EXCEEDED',
        details: {
          attemptId: capture.id,
          paidAmountMinorUnits: ceiling,
          alreadyRefundedMinorUnits: alreadyRefunded,
          requestedMinorUnits: dto.amount.minorUnits,
        },
      });
    }
    // Asking for everything that is left is the vendor's TOTAL refund, which it
    // documents as a request WITH NO BODY; anything less is a partial refund that
    // names the payment and the amount (note 01 §4.2 and §4.3). The transport makes
    // that choice — null means "the rest".
    const givesBackEverything = alreadyRefunded + dto.amount.minorUnits >= ceiling;

    const started = await this.integrity.execute<{ attemptId: string }>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'tender.refund_requested',
        payload: {
          attemptId: capture.id,
          amountMinorUnits: dto.amount.minorUnits,
          currency: dto.amount.currency,
          commandIdentity: dto.commandIdentity,
          provider: provider.id,
          total: givesBackEverything,
        },
        correlationId,
      },
      async (context) => {
        const begun = await this.repo.beginRefundAttempt(context.client, merchantId, {
          locationId: dto.locationId,
          cartId: capture.cartId,
          tenderDraftId: capture.tenderDraftId,
          provider: provider.id,
          providerOrderId: capture.providerOrderId as string,
          providerPaymentId: capture.providerPaymentId as string,
          refundOfAttemptId: capture.id,
          amountMinorUnits: dto.amount.minorUnits,
          currency: capture.currency,
          commandIdentity: dto.commandIdentity,
          correlationId: context.correlationId,
          expiresInSeconds: TERMINAL_ANSWER_SECONDS * 3,
        });
        await context.appendAudit({
          eventType: 'tender.refund_requested',
          entityType: 'pos_payment_attempt',
          entityId: begun.attempt.id,
          outcome: 'success',
          publicData: {
            refundsAttemptId: capture.id,
            commandIdentity: dto.commandIdentity,
            amountMinorUnits: dto.amount.minorUnits,
            currency: dto.amount.currency,
            provider: provider.id,
            total: givesBackEverything,
            // A retry of the same refund is recorded as what it is.
            replay: !begun.owned,
          },
        });
        return { ok: true as const, value: { attemptId: begun.attempt.id } };
      },
    );
    if (started.status !== 'succeeded' || !started.result) {
      throw new ConflictException({ code: started.failureCode ?? 'TENDER_REFUND_CONFLICT' });
    }
    const refundAttemptId = started.result.attemptId;

    // Exactly one writer may call the provider, and this claim is what makes that
    // true across a retry, a second tab and a crash (the same rule as a capture).
    const owned = await this.repo.claimProviderCapture(merchantId, refundAttemptId);
    const row = await this.repo.readById(merchantId, refundAttemptId);
    if (!row) throw new NotFoundException({ code: 'TENDER_ATTEMPT_NOT_FOUND' });
    if (!owned) {
      return this.refundResult(row, true, correlationId, ceiling);
    }

    const providerOutcome = await this.askRefund(
      provider,
      {
        commandIdentity: dto.commandIdentity,
        merchantId,
        providerOrderId: row.providerOrderId,
        providerPaymentId: row.providerPaymentId,
        amountMinorUnits: givesBackEverything ? null : dto.amount.minorUnits,
        correlationId,
      },
      row.id,
    );
    const resolved = fromRefundOutcome(providerOutcome, row);
    const recorded = await this.record(merchantId, row, dto.locationId, resolved, false, {
      commandType: 'tender.refund_resolved',
      // THE ID IS KEPT EVEN WHEN THE REFUND HAS NOT SETTLED. A `processing` answer is
      // `unknown`, because requested is not moved — but the vendor has told us WHICH refund it
      // is, and discarding that is what made the state permanent: the read that closes it has
      // nothing else to look the entry up by (plan §14.2 D34). A decline has no id to keep.
      providerRefundId:
        providerOutcome.kind === 'refunded' || providerOutcome.kind === 'unknown'
          ? providerOutcome.providerRefundId
          : null,
    });
    return this.refundResult(recorded, false, correlationId, ceiling, resolved);
  }

  /** A provider that throws on a refund is an unknown, never a decline — as everywhere else. */
  private async askRefund(
    provider: TenderProviderPort,
    request: ProviderRefundRequest,
    attemptId: string,
  ): Promise<ProviderRefundOutcome> {
    const startedAt = Date.now();
    let answer: ProviderRefundOutcome;
    try {
      answer = await (provider.refund as NonNullable<TenderProviderPort['refund']>)(request);
    } catch (error) {
      answer = {
        kind: 'unknown',
        providerStatus: 'unreachable',
        code: 'PROVIDER_TRANSPORT_FAILURE',
        message: error instanceof Error ? error.message.slice(0, 400) : 'The provider failed.',
        providerRefundId: null,
      };
    }
    // A refund's order id is the one it was asked about, so the line names the same order the
    // request did — there is no answer field to read it from, and inventing one would be worse
    // than saying what we sent.
    this.logProviderCall(
      'refund',
      provider,
      attemptId,
      request.correlationId,
      request.providerOrderId,
      answer,
      startedAt,
    );
    return answer;
  }

  /**
   * ASK WHAT HAPPENED TO A REFUND WE ALREADY ASKED FOR — the read half of a refund, and the one
   * thing that can close a `processing` answer (plan §12.4 item 3, §14.2 D34).
   *
   * A provider without `refundQuery` answers `null` here, which the caller reads as "this adapter
   * cannot tell me" rather than as a failure of the café's refund: the drawer has no refunds to
   * read and an operator's terminal has no API to read them from, exactly as `refund` is absent
   * on those providers for the same reason.
   */
  private async askRefundQuery(
    provider: TenderProviderPort,
    request: ProviderRefundRequest,
  ): Promise<ProviderRefundOutcome | null> {
    if (!provider.refundQuery) return null;
    try {
      return await provider.refundQuery(request);
    } catch (error) {
      return {
        kind: 'unknown',
        providerStatus: 'unreachable',
        code: 'PROVIDER_TRANSPORT_FAILURE',
        message: error instanceof Error ? error.message.slice(0, 400) : 'The provider failed.',
        providerRefundId: request.providerRefundId ?? null,
      };
    }
  }

  /**
   * CLOSE A REFUND THE VENDOR LEFT WAITING (plan §12.4 item 3).
   *
   * The refund command records what the vendor said at the moment it was asked, and `processing`
   * is one of the things it can say. Nothing else ever asks again, so without this the row would
   * hold `unknown` for good and an operator would have no way to learn that the money did move —
   * which is the same failure the capture path already refuses to accept, answered in the same
   * place: the notification that names the order.
   *
   * IT ASKS ONLY WHAT CAN BE ATTRIBUTED. The repository hands back a refund only when the row
   * carries BOTH the vendor's refund id and the order id, because the read finds its entry by
   * that id: matching on an amount would be a guess about money, and an unattributable refund is
   * exactly the lie this workstream exists to prevent. Everything else stays `unknown`, honestly.
   *
   * NOTHING IS WRITTEN FOR AN `unknown` ANSWER. A re-read that says "still processing" is not
   * news, and recording it would only churn the row; the guard refuses the rewrite anyway.
   */
  private async resolveOpenRefund(capture: TenderAttemptRow, correlationId: string): Promise<void> {
    const open = await this.repo.findOpenRefundFor(capture.merchantId, capture.id);
    if (!open) return;
    const provider = open.provider ? this.registry.resolve(open.provider) : null;
    if (!provider || !provider.available || !provider.refundQuery) return;

    const outcome = await this.askRefundQuery(provider, {
      commandIdentity: open.commandIdentity ?? open.id,
      merchantId: open.merchantId,
      providerOrderId: open.providerOrderId,
      providerPaymentId: open.providerPaymentId,
      amountMinorUnits: open.amountMinorUnits === null ? null : Number(open.amountMinorUnits),
      providerRefundId: open.providerRefundId,
      correlationId,
    });
    if (outcome === null || outcome.kind === 'unknown') return;

    // The notification arrives with no request context at all, so the scope the write needs is
    // stated explicitly — the same context block the capture's resolution states, and for the
    // same reason: the terminal acted and no person did, so the audit row names no cashier.
    await runWithRequestContext(
      {
        merchantId: open.merchantId,
        locationId: open.locationId,
        deviceId: null,
        userId: null,
        requestId: correlationId,
        correlationId,
      },
      () =>
        this.record(
          open.merchantId,
          open,
          open.locationId,
          fromRefundOutcome(outcome, open),
          true,
          {
            commandType: 'tender.refund_resolved',
            providerRefundId: outcome.kind === 'refunded' ? outcome.providerRefundId : null,
          },
        ),
    );
  }

  /**
   * The answer to a refund request. The PAID AMOUNT it reports is the CEILING this refund was
   * measured against — the capture's paid amount, not the refund row's own copy of it, which
   * is null by construction: a refund does not pay anything, it gives something back.
   */
  private refundResult(
    row: TenderAttemptRow,
    idempotentReplay: boolean,
    correlationId: string,
    paidAmountMinorUnits: number,
    /**
     * The answer this call just wrote, when there is one. It is passed in because the ROW
     * cannot carry a code: `toProviderOutcome` answers every stored decline with the
     * generic `PROVIDER_DECLINED`, while the vendor's own reason — `partial_refund_forbidden_with_tips`,
     * `refund_period_exceeded` — is what the operator has to act on, and the operator is
     * reading THIS response. A replay reads the row, because by then the code is only in
     * the audit trail and the state is the fact that matters.
     */
    resolved?: ResolvedOutcome,
  ): TenderRefundResult {
    return {
      refundAttempt: this.toAttempt(row),
      outcome: (resolved ? this.outcomeFromResolved(resolved) : this.toProviderOutcome(row)) ?? {
        kind: 'unknown',
        providerStatus: row.providerStatus ?? 'unknown',
        code: 'TENDER_REFUND_UNRESOLVED',
        message: null,
      },
      providerRefundId: row.providerRefundId,
      paidAmountMinorUnits,
      idempotentReplay,
      requestedAt: new Date().toISOString(),
      correlationId,
    };
  }

  private async record(
    merchantId: string,
    attempt: TenderAttemptRow,
    locationId: string,
    resolved: ResolvedOutcome,
    isQuery: boolean,
    /**
     * A refund's own proof, and the command it is written under. Both are absent for a
     * capture: the capture's proof is its payment id and its command is its own.
     */
    refund?: { readonly commandType: string; readonly providerRefundId: string | null },
  ): Promise<TenderAttemptRow> {
    // The resolution command is keyed by the ATTEMPT when a capture resolves it: resolving
    // one attempt twice is the same command, whatever asked. A query gets a fresh key
    // because asking twice is a legitimate second question, and its write is idempotent by
    // the repository's own status guard.
    const result = await this.integrity.execute<{ attemptId: string }>(
      {
        merchantId,
        locationId,
        commandId: randomUUID(),
        idempotencyKey: isQuery ? randomUUID() : attempt.id,
        commandType:
          refund?.commandType ?? (isQuery ? 'tender.outcome_queried' : 'tender.capture_resolved'),
        payload: {
          attemptId: attempt.id,
          commandIdentity: attempt.commandIdentity,
          state: resolved.state,
          code: resolved.code,
          // Named in the payload so a refund's command is distinguishable from a
          // capture's in the trail without joining to the attempt row.
          providerRefundId: refund?.providerRefundId ?? null,
        },
      },
      async (context) => {
        const updated = await this.repo.resolveAttempt(context.client, merchantId, attempt.id, {
          state: resolved.state,
          queryOnly: resolved.state === 'unknown' || resolved.state === 'timeout',
          proofSource: resolved.proofSource,
          providerStatus: resolved.providerStatus,
          providerOrderId: resolved.providerOrderId,
          providerPaymentId: resolved.providerPaymentId,
          providerRefundId: refund?.providerRefundId ?? null,
          providerPaidMinorUnits: resolved.providerPaidMinorUnits,
          providerTipMinorUnits: resolved.providerTipMinorUnits,
          queryAfterSeconds: resolved.queryAfterSeconds,
          isQuery,
        });
        await context.appendAudit({
          eventType:
            refund?.commandType ?? (isQuery ? 'tender.outcome_queried' : 'tender.capture_resolved'),
          entityType: 'pos_payment_attempt',
          entityId: attempt.id,
          // An unknown is recorded as a failure WITH a reason code, exactly as the
          // existing checkout's `terminal_outcome_unknown` audit does: the trail keeps the
          // honest word, and the code says which kind of not-knowing this was.
          outcome: resolved.state === 'succeeded' ? 'success' : 'failure',
          reasonCode: resolved.code ?? resolved.state,
          publicData: {
            commandIdentity: attempt.commandIdentity,
            provider: attempt.provider,
            state: resolved.state,
            providerStatus: resolved.providerStatus,
            proofSource: resolved.proofSource,
            providerPaymentId: resolved.providerPaymentId,
            providerRefundId: refund?.providerRefundId ?? null,
            // Non-null exactly when a provider's answer was downgraded — the audit says
            // why a "processed" never became a capture.
            downgradedBecause: resolved.downgradedBecause,
          },
        });
        const row = updated ?? (await this.repo.readById(merchantId, attempt.id));
        if (!row) {
          return {
            ok: false as const,
            code: 'TENDER_ATTEMPT_NOT_FOUND',
            failureClass: 'conflict' as const,
            retryable: false,
          };
        }
        return { ok: true as const, value: { attemptId: row.id } };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({ code: result.failureCode ?? 'TENDER_OUTCOME_CONFLICT' });
    }
    const row = await this.repo.readById(merchantId, result.result.attemptId);
    if (!row) throw new NotFoundException({ code: 'TENDER_ATTEMPT_NOT_FOUND' });
    return row;
  }

  /**
   * A provider that throws is an unknown — never a decline — and the reason is kept.
   *
   * AND EVERY CALL IS LOGGED (plan §7 item 1). The log line asks for the correlation id, the
   * attempt id, the order id, the status and the latency, and this is the only place all five are
   * in hand at once: the attempt row names the attempt, the request carries the correlation id,
   * the answer names the order and the provider's own status, and the two timestamps around the
   * call are the latency. NOTHING HERE IS A TOKEN: the transport is where a vendor string could
   * quote one back at us, and that is where the redaction already lives.
   *
   * WHY THE SERVICE AND NOT THE TRANSPORT. The transport knows the socket and the HTTP status; it
   * does NOT know which attempt it is acting for, and a transport that throws produces an answer
   * with no HTTP status at all. One line per call, here, covers every provider — the terminal, the
   * drawer, a scripted fake — and the `outcome` field is what a reader looks at first: a run of
   * `outcome=unknown` is the integration's health, and a run of `outcome=declined` is a card.
   */
  private logProviderCall(
    op: 'capture' | 'query' | 'refund',
    provider: TenderProviderPort,
    attemptId: string,
    correlationId: string,
    orderId: string | null,
    answer: { readonly kind: string; readonly providerStatus: string },
    startedAt: number,
  ): void {
    this.logger.log(
      `tender_provider_call provider=${provider.id} op=${op} attempt=${attemptId} correlation=${correlationId} order=${orderId ?? '-'} status=${answer.providerStatus} outcome=${answer.kind} latencyMs=${Date.now() - startedAt}`,
    );
  }

  private async askProvider(
    provider: TenderProviderPort,
    request: Parameters<TenderProviderPort['capture']>[0],
    attemptId: string,
  ): Promise<ProviderOutcome> {
    const startedAt = Date.now();
    let answer: ProviderOutcome;
    try {
      answer = await provider.capture(request);
    } catch (error) {
      answer = {
        kind: 'unknown',
        providerStatus: 'unreachable',
        code: 'PROVIDER_TRANSPORT_FAILURE',
        message: error instanceof Error ? error.message.slice(0, 400) : 'The provider failed.',
        providerOrderId: null,
        queryAfterSeconds: TERMINAL_ANSWER_SECONDS,
      };
    }
    this.logProviderCall(
      'capture',
      provider,
      attemptId,
      request.correlationId,
      answer.providerOrderId ?? null,
      answer,
      startedAt,
    );
    return answer;
  }

  private async askQuery(
    provider: TenderProviderPort,
    request: Parameters<TenderProviderPort['query']>[0],
    attemptId: string,
  ): Promise<ProviderOutcome> {
    const startedAt = Date.now();
    let answer: ProviderOutcome;
    try {
      answer = await provider.query(request);
    } catch (error) {
      answer = {
        kind: 'unknown',
        providerStatus: 'unreachable',
        code: 'PROVIDER_TRANSPORT_FAILURE',
        message: error instanceof Error ? error.message.slice(0, 400) : 'The provider failed.',
        providerOrderId: request.providerOrderId,
        queryAfterSeconds: TERMINAL_ANSWER_SECONDS,
      };
    }
    this.logProviderCall(
      'query',
      provider,
      attemptId,
      request.correlationId,
      answer.providerOrderId ?? request.providerOrderId,
      answer,
      startedAt,
    );
    return answer;
  }

  private captureResult(
    attempt: TenderAttemptRow,
    provider: TenderProviderPort,
    resolved: ResolvedOutcome | null,
    flags: { providerCalled: boolean; idempotentReplay: boolean },
  ): TenderCaptureResult {
    const outcome = resolved ? this.outcomeFromResolved(resolved) : this.toProviderOutcome(attempt);
    return {
      attempt: this.toAttempt(attempt),
      // The contract requires an outcome, and an attempt that is still unresolved has one
      // too: `unknown`. Saying so here is what stops a caller reading a missing field as a
      // success.
      outcome: outcome ?? {
        kind: 'unknown',
        providerStatus: attempt.providerStatus ?? 'unknown',
        code: 'TENDER_ATTEMPT_UNRESOLVED',
        message: null,
      },
      ambiguity: this.ambiguityOf(attempt),
      idempotentReplay: flags.idempotentReplay,
      providerCalled: flags.providerCalled && provider.available,
      capturedAt: new Date().toISOString(),
    };
  }

  private toAttempt(row: TenderAttemptRow): TenderAttempt {
    return {
      id: row.id,
      commandIdentity: row.commandIdentity,
      cartId: row.cartId,
      locationId: row.locationId,
      method: row.method,
      family: familyForStoredAttempt(row.method, this.registry.familyOf(row.provider)),
      provider: row.provider,
      state: row.state,
      queryOnly: row.queryOnly,
      amount: { minorUnits: Number(row.amountMinorUnits), currency: row.currency },
      providerOrderId: row.providerOrderId,
      providerPaymentId: row.providerPaymentId,
      providerStatus: row.providerStatus,
      proofSource: row.proofSource,
      correlationId: row.correlationId,
      queryAfter: row.queryAfter,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    };
  }

  private toProviderOutcome(row: TenderAttemptRow): TenderOutcome | null {
    const providerStatus = row.providerStatus;
    if (row.state === 'succeeded' && providerStatus !== null) {
      return { kind: 'succeeded', providerStatus, code: null, message: null };
    }
    if (row.state === 'declined') {
      return {
        kind: 'declined',
        providerStatus: providerStatus ?? 'declined',
        code: 'PROVIDER_DECLINED',
        message: null,
      };
    }
    if (row.state === 'unknown' || row.state === 'timeout') {
      return {
        kind: 'unknown',
        providerStatus: providerStatus ?? 'unknown',
        code: row.state === 'timeout' ? 'TENDER_QUERY_STILL_UNANSWERED' : null,
        message: null,
      };
    }
    return null;
  }

  private outcomeFromResolved(resolved: ResolvedOutcome): TenderOutcome {
    if (resolved.state === 'succeeded') {
      return {
        kind: 'succeeded',
        providerStatus: resolved.providerStatus,
        code: null,
        message: null,
      };
    }
    if (resolved.state === 'declined') {
      return {
        kind: 'declined',
        providerStatus: resolved.providerStatus,
        code: resolved.code ?? 'PROVIDER_DECLINED',
        message: resolved.message,
      };
    }
    return {
      kind: 'unknown',
      providerStatus: resolved.providerStatus,
      code: resolved.code,
      message: resolved.message,
    };
  }

  private ambiguityOf(row: TenderAttemptRow) {
    return ambiguityFor({
      id: row.id,
      state: row.state,
      correlationId: row.correlationId,
      queryAfterSeconds: row.queryAfter ? null : TERMINAL_ANSWER_SECONDS,
      now: new Date(),
    });
  }

  private async authorize(
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ) {
    if (!user.deviceId) {
      throw new ForbiddenException({ code: 'DEVICE_NOT_ENROLLED' });
    }
    const authorization = await this.repo.authorize(
      user.id,
      user.sessionId,
      user.deviceId,
      merchantId,
      locationId,
      operatorSessionId,
    );
    if (!authorization) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    // Returned so a route that needs MORE than the checkout gate can say so — see
    // `settle`, which decides money and therefore needs the terminal permission
    // the till already requires to use a terminal at all.
    return authorization;
  }
}
