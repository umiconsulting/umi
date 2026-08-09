import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  ExceptionCommandRecoveryQuery,
  ExceptionCommandRecoveryResult,
  ExceptionHistory,
  ManualTerminalRefundOutcomeRequest,
  ManualTerminalRefundOutcomeResult,
  ReceiptSnapshot,
  RefundPreview,
  RefundPreviewRequest,
  SaleExceptionCommand,
  SaleExceptionEligibility,
  SaleExceptionResult,
} from '@umi/contract';
import { PgService } from '../../shared/database/pg.service';
import {
  calculateRefundPreview,
  type RefundAllocationPolicy,
  type RefundSource,
} from './refund-calculator';

export interface ExceptionAuthorization {
  operatorSessionId: string;
  durableSessionId: string;
  operatorId: string;
  operatorReference: string;
  locationId: string;
  deviceId: string;
  credentialVersion: number;
  permissions: string[];
}

type RestockValue =
  | 'restock'
  | 'do_not_restock'
  | 'inspection_required'
  | 'not_applicable'
  | 'unknown_until_inventory_review';

interface PolicyRow {
  version: string;
  refundsEnabled: boolean;
  voidsEnabled: boolean;
  refundWindowMinutes: number;
  voidWindowMinutes: number;
  cashierRefundThreshold: string;
  cashRefundThreshold: string;
  cashRefundRequiresShift: boolean;
  requireDifferentApprover: boolean;
  allocationPolicy: RefundAllocationPolicy;
  tipPolicy:
    | 'non_refundable'
    | 'full_refund_only'
    | 'proportional'
    | 'manager_selectable'
    | 'support_required';
  maximumLines: number;
  expiresAt: string;
}

interface SourceLine {
  id: string;
  name: string;
  productReference: string;
  originalQuantity: number;
  remainingQuantity: number;
  originalMerchandise: number;
  originalTax: number;
  originalDiscount: number;
  originalTip: number;
  originalTotal: number;
  remainingMerchandise: number;
  remainingTax: number;
  remainingDiscount: number;
  remainingTip: number;
  remainingTotal: number;
  isService: boolean;
}

interface SaleSource {
  id: string;
  cartId: string;
  orderId: string;
  receiptId: string;
  receiptReference: string;
  businessDate: string;
  committedAt: string;
  cartOperatorSessionId: string;
  saleVersion: number;
  exceptionVersion: number;
  currency: string;
  snapshot: ReceiptSnapshot;
  originalTotal: number;
  previouslyRefunded: number;
  remainingRefundable: number;
  ambiguousPayment: boolean;
  lines: SourceLine[];
  tenders: RefundSource['tenders'];
}

interface StoredLine {
  lineId: string;
  quantity: number;
  merchandise: number;
  tax: number;
  discount: number;
  tip: number;
  total: number;
  restockDecision: RestockValue;
  originalQuantity: number;
  originalMerchandise: number;
  originalTax: number;
  originalDiscount: number;
  originalTip: number;
  originalTotal: number;
  name: string;
}

interface StoredTender {
  id: string;
  type: 'cash' | 'manual_terminal' | 'wallet' | 'gift_card';
  amount: number;
}

interface PreviewRow {
  id: string;
  saleId: string;
  originalReceiptId: string;
  operatorSessionId: string;
  deviceId: string;
  exceptionType: 'void' | 'full_refund' | 'partial_refund';
  reasonCode: RefundPreviewRequest['reason'];
  note: string | null;
  lineAllocations: StoredLine[];
  tenderAllocations: StoredTender[];
  terminalRefundStatus: string | null;
  allocationPolicy: RefundAllocationPolicy;
  merchandiseMinorUnits: string;
  taxMinorUnits: string;
  discountMinorUnits: string;
  tipMinorUnits: string;
  totalMinorUnits: string;
  remainingAfterMinorUnits: string;
  currency: string;
  approvalRequired: boolean;
  saleVersion: string;
  exceptionVersion: string;
  previewFingerprint: string;
  correlationId: string;
  expiresAt: string;
}

const safe = (value: number): number => {
  if (!Number.isSafeInteger(value)) throw new RangeError('REFUND_AMOUNT_OUT_OF_RANGE');
  return value;
};

const historicalProportion = (amount: number, weight: number, totalWeight: number): number => {
  safe(amount);
  safe(weight);
  safe(totalWeight);
  if (amount < 0 || weight < 0 || totalWeight <= 0) {
    throw new RangeError('REFUND_HISTORICAL_ALLOCATION_INVALID');
  }
  return safe(Number((BigInt(amount) * BigInt(weight)) / BigInt(totalWeight)));
};

export const refundApprovalRequired = (
  exceptionType: RefundPreviewRequest['exceptionType'],
  total: number,
  cashierThreshold: number,
  cashAmount: number,
  cashThreshold: number,
  hasManualTerminal: boolean,
  hasNoRestock: boolean,
): boolean =>
  exceptionType !== 'partial_refund' ||
  total > cashierThreshold ||
  cashAmount > cashThreshold ||
  hasManualTerminal ||
  hasNoRestock;

@Injectable()
export class PosExceptionRepository {
  constructor(private readonly pg: PgService) {}

  authorize(
    userId: string,
    durableSessionId: string,
    deviceId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<ExceptionAuthorization | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<ExceptionAuthorization>(
          `SELECT os.id::text AS "operatorSessionId",
                  os.durable_session_id::text AS "durableSessionId",
                  os.user_id::text AS "operatorId",u.full_name AS "operatorReference",
                  os.location_id::text AS "locationId",
                  os.device_id::text AS "deviceId",d.credential_version AS "credentialVersion",
                  os.permissions
           FROM runtime.operator_session os
           JOIN merchant.device d ON d.id=os.device_id
           JOIN umi.user u ON u.id=os.user_id
           WHERE os.id=$6::uuid AND os.durable_session_id=$2::uuid
             AND os.user_id=$1::uuid AND os.device_id=$3::uuid
             AND os.merchant_id=$4::uuid AND os.location_id=$5::uuid
             AND os.state='active' AND os.expires_at>now()
             AND d.status='active' AND d.credential_version>0`,
          [userId, durableSessionId, deviceId, merchantId, locationId, operatorSessionId],
        );
        return rows[0] ?? null;
      },
      locationId,
    );
  }

  async eligibility(
    userId: string,
    merchantId: string,
    saleId: string,
    authorization: ExceptionAuthorization,
  ): Promise<SaleExceptionEligibility | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const source = await this.loadSource(client, merchantId, authorization, saleId, false);
        if (!source) return null;
        const policy = await this.policy(client, merchantId, authorization, source.currency);
        return this.toEligibility(source, policy, authorization);
      },
      authorizationLocation(authorization),
    );
  }

  async preview(
    userId: string,
    merchantId: string,
    saleId: string,
    authorization: ExceptionAuthorization,
    dto: RefundPreviewRequest,
  ): Promise<RefundPreview> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const source = await this.loadSource(client, merchantId, authorization, saleId, true);
        if (!source) throw new ConflictException({ code: 'SALE_NOT_FOUND' });
        const policy = await this.policy(client, merchantId, authorization, source.currency);
        const eligibility = this.toEligibility(source, policy, authorization);
        if (!eligibility.allowedTypes.includes(dto.exceptionType)) {
          throw new ConflictException({ code: 'REFUND_NOT_ELIGIBLE' });
        }
        if (source.saleVersion !== dto.expectedSaleVersion || source.ambiguousPayment) {
          throw new ConflictException({
            code: source.ambiguousPayment ? 'PAYMENT_OUTCOME_UNKNOWN' : 'STALE_SALE',
          });
        }
        const selected = this.selection(source, dto);
        if (selected.length === 0 || selected.length > policy.maximumLines) {
          throw new ConflictException({ code: 'REFUND_SELECTION_INVALID' });
        }
        const calculated = calculateRefundPreview(
          {
            currency: source.currency,
            lines: source.lines.map((line) => ({
              id: line.id,
              quantity: line.remainingQuantity,
              merchandise: line.remainingMerchandise,
              tax: line.remainingTax,
              discount: line.remainingDiscount,
              tip: this.refundableTip(line, policy, dto.exceptionType),
            })),
            tenders: source.tenders,
          },
          selected.map((line) => ({ lineId: line.saleLineId, quantity: line.quantity })),
          policy.allocationPolicy,
        );
        if (
          calculated.tenders.some((tender) => tender.type === 'cash') &&
          !hasPermission(authorization, 'sale.refund.cash')
        ) {
          throw new ConflictException({ code: 'PERMISSION_REVOKED' });
        }
        if (
          calculated.tenders.some((tender) => tender.type === 'manual_terminal') &&
          !hasPermission(authorization, 'sale.refund.manual_terminal')
        ) {
          throw new ConflictException({ code: 'PERMISSION_REVOKED' });
        }
        if (
          calculated.tenders.some((tender) => tender.type === 'wallet') &&
          !hasPermission(authorization, 'wallet.refund')
        ) {
          throw new ConflictException({ code: 'PERMISSION_REVOKED' });
        }
        if (
          calculated.tenders.some((tender) => tender.type === 'gift_card') &&
          !hasPermission(authorization, 'gift_card.refund')
        ) {
          throw new ConflictException({ code: 'PERMISSION_REVOKED' });
        }
        const storedLines: StoredLine[] = calculated.lines.map((line) => {
          const sourceLine = source.lines.find((item) => item.id === line.lineId)!;
          const request = selected.find((item) => item.saleLineId === line.lineId)!;
          return {
            ...line,
            restockDecision: sourceLine.isService ? 'not_applicable' : request.restockDecision,
            originalQuantity: sourceLine.originalQuantity,
            originalMerchandise: sourceLine.originalMerchandise,
            originalTax: sourceLine.originalTax,
            originalDiscount: sourceLine.originalDiscount,
            originalTip: sourceLine.originalTip,
            originalTotal: sourceLine.originalTotal,
            name: sourceLine.name,
          };
        });
        const totals = storedLines.reduce(
          (value, line) => ({
            merchandise: safe(value.merchandise + line.merchandise),
            tax: safe(value.tax + line.tax),
            discount: safe(value.discount + line.discount),
            tip: safe(value.tip + line.tip),
          }),
          { merchandise: 0, tax: 0, discount: 0, tip: 0 },
        );
        const requiresApproval = refundApprovalRequired(
          dto.exceptionType,
          calculated.total,
          Number(policy.cashierRefundThreshold),
          calculated.tenders.find((tender) => tender.type === 'cash')?.amount ?? 0,
          Number(policy.cashRefundThreshold),
          calculated.tenders.some((tender) => tender.type === 'manual_terminal'),
          selected.some((line) => line.restockDecision === 'do_not_restock'),
        );
        const shift = calculated.tenders.some((tender) => tender.type === 'cash')
          ? await this.activeCashShift(client, merchantId, authorization, source.currency)
          : null;
        if (
          calculated.tenders.some((tender) => tender.type === 'cash') &&
          policy.cashRefundRequiresShift &&
          (!shift ||
            shift.expectedCash <
              (calculated.tenders.find((tender) => tender.type === 'cash')?.amount ?? 0))
        ) {
          throw new ConflictException({
            code: shift ? 'INSUFFICIENT_EXPECTED_CASH' : 'CASH_SHIFT_NOT_ELIGIBLE',
          });
        }
        const fingerprint = createHash('sha256')
          .update(
            JSON.stringify({
              saleId,
              saleVersion: source.saleVersion,
              exceptionVersion: source.exceptionVersion,
              type: dto.exceptionType,
              reason: dto.reason,
              lines: storedLines,
              tenders: calculated.tenders,
              policy: policy.version,
            }),
          )
          .digest('hex');
        const previewId = randomUUID();
        const correlationReference = randomUUID();
        const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
        const terminalStatus = calculated.tenders.some(
          (tender) => tender.type === 'manual_terminal',
        )
          ? 'awaiting_operator_confirmation'
          : null;
        await client.query(
          `INSERT INTO merchant.pos_exception_preview
               (id,merchant_id,location_id,sale_id,original_receipt_id,
                operator_session_id,device_id,exception_type,reason_code,note,
                selection,line_allocations,tender_allocations,restock_intents,
                terminal_refund_status,allocation_policy,merchandise_minor_units,tax_minor_units,
                discount_minor_units,tip_minor_units,total_minor_units,
                remaining_after_minor_units,currency,approval_required,sale_version,
                exception_version,preview_fingerprint,correlation_id,expires_at)
             VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,
               $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
          [
            previewId,
            merchantId,
            dto.locationId,
            saleId,
            source.receiptId,
            authorization.operatorSessionId,
            authorization.deviceId,
            dto.exceptionType,
            dto.reason,
            dto.note,
            JSON.stringify(selected),
            JSON.stringify(storedLines),
            JSON.stringify(calculated.tenders),
            JSON.stringify(
              storedLines.map((line) => ({ lineId: line.lineId, decision: line.restockDecision })),
            ),
            terminalStatus,
            policy.allocationPolicy,
            totals.merchandise,
            totals.tax,
            totals.discount,
            totals.tip,
            calculated.total,
            source.remainingRefundable - calculated.total,
            source.currency,
            requiresApproval,
            source.saleVersion,
            source.exceptionVersion,
            fingerprint,
            correlationReference,
            expiresAt,
          ],
        );
        const money = (minorUnits: number) => ({ minorUnits, currency: source.currency });
        const cashTender = calculated.tenders.find((tender) => tender.type === 'cash');
        const terminalTender = calculated.tenders.find(
          (tender) => tender.type === 'manual_terminal',
        );
        return {
          previewId,
          saleId,
          originalReceiptId: source.receiptId,
          exceptionType: dto.exceptionType,
          status: 'preview_ready',
          lines: storedLines.map((line) => ({
            saleLineId: line.lineId,
            quantity: line.quantity,
            merchandise: money(line.merchandise),
            tax: money(line.tax),
            discount: money(line.discount),
            tip: money(line.tip),
            total: money(line.total),
            restockDecision: line.restockDecision,
          })),
          allocation: {
            merchandise: money(totals.merchandise),
            tax: money(totals.tax),
            discount: money(totals.discount),
            tip: money(totals.tip),
            total: money(calculated.total),
          },
          tax: { amount: money(totals.tax), historical: true },
          discount: { amount: money(totals.discount), historical: true },
          tip: { amount: money(totals.tip), policy: policy.tipPolicy },
          tenders: calculated.tenders.map((tender) => ({
            originalTenderId: tender.id,
            tenderType: tender.type,
            amount: money(tender.amount),
            strategy: policy.allocationPolicy,
          })),
          cash:
            cashTender && shift
              ? {
                  amount: money(cashTender.amount),
                  currentShiftId: shift.id,
                  currentRegisterId: shift.registerId,
                  approvalRequired: cashTender.amount > Number(policy.cashRefundThreshold),
                  expectedCashAfter: money(Math.max(0, shift.expectedCash - cashTender.amount)),
                }
              : null,
          manualTerminal: terminalTender
            ? {
                status: 'awaiting_operator_confirmation',
                amount: money(terminalTender.amount),
                correlationReference,
                queryOnly: false,
                canRetryAsNew: true,
              }
            : null,
          remainingRefundableAfter: money(source.remainingRefundable - calculated.total),
          approvalRequired: requiresApproval,
          reason: dto.reason,
          previewFingerprint: fingerprint,
          expiresAt,
          saleVersion: source.saleVersion,
          exceptionVersion: source.exceptionVersion,
          correlationReference,
        };
      },
      dto.locationId,
    );
  }

  async assertPreview(
    userId: string,
    merchantId: string,
    locationId: string,
    saleId: string,
    previewId: string,
    fingerprint: string,
  ): Promise<void> {
    const found = await this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) =>
        client.query(
          `SELECT 1 FROM merchant.pos_exception_preview
           WHERE id=$4::uuid AND merchant_id=$1::uuid AND location_id=$2::uuid
             AND sale_id=$3::uuid AND preview_fingerprint=$5 AND expires_at>now()`,
          [merchantId, locationId, saleId, previewId, fingerprint],
        ),
      locationId,
    );
    if (!found.rows[0]) throw new ConflictException({ code: 'STALE_PREVIEW' });
  }

  async approvalActor(
    _userId: string,
    merchantId: string,
    locationId: string,
    approvalId: string,
  ): Promise<string | null> {
    return this.pg.workerTx(async (client) => {
      const { rows } = await client.query<{ name: string }>(
        `SELECT u.full_name AS name FROM runtime.elevation_grant e
         JOIN umi.user u ON u.id=e.approved_by
         WHERE e.id=$1::uuid AND e.merchant_id=$2::uuid AND e.location_id=$3::uuid`,
        [approvalId, merchantId, locationId],
      );
      return rows[0]?.name ?? null;
    });
  }

  async commit(
    client: PoolClient,
    merchantId: string,
    saleId: string,
    authorization: ExceptionAuthorization,
    dto: SaleExceptionCommand,
    commandFingerprint: string,
    correlationId: string,
  ): Promise<SaleExceptionResult> {
    const preview = await this.lockPreview(
      client,
      merchantId,
      dto.locationId,
      saleId,
      dto.previewId,
      dto.previewFingerprint,
    );
    if (!preview || new Date(preview.expiresAt).getTime() <= Date.now()) {
      throw new ConflictException({ code: 'STALE_PREVIEW' });
    }
    if (
      preview.operatorSessionId !== authorization.operatorSessionId ||
      preview.deviceId !== authorization.deviceId ||
      Number(preview.saleVersion) !== dto.expectedSaleVersion
    ) {
      throw new ConflictException({ code: 'SALE_EXCEPTION_CONTEXT_CHANGED' });
    }
    const permission =
      preview.exceptionType === 'void'
        ? 'sale.void.create'
        : preview.exceptionType === 'full_refund'
          ? 'sale.refund.full'
          : 'sale.refund.partial';
    if (!hasPermission(authorization, permission)) {
      throw new ConflictException({ code: 'PERMISSION_REVOKED' });
    }
    const currentVersion = await client.query<{ version: string }>(
      `SELECT o.version::text FROM merchant.pos_committed_sale s
       JOIN merchant.customer_order o ON o.id=s.order_id
       WHERE s.id=$1::uuid AND s.merchant_id=$2::uuid AND s.location_id=$3::uuid
       FOR UPDATE OF s,o`,
      [saleId, merchantId, dto.locationId],
    );
    if (Number(currentVersion.rows[0]?.version) !== dto.expectedSaleVersion) {
      throw new ConflictException({ code: 'OPTIMISTIC_VERSION_CONFLICT' });
    }
    const exceptionCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM merchant.pos_sale_exception
       WHERE sale_id=$1::uuid`,
      [saleId],
    );
    if (Number(exceptionCount.rows[0]?.count) !== Number(preview.exceptionVersion)) {
      throw new ConflictException({ code: 'STALE_PREVIEW' });
    }
    if (
      preview.tenderAllocations.some((tender) => tender.type === 'manual_terminal') &&
      preview.terminalRefundStatus !== 'confirmed_success'
    ) {
      throw new ConflictException({
        code:
          preview.terminalRefundStatus === 'outcome_unknown'
            ? 'PAYMENT_OUTCOME_UNKNOWN'
            : 'TERMINAL_REFUND_CONFIRMATION_REQUIRED',
      });
    }
    let approvingOperator: string | null = null;
    if (preview.approvalRequired) {
      if (!dto.approvalId) throw new ConflictException({ code: 'APPROVAL_REQUIRED' });
      const grant = await client.query<{ actor: string }>(
        `SELECT u.full_name AS actor
         FROM runtime.elevation_grant e JOIN umi.user u ON u.id=e.approved_by
         WHERE e.id=$1::uuid AND e.session_id=$2::uuid AND e.merchant_id=$3::uuid
           AND e.location_id=$4::uuid AND e.permission_key='sale.refund.approve'
           AND e.method='manager_approval' AND e.command_fingerprint=$5
           AND e.expires_at>now() AND e.consumed_at IS NULL
         FOR UPDATE OF e`,
        [
          dto.approvalId,
          authorization.durableSessionId,
          merchantId,
          dto.locationId,
          commandFingerprint,
        ],
      );
      if (!grant.rows[0]) throw new ConflictException({ code: 'APPROVAL_EXPIRED' });
      approvingOperator = grant.rows[0].actor;
      const consumed = await client.query(
        `UPDATE runtime.elevation_grant SET consumed_at=now(),consumed_by_command_id=$2::uuid
         WHERE id=$1::uuid AND consumed_at IS NULL`,
        [dto.approvalId, dto.commandId],
      );
      if (consumed.rowCount !== 1) throw new ConflictException({ code: 'APPROVAL_REUSED' });
    }
    const exceptionId = randomUUID();
    const exceptionStatus = 'committed' as const;
    const sourceReceipt = await client.query<{
      receiptReference: string;
      businessDate: string;
      snapshot: ReceiptSnapshot;
      merchantName: string;
      locationName: string;
    }>(
      `SELECT r.receipt_number AS "receiptReference",r.business_date::text AS "businessDate",
              r.snapshot,m.name AS "merchantName",l.name AS "locationName"
       FROM merchant.receipt_snapshot r
       JOIN merchant.merchant m ON m.id=r.merchant_id
       JOIN merchant.location l ON l.id=r.location_id
       WHERE r.id=$1::uuid AND r.merchant_id=$2::uuid AND r.location_id=$3::uuid`,
      [preview.originalReceiptId, merchantId, dto.locationId],
    );
    if (!sourceReceipt.rows[0]) throw new ConflictException({ code: 'ORIGINAL_RECEIPT_NOT_FOUND' });
    await client.query(
      `INSERT INTO merchant.pos_sale_exception
         (id,merchant_id,location_id,sale_id,original_receipt_id,preview_id,
          exception_type,status,reason_code,note,operator_id,operator_session_id,
          device_id,device_credential_version,approval_id,command_id,idempotency_key,
          command_fingerprint,preview_fingerprint,merchandise_minor_units,tax_minor_units,
          discount_minor_units,tip_minor_units,total_minor_units,currency,business_date,
          correlation_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10,
         $11::uuid,$12::uuid,$13::uuid,$14,$15::uuid,$16::uuid,$17::uuid,$18,$19,
         $20,$21,$22,$23,$24,$25,current_date,$26)`,
      [
        exceptionId,
        merchantId,
        dto.locationId,
        saleId,
        preview.originalReceiptId,
        preview.id,
        preview.exceptionType,
        exceptionStatus,
        preview.reasonCode,
        preview.note,
        authorization.operatorId,
        authorization.operatorSessionId,
        authorization.deviceId,
        authorization.credentialVersion,
        dto.approvalId,
        dto.commandId,
        dto.idempotencyKey,
        commandFingerprint,
        preview.previewFingerprint,
        preview.merchandiseMinorUnits,
        preview.taxMinorUnits,
        preview.discountMinorUnits,
        preview.tipMinorUnits,
        preview.totalMinorUnits,
        preview.currency,
        correlationId,
      ],
    );
    const receiptLines: RefundPreview['lines'] = [];
    for (const line of preview.lineAllocations) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO merchant.pos_sale_exception_line
           (merchant_id,location_id,exception_id,sale_id,sale_line_id,original_quantity,
            compensated_quantity,original_merchandise_minor_units,original_tax_minor_units,
            original_discount_minor_units,original_tip_minor_units,original_total_minor_units,
            merchandise_minor_units,tax_minor_units,discount_minor_units,tip_minor_units,
            total_minor_units,currency,restock_decision)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9,$10,$11,
                 $12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING id::text`,
        [
          merchantId,
          dto.locationId,
          exceptionId,
          saleId,
          line.lineId,
          line.originalQuantity,
          line.quantity,
          line.originalMerchandise,
          line.originalTax,
          line.originalDiscount,
          line.originalTip,
          line.originalTotal,
          line.merchandise,
          line.tax,
          line.discount,
          line.tip,
          line.total,
          preview.currency,
          line.restockDecision,
        ],
      );
      await client.query(
        `INSERT INTO merchant.pos_restock_intent
           (merchant_id,location_id,exception_line_id,sale_line_id,quantity,decision)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6)
         RETURNING id::text`,
        [
          merchantId,
          dto.locationId,
          inserted.rows[0].id,
          line.lineId,
          line.quantity,
          line.restockDecision,
        ],
      );
      receiptLines.push({
        saleLineId: line.lineId,
        quantity: line.quantity,
        merchandise: money(line.merchandise, preview.currency),
        tax: money(line.tax, preview.currency),
        discount: money(line.discount, preview.currency),
        tip: money(line.tip, preview.currency),
        total: money(line.total, preview.currency),
        restockDecision: line.restockDecision,
      });
    }
    const tenderReceipt: RefundPreview['tenders'] = [];
    for (const tender of preview.tenderAllocations) {
      const reversalStatus = 'confirmed_success';
      await client.query(
        `INSERT INTO merchant.pos_tender_compensation
           (merchant_id,location_id,exception_id,original_tender_id,tender_type,
            amount_minor_units,currency,reversal_status,correlation_id,operator_asserted)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)`,
        [
          merchantId,
          dto.locationId,
          exceptionId,
          tender.id,
          tender.type,
          tender.amount,
          preview.currency,
          reversalStatus,
          preview.correlationId,
          tender.type === 'manual_terminal',
        ],
      );
      tenderReceipt.push({
        originalTenderId: tender.id,
        tenderType: tender.type,
        amount: money(tender.amount, preview.currency),
        strategy: preview.allocationPolicy,
      });
      if (tender.type === 'cash') {
        if (!hasPermission(authorization, 'sale.refund.cash')) {
          throw new ConflictException({ code: 'PERMISSION_REVOKED' });
        }
        await this.postCashRefund(
          client,
          merchantId,
          dto.locationId,
          saleId,
          exceptionId,
          tender,
          authorization,
          dto.commandId,
          preview.currency,
        );
      }
      if (tender.type === 'wallet' && !hasPermission(authorization, 'wallet.refund')) {
        throw new ConflictException({ code: 'PERMISSION_REVOKED' });
      }
      if (tender.type === 'gift_card' && !hasPermission(authorization, 'gift_card.refund')) {
        throw new ConflictException({ code: 'PERMISSION_REVOKED' });
      }
    }
    await client.query(
      `SELECT merchant.reverse_customer_value(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,current_date,$8::uuid,$9::uuid)`,
      [
        merchantId,
        dto.locationId,
        saleId,
        exceptionId,
        dto.commandId,
        dto.idempotencyKey,
        commandFingerprint,
        authorization.operatorId,
        authorization.deviceId,
      ],
    );
    const allocation = {
      merchandise: money(Number(preview.merchandiseMinorUnits), preview.currency),
      tax: money(Number(preview.taxMinorUnits), preview.currency),
      discount: money(Number(preview.discountMinorUnits), preview.currency),
      tip: money(Number(preview.tipMinorUnits), preview.currency),
      total: money(Number(preview.totalMinorUnits), preview.currency),
    };
    const receiptId = randomUUID();
    const receiptReference = `EX-${receiptId}`;
    const receipt = {
      id: receiptId,
      publicReference: receiptReference,
      exceptionType: preview.exceptionType,
      originalSaleReference: saleId,
      originalReceiptReference: sourceReceipt.rows[0].receiptReference,
      originalBusinessDate: sourceReceipt.rows[0].businessDate,
      exceptionBusinessDate: new Date().toISOString().slice(0, 10),
      merchantDisplayName: sourceReceipt.rows[0].merchantName,
      locationDisplayName: sourceReceipt.rows[0].locationName,
      operatorReference: authorization.operatorReference,
      approvingOperatorReference: approvingOperator,
      lines: receiptLines,
      allocation,
      tenders: tenderReceipt,
      terminalStatus: preview.tenderAllocations.some((tender) => tender.type === 'manual_terminal')
        ? ('confirmed_success' as const)
        : null,
      reason: preview.reasonCode,
      createdAt: new Date().toISOString(),
      correlationReference: preview.correlationId,
    };
    await client.query(
      `INSERT INTO merchant.pos_exception_receipt
         (id,merchant_id,location_id,exception_id,original_receipt_id,receipt_number,
          snapshot,business_date,currency,total_minor_units)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,current_date,$8,$9)`,
      [
        receiptId,
        merchantId,
        dto.locationId,
        exceptionId,
        preview.originalReceiptId,
        receiptReference,
        JSON.stringify(receipt),
        preview.currency,
        preview.totalMinorUnits,
      ],
    );
    if (preview.exceptionType === 'void') {
      await this.applyVoidKitchenConsequence(
        client,
        merchantId,
        dto.locationId,
        saleId,
        exceptionId,
        correlationId,
      );
    }
    return {
      exceptionId,
      saleId,
      status: exceptionStatus,
      exceptionType: preview.exceptionType,
      allocation,
      receipt,
      remainingRefundable: money(Number(preview.remainingAfterMinorUnits), preview.currency),
      correlationReference: preview.correlationId,
      committedAt: receipt.createdAt,
      retryAllowed: false,
    };
  }

  private async applyVoidKitchenConsequence(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    saleId: string,
    exceptionId: string,
    correlationId: string,
  ): Promise<void> {
    const order = await client.query<{ id: string; version: string }>(
      `SELECT ko.id::text,ko.version::text
         FROM merchant.pos_committed_sale s
         JOIN merchant.kitchen_order ko
           ON ko.merchant_id=s.merchant_id AND ko.source_order_id=s.order_id
        WHERE s.id=$1::uuid AND s.merchant_id=$2::uuid AND s.location_id=$3::uuid
        FOR UPDATE OF ko`,
      [saleId, merchantId, locationId],
    );
    const row = order.rows[0];
    if (!row) return;
    await client.query(
      `UPDATE merchant.kitchen_order_item
          SET status='cancelled',version=version+1,cancelled_at=clock_timestamp(),
              updated_at=clock_timestamp()
        WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid
          AND status IN ('queued','preparing','exception')`,
      [merchantId, row.id],
    );
    const status = await client.query<{ status: string }>(
      `SELECT CASE
          WHEN bool_or(status='ready') THEN 'exception'
          WHEN bool_and(status='cancelled') THEN 'cancelled'
          ELSE 'exception' END AS status
         FROM merchant.kitchen_order_item
        WHERE merchant_id=$1::uuid AND kitchen_order_id=$2::uuid`,
      [merchantId, row.id],
    );
    const nextStatus = status.rows[0]?.status ?? 'exception';
    const version = Number(row.version) + 1;
    await client.query(
      `UPDATE merchant.kitchen_order
          SET status=$3,version=$4,cancelled_at=clock_timestamp(),updated_at=clock_timestamp(),
              cancellation_code='sale_voided'
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, row.id, nextStatus, version],
    );
    await client.query(
      `INSERT INTO merchant.kitchen_event
         (event_id,merchant_id,location_id,kitchen_order_id,station_id,kind,
          aggregate_version,status,safe_payload,correlation_id)
       VALUES (gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,NULL,'order_cancelled',$4,$5,
               jsonb_build_object('exceptionId',$6::text,'consequence','sale_voided'),$7)`,
      [merchantId, locationId, row.id, version, nextStatus, exceptionId, correlationId],
    );
  }

  async terminalOutcome(
    client: PoolClient,
    merchantId: string,
    saleId: string,
    previewId: string,
    authorization: ExceptionAuthorization,
    dto: ManualTerminalRefundOutcomeRequest,
  ): Promise<ManualTerminalRefundOutcomeResult> {
    const preview = await client.query<{
      id: string;
      status: string | null;
      amount: string;
      currency: string;
      correlation: string;
    }>(
      `SELECT p.id::text,p.terminal_refund_status AS status,p.currency,
              p.correlation_id AS correlation,
              coalesce((SELECT sum((value->>'amount')::bigint)
                FROM jsonb_array_elements(p.tender_allocations) value
                WHERE value->>'type'='manual_terminal'),0)::text AS amount
       FROM merchant.pos_exception_preview p
       WHERE p.id=$1::uuid AND p.sale_id=$2::uuid AND p.merchant_id=$3::uuid
         AND p.location_id=$4::uuid AND p.operator_session_id=$5::uuid
         AND p.device_id=$6::uuid AND p.expires_at>now()
       FOR UPDATE`,
      [
        previewId,
        saleId,
        merchantId,
        dto.locationId,
        authorization.operatorSessionId,
        authorization.deviceId,
      ],
    );
    const row = preview.rows[0];
    if (!row || !row.status) throw new ConflictException({ code: 'TERMINAL_REFUND_NOT_FOUND' });
    if (row.status === 'confirmed_success' || row.status === 'outcome_unknown') {
      if (row.status !== dto.outcome) {
        throw new ConflictException({ code: 'TERMINAL_REFUND_IMMUTABLE' });
      }
    } else {
      await client.query(
        `UPDATE merchant.pos_exception_preview SET terminal_refund_status=$2
         WHERE id=$1::uuid`,
        [previewId, dto.outcome],
      );
    }
    const queryOnly = dto.outcome === 'outcome_unknown';
    return {
      previewId,
      status: dto.outcome,
      instruction: {
        status: dto.outcome,
        amount: money(Number(row.amount), row.currency),
        correlationReference: row.correlation,
        queryOnly,
        canRetryAsNew: !queryOnly && dto.outcome === 'operator_reported_failure',
      },
      updatedAt: new Date().toISOString(),
      correlationReference: row.correlation,
    };
  }

  async history(
    userId: string,
    merchantId: string,
    saleId: string,
    authorization: ExceptionAuthorization,
  ): Promise<ExceptionHistory> {
    const eligibility = await this.eligibility(userId, merchantId, saleId, authorization);
    if (!eligibility) throw new ConflictException({ code: 'SALE_NOT_FOUND' });
    const history = await this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<{
          exceptionId: string;
          exceptionType: 'void' | 'full_refund' | 'partial_refund';
          status: 'committed' | 'outcome_unknown' | 'reconciliation_required';
          reason: ExceptionHistory['entries'][number]['reason'];
          amount: string;
          operatorReference: string;
          approvalId: string | null;
          receiptReference: string | null;
          createdAt: string;
        }>(
          `SELECT e.id::text AS "exceptionId",e.exception_type AS "exceptionType",
                  e.status,e.reason_code AS reason,e.total_minor_units::text AS amount,
                  actor.full_name AS "operatorReference",e.approval_id::text AS "approvalId",
                  r.receipt_number AS "receiptReference",e.committed_at::text AS "createdAt"
           FROM merchant.pos_sale_exception e
           JOIN umi.user actor ON actor.id=e.operator_id
           LEFT JOIN merchant.pos_exception_receipt r ON r.exception_id=e.id
           WHERE e.merchant_id=$1::uuid AND e.location_id=$2::uuid AND e.sale_id=$3::uuid
           ORDER BY e.committed_at DESC,e.id DESC LIMIT 100`,
          [merchantId, authorizationLocation(authorization), saleId],
        );
        return {
          sale: eligibility.sale,
          rows,
          nextCursor: null,
        };
      },
      authorizationLocation(authorization),
    );
    const approvalIds = history.rows
      .map((row) => row.approvalId)
      .filter((id): id is string => id != null);
    const approvers = approvalIds.length
      ? await this.pg.workerTx(async (client) => {
          const { rows } = await client.query<{ id: string; name: string }>(
            `SELECT e.id::text,u.full_name AS name
             FROM runtime.elevation_grant e
             JOIN umi.user u ON u.id=e.approved_by
             WHERE e.id=ANY($1::uuid[]) AND e.merchant_id=$2::uuid AND e.location_id=$3::uuid`,
            [approvalIds, merchantId, authorizationLocation(authorization)],
          );
          return new Map(rows.map((row) => [row.id, row.name]));
        })
      : new Map<string, string>();
    return {
      sale: history.sale,
      entries: history.rows.map(({ approvalId, ...row }) => ({
        ...row,
        approvingOperatorReference: approvalId ? (approvers.get(approvalId) ?? null) : null,
        amount: money(Number(row.amount), eligibility.sale.currency),
      })),
      nextCursor: history.nextCursor,
    };
  }

  result(
    userId: string,
    merchantId: string,
    saleId: string,
    exceptionId: string,
    authorization: ExceptionAuthorization,
  ): Promise<SaleExceptionResult | null> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<{
          exceptionId: string;
          exceptionType: 'void' | 'full_refund' | 'partial_refund';
          status: 'committed' | 'outcome_unknown' | 'reconciliation_required';
          merchandise: string;
          tax: string;
          discount: string;
          tip: string;
          total: string;
          currency: string;
          receipt: SaleExceptionResult['receipt'];
          correlation: string;
          committedAt: string;
        }>(
          `SELECT e.id::text AS "exceptionId",e.exception_type AS "exceptionType",e.status,
                  e.merchandise_minor_units::text AS merchandise,e.tax_minor_units::text AS tax,
                  e.discount_minor_units::text AS discount,e.tip_minor_units::text AS tip,
                  e.total_minor_units::text AS total,e.currency,r.snapshot AS receipt,
                  e.correlation_id AS correlation,e.committed_at::text AS "committedAt"
           FROM merchant.pos_sale_exception e
           LEFT JOIN merchant.pos_exception_receipt r ON r.exception_id=e.id
           WHERE e.id=$1::uuid AND e.sale_id=$2::uuid AND e.merchant_id=$3::uuid
             AND e.location_id=$4::uuid`,
          [exceptionId, saleId, merchantId, authorizationLocation(authorization)],
        );
        const row = rows[0];
        if (!row) return null;
        const refunded = await client.query<{ amount: string; original: string }>(
          `SELECT coalesce(sum(e.total_minor_units),0)::text AS amount,r.grand_total::text AS original
           FROM merchant.pos_committed_sale s
           JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
           LEFT JOIN merchant.pos_sale_exception e ON e.sale_id=s.id
           WHERE s.id=$1::uuid GROUP BY r.grand_total`,
          [saleId],
        );
        const remaining =
          Number(refunded.rows[0]?.original ?? 0) - Number(refunded.rows[0]?.amount ?? 0);
        return {
          exceptionId: row.exceptionId,
          saleId,
          status: row.status,
          exceptionType: row.exceptionType,
          allocation: {
            merchandise: money(Number(row.merchandise), row.currency),
            tax: money(Number(row.tax), row.currency),
            discount: money(Number(row.discount), row.currency),
            tip: money(Number(row.tip), row.currency),
            total: money(Number(row.total), row.currency),
          },
          receipt: row.receipt,
          remainingRefundable: money(remaining, row.currency),
          correlationReference: row.correlation,
          committedAt: row.committedAt,
          retryAllowed: false,
        };
      },
      authorizationLocation(authorization),
    );
  }

  command(
    userId: string,
    merchantId: string,
    query: ExceptionCommandRecoveryQuery,
  ): Promise<ExceptionCommandRecoveryResult> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<{
          status: 'processing' | 'succeeded' | 'failed';
          response: SaleExceptionResult | ManualTerminalRefundOutcomeResult | null;
          failureCode: string | null;
          commandType: 'pos.exception.commit' | 'pos.exception.terminal_outcome';
        }>(
          `SELECT status,response_data AS response,failure_code AS "failureCode",
                  command_type AS "commandType"
           FROM merchant.business_command
           WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND command_id=$3::uuid
             AND idempotency_key=$4::text
             AND command_type IN ('pos.exception.commit','pos.exception.terminal_outcome')`,
          [merchantId, query.locationId, query.commandId, query.idempotencyKey],
        );
        const row = rows[0];
        if (!row) {
          return {
            state: 'query_original_command',
            result: null,
            terminalOutcome: null,
            commandType: null,
            queryOnly: true,
            safeAction: 'query_again',
          };
        }
        if (row.status === 'succeeded' && row.response) {
          if (row.commandType === 'pos.exception.terminal_outcome') {
            const terminalOutcome = row.response as unknown as ManualTerminalRefundOutcomeResult;
            return {
              state:
                terminalOutcome.status === 'outcome_unknown'
                  ? ('outcome_unknown' as const)
                  : ('query_original_command' as const),
              result: null,
              terminalOutcome,
              commandType: 'terminal_outcome' as const,
              queryOnly: true,
              safeAction:
                terminalOutcome.status === 'outcome_unknown'
                  ? ('verify_terminal' as const)
                  : ('return_to_sale' as const),
            };
          }
          return {
            state: 'committed_result_available',
            result: {
              ...(row.response as SaleExceptionResult),
              status: 'recovered' as const,
            },
            terminalOutcome: null,
            commandType: 'exception_commit',
            queryOnly: true,
            safeAction: 'return_to_sale',
          };
        }
        return {
          state:
            row.failureCode === 'PAYMENT_OUTCOME_UNKNOWN'
              ? 'outcome_unknown'
              : 'query_original_command',
          result: null,
          terminalOutcome: null,
          commandType:
            row.commandType === 'pos.exception.terminal_outcome'
              ? 'terminal_outcome'
              : 'exception_commit',
          queryOnly: true,
          safeAction:
            row.failureCode === 'PAYMENT_OUTCOME_UNKNOWN' ? 'verify_terminal' : 'query_again',
        };
      },
      query.locationId,
    );
  }

  private async loadSource(
    client: PoolClient,
    merchantId: string,
    authorization: ExceptionAuthorization,
    saleId: string,
    lock: boolean,
  ): Promise<SaleSource | null> {
    const header = await client.query<{
      id: string;
      cartId: string;
      orderId: string;
      receiptId: string;
      receiptReference: string;
      businessDate: string;
      committedAt: string;
      cartOperatorSessionId: string;
      saleVersion: string;
      currency: string;
      snapshot: ReceiptSnapshot;
      originalTotal: string;
      paymentStatus: string;
      exceptionVersion: string;
      previouslyRefunded: string;
      terminalPending: boolean;
      checkoutState: string | null;
      discountDrafts: Array<{ lineId: string | null }>;
      paymentSummary: {
        discounts?: { entries?: Array<{ amount?: { minorUnits?: number } }> };
      } | null;
    }>(
      `SELECT s.id::text,s.cart_id::text AS "cartId",s.order_id::text AS "orderId",
              s.receipt_snapshot_id::text AS "receiptId",r.receipt_number AS "receiptReference",
              r.business_date::text AS "businessDate",s.committed_at::text AS "committedAt",
              c.operator_session_id::text AS "cartOperatorSessionId",
              o.version::text AS "saleVersion",r.currency,r.snapshot,
              r.grand_total::text AS "originalTotal",p.status AS "paymentStatus",
              (SELECT count(*) FROM merchant.pos_sale_exception e WHERE e.sale_id=s.id)::text AS "exceptionVersion",
              (SELECT coalesce(sum(e.total_minor_units),0) FROM merchant.pos_sale_exception e
                WHERE e.sale_id=s.id)::text AS "previouslyRefunded",
              exists(
                SELECT 1 FROM merchant.pos_exception_preview ep
                WHERE ep.sale_id=s.id
                  AND ep.terminal_refund_status IN ('confirmed_success','outcome_unknown')
                  AND NOT EXISTS(
                    SELECT 1 FROM merchant.pos_sale_exception se WHERE se.preview_id=ep.id
                  )
              ) AS "terminalPending",d.state AS "checkoutState",
              coalesce(d.discount_drafts,'[]') AS "discountDrafts",
              d.payment_summary AS "paymentSummary"
       FROM merchant.pos_committed_sale s
       JOIN merchant.receipt_snapshot r ON r.id=s.receipt_snapshot_id
       JOIN merchant.pos_cart c ON c.id=s.cart_id
       JOIN merchant.customer_order o ON o.id=s.order_id
       JOIN merchant.pos_payment_attempt p ON p.id=s.payment_attempt_id
       LEFT JOIN merchant.pos_checkout_draft d ON d.cart_id=s.cart_id
       WHERE s.id=$1::uuid AND s.merchant_id=$2::uuid AND s.location_id=$3::uuid
       ${lock ? 'FOR UPDATE OF s,o' : ''}`,
      [saleId, merchantId, authorizationLocation(authorization)],
    );
    const row = header.rows[0];
    if (!row) return null;
    const cartLines = await client.query<{
      id: string;
      productReference: string;
      name: string;
      quantity: number;
      isService: boolean;
      refundedQuantity: string;
      refundedMerchandise: string;
      refundedTax: string;
      refundedDiscount: string;
      refundedTip: string;
      refundedTotal: string;
    }>(
      `SELECT l.id::text,coalesce(p.sku,p.id::text) AS "productReference",
              l.product_name AS name,l.quantity,false AS "isService",
              coalesce(sum(x.compensated_quantity),0)::text AS "refundedQuantity",
              coalesce(sum(x.merchandise_minor_units),0)::text AS "refundedMerchandise",
              coalesce(sum(x.tax_minor_units),0)::text AS "refundedTax",
              coalesce(sum(x.discount_minor_units),0)::text AS "refundedDiscount",
              coalesce(sum(x.tip_minor_units),0)::text AS "refundedTip",
              coalesce(sum(x.total_minor_units),0)::text AS "refundedTotal"
       FROM merchant.pos_cart_line l
       LEFT JOIN merchant.product p ON p.id=l.product_id
       LEFT JOIN merchant.pos_sale_exception_line x ON x.sale_id=$2::uuid AND x.sale_line_id=l.id
       WHERE l.cart_id=$1::uuid
       GROUP BY l.id,p.sku,p.id,l.product_name,l.quantity
       ORDER BY l.created_at,l.id`,
      [row.cartId, saleId],
    );
    const receiptLines = row.snapshot.lines;
    const discountTotal = row.snapshot.discountTotal?.minorUnits ?? 0;
    const tipTotal = row.snapshot.tip?.minorUnits ?? 0;
    const hasLineDiscounts = receiptLines.every((line) => line.discount != null);
    const hasLineTips = receiptLines.every((line) => line.tip != null);
    const legacyLineDiscounts = new Map<string, number>();
    let legacyOrderDiscount = 0;
    if (discountTotal > 0 && !hasLineDiscounts) {
      const entries = row.paymentSummary?.discounts?.entries ?? [];
      if (
        !['completed', 'receipt_available'].includes(row.checkoutState ?? '') ||
        entries.length !== row.discountDrafts.length
      ) {
        throw new ConflictException({ code: 'HISTORICAL_DISCOUNT_ALLOCATION_UNAVAILABLE' });
      }
      for (const [index, draft] of row.discountDrafts.entries()) {
        const amount = entries[index]?.amount?.minorUnits;
        if (!Number.isSafeInteger(amount)) {
          throw new ConflictException({ code: 'HISTORICAL_DISCOUNT_ALLOCATION_UNAVAILABLE' });
        }
        if (draft.lineId) {
          legacyLineDiscounts.set(
            draft.lineId,
            safe((legacyLineDiscounts.get(draft.lineId) ?? 0) + amount!),
          );
        } else {
          legacyOrderDiscount = safe(legacyOrderDiscount + amount!);
        }
      }
      const reconstructed =
        [...legacyLineDiscounts.values()].reduce((sum, amount) => safe(sum + amount), 0) +
        legacyOrderDiscount;
      if (reconstructed !== discountTotal) {
        throw new ConflictException({ code: 'HISTORICAL_DISCOUNT_ALLOCATION_UNAVAILABLE' });
      }
    }
    const grossTotal = receiptLines.reduce((sum, line) => safe(sum + line.lineTotal.minorUnits), 0);
    let discountAssigned = 0;
    let tipAssigned = 0;
    const lines: SourceLine[] = cartLines.rows.map((line, index) => {
      const receiptLine =
        receiptLines.find((item) => item.lineRef === line.id) ?? receiptLines[index];
      if (!receiptLine) {
        throw new ConflictException({ code: 'REFUND_RECEIPT_LINE_MISSING' });
      }
      const gross = receiptLine.lineTotal.minorUnits;
      const tax = receiptLine.tax?.minorUnits ?? 0;
      const discount = hasLineDiscounts
        ? (receiptLine.discount?.minorUnits ?? 0)
        : (legacyLineDiscounts.get(line.id) ?? 0) +
          (index === cartLines.rows.length - 1
            ? legacyOrderDiscount - discountAssigned
            : historicalProportion(legacyOrderDiscount, gross, Math.max(grossTotal, 1)));
      const tip = hasLineTips
        ? (receiptLine.tip?.minorUnits ?? 0)
        : index === cartLines.rows.length - 1
          ? tipTotal - tipAssigned
          : historicalProportion(tipTotal, gross, Math.max(grossTotal, 1));
      discountAssigned += hasLineDiscounts
        ? discount
        : discount - (legacyLineDiscounts.get(line.id) ?? 0);
      tipAssigned += tip;
      const merchandise = gross - tax;
      const originalTotal = merchandise + tax - discount + tip;
      return {
        id: line.id,
        name: line.name,
        productReference: line.productReference,
        originalQuantity: line.quantity,
        remainingQuantity: line.quantity - Number(line.refundedQuantity),
        originalMerchandise: merchandise,
        originalTax: tax,
        originalDiscount: discount,
        originalTip: tip,
        originalTotal,
        remainingMerchandise: merchandise - Number(line.refundedMerchandise),
        remainingTax: tax - Number(line.refundedTax),
        remainingDiscount: discount - Number(line.refundedDiscount),
        remainingTip: tip - Number(line.refundedTip),
        remainingTotal: originalTotal - Number(line.refundedTotal),
        isService: line.isService,
      };
    });
    const tenderRows = await client.query<{
      id: string;
      type: 'cash' | 'manual_terminal' | 'wallet' | 'gift_card';
      amount: string;
      refunded: string;
      status: string;
    }>(
      `SELECT t.id::text,t.tender_type AS type,t.amount_minor_units::text AS amount,t.status,
              coalesce(sum(c.amount_minor_units),0)::text AS refunded
       FROM merchant.pos_tender_fact t
       LEFT JOIN merchant.pos_tender_compensation c ON c.original_tender_id=t.id
       WHERE t.cart_id=$1::uuid
       GROUP BY t.id,t.tender_type,t.amount_minor_units,t.status,t.position
       ORDER BY t.position`,
      [row.cartId],
    );
    const ambiguousPayment =
      ['unknown', 'timeout'].includes(row.paymentStatus) ||
      tenderRows.rows.some((tender) => tender.status === 'outcome_unknown') ||
      row.terminalPending;
    return {
      id: row.id,
      cartId: row.cartId,
      orderId: row.orderId,
      receiptId: row.receiptId,
      receiptReference: row.receiptReference,
      businessDate: row.businessDate,
      committedAt: row.committedAt,
      cartOperatorSessionId: row.cartOperatorSessionId,
      saleVersion: Number(row.saleVersion),
      exceptionVersion: Number(row.exceptionVersion),
      currency: row.currency,
      snapshot: row.snapshot,
      originalTotal: Number(row.originalTotal),
      previouslyRefunded: Number(row.previouslyRefunded),
      remainingRefundable: Number(row.originalTotal) - Number(row.previouslyRefunded),
      ambiguousPayment,
      lines,
      tenders: tenderRows.rows.map((tender) => ({
        id: tender.id,
        type: tender.type,
        amount: Number(tender.amount),
        refunded: Number(tender.refunded),
      })),
    };
  }

  private async policy(
    client: PoolClient,
    merchantId: string,
    authorization: ExceptionAuthorization,
    currency: string,
  ): Promise<PolicyRow> {
    const { rows } = await client.query<PolicyRow>(
      `SELECT version,refunds_enabled AS "refundsEnabled",voids_enabled AS "voidsEnabled",
              refund_window_minutes AS "refundWindowMinutes",void_window_minutes AS "voidWindowMinutes",
              cashier_refund_threshold::text AS "cashierRefundThreshold",
              cash_refund_threshold::text AS "cashRefundThreshold",
              cash_refund_requires_shift AS "cashRefundRequiresShift",
              require_different_approver AS "requireDifferentApprover",
              tender_allocation_policy AS "allocationPolicy",tip_refund_policy AS "tipPolicy",
              maximum_lines AS "maximumLines",expires_at::text AS "expiresAt"
       FROM merchant.pos_exception_policy
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND currency=$3 AND expires_at>now()`,
      [merchantId, authorizationLocation(authorization), currency],
    );
    return (
      rows[0] ?? {
        version: 'default-deny',
        refundsEnabled: false,
        voidsEnabled: false,
        refundWindowMinutes: 0,
        voidWindowMinutes: 0,
        cashierRefundThreshold: '0',
        cashRefundThreshold: '0',
        cashRefundRequiresShift: true,
        requireDifferentApprover: true,
        allocationPolicy: 'proportional',
        tipPolicy: 'non_refundable',
        maximumLines: 1,
        expiresAt: new Date().toISOString(),
      }
    );
  }

  private toEligibility(
    source: SaleSource,
    policy: PolicyRow,
    authorization: ExceptionAuthorization,
  ): SaleExceptionEligibility {
    const now = Date.now();
    const ageMinutes = Math.max(0, (now - new Date(source.committedAt).getTime()) / 60_000);
    const hasRemaining =
      source.remainingRefundable > 0 && source.lines.some((line) => line.remainingQuantity > 0);
    const withinRefundWindow = ageMinutes <= policy.refundWindowMinutes;
    const withinVoidWindow = ageMinutes <= policy.voidWindowMinutes;
    const operatorAllowed =
      source.cartOperatorSessionId === authorization.operatorSessionId ||
      hasPermission(authorization, 'sale.refund.other_operator');
    const refundAllowed =
      policy.refundsEnabled &&
      hasRemaining &&
      withinRefundWindow &&
      !source.ambiguousPayment &&
      operatorAllowed;
    const prior = source.previouslyRefunded > 0;
    const voidAllowed =
      policy.voidsEnabled &&
      hasPermission(authorization, 'sale.void.create') &&
      !prior &&
      withinVoidWindow &&
      !source.ambiguousPayment &&
      operatorAllowed &&
      !source.tenders.some((tender) => tender.type === 'manual_terminal');
    const allowedTypes: SaleExceptionEligibility['allowedTypes'] = [];
    if (voidAllowed) allowedTypes.push('void');
    if (refundAllowed && hasPermission(authorization, 'sale.refund.full'))
      allowedTypes.push('full_refund');
    if (refundAllowed && hasPermission(authorization, 'sale.refund.partial'))
      allowedTypes.push('partial_refund');
    const moneyValue = (original: number, priorAmount: number) => ({
      original: money(original, source.currency),
      previouslyCompensated: money(priorAmount, source.currency),
      remaining: money(original - priorAmount, source.currency),
    });
    const sum = (key: keyof Pick<SourceLine, 'originalTax' | 'originalDiscount' | 'originalTip'>) =>
      source.lines.reduce((value, line) => value + line[key], 0);
    const remaining = (
      key: keyof Pick<SourceLine, 'remainingTax' | 'remainingDiscount' | 'remainingTip'>,
    ) => source.lines.reduce((value, line) => value + line[key], 0);
    return {
      sale: {
        saleId: source.id,
        receiptId: source.receiptId,
        receiptReference: source.receiptReference,
        businessDate: source.businessDate,
        committedAt: source.committedAt,
        version: source.saleVersion,
        currency: source.currency,
        originalTotal: money(source.originalTotal, source.currency),
        previouslyRefunded: money(source.previouslyRefunded, source.currency),
        remainingRefundable: money(source.remainingRefundable, source.currency),
      },
      allowedTypes,
      refund: {
        allowed: refundAllowed,
        fullRefundAllowed: allowedTypes.includes('full_refund'),
        partialRefundAllowed: allowedTypes.includes('partial_refund'),
        cashRefundAllowed: hasPermission(authorization, 'sale.refund.cash'),
        manualTerminalRefundAllowed: hasPermission(authorization, 'sale.refund.manual_terminal'),
        approvalRequired: source.remainingRefundable > Number(policy.cashierRefundThreshold),
        approvalThreshold: money(Number(policy.cashierRefundThreshold), source.currency),
        lines: source.lines.map((line) => ({
          saleLineId: line.id,
          productPublicReference: line.productReference,
          displayName: line.name,
          quantity: {
            original: line.originalQuantity,
            previouslyRefunded: line.originalQuantity - line.remainingQuantity,
            remaining: line.remainingQuantity,
          },
          merchandise: moneyValue(
            line.originalMerchandise,
            line.originalMerchandise - line.remainingMerchandise,
          ),
          tax: moneyValue(line.originalTax, line.originalTax - line.remainingTax),
          discount: moneyValue(
            line.originalDiscount,
            line.originalDiscount - line.remainingDiscount,
          ),
          isService: line.isService,
          restockOptions: line.isService
            ? ['not_applicable']
            : [
                'restock',
                'do_not_restock',
                'inspection_required',
                'unknown_until_inventory_review',
              ],
        })),
        refundableTax: moneyValue(
          sum('originalTax'),
          sum('originalTax') - remaining('remainingTax'),
        ),
        refundableDiscount: moneyValue(
          sum('originalDiscount'),
          sum('originalDiscount') - remaining('remainingDiscount'),
        ),
        refundableTip: moneyValue(
          sum('originalTip'),
          sum('originalTip') - remaining('remainingTip'),
        ),
        blockCodes: refundAllowed
          ? []
          : [
              source.ambiguousPayment
                ? 'payment_outcome_unknown'
                : !operatorAllowed
                  ? 'other_operator_permission_required'
                  : !withinRefundWindow
                    ? 'policy_window_expired'
                    : !policy.refundsEnabled
                      ? 'policy_disabled'
                      : 'fully_refunded',
            ],
        supportCodes: source.ambiguousPayment ? ['payment_reconciliation_required'] : [],
      },
      voidEligibility: {
        allowed: voidAllowed,
        reasonRequired: true,
        approvalRequired: true,
        blockCodes: voidAllowed
          ? []
          : [
              source.tenders.some((tender) => tender.type === 'manual_terminal')
                ? 'externally_settled'
                : prior
                  ? 'prior_refund_exists'
                  : 'void_not_eligible',
            ],
        expiresAt: withinVoidWindow
          ? new Date(
              new Date(source.committedAt).getTime() + policy.voidWindowMinutes * 60_000,
            ).toISOString()
          : null,
      },
      allocationPolicy: policy.allocationPolicy,
      tipPolicy: policy.tipPolicy,
      onlineRequired: true,
      correlationReference: randomUUID(),
    };
  }

  private selection(source: SaleSource, dto: RefundPreviewRequest) {
    if (dto.exceptionType === 'partial_refund') return dto.lines;
    const requested = new Map(dto.lines.map((line) => [line.saleLineId, line]));
    return source.lines
      .filter((line) => line.remainingQuantity > 0)
      .map((line) => ({
        saleLineId: line.id,
        quantity: line.remainingQuantity,
        restockDecision: line.isService
          ? ('not_applicable' as const)
          : (requested.get(line.id)?.restockDecision ?? ('restock' as const)),
      }));
  }

  private refundableTip(
    line: SourceLine,
    policy: PolicyRow,
    exceptionType: RefundPreviewRequest['exceptionType'],
  ): number {
    if (policy.tipPolicy === 'non_refundable' || policy.tipPolicy === 'support_required') return 0;
    if (policy.tipPolicy === 'full_refund_only' && exceptionType === 'partial_refund') return 0;
    return line.remainingTip;
  }

  private async activeCashShift(
    client: PoolClient,
    merchantId: string,
    authorization: ExceptionAuthorization,
    currency: string,
    lock = false,
  ): Promise<{
    id: string;
    registerId: string;
    ledgerSequence: number;
    expectedCash: number;
  } | null> {
    const shift = await client.query<{
      id: string;
      registerId: string;
      ledgerSequence: string;
    }>(
      `SELECT s.id::text,s.register_id::text AS "registerId",
              s.ledger_sequence::text AS "ledgerSequence"
       FROM merchant.cash_shift s
       WHERE s.merchant_id=$1::uuid AND s.location_id=$2::uuid
         AND s.operator_session_id=$3::uuid AND s.device_id=$4::uuid
         AND s.status='open' AND s.currency=$5
       ${lock ? 'FOR UPDATE OF s' : ''}`,
      [
        merchantId,
        authorizationLocation(authorization),
        authorization.operatorSessionId,
        authorization.deviceId,
        currency,
      ],
    );
    const row = shift.rows[0];
    if (!row) return null;
    const balance = await client.query<{ expectedCash: string }>(
      `SELECT coalesce(sum(case
                when e.entry_type in ('opening_float','paid_in') then e.amount_minor_units
                when e.entry_type='cash_sale' then e.cash_received_minor_units-e.change_given_minor_units
                when e.entry_type in ('paid_out','safe_drop','cash_refund') then -e.amount_minor_units
                when e.entry_type in ('drawer_correction','close_adjustment') then e.amount_minor_units
                else 0 end),0)::text AS "expectedCash"
       FROM merchant.cash_ledger_entry e WHERE e.shift_id=$1::uuid`,
      [row.id],
    );
    return {
      ...row,
      ledgerSequence: Number(row.ledgerSequence),
      expectedCash: Number(balance.rows[0]?.expectedCash ?? 0),
    };
  }

  private lockPreview(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    saleId: string,
    previewId: string,
    fingerprint: string,
  ): Promise<PreviewRow | null> {
    return client
      .query<PreviewRow>(
        `SELECT id::text,"sale_id"::text AS "saleId",original_receipt_id::text AS "originalReceiptId",
                operator_session_id::text AS "operatorSessionId",device_id::text AS "deviceId",
                exception_type AS "exceptionType",reason_code AS "reasonCode",note,
                line_allocations AS "lineAllocations",tender_allocations AS "tenderAllocations",
                terminal_refund_status AS "terminalRefundStatus",allocation_policy AS "allocationPolicy",
                merchandise_minor_units::text AS "merchandiseMinorUnits",
                tax_minor_units::text AS "taxMinorUnits",discount_minor_units::text AS "discountMinorUnits",
                tip_minor_units::text AS "tipMinorUnits",total_minor_units::text AS "totalMinorUnits",
                remaining_after_minor_units::text AS "remainingAfterMinorUnits",currency,
                approval_required AS "approvalRequired",sale_version::text AS "saleVersion",
                exception_version::text AS "exceptionVersion",preview_fingerprint AS "previewFingerprint",
                correlation_id AS "correlationId",expires_at::text AS "expiresAt"
         FROM merchant.pos_exception_preview
         WHERE id=$4::uuid AND merchant_id=$1::uuid AND location_id=$2::uuid
           AND sale_id=$3::uuid AND preview_fingerprint=$5 FOR UPDATE`,
        [merchantId, locationId, saleId, previewId, fingerprint],
      )
      .then((result) => result.rows[0] ?? null);
  }

  private async postCashRefund(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    saleId: string,
    exceptionId: string,
    tender: StoredTender,
    authorization: ExceptionAuthorization,
    commandId: string,
    currency: string,
  ): Promise<void> {
    const shift = await this.activeCashShift(client, merchantId, authorization, currency, true);
    if (!shift || shift.expectedCash < tender.amount) {
      throw new ConflictException({ code: 'CASH_REFUND_NOT_AVAILABLE' });
    }
    const nextSequence = shift.ledgerSequence + 1;
    const ledger = await client.query<{ id: string }>(
      `INSERT INTO merchant.cash_ledger_entry
         (merchant_id,location_id,register_id,shift_id,sequence,entry_type,
          amount_minor_units,currency,command_id,sale_id,
          sale_exception_id,business_date,public_data)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'cash_refund',$6,$7,
               $8::uuid,$9::uuid,$10::uuid,current_date,
               jsonb_build_object('exceptionType','refund'))
       RETURNING id::text`,
      [
        merchantId,
        locationId,
        shift.registerId,
        shift.id,
        nextSequence,
        tender.amount,
        currency,
        commandId,
        saleId,
        exceptionId,
      ],
    );
    const sequence = await client.query(
      `UPDATE merchant.cash_shift SET ledger_sequence=$2,version=version+1
       WHERE id=$1::uuid AND status='open' AND ledger_sequence=$3`,
      [shift.id, nextSequence, shift.ledgerSequence],
    );
    if (sequence.rowCount !== 1) {
      throw new ConflictException({ code: 'CASH_SHIFT_NOT_ELIGIBLE' });
    }
    await client.query(
      `INSERT INTO merchant.pos_cash_compensation
         (merchant_id,location_id,exception_id,original_tender_id,current_shift_id,
          current_register_id,ledger_entry_id,amount_minor_units,currency)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9)`,
      [
        merchantId,
        locationId,
        exceptionId,
        tender.id,
        shift.id,
        shift.registerId,
        ledger.rows[0].id,
        tender.amount,
        currency,
      ],
    );
  }
}

const money = (minorUnits: number, currency: string) => ({ minorUnits, currency });
const authorizationLocation = (authorization: ExceptionAuthorization): string => {
  return authorization.locationId;
};
const hasPermission = (authorization: ExceptionAuthorization, permission: string): boolean =>
  authorization.permissions.includes(permission) || authorization.permissions.includes('*');
