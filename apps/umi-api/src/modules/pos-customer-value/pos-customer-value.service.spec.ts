import { describe, expect, it, vi } from 'vitest';
import { PosCustomerValueService } from './pos-customer-value.service';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const user = { id: id(1), email: 'operator@example.test', sessionId: id(2), deviceId: id(3) };
const context = { locationId: id(4), operatorSessionId: id(5) };
const authorization = {
  operatorId: user.id,
  deviceId: user.deviceId,
  durableSessionId: user.sessionId,
  credentialVersion: 1,
  permissions: ['customer.search', 'customer.create', 'loyalty.reward.authorize'],
};

describe('Gate 3F customer and value application boundary', () => {
  it('requires a trusted device', async () => {
    const service = new PosCustomerValueService({ authorize: vi.fn() } as never, {} as never);
    await expect(
      service.search({ ...user, deviceId: null }, id(6), {
        ...context,
        query: '',
        limit: 20,
        recent: true,
      }),
    ).rejects.toMatchObject({ response: { code: 'DEVICE_NOT_ENROLLED' } });
  });

  it('uses effective permission instead of a role name', async () => {
    const repo = { authorize: vi.fn().mockResolvedValue(null) };
    const service = new PosCustomerValueService(repo as never, {} as never);
    await expect(
      service.search({ ...user, role: 'owner' } as never, id(6), {
        ...context,
        query: '',
        limit: 20,
        recent: true,
      }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    expect(repo.authorize).toHaveBeenCalledWith(
      user.id,
      user.sessionId,
      id(6),
      context.locationId,
      context.operatorSessionId,
      user.deviceId,
      'customer.search',
    );
  });

  it('keeps customer creation inside command integrity', async () => {
    const customer = { id: id(7), publicReference: 'CUS-test' };
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      create: vi.fn().mockResolvedValue(customer),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          appendAudit: vi.fn(),
          correlationId: 'test',
        });
        return { status: 'succeeded', result: outcome.value, failureCode: null };
      }),
    };
    const service = new PosCustomerValueService(repo as never, integrity as never);
    const dto = {
      ...context,
      commandId: id(8),
      idempotencyKey: id(9),
      expectedVersion: null,
      displayName: 'Cliente',
      preferredLanguage: 'es' as const,
      contacts: [],
      consents: [],
    };
    await expect(service.create(user, id(6), dto)).resolves.toEqual(customer);
    expect(repo.create).toHaveBeenCalledOnce();
    expect(integrity.execute).toHaveBeenCalledOnce();
  });

  it('fails closed when the reward authorization is stale', async () => {
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      authorizeReward: vi.fn().mockRejectedValue(new Error('REWARD_AUTHORIZATION_EXPIRED')),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) =>
        operation({ client: {}, appendAudit: vi.fn(), correlationId: 'test' }),
      ),
    };
    const service = new PosCustomerValueService(repo as never, integrity as never);
    await expect(
      service.authorizeReward(user, id(6), {
        ...context,
        commandId: id(8),
        idempotencyKey: id(9),
        expectedVersion: null,
        saleId: id(10),
        checkoutVersion: 1,
        customerId: id(11),
        rewardId: id(12),
        previewFingerprint: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ response: { code: 'REWARD_AUTHORIZATION_EXPIRED' } });
  });

  it('requires exact approval for gift-card activation', async () => {
    const repo = { authorize: vi.fn().mockResolvedValue(authorization) };
    const service = new PosCustomerValueService(repo as never, {} as never);
    await expect(
      service.activateGiftCard(user, id(6), {
        ...context,
        commandId: id(8),
        idempotencyKey: id(9),
        expectedVersion: null,
        giftCardId: id(10),
        initialValue: { minorUnits: 1_000, currency: 'MXN' },
        approvalId: null,
        approvalFingerprint: null,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'APPROVAL_REQUIRED',
        fieldErrors: { approvalPermission: ['gift_card.activate.approve'] },
      },
    });
  });
});
