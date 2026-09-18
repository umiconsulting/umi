import type { TenderFamily } from '@umi/contract';
import type {
  ProviderCaptureRequest,
  ProviderOutcome,
  ProviderQueryRequest,
  TenderProviderPort,
} from '../tender-provider.port';

/**
 * CASH, AS A MEMBER OF THE SAME INTERFACE AND NOT A SPECIAL CASE ABOVE IT.
 *
 * §8G step 6 says cash is a tender behind the interface like any other, and it is the
 * one tender whose proof is not a provider's: the drawer is the proof, so a cash
 * capture succeeds with `proofSource: 'cash'` and no payment id. Nothing in the till's
 * existing cash path changes — the checkout still takes cash exactly as it did (its
 * `recordPaymentOutcome` inserts the attempt row it always did, now declaring
 * `proof_source = 'cash'`). This class exists so that the till's *provider list* can
 * offer cash through the same door as the others, and so that a till which asks to
 * capture cash gets an answer instead of a missing provider.
 *
 * Cash is always available: it needs no credentials, no device and no network. That is
 * also why it is the last tender standing when the network is gone (workstream K).
 */
export class CashProvider implements TenderProviderPort {
  readonly id = 'cash';
  readonly family: TenderFamily = 'cash';
  readonly available = true;
  readonly unavailableReason = null;

  capture(_request: ProviderCaptureRequest): Promise<ProviderOutcome> {
    // The money is taken by the operator, and the drawer is the record. There is
    // nothing to call, so the answer is immediate and it is not an unknown.
    return Promise.resolve({
      kind: 'succeeded',
      providerStatus: 'drawer',
      providerOrderId: null,
      providerPaymentId: null,
    });
  }

  query(request: ProviderQueryRequest): Promise<ProviderOutcome> {
    // A cash attempt that is somehow unresolved is answered from what we already hold:
    // the drawer does not have a status endpoint, and pretending otherwise would send
    // an operator looking for a payment that was never electronic.
    return Promise.resolve({
      kind: 'unknown',
      providerStatus: 'drawer_no_status_endpoint',
      code: 'CASH_HAS_NO_PROVIDER_STATUS',
      message: 'Cash has no provider to ask. An unresolved cash attempt is resolved at the drawer.',
      providerOrderId: request.providerOrderId,
      queryAfterSeconds: 0,
    });
  }
}
