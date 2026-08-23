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
  permissions: [
    'customer.search',
    'customer.create',
    'loyalty.reward.authorize',
    'loyalty.adjust',
    'gift_card.issue',
  ],
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

  it('commits a points adjustment through command integrity', async () => {
    const result = { recovered: false, ledgerEntry: { id: id(20) } };
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      commitPointsAdjustment: vi.fn().mockResolvedValue(result),
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
    await expect(
      service.commitPointsAdjustment(user, id(6), {
        ...context,
        commandId: id(8),
        idempotencyKey: id(9),
        expectedVersion: null,
        customerId: id(10),
        accountId: id(11),
        direction: 'increase',
        points: 50,
        reason: 'customer_service_correction',
        note: null,
        approvalId: null,
        approvalFingerprint: null,
      }),
    ).resolves.toEqual(result);
    expect(repo.commitPointsAdjustment).toHaveBeenCalledOnce();
    expect(integrity.execute).toHaveBeenCalledOnce();
  });

  it('keeps one gift-card issuance command recoverable', async () => {
    const stored = { card: { id: id(20) }, deliveryExpiresAt: 'soon', recovered: false };
    const result = { ...stored, deliveryToken: 'protected-token' };
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      issueGiftCard: vi.fn().mockResolvedValue(stored),
      giftCardDeliveryToken: vi.fn().mockReturnValue('protected-token'),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          appendAudit: vi.fn(),
          correlationId: 'test',
        });
        return { status: 'succeeded', result: outcome.value, failureCode: null, duplicate: false };
      }),
    };
    const service = new PosCustomerValueService(repo as never, integrity as never);
    await expect(
      service.issueGiftCard(user, id(6), {
        ...context,
        commandId: id(8),
        idempotencyKey: id(9),
        expectedVersion: null,
        currency: 'MXN',
        initialValueMinorUnits: 1000,
        source: 'promotion',
        saleId: null,
        saleLineId: null,
        customerId: null,
        approvalId: id(21),
        approvalFingerprint: 'a'.repeat(64),
      }),
    ).resolves.toEqual(result);
    expect(integrity.execute).toHaveBeenCalledOnce();
  });

  it('never persists the one-time gift-card secret in command recovery', async () => {
    const secret = { maskedReference: 'GFT-••••1234', code: 'ONE-TIME', expiresAt: 'soon' };
    const repo = {
      authorize: vi.fn().mockResolvedValue(authorization),
      revealGiftCardSecret: vi.fn().mockResolvedValue(secret),
    };
    const integrity = { execute: vi.fn() };
    const service = new PosCustomerValueService(repo as never, integrity as never);
    await expect(
      service.revealGiftCardSecret(user, id(6), {
        ...context,
        commandId: id(8),
        idempotencyKey: id(9),
        expectedVersion: null,
        deliveryToken: 'protected-token',
      }),
    ).resolves.toEqual(secret);
    expect(integrity.execute).not.toHaveBeenCalled();
  });

  it('commits a Dashboard points adjustment through the same ledger command', async () => {
    const result = { recovered: false, ledgerEntry: { id: id(20) } };
    const repo = {
      administrativeAuthorization: vi.fn().mockReturnValue({
        operatorId: user.id,
        deviceId: null,
        dashboardSessionId: user.sessionId,
      }),
      commitPointsAdjustment: vi.fn().mockResolvedValue(result),
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
    await expect(
      service.commitPointsAdjustmentAdministrative(
        { ...user, deviceId: null },
        { merchantId: id(6), permissions: ['loyalty.adjust'] } as never,
        { commandRecordId: id(22) } as never,
        {
          ...context,
          commandId: id(8),
          idempotencyKey: id(9),
          expectedVersion: 1,
          customerId: id(10),
          accountId: id(11),
          direction: 'increase',
          points: 50,
          reason: 'customer_service_correction',
          note: null,
          approvalId: null,
          approvalFingerprint: null,
        },
      ),
    ).resolves.toEqual(result);
    expect(repo.commitPointsAdjustment).toHaveBeenCalledWith(
      {},
      id(6),
      expect.any(Object),
      expect.objectContaining({ deviceId: null, dashboardSessionId: user.sessionId }),
    );
  });

  it('issues a promotional gift card from Dashboard without POS impersonation', async () => {
    const stored = { card: { id: id(20) }, deliveryExpiresAt: 'soon', recovered: false };
    const repo = {
      administrativeAuthorization: vi.fn().mockReturnValue({
        operatorId: user.id,
        deviceId: null,
        dashboardSessionId: user.sessionId,
      }),
      issueGiftCard: vi.fn().mockResolvedValue(stored),
      giftCardDeliveryToken: vi.fn().mockReturnValue('protected-token'),
    };
    const integrity = {
      execute: vi.fn(async (_input, operation) => {
        const outcome = await operation({
          client: {},
          appendAudit: vi.fn(),
          correlationId: 'test',
        });
        return {
          status: 'succeeded',
          result: outcome.value,
          failureCode: null,
          duplicate: false,
        };
      }),
    };
    const service = new PosCustomerValueService(repo as never, integrity as never);
    await expect(
      service.issueGiftCardAdministrative(
        { ...user, deviceId: null },
        { merchantId: id(6), permissions: ['gift_card.issue'] } as never,
        { commandRecordId: id(22) } as never,
        {
          ...context,
          commandId: id(8),
          idempotencyKey: id(9),
          expectedVersion: null,
          currency: 'MXN',
          initialValueMinorUnits: 1000,
          source: 'promotion',
          saleId: null,
          saleLineId: null,
          customerId: null,
          approvalId: id(21),
          approvalFingerprint: 'a'.repeat(64),
        },
      ),
    ).resolves.toMatchObject({ card: { id: id(20) }, deliveryToken: 'protected-token' });
    expect(repo.issueGiftCard).toHaveBeenCalledWith(
      {},
      id(6),
      expect.any(Object),
      expect.objectContaining({ deviceId: null, dashboardSessionId: user.sessionId }),
    );
  });
});
