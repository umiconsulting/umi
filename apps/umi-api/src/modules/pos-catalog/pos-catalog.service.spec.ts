import { describe, expect, it, vi } from 'vitest';
import { PosCatalogService } from './pos-catalog.service';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'operator@example.test',
  sessionId: '00000000-0000-4000-8000-000000000002',
  deviceId: '00000000-0000-4000-8000-000000000003',
};
const merchantId = '00000000-0000-4000-8000-000000000004';
const locationId = '00000000-0000-4000-8000-000000000005';
const product = {
  id: '00000000-0000-4000-8000-000000000006',
  name: 'Café',
  description: null,
  sku: null,
  hasBarcode: false,
  category: null,
  price: { minorUnits: 4500, currency: 'MXN' },
  taxRateBasisPoints: 1600,
  availability: 'enabled' as const,
  availableFrom: null,
  primaryMedia: null,
  hasVariants: false,
  hasModifiers: false,
  updatedAt: new Date().toISOString(),
};

const make = (authorized = true) => {
  const repo = {
    authorize: vi.fn().mockResolvedValue(authorized),
    categories: vi.fn().mockResolvedValue([]),
    products: vi.fn().mockResolvedValue([product, { ...product, id: user.id, name: 'Té' }]),
    detail: vi
      .fn()
      .mockResolvedValue({ ...product, barcode: null, media: [], variants: [], optionGroups: [] }),
    version: vi.fn().mockResolvedValue({ version: '42', updatedAt: product.updatedAt }),
  };
  return { service: new PosCatalogService(repo as never), repo };
};

describe('PosCatalogService', () => {
  it('requires the active operator/device/tenant/branch intersection', async () => {
    const { service } = make(false);
    await expect(
      service.products(user, merchantId, service.parseQuery({ locationId, limit: '40' })),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('uses bounded cursor pagination without duplicate-page state', async () => {
    const { service, repo } = make();
    const page = await service.products(
      user,
      merchantId,
      service.parseQuery({ locationId, limit: '1', search: 'cafe' }),
    );
    expect(page.items).toEqual([product]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(repo.products).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId, locationId, search: 'cafe', limit: 2 }),
    );
  });

  it('rejects malformed cursors before querying catalog data', async () => {
    const { service } = make();
    await expect(
      service.products(
        user,
        merchantId,
        service.parseQuery({ locationId, cursor: 'not-a-cursor' }),
      ),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
  });
});
