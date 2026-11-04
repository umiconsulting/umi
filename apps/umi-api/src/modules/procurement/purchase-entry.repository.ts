import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  RecordInventoryPurchaseRequest,
  ReceiveSupplierInvoiceDirectRequest,
  SupplierInvoice,
} from '@umi/contract';
import type { PoolClient } from 'pg';
import { ProcurementRepository } from './procurement.repository';
import { extendedLineTotalMinor, receiptTotalMinor } from './procurement-domain';

type PostingContext = {
  commandId: string;
  idempotencyKey: string;
  fingerprint: string;
  correlationId: string;
};

/** Compose invoice evidence and existing stock posting in the caller's transaction. */
@Injectable()
export class PurchaseEntryRepository {
  constructor(private readonly procurement: ProcurementRepository) {}

  async recordPurchase(
    client: PoolClient,
    merchantId: string,
    userId: string,
    invoiceId: string,
    dto: RecordInventoryPurchaseRequest,
    command: PostingContext,
    artifact: { bytes: Buffer; contentType: string } | null,
  ): Promise<SupplierInvoice> {
    const items = await client.query<{
      id: string;
      display_name: string;
      base_unit: string;
      quantity_scale: number;
    }>(
      `SELECT id::text AS id,display_name,base_unit,quantity_scale FROM merchant.inventory_item
        WHERE merchant_id=$1::uuid AND id=ANY($2::uuid[]) AND active FOR SHARE`,
      [merchantId, dto.lines.map((line) => line.inventoryItemId)],
    );
    const known = new Map(items.rows.map((item) => [item.id, item]));
    const lines = dto.lines.map((line) => {
      const item = known.get(line.inventoryItemId);
      if (!item) throw new NotFoundException({ code: 'INVENTORY_ITEM_ARCHIVED' });
      if (item.base_unit !== line.quantity.unit)
        throw new ConflictException({ code: 'INVENTORY_UNIT_CONVERSION_REQUIRED' });
      if (item.quantity_scale !== line.quantity.scale)
        throw new ConflictException({ code: 'INVENTORY_QUANTITY_NOT_EXACT' });
      return {
        ...line,
        description: item.display_name,
        lineTotalMinor: extendedLineTotalMinor({
          ...line.quantity,
          unitCostMinor: line.unitCostMinor,
        }),
      };
    });
    const total = receiptTotalMinor(lines);
    if (dto.supplierId)
      await this.procurement.assertActiveSupplier(client, merchantId, dto.supplierId);
    await client.query(
      `INSERT INTO merchant.supplier_invoice
        (id,merchant_id,supplier_id,public_reference,folio,issued_on,currency,subtotal_minor,tax_minor,total_minor,
         source,status,artifact_bytes,artifact_content_type,command_id,idempotency_key,command_fingerprint,captured_by)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$1::text,$4,$5::date,$6,$7,0,$7,$8,'matched',$9,$10,$11::uuid,$12::uuid,$13,$14::uuid)`,
      [
        invoiceId,
        merchantId,
        dto.supplierId ?? null,
        dto.folio ?? null,
        dto.issuedOn,
        dto.currency,
        total,
        artifact ? 'photo' : 'manual',
        artifact?.bytes ?? null,
        artifact?.contentType ?? null,
        command.commandId,
        command.idempotencyKey,
        command.fingerprint,
        userId,
      ],
    );
    for (const [index, line] of lines.entries()) {
      await client.query(
        `INSERT INTO merchant.supplier_invoice_line
         (merchant_id,supplier_invoice_id,line_number,raw_description,quantity,quantity_scale,unit,
          unit_cost_minor,line_total_minor,matched_inventory_item_id,match_method,match_confidence)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10::uuid,'manual',100)`,
        [
          merchantId,
          invoiceId,
          index + 1,
          line.description,
          line.quantity.value,
          line.quantity.scale,
          line.quantity.unit,
          line.unitCostMinor,
          line.lineTotalMinor,
          line.inventoryItemId,
        ],
      );
    }
    return this.receiveInvoiceDirect(
      client,
      merchantId,
      userId,
      { ...dto, supplierInvoiceId: invoiceId },
      command,
    );
  }

  async receiveInvoiceDirect(
    client: PoolClient,
    merchantId: string,
    userId: string,
    dto: ReceiveSupplierInvoiceDirectRequest,
    command: PostingContext,
  ): Promise<SupplierInvoice> {
    const locked = await client.query<{ status: string }>(
      `SELECT status FROM merchant.supplier_invoice WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, dto.supplierInvoiceId],
    );
    if (!locked.rows[0]) throw new NotFoundException({ code: 'SUPPLIER_INVOICE_NOT_FOUND' });
    if (locked.rows[0].status === 'committed')
      throw new ConflictException({ code: 'SUPPLIER_INVOICE_ALREADY_COMMITTED' });
    if (locked.rows[0].status === 'rejected')
      throw new ConflictException({ code: 'SUPPLIER_INVOICE_REJECTED' });
    const invoice = await this.procurement.loadSupplierInvoice(
      client,
      merchantId,
      dto.supplierInvoiceId,
      command.correlationId,
    );
    if (!invoice) throw new NotFoundException({ code: 'SUPPLIER_INVOICE_NOT_FOUND' });
    if (!invoice.lines.length)
      throw new ConflictException({ code: 'SUPPLIER_INVOICE_HAS_NO_LINES' });
    if (
      invoice.lines.some((line) => !line.matchedInventoryItemId || line.matchMethod === 'unmatched')
    )
      throw new ConflictException({ code: 'SUPPLIER_INVOICE_UNMATCHED_LINES' });
    if (
      invoice.lines.length > 1000 ||
      new Set(invoice.lines.map((line) => line.matchedInventoryItemId)).size > 100
    )
      throw new ConflictException({ code: 'INVENTORY_PURCHASE_ITEM_LIMIT' });
    receiptTotalMinor(invoice.lines);
    const order = await this.procurement.createPurchaseOrder(
      client,
      merchantId,
      userId,
      {
        locationId: dto.locationId,
        inventoryLocationId: dto.inventoryLocationId,
        supplierId: invoice.supplierId,
        idempotencyKey: command.idempotencyKey,
        currency: invoice.currency,
        expectedOn: null,
        note: dto.note ?? null,
        lines: invoice.lines.map((line) => ({
          inventoryItemId: line.matchedInventoryItemId!,
          supplierSku: line.supplierSku,
          description: line.matchedInventoryItemName,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          lineTotalMinor: line.lineTotalMinor,
        })),
      },
      'direct_purchase',
    );
    await this.procurement.sendPurchaseOrder(
      client,
      merchantId,
      { ...command, locationId: dto.locationId, purchaseOrderId: order.id },
      userId,
      command.fingerprint,
      command.correlationId,
    );
    return this.procurement.commitSupplierInvoice(
      client,
      merchantId,
      {
        ...command,
        supplierInvoiceId: invoice.id,
        purchaseOrderId: order.id,
        note: dto.note ?? null,
        lines: invoice.lines.map((line, index) => ({
          lineId: line.id,
          purchaseOrderLineId: order.lines[index].id,
          receivedQuantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          lineTotalMinor: line.lineTotalMinor,
        })),
      },
      userId,
      command.fingerprint,
    );
  }
}
