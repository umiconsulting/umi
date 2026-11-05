import { describe, expect, it, vi } from 'vitest';
import { CashPublicController } from './cash-public.controller';

describe('Cash storefront configuration', () => {
  it('serves the public brand and reward ladder without internal settings', async () => {
    const repo = {
      branding: vi.fn().mockResolvedValue({
        id: 'merchant-1',
        handle: 'cafe',
        name: 'Café',
        multiSealEnabled: true,
        lifecycleCopy: { private: 'internal template' },
        subscriptionId: 'private-subscription',
      }),
      publicLocations: vi.fn().mockResolvedValue([]),
      rewardProfileRows: vi.fn().mockResolvedValue({
        defaultConfig: {
          id: 'r1',
          visits_required: 7,
          reward_name: 'Café',
          reward_description: null,
        },
        upgradeConfig: {
          id: 'r2',
          visits_required: 9,
          reward_name: 'Frappé',
          reward_description: null,
        },
      }),
    };
    const controller = new CashPublicController(repo as never);
    const result = await controller.config({
      merchantId: 'merchant-1',
      handle: 'cafe',
      name: 'Café',
    });
    expect(result).toMatchObject({
      slug: 'cafe',
      multiSealEnabled: true,
      rewardProfile: { visitsRequired: 9, rewardName: 'Frappé', baseTier: { visitsRequired: 7 } },
    });
    expect(result).not.toHaveProperty('lifecycleCopy');
    expect(result).not.toHaveProperty('subscriptionId');
    expect(repo.branding).toHaveBeenCalledWith('merchant-1');
    expect(repo.rewardProfileRows).toHaveBeenCalledWith('merchant-1', null);
  });

  it('uses the merchant ID for a new business without a frozen wallet handle', async () => {
    const controller = new CashPublicController({
      branding: async () => ({ id: 'merchant-2', handle: null, name: 'New café' }),
      publicLocations: async () => [],
      rewardProfileRows: async () => ({ defaultConfig: null, upgradeConfig: null }),
    } as never);
    const result = await controller.config({
      merchantId: 'merchant-2',
      handle: null,
      name: 'New café',
    });
    expect(result.slug).toBe('merchant-2');
    expect(result.topupEnabled).toBe(false);
    expect(result.selfRegistration).toBe(false);
  });
});
