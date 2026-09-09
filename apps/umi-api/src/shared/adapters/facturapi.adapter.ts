import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';

// Facturapi is Umi's chosen PAC front (ADR 2026-09-08). Multi-tenant model: one master USER
// KEY manages "Organizations" (one per merchant emisor, each holding that merchant's RFC + CSD);
// each Organization has its own live/test SECRET KEY, used to stamp on that merchant's behalf.
// This adapter is pure I/O over the Facturapi REST API — the receipt→CFDI MAPPING and the
// persistence live in the fiscal module (deferred until the data model + a contador's catalog
// review land), exactly as the Zettle adapter left its sync mapping to the processor.
//
// ⚠ Not yet exercised against the live API — there are no test keys in this environment. It is
// verified only by mocked-fetch specs (request shape + error contract). Confirm against
// Facturapi's sandbox before wiring a live flow (Fase 3b).

const DEFAULT_BASE_URL = 'https://www.facturapi.io/v2';

// Minimal shapes at the wire — the full CFDI payload is built (and validated) in the fiscal
// module against contador-reviewed SAT catalogs, not here.
export interface FacturapiInvoice {
  customer: unknown; // a Facturapi customer object or an existing customer id
  items: unknown[];
  payment_form: string; // SAT c_FormaPago (e.g. '01' efectivo, '04' tarjeta)
  use?: string; // SAT c_UsoCFDI
  type?: 'I' | 'E' | 'P'; // Ingreso / Egreso / Pago
}

export interface FacturapiReceipt {
  items: unknown[];
  payment_form?: string;
  // With `global` set the receipt feeds the period's factura global; without it, the customer
  // can self-invoice it via the QR link Facturapi returns.
  global?: { periodicity: string; months: string; year: number };
}

@Injectable()
export class FacturapiAdapter {
  private readonly logger = new Logger(FacturapiAdapter.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private baseUrl(): string {
    return this.config.get('FACTURAPI_BASE_URL', { infer: true }) || DEFAULT_BASE_URL;
  }

  // Facturapi authenticates like Stripe: HTTP Basic with the API key as the username and an
  // empty password → `Authorization: Basic base64("<key>:")`.
  private authHeader(apiKey: string): string {
    return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
  }

  private async request<T>(
    apiKey: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    // Bound the external call so a hung socket can't stall the caller (and its retries).
    const res = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers: {
        Authorization: this.authHeader(apiKey),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Facturapi API error: ${res.status} - ${text}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Create an issuing Organization (one per merchant emisor), using the master USER KEY.
   * Returns null when unconfigured — a deliberate skip (like the Zettle adapter) so callers
   * no-op instead of throwing before the integration is provisioned.
   */
  async createOrganization(
    organization: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const userKey = this.config.get('FACTURAPI_USER_KEY', { infer: true });
    if (!userKey) {
      this.logger.warn('facturapi_adapter_missing_user_key');
      return null;
    }
    return this.request(userKey, 'POST', '/organizations', organization);
  }

  /** Stamp a nominative CFDI for a merchant, using that merchant's Organization secret key. */
  stampInvoice(apiKey: string, invoice: FacturapiInvoice): Promise<Record<string, unknown>> {
    return this.request(apiKey, 'POST', '/invoices', invoice);
  }

  /** Create an e-receipt (feeds the factura global, or is self-invoiced via the returned QR). */
  createReceipt(apiKey: string, receipt: FacturapiReceipt): Promise<Record<string, unknown>> {
    return this.request(apiKey, 'POST', '/receipts', receipt);
  }

  /** Read one CFDI's current state (status, uuid) for reconciliation. */
  getInvoice(apiKey: string, invoiceId: string): Promise<Record<string, unknown>> {
    return this.request(apiKey, 'GET', `/invoices/${encodeURIComponent(invoiceId)}`);
  }

  /** Cancel a CFDI with a SAT motive (01–04); returns the acuse de cancelación. */
  cancelInvoice(
    apiKey: string,
    invoiceId: string,
    motive: string,
    substitution?: string,
  ): Promise<Record<string, unknown>> {
    const q = new URLSearchParams({ motive });
    if (substitution) q.set('substitution', substitution);
    return this.request(apiKey, 'DELETE', `/invoices/${encodeURIComponent(invoiceId)}?${q}`);
  }
}
