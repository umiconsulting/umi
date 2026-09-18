import type { TenderFamily } from '@umi/contract';
import type {
  ProviderCaptureRequest,
  ProviderOutcome,
  ProviderQueryRequest,
  TenderProviderPort,
} from '../tender-provider.port';

/**
 * THE MANUAL TERMINAL — a card machine we do not control, whose screen only a person
 * can read.
 *
 * This is the honest modelling of a path the platform already had, and it is why the
 * `manual_terminal` tender in `pos-checkout.ts` exists at all. Asking it to capture is
 * not a request we can make, so `capture` answers **unknown** — and it keeps answering
 * unknown, because there is no endpoint that will ever tell us otherwise. The customer's
 * card was taken by a device outside our integration; the operator reads its screen and
 * that reading is an `operator_attested` success at commit, NOT a provider capture and
 * not this class's answer.
 *
 * That distinction is the whole of §8G step 3's last sentence, made structural: this
 * provider CANNOT produce a success. If it could, the operator's word would arrive
 * wearing a provider's clothes.
 */
export class ManualTerminalProvider implements TenderProviderPort {
  readonly id = 'manual_terminal';
  /**
   * NOT `card_present`. This adapter can only ever answer `unknown`, and
   * `card_present` means "a device that answers". Grouped with the real card
   * integrations it was the first available card-present provider the till
   * found, so a cashier who chose "Terminal de tarjeta" captured against THIS
   * adapter and waited for a terminal that had no order. The till's rule — "the
   * first available `card_present` provider" — is right; the family was wrong.
   */
  readonly family: TenderFamily = 'operator_attested';
  readonly available = true;
  readonly unavailableReason = null;

  capture(request: ProviderCaptureRequest): Promise<ProviderOutcome> {
    return Promise.resolve(this.pendingAnswer(request.commandIdentity));
  }

  query(request: ProviderQueryRequest): Promise<ProviderOutcome> {
    return Promise.resolve(this.pendingAnswer(request.commandIdentity));
  }

  /**
   * The `awaiting_operator_confirmation` state `ManualTerminalOutcome` already names:
   * the money may well have been taken, and the record must say that we do not know.
   */
  private pendingAnswer(commandIdentity: string): ProviderOutcome {
    return {
      kind: 'unknown',
      providerStatus: 'awaiting_operator_confirmation',
      code: 'MANUAL_TERMINAL_REQUIRES_A_PERSON',
      message: `The outcome of attempt ${commandIdentity} is on a terminal screen. Only the operator can read it, and only the operator's confirmation can settle it.`,
      providerOrderId: null,
      // A person settles this in seconds or not at all; the clock is here so the
      // attempt does not sit unresolved forever without anyone being told.
      queryAfterSeconds: 120,
    };
  }
}
