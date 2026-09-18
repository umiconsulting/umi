import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CfdiStatus,
  FiscalDocumentList,
  FiscalDocumentQuery,
  FiscalStampSaleRequest,
  FiscalStampSaleResult,
} from '@umi/contract';
import type { PoolClient } from 'pg';
import type { MerchantAccess } from '../auth/auth.types';
import { resolveLocationAuthority } from '../auth/location-authority';
import { fiscalDeadline } from '../tender/tender-domain';
import { FISCAL_PAC_PORT, pacRefusalMessage, type FiscalPacPort } from './fiscal-pac.port';
import {
  FiscalRepository,
  type FiscalCancellationWrite,
  type FiscalDocumentView,
} from './fiscal.repository';

/**
 * THE FISCAL STATE MACHINE, WITH THE CLOCK (plan §8G step 5, ADR §2.4).
 *
 * `pending -> stamped -> cancelled`, with the SAT's deadline as a VALUE on the row
 * rather than a rule implied by the sale's date, and with the UUID, the receptor, the
 * payment form and the payment method stored on the sale's fiscal lens.
 *
 * THREE THINGS THIS FILE DECIDES, and why each one is here rather than in SQL:
 *
 *   1. THE STAMP IS TWO COMMITS AND A PROVIDER CALL. The pending row is committed
 *      BEFORE the PAC is asked, so a crash between the two leaves a document an
 *      operator can see and retry rather than money with no record. The second commit
 *      records the PAC's answer. A PAC that throws is a REFUSAL: it produces an `error`
 *      row carrying the PAC's own sentence, never a `stamped` one.
 *   2. THE DEADLINE IS COMPUTED BY `fiscalDeadline`, which `tender-domain.ts` already
 *      property-tests. 24 hours from the operation for a per-ticket CFDI, 24 hours
 *      after the period close for a factura global. The arithmetic is not re-implemented
 *      here and the CLOCK is the server's (see `FiscalRepository.clock`), never the
 *      browser's.
 *   3. CANCELLATION BELONGS TO THE SALE, NOT TO A ROUTE OF ITS OWN. `cancelForSale`
 *      runs inside the caller's transaction — `pos.saleCancel` — so cancelling a sale
 *      and cancelling its CFDI are ONE operation an operator cannot half-perform.
 *
 * WHAT THIS FILE DOES NOT DO: it never opens a transaction inside `cancelForSale`, and
 * it never reaches for a second HTTP client. The PAC is behind `FiscalPacPort`.
 */

/**
 * THE METHOD THE SALE-CANCEL COMMAND CALLS INSIDE ITS OWN TRANSACTION (§8G acceptance,
 * third sentence). The shape is fixed by the caller, not by this module.
 */
export interface FiscalCancellationRequest {
  readonly merchantId: string;
  readonly saleId: string;
  readonly locationId: string;
  readonly motive: '01' | '02' | '03' | '04';
  readonly reason: string;
  readonly actorUserId: string | null;
  readonly correlationId: string;
}

export interface FiscalCancellationResult {
  readonly documentFound: boolean;
  readonly documentId: string | null;
  readonly status: 'cancelled' | null;
}

/** The statuses a stamp may be RETRIED against: pre-CFDI, or a previous failure. */
const STAMPABLE_STATUSES: ReadonlySet<CfdiStatus> = new Set<CfdiStatus>([
  'not_invoiced',
  'pending_self_invoice',
  'error',
]);

/**
 * The contract's `FiscalDocumentList` widened by ONE field per document: the SAT's
 * cancellation rule, answered server-side. It is still assignable to the contract's
 * model (the extra field is additive), and it is the type the owner's view is read
 * with so the answer cannot silently disappear between the repository and the route.
 */
export type FiscalDocumentListView = Omit<FiscalDocumentList, 'documents'> & {
  readonly documents: FiscalDocumentView[];
};

@Injectable()
export class FiscalService {
  constructor(
    private readonly repo: FiscalRepository,
    @Inject(FISCAL_PAC_PORT) private readonly pac: FiscalPacPort,
  ) {}

  // ── Stamping ────────────────────────────────────────────────────────────

  /**
   * Stamp the committed sale's nominative CFDI.
   *
   * Idempotent BY SALE rather than by request: the same sale stamped twice returns the
   * first document with `idempotentReplay: true` and does not call the PAC again, which
   * is the fiscal half of "a retried payment never charges twice".
   */
  async stampSale(
    access: MerchantAccess,
    merchantId: string,
    dto: FiscalStampSaleRequest,
  ): Promise<FiscalStampSaleResult> {
    const locationId = this.scope(access, merchantId, dto.locationId);
    const unavailable = this.pac.available
      ? null
      : (this.pac.unavailableReason ?? 'the PAC is not configured');

    const prepared = await this.repo.runScoped(merchantId, locationId, async (client) => {
      const sale = await this.repo.resolveSale(client, merchantId, locationId, dto.saleId);
      if (!sale) {
        throw new NotFoundException({
          code: 'FISCAL_SALE_NOT_COMMITTED',
          message: 'The sale has not been committed, so there is nothing to invoice yet.',
          details: { saleId: dto.saleId },
        });
      }

      const existing = await this.repo.readForSale(client, merchantId, dto.saleId);
      if (existing?.status === 'stamped') return { kind: 'replay' as const, document: existing };
      if (existing && !STAMPABLE_STATUSES.has(existing.status)) {
        throw new ConflictException({
          code: 'FISCAL_DOCUMENT_NOT_STAMPABLE',
          message: `This sale's fiscal document is ${existing.status} and cannot be stamped.`,
          details: { documentId: existing.id, status: existing.status },
        });
      }

      const clock = await this.repo.clock(client, merchantId);
      const pending = await this.repo.insertPending(client, {
        merchantId,
        locationId,
        orderId: sale.orderId,
        receiptSnapshotId: sale.receiptSnapshotId,
        kind: 'nominative',
        totalMinorUnits: sale.totalMinorUnits,
        currency: sale.currency,
        receptorRfc: dto.receptor.rfc,
        receptorName: dto.receptor.name,
        receptorPostalCode: dto.receptor.postalCode,
        regimenFiscal: dto.receptor.regimen,
        usoCfdi: dto.uso ?? dto.receptor.uso,
        paymentForm: dto.paymentForm,
        paymentMethod: dto.paymentMethod,
        deadlineAt: fiscalDeadline(dto.deadlineKind, clock.operationAt, clock.periodCloseAt),
        deadlineKind: dto.deadlineKind,
        // The client's idempotency key IS the identity of this command, so both columns
        // name it — the row a replay finds is the row the first attempt wrote.
        commandId: dto.idempotencyKey,
        idempotencyKey: dto.idempotencyKey,
      });

      // THE PAC IS UNREACHABLE. The row moves to `error` and this transaction COMMITS
      // before the refusal is thrown: a pending row with no clock is worse than a
      // failed one, because nothing will ever move it and the owner cannot see why.
      if (unavailable !== null) {
        const errored = await this.repo.markError(client, merchantId, pending.id, unavailable);
        return {
          kind: 'unavailable' as const,
          document: errored ?? pending,
          reason: unavailable,
          sale,
        };
      }
      return { kind: 'pending' as const, document: pending, sale };
    });

    if (prepared.kind === 'replay') {
      return { document: prepared.document, idempotentReplay: true };
    }
    if (prepared.kind === 'unavailable') {
      throw new ConflictException({
        code: 'FISCAL_PAC_UNAVAILABLE',
        message: prepared.reason,
        details: { documentId: prepared.document.id },
      });
    }

    // The provider call happens OUTSIDE the transaction, exactly as the terminal's
    // capture does: write the row, ask the outside world, write the answer. Calling the
    // PAC while holding a transaction open would hold the row's lock for an HTTP round
    // trip.
    const request = {
      saleId: dto.saleId,
      receptor: dto.receptor,
      uso: dto.uso ?? dto.receptor.uso,
      paymentForm: dto.paymentForm,
      paymentMethod: dto.paymentMethod,
      totalMinorUnits: prepared.sale.totalMinorUnits,
      currency: prepared.sale.currency,
      description: `Venta ${prepared.sale.receiptNumber}`,
    };

    let stamped: FiscalDocumentView;
    try {
      const answer = await this.pac.stamp(request, null);
      stamped = await this.repo.runScoped(merchantId, locationId, async (client) => {
        const written = await this.repo.markStamped(client, merchantId, prepared.document.id, {
          uuidFolio: answer.uuidFolio,
          providerDocumentId: answer.providerDocumentId,
        });
        if (written) return written;
        // A concurrent writer moved the row between our claim and our write. Read it
        // back: if somebody else's stamp won, that IS the document and this call is a
        // replay; anything else means the row is no longer stampable.
        const current = await this.repo.readById(client, merchantId, prepared.document.id);
        if (current?.status === 'stamped') return current;
        throw new ConflictException({
          code: 'FISCAL_STAMP_REFUSED',
          message: 'The fiscal document moved while the CFDI was being stamped.',
          details: { documentId: prepared.document.id },
        });
      });
    } catch (error) {
      // EVERY failure on the way to a folio is a refusal, and a refusal leaves an
      // `error` row carrying the PAC's own sentence — never a stamped document, and
      // never a UUID the SAT has not issued.
      if (error instanceof ConflictException) throw error;
      const message = pacRefusalMessage(error);
      const errored = await this.repo.runScoped(merchantId, locationId, (client) =>
        this.repo.markError(client, merchantId, prepared.document.id, message),
      );
      throw new ConflictException({
        code: 'FISCAL_STAMP_REFUSED',
        message,
        details: { documentId: errored?.id ?? prepared.document.id },
      });
    }

    return { document: stamped, idempotentReplay: false };
  }

  // ── The owner's view ────────────────────────────────────────────────────

  /**
   * The documents of one branch, with the counts behind the deadline view and the
   * server's own `businessDate`. The clock is read in the same transaction as the rows,
   * so a list and the counts in it cannot disagree about what "today" is.
   */
  async documents(
    access: MerchantAccess,
    merchantId: string,
    query: FiscalDocumentQuery,
  ): Promise<FiscalDocumentListView> {
    const locationId = this.scope(access, merchantId, query.locationId);
    return this.repo.runScoped(merchantId, locationId, async (client) => {
      const documents = await this.repo.list(
        client,
        merchantId,
        locationId,
        query.status ?? null,
        query.limit,
      );
      const counts = await this.repo.counts(client, merchantId, locationId);
      const clock = await this.repo.clock(client, merchantId);
      return { documents, counts, businessDate: clock.businessDate };
    });
  }

  // ── The sale's cancellation ─────────────────────────────────────────────

  /**
   * CANCEL THE SALE'S FISCAL DOCUMENT — called from inside `pos.saleCancel`'s own
   * transaction, with that transaction's client. It opens nothing and commits nothing:
   * if the caller rolls back, the document stays exactly as it was.
   *
   * THE THREE CASES, and why each is safe:
   *
   *   · NO DOCUMENT. A café that never invoiced must still be able to cancel a sale, so
   *     this is a clean no-op: `documentFound: false` and nothing written.
   *   · NEVER STAMPED (not_invoiced / pending_self_invoice / in_global / error). There is
   *     nothing at the SAT to cancel, so the status moves LOCALLY with the motive and the
   *     reason, and no PAC call is made or possible.
   *   · STAMPED. The PAC is asked first and the row is written only on the PAC's
   *     confirmation. If the PAC refuses or is unavailable this THROWS, so the whole
   *     sale-cancel rolls back. An operator must not be able to end up with a cancelled
   *     sale whose CFDI the SAT still considers live.
   *
   * The one asymmetry, stated plainly: the SAT's cancellation is not transactional with
   * our database. PAC-then-write is the order that stops the row claiming a cancellation
   * the SAT has not accepted. The reverse — the SAT accepting while our transaction
   * rolls back — leaves a live sale whose CFDI is cancelled, which an operator fixes by
   * cancelling again (a PAC cancellation must be idempotent).
   */
  async cancelForSale(
    client: PoolClient,
    request: FiscalCancellationRequest,
  ): Promise<FiscalCancellationResult> {
    const document = await this.repo.readForSale(client, request.merchantId, request.saleId);
    if (!document) {
      return { documentFound: false, documentId: null, status: null };
    }
    if (document.status === 'cancelled') {
      return { documentFound: true, documentId: document.id, status: 'cancelled' };
    }

    const write: FiscalCancellationWrite = {
      motive: request.motive,
      reason: request.reason,
      cancelledAt: new Date(),
      // The request carries ONE correlation identity and the row records it as its
      // command and its idempotency key when it is uuid-shaped, and as nothing when it
      // is not: a uuid column cannot hold the other kind of value, and refusing a
      // cancellation over the SHAPE of a correlation would be absurd.
      commandId: asUuid(request.correlationId),
      idempotencyKey: asUuid(request.correlationId),
    };

    if (document.status === 'stamped') {
      if (!this.pac.available) {
        throw new ConflictException({
          code: 'FISCAL_PAC_UNAVAILABLE',
          message:
            this.pac.unavailableReason ??
            'The PAC is not configured, so the CFDI cannot be cancelled.',
          details: { documentId: document.id },
        });
      }
      if (!document.providerDocumentId) {
        throw new ConflictException({
          code: 'FISCAL_PROVIDER_DOCUMENT_MISSING',
          message: 'This stamped document carries no PAC document id, so it cannot be cancelled.',
          details: { documentId: document.id },
        });
      }
      try {
        await this.pac.cancel(
          {
            providerDocumentId: document.providerDocumentId,
            motive: request.motive,
            substitutionUuid: null,
          },
          null,
        );
      } catch (error) {
        throw new ConflictException({
          code: 'FISCAL_CANCELLATION_REFUSED',
          message: pacRefusalMessage(error),
          details: { documentId: document.id },
        });
      }
      const cancelled = await this.repo.markCancelled(
        client,
        request.merchantId,
        document.id,
        write,
      );
      if (!cancelled) {
        throw new ConflictException({
          code: 'FISCAL_CANCELLATION_REFUSED',
          message: 'The document was no longer stamped when the cancellation was recorded.',
          details: { documentId: document.id },
        });
      }
      return { documentFound: true, documentId: document.id, status: 'cancelled' };
    }

    const cancelled = await this.repo.cancelLocal(client, request.merchantId, document.id, write);
    if (cancelled) {
      return { documentFound: true, documentId: document.id, status: 'cancelled' };
    }
    // The row moved between the read and the write. A concurrent cancellation is the
    // only way that happens, and it is a success rather than a conflict.
    const current = await this.repo.readById(client, request.merchantId, document.id);
    if (current?.status === 'cancelled') {
      return { documentFound: true, documentId: document.id, status: 'cancelled' };
    }
    throw new ConflictException({
      code: 'FISCAL_CANCELLATION_REFUSED',
      message: 'The fiscal document changed while it was being cancelled.',
      details: { documentId: document.id },
    });
  }

  // ── Shared plumbing ─────────────────────────────────────────────────────

  /**
   * The merchant and the branch this call may act on. The path carries the merchant id
   * and the body or query carries the location; both are checked against the caller's
   * own membership rather than trusted, exactly as the console's other modules do it.
   */
  private scope(access: MerchantAccess, merchantId: string, locationId: string): string {
    if (access.merchantId !== merchantId) {
      throw new ForbiddenException({ code: 'MERCHANT_SCOPE_MISMATCH' });
    }
    return resolveLocationAuthority(access, locationId) ?? locationId;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The correlation, when it is a UUID — the shape `fiscal_document.command_id` can hold. */
function asUuid(value: string | null): string | null {
  if (!value) return null;
  return UUID_PATTERN.test(value) ? value : null;
}
