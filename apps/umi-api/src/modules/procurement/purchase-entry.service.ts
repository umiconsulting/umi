import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { RecordInventoryPurchaseRequest, ReceiveSupplierInvoiceDirectRequest } from '@umi/contract';
import type { SupplierInvoice } from '@umi/contract';
import type { PoolClient } from 'pg';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { resolveLocationAuthority } from '../auth/location-authority';
import type { PersistedDashboardAdministrativeCommandContext } from '../administrative-commands/administrative-command-context.service';
import { commandFingerprint } from '../integrity/canonical-json';
import { IntegrityService } from '../integrity/integrity.service';
import { decodeInvoiceArtifact } from './invoice-artifact';
import { PurchaseEntryRepository } from './purchase-entry.repository';

@Injectable()
export class PurchaseEntryService {
  constructor(
    private readonly repo: PurchaseEntryRepository,
    private readonly integrity: IntegrityService,
  ) {}

  recordPurchase(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: RecordInventoryPurchaseRequest,
  ) {
    const parsed = RecordInventoryPurchaseRequest.safeParse(dto);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    const artifact =
      dto.artifactBase64 === undefined
        ? null
        : decodeInvoiceArtifact(dto.artifactBase64, 700 * 1024);
    return this.execute(
      'inventory.purchase.record',
      user,
      access,
      context,
      dto,
      (client, posting) =>
        this.repo.recordPurchase(
          client,
          access.merchantId,
          user.id,
          context.targetAggregateId,
          dto,
          posting,
          artifact,
        ),
    );
  }

  receiveInvoiceDirect(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: ReceiveSupplierInvoiceDirectRequest,
  ) {
    const parsed = ReceiveSupplierInvoiceDirectRequest.safeParse(dto);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    if (dto.supplierInvoiceId !== context.targetAggregateId)
      throw new ForbiddenException({ code: 'COMMAND_CONTEXT_NOT_ALLOWED' });
    return this.execute(
      'inventory.invoice.receive_direct',
      user,
      access,
      context,
      dto,
      (client, posting) =>
        this.repo.receiveInvoiceDirect(client, access.merchantId, user.id, dto, posting),
    );
  }

  private async execute(
    operation: string,
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    dto: { commandId: string; idempotencyKey: string; locationId: string },
    action: (
      client: PoolClient,
      posting: {
        commandId: string;
        idempotencyKey: string;
        fingerprint: string;
        correlationId: string;
      },
    ) => Promise<SupplierInvoice>,
  ) {
    if (!user.id || !user.sessionId || user.deviceId || context.type !== 'dashboard_administrative')
      throw new UnauthorizedException({ code: 'DASHBOARD_CONTEXT_REQUIRED' });
    if (
      !access.membershipId ||
      (!access.permissions.includes('*') &&
        !access.permissions.includes('inventory.invoice.approve'))
    )
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    resolveLocationAuthority(access, dto.locationId);
    if (
      context.actorUserId !== user.id ||
      context.merchantId !== access.merchantId ||
      context.membershipId !== access.membershipId ||
      context.sessionId !== user.sessionId ||
      context.permission !== 'inventory.invoice.approve' ||
      context.operation !== operation ||
      context.locationId !== dto.locationId ||
      context.commandId !== dto.commandId ||
      context.idempotencyKey !== dto.idempotencyKey
    )
      throw new ForbiddenException({ code: 'COMMAND_CONTEXT_NOT_ALLOWED' });
    const payload = { ...dto, supplierInvoiceId: context.targetAggregateId };
    const fingerprint = commandFingerprint(operation, payload);
    try {
      const result = await this.integrity.execute<SupplierInvoice>(
        {
          merchantId: access.merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: operation,
          payload,
        },
        async (transaction) => {
          const invoice = await action(transaction.client, {
            commandId: dto.commandId,
            idempotencyKey: dto.idempotencyKey,
            fingerprint,
            correlationId: transaction.correlationId,
          });
          await transaction.appendAudit({
            eventType: operation,
            entityType: 'supplier_invoice',
            entityId: invoice.id,
            outcome: 'success',
            publicData: {
              locationId: dto.locationId,
              lineCount: invoice.lines.length,
              totalMinor: invoice.totalMinor,
              issuedOn: invoice.issuedOn,
            },
          });
          return { ok: true as const, value: invoice };
        },
      );
      if (result.status !== 'succeeded' || result.result === null)
        throw new ConflictException({ code: result.failureCode ?? 'CONFLICT' });
      return {
        commandId: result.commandId,
        supplierInvoice: result.result,
        correlationId: result.correlationId,
      };
    } catch (error) {
      if (error instanceof RangeError) throw new BadRequestException({ code: error.message });
      throw error;
    }
  }
}
