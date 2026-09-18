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
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import type { DashboardAdministrativeCommandContext } from '../administrative-commands/administrative-command-context.service';
import { IntegrityService } from '../integrity/integrity.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { PosEntryService } from '../pos-entry/pos-entry.service';
import { TenderService } from '../tender/tender.service';
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

/**
 * A UUID derived from what the refund IS, so a retried exception presents ONE refund to the
 * vendor rather than one per attempt. `pos.tenderRefund` is idempotent on its command identity
 * (plan D3), and the identity has to survive a retry of the whole exception command — a random
 * one would ask the terminal to give the money back a second time.
 */
export const derivedUuid = (...parts: Array<string | number>): string => {
  const digest = createHash('sha256').update(parts.join(':')).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** The permission the tender path demands before it will ask a terminal for money back. */
const TERMINAL_REFUND_PERMISSION = 'sale.refund.manual_terminal';

@Injectable()
export class PosExceptionService {
  constructor(
    private readonly repo: PosExceptionRepository,
    private readonly integrity: IntegrityService,
    private readonly entry: PosEntryService,
    private readonly fiscal: FiscalService,
    private readonly tender: TenderService,
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

  async previewAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: DashboardAdministrativeCommandContext & { commandRecordId?: string },
    saleId: string,
    input: Omit<RefundPreviewRequest, 'locationId' | 'operatorSessionId'>,
  ) {
    const locationId = context.locationId;
    if (!locationId || !context.commandRecordId) {
      throw new ForbiddenException({ code: 'ADMINISTRATIVE_COMMAND_CONTEXT_REQUIRED' });
    }
    const permission =
      input.exceptionType === 'void'
        ? 'sale.void.create'
        : input.exceptionType === 'full_refund'
          ? 'sale.refund.full'
          : 'sale.refund.partial';
    if (!access.permissions.includes('*') && !access.permissions.includes(permission)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    const authorization = await this.repo.authorizeAdministrative({
      userId: user.id,
      sessionId: user.sessionId,
      merchantId: access.merchantId,
      locationId,
      administrativeCommandId: context.commandRecordId,
      permissions: access.permissions,
    });
    if (!authorization) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    return this.repo.preview(user.id, access.merchantId, saleId, authorization, {
      ...input,
      locationId,
      operatorSessionId: user.sessionId,
    });
  }

  async eligibilityAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: DashboardAdministrativeCommandContext & { commandRecordId?: string },
    saleId: string,
  ) {
    if (!context.locationId || !context.commandRecordId) {
      throw new ForbiddenException({ code: 'ADMINISTRATIVE_COMMAND_CONTEXT_REQUIRED' });
    }
    const authorization = await this.repo.authorizeAdministrative({
      userId: user.id,
      sessionId: user.sessionId,
      merchantId: access.merchantId,
      locationId: context.locationId,
      administrativeCommandId: context.commandRecordId,
      permissions: access.permissions,
    });
    if (!authorization) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    const result = await this.repo.eligibility(user.id, access.merchantId, saleId, authorization);
    if (!result) throw new NotFoundException({ code: 'SALE_NOT_FOUND' });
    return result;
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

  async approvalAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: DashboardAdministrativeCommandContext & { commandRecordId?: string },
    saleId: string,
    input: Omit<RefundApprovalRequest, 'locationId' | 'operatorSessionId' | 'saleId'>,
  ) {
    const locationId = context.locationId;
    if (!locationId || !context.commandRecordId) {
      throw new ForbiddenException({ code: 'ADMINISTRATIVE_COMMAND_CONTEXT_REQUIRED' });
    }
    if (saleId !== context.targetAggregateId) {
      throw new ForbiddenException({ code: 'SALE_EXCEPTION_SCOPE_VIOLATION' });
    }
    const expected = exceptionCommandFingerprint(
      saleId,
      input.previewId,
      input.previewFingerprint,
      input.commandId,
    );
    if (input.commandFingerprint !== expected) {
      throw new ConflictException({ code: 'APPROVAL_FINGERPRINT_MISMATCH' });
    }
    await this.repo.assertPreview(
      user.id,
      access.merchantId,
      locationId,
      saleId,
      input.previewId,
      input.previewFingerprint,
    );
    const grant = await this.entry.approveAdministrativeByManager(user, access, {
      dashboardSessionId: user.sessionId,
      managerPin: input.managerPin,
      permission: 'sale.refund.approve',
      locationId,
      commandFingerprint: input.commandFingerprint,
    });
    const actor = await this.repo.approvalActor(
      user.id,
      access.merchantId,
      locationId,
      grant.elevationId,
    );
    return {
      approvalId: grant.elevationId,
      approvingOperatorReference: actor ?? 'manager',
      previewFingerprint: input.previewFingerprint,
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
    // THE MONEY MOVES BEFORE THE SALE SAYS IT DID. A provider-captured card tender is given
    // back by the vendor, and the giving-back is its own command with its own attempt —
    // exactly the order the till already uses for a capture (plan §4 Phase 4, and the
    // capture-then-commit rule of the tender path).
    const providerRefunds = await this.moveProviderRefunds(
      user,
      merchantId,
      saleId,
      dto,
      authorization,
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
          exceptionCommandFingerprint(saleId, dto.previewId, dto.previewFingerprint, dto.commandId),
          context.correlationId,
          providerRefunds,
        );
        /**
         * §8G's acceptance, third sentence: "a cancelled sale cancels its fiscal
         * document". Here and nowhere else, because this is the only command that undoes a
         * COMMITTED sale — `sale.cancel` refuses anything past `draft`/`prepared`, and only
         * a committed sale can have a CFDI.
         *
         * It runs on `context.client`, inside the SAME transaction and the same command as
         * the void, and that is the whole point: an operator cannot void the sale and leave
         * a live CFDI at the SAT, and cannot cancel the CFDI and leave the sale standing in
         * our books. A PAC that refuses throws here, the transaction rolls back, and both
         * facts stay as they were. Half-done is the one outcome this makes impossible.
         *
         * ONLY `void` cancels the document. A `full_refund` is a DIFFERENT fiscal
         * instrument — the SAT's CFDI de Egreso, a credit note, which the Facturapi adapter
         * already models as type `E` — and cancelling the income CFDI because the money was
         * given back would leave the café with no fiscal record of the sale at all. That
         * instrument is a later increment; it is named here so nobody mistakes its absence
         * for an oversight.
         */
        const fiscalDocument =
          value.exceptionType === 'void'
            ? await this.fiscal.cancelForSale(context.client, {
                merchantId,
                saleId,
                locationId: dto.locationId,
                motive: dto.fiscalMotive,
                reason: `Void ${saleId}`,
                actorUserId: user.id,
                correlationId: context.correlationId,
              })
            : null;
        await context.appendAudit({
          eventType:
            value.exceptionType === 'void' ? 'sale.void_committed' : 'sale.refund_committed',
          entityType: 'pos_sale_exception',
          entityId: value.exceptionId,
          outcome: 'success',
          publicData: {
            exceptionType: value.exceptionType,
            outcomeCode: value.status,
            // The trail names the fiscal document in the SAME event as the void, so a
            // reader sees one act rather than two rows that happen to agree.
            fiscalDocumentFound: fiscalDocument?.documentFound ?? false,
            fiscalDocumentId: fiscalDocument?.documentId ?? null,
            fiscalDocumentStatus: fiscalDocument?.status ?? null,
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

  async commitAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: DashboardAdministrativeCommandContext & { commandRecordId?: string },
    saleId: string,
    input: Omit<SaleExceptionCommand, 'locationId' | 'operatorSessionId'>,
  ) {
    const locationId = context.locationId;
    if (!locationId || !context.commandRecordId) {
      throw new ForbiddenException({ code: 'ADMINISTRATIVE_COMMAND_CONTEXT_REQUIRED' });
    }
    const authorization = await this.repo.authorizeAdministrative({
      userId: user.id,
      sessionId: user.sessionId,
      merchantId: access.merchantId,
      locationId,
      administrativeCommandId: context.commandRecordId,
      permissions: access.permissions,
    });
    if (!authorization) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    const dto: SaleExceptionCommand = {
      ...input,
      locationId,
      operatorSessionId: user.sessionId,
    };
    // Same rule as the till's commit: a provider-captured card tender is given back by the
    // vendor BEFORE the administrator's command records that it was.
    const providerRefunds = await this.moveProviderRefunds(
      user,
      access.merchantId,
      saleId,
      dto,
      authorization,
    );
    const result = await this.integrity.execute(
      {
        merchantId: access.merchantId,
        locationId,
        commandId: dto.commandId,
        idempotencyKey: dto.idempotencyKey,
        commandType: 'pos.exception.commit',
        payload: { saleId, ...dto, operatorSessionId: null, commandContext: context.type },
      },
      async (integrityContext) => ({
        ok: true as const,
        value: await this.repo.commit(
          integrityContext.client,
          access.merchantId,
          saleId,
          authorization,
          dto,
          exceptionCommandFingerprint(saleId, dto.previewId, dto.previewFingerprint, dto.commandId),
          integrityContext.correlationId,
          providerRefunds,
        ),
      }),
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({ code: result.failureCode ?? 'SALE_EXCEPTION_CONFLICT' });
    }
    return result.result;
  }

  async recoverAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: DashboardAdministrativeCommandContext & { commandRecordId?: string },
    input: Omit<ExceptionCommandRecoveryQuery, 'locationId' | 'operatorSessionId'>,
  ) {
    if (!context.locationId || !context.commandRecordId) {
      throw new ForbiddenException({ code: 'ADMINISTRATIVE_COMMAND_CONTEXT_REQUIRED' });
    }
    await this.repo.authorizeAdministrative({
      userId: user.id,
      sessionId: user.sessionId,
      merchantId: access.merchantId,
      locationId: context.locationId,
      administrativeCommandId: context.commandRecordId,
      permissions: access.permissions,
    });
    return this.repo.command(user.id, access.merchantId, {
      ...input,
      locationId: context.locationId,
      operatorSessionId: user.sessionId,
    });
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

  /**
   * ASK THE TERMINAL TO GIVE THE MONEY BACK, BEFORE THE SALE RECORDS THAT IT DID.
   *
   * Plan §4 Phase 4. A tender whose money was taken by a device we integrated with is not
   * refunded by an operator's word: the vendor is asked, in its own idempotent command, and
   * the answer becomes a REFUND ATTEMPT with the vendor's refund id as its proof. The
   * exception command then checks those attempts for itself (see `PosExceptionRepository.commit`)
   * and only records the sale's refund if they hold up.
   *
   * The ORDER IS THE POINT, and it is the till's capture-then-commit order: money first, the
   * record second. A sale that recorded a card refund nobody asked the terminal for is the
   * exact lie this workstream exists to prevent.
   *
   * The identities are DERIVED from the preview and the tender, so a retried exception asks
   * for the same refund rather than a second one (plan D3) — the vendor binds an idempotency
   * key to its request for 24 hours, and the refund command's own identity is what makes the
   * retry a replay.
   */
  private async moveProviderRefunds(
    user: AuthUser,
    merchantId: string,
    saleId: string,
    dto: SaleExceptionCommand,
    authorization: ExceptionAuthorization,
  ): Promise<Array<{ tenderId: string; attemptId: string }>> {
    const targets = await this.repo.providerRefundTargets(
      user.id,
      merchantId,
      dto.locationId,
      saleId,
      dto.previewId,
    );
    if (targets.length === 0) return [];
    // A CARD REFUND IS ASKED FOR AT THE TILL. The console's administrative path has no
    // operator session for the terminal to answer to, and the tender path refuses to move
    // money without one; saying so here is honest, and it also stops the console from
    // recording a card refund it cannot make. Wiring the console to the terminal is its own
    // increment (plan §12.4).
    if (authorization.commandContextType !== 'pos_device') {
      throw new ConflictException({
        code: 'TERMINAL_REFUND_REQUIRES_TILL',
        details: { tenders: targets.map((target) => target.tenderId) },
      });
    }
    // The permission the tender path demands before it will speak to a terminal — checked
    // here so the operator hears it as a refusal of the REFUND rather than as a failure
    // half-way through one.
    if (
      !authorization.permissions.includes(TERMINAL_REFUND_PERMISSION) &&
      !authorization.permissions.includes('*')
    ) {
      throw new ConflictException({
        code: 'PERMISSION_REVOKED',
        details: { permission: TERMINAL_REFUND_PERMISSION },
      });
    }

    const confirmed: Array<{ tenderId: string; attemptId: string }> = [];
    for (const target of targets) {
      const outcome = await this.tender.refund(user, merchantId, target.attemptId, {
        locationId: dto.locationId,
        operatorSessionId: dto.operatorSessionId,
        attemptId: target.attemptId,
        commandIdentity: derivedUuid('pos-exception-refund', dto.previewId, target.tenderId),
        amount: { minorUnits: target.tenderAmountMinorUnits, currency: target.currency },
        idempotencyKey: derivedUuid('pos-exception-refund-key', dto.previewId, target.tenderId),
      });
      if (outcome.outcome.kind !== 'succeeded') {
        // The money did NOT move — or we cannot say that it did, which is the same thing for
        // a sale's books. The vendor's own code travels with the refusal; an unanswered
        // question is `PAYMENT_OUTCOME_UNKNOWN`, which the till already knows how to show.
        throw new ConflictException({
          code:
            outcome.outcome.kind === 'declined'
              ? 'TERMINAL_REFUND_REFUSED'
              : 'PAYMENT_OUTCOME_UNKNOWN',
          details: {
            tenderId: target.tenderId,
            attemptId: target.attemptId,
            provider: target.provider,
            providerCode: outcome.outcome.code,
            refundAttemptId: outcome.refundAttempt.id,
          },
        });
      }
      confirmed.push({ tenderId: target.tenderId, attemptId: outcome.refundAttempt.id });
    }
    return confirmed;
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
