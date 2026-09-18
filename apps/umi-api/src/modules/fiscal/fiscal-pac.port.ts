import type { FiscalReceptor } from '@umi/contract';

/**
 * THE PAC BEHIND ONE INTERFACE — the fiscal half of `TenderProviderPort`.
 *
 * The terminal's port exists because a second terminal brand must not touch checkout
 * (§8G step 6). This one exists for the same reason and one more: Facturapi is the
 * first PAC, not the only one that will ever stamp a CFDI, and the state machine in
 * `fiscal.service.ts` must not know which one it is talking to.
 *
 * THE ONE RULE THAT SHAPES THIS FILE: a PAC that throws is a REFUSAL, never a stamp.
 * The caller persists the attempt BEFORE the call and records `stamped` only from a
 * response that carries a folio — so a provider that fails, times out or answers with
 * something unreadable leaves an `error` row rather than a fiscal document the SAT
 * has never heard of.
 *
 * MONEY IS INTEGER MINOR UNITS. There is no float in this file; the concrete adapter
 * is the only place that turns minor units into the decimal string a PAC's JSON wants.
 */

export interface PacStampRequest {
  /** The sale's own identity — the cart id, the way the rest of the platform names a sale. */
  readonly saleId: string;
  readonly receptor: FiscalReceptor;
  /** SAT c_UsoCFDI, already resolved (the request's override or the receptor's default). */
  readonly uso: string;
  /** SAT c_FormaPago, two digits. */
  readonly paymentForm: string;
  /** SAT c_MetodoPago. */
  readonly paymentMethod: 'PUE' | 'PPD';
  readonly totalMinorUnits: number;
  readonly currency: string;
  /** What the single concept line says. Built server-side; never the operator's free text. */
  readonly description: string;
}

export interface PacStampResponse {
  /** The PAC's own document id. REQUIRED to cancel, which is why the row stores it. */
  readonly providerDocumentId: string;
  /** The SAT folio fiscal. A response without one is a refusal (see the class below). */
  readonly uuidFolio: string;
  readonly xmlUrl: string | null;
  readonly pdfUrl: string | null;
}

export interface PacCancelRequest {
  readonly providerDocumentId: string;
  /** SAT cancellation motive: 01 … 04. */
  readonly motive: '01' | '02' | '03' | '04';
  /** The CFDI that substitutes the cancelled one; null for motive 02, which needs none. */
  readonly substitutionUuid: string | null;
}

export interface FiscalPacPort {
  /** The registry key, e.g. `facturapi`, `scripted_pac`. */
  readonly id: string;
  /**
   * False when this deployment cannot reach the PAC at all (missing credentials). A
   * stamp button offered without credentials is a button that fails after the customer
   * has decided, so the state machine checks this BEFORE it writes anything.
   */
  readonly available: boolean;
  /** Why it is unavailable, when it is. Names the missing configuration, never a value. */
  readonly unavailableReason: string | null;

  /** Stamp a nominative CFDI. Called at most once per sale that is not already stamped. */
  stamp(request: PacStampRequest, apiKey: string | null): Promise<PacStampResponse>;

  /** Cancel a CFDI at the SAT. Resolving means the SAT accepted the cancellation. */
  cancel(request: PacCancelRequest, apiKey: string | null): Promise<void>;
}

/** DI token for the one PAC this deployment talks to. */
export const FISCAL_PAC_PORT = 'FISCAL_PAC_PORT';

/**
 * The PAC answered, and the answer says no. Its own words travel in `message` so the
 * row (`fiscal_document.error_message`) and the operator both get a sentence rather
 * than a stack trace — and never the raw payload.
 */
export class PacRefusalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PacRefusalError';
  }
}

/**
 * The PAC cannot be reached or is not configured. Distinct from a refusal because the
 * operator's sentence is different: "we have no credentials for the PAC" is a
 * deployment gap, "the PAC refused this invoice" is a fact about this stamp.
 */
export class PacUnavailableError extends Error {
  constructor(
    readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = 'PacUnavailableError';
  }
}

/**
 * A refusal's sentence, bounded to what `error_message` and the contract allow (500
 * characters) so a chatty provider cannot push the API's own answer past its limit.
 */
export const pacRefusalMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const trimmed = message.trim();
  return (trimmed.length === 0 ? 'The PAC refused the request.' : trimmed).slice(0, 500);
};
