import { Injectable } from '@nestjs/common';
import {
  ExceptionCommandRecoveryQuery,
  CreateInventoryCountRequest,
  DamageRecord,
  GiftCardIssuanceRequest,
  GiftCardSecretRevealRequest,
  InventoryAdjustment,
  InventoryQuery,
  InventoryReconciliation,
  PointsAdjustmentRequest,
  QuarantineRecord,
  RefundApprovalRequest,
  RefundPreviewRequest,
  SaleExceptionCommand,
  SubmitInventoryCountRequest,
  WasteRecord,
  type DashboardAdministrativeCommandRequest,
} from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { PosEntryService } from '../pos-entry/pos-entry.service';
import {
  exceptionCommandFingerprint,
  PosExceptionService,
} from '../pos-exception/pos-exception.service';
import { PosInventoryService } from '../pos-inventory/pos-inventory.service';
import { PosHardwareService } from '../pos-hardware/pos-hardware.service';
import { PosCustomerValueService } from '../pos-customer-value/pos-customer-value.service';
import { KdsService } from '../kds/kds.service';
import { PosCatalogService } from '../pos-catalog/pos-catalog.service';
import { AdministrativeCommandContextService } from './administrative-command-context.service';
import { AdministrativeCommandRepository } from './administrative-command.repository';

@Injectable()
export class AdministrativeCommandExecutionService {
  constructor(
    private readonly contexts: AdministrativeCommandContextService,
    private readonly refunds: PosExceptionService,
    private readonly inventory: PosInventoryService,
    private readonly entry: PosEntryService,
    private readonly hardware: PosHardwareService,
    private readonly customerValue: PosCustomerValueService,
    private readonly repository: AdministrativeCommandRepository,
    private readonly kitchen: KdsService,
    private readonly catalog: PosCatalogService,
  ) {}

  async execute(
    user: AuthUser,
    access: MerchantAccess,
    request: DashboardAdministrativeCommandRequest,
  ): Promise<unknown> {
    const context = await this.contexts.create(user, access, request);
    return this.contexts.execute<unknown>(
      context,
      async (persisted) => {
        switch (request.operation) {
          case 'register.configure': {
            if (!request.locationId || request.targetVersion === null) {
              throw new Error('register_context_required');
            }
            return this.repository.configureRegister({
              actorUserId: user.id,
              merchantId: access.merchantId,
              locationId: request.locationId,
              registerId: request.targetAggregateId,
              expectedVersion: request.targetVersion,
              displayName: request.parameters.displayName,
              assignmentPolicy: request.parameters.assignmentPolicy,
              assignedDeviceId: request.parameters.assignedDeviceId,
              enabled: request.parameters.enabled,
            });
          }
          case 'catalog.create':
          case 'catalog.update':
          case 'catalog.archive':
            return this.catalog.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              request.parameters,
            );
          case 'catalog.detail':
            return this.catalog.detailAdministrative(access, persisted ?? context);
          case 'kitchen.station.create':
            return this.kitchen.createStation(
              access.merchantId,
              request.locationId,
              request.parameters,
            );
          case 'kitchen.station.update':
            return request.parameters.archive === true
              ? this.kitchen.archiveStation(access.merchantId, request.targetAggregateId)
              : this.kitchen.updateStation(
                  access.merchantId,
                  request.targetAggregateId,
                  request.parameters,
                );
          case 'kitchen.route.update':
            return request.parameters.create === true
              ? this.kitchen.createRoute(access.merchantId, request.locationId, request.parameters)
              : this.kitchen.updateRoute(
                  access.merchantId,
                  request.targetAggregateId,
                  request.parameters,
                );
          case 'kitchen.device.assign':
            return this.kitchen.updateDevice(
              access.merchantId,
              request.targetAggregateId,
              request.parameters,
            );
          case 'recovery.query_original':
            return this.repository.queryOriginalCommand(
              user.id,
              access.merchantId,
              request.locationId,
              request.targetAggregateId,
            );
          case 'loyalty.adjustment.preview': {
            if (!request.locationId) throw new Error('location_required');
            const customerId = await this.customerValue.pointsAccountCustomer(
              user,
              access,
              request.locationId,
              request.targetAggregateId,
            );
            const dto = PointsAdjustmentRequest.parse({
              ...objectParameter(request.parameters.command),
              customerId,
              accountId: request.targetAggregateId,
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
              commandId: request.parameters.mutationCommandId,
              idempotencyKey: request.parameters.mutationIdempotencyKey,
            });
            return this.customerValue.previewPointsAdjustmentAdministrative(
              user,
              access,
              persisted ?? context,
              dto,
            );
          }
          case 'loyalty.adjustment': {
            if (!request.locationId) throw new Error('location_required');
            const customerId = await this.customerValue.pointsAccountCustomer(
              user,
              access,
              request.locationId,
              request.targetAggregateId,
            );
            const dto = PointsAdjustmentRequest.parse({
              ...request.parameters,
              customerId,
              accountId: request.targetAggregateId,
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
              commandId: request.commandId,
              idempotencyKey: request.idempotencyKey,
              approvalId: request.approvalId,
            });
            return this.customerValue.commitPointsAdjustmentAdministrative(
              user,
              access,
              persisted ?? context,
              dto,
            );
          }
          case 'gift_card.promotional_issue.preview': {
            const dto = GiftCardIssuanceRequest.parse({
              ...objectParameter(request.parameters.command),
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
              commandId: request.parameters.mutationCommandId,
              idempotencyKey: request.parameters.mutationIdempotencyKey,
              source: 'promotion',
            });
            return this.customerValue.previewGiftCardIssuanceAdministrative(
              user,
              access,
              persisted ?? context,
              dto,
            );
          }
          case 'gift_card.promotional_issue': {
            const dto = GiftCardIssuanceRequest.parse({
              ...request.parameters,
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
              commandId: request.commandId,
              idempotencyKey: request.idempotencyKey,
              approvalId: request.approvalId,
              source: 'promotion',
            });
            return this.customerValue.issueGiftCardAdministrative(
              user,
              access,
              persisted ?? context,
              dto,
            );
          }
          case 'gift_card.reveal': {
            const dto = GiftCardSecretRevealRequest.parse({
              ...request.parameters,
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
              commandId: request.commandId,
              idempotencyKey: request.idempotencyKey,
            });
            return this.customerValue.revealGiftCardSecretAdministrative(
              user,
              access,
              persisted ?? context,
              dto,
            );
          }
          case 'gift_card.recovery':
            return this.customerValue.commandAdministrative(
              user,
              access,
              persisted ?? context,
              request.targetAggregateId,
              {
                locationId: request.locationId,
                operatorSessionId: user.sessionId,
              } as never,
            );
          case 'loyalty.adjustment.approval':
          case 'gift_card.promotional_issue.approval':
            return this.approveAdministrative(user, access, request);
          case 'hardware.assign':
          case 'hardware.update':
            return this.hardware.configureAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              request.parameters,
            );
          case 'hardware.command.status':
            return this.hardware.administrativeCommandStatus(user, access, persisted ?? context);
          case 'hardware.diagnostic':
          case 'hardware.printer.test':
          case 'hardware.printer.reprint':
            return this.hardware.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              request.parameters,
            );
          case 'inventory.preview': {
            const mutationOperation = String(request.parameters.mutationOperation || '');
            const mutationRequest = {
              ...request,
              operation: mutationOperation,
              commandId: String(request.parameters.mutationCommandId || ''),
              idempotencyKey: String(request.parameters.mutationIdempotencyKey || ''),
              parameters:
                request.parameters.command && typeof request.parameters.command === 'object'
                  ? (request.parameters.command as Record<string, unknown>)
                  : {},
            } as DashboardAdministrativeCommandRequest;
            const dto = this.inventoryDto(
              user,
              mutationRequest,
              inventorySchema(mutationOperation),
              {
                ...(mutationOperation.startsWith('inventory.count.')
                  ? { countId: request.targetAggregateId }
                  : { inventoryItemId: request.targetAggregateId }),
              },
            );
            return this.inventory.previewAdministrative(
              user,
              access,
              persisted ?? context,
              mutationOperation,
              dto as Parameters<PosInventoryService['previewAdministrative']>[4],
            );
          }
          case 'inventory.adjustment.approval':
          case 'inventory.waste.approval':
          case 'inventory.damage.approval':
          case 'inventory.quarantine.approval':
          case 'inventory.count.approval':
            return this.approveAdministrative(user, access, request);
          case 'inventory.overview': {
            const query = InventoryQuery.parse({
              ...request.parameters,
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
            });
            return this.inventory.overviewAdministrative(user, access, persisted ?? context, query);
          }
          case 'inventory.recovery':
            return this.inventory.recoveryAdministrative(
              user,
              access,
              persisted ?? context,
              request.targetAggregateId,
            );
          case 'inventory.adjustment':
            return this.executeInventory(
              user,
              access,
              persisted ?? context,
              request,
              InventoryAdjustment,
              { inventoryItemId: request.targetAggregateId },
            );
          case 'inventory.waste':
            return this.executeInventory(user, access, persisted ?? context, request, WasteRecord, {
              inventoryItemId: request.targetAggregateId,
            });
          case 'inventory.damage':
            return this.executeInventory(
              user,
              access,
              persisted ?? context,
              request,
              DamageRecord,
              { inventoryItemId: request.targetAggregateId },
            );
          case 'inventory.quarantine':
            return this.executeInventory(
              user,
              access,
              persisted ?? context,
              request,
              QuarantineRecord,
              { inventoryItemId: request.targetAggregateId },
            );
          case 'inventory.count.create':
            return this.executeInventory(
              user,
              access,
              persisted ?? context,
              request,
              CreateInventoryCountRequest,
              {},
            );
          case 'inventory.count.submit':
            return this.executeInventory(
              user,
              access,
              persisted ?? context,
              request,
              SubmitInventoryCountRequest,
              { countId: request.targetAggregateId },
            );
          case 'inventory.count.reconcile':
            return this.executeInventory(
              user,
              access,
              persisted ?? context,
              request,
              InventoryReconciliation,
              { countId: request.targetAggregateId },
            );
          case 'refund.eligibility':
            return this.refunds.eligibilityAdministrative(
              user,
              access,
              persisted ?? context,
              request.targetAggregateId,
            );
          case 'refund.preview': {
            const parameters = RefundPreviewRequest.parse({
              ...request.parameters,
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
            });
            return this.refunds.previewAdministrative(
              user,
              access,
              persisted ?? context,
              request.targetAggregateId,
              parameters,
            );
          }
          case 'refund.approval': {
            const previewId = String(request.parameters.previewId || '');
            const previewFingerprint = String(request.parameters.previewFingerprint || '');
            const commandId = String(request.parameters.commandId || '');
            const parameters = RefundApprovalRequest.parse({
              ...request.parameters,
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
              saleId: request.targetAggregateId,
              commandFingerprint: exceptionCommandFingerprint(
                request.targetAggregateId,
                previewId,
                previewFingerprint,
                commandId,
              ),
            });
            return this.refunds.approvalAdministrative(
              user,
              access,
              persisted ?? context,
              request.targetAggregateId,
              parameters,
            );
          }
          case 'refund.commit': {
            const parameters = SaleExceptionCommand.parse({
              ...request.parameters,
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
              commandId: request.commandId,
              idempotencyKey: request.idempotencyKey,
            });
            return this.refunds.commitAdministrative(
              user,
              access,
              persisted ?? context,
              request.targetAggregateId,
              parameters,
            );
          }
          case 'refund.recovery': {
            const parameters = ExceptionCommandRecoveryQuery.parse({
              ...request.parameters,
              locationId: request.locationId,
              operatorSessionId: user.sessionId,
            });
            return this.refunds.recoverAdministrative(
              user,
              access,
              persisted ?? context,
              parameters,
            );
          }
          default:
            throw new Error('unsupported_administrative_operation');
        }
      },
      request.operation === 'gift_card.reveal'
        ? () => ({ deliveryStatus: 'revealed_once' })
        : undefined,
    );
  }

  private executeInventory(
    user: AuthUser,
    access: MerchantAccess,
    context: Parameters<PosInventoryService['executeAdministrative']>[2],
    request: DashboardAdministrativeCommandRequest,
    schema: { parse(value: unknown): unknown },
    target: Record<string, unknown>,
  ) {
    const dto = this.inventoryDto(user, request, schema, target);
    return this.inventory.executeAdministrative(
      user,
      access,
      context,
      request.operation,
      dto as Parameters<PosInventoryService['executeAdministrative']>[4],
    );
  }

  private inventoryDto(
    user: AuthUser,
    request: DashboardAdministrativeCommandRequest,
    schema: { parse(value: unknown): unknown },
    target: Record<string, unknown>,
  ) {
    return schema.parse({
      ...request.parameters,
      ...target,
      locationId: request.locationId,
      operatorSessionId: user.sessionId,
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      approvalId: request.approvalId,
    });
  }

  private approveAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    request: DashboardAdministrativeCommandRequest,
  ) {
    const approvalPermissions: Record<string, readonly string[]> = {
      'loyalty.adjustment.approval': ['loyalty.adjust.approve'],
      'gift_card.promotional_issue.approval': ['gift_card.issue.approve'],
      'inventory.adjustment.approval': [
        'inventory.adjust.approve',
        'inventory.negative_stock.override',
      ],
      'inventory.waste.approval': ['inventory.waste.approve'],
      'inventory.damage.approval': ['inventory.damage.approve'],
      'inventory.quarantine.approval': ['inventory.quarantine.approve'],
      'inventory.count.approval': ['inventory.count.approve', 'inventory.negative_stock.override'],
    };
    const allowedPermissions = approvalPermissions[request.operation];
    const requestedPermission = String(request.parameters.approvalPermission || '');
    const permission = allowedPermissions?.includes(requestedPermission)
      ? requestedPermission
      : allowedPermissions?.length === 1
        ? allowedPermissions[0]
        : null;
    if (!permission || typeof request.parameters.managerPin !== 'string' || !request.locationId) {
      throw new Error('administrative_approval_input_invalid');
    }
    return this.entry.approveAdministrativeByManager(user, access, {
      dashboardSessionId: user.sessionId,
      managerPin: request.parameters.managerPin,
      permission,
      locationId: request.locationId,
      commandFingerprint: String(request.parameters.commandFingerprint || ''),
    });
  }
}

function objectParameter(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('administrative_command_parameters_invalid');
  }
  return value as Record<string, unknown>;
}

function inventorySchema(operation: string): { parse(value: unknown): unknown } {
  if (operation === 'inventory.adjustment') return InventoryAdjustment;
  if (operation === 'inventory.waste') return WasteRecord;
  if (operation === 'inventory.damage') return DamageRecord;
  if (operation === 'inventory.quarantine') return QuarantineRecord;
  if (operation === 'inventory.count.reconcile') return InventoryReconciliation;
  throw new Error(`unsupported_inventory_preview:${operation}`);
}
