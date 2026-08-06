import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  CreateCustomerRequest,
  CustomerMergeRequest,
  CustomerSearchRequest,
  CustomerValuePreviewRequest,
  CustomerValueRecoveryQuery,
  GiftCardActivation,
  GiftCardLookupRequest,
  RewardAuthorizationRequest,
  StoredValueAuthorizationRequest,
  ValueReleaseRequest,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import type { CommandResult, TransactionContext } from '../integrity/integrity.types';
import { customerValueConflictCode } from './customer-value-errors';
import { PosCustomerValueRepository } from './pos-customer-value.repository';

@Injectable()
export class PosCustomerValueService {
  constructor(
    private readonly repo: PosCustomerValueRepository,
    private readonly integrity: IntegrityService,
  ) {}

  async search(user: AuthUser, merchantId: string, query: CustomerSearchRequest) {
    const authorization = await this.authorize(user, merchantId, query, 'customer.search');
    return this.repo.search(user.id, merchantId, query, authorization);
  }

  async create(user: AuthUser, merchantId: string, dto: CreateCustomerRequest) {
    const authorization = await this.authorize(user, merchantId, dto, 'customer.create');
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType: 'pos.customer.create',
          payload: dto,
          expectedVersion: dto.expectedVersion ?? undefined,
        },
        async (context) => {
          const customer = await this.repo.create(context.client, merchantId, dto, authorization);
          await context.appendAudit({
            eventType: 'customer.created',
            entityType: 'customer',
            entityId: customer.id,
            outcome: 'success',
            publicData: { customerReference: customer.publicReference },
          });
          return { ok: true, value: customer };
        },
      ),
    );
  }

  async history(
    user: AuthUser,
    merchantId: string,
    customerId: string,
    query: CustomerSearchRequest,
  ) {
    await this.authorize(user, merchantId, query, 'customer.history.read');
    return this.repo.history(user.id, merchantId, customerId, query);
  }

  async preview(user: AuthUser, merchantId: string, dto: CustomerValuePreviewRequest) {
    await this.authorize(user, merchantId, dto, 'loyalty.read');
    return this.repo.preview(user.id, merchantId, dto);
  }

  async authorizeReward(user: AuthUser, merchantId: string, dto: RewardAuthorizationRequest) {
    const authorization = await this.authorize(user, merchantId, dto, 'loyalty.reward.authorize');
    return this.mutation(user, merchantId, dto, 'pos.reward.authorize', (context) =>
      this.repo.authorizeReward(
        context.client,
        merchantId,
        dto,
        authorization,
        context.correlationId,
      ),
    );
  }

  async releaseReward(user: AuthUser, merchantId: string, dto: ValueReleaseRequest) {
    if (dto.accountType !== 'loyalty_reward') {
      throw new ConflictException({ code: 'CUSTOMER_VALUE_ACCOUNT_TYPE_INVALID' });
    }
    const authorization = await this.authorize(user, merchantId, dto, 'loyalty.reward.release');
    return this.mutation(user, merchantId, dto, 'pos.reward.release', (context) =>
      this.repo.release(context.client, merchantId, dto, 'reward', authorization),
    );
  }

  async authorizeStoredValue(
    user: AuthUser,
    merchantId: string,
    dto: StoredValueAuthorizationRequest,
  ) {
    const permission = dto.accountType === 'wallet' ? 'wallet.authorize' : 'gift_card.authorize';
    const authorization = await this.authorize(user, merchantId, dto, permission);
    return this.mutation(user, merchantId, dto, 'pos.stored-value.authorize', (context) =>
      this.repo.authorizeStoredValue(
        context.client,
        merchantId,
        dto,
        authorization,
        context.correlationId,
      ),
    );
  }

  async releaseStoredValue(user: AuthUser, merchantId: string, dto: ValueReleaseRequest) {
    if (dto.accountType === 'loyalty_reward') {
      throw new ConflictException({ code: 'CUSTOMER_VALUE_ACCOUNT_TYPE_INVALID' });
    }
    const permission = dto.accountType === 'wallet' ? 'wallet.release' : 'gift_card.release';
    const authorization = await this.authorize(user, merchantId, dto, permission);
    return this.mutation(user, merchantId, dto, 'pos.stored-value.release', (context) =>
      this.repo.release(context.client, merchantId, dto, 'stored_value', authorization),
    );
  }

  async giftCardLookup(user: AuthUser, merchantId: string, dto: GiftCardLookupRequest) {
    await this.authorize(user, merchantId, dto, 'gift_card.lookup');
    return this.repo.giftCardLookup(user.id, merchantId, dto);
  }

  async activateGiftCard(user: AuthUser, merchantId: string, dto: GiftCardActivation) {
    const authorization = await this.authorize(user, merchantId, dto, 'gift_card.activate');
    if (!dto.approvalId || !dto.approvalFingerprint) {
      throw new ConflictException({
        code: 'APPROVAL_REQUIRED',
        fieldErrors: { approvalPermission: ['gift_card.activate.approve'] },
      });
    }
    return this.mutation(user, merchantId, dto, 'pos.gift-card.activate', (context) =>
      this.repo.activateGiftCard(context.client, merchantId, dto, authorization),
    );
  }

  async merge(user: AuthUser, merchantId: string, dto: CustomerMergeRequest) {
    const authorization = await this.authorize(user, merchantId, dto, 'customer.merge');
    if (!dto.approvalId || !dto.approvalFingerprint) {
      throw new ConflictException({
        code: 'APPROVAL_REQUIRED',
        fieldErrors: { approvalPermission: ['customer.merge.approve'] },
      });
    }
    return this.mutation(user, merchantId, dto, 'pos.customer.merge', (context) =>
      this.repo.merge(context.client, merchantId, dto, authorization),
    );
  }

  async command(
    user: AuthUser,
    merchantId: string,
    commandId: string,
    query: CustomerValueRecoveryQuery,
  ) {
    await this.authorize(user, merchantId, query, 'customer.read');
    return this.repo.command(user.id, merchantId, commandId, query);
  }

  private mutation<
    T extends { locationId: string; commandId: string; idempotencyKey: string },
    TResult,
  >(
    _user: AuthUser,
    merchantId: string,
    dto: T,
    commandType: string,
    operation: (context: TransactionContext) => Promise<TResult>,
  ) {
    return this.unwrap(
      this.integrity.execute(
        {
          merchantId,
          locationId: dto.locationId,
          commandId: dto.commandId,
          idempotencyKey: dto.idempotencyKey,
          commandType,
          payload: dto,
        },
        async (context) => {
          const value = await operation(context);
          await context.appendAudit({
            eventType: `${commandType}.committed`,
            entityType: 'customer_value',
            entityId: dto.commandId,
            outcome: 'success',
          });
          return { ok: true, value };
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

  private async unwrap<T>(promise: Promise<CommandResult<T>>): Promise<T> {
    let result: CommandResult<T>;
    try {
      result = await promise;
    } catch (error) {
      const code = customerValueConflictCode(error);
      if (code) throw new ConflictException({ code });
      throw error;
    }
    if (result.status === 'succeeded' && result.result !== null) return result.result;
    throw new ConflictException({
      code: result.failureCode ?? 'CUSTOMER_VALUE_COMMAND_FAILED',
      correlationId: result.correlationId,
    });
  }
}
