import type { TenderFamily } from '@umi/contract';
import { transportFailureOutcome } from '../tender-domain';
import type {
  ProviderCaptureRequest,
  ProviderOutcome,
  ProviderQueryRequest,
  TenderProviderPort,
} from '../tender-provider.port';

/**
 * THE INSTRUMENT, NOT A PROVIDER. §8G step 7 asks for a stateful test of the
 * success–failure–unknown sequence, and §8G's Tools line names the fakes as the way to
 * do it without a merchant account: "one that succeeds, one that fails, one that never
 * answers, and one that answers on the query after having been silent".
 *
 * It is registered ONLY when `TENDER_SCRIPTED_PROVIDERS` is on (see `tender.module.ts`),
 * so no deployment can take a customer's money through it by accident, and it keeps the
 * count of what it was asked — which is how "a retried payment never charges twice" is
 * asserted as a FACT rather than as a reading of the source: `captureCalls` has exactly
 * one entry per attempt, always.
 *
 * `silent` is the interesting one. It answers `unknown` with the terminal's own
 * `action_required`, whose primary-source definition is that the terminal did not answer
 * within 40 seconds and its status does not change. A till that reads it as failure is
 * wrong; a till that reads it as success is worse; this fake is how both are proved
 * impossible.
 */
export type ScriptedBehaviour =
  /** The terminal took the money and says so, with a payment id. */
  | 'succeed'
  /** The issuer refused. A real decline, with a code. */
  | 'decline'
  /** `action_required`: asked, no answer, status does not change. */
  | 'silent'
  /** The transport itself failed — our network, not the customer's card. */
  | 'throw'
  /** Silent at capture, and the ANSWER EXISTS when we ask again. */
  | 'answer_on_query'
  /** Says `processed` but withholds the payment id. Must never become a capture. */
  | 'succeed_without_payment_id'
  /** A status this version has never seen. */
  | 'unrecognized';

export class ScriptedTerminalProvider implements TenderProviderPort {
  /** Every command identity this fake was asked to CAPTURE. The double-charge proof. */
  readonly captureCalls: string[] = [];
  /** Every command identity it was asked ABOUT. Queries may repeat; captures may not. */
  readonly queryCalls: string[] = [];

  private plan: ScriptedBehaviour[];

  constructor(
    readonly id: string,
    plan: ScriptedBehaviour[] = ['succeed'],
    readonly family: TenderFamily = 'card_present',
    private readonly queryAfterSeconds = 40,
  ) {
    this.plan = [...plan];
  }

  /** Re-arm the fake. The last behaviour repeats once the script is exhausted. */
  script(plan: ScriptedBehaviour[]): void {
    this.plan = [...plan];
  }

  reset(): void {
    this.captureCalls.length = 0;
    this.queryCalls.length = 0;
  }

  get available(): boolean {
    return true;
  }

  get unavailableReason(): string | null {
    return null;
  }

  capture(request: ProviderCaptureRequest): Promise<ProviderOutcome> {
    this.captureCalls.push(request.commandIdentity);
    const behaviour =
      this.plan.length > 1 ? (this.plan.shift() as ScriptedBehaviour) : this.plan[0];
    return Promise.resolve(this.answerFor(behaviour, request.commandIdentity, false));
  }

  query(request: ProviderQueryRequest): Promise<ProviderOutcome> {
    this.queryCalls.push(request.commandIdentity);
    const behaviour =
      this.plan.length > 1 ? (this.plan.shift() as ScriptedBehaviour) : this.plan[0];
    return Promise.resolve(this.answerFor(behaviour, request.commandIdentity, true));
  }

  private answerFor(
    behaviour: ScriptedBehaviour,
    commandIdentity: string,
    isQuery: boolean,
  ): ProviderOutcome {
    switch (behaviour) {
      case 'succeed':
        return {
          kind: 'succeeded',
          providerStatus: 'processed',
          providerOrderId: `order_${commandIdentity.slice(0, 8)}`,
          providerPaymentId: `pay_${commandIdentity.slice(0, 8)}`,
        };
      case 'succeed_without_payment_id':
        return {
          kind: 'succeeded',
          providerStatus: 'processed',
          providerOrderId: `order_${commandIdentity.slice(0, 8)}`,
          providerPaymentId: null,
        };
      case 'decline':
        return {
          kind: 'declined',
          providerStatus: 'failed',
          code: 'CARD_DECLINED',
          message: 'The issuer refused the card.',
          providerOrderId: `order_${commandIdentity.slice(0, 8)}`,
        };
      case 'throw':
        return transportFailureOutcome('The terminal could not be reached.');
      case 'unrecognized':
        return {
          kind: 'unknown',
          providerStatus: 'superseded_by_terminal_firmware',
          code: 'TERMINAL_STATUS_UNRECOGNIZED',
          message: 'The terminal reported a status this version does not recognise.',
          providerOrderId: `order_${commandIdentity.slice(0, 8)}`,
          queryAfterSeconds: this.queryAfterSeconds,
        };
      case 'answer_on_query':
        // Silent while the card is in the slot; the answer exists afterwards. This is
        // the only behaviour whose answer differs between the two calls.
        return isQuery
          ? {
              kind: 'succeeded',
              providerStatus: 'processed',
              providerOrderId: `order_${commandIdentity.slice(0, 8)}`,
              providerPaymentId: `pay_${commandIdentity.slice(0, 8)}`,
            }
          : {
              kind: 'unknown',
              providerStatus: 'at_terminal',
              code: 'TERMINAL_STILL_WORKING',
              message: null,
              providerOrderId: `order_${commandIdentity.slice(0, 8)}`,
              queryAfterSeconds: this.queryAfterSeconds,
            };
      case 'silent':
      default:
        return {
          kind: 'unknown',
          providerStatus: 'action_required',
          code: 'TERMINAL_ACTION_REQUIRED',
          message: null,
          providerOrderId: `order_${commandIdentity.slice(0, 8)}`,
          queryAfterSeconds: this.queryAfterSeconds,
        };
    }
  }
}
