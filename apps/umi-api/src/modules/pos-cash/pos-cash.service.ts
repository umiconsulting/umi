import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AdoptCashShiftRequest,
  CashMovementRequest,
  CashCommandRecoveryQuery,
  NoSaleDrawerRequest,
  OpenCashShiftRequest,
  ReconcileCashShiftRequest,
  RecountRequest,
  RecoverCashShiftRequest,
  ResolveCashVarianceRequest,
  ShiftCloseRequest,
  ShiftHandoffRequest,
  ShiftTransitionRequest,
  SubmitBlindCountRequest,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { PasswordService } from '../../shared/auth/password.service';
import { posPinLookupHash } from '../../shared/auth/pos-pin';
import type { AppConfig } from '../../shared/config/config.schema';
import { IntegrityService } from '../integrity/integrity.service';
import type { CommandResult, TransactionContext } from '../integrity/integrity.types';
import { PosCashRepository, type CashAuthorization } from './pos-cash.repository';

@Injectable()
export class PosCashService {
  constructor(
    private readonly repo: PosCashRepository,
    private readonly integrity: IntegrityService,
    private readonly passwords?: PasswordService,
    private readonly config?: ConfigService<AppConfig, true>,
  ) {}

  center(user: AuthUser, merchantId: string, locationId: string, operatorSessionId: string) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    return this.authorize(user, merchantId, locationId, operatorSessionId, 'cash.shift.read').then(
      (authorization) =>
        this.repo.center(
          user.id,
          merchantId,
          locationId,
          operatorSessionId,
          user.deviceId!,
          authorization.operatorId,
        ),
    );
  }

  async commandRecovery(
    user: AuthUser,
    merchantId: string,
    commandId: string,
    query: CashCommandRecoveryQuery,
  ) {
    if (commandId !== query.commandId) {
      throw new ForbiddenException({ code: 'CASH_COMMAND_SCOPE_VIOLATION' });
    }
    await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      'cash.shift.read',
    );
    return this.repo.commandRecovery(
      user.id,
      merchantId,
      query.locationId,
      query.commandId,
      query.idempotencyKey,
    );
  }

  async open(user: AuthUser, merchantId: string, dto: OpenCashShiftRequest) {
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.shift.open',
    );
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.cash.shift.open',
          payload: dto,
        },
        async (context) => {
          const result = await this.repo.openShift(
            context.client,
            merchantId,
            authorization,
            dto,
            context.correlationId,
          );
          await context.appendAudit({
            eventType: 'cash.shift_opened',
            entityType: 'cash_shift',
            entityId: result.shift.id,
            outcome: 'success',
            publicData: { registerReference: result.register.publicReference },
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async movement(user: AuthUser, merchantId: string, shiftId: string, dto: CashMovementRequest) {
    this.assertPathShift(shiftId, dto.shiftId);
    const permission = `cash.movement.${dto.type}`;
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      permission,
    );
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: `pos.cash.${dto.type}`,
          payload: dto,
        },
        async (context) => {
          const result = await this.repo.movement(context.client, merchantId, authorization, dto);
          await context.appendAudit({
            eventType: 'cash.movement_committed',
            entityType: 'cash_shift',
            entityId: dto.shiftId,
            outcome: 'success',
            publicData: { movementCategory: dto.type, ledgerSequence: result.ledgerEntry.sequence },
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async count(user: AuthUser, merchantId: string, shiftId: string, dto: SubmitBlindCountRequest) {
    this.assertPathShift(shiftId, dto.shiftId);
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.count.submit',
    );
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.cash.count.submit',
          payload: dto,
        },
        async (context) => {
          const result = await this.repo.submitCount(
            context.client,
            merchantId,
            authorization,
            dto,
          );
          await context.appendAudit({
            eventType: 'cash.count_submitted',
            entityType: 'cash_shift',
            entityId: dto.shiftId,
            outcome: 'success',
            publicData: {
              ledgerSequence: result.count.ledgerSequence,
              outcomeCode: result.variance.outcome,
            },
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async recount(user: AuthUser, merchantId: string, shiftId: string, dto: RecountRequest) {
    this.assertPathShift(shiftId, dto.shiftId);
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.count.recount',
    );
    return this.command(
      merchantId,
      dto.locationId,
      dto.commandId,
      dto.idempotencyKey,
      'pos.cash.count.recount',
      dto,
      async (context) => {
        const result = await this.repo.requestRecount(
          context.client,
          merchantId,
          authorization,
          dto,
        );
        await context.appendAudit({
          eventType: 'cash.recount_requested',
          entityType: 'cash_shift',
          entityId: dto.shiftId,
          outcome: 'success',
          reasonCode: dto.reasonCode,
          publicData: {},
        });
        return result;
      },
    );
  }

  async resolve(
    user: AuthUser,
    merchantId: string,
    shiftId: string,
    dto: ResolveCashVarianceRequest,
  ) {
    this.assertPathShift(shiftId, dto.shiftId);
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.reconcile',
    );
    return this.command(
      merchantId,
      dto.locationId,
      dto.commandId,
      dto.idempotencyKey,
      'pos.cash.variance.resolve',
      dto,
      async (context) => {
        const result = await this.repo.resolveVariance(
          context.client,
          merchantId,
          authorization,
          dto,
        );
        await context.appendAudit({
          eventType: 'cash.variance_reason_selected',
          entityType: 'cash_shift',
          entityId: dto.shiftId,
          outcome: 'success',
          publicData: { reasonCode: dto.reason, ledgerSequence: result.ledgerSequence },
        });
        return result;
      },
    );
  }

  async reconcile(
    user: AuthUser,
    merchantId: string,
    shiftId: string,
    dto: ReconcileCashShiftRequest,
  ) {
    this.assertPathShift(shiftId, dto.shiftId);
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.reconcile',
    );
    return this.command(
      merchantId,
      dto.locationId,
      dto.commandId,
      dto.idempotencyKey,
      'pos.cash.reconcile',
      dto,
      async (context) => {
        const result = await this.repo.reconcile(context.client, merchantId, authorization, dto);
        await context.appendAudit({
          eventType: 'cash.reconciliation_completed',
          entityType: 'cash_shift',
          entityId: dto.shiftId,
          outcome: 'success',
          publicData: { outcomeCode: result.outcome, ledgerSequence: result.ledgerSequence },
        });
        return result;
      },
    );
  }

  async close(user: AuthUser, merchantId: string, shiftId: string, dto: ShiftCloseRequest) {
    this.assertPathShift(shiftId, dto.shiftId);
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.shift.close',
    );
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.cash.shift.close',
          payload: dto,
        },
        async (context) => {
          const result = await this.repo.close(
            context.client,
            merchantId,
            authorization,
            dto,
            context.correlationId,
          );
          await context.appendAudit({
            eventType: 'cash.shift_closed',
            entityType: 'cash_shift',
            entityId: dto.shiftId,
            outcome: 'success',
            publicData: { ledgerSequence: result.summary.expectedCash.ledgerSequence },
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async transition(
    user: AuthUser,
    merchantId: string,
    shiftId: string,
    dto: ShiftTransitionRequest,
    target: 'suspended' | 'open',
  ) {
    this.assertPathShift(shiftId, dto.shiftId);
    const permission = target === 'suspended' ? 'cash.shift.suspend' : 'cash.shift.resume';
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      permission,
    );
    return this.command(
      merchantId,
      dto.locationId,
      dto.commandId,
      dto.idempotencyKey,
      `pos.cash.shift.${target}`,
      dto,
      async (context) => {
        const result = await this.repo.transition(
          context.client,
          merchantId,
          authorization,
          dto,
          target,
        );
        await context.appendAudit({
          eventType: `cash.shift_${target}`,
          entityType: 'cash_shift',
          entityId: dto.shiftId,
          outcome: 'success',
          publicData: {},
        });
        return result;
      },
    );
  }

  async handoff(user: AuthUser, merchantId: string, shiftId: string, dto: ShiftHandoffRequest) {
    if (!user.deviceId) throw new ForbiddenException({ code: 'DEVICE_NOT_ALLOWED' });
    this.assertPathShift(shiftId, dto.shiftId);
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.shift.handoff',
    );
    const secret = this.config?.get('JWT_SECRET', { infer: true });
    if (!secret || !this.passwords) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const incoming = await this.repo.incomingPinRecord(
      posPinLookupHash(secret, merchantId, dto.incomingOperatorPin),
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      user.id,
    );
    if (
      !incoming ||
      !incoming.salt ||
      !incoming.hash ||
      (incoming.lockedUntil?.getTime() ?? 0) > Date.now()
    ) {
      throw new ForbiddenException({ code: 'PIN_LOCKED' });
    }
    if (!this.passwords.verify(dto.incomingOperatorPin, incoming.salt, incoming.hash)) {
      await this.repo.recordPinFailure(user.deviceId, merchantId, dto.locationId, user.id);
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    return this.command(
      merchantId,
      dto.locationId,
      dto.commandId,
      dto.idempotencyKey,
      'pos.cash.shift.handoff',
      {
        locationId: dto.locationId,
        shiftId: dto.shiftId,
        operatorSessionId: dto.operatorSessionId,
        expectedShiftVersion: dto.expectedShiftVersion,
        fingerprint: dto.fingerprint,
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        incomingOperatorId: incoming.userId,
      },
      async (context) => {
        const result = await this.repo.handoff(
          context.client,
          merchantId,
          authorization,
          incoming,
          dto,
        );
        await context.appendAudit({
          eventType: 'cash.handoff_completed',
          entityType: 'cash_shift',
          entityId: dto.shiftId,
          outcome: 'success',
          publicData: { ledgerSequence: result.expectedCash.ledgerSequence },
        });
        return result;
      },
    );
  }

  async noSale(user: AuthUser, merchantId: string, shiftId: string, dto: NoSaleDrawerRequest) {
    this.assertPathShift(shiftId, dto.shiftId);
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.drawer.no_sale',
    );
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.cash.drawer.no_sale',
          payload: dto,
        },
        async (context) => {
          const result = await this.repo.noSale(
            context.client,
            merchantId,
            authorization,
            dto,
            context.correlationId,
          );
          await context.appendAudit({
            eventType: 'cash.no_sale_drawer_requested',
            entityType: 'cash_shift',
            entityId: dto.shiftId,
            outcome: 'success',
            publicData: { hardwareVerified: false },
          });
          return { ok: true, value: result };
        },
      ),
    );
  }

  async adopt(user: AuthUser, merchantId: string, shiftId: string, dto: AdoptCashShiftRequest) {
    this.assertPathShift(shiftId, dto.shiftId);
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.shift.resume',
    );
    return this.command(
      merchantId,
      dto.locationId,
      dto.commandId,
      dto.idempotencyKey,
      'pos.cash.shift.adopt',
      dto,
      async (context) => {
        const result = await this.repo.adopt(
          context.client,
          merchantId,
          authorization,
          dto,
          context.correlationId,
        );
        await context.appendAudit({
          eventType: 'cash.shift_adopted',
          entityType: 'cash_shift',
          entityId: dto.shiftId,
          outcome: 'success',
          publicData: {
            previousHoldingDeviceId: result.custody.previousHoldingDeviceId,
            newHoldingDeviceId: result.custody.newHoldingDeviceId,
          },
        });
        return result;
      },
    );
  }

  async recover(user: AuthUser, merchantId: string, shiftId: string, dto: RecoverCashShiftRequest) {
    this.assertPathShift(shiftId, dto.shiftId);
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'cash.variance.approve',
    );
    return this.command(
      merchantId,
      dto.locationId,
      dto.commandId,
      dto.idempotencyKey,
      'pos.cash.shift.recover',
      dto,
      async (context) => {
        const result = await this.repo.recover(
          context.client,
          merchantId,
          authorization,
          dto,
          context.correlationId,
        );
        await context.appendAudit({
          eventType: 'cash.shift_recovered',
          entityType: 'cash_shift',
          entityId: dto.shiftId,
          outcome: 'success',
          publicData: {
            responsibleOperatorId: result.custody.responsibleOperatorId,
            variance: result.custody.variance?.minorUnits ?? null,
          },
        });
        return result;
      },
    );
  }

  private async authorize(
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    permission: string,
  ): Promise<CashAuthorization> {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const authorization = await this.repo.authorize(
      user.id,
      user.sessionId,
      user.deviceId,
      merchantId,
      locationId,
      operatorSessionId,
    );
    if (
      !authorization ||
      (!authorization.permissions.includes(permission) && !authorization.permissions.includes('*'))
    ) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    return authorization;
  }

  private assertPathShift(pathShiftId: string, bodyShiftId: string): void {
    if (pathShiftId !== bodyShiftId) {
      throw new ForbiddenException({ code: 'CASH_SHIFT_SCOPE_VIOLATION' });
    }
  }

  private async command<T>(
    merchantId: string,
    locationId: string,
    commandId: string,
    idempotencyKey: string,
    commandType: string,
    payload: unknown,
    operation: (context: TransactionContext) => Promise<T>,
  ) {
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId,
          commandId,
          idempotencyKey,
          commandType,
          payload,
        },
        async (context) => ({ ok: true, value: await operation(context) }),
      ),
    );
  }

  private async unwrap<T>(command: Promise<CommandResult<T>>): Promise<T> {
    const result = await command;
    if (result.status !== 'succeeded' || result.result === null) {
      throw new ConflictException({
        code: result.failureCode ?? 'CASH_OPERATION_CONFLICT',
      });
    }
    return result.result;
  }
}
