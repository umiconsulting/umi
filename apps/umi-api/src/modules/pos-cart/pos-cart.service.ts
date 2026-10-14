import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  BindCartOriginRequest,
  Cart,
  SetCartAccountDetailsRequest,
  AssignCartTableRequest,
  OpenTableAccountRequest,
  ResumeCartAccountRequest,
  SuspendCartRequest,
  RemoveSentCartLineRequest,
  CartLineInput,
  ClearCartRequest,
  CreateCartRequest,
  FireOrderRequest,
  FireOrderResult,
  PosIncomingOrders,
  PrepareSaleRequest,
  RemoveCartLineRequest,
  SetCartFulfillmentRequest,
} from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCartRepository } from './pos-cart.repository';

@Injectable()
export class PosCartService {
  private readonly logger = new Logger(PosCartService.name);

  constructor(
    private readonly repo: PosCartRepository,
    private readonly integrity: IntegrityService,
  ) {}

  async create(user: AuthUser, merchantId: string, dto: CreateCartRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.create',
      dto,
      async (client) => {
        const id = await this.repo.create(
          client,
          merchantId,
          dto.locationId,
          dto.operatorSessionId,
        );
        return this.repo.snapshotWithClient(client, merchantId, id);
      },
    );
  }

  async read(user: AuthUser, merchantId: string, locationId: string, operatorSessionId: string) {
    await this.authorize(user, merchantId, locationId, operatorSessionId);
    const id = await this.repo.activeCartId(merchantId, locationId, operatorSessionId);
    if (!id) throw new NotFoundException({ code: 'CART_NOT_FOUND' });
    const cart = await this.repo.snapshot(merchantId, locationId, id);
    if (!cart) throw new NotFoundException({ code: 'CART_NOT_FOUND' });
    return cart;
  }

  async listAccounts(
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ) {
    await this.authorize(user, merchantId, locationId, operatorSessionId);
    // The day close runs here, on the read that looks at the accounts, because this is
    // the moment the question is being asked. It never fails the read: a till that
    // cannot list its accounts answers nothing about the day close, and the operator is
    // left with a screen that looks like the database is down.
    try {
      const voided = await this.repo.sweepCarriedOverAccounts(merchantId, locationId);
      if (voided > 0) {
        this.logger.warn(`day close voided ${voided} carried-over account(s) in ${locationId}`);
      }
    } catch (error) {
      this.logger.error(
        `day close sweep failed for ${merchantId}/${locationId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const ids = await this.repo.openAccountIds(merchantId, locationId);
    const accounts = await Promise.all(
      ids.map((id) => this.repo.readAccount(merchantId, locationId, id)),
    );
    return { accounts: accounts.filter((cart): cart is Cart => cart !== null) };
  }

  async readAccount(
    user: AuthUser,
    merchantId: string,
    cartId: string,
    locationId: string,
    operatorSessionId: string,
  ) {
    await this.authorize(user, merchantId, locationId, operatorSessionId);
    const cart = await this.repo.readAccount(merchantId, locationId, cartId);
    if (!cart) throw new NotFoundException({ code: 'CART_NOT_FOUND' });
    return cart;
  }

  async openTable(user: AuthUser, merchantId: string, dto: OpenTableAccountRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.table.open',
      dto,
      (client) =>
        this.repo.openTable(
          client,
          merchantId,
          dto.locationId,
          dto.operatorSessionId,
          dto.tableId,
          dto.expectedVersion,
        ),
    );
  }

  async resumeAccount(
    user: AuthUser,
    merchantId: string,
    cartId: string,
    dto: ResumeCartAccountRequest,
  ) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.account.resume',
      { cartId, ...dto },
      (client) =>
        this.repo.claimAccount(
          client,
          merchantId,
          dto.locationId,
          dto.operatorSessionId,
          cartId,
          dto.expectedVersion,
        ),
    );
  }

  async setAccountDetails(
    user: AuthUser,
    merchantId: string,
    cartId: string,
    dto: SetCartAccountDetailsRequest,
  ) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.account.details',
      { cartId, ...dto },
      (client) => this.repo.setAccountDetails(client, merchantId, cartId, dto),
    );
  }
  async assignAccountTable(
    user: AuthUser,
    merchantId: string,
    cartId: string,
    dto: AssignCartTableRequest,
  ) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    // This repository acquires the table lock before the cart lock.
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.account.assign-table',
      { accountId: cartId, ...dto },
      (client) => this.repo.assignAccountTable(client, merchantId, cartId, dto),
    );
  }

  async suspendAccount(user: AuthUser, merchantId: string, dto: SuspendCartRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.suspended',
      dto,
      (client) => this.repo.suspendAccount(client, merchantId, dto),
    );
  }

  async removeSent(
    user: AuthUser,
    merchantId: string,
    lineId: string,
    dto: RemoveSentCartLineRequest,
  ) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId, 'order.fire');
    // A cancel the kitchen has not reached is the operator's own act and arrives with no
    // elevation; one that arrives WITH an elevation is the admin-authorized path. The
    // elevation is not checked here: the repository consumes it against the fingerprint in
    // the command's transaction, which is the only place it can be spent exactly once. A
    // request that names a grant and no binding is simply a fingerprint that does not
    // match, and the repository answers `APPROVAL_FINGERPRINT_MISMATCH` — a code the
    // contract already publishes, so the till has a sentence for it.
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.line.cancel-sent',
      { lineId, ...dto },
      (client, commandId) => this.repo.removeSent(client, merchantId, lineId, dto, commandId),
    );
  }

  async add(user: AuthUser, merchantId: string, dto: CartLineInput) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.line.add',
      dto,
      async (client) => {
        const priced = await this.repo.price(client, merchantId, dto.locationId, dto);
        if (!priced) return null;
        const changed = await this.repo.addOrMerge(
          client,
          merchantId,
          dto.cartId,
          dto.expectedVersion,
          this.identity(dto),
          dto,
          priced,
        );
        return changed ? this.repo.snapshotWithClient(client, merchantId, dto.cartId) : null;
      },
    );
  }

  async update(user: AuthUser, merchantId: string, lineId: string, dto: CartLineInput) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.line.update',
      { lineId, ...dto },
      async (client) => {
        const priced = await this.repo.price(client, merchantId, dto.locationId, dto);
        if (!priced) return null;
        const changed = await this.repo.replace(
          client,
          merchantId,
          dto.cartId,
          lineId,
          dto.expectedVersion,
          this.identity(dto),
          dto,
          priced,
        );
        return changed ? this.repo.snapshotWithClient(client, merchantId, dto.cartId) : null;
      },
    );
  }

  async remove(user: AuthUser, merchantId: string, lineId: string, dto: RemoveCartLineRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.line.remove',
      { lineId, ...dto },
      async (client) => {
        const changed = await this.repo.remove(
          client,
          merchantId,
          dto.cartId,
          lineId,
          dto.expectedVersion,
          dto.operatorSessionId,
        );
        return changed ? this.repo.snapshotWithClient(client, merchantId, dto.cartId) : null;
      },
    );
  }

  async prepare(user: AuthUser, merchantId: string, dto: PrepareSaleRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.prepare',
      dto,
      async (client) => {
        const changed = await this.repo.prepare(
          client,
          merchantId,
          dto.cartId,
          dto.expectedVersion,
          dto.operatorSessionId,
        );
        return changed ? this.repo.snapshotWithClient(client, merchantId, dto.cartId) : null;
      },
    );
  }

  async clear(user: AuthUser, merchantId: string, dto: ClearCartRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.cleared',
      dto,
      async (client) => {
        const changed = await this.repo.clear(
          client,
          merchantId,
          dto.cartId,
          dto.expectedVersion,
          dto.operatorSessionId,
        );
        return changed ? this.repo.snapshotWithClient(client, merchantId, dto.cartId) : null;
      },
    );
  }

  // Bind the active cart to the incoming order it settles (channel wedge, ADR 2026-09-13).
  // Runs through the same idempotency + audit path as every other cart mutation.
  async bindOrigin(user: AuthUser, merchantId: string, dto: BindCartOriginRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.origin.bind',
      dto,
      async (client) => {
        const changed = await this.repo.bindOrigin(
          client,
          merchantId,
          dto.cartId,
          dto.expectedVersion,
          dto.operatorSessionId,
          dto.originOrderId,
        );
        return changed ? this.repo.snapshotWithClient(client, merchantId, dto.cartId) : null;
      },
    );
  }

  // The order type (plan §8.2 F3, decision D5). Data of the order, so it rides the
  // same idempotency + audit path as the other cart facts the operator sets.
  async setFulfillment(user: AuthUser, merchantId: string, dto: SetCartFulfillmentRequest) {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId);
    return this.command(
      merchantId,
      dto.locationId,
      dto.idempotencyKey,
      'cart.fulfillment.set',
      dto,
      async (client) => {
        const changed = await this.repo.setFulfillment(
          client,
          merchantId,
          dto.cartId,
          dto.expectedVersion,
          dto.operatorSessionId,
          dto.fulfillmentType,
        );
        return changed ? this.repo.snapshotWithClient(client, merchantId, dto.cartId) : null;
      },
    );
  }

  /**
   * Send the cart to the kitchen before the money — the fired order of
   * `docs/architecture/2026-10-07-pos-fired-order-adr.md`.
   *
   * Authorized by `order.fire` and NOT by `cart.write`. Building a cart and committing an
   * order are different acts, and a café that wants a waiter running orders to the kitchen
   * without letting them charge gives the role one and not the other.
   *
   * It does not go through `command()`, which is typed to return a Cart and audits one. The
   * operation here answers with an order reference, so the integrity envelope is written out
   * once instead of bending a helper every other caller depends on.
   */
  async fire(user: AuthUser, merchantId: string, dto: FireOrderRequest): Promise<FireOrderResult> {
    await this.authorize(user, merchantId, dto.locationId, dto.operatorSessionId, 'order.fire');
    const result = await this.integrity.execute<FireOrderResult>(
      {
        merchantId,
        locationId: dto.locationId,
        commandId: randomUUID(),
        idempotencyKey: dto.idempotencyKey,
        commandType: 'order.fire',
        payload: dto,
      },
      async (context) => {
        await this.repo.assertFinanciallyMutable(context.client, merchantId, dto.cartId);
        const cart = await this.repo.snapshotWithClient(context.client, merchantId, dto.cartId);
        if (!cart) {
          return {
            ok: false,
            code: 'RESOURCE_NOT_FOUND',
            failureClass: 'permanent',
            retryable: false,
          };
        }
        const fired = await this.repo.fire(
          context.client,
          merchantId,
          cart,
          dto.expectedVersion,
          dto.operatorSessionId,
        );
        if (fired.state === 'rejected') {
          // ONE code for "the cart moved, is empty, or is not in a state that may fire",
          // because the operator's next move is the same in all three: reload the cart.
          return {
            ok: false,
            code: 'CART_VALIDATION_FAILED',
            failureClass: 'conflict',
            retryable: false,
          };
        }
        await context.appendAudit({
          eventType: 'order.fire',
          entityType: 'pos_cart',
          entityId: cart.id,
          outcome: 'success',
          publicData: {
            orderId: fired.orderId,
            reference: fired.reference,
            lineCount: fired.lineCount,
            alreadyFired: fired.state === 'already_fired',
          },
        });
        return {
          ok: true,
          value: {
            cartId: cart.id,
            cartVersion: fired.cartVersion,
            orderId: fired.orderId,
            reference: fired.reference,
            lineCount: fired.lineCount,
            firedAt: new Date().toISOString(),
          },
        };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({ code: result.failureCode ?? 'CART_VALIDATION_FAILED' });
    }
    return result.result;
  }

  // The incoming commercial orders this till can pick up and fulfil. Read-only; authorized by
  // the same device + operator session as a cart write.
  async incomingOrders(
    user: AuthUser,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<PosIncomingOrders> {
    await this.authorize(user, merchantId, locationId, operatorSessionId);
    const orders = await this.repo.listIncomingOrders(merchantId, locationId, user.id);
    return { orders };
  }

  private async command(
    merchantId: string,
    locationId: string,
    idempotencyKey: string,
    commandType: string,
    payload: unknown,
    operation: (
      client: Parameters<Parameters<IntegrityService['execute']>[1]>[0]['client'],
      /**
       * The command this operation belongs to, for the operations whose writes hang off
       * an approval: an elevation is consumed BY a command, so the command's own id is
       * what the grant is spent against. Every other caller ignores it.
       */
      commandId: string,
    ) => Promise<Cart | null>,
  ): Promise<Cart> {
    const commandId = randomUUID();
    const result = await this.integrity.execute<Cart>(
      {
        merchantId,
        locationId,
        commandId,
        idempotencyKey,
        commandType,
        payload,
      },
      async (context) => {
        const cartId = (payload as { cartId?: unknown } | null)?.cartId;
        if (typeof cartId === 'string')
          await this.repo.assertFinanciallyMutable(context.client, merchantId, cartId);
        const cart = await operation(context.client, commandId);
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
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    /** `cart.write` unless the action needs its own primitive — see `fire`. */
    permission = 'cart.write',
  ) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    const access = await this.repo.authorize(
      user.id,
      user.sessionId,
      user.deviceId,
      merchantId,
      locationId,
      operatorSessionId,
      permission,
    );
    // TWO REFUSALS, NAMED DIFFERENTLY, because the operator's next move differs. A session
    // with no permissions at all is not live — expired, locked, ended by a role change, or
    // from another device — so signing in again is the fix, and 401 is what says that. A
    // live session that lacks the permission is a role gap, and 403 says so; re-entering
    // the PIN would change nothing, which is exactly the confusion that had the till
    // locking itself every time an operator switched.
    if (access.permissions.length === 0) {
      throw new UnauthorizedException({ code: 'AUTHENTICATION_REQUIRED' });
    }
    if (!access.allowed) {
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
