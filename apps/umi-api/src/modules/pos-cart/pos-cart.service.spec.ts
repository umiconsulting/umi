import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PosCartService } from './pos-cart.service';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'operator@example.test',
  sessionId: '00000000-0000-4000-8000-000000000002',
  deviceId: '00000000-0000-4000-8000-000000000003',
};
const dto = {
  locationId: '00000000-0000-4000-8000-000000000004',
  operatorSessionId: '00000000-0000-4000-8000-000000000005',
  idempotencyKey: '00000000-0000-4000-8000-000000000006',
};

function harness() {
  const repo = {
    authorize: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue('00000000-0000-4000-8000-000000000007'),
    bindOrigin: vi.fn().mockResolvedValue(true),
    fire: vi.fn().mockResolvedValue({
      state: 'fired',
      orderId: '00000000-0000-4000-8000-000000000008',
      reference: 'pos-cart:00000000-0000-4000-8000-000000000007',
      lineCount: 2,
      cartVersion: 2,
    }),
    listIncomingOrders: vi.fn().mockResolvedValue([]),
    snapshotWithClient: vi.fn().mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000007',
      items: [],
      version: 1,
    }),
  };
  const integrity = {
    execute: vi.fn(async (_command, operation) => {
      const result = await operation({
        client: {},
        appendAudit: vi.fn().mockResolvedValue(undefined),
      });
      return result.ok
        ? { status: 'succeeded', result: result.value }
        : { status: 'failed', failureCode: result.code };
    }),
  };
  return {
    service: new PosCartService(repo as never, integrity as never),
    repo,
    integrity,
  };
}

describe('PosCartService', () => {
  it('requires a trusted device before creating a cart', async () => {
    const { service } = harness();
    await expect(service.create({ ...user, deviceId: null }, user.id, dto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('runs cart creation through canonical idempotency and audit', async () => {
    const { service, repo, integrity } = harness();
    const result = await service.create(user, user.id, dto);
    expect(result.version).toBe(1);
    expect(repo.authorize).toHaveBeenCalledWith(
      user.id,
      user.sessionId,
      user.deviceId,
      user.id,
      dto.locationId,
      dto.operatorSessionId,
      // The permission the session must hold. Every cart action asks for `cart.write`;
      // `fire` asks for `order.fire` instead, which is the point of the parameter.
      'cart.write',
    );
    expect(integrity.execute).toHaveBeenCalledOnce();
  });

  it('fails closed when authorization does not grant cart.write', async () => {
    const { service, repo } = harness();
    repo.authorize.mockResolvedValue(false);
    await expect(service.create(user, user.id, dto)).rejects.toBeDefined();
  });

  it('maps a rejected mutation to a public cart conflict', async () => {
    const { service, integrity } = harness();
    integrity.execute.mockResolvedValue({
      status: 'failed',
      failureCode: 'CART_VALIDATION_FAILED',
    });
    await expect(service.create(user, user.id, dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('binds the active cart to an incoming order through idempotency and audit', async () => {
    const { service, repo, integrity } = harness();
    const result = await service.bindOrigin(user, user.id, {
      ...dto,
      cartId: '00000000-0000-4000-8000-000000000007',
      originOrderId: '00000000-0000-4000-8000-000000000008',
      expectedVersion: 1,
    });
    expect(result.version).toBe(1);
    expect(repo.bindOrigin).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      '00000000-0000-4000-8000-000000000007',
      1,
      dto.operatorSessionId,
      '00000000-0000-4000-8000-000000000008',
    );
    expect(integrity.execute).toHaveBeenCalledOnce();
  });

  it('lists incoming orders after authorizing the till', async () => {
    const { service, repo } = harness();
    repo.listIncomingOrders.mockResolvedValue([
      {
        orderId: '00000000-0000-4000-8000-000000000009',
        channel: 'whatsapp',
        status: 'placed',
        reference: 'wa-1',
        customerName: 'Ana',
        itemCount: 2,
        totalMinorUnits: 12000,
        placedAt: null,
      },
    ]);
    const result = await service.incomingOrders(
      user,
      user.id,
      dto.locationId,
      dto.operatorSessionId,
    );
    expect(result.orders).toHaveLength(1);
    expect(repo.authorize).toHaveBeenCalledWith(
      user.id,
      user.sessionId,
      user.deviceId,
      user.id,
      dto.locationId,
      dto.operatorSessionId,
      'cart.write',
    );
    expect(repo.listIncomingOrders).toHaveBeenCalledWith(user.id, dto.locationId, user.id);
  });

  it('refuses incoming orders without a trusted device', async () => {
    const { service } = harness();
    await expect(
      service.incomingOrders(
        { ...user, deviceId: null },
        user.id,
        dto.locationId,
        dto.operatorSessionId,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // The fired order asks for its OWN permission, not the cart's. That is the whole reason
  // `authorize` grew the parameter: a café that wants a waiter running orders to the kitchen
  // without letting them charge gives the role `order.fire` and not `cart.write`.
  it('authorizes firing with order.fire and not with cart.write', async () => {
    const { service, repo } = harness();
    await service.fire(user, user.id, {
      ...dto,
      cartId: '00000000-0000-4000-8000-000000000007',
      expectedVersion: 1,
    });
    expect(repo.authorize).toHaveBeenCalledWith(
      user.id,
      user.sessionId,
      user.deviceId,
      user.id,
      dto.locationId,
      dto.operatorSessionId,
      'order.fire',
    );
  });

  it('answers a fired order with the order the cart now owns', async () => {
    const { service } = harness();
    const fired = await service.fire(user, user.id, {
      ...dto,
      cartId: '00000000-0000-4000-8000-000000000007',
      expectedVersion: 1,
    });
    expect(fired.orderId).toBe('00000000-0000-4000-8000-000000000008');
    expect(fired.cartVersion).toBe(2);
    expect(fired.lineCount).toBe(2);
    expect(Number.isNaN(Date.parse(fired.firedAt))).toBe(false);
  });

  // A cart that moved, is empty, or is not in a state that may fire all answer the same
  // public code, because the operator's next move is the same in all three: reload.
  it('maps a refused fire to the public cart conflict', async () => {
    const { service, repo } = harness();
    repo.fire.mockResolvedValue({ state: 'rejected' });
    await expect(
      service.fire(user, user.id, {
        ...dto,
        cartId: '00000000-0000-4000-8000-000000000007',
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
