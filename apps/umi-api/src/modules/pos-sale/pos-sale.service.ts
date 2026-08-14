import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  AttachSaleCustomerRequest,
  CancelSaleRequest,
  PosCustomerSearchQuery,
  RenameSuspendedSaleRequest,
  ResumeSaleRequest,
  SaleContextRequest,
  SaleHistoryQuery,
  SaleMutationRequest,
  SaleSnapshot,
  SuspendSaleRequest,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import { PosSaleRepository } from './pos-sale.repository';

@Injectable()
export class PosSaleService {
  constructor(
    private readonly repo: PosSaleRepository,
    private readonly integrity: IntegrityService,
  ) {}

  async start(user: AuthUser, merchantId: string, dto: SaleContextRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(merchantId, dto, 'sale.started', (client) =>
      this.repo.start(client, merchantId, dto.locationId, dto.operatorSessionId),
    );
  }

  async current(user: AuthUser, merchantId: string, query: SaleHistoryQuery) {
    await this.authorize(user, merchantId, query.locationId, query.operatorSessionId);
    const sale = await this.repo.current(merchantId, query.locationId, query.operatorSessionId);
    if (!sale) throw new NotFoundException({ code: 'SALE_NOT_FOUND' });
    return sale;
  }

  async history(user: AuthUser, merchantId: string, query: SaleHistoryQuery) {
    await this.authorize(user, merchantId, query.locationId, query.operatorSessionId);
    const cursor = query.cursor ? this.decodeHistoryCursor(query.cursor) : null;
    const page = await this.repo.history(merchantId, query, cursor);
    return {
      items: page.items,
      nextCursor: page.nextKey
        ? this.encodeHistoryCursor(page.nextKey.updatedAt, page.nextKey.id)
        : null,
    };
  }

  async suspend(user: AuthUser, merchantId: string, saleId: string, dto: SuspendSaleRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto,
      'sale.suspended',
      (client) =>
        this.repo.suspend(
          client,
          merchantId,
          saleId,
          dto.expectedVersion,
          dto.label,
          dto.operatorSessionId,
        ),
      saleId,
    );
  }

  async resume(user: AuthUser, merchantId: string, saleId: string, dto: ResumeSaleRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto,
      'sale.resumed',
      (client) =>
        this.repo.resume(client, merchantId, saleId, dto.expectedVersion, dto.operatorSessionId),
      saleId,
    );
  }

  async rename(
    user: AuthUser,
    merchantId: string,
    saleId: string,
    dto: RenameSuspendedSaleRequest,
  ) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto,
      'sale.suspended_renamed',
      (client) =>
        this.repo.rename(
          client,
          merchantId,
          saleId,
          dto.expectedVersion,
          dto.label,
          dto.operatorSessionId,
        ),
      saleId,
    );
  }

  async cancel(user: AuthUser, merchantId: string, saleId: string, dto: CancelSaleRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto,
      'sale.cancelled',
      (client) =>
        this.repo.cancel(
          client,
          merchantId,
          saleId,
          dto.expectedVersion,
          dto.reason,
          dto.operatorSessionId,
        ),
      saleId,
    );
  }

  async attachCustomer(
    user: AuthUser,
    merchantId: string,
    saleId: string,
    dto: AttachSaleCustomerRequest,
  ) {
    await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'customer.attach',
    );
    return this.command(
      merchantId,
      dto,
      'sale.customer_attached',
      (client) =>
        this.repo.attachCustomer(
          client,
          merchantId,
          saleId,
          dto.expectedVersion,
          dto.customerId,
          dto.operatorSessionId,
        ),
      saleId,
    );
  }

  async detachCustomer(
    user: AuthUser,
    merchantId: string,
    saleId: string,
    dto: SaleMutationRequest,
  ) {
    await this.authorize(
      user,
      merchantId,
      dto.locationId,
      dto.operatorSessionId,
      'customer.detach',
    );
    return this.command(
      merchantId,
      dto,
      'sale.customer_detached',
      (client) =>
        this.repo.attachCustomer(
          client,
          merchantId,
          saleId,
          dto.expectedVersion,
          null,
          dto.operatorSessionId,
        ),
      saleId,
    );
  }

  async customers(user: AuthUser, merchantId: string, query: PosCustomerSearchQuery) {
    await this.authorize(
      user,
      merchantId,
      query.locationId,
      query.operatorSessionId,
      'customer.search',
    );
    return this.repo.customers(merchantId, query);
  }

  async receipt(user: AuthUser, merchantId: string, saleId: string, query: SaleHistoryQuery) {
    await this.authorize(user, merchantId, query.locationId, query.operatorSessionId);
    const receipt = await this.repo.receipt(merchantId, query.locationId, saleId);
    if (!receipt) throw new NotFoundException({ code: 'RECEIPT_NOT_FOUND' });
    return receipt;
  }

  private async command(
    merchantId: string,
    dto: SaleContextRequest,
    eventType: string,
    operation: (
      client: Parameters<Parameters<IntegrityService['execute']>[1]>[0]['client'],
    ) => Promise<SaleSnapshot | null>,
    saleId?: string,
  ): Promise<SaleSnapshot> {
    const result = await this.integrity.execute<SaleSnapshot>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: eventType,
        payload: saleId ? { ...dto, saleId } : dto,
      },
      async (context) => {
        const sale = await operation(context.client);
        if (!sale) {
          return {
            ok: false,
            code: 'SALE_STATE_CONFLICT',
            failureClass: 'conflict',
            retryable: false,
          };
        }
        await context.appendAudit({
          eventType,
          entityType: 'pos_sale_lifecycle',
          entityId: sale.id,
          outcome: 'success',
          publicData: {
            state: sale.state,
            version: sale.cart.version,
            ...(eventType === 'sale.cancelled'
              ? { cancellationReason: sale.cancellationReason }
              : {}),
          },
        });
        return { ok: true, value: sale };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({
        code: result.failureCode ?? 'SALE_STATE_CONFLICT',
      });
    }
    return result.result;
  }

  private encodeHistoryCursor(updatedAt: string, id: string): string {
    return Buffer.from(JSON.stringify({ updatedAt, id })).toString('base64url');
  }

  private decodeHistoryCursor(cursor: string): { updatedAt: string; id: string } {
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
      if (
        !value ||
        typeof value !== 'object' ||
        !('updatedAt' in value) ||
        !('id' in value) ||
        typeof value.updatedAt !== 'string' ||
        typeof value.id !== 'string' ||
        Number.isNaN(Date.parse(value.updatedAt)) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
      ) {
        throw new Error('invalid');
      }
      return { updatedAt: value.updatedAt, id: value.id };
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    }
  }

  private async authorize(
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    permission = 'sale.lifecycle',
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const allowed = await this.repo.authorize(
      user.id,
      user.sessionId,
      user.deviceId,
      merchantId,
      locationId,
      operatorSessionId,
      permission,
    );
    if (!allowed) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
  }
}
