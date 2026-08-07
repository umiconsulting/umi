import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogTools } from './catalog.tools';
import { OrderingWindowService } from '../ordering-window.service';
import type { ToolContext } from '../turn.types';

/**
 * What the bot tells a customer who asks "where are you and how do I pay?".
 *
 * The case that forced this: Kalala has TWO locations, and both facts used to be read
 * from a merchant-level config blob that could hold only ONE address. Every customer who
 * chose Congreso was given the Chapultepec street, and nothing failed. So the assertion
 * that matters is not "an address comes back" — it is that two locations of one café
 * come back DIFFERENT, and that whichever one answered also supplied the payment line.
 */

const CTX = (locationId: string | null): ToolContext => ({
  merchantId: 'm1',
  personId: 'p1',
  conversationId: 'c1',
  turnId: 'turn-1',
  locationId,
  customerPhone: '+5210000000000',
});

const LOCATIONS: Record<string, { address: string | null; paymentMethods: string[] }> = {
  chapultepec: {
    address: 'Chapultepec, Culiacán Rosales, Sinaloa',
    paymentMethods: ['cash', 'transfer'],
  },
  congreso: { address: 'Congreso, Culiacán Rosales, Sinaloa', paymentMethods: ['cash'] },
  unrecorded: { address: 'Sucursal Principal', paymentMethods: [] },
};

describe('CatalogTools.getMerchantInfo · one counter answers everything', () => {
  let hours: { getEffectiveHoursForBot: ReturnType<typeof vi.fn> };
  let merchantConfig: { fetchConfigRow: ReturnType<typeof vi.fn> };
  let merchants: { locationContactWorker: ReturnType<typeof vi.fn> };

  /** The café's DEFAULT location when the customer has not chosen one. */
  const DEFAULT_LOCATION = 'chapultepec';

  const build = (): CatalogTools => {
    const window = new OrderingWindowService(
      hours as never,
      merchantConfig as never,
      merchants as never,
    );
    return new CatalogTools({} as never, window);
  };

  beforeEach(() => {
    hours = {
      // Mirrors the real service: it RESOLVES the location (requested, else the café's
      // oldest active one) and reports which one answered.
      getEffectiveHoursForBot: vi.fn(async (_merchantId: string, requested: string | null) => ({
        timezone: 'America/Mexico_City',
        hours: {},
        ordering: { acceptsOrders: true, specialNotice: null },
        locationId: requested ?? DEFAULT_LOCATION,
      })),
    };
    merchantConfig = {
      fetchConfigRow: vi.fn().mockResolvedValue({ id: 'm1', name: 'Kalala Café' }),
    };
    merchants = {
      locationContactWorker: vi.fn(async (_merchantId: string, locationId: string) => {
        return LOCATIONS[locationId] ?? null;
      }),
    };
  });

  it('answers with the address of the location the customer chose, not the café', async () => {
    const r = await build().getMerchantInfo(CTX('congreso'));
    expect(r.address).toBe('Congreso, Culiacán Rosales, Sinaloa');
    expect(r.message).toContain('Congreso, Culiacán Rosales, Sinaloa');
  });

  it('gives two locations of one café two different answers — the regression', async () => {
    const tools = build();
    const a = await tools.getMerchantInfo(CTX('chapultepec'));
    const b = await tools.getMerchantInfo(CTX('congreso'));
    expect(a.address).not.toBe(b.address);
    expect(a.paymentMethods).toEqual(['cash', 'transfer']);
    expect(b.paymentMethods).toEqual(['cash']);
  });

  it('reads the SAME location the hours resolved to, so the facts cannot disagree', async () => {
    await build().getMerchantInfo(CTX(null));
    // Not the requested value (null) — the RESOLVED one.
    expect(merchants.locationContactWorker).toHaveBeenCalledWith('m1', DEFAULT_LOCATION);
  });

  it('says where you pay before how, and keeps the recorded order', async () => {
    const r = await build().getMerchantInfo(CTX('chapultepec'));
    expect(r.message).toContain('El pago es en el local: cash, transfer.');
  });

  it('still states that payment happens at the counter when no method is recorded', async () => {
    const r = await build().getMerchantInfo(CTX('unrecorded'));
    expect(r.paymentMethods).toEqual([]);
    expect(r.message).toContain('El pago es en el local.');
    // The old copy answered an empty list with a non-answer that read as a fault.
    expect(r.message).not.toContain('no especificados');
  });

  it('does not invent a counter when the café has no active location', async () => {
    hours.getEffectiveHoursForBot.mockResolvedValue({
      timezone: 'America/Mexico_City',
      hours: {},
      ordering: { acceptsOrders: false, specialNotice: null },
      locationId: null,
    });
    const r = await build().getMerchantInfo(CTX(null));
    expect(merchants.locationContactWorker).not.toHaveBeenCalled();
    expect(r.address).toBeNull();
    expect(r.message).toContain('consulta directamente con el local');
  });
});
