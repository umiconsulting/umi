import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PosSaleService } from './pos-sale.service';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'cashier@example.test',
  sessionId: '00000000-0000-4000-8000-000000000002',
  deviceId: '00000000-0000-4000-8000-000000000003',
};
const request = {
  locationId: '00000000-0000-4000-8000-000000000004',
  operatorSessionId: '00000000-0000-4000-8000-000000000005',
  idempotencyKey: '00000000-0000-4000-8000-000000000006',
};
const sale = {
  id: '00000000-0000-4000-8000-000000000007',
  state: 'building_cart',
  cart: { id: '00000000-0000-4000-8000-000000000007', version: 1 },
};

function harness() {
  const repo = {
    authorize: vi.fn().mockResolvedValue(true),
    start: vi.fn().mockResolvedValue(sale),
    current: vi.fn().mockResolvedValue(sale),
    suspend: vi.fn().mockResolvedValue({ ...sale, state: 'suspended' }),
    resume: vi.fn().mockResolvedValue({ ...sale, state: 'recovered' }),
    cancel: vi.fn().mockResolvedValue({ ...sale, state: 'cancelled' }),
    cancelCarriedOver: vi.fn().mockResolvedValue([
      {
        ...sale,
        state: 'cancelled',
        cancellationReasonCode: 'other',
        cancellationReason: 'Cierre manual',
      },
    ]),
    history: vi.fn().mockResolvedValue({ items: [sale], nextKey: null }),
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
    service: new PosSaleService(repo as never, integrity as never),
    repo,
    integrity,
  };
}

describe('PosSaleService', () => {
  it('lets an authorized order taker read the current account without sale management rights', async () => {
    const { service, repo, integrity } = harness();
    expect(
      await service.current(user, user.id, {
        locationId: request.locationId,
        operatorSessionId: request.operatorSessionId,
      } as never),
    ).toEqual(sale);
    expect(repo.authorize).toHaveBeenCalledWith(
      user.id,
      user.sessionId,
      user.deviceId,
      user.id,
      request.locationId,
      request.operatorSessionId,
      'cart.write',
    );
    expect(integrity.execute).not.toHaveBeenCalled();
  });

  it('starts one active sale through the idempotent command boundary', async () => {
    const { service, repo, integrity } = harness();
    const result = await service.start(user, user.id, request);
    expect(result.id).toBe(sale.id);
    expect(repo.start).toHaveBeenCalledOnce();
    expect(integrity.execute).toHaveBeenCalledOnce();
  });

  it('rejects a device without trusted identity', async () => {
    const { service } = harness();
    await expect(
      service.start({ ...user, deviceId: null }, user.id, request),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails a duplicate suspend when the state transition is no longer valid', async () => {
    const { service, repo } = harness();
    repo.suspend.mockResolvedValue(null);
    await expect(
      service.suspend(user, user.id, sale.id, {
        ...request,
        expectedVersion: 1,
        label: 'Mesa 4',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails a resume when another active sale prevents ownership transfer', async () => {
    const { service, repo } = harness();
    repo.resume.mockResolvedValue(null);
    await expect(
      service.resume(user, user.id, sale.id, {
        ...request,
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('records a bounded cancellation reason without a financial effect', async () => {
    const { service, repo, integrity } = harness();
    const result = await service.cancel(user, user.id, sale.id, {
      ...request,
      expectedVersion: 1,
      reasonCode: 'customer_changed',
      reason: 'El cliente cambió de opinión',
    });
    expect(result.state).toBe('cancelled');
    expect(repo.cancel).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      sale.id,
      1,
      'customer_changed',
      'El cliente cambió de opinión',
      request.operatorSessionId,
    );
    expect(integrity.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ saleId: sale.id }),
      }),
      expect.any(Function),
    );
  });

  it('cancels selected prior-day accounts through one audited command', async () => {
    const { service, repo, integrity } = harness();
    const result = await service.cancelCarriedOver(user, user.id, {
      ...request,
      accounts: [{ cartId: sale.id, expectedVersion: 1 }],
      reasonCode: 'other',
      reason: 'Cierre manual',
    });
    expect(result.cancelled).toHaveLength(1);
    expect(repo.authorize).toHaveBeenCalledWith(
      user.id,
      user.sessionId,
      user.deviceId,
      user.id,
      request.locationId,
      request.operatorSessionId,
      'sale.lifecycle',
    );
    expect(repo.authorize).toHaveBeenCalledWith(
      user.id,
      user.sessionId,
      user.deviceId,
      user.id,
      request.locationId,
      request.operatorSessionId,
      'sale.resume.any',
    );
    expect(repo.cancelCarriedOver).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      user.id,
      true,
      expect.objectContaining({ accounts: [{ cartId: sale.id, expectedVersion: 1 }] }),
    );
    expect(integrity.execute).toHaveBeenCalledWith(
      expect.objectContaining({ commandType: 'sale.carried_over_cancelled' }),
      expect.any(Function),
    );
  });

  it('uses a bounded cursor for deterministic sale history pages', async () => {
    const { service, repo } = harness();
    repo.history.mockResolvedValue({
      items: [sale],
      nextKey: {
        updatedAt: '2026-07-29T12:00:00.000Z',
        id: sale.id,
      },
    });
    const first = await service.history(user, user.id, {
      ...request,
      search: '',
      sort: 'newest',
      limit: 1,
    });
    expect(first.nextCursor).toEqual(expect.any(String));
    await service.history(user, user.id, {
      ...request,
      search: '',
      sort: 'newest',
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(repo.history).toHaveBeenLastCalledWith(user.id, expect.any(Object), {
      updatedAt: '2026-07-29T12:00:00.000Z',
      id: sale.id,
    });
    await expect(
      service.history(user, user.id, {
        ...request,
        search: '',
        sort: 'newest',
        limit: 1,
        cursor: 'invalid',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
