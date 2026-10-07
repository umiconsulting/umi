import { describe, expect, it, vi } from 'vitest';
import { WalletPassService } from './wallet-pass.service';
import type { AuthenticatedPass, PassRenderData } from './wallet-pass.repository';
import type { ApplePassData } from './apple-pass.builder';

/**
 * These tests guard the two failures that would take out every issued pass at
 * once, and that no gate elsewhere can see:
 *
 *   1. A rebuilt pass signed with a DIFFERENT authentication token. The customer
 *      keeps the pass, it still opens, and its very next callback is a 401 —
 *      after which it never updates again. Nothing errors.
 *   2. A rebuilt pass with no geofences, because the location query came back
 *      empty. The card silently stops appearing on the lock screen near the café.
 */

const PASS: AuthenticatedPass = {
  walletPassId: 'wp-1',
  cardId: 'card-1',
  merchantId: 'merchant-1',
  serialNumber: 'ABC123',
  webServiceToken: 'the-immutable-token',
  cardUpdatedAt: new Date('2026-08-12T10:00:00Z'),
};

const RENDER: PassRenderData = {
  merchantName: 'Kalala',
  merchantHandle: 'kalala',
  timezone: 'America/Mexico_City',
  cardNumber: 'KLC-4076462081',
  customerName: 'Ana',
  lifecycleMessage: null,
  lifecycleMessageAt: null,
  memberSince: new Date('2026-01-15T10:00:00Z'),
  cardUpdatedAt: new Date('2026-08-12T10:00:00Z'),
  passStyle: 'stamps',
  primaryColor: '#B5605A',
  secondaryColor: null,
  logoUrl: null,
  stripImageUrl: null,
  promoMessage: null,
  topupEnabled: true,
  rewardName: 'Café gratis',
  birthdayRewardName: 'Rebanada de pastel',
  // A single-reward café: no upper tier, no per-card override. The ladder's own
  // shapes are covered by reward-tiers.spec.ts and by the live rehearsal.
  ladder: {
    standard: {
      id: 'rc1',
      name: 'Café gratis',
      stamps_required: 10,
      description: null,
    },
    upgrade: null,
    override: null,
  },
  state: {
    card_number: 'KLC-4076462081',
    total_visits: 23,
    visits_this_cycle: 3,
    pending_rewards: 2,
    balance_cents: 15000,
    visits_required: 10,
    pending_tier1: 0,
    cycle_anchor: 0,
    rewards_earned: 2,
  },
  locations: [{ latitude: 20.6736, longitude: -103.344 }],
};

function makeService(render: PassRenderData | null = RENDER) {
  const build = vi.fn<(d: ApplePassData) => Promise<Buffer>>().mockResolvedValue(Buffer.from('pk'));
  const repo = {
    renderData: vi.fn().mockResolvedValue(render),
    authenticate: vi.fn(),
    registerDevice: vi.fn(),
    unregisterDevice: vi.fn(),
    serialsUpdatedSince: vi.fn(),
    merchantByHandle: vi.fn(),
    merchantForCard: vi.fn(),
    googleObjectForCard: vi
      .fn()
      .mockResolvedValue('3388000000023116211.card_cmnuuglu40004oyt5s8bve44e'),
    googleObjectsForMerchant: vi
      .fn()
      .mockResolvedValue([{ cardId: 'card-1', objectId: 'stored-object-id' }]),
    googleRowForCard: vi.fn().mockResolvedValue(null),
    cardForCustomer: vi.fn().mockResolvedValue('card-1'),
    upsertGoogleObject: vi.fn().mockResolvedValue(undefined),
    markGoogleObjectRemoved: vi.fn().mockResolvedValue(undefined),
  };
  const builder = { build, isConfigured: () => true, assetOrigin: () => '' };
  const google = {
    isConfigured: () => false,
    saveUrl: vi.fn(),
    updateObject: vi.fn().mockResolvedValue(true),
    refreshMerchantObjects: vi
      .fn()
      .mockResolvedValue({ total: 1, refreshed: 1, missing: 0, failed: 0 }),
    objectIdFor: (cardId: string) => `3388000000022.card_${cardId}`,
  };
  const service = new WalletPassService(
    repo as unknown as ConstructorParameters<typeof WalletPassService>[0],
    builder as unknown as ConstructorParameters<typeof WalletPassService>[1],
    google as unknown as ConstructorParameters<typeof WalletPassService>[2],
  );
  return { service, build, repo, google };
}

/**
 * THE ID THAT MAKES AN ANDROID UPDATE LAND. Objects in circulation were created by
 * umi-cash under Prisma cuids; the id this codebase would construct is a uuid. The
 * first version PATCHed the constructed one, so all 155 Android passes 404'd on every
 * refresh and kept showing the previous week. Only a test at the service sees which id
 * is carried from the pass row into the request.
 */
describe('WalletPassService · the Android object id', () => {
  it('refreshes with the id the object HAS, not one it would be given', async () => {
    const { service, repo, google } = makeService();
    repo.merchantForCard.mockResolvedValue('merchant-1');
    (google as unknown as { isConfigured: () => boolean }).isConfigured = () => true;
    await service.refreshGoogleObject('card-1');
    const passed = google.updateObject.mock.calls[0][0];
    expect(passed.objectId).toBe('3388000000023116211.card_cmnuuglu40004oyt5s8bve44e');
  });

  it('does nothing for a card whose customer never added the Android pass', async () => {
    const { service, repo, google } = makeService();
    (google as unknown as { isConfigured: () => boolean }).isConfigured = () => true;
    repo.merchantForCard.mockResolvedValue('merchant-1');
    repo.googleObjectForCard.mockResolvedValue(null);
    await service.refreshGoogleObject('card-1');
    // Before this, every write to such a card fired a PATCH at an object that does
    // not exist and logged a 404 — 404s that read like a Google outage.
    expect(google.updateObject).not.toHaveBeenCalled();
  });

  it('walks the café for the merchant-wide refresh', async () => {
    const { service, repo, google } = makeService();
    await service.refreshMerchantGoogleObjects('merchant-1');
    expect(repo.googleObjectsForMerchant).toHaveBeenCalledWith('merchant-1');
    expect(google.refreshMerchantObjects).toHaveBeenCalled();
  });

  /**
   * THE ROW HAS TO BE WRITTEN WHEN THE OBJECT IS CREATED.
   *
   * The legacy save route did it; the port dropped it. Without the row, a customer who
   * added her Android pass after the Wallet switch was invisible to every later
   * refresh — per-write and café-wide — so her pass froze at whatever it showed the day
   * she saved it. Silent, and permanent.
   */
  describe('the "add to Google Wallet" link', () => {
    it('records the object it is about to create', async () => {
      const { service, repo, google } = makeService();
      repo.googleRowForCard.mockResolvedValue(null);
      await service.googleSaveUrl('merchant-1', 'customer-1');
      expect(repo.upsertGoogleObject).toHaveBeenCalledWith('card-1', '3388000000022.card_card-1');
      // …and the JWT carries the SAME id as the row, or the refresh 404s later.
      expect(google.saveUrl.mock.calls[0][0].objectId).toBe('3388000000022.card_card-1');
    });

    it('reuses the id the customer already has, so a second tap does not duplicate', async () => {
      const { service, repo, google } = makeService();
      repo.googleRowForCard.mockResolvedValue({
        objectId: 'the-existing-object',
        status: 'active',
      });
      await service.googleSaveUrl('merchant-1', 'customer-1');
      expect(repo.upsertGoogleObject).toHaveBeenCalledWith('card-1', 'the-existing-object');
      expect(google.saveUrl.mock.calls[0][0].objectId).toBe('the-existing-object');
    });

    it('mints a fresh id for a row marked removed, because that object is gone', async () => {
      const { service, repo, google } = makeService();
      repo.googleRowForCard.mockResolvedValue({ objectId: 'the-old-object', status: 'removed' });
      await service.googleSaveUrl('merchant-1', 'customer-1');
      expect(repo.upsertGoogleObject).toHaveBeenCalledWith('card-1', '3388000000022.card_card-1');
      expect(google.saveUrl.mock.calls[0][0].objectId).toBe('3388000000022.card_card-1');
    });
  });
});

describe('WalletPassService.renderPass', () => {
  it('signs the SAME authentication token back into the rebuilt pass', async () => {
    const { service, build } = makeService();
    await service.renderPass(PASS);

    expect(build).toHaveBeenCalledTimes(1);
    expect(build.mock.calls[0][0].authToken).toBe('the-immutable-token');
  });

  it('keeps the serial, so Apple still sees the same pass', async () => {
    const { service, build } = makeService();
    await service.renderPass(PASS);
    expect(build.mock.calls[0][0].serial).toBe('ABC123');
  });

  it('carries the geofences through to the pass', async () => {
    const { service, build } = makeService();
    await service.renderPass(PASS);
    expect(build.mock.calls[0][0].locations).toEqual([{ latitude: 20.6736, longitude: -103.344 }]);
  });

  it('shows the derived visit and balance state, not a cached copy', async () => {
    const { service, build } = makeService();
    await service.renderPass(PASS);

    const data = build.mock.calls[0][0];
    expect(data.visitsThisCycle).toBe(3);
    expect(data.visitsRequired).toBe(10);
    expect(data.totalVisits).toBe(23);
    expect(data.balanceCentavos).toBe(15000);
  });

  it('falls back to a neutral customer name when the café recorded none', async () => {
    const { service, build } = makeService({ ...RENDER, customerName: null });
    await service.renderPass(PASS);
    expect(build.mock.calls[0][0].customerName).toBe('Cliente');
  });

  it('reports a missing card as 404 rather than building an empty pass', async () => {
    const { service, build } = makeService(null);
    await expect(service.renderPass(PASS)).rejects.toThrow();
    expect(build).not.toHaveBeenCalled();
  });
});

describe('WalletPassService · the birthday reward line', () => {
  /**
   * THE SEAM THAT MATTERS. The bug this guards was NOT in the repository and not
   * in the builder — both were correct. It was the WIRING between them: the
   * service read the render data and rebuilt the builder input field by field,
   * and it simply never copied this one across.
   *
   * A repository test goes green on that bug, because the repository returns the
   * value. A builder test goes green too, because the builder renders whatever
   * it is handed. Only a test at the service sees the field fall on the floor.
   */
  it('passes the birthday reward name from the render data to the builder', async () => {
    const { service, build } = makeService();
    await service.renderPass(PASS);
    const passed: ApplePassData = build.mock.calls[0][0];
    expect(passed.birthdayRewardName).toBe(RENDER.birthdayRewardName);
  });

  it('passes null through rather than inventing a default', async () => {
    // A cafe with no birthday reward must render NO reward row. A default here
    // would put a line on every pass for a reward that does not exist.
    const { service, build, repo } = makeService();
    repo.renderData.mockResolvedValueOnce({ ...RENDER, birthdayRewardName: null });
    await service.renderPass(PASS);
    const passed: ApplePassData = build.mock.calls[0][0];
    expect(passed.birthdayRewardName).toBeNull();
  });
});

it('returns a failed durable refresh when Google rejects the update', async () => {
  const h = makeService();
  h.repo.merchantForCard.mockResolvedValue('merchant-1');
  h.google.isConfigured = () => true;
  h.google.updateObject.mockResolvedValue('failed');
  expect(await h.service.refreshGoogleObjectWithOutcome('card-1')).toBe(false);
});

it('passes authoritative base eligibility into wallet rendering', async () => {
  const render = {
    ...RENDER,
    state: {
      ...RENDER.state,
      reward_policy: 'single_cycle' as const,
      visits_this_cycle: 8,
      cycle_reward_available: true,
      base_reward_blocked_by_history: true,
    },
  };
  const h = makeService(render);
  await h.service.renderPass(PASS);
  expect(h.build.mock.calls[0][0].baseReward).toMatchObject({
    visitsRequired: 7,
    canRedeem: false,
  });
});
