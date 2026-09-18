import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  CancelPurchaseOrderRequest,
  CreatePurchaseOrderRequest,
  CreateSupplierRequest,
  PurchaseOrder,
  PurchaseOrderQuery,
  ReceivePurchaseOrderRequest,
  SendPurchaseOrderRequest,
  Supplier,
  SupplierInvoiceCommitRequest,
  SupplierInvoiceList,
  SupplierInvoiceMatchRequest,
  SupplierInvoiceQuery,
  SupplierInvoiceSource,
  SupplierInvoiceUploadRequest,
  SupplierQuery,
  UpdateSupplierRequest,
} from '@umi/contract';
import type { PoolClient } from 'pg';
import { getRequestContext } from '../../shared/database/request-context';
import { MetricsService } from '../../shared/operations/metrics.service';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import type { PersistedDashboardAdministrativeCommandContext } from '../administrative-commands/administrative-command-context.service';
import { resolveLocationAuthority } from '../auth/location-authority';
import { commandFingerprint } from '../integrity/canonical-json';
import { IntegrityService } from '../integrity/integrity.service';
import type { AuditAppend } from '../integrity/integrity.types';
import { parseCfdiInvoice } from './cfdi-parser';
import { ProcurementRepository } from './procurement.repository';
import { procurementConstraintCode, procurementLedgerCode } from './procurement-errors';

/**
 * Purchasing, as the console uses it (plan §8E step 3).
 *
 * WHY THE CONSOLE AND NOT THE TILL. Ordering stock is back-of-house work: it needs
 * a supplier, an invoice and a decision about money, none of which belongs at a
 * counter during service. So these routes authenticate with a browser session and
 * are gated by `merchant.manage` — the same key the floor plan uses — rather than
 * by an `inventory.*` permission, which only a POS operator session carries.
 *
 * EVERY WRITE IS A COMMAND. That is not ceremony borrowed from the till: a receipt
 * moves stock, and a receipt whose response is lost must be replayable without
 * posting the delivery twice. `integrity.execute` claims the idempotency key in
 * `merchant.business_command`, so a replay returns the first attempt's own result
 * and the repository never runs again. The receipts table carries the same key as a
 * second, database-level guarantee, and the ledger's own unique key is the third.
 */
@Injectable()
export class ProcurementService {
  constructor(
    private readonly repo: ProcurementRepository,
    private readonly integrity: IntegrityService,
    private readonly metrics: MetricsService,
  ) {}

  // ── Suppliers ────────────────────────────────────────────────────────────

  async listSuppliers(access: MerchantAccess, query: SupplierQuery) {
    const { rows, hasMore } = await this.repo.listSuppliers(
      access.merchantId,
      query,
      decodeSupplierCursor(query.cursor),
    );
    const last = rows.at(-1);
    return {
      suppliers: rows,
      page: {
        limit: query.limit,
        hasMore,
        nextCursor: hasMore && last ? encodeCursor({ name: last.displayName, id: last.id }) : null,
      },
      correlationId: this.correlationId(),
    };
  }

  async createSupplier(access: MerchantAccess, dto: CreateSupplierRequest) {
    resolveLocationAuthority(access, dto.locationId);
    const result = await this.run<Supplier>(
      'procurement.supplier.create',
      access.merchantId,
      dto,
      async (context) => {
        const created = await this.repo.createSupplier(context.client, access.merchantId, dto);
        await context.appendAudit({
          eventType: 'procurement.supplier_created',
          entityType: 'supplier',
          entityId: created.id,
          outcome: 'success',
          publicData: { publicReference: created.publicReference },
        });
        return created;
      },
    );
    return {
      commandId: result.commandId,
      supplier: result.value,
      correlationId: result.correlationId,
    };
  }

  async updateSupplier(access: MerchantAccess, dto: UpdateSupplierRequest) {
    resolveLocationAuthority(access, dto.locationId);
    const result = await this.run<Supplier>(
      'procurement.supplier.update',
      access.merchantId,
      dto,
      async (context) => {
        const updated = await this.repo.updateSupplier(context.client, access.merchantId, dto);
        await context.appendAudit({
          eventType: 'procurement.supplier_updated',
          entityType: 'supplier',
          entityId: updated.id,
          outcome: 'success',
          publicData: { active: updated.active, version: updated.version },
        });
        return updated;
      },
      dto.expectedVersion,
    );
    return {
      commandId: result.commandId,
      supplier: result.value,
      correlationId: result.correlationId,
    };
  }

  // ── Purchase orders ──────────────────────────────────────────────────────

  async listPurchaseOrders(access: MerchantAccess, query: PurchaseOrderQuery) {
    resolveLocationAuthority(access, query.locationId);
    const { rows, hasMore } = await this.repo.listPurchaseOrders(
      access.merchantId,
      query,
      decodePurchaseOrderCursor(query.cursor),
    );
    const last = rows.at(-1);
    return {
      purchaseOrders: rows,
      page: {
        limit: query.limit,
        hasMore,
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      },
      correlationId: this.correlationId(),
    };
  }

  async getPurchaseOrder(
    access: MerchantAccess,
    query: { locationId: string },
    purchaseOrderId: string,
  ): Promise<PurchaseOrder> {
    resolveLocationAuthority(access, query.locationId);
    const order = await this.repo.loadPurchaseOrderScoped(
      access.merchantId,
      query.locationId,
      purchaseOrderId,
    );
    if (!order) throw new NotFoundException({ code: 'PURCHASE_ORDER_NOT_FOUND' });
    return order;
  }

  async createPurchaseOrder(access: MerchantAccess, dto: CreatePurchaseOrderRequest) {
    resolveLocationAuthority(access, dto.locationId);
    const operatorId = this.operatorId();
    const result = await this.run<PurchaseOrder>(
      'procurement.purchase_order.create',
      access.merchantId,
      dto,
      async (context) => {
        const order = await this.repo.createPurchaseOrder(
          context.client,
          access.merchantId,
          operatorId,
          dto,
        );
        await context.appendAudit({
          eventType: 'procurement.purchase_order_raised',
          entityType: 'purchase_order',
          entityId: order.id,
          outcome: 'success',
          publicData: {
            publicReference: order.publicReference,
            supplierReference: order.supplierReference,
            orderedTotalMinor: order.orderedTotalMinor,
            lineCount: order.lines.length,
          },
        });
        return order;
      },
    );
    return {
      commandId: result.commandId,
      purchaseOrder: result.value,
      correlationId: result.correlationId,
    };
  }

  async sendPurchaseOrder(access: MerchantAccess, dto: SendPurchaseOrderRequest) {
    resolveLocationAuthority(access, dto.locationId);
    const operatorId = this.operatorId();
    const result = await this.run<PurchaseOrder>(
      'procurement.purchase_order.send',
      access.merchantId,
      dto,
      async (context) => {
        const order = await this.repo.sendPurchaseOrder(
          context.client,
          access.merchantId,
          {
            locationId: dto.locationId,
            purchaseOrderId: dto.purchaseOrderId,
            commandId: context.commandId,
            idempotencyKey: dto.idempotencyKey,
          },
          operatorId,
          context.fingerprint,
          context.correlationId,
        );
        await context.appendAudit({
          eventType: 'procurement.purchase_order_sent',
          entityType: 'purchase_order',
          entityId: order.id,
          outcome: 'success',
          publicData: {
            publicReference: order.publicReference,
            inTransitLines: order.lines.length,
          },
        });
        return order;
      },
      dto.expectedVersion,
    );
    return {
      commandId: result.commandId,
      purchaseOrder: result.value,
      correlationId: result.correlationId,
    };
  }

  async receivePurchaseOrder(access: MerchantAccess, dto: ReceivePurchaseOrderRequest) {
    resolveLocationAuthority(access, dto.locationId);
    const operatorId = this.operatorId();
    const result = await this.run<PurchaseOrder>(
      'procurement.purchase_order.receive',
      access.merchantId,
      dto,
      async (context) => {
        const order = await this.repo.receivePurchaseOrder(
          context.client,
          access.merchantId,
          {
            locationId: dto.locationId,
            purchaseOrderId: dto.purchaseOrderId,
            expectedVersion: dto.expectedVersion,
            commandId: context.commandId,
            idempotencyKey: dto.idempotencyKey,
            note: dto.note,
            lines: dto.lines.map((line) => ({
              purchaseOrderLineId: line.purchaseOrderLineId,
              quantity: line.quantity,
              actualUnitCostMinor: line.actualUnitCostMinor,
              lineTotalMinor: line.lineTotalMinor,
            })),
          },
          operatorId,
          context.fingerprint,
          context.correlationId,
        );
        await context.appendAudit({
          eventType: 'procurement.purchase_order_received',
          entityType: 'purchase_order',
          entityId: order.id,
          outcome: 'success',
          publicData: {
            publicReference: order.publicReference,
            status: order.status,
            receivedLines: dto.lines.length,
          },
        });
        return order;
      },
      dto.expectedVersion,
    );
    return {
      commandId: result.commandId,
      purchaseOrder: result.value,
      correlationId: result.correlationId,
    };
  }

  async cancelPurchaseOrder(access: MerchantAccess, dto: CancelPurchaseOrderRequest) {
    resolveLocationAuthority(access, dto.locationId);
    const operatorId = this.operatorId();
    const result = await this.run<PurchaseOrder>(
      'procurement.purchase_order.cancel',
      access.merchantId,
      dto,
      async (context) => {
        const order = await this.repo.cancelPurchaseOrder(
          context.client,
          access.merchantId,
          {
            locationId: dto.locationId,
            purchaseOrderId: dto.purchaseOrderId,
            expectedVersion: dto.expectedVersion,
            commandId: context.commandId,
            idempotencyKey: dto.idempotencyKey,
            reason: dto.reason,
          },
          operatorId,
          context.fingerprint,
          context.correlationId,
        );
        await context.appendAudit({
          eventType: 'procurement.purchase_order_cancelled',
          entityType: 'purchase_order',
          entityId: order.id,
          outcome: 'success',
          publicData: { publicReference: order.publicReference, reason: dto.reason },
        });
        return order;
      },
      dto.expectedVersion,
    );
    return {
      commandId: result.commandId,
      purchaseOrder: result.value,
      correlationId: result.correlationId,
    };
  }

  // ── The shared command wrapper ───────────────────────────────────────────

  // ── Supplier invoices (recipes module plan §10, phase 5) ─────────────────

  /**
   * The console's invoice inbox. A READ, so it stays on `merchant.manage` with the
   * other console reads (plan §6.2): reading what the café was charged is a manager's
   * question about money, and an `inventory.*` key is carried only by POS sessions.
   */
  async listSupplierInvoices(
    access: MerchantAccess,
    query: SupplierInvoiceQuery,
  ): Promise<SupplierInvoiceList> {
    const { rows, hasMore, nextCursor } = await this.repo.listSupplierInvoices(
      access.merchantId,
      query,
      decodePurchaseOrderCursor(query.cursor),
      this.correlationId(),
    );
    return {
      invoices: rows,
      page: {
        limit: query.limit,
        hasMore,
        nextCursor: nextCursor ? encodeCursor(nextCursor) : null,
      },
      correlationId: this.correlationId(),
    };
  }

  /**
   * THE UPLOAD (§10.1 and §10.2). The document decides what the invoice IS: an XML
   * file is parsed, an image is stored, and a declared source that disagrees with the
   * document is refused rather than recorded.
   *
   * THE FILE IS READ BEFORE THE COMMAND IS CLAIMED. A supplier's file that cannot be
   * read refuses as `SUPPLIER_INVOICE_PARSE_FAILED` and burns no command identity, so
   * the same key can retry a corrected file instead of being answered with the failed
   * attempt forever.
   */
  async uploadSupplierInvoice(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: SupplierInvoiceUploadRequest,
  ) {
    const hasXml = dto.cfdiXml !== undefined;
    const documentSource: SupplierInvoiceSource = hasXml ? 'cfdi_xml' : 'photo';
    if (dto.source !== documentSource) {
      // `manual` is carried by the contract for a later phase; nothing in v1 lets a
      // person type an invoice in, so it is refused rather than approximated.
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        fieldErrors: { source: [`A ${dto.source} upload does not match the document sent.`] },
      });
    }

    const parsed = hasXml ? parseCfdiInvoice(dto.cfdiXml as string) : null;
    if (parsed !== null && !parsed.ok) {
      throw new BadRequestException({
        code: 'SUPPLIER_INVOICE_PARSE_FAILED',
        message: parsed.detail,
        details: { reason: parsed.code },
      });
    }
    const artifact =
      !hasXml && dto.artifactBase64 !== undefined
        ? decodeInvoiceArtifact(dto.artifactBase64)
        : null;

    const result = await this.runInvoiceCommand(
      'inventory.invoice.upload',
      access,
      dto.locationId ?? context.locationId,
      dto,
      async (transaction) => {
        const created = await this.repo.createSupplierInvoice(
          transaction.client,
          access.merchantId,
          context.targetAggregateId,
          {
            source: documentSource,
            supplierId: dto.supplierId ?? null,
            capturedBy: user.id,
            fingerprint: transaction.fingerprint,
            correlationId: transaction.correlationId,
            parsed: parsed !== null && parsed.ok ? parsed.invoice : null,
            artifactBytes: artifact?.bytes ?? null,
            artifactContentType: artifact?.contentType ?? null,
          },
        );
        await transaction.appendAudit({
          eventType: created.created
            ? 'procurement.supplier_invoice_uploaded'
            : 'procurement.supplier_invoice_reuploaded',
          entityType: 'supplier_invoice',
          entityId: created.invoice.id,
          outcome: 'success',
          publicData: {
            source: documentSource,
            cfdiUuid: created.invoice.cfdiUuid,
            folio: created.invoice.folio,
            lineCount: created.invoice.lines.length,
            duplicate: !created.created,
          },
        });
        return created;
      },
    );
    // One count per line this upload actually wrote. A duplicate upload returns the
    // stored invoice, so its lines are not counted a second time.
    if (result.value.created) {
      for (const line of result.value.invoice.lines) {
        this.metrics.increment('inventory.invoice.lines', { match: line.matchMethod });
      }
    }
    return {
      commandId: result.commandId,
      supplierInvoice: result.value.invoice,
      created: result.value.created,
      correlationId: result.correlationId,
    };
  }

  /** MATCH (§10.3 step 5): a person overrides the proposal for the lines they name. */
  async matchSupplierInvoice(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: SupplierInvoiceMatchRequest,
  ) {
    const result = await this.runInvoiceCommand(
      'inventory.invoice.match',
      access,
      context.locationId,
      dto,
      async (transaction) => {
        await this.repo.matchSupplierInvoiceLines(transaction.client, access.merchantId, {
          supplierInvoiceId: dto.supplierInvoiceId,
          lines: dto.lines,
        });
        const invoice = await this.repo.loadSupplierInvoice(
          transaction.client,
          access.merchantId,
          dto.supplierInvoiceId,
          transaction.correlationId,
        );
        if (!invoice) throw new NotFoundException({ code: 'SUPPLIER_INVOICE_NOT_FOUND' });
        await transaction.appendAudit({
          eventType: 'procurement.supplier_invoice_matched',
          entityType: 'supplier_invoice',
          entityId: invoice.id,
          outcome: 'success',
          publicData: { matchedLines: dto.lines.length, status: invoice.status },
        });
        return invoice;
      },
    );
    return {
      commandId: result.commandId,
      supplierInvoice: result.value,
      correlationId: result.correlationId,
    };
  }

  /**
   * COMMIT (§10.4): the invoice's lines become the receipt that prices the stock.
   *
   * Every refusal is decided by the repository before anything is written, and the
   * write itself goes through the purchase-order receive path, so this command adds a
   * document reference to a fact the platform already knows how to record.
   */
  async commitSupplierInvoice(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: SupplierInvoiceCommitRequest,
  ) {
    const lotRequested = dto.lines.some((line) => line.lotCode !== null);
    if (lotRequested) {
      // D9's lot attribution for a RECEIPT needs a schema that can hold one lot per
      // line: `stock_lot` allows one lot per command, so a multi-line receipt cannot
      // stamp them and this command says so instead of dropping the code.
      throw new BadRequestException({ code: 'SUPPLIER_INVOICE_LOT_UNSUPPORTED' });
    }
    try {
      const result = await this.runInvoiceCommand(
        'inventory.invoice.commit',
        access,
        context.locationId,
        dto,
        async (transaction) =>
          this.repo.commitSupplierInvoice(
            transaction.client,
            access.merchantId,
            {
              supplierInvoiceId: dto.supplierInvoiceId,
              purchaseOrderId: dto.purchaseOrderId,
              lines: dto.lines.map((line) => ({
                lineId: line.lineId,
                purchaseOrderLineId: line.purchaseOrderLineId,
                receivedQuantity: line.receivedQuantity,
                unitCostMinor: line.unitCostMinor,
              })),
              note: dto.note,
              commandId: dto.commandId,
              idempotencyKey: dto.idempotencyKey,
              correlationId: transaction.correlationId,
            },
            user.id,
            transaction.fingerprint,
          ),
      );
      this.metrics.increment('inventory.invoice.commits', { outcome: 'committed' });
      return {
        commandId: result.commandId,
        supplierInvoice: result.value,
        correlationId: result.correlationId,
      };
    } catch (error) {
      // The one refusal that is a measured outcome rather than an accident: an invoice
      // whose lines are still unmatched. It is emitted after the refusal, never before.
      if (httpRefusalCode(error) === 'SUPPLIER_INVOICE_UNMATCHED_LINES') {
        this.metrics.increment('inventory.invoice.commits', { outcome: 'refused_unmatched' });
      }
      throw error;
    }
  }

  /**
   * The invoice commands' own wrapper.
   *
   * It differs from `run` above in one thing that matters: an invoice command has NO
   * `locationId` of its own and NO `expectedVersion`. The location is the one the
   * command names or the session is pinned to, and the version is the invoice's own
   * status, which the repository checks under a lock. The fingerprint is computed here
   * for the same reason it is computed in `run`: `supplier_invoice.command_fingerprint`
   * must be the fingerprint of the command that wrote the row.
   */
  private async runInvoiceCommand<T>(
    commandType: string,
    access: MerchantAccess,
    locationId: string | null,
    payload: unknown,
    operation: (transaction: {
      client: PoolClient;
      correlationId: string;
      fingerprint: string;
      appendAudit: (event: AuditAppend) => Promise<string>;
    }) => Promise<T>,
  ): Promise<{ commandId: string; correlationId: string; value: T }> {
    const dto = payload as { commandId: string; idempotencyKey: string };
    const fingerprint = commandFingerprint(commandType, payload);
    const result = await this.integrity.execute<T>(
      {
        merchantId: access.merchantId,
        locationId,
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        commandType,
        payload,
      },
      async (transaction) => ({
        ok: true as const,
        value: await operation({
          client: transaction.client,
          correlationId: transaction.correlationId,
          fingerprint,
          // Wrapped rather than passed by reference, for the reason `run` gives: the
          // method closes over the transaction's client, and handing it out detached
          // would let a caller invoke it with the wrong receiver.
          appendAudit: (event) => transaction.appendAudit(event),
        }),
      }),
    );
    if (result.status === 'succeeded' && result.result !== null) {
      return {
        commandId: result.commandId,
        correlationId: result.correlationId,
        value: result.result,
      };
    }
    throw new ConflictException({
      code: result.failureCode ?? 'CONFLICT',
      correlationId: result.correlationId,
    });
  }

  /**
   * Run a purchasing command through the journal and turn every refusal into the
   * typed code the route table publishes.
   *
   * THE FINGERPRINT IS COMPUTED HERE, from the same helper `IntegrityService` uses,
   * because the ledger rows need it: `stock_ledger_entry.command_fingerprint` is
   * what makes a replayed send recognisable as the same command rather than a
   * second one. Two independent computations of it would be a genuine bug — a retry
   * whose fingerprints disagreed would be refused as IDEMPOTENCY_CONFLICT by the
   * ledger's own conflict clause after the journal had already accepted it.
   *
   * WHY THE FAILURE BRANCH IS EFFECTIVELY UNREACHABLE, and why it is kept anyway:
   * every refusal below is thrown, so the transaction rolls back and the journal
   * records nothing — which is right, because a refused receipt moved no stock and
   * must be retryable once the operator fixes the number. The `{ ok: false }` path
   * exists for a future caller that returns a typed failure instead of throwing, and
   * dropping it would make that caller's failure look like a success here.
   */
  private async run<T>(
    commandType: string,
    merchantId: string,
    dto: { locationId: string; idempotencyKey: string },
    operation: (context: ProcurementCommandContext) => Promise<T>,
    expectedVersion?: number,
  ): Promise<{ commandId: string; correlationId: string; value: T }> {
    const fingerprint = commandFingerprint(commandType, dto);
    try {
      const result = await this.integrity.execute<T>(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.idempotencyKey,
          idempotencyKey: dto.idempotencyKey,
          commandType,
          payload: dto,
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
        },
        async (context) => ({
          ok: true as const,
          value: await operation({
            client: context.client,
            commandId: context.commandId,
            correlationId: context.correlationId,
            fingerprint,
            // Wrapped rather than passed by reference: `context.appendAudit` is a
            // method that closes over the transaction's client, and handing it out
            // detached would let a caller invoke it with the wrong receiver.
            appendAudit: (event) => context.appendAudit(event),
          }),
        }),
      );
      if (result.status === 'succeeded' && result.result !== null)
        return {
          commandId: result.commandId,
          correlationId: result.correlationId,
          value: result.result,
        };
      throw new ConflictException({
        code: result.failureCode ?? 'CONFLICT',
        correlationId: result.correlationId,
      });
    } catch (error) {
      // A refusal the repository already typed passes through untouched: it named
      // the line, the version or the status, and re-wrapping it would lose that.
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException
      )
        throw error;
      const code = procurementLedgerCode(error) ?? procurementConstraintCode(error);
      if (code) throw new ConflictException({ code });
      // Anything else is a real fault, and must stay a 500: a module that mapped
      // every database error to a 409 would hide its own bugs behind a message
      // about the operator's input.
      throw error;
    }
  }

  /**
   * The dashboard user who issued the command, which is what the ledger records as
   * its operator. A console command has no enrolled terminal, so `device_id` and
   * `credential_version` travel as null — a state the ledger's own
   * `stock_ledger_command_context_ck` allows and the only honest one here.
   */
  private operatorId(): string {
    const userId = getRequestContext()?.userId;
    if (!userId) throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED' });
    return userId;
  }

  private correlationId(): string {
    return getRequestContext()?.correlationId ?? getRequestContext()?.requestId ?? '';
  }
}

/** What a repository operation is handed inside the command transaction. */
interface ProcurementCommandContext {
  client: PoolClient;
  commandId: string;
  correlationId: string;
  fingerprint: string;
  appendAudit: (event: AuditAppend) => Promise<string>;
}

/** base64url JSON keyset cursor, the same shape the customer list uses. */
function encodeCursor(cursor: Record<string, string>): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** The column's own bound: 12 MB of bytes, which is the binary of 20 MB of base64. */
const MAX_INVOICE_ARTIFACT_BYTES = 12_582_912;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * WHAT A PHOTO UPLOAD IS ALLOWED TO BE (plan D11 and §10.2).
 *
 * The image is stored and nothing else happens: no lines, no match, no ledger. The
 * content type comes from the BYTES and not from the caller, because
 * `supplier_invoice.artifact_content_type` is a claim about a file the platform will
 * later render, and a caller-supplied type is a caller-supplied HTML sniffing hazard.
 * A `data:` URL is accepted because that is what a browser's FileReader produces.
 */
function decodeInvoiceArtifact(raw: string): { bytes: Buffer; contentType: string } {
  const base64 = raw.replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.byteLength === 0)
    throw new BadRequestException({ code: 'SUPPLIER_INVOICE_ARTIFACT_UNSUPPORTED' });
  if (bytes.byteLength > MAX_INVOICE_ARTIFACT_BYTES)
    throw new BadRequestException({ code: 'SUPPLIER_INVOICE_ARTIFACT_TOO_LARGE' });

  if (bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC))
    return { bytes, contentType: 'image/png' };
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { bytes, contentType: 'image/jpeg' };
  if (
    bytes.byteLength >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return { bytes, contentType: 'image/webp' };

  throw new BadRequestException({ code: 'SUPPLIER_INVOICE_ARTIFACT_UNSUPPORTED' });
}

/**
 * Decode a list cursor into the two keyset shapes this module pages by.
 *
 * A missing or malformed cursor means "start from the top" rather than an error: a
 * cursor is a paging convenience, and a 500 on one would strand a client on a page
 * it can never leave. The uuid check is what stops a half-decoded cursor reaching
 * the SQL as a plausible-looking string, and the value check keeps a cursor with a
 * missing sort key from silently paging from the wrong place.
 */
function decodeSupplierCursor(raw: string | undefined): { name: string; id: string } | null {
  const parsed = decodeKeysetCursor(raw);
  if (!parsed || typeof parsed.name !== 'string') return null;
  return { name: parsed.name, id: parsed.id };
}

function decodePurchaseOrderCursor(
  raw: string | undefined,
): { createdAt: string; id: string } | null {
  const parsed = decodeKeysetCursor(raw);
  if (!parsed || typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt)))
    return null;
  return { createdAt: parsed.createdAt, id: parsed.id };
}

function decodeKeysetCursor(
  raw: string | undefined,
): { id: string; [key: string]: unknown } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const id = parsed.id;
    if (typeof id !== 'string') return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    return { ...parsed, id };
  } catch {
    return null;
  }
}

/**
 * The typed refusal code a Nest conflict carries, when it carries one. A repository
 * refusal reaches the caller as `ConflictException({ code })`, and the code is the only
 * place the reason is readable.
 */
function httpRefusalCode(error: unknown): string | null {
  if (!(error instanceof ConflictException)) return null;
  const body = error.getResponse();
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
