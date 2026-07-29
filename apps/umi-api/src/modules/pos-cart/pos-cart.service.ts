import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  Cart,
  CartLineInput,
  ClearCartRequest,
  CreateCartRequest,
  PrepareSaleRequest,
  RemoveCartLineRequest,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCartRepository } from './pos-cart.repository';

@Injectable()
export class PosCartService {
  constructor(
    private readonly repo: PosCartRepository,
    private readonly integrity: IntegrityService,
  ) {}

  async create(user: AuthUser, tenantId: string, dto: CreateCartRequest) {
    await this.authorize(user, tenantId, dto.branchId, dto.operatorSessionId);
    return this.command(
      tenantId,
      dto.branchId,
      dto.idempotencyKey,
      'cart.create',
      dto,
      async (client) => {
        const id = await this.repo.create(client, tenantId, dto.branchId, dto.operatorSessionId);
        return this.repo.snapshotWithClient(client, tenantId, id);
      },
    );
  }

  async read(user: AuthUser, tenantId: string, branchId: string, operatorSessionId: string) {
    await this.authorize(user, tenantId, branchId, operatorSessionId);
    const id = await this.repo.activeCartId(tenantId, branchId, operatorSessionId);
    if (!id) throw new NotFoundException({ code: 'CART_NOT_FOUND' });
    const cart = await this.repo.snapshot(tenantId, branchId, id);
    if (!cart) throw new NotFoundException({ code: 'CART_NOT_FOUND' });
    return cart;
  }

  async add(user: AuthUser, tenantId: string, dto: CartLineInput) {
    await this.authorize(user, tenantId, dto.branchId, dto.operatorSessionId);
    return this.command(
      tenantId,
      dto.branchId,
      dto.idempotencyKey,
      'cart.line.add',
      dto,
      async (client) => {
        const priced = await this.repo.price(client, tenantId, dto.branchId, dto);
        if (!priced) return null;
        const changed = await this.repo.addOrMerge(
          client,
          tenantId,
          dto.cartId,
          dto.expectedVersion,
          this.identity(dto),
          dto,
          priced,
        );
        return changed ? this.repo.snapshotWithClient(client, tenantId, dto.cartId) : null;
      },
    );
  }

  async update(user: AuthUser, tenantId: string, lineId: string, dto: CartLineInput) {
    await this.authorize(user, tenantId, dto.branchId, dto.operatorSessionId);
    return this.command(
      tenantId,
      dto.branchId,
      dto.idempotencyKey,
      'cart.line.update',
      { lineId, ...dto },
      async (client) => {
        const priced = await this.repo.price(client, tenantId, dto.branchId, dto);
        if (!priced) return null;
        const changed = await this.repo.replace(
          client,
          tenantId,
          dto.cartId,
          lineId,
          dto.expectedVersion,
          this.identity(dto),
          dto,
          priced,
        );
        return changed ? this.repo.snapshotWithClient(client, tenantId, dto.cartId) : null;
      },
    );
  }

  async remove(user: AuthUser, tenantId: string, lineId: string, dto: RemoveCartLineRequest) {
    await this.authorize(user, tenantId, dto.branchId, dto.operatorSessionId);
    return this.command(
      tenantId,
      dto.branchId,
      dto.idempotencyKey,
      'cart.line.remove',
      { lineId, ...dto },
      async (client) => {
        const changed = await this.repo.remove(
          client,
          tenantId,
          dto.cartId,
          lineId,
          dto.expectedVersion,
          dto.operatorSessionId,
        );
        return changed ? this.repo.snapshotWithClient(client, tenantId, dto.cartId) : null;
      },
    );
  }

  async prepare(user: AuthUser, tenantId: string, dto: PrepareSaleRequest) {
    await this.authorize(user, tenantId, dto.branchId, dto.operatorSessionId);
    return this.command(
      tenantId,
      dto.branchId,
      dto.idempotencyKey,
      'cart.prepare',
      dto,
      async (client) => {
        const changed = await this.repo.prepare(
          client,
          tenantId,
          dto.cartId,
          dto.expectedVersion,
          dto.operatorSessionId,
        );
        return changed ? this.repo.snapshotWithClient(client, tenantId, dto.cartId) : null;
      },
    );
  }

  async clear(user: AuthUser, tenantId: string, dto: ClearCartRequest) {
    await this.authorize(user, tenantId, dto.branchId, dto.operatorSessionId);
    return this.command(
      tenantId,
      dto.branchId,
      dto.idempotencyKey,
      'cart.cleared',
      dto,
      async (client) => {
        const changed = await this.repo.clear(
          client,
          tenantId,
          dto.cartId,
          dto.expectedVersion,
          dto.operatorSessionId,
        );
        return changed ? this.repo.snapshotWithClient(client, tenantId, dto.cartId) : null;
      },
    );
  }

  private async command(
    tenantId: string,
    branchId: string,
    idempotencyKey: string,
    commandType: string,
    payload: unknown,
    operation: (
      client: Parameters<Parameters<IntegrityService['execute']>[1]>[0]['client'],
    ) => Promise<Cart | null>,
  ): Promise<Cart> {
    const result = await this.integrity.execute<Cart>(
      {
        tenantId,
        branchId,
        commandId: randomUUID(),
        idempotencyKey,
        commandType,
        payload,
      },
      async (context) => {
        const cart = await operation(context.client);
        if (!cart) {
          return {
            ok: false,
            code: 'CART_VALIDATION_FAILED',
            failureClass: 'conflict',
            retryable: false,
          };
        }
        await context.appendAudit({
          eventType: commandType,
          entityType: 'pos_cart',
          entityId: cart.id,
          outcome: 'success',
          publicData: { version: cart.version, itemCount: cart.items.length },
        });
        return { ok: true, value: cart };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({
        code: result.failureCode ?? 'CART_VALIDATION_FAILED',
      });
    }
    return result.result;
  }

  private async authorize(
    user: AuthUser,
    tenantId: string,
    branchId: string,
    operatorSessionId: string,
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    if (
      !(await this.repo.authorize(
        user.id,
        user.sessionId,
        user.deviceId,
        tenantId,
        branchId,
        operatorSessionId,
      ))
    ) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
  }

  private identity(dto: CartLineInput): string {
    const modifiers = [...dto.modifierSelections].sort((a, b) =>
      a.modifierId.localeCompare(b.modifierId),
    );
    return createHash('sha256')
      .update(
        JSON.stringify({
          productId: dto.productId,
          variantId: dto.variantId,
          modifiers,
          note: dto.note?.trim() || null,
        }),
      )
      .digest('hex');
  }
}
