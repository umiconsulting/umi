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
  state: {
    card_number: 'KLC-4076462081',
    total_visits: 23,
    visits_this_cycle: 3,
    pending_rewards: 2,
    balance_cents: 15000,
    visits_required: 10,
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
  };
  const builder = { build, isConfigured: () => true, assetOrigin: () => '' };
  const google = { isConfigured: () => false, saveUrl: vi.fn(), updateObject: vi.fn() };
  const service = new WalletPassService(
    repo as unknown as ConstructorParameters<typeof WalletPassService>[0],
    builder as unknown as ConstructorParameters<typeof WalletPassService>[1],
    google as unknown as ConstructorParameters<typeof WalletPassService>[2],
  );
  return { service, build, repo };
}

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
