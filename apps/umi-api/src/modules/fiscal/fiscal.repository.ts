import { Injectable } from '@nestjs/common';
import type {
  CfdiDeadlineKind,
  CfdiKind,
  CfdiPaymentMethod,
  CfdiStatus,
  FiscalDocument,
} from '@umi/contract';
import type { PoolClient } from 'pg';
import { getRequestContext } from '../../shared/database/request-context';
import { PgService } from '../../shared/database/pg.service';
import { needsReceiverAcceptance, type CancellationMotive } from '../tender/tender-domain';

/**
 * THE FISCAL DOCUMENT'S SQL — `merchant.fiscal_document`, and nothing else.
 *
 * WHY THE TABLE IS THE STATE MACHINE AND NOT A CACHE OF ONE. The row is the fiscal
 * lens on a sale: it carries the CFDI's own status, its SAT folio, the receptor's
 * fiscal identity and the payment form and method. Two of the table's CHECK
 * constraints make the state unforgeable — `fiscal_document_stamped_shape` says a
 * `stamped` row HAS a folio and a timestamp, and `fiscal_document_cancelled_shape`
 * says a `cancelled` row has its moment and its motive — so every write below is
 * written to satisfy them rather than to be believed by the service.
 *
 * HOW A SALE FINDS ITS DOCUMENT. A sale is a CART: `pos_committed_sale` is the join
 * that says "this cart became this order, on this receipt", so the read joins through
 * it and reports the cart id as `saleId`. That is why a document row stores `order_id`
 * and the API still speaks about sales.
 *
 * READS AND WRITES TAKE A CLIENT; `runScoped` is the only place a transaction is
 * opened. The rule is procurement's: the caller decides the unit of work (a stamp is
 * two commits with a provider call between them; a cancellation is one statement set
 * inside the sale's own command), and this file never opens or commits one behind its
 * caller's back.
 */

/**
 * The contract's `FiscalDocument` plus the ONE answer the SAT's cancellation rule
 * needs the owner to see: whether cancelling this document would wait on the
 * customer's acceptance.
 *
 * It is carried as an additional field rather than inside the schema because
 * `FiscalDocument` declares no field for it; the response is still a superset of the
 * declared model, which is why every return type below is assignable to it.
 */
export type FiscalDocumentView = FiscalDocument & {
  readonly needsReceiverAcceptance: boolean;
};

/** A committed sale, as the fiscal path needs to know it. */
export interface ResolvedSale {
  readonly orderId: string;
  readonly receiptSnapshotId: string;
  readonly totalMinorUnits: number;
  readonly currency: string;
  /** The printed receipt number — used for the CFDI's concept description. */
  readonly receiptNumber: string;
}

/** Everything the pending row needs. The receptor is flattened: these are the SAT's columns. */
export interface InsertPendingInput {
  readonly merchantId: string;
  readonly locationId: string;
  readonly orderId: string;
  readonly receiptSnapshotId: string | null;
  readonly kind: CfdiKind;
  readonly totalMinorUnits: number;
  readonly currency: string;
  readonly receptorRfc: string | null;
  readonly receptorName: string | null;
  readonly receptorPostalCode: string | null;
  readonly regimenFiscal: string | null;
  readonly usoCfdi: string | null;
  readonly paymentForm: string | null;
  readonly paymentMethod: string | null;
  readonly deadlineAt: Date;
  readonly deadlineKind: CfdiDeadlineKind;
  readonly commandId: string | null;
  readonly idempotencyKey: string | null;
}

export interface MarkStampedInput {
  readonly uuidFolio: string;
  readonly providerDocumentId: string;
}

export interface FiscalCancellationWrite {
  readonly motive: CancellationMotive;
  readonly reason: string;
  readonly cancelledAt: Date;
  readonly commandId: string | null;
  readonly idempotencyKey: string | null;
}

/** The owner's clock view: what time the server thinks it is, and which trading day that is. */
export interface FiscalClock {
  readonly operationAt: Date;
  readonly periodCloseAt: Date;
  readonly businessDate: string;
}

/** The counts model exactly as `FiscalDocumentList.counts` declares it. */
export interface FiscalCounts {
  readonly total: number;
  readonly pending: number;
  readonly stamped: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly withinDeadline: number;
  readonly pastDeadline: number;
}

/** `fiscal_document` joined to the sale it belongs to (`sale_id` is the CART id). */
const DOCUMENT_COLUMNS = `f.id::text AS id,f.merchant_id::text AS merchant_id,
  f.location_id::text AS location_id,f.order_id::text AS order_id,
  f.receipt_snapshot_id::text AS receipt_snapshot_id,s.cart_id::text AS sale_id,
  f.kind,f.status,f.uuid_folio::text AS uuid_folio,f.total_minor_units::text AS total_minor_units,
  f.currency,f.receptor_rfc,f.receptor_name,f.receptor_postal_code,f.regimen_fiscal,f.uso_cfdi,
  f.payment_form,f.payment_method,f.provider_document_id,f.deadline_at,f.deadline_kind,
  f.stamped_at,f.cancelled_at,f.cancellation_motive,f.cancellation_reason,f.error_message,
  f.command_id::text AS command_id,f.idempotency_key::text AS idempotency_key,
  f.created_at,f.updated_at`;

const DOCUMENT_SOURCE = `merchant.fiscal_document f
  LEFT JOIN merchant.pos_committed_sale s
    ON s.merchant_id=f.merchant_id AND s.order_id=f.order_id`;

interface FiscalRow {
  id: string;
  merchant_id: string;
  location_id: string;
  order_id: string;
  receipt_snapshot_id: string | null;
  sale_id: string | null;
  kind: CfdiKind;
  status: CfdiStatus;
  uuid_folio: string | null;
  total_minor_units: string;
  currency: string;
  receptor_rfc: string | null;
  receptor_name: string | null;
  receptor_postal_code: string | null;
  regimen_fiscal: string | null;
  uso_cfdi: string | null;
  payment_form: string | null;
  payment_method: string | null;
  provider_document_id: string | null;
  deadline_at: Date;
  deadline_kind: CfdiDeadlineKind;
  stamped_at: Date | null;
  cancelled_at: Date | null;
  cancellation_motive: string | null;
  cancellation_reason: string | null;
  error_message: string | null;
  command_id: string | null;
  idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * A row as the API reads it.
 *
 * `issuedAt` IS `stamped_at`: the contract's reader asks when the document was issued,
 * and for a CFDI that is the moment the PAC stamped it — the same fact the SAT's folio
 * carries. `xmlUrl`/`pdfUrl` are reported null because `merchant.fiscal_document` HAS
 * NO COLUMN FOR THEM: the stored reference to the PAC's artifacts is
 * `provider_document_id`, and inventing a URL shape here would be a claim this module
 * cannot keep.
 */
export function fiscalDocumentFromRow(row: FiscalRow): FiscalDocumentView {
  const total = Number(row.total_minor_units);
  return {
    id: row.id,
    saleId: row.sale_id,
    kind: row.kind,
    status: row.status,
    uuid: row.uuid_folio,
    total,
    currency: row.currency,
    receptorRfc: row.receptor_rfc,
    issuedAt: row.stamped_at?.toISOString() ?? null,
    xmlUrl: null,
    pdfUrl: null,
    errorMessage: row.error_message,
    locationId: row.location_id,
    deadlineAt: row.deadline_at.toISOString(),
    deadlineKind: row.deadline_kind,
    paymentForm: row.payment_form,
    paymentMethod: (row.payment_method as CfdiPaymentMethod | null) ?? null,
    providerDocumentId: row.provider_document_id,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancellationMotive: (row.cancellation_motive as CancellationMotive | null) ?? null,
    cancellationReason: row.cancellation_reason,
    needsReceiverAcceptance: needsReceiverAcceptance(total),
  };
}

@Injectable()
export class FiscalRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Run `work` in a merchant-scoped transaction on the RLS-enforced app pool — the
   * primitive procurement's repository uses. `runWithMerchant` sets the merchant, the
   * location and the user as transaction-local GUCs, so a statement that forgets its
   * `merchant_id` predicate reads nothing rather than everything.
   */
  runScoped<T>(
    merchantId: string,
    locationId: string | null,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.pg.runWithMerchant(
      merchantId,
      getRequestContext()?.userId ?? null,
      work,
      locationId,
    );
  }

  // ── The clock ───────────────────────────────────────────────────────────

  /**
   * The server's clock and the merchant's trading day, in ONE statement so the
   * deadline, the `businessDate` the list reports and the row's own `created_at` all
   * come from the same instant.
   *
   * The trading day is derived exactly as `merchant.tg_business_date` derives it (see
   * `60_triggers.sql`) and as `pos-cash` derives it for a shift: (now in the MERCHANT's
   * timezone) minus `business_day_start`, cast to a date. The PERIOD CLOSE is the end
   * of that trading day — the instant the next one begins — because the SAT measures a
   * factura global from the close of the chosen period and no periodicity model exists
   * in this schema yet. When one lands, this is the single expression to change.
   */
  async clock(client: PoolClient, merchantId: string): Promise<FiscalClock> {
    const result = await client.query<{
      operation_at: Date;
      business_date: string;
      period_close_at: Date;
    }>(
      `SELECT now() AS operation_at,
              (((now() at time zone m.timezone) - m.business_day_start::interval)::date)::text
                AS business_date,
              (((((now() at time zone m.timezone) - m.business_day_start::interval)::date + 1)::timestamp
                 + m.business_day_start::interval) at time zone m.timezone) AS period_close_at
         FROM merchant.merchant m
        WHERE m.id=$1::uuid`,
      [merchantId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('FISCAL_MERCHANT_NOT_FOUND');
    return {
      operationAt: row.operation_at,
      periodCloseAt: row.period_close_at,
      businessDate: row.business_date,
    };
  }

  // ── The sale ────────────────────────────────────────────────────────────

  /**
   * The committed sale behind a cart id, or null.
   *
   * A sale that is NOT committed has no fiscal document to create — the join through
   * `pos_committed_sale` is what makes that true, and the cart's own status is checked
   * as well so a cart that was committed and then somehow un-committed still resolves
   * to nothing. The total is the RECEIPT's frozen grand total, never a recomputation:
   * the snapshot exists precisely so a report cannot disagree with a printed ticket.
   */
  async resolveSale(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    saleId: string,
  ): Promise<ResolvedSale | null> {
    const result = await client.query<{
      order_id: string;
      receipt_snapshot_id: string;
      total_minor_units: string;
      currency: string;
      receipt_number: string;
    }>(
      `SELECT s.order_id::text AS order_id,s.receipt_snapshot_id::text AS receipt_snapshot_id,
              r.grand_total::text AS total_minor_units,r.currency,r.receipt_number
         FROM merchant.pos_cart c
         JOIN merchant.pos_committed_sale s
           ON s.merchant_id=c.merchant_id AND s.cart_id=c.id
         JOIN merchant.receipt_snapshot r
           ON r.merchant_id=s.merchant_id AND r.id=s.receipt_snapshot_id
        WHERE c.merchant_id=$1::uuid AND c.location_id=$2::uuid AND c.id=$3::uuid
          AND c.status='committed'`,
      [merchantId, locationId, saleId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      orderId: row.order_id,
      receiptSnapshotId: row.receipt_snapshot_id,
      totalMinorUnits: Number(row.total_minor_units),
      currency: row.currency,
      receiptNumber: row.receipt_number,
    };
  }

  // ── The state machine's writes ──────────────────────────────────────────

  /**
   * The pre-CFDI row: `pending_self_invoice` with its clock.
   *
   * IDEMPOTENT PER SALE. `unique (merchant_id, order_id, kind)` is the database's own
   * "one document per sale per kind", so a second stamp for the same sale inserts
   * nothing and the read-back returns the FIRST row — which is how a replay finds the
   * document that already exists instead of creating a second one.
   */
  async insertPending(client: PoolClient, input: InsertPendingInput): Promise<FiscalDocumentView> {
    await client.query(
      `INSERT INTO merchant.fiscal_document
         (merchant_id,location_id,order_id,receipt_snapshot_id,kind,status,total_minor_units,
          currency,receptor_rfc,receptor_name,receptor_postal_code,regimen_fiscal,uso_cfdi,
          payment_form,payment_method,deadline_at,deadline_kind,command_id,idempotency_key)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::bigint,$8,$9,$10,$11,$12,$13,
               $14,$15,$16::timestamptz,$17,$18::uuid,$19::uuid)
       ON CONFLICT (merchant_id,order_id,kind) DO NOTHING`,
      [
        input.merchantId,
        input.locationId,
        input.orderId,
        input.receiptSnapshotId,
        input.kind,
        'pending_self_invoice',
        input.totalMinorUnits,
        input.currency,
        input.receptorRfc,
        input.receptorName,
        input.receptorPostalCode,
        input.regimenFiscal,
        input.usoCfdi,
        input.paymentForm,
        input.paymentMethod,
        input.deadlineAt,
        input.deadlineKind,
        input.commandId,
        input.idempotencyKey,
      ],
    );
    const existing = await this.readByOrder(client, input.merchantId, input.orderId, input.kind);
    if (!existing) throw new Error('FISCAL_DOCUMENT_INSERT_LOST');
    return existing;
  }

  /**
   * The stamp. Guarded to a row that is not already stamped or cancelled, so a replay
   * that raced another writer cannot REWRITE the folio of a document the SAT already
   * knows, and a cancellation can never be undone by a late stamp.
   */
  markStamped(
    client: PoolClient,
    merchantId: string,
    id: string,
    input: MarkStampedInput,
  ): Promise<FiscalDocumentView | null> {
    return this.updateJoined(
      client,
      `SET status='stamped',uuid_folio=$3::uuid,stamped_at=now(),provider_document_id=$4,
           error_message=NULL
        WHERE f.merchant_id=$1::uuid AND f.id=$2::uuid
          AND f.status NOT IN ('stamped','cancelled')`,
      [merchantId, id, input.uuidFolio, input.providerDocumentId],
    );
  }

  /**
   * The failure. Also guarded: an `error` may never overwrite a stamped or cancelled
   * document, because "the PAC refused a replay" is not a fact about a stamped CFDI.
   */
  markError(
    client: PoolClient,
    merchantId: string,
    id: string,
    message: string,
  ): Promise<FiscalDocumentView | null> {
    return this.updateJoined(
      client,
      `SET status='error',error_message=$3
        WHERE f.merchant_id=$1::uuid AND f.id=$2::uuid
          AND f.status NOT IN ('stamped','cancelled')`,
      [merchantId, id, message],
    );
  }

  /**
   * Cancelling a document the SAT never saw (not_invoiced / pending_self_invoice /
   * in_global / error). THERE IS NOTHING AT THE SAT TO CANCEL, so no PAC call is made
   * or possible, and the status moves locally with the operator's motive and reason.
   */
  cancelLocal(
    client: PoolClient,
    merchantId: string,
    id: string,
    write: FiscalCancellationWrite,
  ): Promise<FiscalDocumentView | null> {
    return this.updateJoined(
      client,
      `SET status='cancelled',cancellation_motive=$3,cancellation_reason=$4,
           cancelled_at=$5::timestamptz,command_id=$6::uuid,idempotency_key=$7::uuid
        WHERE f.merchant_id=$1::uuid AND f.id=$2::uuid
          AND f.status NOT IN ('stamped','cancelled')`,
      [
        merchantId,
        id,
        write.motive,
        write.reason,
        write.cancelledAt,
        write.commandId,
        write.idempotencyKey,
      ],
    );
  }

  /**
   * Cancelling a STAMPED document — only ever called after the PAC confirmed, so the
   * row cannot say `cancelled` while the SAT still considers the CFDI live.
   *
   * THE FOLIO IS CLEARED, and that is the constraint's doing rather than a choice:
   * `fiscal_document_stamped_shape` is a BICONDITIONAL — `(status='stamped') =
   * (uuid_folio is not null and stamped_at is not null)` — so a row that is no longer
   * stamped may not carry a folio and a stamping time. The SAT folio's presence IS the
   * stamped fact. What survives the cancellation, and is what makes it traceable, is
   * `provider_document_id` plus the motive, the reason and the moment.
   */
  markCancelled(
    client: PoolClient,
    merchantId: string,
    id: string,
    write: FiscalCancellationWrite,
  ): Promise<FiscalDocumentView | null> {
    return this.updateJoined(
      client,
      // THE FOLIO STAYS. A cancelled CFDI is still identified by its UUID at the SAT, and
      // the folio is what an auditor, a credit note or a later cancellation of a
      // cancellation refers to — clearing it would answer "which document did we cancel?"
      // with silence. `fiscal_document_stamped_shape` allows a cancelled row to keep the
      // pair precisely so this can be written this way.
      `SET status='cancelled',
           cancellation_motive=$3,cancellation_reason=$4,
           cancelled_at=$5::timestamptz,command_id=$6::uuid,idempotency_key=$7::uuid
        WHERE f.merchant_id=$1::uuid AND f.id=$2::uuid
          AND f.status='stamped'`,
      [
        merchantId,
        id,
        write.motive,
        write.reason,
        write.cancelledAt,
        write.commandId,
        write.idempotencyKey,
      ],
    );
  }

  // ── The reads ───────────────────────────────────────────────────────────

  /**
   * THE SALE'S OWN DOCUMENT. `saleId` is the cart id, and the join through
   * `pos_committed_sale` is what turns it into the order the row carries. Only a
   * nominative document belongs to one sale; a factura global aggregates many.
   */
  async readForSale(
    client: PoolClient,
    merchantId: string,
    saleId: string,
  ): Promise<FiscalDocumentView | null> {
    const result = await client.query<FiscalRow>(
      `SELECT ${DOCUMENT_COLUMNS}
         FROM ${DOCUMENT_SOURCE}
        WHERE f.merchant_id=$1::uuid AND s.cart_id=$2::uuid AND f.kind='nominative'
        ORDER BY f.created_at DESC,f.id DESC
        LIMIT 1`,
      [merchantId, saleId],
    );
    return result.rows[0] ? fiscalDocumentFromRow(result.rows[0]) : null;
  }

  async readById(
    client: PoolClient,
    merchantId: string,
    id: string,
  ): Promise<FiscalDocumentView | null> {
    const result = await client.query<FiscalRow>(
      `SELECT ${DOCUMENT_COLUMNS} FROM ${DOCUMENT_SOURCE}
        WHERE f.merchant_id=$1::uuid AND f.id=$2::uuid`,
      [merchantId, id],
    );
    return result.rows[0] ? fiscalDocumentFromRow(result.rows[0]) : null;
  }

  /** The owner's list: every document of a location, newest first, optionally one status. */
  async list(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    status: CfdiStatus | null,
    limit: number,
  ): Promise<FiscalDocumentView[]> {
    const result = await client.query<FiscalRow>(
      `SELECT ${DOCUMENT_COLUMNS} FROM ${DOCUMENT_SOURCE}
        WHERE f.merchant_id=$1::uuid AND f.location_id=$2::uuid
          AND ($3::text IS NULL OR f.status=$3::text)
        ORDER BY f.created_at DESC,f.id DESC
        LIMIT $4`,
      [merchantId, locationId, status, limit],
    );
    return result.rows.map(fiscalDocumentFromRow);
  }

  /**
   * The counts behind the owner's deadline view.
   *
   * THE FOUR STATUS COUNTS PARTITION THE ROWS: `pending` is the three pre-CFDI
   * statuses, and `stamped`, `cancelled` and `failed` are the rest, so
   * `total = pending + stamped + cancelled + failed` for any database.
   *
   * `withinDeadline`/`pastDeadline` deliberately count ONLY documents that still have
   * a clock to run: a stamped or cancelled CFDI is done, and counting it as "inside its
   * deadline" would tell the owner a filed document is still pending.
   */
  async counts(client: PoolClient, merchantId: string, locationId: string): Promise<FiscalCounts> {
    const result = await client.query<FiscalCounts>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status IN ('not_invoiced','pending_self_invoice','in_global'))::int
                AS pending,
              count(*) FILTER (WHERE status='stamped')::int AS stamped,
              count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
              count(*) FILTER (WHERE status='error')::int AS failed,
              count(*) FILTER (WHERE status IN ('not_invoiced','pending_self_invoice','in_global','error')
                                 AND deadline_at >= now())::int AS "withinDeadline",
              count(*) FILTER (WHERE status IN ('not_invoiced','pending_self_invoice','in_global','error')
                                 AND deadline_at < now())::int AS "pastDeadline"
         FROM merchant.fiscal_document
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid`,
      [merchantId, locationId],
    );
    const row = result.rows[0];
    return {
      total: row?.total ?? 0,
      pending: row?.pending ?? 0,
      stamped: row?.stamped ?? 0,
      cancelled: row?.cancelled ?? 0,
      failed: row?.failed ?? 0,
      withinDeadline: row?.withinDeadline ?? 0,
      pastDeadline: row?.pastDeadline ?? 0,
    };
  }

  // ── The two shared shapes ───────────────────────────────────────────────

  private async readByOrder(
    client: PoolClient,
    merchantId: string,
    orderId: string,
    kind: CfdiKind,
  ): Promise<FiscalDocumentView | null> {
    const result = await client.query<FiscalRow>(
      `SELECT ${DOCUMENT_COLUMNS} FROM ${DOCUMENT_SOURCE}
        WHERE f.merchant_id=$1::uuid AND f.order_id=$2::uuid AND f.kind=$3`,
      [merchantId, orderId, kind],
    );
    return result.rows[0] ? fiscalDocumentFromRow(result.rows[0]) : null;
  }

  /**
   * `UPDATE … RETURNING` joined back to the sale, so a write's answer is the row as
   * the API reads it and not a second, differently-shaped one. A guard that matched
   * nothing returns null, which is the caller's signal that the row had already moved.
   */
  private async updateJoined(
    client: PoolClient,
    setAndWhere: string,
    params: unknown[],
  ): Promise<FiscalDocumentView | null> {
    const result = await client.query<FiscalRow>(
      `WITH updated AS (
         UPDATE merchant.fiscal_document f ${setAndWhere} RETURNING f.*
       )
       SELECT ${DOCUMENT_COLUMNS} FROM updated f
         LEFT JOIN merchant.pos_committed_sale s
           ON s.merchant_id=f.merchant_id AND s.order_id=f.order_id`,
      params,
    );
    return result.rows[0] ? fiscalDocumentFromRow(result.rows[0]) : null;
  }
}
