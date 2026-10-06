import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FacturapiAdapter,
  type FacturapiInvoice,
} from '../../../shared/adapters/facturapi.adapter';
import type { AppConfig } from '../../../shared/config/config.schema';
import {
  PacRefusalError,
  PacUnavailableError,
  type FiscalPacPort,
  type PacCancelRequest,
  type PacStampRequest,
  type PacStampResponse,
} from '../fiscal-pac.port';

/** The two variables a stamp needs. Named so an unavailable port can say WHICH one. */
const PAC_VARIABLES = ['FACTURAPI_USER_KEY', 'FACTURAPI_ORGANIZATION_SECRET'] as const;

/**
 * THE PAC, OVER THE ADAPTER THAT ALREADY EXISTS.
 *
 * `FacturapiAdapter` is the only place this platform's HTTP client for Facturapi lives
 * (ADR 2026-09-08), and it is `@Global`, so this provider injects it rather than
 * building a second client. What lives HERE is the translation the adapter deliberately
 * left out: a `PacStampRequest` (our vocabulary) into a Facturapi invoice (theirs), and
 * their answer back into a folio and a provider document id.
 *
 * NOTHING IN THIS FILE IS EXERCISED BY A TEST. The acceptance suite drives
 * `ScriptedPacProvider`; this adapter is reached only in a deployment that holds real
 * credentials, and it says so about itself through `available` when it holds none.
 *
 * WHAT THE ADAPTER'S SPEC ALREADY PROVED, and what this file must not re-prove: the
 * request shape (Basic auth with the key as username), the 20-second bound and the
 * error contract. Here we only have to be honest about the two ways Facturapi can
 * answer without stamping anything — an HTTP failure (the adapter throws) and a body
 * with no UUID (refused here rather than recorded as a folio).
 */
@Injectable()
export class FacturapiPacProvider implements FiscalPacPort {
  readonly id = 'facturapi';

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly adapter: FacturapiAdapter,
  ) {}

  /** The first missing variable, or null when the deployment can stamp. */
  private missingVariable(): string | null {
    for (const name of PAC_VARIABLES) {
      if (!this.config.get(name, { infer: true })) return name;
    }
    return null;
  }

  get available(): boolean {
    return this.missingVariable() === null;
  }

  get unavailableReason(): string | null {
    const missing = this.missingVariable();
    if (missing === null) return null;
    return (
      `${missing} is not set, so this deployment cannot stamp a CFDI. ` +
      'Facturapi credentials are configuration, and a stamp attempted without them ' +
      'would fail after the sale was already committed.'
    );
  }

  async stamp(request: PacStampRequest, apiKey: string | null): Promise<PacStampResponse> {
    const key = this.requireKey(apiKey);
    const answer = await this.adapter.stampInvoice(key, invoiceFor(request));

    // A 2xx body without a folio is NOT a stamp. Recording it as one would put a
    // document in the owner's fiscal lens that the SAT has never seen, which is worse
    // than an error row an operator can retry.
    const providerDocumentId = asText(answer.id);
    const uuidFolio = asText(answer.uuid);
    if (providerDocumentId === null || uuidFolio === null) {
      throw new PacRefusalError(
        'FACTURAPI_RESPONSE_UNREADABLE',
        'Facturapi answered without a document id and a UUID, so nothing was recorded as stamped.',
      );
    }

    return {
      providerDocumentId,
      uuidFolio,
      // Facturapi serves the XML and PDF by document id, and `merchant.fiscal_document`
      // has no column for either, so the API reports them as absent. The stored
      // reference IS `providerDocumentId`.
      xmlUrl: null,
      pdfUrl: null,
    };
  }

  async cancel(request: PacCancelRequest, apiKey: string | null): Promise<void> {
    const key = this.requireKey(apiKey);
    // Resolving is the confirmation: the adapter throws on any non-2xx, and the SAT
    // answers a cancellation it accepted with the acuse. Anything else propagates as a
    // refusal and the caller leaves the document stamped.
    await this.adapter.cancelInvoice(
      key,
      request.providerDocumentId,
      request.motive,
      request.substitutionUuid ?? undefined,
    );
  }

  /**
   * The key a call travels with. `apiKey` is the seam for a per-merchant Organization
   * secret — the port takes it per call — and until the merchant's fiscal profile
   * carries its own, the configured one is what this deployment has.
   */
  private requireKey(apiKey: string | null): string {
    if (apiKey) return apiKey;
    const missing = this.missingVariable();
    if (missing !== null) {
      throw new PacUnavailableError(
        missing,
        `${missing} is not set: the PAC is unreachable from this deployment.`,
      );
    }
    return this.config.get('FACTURAPI_ORGANIZATION_SECRET', { infer: true });
  }
}

/**
 * Our stamp request as Facturapi's invoice payload.
 *
 * THE RECEIPT→CFDI LINE AND TAX MAPPING IS NOT INVENTED HERE. `fiscal.ts` says it
 * plainly: SAT catalog codes are "contador-reviewed config, never a contract
 * constant". The receipt snapshot's tax lines, the ClaveProdServ and the ClaveUnidad
 * for a café's products are that review's output, so this builds the minimum the PAC
 * can accept — one concept line for the sale's total, the receptor's fiscal identity,
 * and the payment form and method — and leaves the catalog defaults to Facturapi.
 */
function invoiceFor(request: PacStampRequest): FacturapiInvoice {
  return {
    customer: {
      legal_name: request.receptor.name,
      tax_id: request.receptor.rfc,
      tax_system: request.receptor.regimen,
      address: { zip: request.receptor.postalCode },
      email: request.receptor.email,
    },
    items: [
      {
        quantity: 1,
        product: {
          description: request.description,
          price: decimalMinorUnits(request.totalMinorUnits),
        },
      },
    ],
    payment_form: request.paymentForm,
    use: request.uso,
    type: 'I',
  };
}

/** `1005` → `'10.05'`: the integer part and the cents are padded by hand, never by a float. */
export function decimalMinorUnits(minorUnits: number): string {
  const sign = minorUnits < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(minorUnits));
  const whole = Math.trunc(absolute / 100);
  const cents = String(absolute % 100).padStart(2, '0');
  return `${sign}${whole}.${cents}`;
}

const asText = (value: unknown): string | null => {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};
