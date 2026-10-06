import { BadRequestException, Injectable } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import {
  ExceptionCommandRecoveryQuery,
  CreateInventoryCountRequest,
  DamageRecord,
  GiftCardIssuanceRequest,
  GiftCardSecretRevealRequest,
  InventoryAllergenSetRequest,
  InventoryAdjustment,
  InventoryQuery,
  InventoryReconciliation,
  InventoryAuthoringItemAllergenSetRequest,
  InventoryAuthoringItemArchiveRequest,
  InventoryAuthoringItemCreateRequest,
  InventoryAuthoringItemUpdateRequest,
  InventoryRecipeCreateRequest,
  InventoryRecipeRetireRequest,
  InventoryRecipeUpdateRequest,
  InventoryUnitConversionSetRequest,
  PointsAdjustmentRequest,
  ProductionRecord,
  QuarantineRecord,
  RefundApprovalRequest,
  RefundPreviewRequest,
  SaleExceptionCommand,
  SubmitInventoryCountRequest,
  SupplierInvoiceCommitRequest,
  SupplierInvoiceMatchRequest,
  SupplierInvoiceUploadRequest,
  WasteRecord,
  type DashboardAdministrativeCommandRequest,
} from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { ProcurementService } from '../procurement/procurement.service';
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
import { InventoryAuthoringService } from '../inventory-authoring/inventory-authoring.service';
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
    private readonly authoring: InventoryAuthoringService,
    /**
     * The supplier-invoice commands (recipes module plan §11, phase 5). Optional in
     * the SIGNATURE only, so the focused specs that build this service with the
     * dispatchers they need keep compiling; Nest resolves it from `ProcurementModule`,
     * which exports it application-wide for exactly this door.
     */
    private readonly procurement?: ProcurementService,
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
          // Recipes and inventory authoring (recipes module plan §11, phase 1). The
          // item id and the version the caller read travel on the COMMAND, not in
          // `parameters`, so each case injects them before the zod model parses —
          // exactly as `loyalty.adjustment.preview` does above.
          case 'inventory.item.create':
            return this.authoring.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              this.authoringDto<InventoryAuthoringItemCreateRequest>(
                InventoryAuthoringItemCreateRequest,
                request,
                {},
              ),
            );
          case 'inventory.item.update':
            return this.authoring.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              this.authoringDto<InventoryAuthoringItemUpdateRequest>(
                InventoryAuthoringItemUpdateRequest,
                request,
                {
                  inventoryItemId: request.targetAggregateId,
                  expectedVersion: request.targetVersion,
                },
              ),
            );
          case 'inventory.item.archive':
            return this.authoring.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              this.authoringDto<InventoryAuthoringItemArchiveRequest>(
                InventoryAuthoringItemArchiveRequest,
                request,
                {
                  inventoryItemId: request.targetAggregateId,
                  expectedVersion: request.targetVersion,
                },
              ),
            );
          case 'inventory.conversion.set':
            return this.authoring.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              this.authoringDto<InventoryUnitConversionSetRequest>(
                InventoryUnitConversionSetRequest,
                request,
                {
                  inventoryItemId: request.targetAggregateId,
                  expectedVersion: request.targetVersion,
                },
              ),
            );
          case 'inventory.allergen.set':
            return this.authoring.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              this.authoringDto<InventoryAllergenSetRequest>(InventoryAllergenSetRequest, request, {
                expectedVersion: request.targetVersion,
              }),
            );
          case 'inventory.item_allergen.set':
            return this.authoring.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              this.authoringDto<InventoryAuthoringItemAllergenSetRequest>(
                InventoryAuthoringItemAllergenSetRequest,
                request,
                {
                  inventoryItemId: request.targetAggregateId,
                  expectedVersion: request.targetVersion,
                },
              ),
            );
          // The recipe target and version travel on the COMMAND, not in `parameters`,
          // for the same reason the item cases above do it: the console names the
          // aggregate it read, and the server is the one that decides what it means.
          // A create mints the id from the command, so nothing is injected at all.
          case 'inventory.recipe.create':
            return this.authoring.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              this.authoringDto<InventoryRecipeCreateRequest>(
                InventoryRecipeCreateRequest,
                request,
                {},
              ),
            );
          case 'inventory.recipe.update':
            return this.authoring.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              this.authoringDto<InventoryRecipeUpdateRequest>(
                InventoryRecipeUpdateRequest,
                request,
                {
                  recipeId: request.targetAggregateId,
                  expectedVersion: request.targetVersion,
                },
              ),
            );
          case 'inventory.recipe.retire':
            return this.authoring.executeAdministrative(
              user,
              access,
              persisted ?? context,
              request.operation,
              this.authoringDto<InventoryRecipeRetireRequest>(
                InventoryRecipeRetireRequest,
                request,
                {
                  recipeId: request.targetAggregateId,
                  expectedVersion: request.targetVersion,
                },
              ),
            );
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
          // Production (plan §11, phase 3). The console names the output item; the
          // server explodes the recipe. The command context has no operator session and
          // no business date, so the merchant's own business date is read here and the
          // policy fingerprint is the command's own — production verifies neither, it
          // posts through the one ledger door.
          case 'inventory.production.produce':
            return this.executeInventory(
              user,
              access,
              persisted ?? context,
              request,
              ProductionRecord,
              {
                outputItemId: request.targetAggregateId,
                businessDate: await this.inventory.currentBusinessDate(access.merchantId),
                expectedVersion: request.targetVersion ?? 1,
                policyFingerprint: (persisted ?? context).fingerprint,
              },
            );
          // Supplier invoices (plan §11, phase 5). The invoice commands carry their own
          // `commandId`/`idempotencyKey` in `parameters`, the way the contract's
          // `SupplierInvoice*Request` models define them, so the target aggregate and
          // the version are injected from the COMMAND exactly as the authoring cases do.
          case 'inventory.invoice.upload': {
            const service = this.invoiceService();
            return service.uploadSupplierInvoice(
              user,
              access,
              persisted ?? context,
              this.authoringDto<SupplierInvoiceUploadRequest>(
                SupplierInvoiceUploadRequest,
                request,
                {},
              ),
            );
          }
          case 'inventory.invoice.match': {
            const service = this.invoiceService();
            return service.matchSupplierInvoice(
              user,
              access,
              persisted ?? context,
              this.authoringDto<SupplierInvoiceMatchRequest>(SupplierInvoiceMatchRequest, request, {
                supplierInvoiceId: request.targetAggregateId,
              }),
            );
          }
          case 'inventory.invoice.commit': {
            const service = this.invoiceService();
            return service.commitSupplierInvoice(
              user,
              access,
              persisted ?? context,
              this.authoringDto<SupplierInvoiceCommitRequest>(
                SupplierInvoiceCommitRequest,
                request,
                { supplierInvoiceId: request.targetAggregateId },
              ),
            );
          }
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
        : request.operation === 'gift_card.promotional_issue'
          ? redactGiftCardIssuePersistence
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

  /**
   * The inventory-authoring parameters: the command's own parameters, plus the
   * target id and version the console sent on the command rather than inside
   * `parameters`.
   *
   * A shape the contract does not accept answers VALIDATION_FAILED rather than a
   * bare zod error, because a console form that sends a bad label or a negative
   * threshold is a caller mistake and has to be told so.
   */
  private authoringDto<T>(
    schema: ZodTypeAny,
    request: DashboardAdministrativeCommandRequest,
    target: Record<string, unknown>,
  ): T {
    const parsed = schema.safeParse({
      ...request.parameters,
      ...target,
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
    });
    if (parsed.success) return parsed.data as T;
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '$';
      const bucket = fieldErrors[path];
      if (bucket) bucket.push(issue.message);
      else fieldErrors[path] = [issue.message];
    }
    throw new BadRequestException({ code: 'VALIDATION_FAILED', fieldErrors });
  }

  /**
   * The purchasing service, for the three supplier-invoice operations.
   *
   * A missing provider is a WIRING fault and not a caller mistake, so it is raised as a
   * plain error: the command door records a failure and the process answers 500, which
   * is what an operator should see when the module that owns these writes is not
   * registered.
   */
  private invoiceService(): ProcurementService {
    if (!this.procurement) throw new Error('supplier_invoice_service_unavailable');
    return this.procurement;
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

function redactGiftCardIssuePersistence(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { deliveryStatus: 'issued_once' };
  }
  const { deliveryToken: _deliveryToken, ...safe } = result as Record<string, unknown>;
  return { ...safe, deliveryStatus: 'issued_once' };
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
