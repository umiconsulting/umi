import type { TenderFamily } from '@umi/contract';
import type { PointRefundSnapshot, PointTransport } from '../point-transport.port';
import { MercadoPagoPointError } from './mercado-pago-point.transport';
import { transportFailureOutcome, outcomeFromSnapshot } from '../tender-domain';
import type {
  ProviderCaptureRequest,
  ProviderOutcome,
  ProviderQueryRequest,
  ProviderAvailability,
  ProviderRefundOutcome,
  ProviderRefundRequest,
  TenderProviderPort,
} from '../tender-provider.port';

/**
 * THE MERCADO PAGO POINT TERMINAL — the only card-present path today (§8G step 6, and
 * §2.5 of the ADR).
 *
 * It does exactly two things: it asks its transport to create an order bound to an
 * external reference, and it asks the transport to read that order. Every decision
 * about what the answer MEANS belongs to `classifyTerminalStatus`, and every decision
 * about whether a success is believable belongs to `fromProviderOutcome`. This class is
 * therefore short by construction: adding a second brand means writing a class shaped
 * like this one and a transport, and nothing in checkout changes.
 *
 * A TRANSPORT THAT THROWS IS AN UNKNOWN, NEVER A DECLINE. The money may have moved and
 * the customer may be standing there with a receipt; treating our own network failure
 * as the customer's failure is the mistake this whole workstream is about.
 */
export class MercadoPagoPointProvider implements TenderProviderPort {
  readonly id = 'mercado_pago_point';
  readonly family: TenderFamily = 'card_present';

  constructor(private readonly transport: PointTransport) {}

  get available(): boolean {
    return this.transport.configured;
  }

  get unavailableReason(): string | null {
    return this.transport.configured ? null : this.transport.unavailableReason;
  }

  /**
   * CAN THIS CAFÉ BE CHARGED (plan D7, D8). The register is the deployment's and the account
   * is the merchant's, so the deployment's `available` cannot answer this: a café that has not
   * authorized has no account for the money to reach, and offering it a card button would fail
   * after the customer had already decided.
   *
   * A credential we cannot READ is answered the same way rather than thrown: the listing's job
   * is to say whether the method will work, and "we cannot decrypt this token" is not a working
   * method — it must not turn the till's own screen into a 500.
   */
  async availabilityFor(merchantId: string): Promise<ProviderAvailability> {
    if (!this.transport.configured) {
      return { available: false, unavailableReason: this.transport.unavailableReason };
    }
    let chargeable: boolean;
    try {
      chargeable = await this.transport.canChargeFor(merchantId);
    } catch {
      chargeable = false;
    }
    return chargeable
      ? { available: true, unavailableReason: null }
      : {
          available: false,
          unavailableReason:
            'This café has not connected a Mercado Pago account, and this deployment has no token of its own.',
        };
  }

  /**
   * The terminal the attempt will hold. The transport owns the value (it came from the
   * terminal list and is never rebuilt from parts), and the attempt records it so the
   * database can enforce one open order per terminal — plan D4, our own version of the
   * vendor's `409 already_queued_order_for_terminal`.
   */
  get terminalId(): string | null {
    return this.transport.terminalId;
  }

  async capture(request: ProviderCaptureRequest): Promise<ProviderOutcome> {
    try {
      const snapshot = await this.transport.createOrder({
        // WHOSE ACCOUNT this order is for: the credential to ask the vendor with is the
        // merchant's, not the deployment's (plan D7).
        merchantId: request.merchantId,
        // OUR identity, not the provider's: it is what lets a terminal payment be
        // matched to a sale later, which the research records as the chore the
        // attempt record exists to remove.
        externalReference: request.commandIdentity,
        amountMinorUnits: request.amountMinorUnits,
        currency: request.currency,
        description: `UmiPOS ${request.cartId}`,
      });
      // The amounts the customer actually paid ride along inside `outcomeFromSnapshot`:
      // the mapper in `tender-domain.ts` is the ONE place a snapshot becomes an outcome,
      // and it is property-tested. A second copy here would be a second answer.
      return outcomeFromSnapshot(snapshot);
    } catch (error) {
      return transportFailureOutcome(describe(error));
    }
  }

  async query(request: ProviderQueryRequest): Promise<ProviderOutcome> {
    // Without an order id there is nothing at the terminal to read. That is an
    // unknown, and saying so is what sends the operator to ask the provider rather
    // than to take the card again.
    if (!request.providerOrderId) {
      return {
        kind: 'unknown',
        providerStatus: 'no_order_on_terminal',
        code: 'TERMINAL_ORDER_UNKNOWN',
        message:
          'There is no order id recorded for this attempt, so the terminal has nothing to report.',
        providerOrderId: null,
        queryAfterSeconds: 0,
      };
    }
    try {
      const snapshot = await this.transport.readOrder(request.providerOrderId, request.merchantId);
      // The amounts the customer actually paid ride along inside `outcomeFromSnapshot`:
      // the mapper in `tender-domain.ts` is the ONE place a snapshot becomes an outcome,
      // and it is property-tested. A second copy here would be a second answer.
      return outcomeFromSnapshot(snapshot);
    } catch (error) {
      return transportFailureOutcome(describe(error));
    }
  }

  /**
   * GIVE MONEY BACK (plan §4 phase 4; note 01 §4).
   *
   * The same two rules that shape `capture` and `query` shape this: without an order id the
   * terminal has nothing to reverse, which is an ANSWER (`unknown`) rather than a throw, and
   * a transport that throws becomes `unknown`, never a decline — our network failure is not
   * a statement about the customer's money (note 01 §7.1).
   *
   * The vendor's answer is then read for the ONE thing we may assert: a refund id. A
   * `refunded` or `processed` answer WITHOUT one is not a refund we can point at, so it is
   * an unknown here exactly as a capture with no payment id is — the proof is the id, and
   * without it the operation is still a question (plan §8G step 3).
   */
  async refund(request: ProviderRefundRequest): Promise<ProviderRefundOutcome> {
    if (!request.providerOrderId) {
      return {
        kind: 'unknown',
        providerStatus: 'no_order_on_terminal',
        code: 'TERMINAL_ORDER_UNKNOWN',
        message:
          'There is no order id recorded for this attempt, so the terminal has nothing to refund.',
        providerRefundId: null,
      };
    }
    try {
      return refundOutcomeFromSnapshot(
        await this.transport.refundOrder({
          orderId: request.providerOrderId,
          merchantId: request.merchantId,
          paymentId: request.providerPaymentId,
          amountMinorUnits: request.amountMinorUnits,
          commandIdentity: request.commandIdentity,
        }),
      );
    } catch (error) {
      /**
       * THE ONE PLACE A VENDOR'S 4xx IS A DECLINE, and the reason is the question being
       * asked. A capture's 4xx says something about OUR request (`required_properties`,
       * `already_queued_order_for_terminal`) and nothing about the customer's card, which
       * is why a capture never reads one as a decline. A refund's 4xx is an ANSWER about
       * THIS refund: the vendor refuses it because the order has a tip, because the period
       * closed, because the amount exceeds what is left, or because it is already refunded
       * (note 01 §4.4). Those are statements that the money did NOT move, and the operator
       * needs the vendor's own code to act on. Everything else — a 5xx, a 429, a dead
       * socket, a configured-credential problem — stays `unknown`, because none of them
       * says whether money moved.
       */
      if (
        error instanceof MercadoPagoPointError &&
        !error.retryable &&
        !error.configuration &&
        error.status >= 400 &&
        error.status < 500
      ) {
        return {
          kind: 'declined',
          providerStatus: 'refused',
          code: error.code,
          message: describe(error),
        };
      }
      return {
        kind: 'unknown',
        providerStatus: 'unreachable',
        code: 'PROVIDER_TRANSPORT_FAILURE',
        message: describe(error),
        providerRefundId: null,
      };
    }
  }

  /**
   * ASK ABOUT A REFUND WE ALREADY ASKED FOR — the read that closes a `processing` one
   * (plan §12.4 item 3, §14.2 D34).
   *
   * NOTHING HERE CAN MOVE MONEY: it is `GET /v1/orders/{order_id}` with the café's own token,
   * and the entry is chosen by the vendor's refund id that the first answer gave us. Without an
   * id there is nothing to look up and nothing to assert, so this answers `unknown` rather than
   * searching by amount — an unattributable refund is exactly the lie this workstream exists to
   * prevent, and "the order has some refund of the right size in it" is not attribution.
   *
   * A transport that throws stays `unknown`, as everywhere else: our socket is not a statement
   * about the customer's money.
   */
  async refundQuery(request: ProviderRefundRequest): Promise<ProviderRefundOutcome> {
    if (!request.providerOrderId || !request.providerRefundId) {
      return {
        kind: 'unknown',
        providerStatus: 'no_refund_to_read',
        code: 'TERMINAL_REFUND_UNATTRIBUTED',
        message:
          'There is no order id and refund id recorded for this attempt, so there is nothing to look up at the terminal.',
        providerRefundId: request.providerRefundId ?? null,
      };
    }
    try {
      const snapshot = await this.transport.readRefund(
        request.providerOrderId,
        request.providerRefundId,
        request.merchantId,
      );
      if (snapshot === null) {
        // The order came back and does not contain this refund. That is an ANSWER — the vendor
        // is not holding a refund of ours — and it must not be read as a settlement.
        return {
          kind: 'unknown',
          providerStatus: 'refund_absent',
          code: 'TERMINAL_REFUND_UNATTRIBUTED',
          message:
            'The terminal answered about the order and does not list this refund, so nothing here proves the money moved.',
          providerRefundId: request.providerRefundId,
        };
      }
      return refundOutcomeFromSnapshot(snapshot);
    } catch (error) {
      return {
        kind: 'unknown',
        providerStatus: 'unreachable',
        code: 'PROVIDER_TRANSPORT_FAILURE',
        message: describe(error),
        providerRefundId: request.providerRefundId,
      };
    }
  }
}

/**
 * WHAT THE VENDOR'S REFUND ANSWER MEANS, kept here rather than in the transport for the
 * same reason `classifyTerminalStatus` is not in the transport: the HTTP layer reports what
 * arrived, and the meaning is ours (note 01 §4.2).
 *
 * `processing` is the case this exists for. The vendor's reference lists it as the refund
 * status, described as "successfully requested and is being processed", while the guide's
 * example shows `processed` — so a refund that has been requested is NOT money that has
 * moved, and reporting it as `refunded` would be exactly the mistake the tender path is
 * built to avoid. Anything we do not recognise is unknown with the vendor's own status on
 * it, never a decline: the money may still be on its way back.
 */
function refundOutcomeFromSnapshot(snapshot: PointRefundSnapshot): ProviderRefundOutcome {
  if (snapshot.status === 'refunded' || snapshot.status === 'processed') {
    // The id is the proof. Without one the vendor has told us a word, not a fact, and the
    // same rule that makes a capture need its payment id applies to the giving-back.
    if (snapshot.refundId === null) {
      return {
        kind: 'unknown',
        providerStatus: snapshot.status,
        code: 'TERMINAL_REFUND_UNVERIFIED',
        message:
          'The terminal reported the refund as settled without a refund id, so nothing here proves the money moved.',
        providerRefundId: null,
      };
    }
    return {
      kind: 'refunded',
      providerStatus: snapshot.status,
      providerRefundId: snapshot.refundId,
      amountMinorUnits: snapshot.amountMinorUnits,
    };
  }

  if (
    snapshot.status === 'failed' ||
    snapshot.status === 'canceled' ||
    snapshot.status === 'expired'
  ) {
    // The vendor's status is the code the operator sees: there is no separate refund code
    // in these three, and inventing one would hide the vendor's own word from the record.
    return {
      kind: 'declined',
      providerStatus: snapshot.status,
      code: snapshot.status,
      message: snapshot.statusDetail,
    };
  }

  // `processing`, and any status this version has not seen. Verbatim, and a question.
  //
  // THE ID TRAVELS WITH THE QUESTION (plan §14.2 D34). A `processing` refund is not money
  // that moved, so it is still `unknown` — but the vendor HAS told us which refund it is, and
  // dropping that id is what made the state permanent: the later read of `transactions.refunds[]`
  // would have no way to know which entry is ours, and matching on the amount instead would be
  // guessing at money.
  return {
    kind: 'unknown',
    providerStatus: snapshot.status,
    code: null,
    message: snapshot.statusDetail,
    providerRefundId: snapshot.refundId,
  };
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message.slice(0, 400) : 'The terminal could not be reached.';
