import { createHash } from 'node:crypto';
import {
  PacRefusalError,
  type FiscalPacPort,
  type PacCancelRequest,
  type PacStampRequest,
  type PacStampResponse,
} from '../fiscal-pac.port';

/**
 * THE INSTRUMENT, NOT A PAC — the fiscal half of `ScriptedTerminalProvider`.
 *
 * §8G's acceptance is "a cancelled sale cancels its fiscal document", and proving it
 * needs a PAC that can be made to refuse on demand, plus a count of what it was asked.
 * A live Facturapi account cannot produce a refusal on purpose, cannot be asked to
 * fail twice in a row, and would cost a timbre for every assertion.
 *
 * It is registered ONLY when `TENDER_SCRIPTED_PROVIDERS` is on (see `fiscal.module.ts`),
 * so no deployment can stamp a real CFDI through the fake by accident — and it keeps
 * `stampCalls`/`cancelCalls`, which is how "the PAC was called exactly once" is
 * asserted as a fact rather than as a reading of the service's source.
 *
 * The folio is DETERMINISTIC per sale: stamping one sale twice (which the service must
 * never do) produces the same UUID, so a duplicate is visible in the data as well as in
 * the call count.
 */
export type ScriptedPacBehaviour =
  /** The PAC stamped the CFDI and answers with a folio. */
  | 'accept'
  /** The PAC answered and said no. A refusal, with a sentence. */
  | 'refuse'
  /** The transport failed — our network, not the SAT's mind. Also a refusal to the caller. */
  | 'throw';

export class ScriptedPacProvider implements FiscalPacPort {
  readonly id: string;
  /** Every stamp this fake was asked to perform. The "called exactly once" proof. */
  readonly stampCalls: PacStampRequest[] = [];
  /** Every cancellation it was asked to perform. */
  readonly cancelCalls: PacCancelRequest[] = [];

  private plan: ScriptedPacBehaviour[];

  constructor(plan: ScriptedPacBehaviour[] = ['accept'], id = 'scripted_pac') {
    this.plan = [...plan];
    this.id = id;
  }

  /** Re-arm the fake. The last behaviour repeats once the script is exhausted. */
  script(plan: ScriptedPacBehaviour[]): void {
    this.plan = [...plan];
  }

  reset(): void {
    this.stampCalls.length = 0;
    this.cancelCalls.length = 0;
  }

  get available(): boolean {
    return true;
  }

  get unavailableReason(): string | null {
    return null;
  }

  stamp(request: PacStampRequest, _apiKey: string | null): Promise<PacStampResponse> {
    this.stampCalls.push(request);
    switch (this.next()) {
      case 'accept':
        return Promise.resolve({
          providerDocumentId: `pac_doc_${request.saleId.slice(0, 8)}`,
          uuidFolio: deterministicFolio(request.saleId),
          xmlUrl: null,
          pdfUrl: null,
        });
      case 'refuse':
        return Promise.reject(new PacRefusalError('PAC_REFUSED', 'The issuer refused this CFDI.'));
      case 'throw':
      default:
        return Promise.reject(new Error('The PAC could not be reached.'));
    }
  }

  cancel(request: PacCancelRequest, _apiKey: string | null): Promise<void> {
    this.cancelCalls.push(request);
    switch (this.next()) {
      case 'accept':
        return Promise.resolve();
      case 'refuse':
        return Promise.reject(
          new PacRefusalError('PAC_CANCEL_REFUSED', 'The PAC refused to cancel this CFDI.'),
        );
      case 'throw':
      default:
        return Promise.reject(new Error('The PAC could not be reached.'));
    }
  }

  private next(): ScriptedPacBehaviour {
    return this.plan.length > 1 ? (this.plan.shift() as ScriptedPacBehaviour) : this.plan[0];
  }
}

/** The same sale always yields the same folio, so a duplicate stamp is visible in the data. */
export function deterministicFolio(saleId: string): string {
  const hex = createHash('sha1').update(saleId).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = '8';
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
