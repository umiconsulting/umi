import { describe, expect, it } from 'vitest';
import { buildLoyaltyObject, type GooglePassData } from './google-pass.service';

/**
 * These assert the three details build-v3's stale copy of `pass-google.ts` had
 * lost. Each shipped as its own fix in July, each is invisible in review, and
 * each fails the same way: the pass still works, it just stops showing something
 * the customer used to see.
 */

const DATA: GooglePassData = {
  cardId: 'card-1',
  cardNumber: 'KLC-4076462081',
  customerName: 'Ana',
  merchantName: 'Kalala',
  merchantHandle: 'kalala',
  balanceCentavos: 15000,
  visitsThisCycle: 3,
  visitsRequired: 10,
  pendingRewards: 0,
  totalVisits: 23,
  rewardName: 'Café gratis',
  memberSince: new Date('2026-01-15T10:00:00Z'),
  topupEnabled: true,
  lifecycleMessage: null,
  lifecycleMessageAt: null,
};

function build(overrides: Partial<GooglePassData> = {}) {
  return buildLoyaltyObject({
    issuerId: '3388000000022',
    classPrefix: 'loyalty_v2',
    origin: 'https://cash.umiconsulting.co',
    barcodeValue: 'KLC-4076462081.abc123',
    data: { ...DATA, ...overrides },
  });
}

function modules(obj: Record<string, unknown>) {
  return obj.textModulesData as { header: string; body: string; id: string }[];
}

describe('Google loyalty object · Saldo', () => {
  it('emits Saldo as a STRING module, because money does not render on the card face', () => {
    const saldo = modules(build()).find((m) => m.id === 'saldo');
    expect(saldo).toBeDefined();
    expect(saldo!.body).toBe('$150.00');
  });

  it('also emits the native money field, for the details view', () => {
    const obj = build() as { secondaryLoyaltyPoints?: { balance: { money: { micros: string } } } };
    expect(obj.secondaryLoyaltyPoints?.balance.money.micros).toBe('150000000');
  });

  it('emits neither for a café that does not sell stored value', () => {
    const obj = build({ topupEnabled: false });
    expect(modules(obj).find((m) => m.id === 'saldo')).toBeUndefined();
    expect(obj.secondaryLoyaltyPoints).toBeUndefined();
  });
});

describe('Google loyalty object · hero image', () => {
  it('is content-addressed, so advancing a stamp points at a NEW url', () => {
    const at3 = build({ visitsThisCycle: 3 }) as { heroImage: { sourceUri: { uri: string } } };
    const at4 = build({ visitsThisCycle: 4 }) as { heroImage: { sourceUri: { uri: string } } };

    expect(at3.heroImage.sourceUri.uri).toBe(
      'https://cash.umiconsulting.co/api/kalala/stamp-strip/3-10.png',
    );
    // If these ever match, Google serves the old image from cache forever.
    expect(at4.heroImage.sourceUri.uri).not.toBe(at3.heroImage.sourceUri.uri);
  });

  it('is omitted without a handle, because the url would be malformed', () => {
    expect(build({ merchantHandle: null }).heroImage).toBeUndefined();
  });
});

describe('Google loyalty object · reward copy', () => {
  it('keeps the module ids the class cardTemplateOverride names', () => {
    expect(modules(build({ pendingRewards: 0 })).some((m) => m.id === 'next_reward')).toBe(true);
    expect(modules(build({ pendingRewards: 1 })).some((m) => m.id === 'pending_rewards')).toBe(
      true,
    );
  });

  it('escalates as the reward gets closer', () => {
    const body = (visits: number) =>
      modules(build({ visitsThisCycle: visits })).find((m) => m.id === 'next_reward')!.body;

    expect(body(9)).toContain('Última visita');
    expect(body(8)).toContain('Ya casi');
    expect(body(3)).toBe('7 visitas para Café gratis');
  });

  it('reads differently for one reward and for several', () => {
    const one = modules(build({ pendingRewards: 1 })).find((m) => m.id === 'pending_rewards')!;
    const many = modules(build({ pendingRewards: 2 })).find((m) => m.id === 'pending_rewards')!;
    expect(one.header).toBe('RECOMPENSA LISTA');
    expect(many.header).toBe('RECOMPENSAS DISPONIBLES');
  });
});

describe('Google loyalty object · identity', () => {
  it('names the object and class the way the pre-created classes expect', () => {
    const obj = build();
    expect(obj.id).toBe('3388000000022.card_card-1');
    expect(obj.classId).toBe('3388000000022.kalala_loyalty_v2');
  });

  it('shows visits as a fraction, not a bare count', () => {
    const obj = build() as { loyaltyPoints: { balance: { string: string }; label: string } };
    expect(obj.loyaltyPoints.balance.string).toBe('3 / 10');
    expect(obj.loyaltyPoints.label).toBe('Visitas');
  });

  it('carries the signed barcode, not the raw card number', () => {
    const obj = build() as { barcode: { value: string; alternateText: string } };
    expect(obj.barcode.value).toBe('KLC-4076462081.abc123');
    expect(obj.barcode.alternateText).toBe('KLC-4076462081');
  });
});
