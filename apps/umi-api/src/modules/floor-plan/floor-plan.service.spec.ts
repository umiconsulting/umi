import { describe, expect, it, vi } from 'vitest';
import type { FloorPlanState } from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import type { FloorPlanRepository } from './floor-plan.repository';
import { FloorPlanService } from './floor-plan.service';

const merchantId = '11111111-1111-4111-8111-111111111111';
const locationId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const tableId = '44444444-4444-4444-8444-444444444444';
const accountId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';

const user = {
  id: userId,
  email: 'owner@example.com',
  sessionId: '77777777-7777-4777-8777-777777777777',
  deviceId: null,
} satisfies AuthUser;
const access = {
  merchantId,
  locationId,
  name: 'Test café',
  handle: null,
  timezone: 'America/Mexico_City',
  membershipId: null,
  role: 'owner',
  roles: ['owner'],
  permissions: ['merchant.manage', 'sale.resume.any'],
} satisfies MerchantAccess;
const state = {
  locationId,
  version: 8,
  draft: null,
  publishedVersion: 8,
  published: null,
  publishedAt: null,
} satisfies FloorPlanState;

function harness() {
  const appendAudit = vi.fn();
  const repo = {
    blockingAccounts: vi.fn().mockResolvedValue([
      {
        tableId,
        label: 'Brasil',
        accountId,
        accountVersion: 4,
        accountReference: '012',
      },
    ]),
    change: vi.fn().mockResolvedValue(state),
  };
  const sales = {
    cancelCarriedOver: vi
      .fn()
      .mockResolvedValue([{ id: 'sale-1', state: 'cancelled', cart: { version: 5 } }]),
  };
  const integrity = {
    execute: vi.fn(async (_input, operation) => {
      const outcome = await operation({
        client: {},
        commandId: idempotencyKey,
        correlationId: 'correlation',
        claimVersion: vi.fn(),
        appendAudit,
        appendFinancial: vi.fn(),
      });
      return { status: 'succeeded', result: outcome.value };
    }),
  };
  return {
    appendAudit,
    repo,
    sales,
    integrity,
    service: new FloorPlanService(
      repo as unknown as FloorPlanRepository,
      integrity as never,
      sales as never,
    ),
  };
}

describe('FloorPlanService occupied-table publication', () => {
  it('keeps the guard by default and closes no account', async () => {
    const { service, repo, sales } = harness();
    await service.change(
      access,
      { locationId, expectedVersion: 7, idempotencyKey, closeBlockingAccounts: false },
      user,
    );
    expect(repo.blockingAccounts).not.toHaveBeenCalled();
    expect(sales.cancelCarriedOver).not.toHaveBeenCalled();
    expect(repo.change).toHaveBeenCalledWith(
      expect.anything(),
      merchantId,
      locationId,
      7,
      undefined,
    );
  });

  it('closes only the blocking accounts and publishes in the same command', async () => {
    const { service, repo, sales, appendAudit } = harness();
    await service.change(
      access,
      {
        locationId,
        expectedVersion: 7,
        idempotencyKey,
        closeBlockingAccounts: true,
      },
      user,
    );
    expect(sales.cancelCarriedOver).toHaveBeenCalledWith(
      expect.anything(),
      merchantId,
      userId,
      true,
      expect.objectContaining({
        accounts: [{ cartId: accountId, expectedVersion: 4 }],
        reasonCode: 'other',
      }),
      { allowCurrentBusinessDay: true },
    );
    expect(repo.change).toHaveBeenCalled();
    expect(appendAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'sale.cancelled',
        publicData: expect.objectContaining({ closedForFloorPlanPublish: true }),
      }),
    );
  });

  it('refuses to close other operators accounts without sale.resume.any', async () => {
    const { service, repo, sales } = harness();
    await expect(
      service.change(
        { ...access, permissions: ['merchant.manage'] },
        {
          locationId,
          expectedVersion: 7,
          idempotencyKey,
          closeBlockingAccounts: true,
        },
        user,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(repo.blockingAccounts).not.toHaveBeenCalled();
    expect(sales.cancelCarriedOver).not.toHaveBeenCalled();
    expect(repo.change).not.toHaveBeenCalled();
  });

  it('does not publish if closing the blocking account fails', async () => {
    const { service, repo, sales } = harness();
    sales.cancelCarriedOver.mockRejectedValueOnce(new Error('version changed'));
    await expect(
      service.change(
        access,
        {
          locationId,
          expectedVersion: 7,
          idempotencyKey,
          closeBlockingAccounts: true,
        },
        user,
      ),
    ).rejects.toThrow('version changed');
    expect(repo.change).not.toHaveBeenCalled();
  });
});
