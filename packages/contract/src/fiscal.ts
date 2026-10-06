import { z } from 'zod';
import { IsoTimestamp, Uuid } from './platform';

// CFDI 4.0 (facturación mexicana). The ticket is the sale document (receipt_snapshot); the
// CFDI is a SEPARATE fiscal document stamped by a PAC — Facturapi first (ADR 2026-09-08). These
// are the shared shapes the fiscal module and the dashboard use. SAT catalog codes (Régimen
// Fiscal, Uso, ClaveProdServ, ClaveUnidad) are validated as strings here, not enumerated: the
// concrete catalog mapping is contador-reviewed config, never a contract constant.

const Money = z.number().int().nonnegative();

// SAT c_RegimenFiscal — a 3-digit code (e.g. 601, 612, 626). Not enumerated on purpose.
export const RegimenFiscal = z.string().regex(/^\d{3}$/);
export type RegimenFiscal = z.infer<typeof RegimenFiscal>;

// SAT c_UsoCFDI — a short code (e.g. G01, G03, S01, P01, CP01). Kept flexible, not enumerated.
export const UsoCfdi = z.string().regex(/^[A-Z]{1,4}[0-9]{1,3}$/);
export type UsoCfdi = z.infer<typeof UsoCfdi>;

// SAT RFC: 12 (persona moral) or 13 (persona física) chars. XAXX010101000 = público en general
// (the receptor of a factura global).
export const Rfc = z.string().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/);
export type Rfc = z.infer<typeof Rfc>;

// The customer's fiscal identity, captured once and reused. Every field must match the SAT
// exactly or the timbrado is rejected — a wrong Código Postal is the #1 rejection cause.
export const FiscalReceptor = z
  .object({
    rfc: Rfc,
    name: z.string().min(1).max(254), // razón social, exact per SAT
    postalCode: z.string().regex(/^\d{5}$/), // CP fiscal
    regimen: RegimenFiscal,
    uso: UsoCfdi,
    email: z.string().email().max(254).optional(),
  })
  .strict();
export type FiscalReceptor = z.infer<typeof FiscalReceptor>;

export const CfdiKind = z.enum(['nominative', 'global']);
export type CfdiKind = z.infer<typeof CfdiKind>;

// The per-ticket fiscal lifecycle. `not_invoiced` and `pending_self_invoice` are pre-CFDI;
// `in_global` means the ticket rolled into the period's factura global; `stamped` is a
// nominative CFDI carrying a UUID; `error` is a failed timbrado to retry.
export const CfdiStatus = z.enum([
  'not_invoiced',
  'pending_self_invoice',
  'in_global',
  'stamped',
  'cancelled',
  'error',
]);
export type CfdiStatus = z.infer<typeof CfdiStatus>;

// The CFDI document as the dashboard reads it (the fiscal lens on a sale). The XML/PDF live at
// the PAC / object storage; here we keep references, not the payload.
export const CfdiDocument = z
  .object({
    id: Uuid,
    saleId: Uuid.nullable(),
    kind: CfdiKind,
    status: CfdiStatus,
    uuid: z.string().uuid().nullable(), // SAT folio fiscal (UUID), once stamped
    total: Money,
    currency: z.string().regex(/^[A-Z]{3}$/),
    receptorRfc: Rfc.nullable(),
    issuedAt: IsoTimestamp.nullable(),
    xmlUrl: z.string().url().nullable(),
    pdfUrl: z.string().url().nullable(),
    errorMessage: z.string().max(500).nullable(),
  })
  .strict();
export type CfdiDocument = z.infer<typeof CfdiDocument>;

// A request to stamp a nominative CFDI for a committed sale. The line/catalog mapping from the
// receipt snapshot is built server-side (contador-reviewed); this is the caller's intent.
export const CfdiStampRequest = z
  .object({
    saleId: Uuid,
    receptor: FiscalReceptor,
    // May override the receptor's default Uso for this one invoice.
    uso: UsoCfdi.optional(),
  })
  .strict();
export type CfdiStampRequest = z.infer<typeof CfdiStampRequest>;

export const fiscalModels = {
  RegimenFiscal,
  UsoCfdi,
  Rfc,
  FiscalReceptor,
  CfdiKind,
  CfdiStatus,
  CfdiDocument,
  CfdiStampRequest,
} as const;
