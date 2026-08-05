import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AvailabilityQuery,
  CreateInventoryCountRequest,
  DamageRecord,
  InventoryAdjustment,
  InventoryQuery,
  InventoryReconciliation,
  InventoryRecoveryQuery,
  QuarantineRecord,
  RestockCommand,
  SubmitInventoryCountRequest,
  WasteRecord,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import type { CommandResult } from '../integrity/integrity.types';
import { inventoryConflictCode, inventoryOperationFingerprint } from './inventory-errors';
import { PosInventoryRepository } from './pos-inventory.repository';

@Injectable()
export class PosInventoryService {
  constructor(
    private readonly repo: PosInventoryRepository,
    private readonly integrity: IntegrityService,
  ) {}

  async overview(user: AuthUser, merchantId: string, query: InventoryQuery) {
    await this.authorize(user, merchantId, query, 'inventory.read');
    return this.repo.overview(user.id, merchantId, query);
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
    const approval = await this.repo.countApprovalRequirement(user.id, merchantId, dto);
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

  private async mutation(
    user: AuthUser,
    merchantId: string,
    dto: InventoryAdjustment | WasteRecord | DamageRecord | QuarantineRecord,
    permission: string,
    commandType: string,
  ) {
    const authorization = await this.authorize(user, merchantId, dto, permission);
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
