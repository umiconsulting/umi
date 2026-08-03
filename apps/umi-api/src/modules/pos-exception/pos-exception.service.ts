import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  ExceptionCommandRecoveryQuery,
  ManualTerminalRefundOutcomeRequest,
  RefundApprovalRequest,
  RefundPreviewRequest,
  SaleExceptionCommand,
  SaleExceptionEligibilityQuery,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import { PosEntryService } from '../pos-entry/pos-entry.service';
import { PosExceptionRepository, type ExceptionAuthorization } from './pos-exception.repository';

export const exceptionCommandFingerprint = (
  saleId: string,
  previewId: string,
  previewFingerprint: string,
  commandId: string,
): string =>
  createHash('sha256')
    .update(JSON.stringify({ commandId, previewFingerprint, previewId, saleId }))
    .digest('hex');

@Injectable()
export class PosExceptionService {
  constructor(
    private readonly repo: PosExceptionRepository,
    private readonly integrity: IntegrityService,
    private readonly entry: PosEntryService,
  ) {}

  async eligibility(
    user: AuthUser,
    merchantId: string,
    saleId: string,
    query: SaleExceptionEligibilityQuery,
  ) {
    const authorization = await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      'sale.exception.read',
    );
    const result = await this.repo.eligibility(user.id, merchantId, saleId, authorization);
    if (!result) throw new NotFoundException({ code: 'SALE_NOT_FOUND' });
    return result;
  }

  async preview(user: AuthUser, merchantId: string, saleId: string, dto: RefundPreviewRequest) {
    const permission =
      dto.exceptionType === 'void'
        ? 'sale.void.create'
        : dto.exceptionType === 'full_refund'
          ? 'sale.refund.full'
          : 'sale.refund.partial';
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      permission,
    );
    return this.repo.preview(user.id, merchantId, saleId, authorization, dto);
  }

  async approval(user: AuthUser, merchantId: string, saleId: string, dto: RefundApprovalRequest) {
    if (saleId !== dto.saleId) {
      throw new ForbiddenException({ code: 'SALE_EXCEPTION_SCOPE_VIOLATION' });
    }
    await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'sale.exception.read',
    );
    const expected = exceptionCommandFingerprint(
      saleId,
      dto.previewId,
      dto.previewFingerprint,
      dto.commandId,
    );
    if (dto.commandFingerprint !== expected) {
      throw new ConflictException({ code: 'APPROVAL_FINGERPRINT_MISMATCH' });
    }
    await this.repo.assertPreview(
      user.id,
      merchantId,
      dto.locationId,
      saleId,
      dto.previewId,
      dto.previewFingerprint,
    );
    const grant = await this.entry.approveByManager(user, {
      operatorSessionId: dto.operatorSessionId,
      managerPin: dto.managerPin,
      permission: 'sale.refund.approve',
      merchantId,
      locationId: dto.locationId,
      commandFingerprint: dto.commandFingerprint,
    });
    const actor = await this.repo.approvalActor(
      user.id,
      merchantId,
      dto.locationId,
      grant.elevationId,
    );
    return {
      approvalId: grant.elevationId,
      approvingOperatorReference: actor ?? 'manager',
      previewFingerprint: dto.previewFingerprint,
      expiresAt: grant.expiresAt,
      oneUse: true as const,
    };
  }

  async commit(user: AuthUser, merchantId: string, saleId: string, dto: SaleExceptionCommand) {
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'sale.exception.read',
    );
    const result = await this.integrity.execute(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        commandType: 'pos.exception.commit',
        payload: { saleId, ...dto },
      },
      async (context) => {
        const value = await this.repo.commit(
          context.client,
          merchantId,
          saleId,
          authorization,
          dto,
          exceptionCommandFingerprint(
            saleId,
            dto.previewId,
            dto.previewFingerprint,
            dto.commandId,
          ),
          context.correlationId,
        );
        await context.appendAudit({
          eventType:
            value.exceptionType === 'void' ? 'sale.void_committed' : 'sale.refund_committed',
          entityType: 'pos_sale_exception',
          entityId: value.exceptionId,
          outcome: 'success',
          publicData: {
            exceptionType: value.exceptionType,
            outcomeCode: value.status,
          },
        });
        return { ok: true as const, value };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({ code: result.failureCode ?? 'SALE_EXCEPTION_CONFLICT' });
    }
    return result.result;
  }

  async history(
    user: AuthUser,
    merchantId: string,
    saleId: string,
    query: SaleExceptionEligibilityQuery,
  ) {
    const authorization = await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      'sale.exception.history',
    );
    return this.repo.history(user.id, merchantId, saleId, authorization);
  }

  async result(
    user: AuthUser,
    merchantId: string,
    saleId: string,
    exceptionId: string,
    query: SaleExceptionEligibilityQuery,
  ) {
    const authorization = await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      'sale.exception.read',
    );
    const result = await this.repo.result(user.id, merchantId, saleId, exceptionId, authorization);
    if (!result) throw new NotFoundException({ code: 'SALE_EXCEPTION_NOT_FOUND' });
    return result;
  }

  async terminalOutcome(
    user: AuthUser,
    merchantId: string,
    saleId: string,
    previewId: string,
    dto: ManualTerminalRefundOutcomeRequest,
  ) {
    const authorization = await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'sale.refund.manual_terminal',
    );
    const result = await this.integrity.execute(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        commandType: 'pos.exception.terminal_outcome',
        payload: { saleId, previewId, ...dto },
      },
      async (context) => ({
        ok: true as const,
        value: await this.repo.terminalOutcome(
          context.client,
          merchantId,
          saleId,
          previewId,
          authorization,
          dto,
        ),
      }),
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({ code: result.failureCode ?? 'REFUND_OUTCOME_CONFLICT' });
    }
    return result.result;
  }

  async command(
    user: AuthUser,
    merchantId: string,
    commandId: string,
    query: ExceptionCommandRecoveryQuery,
  ) {
    if (commandId !== query.commandId) {
      throw new ForbiddenException({ code: 'SALE_EXCEPTION_SCOPE_VIOLATION' });
    }
    await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      'sale.exception.read',
    );
    return this.repo.command(user.id, merchantId, query);
  }

  private async authorize(
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    permission: string,
  ): Promise<ExceptionAuthorization> {
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
}
