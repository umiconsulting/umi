import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ProductionRecord, ProductionResult } from '@umi/contract';
import type {
  AvailabilityQuery,
  CreateInventoryCountRequest,
  DamageRecord,
  InventoryAdjustment,
  InventoryQuery,
  InventoryReconciliation,
  InventoryRecoveryQuery,
  PosPrepListQuery,
  QuarantineRecord,
  RestockCommand,
  SubmitInventoryCountRequest,
  WasteRecord,
} from '@umi/contract';
import type { z } from 'zod';
import { MetricsService } from '../../shared/operations/metrics.service';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import type { DashboardAdministrativeCommandContext } from '../administrative-commands/administrative-command-context.service';
import { IntegrityService } from '../integrity/integrity.service';
import type { CommandResult } from '../integrity/integrity.types';
import { InventoryCostingService } from '../inventory-costing/inventory-costing.service';
import { InventoryAuthoringService } from '../inventory-authoring/inventory-authoring.service';
import { inventoryConflictCode, inventoryOperationFingerprint } from './inventory-errors';
import { PosInventoryRepository } from './pos-inventory.repository';

/**
 * The production models are published as zod schemas only, so their shapes are read from
 * the schema itself. A hand-written second interface would be a second author.
 */
type ProduceRequest = z.infer<typeof ProductionRecord>;
type ProduceResult = z.infer<typeof ProductionResult>;

@Injectable()
export class PosInventoryService {
  constructor(
    private readonly repo: PosInventoryRepository,
    private readonly integrity: IntegrityService,
    private readonly costing: InventoryCostingService,
    private readonly metrics: MetricsService,
    private readonly authoring: InventoryAuthoringService,
  ) {}

  async overview(user: AuthUser, merchantId: string, query: InventoryQuery) {
    await this.authorize(user, merchantId, query, 'inventory.read');
    return this.repo.overview(user.id, merchantId, query);
  }

  /**
   * THE PREP LIST ON THE KITCHEN BOARD (§8.4). The console's own read sits behind
   * `merchant.manage`, which a POS operator session does not carry, so the kitchen
   * reads it here with the same `inventory.read` the rest of this screen uses.
   *
   * The forecast itself is the costing module's, called with the merchant id only: one
   * author for the rate, the honest denominator and the par subtraction. This module
   * must not grow a second one.
   */
  async prepList(user: AuthUser, merchantId: string, query: PosPrepListQuery) {
    await this.authorize(
      user,
      merchantId,
      { locationId: query.locationId, operatorSessionId: query.operatorSessionId },
      'inventory.read',
    );
    // THE ACCESS THE FORECAST READ NEEDS, built from what the guard above just proved.
    // The location guard inside that read asks whether the caller may SWITCH branches,
    // which it answers from `permissions`; an empty list refuses every switch, so the
    // till reads its own branch and no other. `locationId` is passed explicitly for the
    // same reason: the operator is confined to the branch this request names.
    const access = {
      merchantId,
      locationId: query.locationId,
      permissions: [] as string[],
    } as unknown as MerchantAccess;
    return this.authoring.prepList(access, query);
  }

  async overviewAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: DashboardAdministrativeCommandContext & { commandRecordId?: string },
    query: InventoryQuery,
  ) {
    if (!context.locationId || !context.commandRecordId) {
      throw new ForbiddenException({ code: 'ADMINISTRATIVE_COMMAND_CONTEXT_REQUIRED' });
    }
    const authorization = await this.repo.authorizeAdministrative({
      userId: user.id,
      merchantId: access.merchantId,
      locationId: context.locationId,
      dashboardSessionId: user.sessionId,
      administrativeCommandId: context.commandRecordId,
      permissions: access.permissions,
      permission: 'inventory.read',
    });
    if (!authorization) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    return this.repo.overview(user.id, access.merchantId, query);
  }

  async availability(user: AuthUser, merchantId: string, query: AvailabilityQuery) {
    await this.authorize(user, merchantId, query, 'inventory.read');
    return this.repo.availability(user.id, merchantId, query, user.sessionId);
  }

  async history(user: AuthUser, merchantId: string, query: InventoryQuery) {
    await this.authorize(user, merchantId, query, 'inventory.history.read');
    return this.repo.history(user.id, merchantId, query);
  }

  adjustment(user: AuthUser, merchantId: string, dto: InventoryAdjustment) {
    const permission =
      dto.direction === 'increase' ? 'inventory.adjust.increase' : 'inventory.adjust.decrease';
    return this.mutation(user, merchantId, dto, permission, 'pos.inventory.adjustment');
  }

  waste(user: AuthUser, merchantId: string, dto: WasteRecord) {
    return this.mutation(user, merchantId, dto, 'inventory.waste.create', 'pos.inventory.waste');
  }

  damage(user: AuthUser, merchantId: string, dto: DamageRecord) {
    return this.mutation(user, merchantId, dto, 'inventory.damage.create', 'pos.inventory.damage');
  }

  quarantine(user: AuthUser, merchantId: string, dto: QuarantineRecord) {
    const permission =
      dto.action === 'enter_quarantine'
        ? 'inventory.quarantine.enter'
        : 'inventory.quarantine.release';
    return this.mutation(user, merchantId, dto, permission, 'pos.inventory.quarantine');
  }

  async restock(user: AuthUser, merchantId: string, dto: RestockCommand) {
    const authorization = await this.authorize(user, merchantId, dto, 'inventory.restock.resolve');
    if (!dto.approvalId || !dto.approvalFingerprint) {
      throw this.approvalRequired(
        'inventory.restock.approve',
        inventoryOperationFingerprint('pos.inventory.restock', dto),
      );
    }
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.inventory.restock',
          payload: dto,
          expectedVersion: dto.expectedVersion,
        },
        async (context) => {
          const result = await this.repo.restock(
            context.client,
            merchantId,
            authorization,
            dto,
            context.correlationId,
          );
          await context.appendAudit({
            eventType: 'inventory.refund_disposition_resolved',
            entityType: 'restock_intent',
            entityId: dto.restockIntentId,
            outcome: 'success',
            publicData: { ledgerEntryCount: result.entries.length },
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async createCount(user: AuthUser, merchantId: string, dto: CreateInventoryCountRequest) {
    const authorization = await this.authorize(user, merchantId, dto, 'inventory.count.create');
    return this.createCountAuthorized(merchantId, dto, authorization);
  }

  /**
   * Produce a prep (plan §8.1 and D4/D5/D9), from the till's own route.
   *
   * The console posts the SAME work as the administrative command
   * `inventory.production.produce`, and both call `produceAuthorized` below, so one
   * batch is authored once whichever surface asked for it.
   */
  async production(user: AuthUser, merchantId: string, dto: ProduceRequest) {
    const authorization = await this.authorize(
      user,
      merchantId,
      dto,
      'inventory.production.produce',
    );
    return this.produceAuthorized(merchantId, dto, authorization);
  }

  /** The merchant's business date, for the console's version of the produce command. */
  currentBusinessDate(merchantId: string): Promise<string> {
    return this.repo.currentBusinessDate(merchantId);
  }

  private async produceAuthorized(
    merchantId: string,
    dto: ProduceRequest,
    authorization: Exclude<Awaited<ReturnType<PosInventoryRepository['authorize']>>, null>,
  ): Promise<ProduceResult> {
    // ONE basis read for the whole batch, taken before the transaction: the basis is
    // merchant-wide and read-only, and the production repository must not open a second
    // one of its own.
    const unitCosts = await this.unitCostsByItem(merchantId);
    try {
      const result = await this.unwrap(
        this.integrity.execute(
          {
            merchantId,
            locationId: dto.locationId,
            commandId: dto.commandId,
            idempotencyKey: dto.idempotencyKey,
            commandType: 'pos.inventory.production',
            payload: dto,
            expectedVersion: dto.expectedVersion,
          },
          async (context) => {
            const result = await this.repo.produce(
              context.client,
              merchantId,
              authorization,
              dto,
              unitCosts,
              context.correlationId,
            );
            await context.appendAudit({
              eventType: 'inventory_production_committed',
              entityType: 'stock_lot',
              entityId: result.lotId,
              outcome: 'success',
              publicData: {
                outputItemId: result.outputItemId,
                consumedCount: result.consumed.length,
                yieldLossQuantity: result.yieldLossQuantity.value,
                incompleteCost: result.incompleteCost,
              },
            });
            return { ok: true, value: result };
          },
        ),
      );
      // Emitted only after the batch committed. `yieldLossQuantity` is the shortfall
      // the repository wrote, so a positive value is the declared-yield miss.
      const shortfall = result.yieldLossQuantity.value > 0;
      this.metrics.increment('inventory.production.batches', {
        outcome: shortfall ? 'shortfall' : 'full',
      });
      if (shortfall) {
        this.metrics.increment(
          'inventory.production.yield_loss_quantity',
          { unit: result.yieldLossQuantity.unit },
          result.yieldLossQuantity.value,
        );
      }
      return result;
    } catch (error) {
      // A shortfall on a `manager_override` item is the ledger's own decision. Its refusal
      // must reach the caller as a conflict, not as a server fault.
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('NEGATIVE_STOCK_APPROVAL_REQUIRED')) {
        throw new ConflictException({ code: 'NEGATIVE_STOCK_APPROVAL_REQUIRED' });
      }
      throw error;
    }
  }

  /**
   * THE one weighted-average receipt basis this module reads, keyed by item. It is the
   * costing module's own read; `no_receipts` leaves the item out of the map, so a
   * missing cost reaches the arithmetic as NULL rather than as a zero.
   */
  private async unitCostsByItem(merchantId: string): Promise<Map<string, bigint>> {
    const basis = await this.costing.costBasis({ merchantId } as unknown as MerchantAccess, {
      includeWithoutReceipts: true,
    });
    const costs = new Map<string, bigint>();
    for (const item of basis.items) {
      if (item.unitCostMinor === null) continue;
      costs.set(item.inventoryItemId, BigInt(item.unitCostMinor));
    }
    return costs;
  }

  private createCountAuthorized(
    merchantId: string,
    dto: CreateInventoryCountRequest,
    authorization: Awaited<ReturnType<PosInventoryRepository['authorize']>> extends infer T
      ? Exclude<T, null>
      : never,
  ) {
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.inventory.count.create',
          payload: dto,
        },
        async (context) => {
          const result = await this.repo.createCount(
            context.client,
            merchantId,
            authorization,
            dto,
            context.correlationId,
          );
          await context.appendAudit({
            eventType: 'inventory.count_started',
            entityType: 'inventory_count',
            entityId: result.count.id,
            outcome: 'success',
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async submitCount(
    user: AuthUser,
    merchantId: string,
    countId: string,
    dto: SubmitInventoryCountRequest,
  ) {
    this.assertCount(countId, dto.countId);
    await this.authorize(user, merchantId, dto, 'inventory.count.submit');
    return this.submitCountAuthorized(merchantId, dto);
  }

  private submitCountAuthorized(merchantId: string, dto: SubmitInventoryCountRequest) {
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.inventory.count.submit',
          payload: dto,
        },
        async (context) => {
          const result = await this.repo.submitCount(
            context.client,
            merchantId,
            dto,
            context.correlationId,
          );
          await context.appendAudit({
            eventType: 'inventory.count_submitted',
            entityType: 'inventory_count',
            entityId: dto.countId,
            outcome: 'success',
            publicData: { varianceCount: result.variances.length },
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async reconcileCount(
    user: AuthUser,
    merchantId: string,
    countId: string,
    dto: InventoryReconciliation,
  ) {
    this.assertCount(countId, dto.countId);
    const authorization = await this.authorize(user, merchantId, dto, 'inventory.count.reconcile');
    return this.reconcileCountAuthorized(user.id, merchantId, dto, authorization);
  }

  private async reconcileCountAuthorized(
    userId: string,
    merchantId: string,
    dto: InventoryReconciliation,
    authorization: Exclude<Awaited<ReturnType<PosInventoryRepository['authorize']>>, null>,
  ) {
    const approval = await this.repo.countApprovalRequirement(userId, merchantId, dto);
    if (approval && (!dto.approvalId || !dto.approvalFingerprint)) {
      throw this.approvalRequired(approval.permission, approval.fingerprint);
    }
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.inventory.count.reconcile',
          payload: dto,
        },
        async (context) => {
          const result = await this.repo.reconcileCount(
            context.client,
            merchantId,
            authorization,
            dto,
            context.correlationId,
          );
          await context.appendAudit({
            eventType: 'inventory.count_reconciled',
            entityType: 'inventory_count',
            entityId: dto.countId,
            outcome: 'success',
            publicData: { correctionCount: result.entries.length },
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async recovery(
    user: AuthUser,
    merchantId: string,
    commandId: string,
    query: InventoryRecoveryQuery,
  ) {
    await this.authorize(user, merchantId, query, 'inventory.read');
    return this.repo.recovery(user.id, merchantId, query.locationId, commandId);
  }

  recoveryAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: DashboardAdministrativeCommandContext & { commandRecordId?: string },
    commandId: string,
  ) {
    if (!context.locationId || !context.commandRecordId) {
      throw new ForbiddenException({ code: 'ADMINISTRATIVE_COMMAND_CONTEXT_REQUIRED' });
    }
    return this.repo.recovery(user.id, access.merchantId, context.locationId, commandId);
  }

  private async mutation(
    user: AuthUser,
    merchantId: string,
    dto: InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord,
    permission: string,
    commandType: string,
    authorizationOverride?: Exclude<Awaited<ReturnType<PosInventoryRepository['authorize']>>, null>,
  ) {
    const authorization =
      authorizationOverride ?? (await this.authorize(user, merchantId, dto, permission));
    const approval = await this.repo.mutationApprovalRequirement(user.id, merchantId, dto);
    if (approval && (!dto.approvalId || !dto.approvalFingerprint)) {
      throw this.approvalRequired(approval.permission, approval.fingerprint);
    }
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType,
          payload: dto,
          expectedVersion: dto.expectedVersion,
        },
        async (context) => {
          const result = await this.repo.mutate(
            context.client,
            merchantId,
            authorization,
            dto,
            context.correlationId,
          );
          await context.appendAudit({
            eventType: 'inventory.operation_committed',
            entityType: 'inventory_item',
            entityId: dto.inventoryItemId,
            outcome: 'success',
            publicData: { commandType, ledgerEntryCount: result.entries.length },
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async executeAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: DashboardAdministrativeCommandContext & { commandRecordId?: string },
    operation: string,
    dto:
      | InventoryAdjustment
      | WasteRecord
      | DamageRecord
      | QuarantineRecord
      | CreateInventoryCountRequest
      | SubmitInventoryCountRequest
      | InventoryReconciliation
      | ProduceRequest,
  ) {
    if (!context.locationId || !context.commandRecordId) {
      throw new ForbiddenException({ code: 'ADMINISTRATIVE_COMMAND_CONTEXT_REQUIRED' });
    }
    const permission = inventoryPermission(operation, dto);
    const authorization = await this.repo.authorizeAdministrative({
      userId: user.id,
      merchantId: access.merchantId,
      locationId: context.locationId,
      dashboardSessionId: user.sessionId,
      administrativeCommandId: context.commandRecordId,
      permissions: access.permissions,
      permission,
    });
    if (!authorization) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    if (operation === 'inventory.count.create') {
      return this.createCountAuthorized(
        access.merchantId,
        dto as CreateInventoryCountRequest,
        authorization,
      );
    }
    if (operation === 'inventory.count.submit') {
      return this.submitCountAuthorized(access.merchantId, dto as SubmitInventoryCountRequest);
    }
    if (operation === 'inventory.count.reconcile') {
      return this.reconcileCountAuthorized(
        user.id,
        access.merchantId,
        dto as InventoryReconciliation,
        authorization,
      );
    }
    if (operation === 'inventory.production.produce') {
      // The console's own door to the same service method the till calls: one batch,
      // authored once, whichever surface asked for it.
      return this.produceAuthorized(access.merchantId, dto as ProduceRequest, authorization);
    }
    const commandType = `pos.${operation}`;
    return this.mutation(
      user,
      access.merchantId,
      dto as InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord,
      permission,
      commandType,
      authorization,
    );
  }

  async previewAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: DashboardAdministrativeCommandContext & { commandRecordId?: string },
    operation: string,
    dto:
      InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord | InventoryReconciliation,
  ) {
    if (!context.locationId || !context.commandRecordId) {
      throw new ForbiddenException({ code: 'ADMINISTRATIVE_COMMAND_CONTEXT_REQUIRED' });
    }
    const permission = inventoryPermission(operation, dto);
    const authorization = await this.repo.authorizeAdministrative({
      userId: user.id,
      merchantId: access.merchantId,
      locationId: context.locationId,
      dashboardSessionId: user.sessionId,
      administrativeCommandId: context.commandRecordId,
      permissions: access.permissions,
      permission,
    });
    if (!authorization) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    const approval =
      operation === 'inventory.count.reconcile'
        ? await this.repo.countApprovalRequirement(
            user.id,
            access.merchantId,
            dto as InventoryReconciliation,
          )
        : await this.repo.mutationApprovalRequirement(
            user.id,
            access.merchantId,
            dto as InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord,
          );
    return {
      approvalRequired: approval !== null,
      approvalPermission: approval?.permission ?? null,
      commandFingerprint: approval?.fingerprint ?? null,
    };
  }

  private async authorize(
    user: AuthUser,
    merchantId: string,
    input: { locationId: string; operatorSessionId: string },
    permission: string,
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const authorization = await this.repo.authorize(
      user.id,
      user.sessionId,
      merchantId,
      input.locationId,
      input.operatorSessionId,
      user.deviceId,
      permission,
    );
    if (!authorization) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    return authorization;
  }

  private assertCount(pathId: string, bodyId: string) {
    if (pathId !== bodyId) throw new ForbiddenException({ code: 'INVENTORY_COUNT_SCOPE' });
  }

  private approvalRequired(permission: string, fingerprint: string) {
    return new ConflictException({
      code: 'APPROVAL_REQUIRED',
      fieldErrors: {
        approvalPermission: [permission],
        approvalFingerprint: [fingerprint],
      },
    });
  }

  private async unwrap<T>(promise: Promise<CommandResult<T>>): Promise<T> {
    let result: CommandResult<T>;
    try {
      result = await promise;
    } catch (error) {
      const code = inventoryConflictCode(error);
      if (code) throw new ConflictException({ code });
      throw error;
    }
    if (result.status === 'succeeded' && result.result !== null) return result.result;
    throw new ConflictException({
      code: result.failureCode ?? 'INVENTORY_COMMAND_FAILED',
      correlationId: result.correlationId,
    });
  }
}

function inventoryPermission(
  operation: string,
  dto:
    | InventoryAdjustment
    | WasteRecord
    | DamageRecord
    | QuarantineRecord
    | CreateInventoryCountRequest
    | SubmitInventoryCountRequest
    | InventoryReconciliation
    | ProduceRequest,
): string {
  if (operation === 'inventory.adjustment') {
    return (dto as InventoryAdjustment).direction === 'increase'
      ? 'inventory.adjust.increase'
      : 'inventory.adjust.decrease';
  }
  if (operation === 'inventory.waste') return 'inventory.waste.create';
  if (operation === 'inventory.damage') return 'inventory.damage.create';
  if (operation === 'inventory.quarantine') {
    return (dto as QuarantineRecord).action === 'enter_quarantine'
      ? 'inventory.quarantine.enter'
      : 'inventory.quarantine.release';
  }
  if (operation === 'inventory.count.create') return 'inventory.count.create';
  if (operation === 'inventory.count.submit') return 'inventory.count.submit';
  if (operation === 'inventory.production.produce') return 'inventory.production.produce';
  return 'inventory.count.reconcile';
}
