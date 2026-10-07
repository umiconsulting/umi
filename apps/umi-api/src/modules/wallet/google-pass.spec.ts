import { describe, expect, it } from 'vitest';
import { buildLoyaltyObject, GooglePassService, type GooglePassData } from './google-pass.service';

/**
 * The service with its two seams replaced: whether Google is configured, and the
 * per-object PATCH. Everything else (the walk, the counting, the failure handling)
 * is the code under test.
 */
/** The service with Google "configured", so the walk runs. */
function walker() {
  const svc = new GooglePassService({ get: () => undefined } as never, {} as never);
  (svc as unknown as { isConfigured: () => boolean }).isConfigured = () => true;
  return svc;
}

describe('GooglePassService.refreshMerchantObjects', () => {
  /**
   * THE BODY'S ID IS THE URL'S ID, or Google rejects the PATCH.
   *
   * Found in the recovery from the flip: the URL had been corrected to the object's
   * stored cuid while the body still constructed a uuid, and Google's error names the
   * BODY's id — so one log line carried two different ids and neither looked wrong in
   * isolation.
   */
  it('builds the object with the id it already has, for an update', () => {
    const stored = '3388000000023116211.card_cmqc0om4q0004117mjd7h985i';
    const obj = build({ objectId: stored }) as { id: string };
    expect(obj.id).toBe(stored);
  });

  it('mints an id only when creating one', () => {
    const obj = build({ objectId: null }) as { id: string };
    expect(obj.id).toBe('3388000000022.card_card-1');
  });

  it('walks every object, counts what landed, and keeps going past a failure', async () => {
    const svc = walker();
    const seen: string[] = [];
    const result = await svc.refreshMerchantObjects(
      [
        { cardId: 'card-1', objectId: 'object-1' },
        { cardId: 'card-2', objectId: 'object-2' },
        { cardId: 'card-3', objectId: 'object-3' },
      ],
      async (_cardId, objectId) => {
        seen.push(objectId);
        return objectId === 'object-2' ? 'failed' : 'updated';
      },
    );

    expect(result).toEqual({ total: 3, refreshed: 2, missing: 0, failed: 1 });
    // The STORED id reaches Google, never the one this codebase would construct.
    expect(seen.sort()).toEqual(['object-1', 'object-2', 'object-3']);
  });

  it('counts a card whose render throws as a failure rather than aborting the café', async () => {
    const svc = walker();
    const result = await svc.refreshMerchantObjects(
      [
        { cardId: 'bad', objectId: 'object-1' },
        { cardId: 'good', objectId: 'object-2' },
      ],
      async (cardId) => {
        if (cardId === 'bad') throw new Error('render failed');
        return 'updated';
      },
    );
    expect(result).toEqual({ total: 2, refreshed: 1, missing: 0, failed: 1 });
  });

  it('counts an object Google does not have as MISSING, not as a failure', async () => {
    // 19 rows in production point at objects that were never created: the customer
    // tapped "add to Wallet" and never finished. Reporting those as failures made a
    // café-wide refresh look broken on every run.
    const svc = walker();
    const result = await svc.refreshMerchantObjects(
      [
        { cardId: 'card-1', objectId: 'object-1' },
        { cardId: 'card-2', objectId: 'object-2' },
      ],
      async (_cardId, objectId) => (objectId === 'object-2' ? 'missing' : 'updated'),
    );
    expect(result).toEqual({ total: 2, refreshed: 1, missing: 1, failed: 0 });
  });

  it('reports every object as failed when Google is not configured', async () => {
    const svc = new GooglePassService({ get: () => undefined } as never, {} as never);
    const result = await svc.refreshMerchantObjects(
      [{ cardId: 'card-1', objectId: 'object-1' }],
      async () => 'updated',
    );
    expect(result).toEqual({ total: 1, refreshed: 0, missing: 0, failed: 1 });
  });
});

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

/**
 * THE LADDER ON THE PASS. El Gran Ribera's 7/9: the strip has to show which slots are
 * the second tier's, and the copy has to name the choice once the lower tier is
 * reached. Both are content-addressed by the SAME numbers the pass is rendered from,
 * so a change is a new URL Google has not cached.
 */
describe('Google loyalty object · the two-tier ladder', () => {
  const LADDER = {
    visitsRequired: 9,
    rewardName: 'Bebida rocas',
    baseReward: { visitsRequired: 7, rewardName: 'Capuccino' },
    pendingTier1: 0,
  };

  it('draws the bonus slots into the hero image url', () => {
    const obj = build({ ...LADDER, visitsThisCycle: 5 }) as {
      heroImage: { sourceUri: { uri: string } };
    };
    expect(obj.heroImage.sourceUri.uri).toBe(
      'https://cash.umiconsulting.co/api/kalala/stamp-strip/5-9-b7.png',
    );
  });

  it('turns the reward line into the choice once the lower tier is reached', () => {
    const obj = build({ ...LADDER, visitsThisCycle: 7 }) as {
      textModulesData: { id: string; header: string; body: string }[];
    };
    const next = obj.textModulesData.find((m) => m.id === 'next_reward');
    expect(next?.header).toBe('ELIGE TU RECOMPENSA');
    expect(next?.body).toBe('🎁 Capuccino listo para canjear · o 2 visitas más y Bebida rocas');
  });

  it('names both tiers while the lower one is still ahead', () => {
    const obj = build({ ...LADDER, visitsThisCycle: 3 }) as {
      textModulesData: { id: string; body: string }[];
    };
    expect(obj.textModulesData.find((m) => m.id === 'next_reward')?.body).toBe(
      '4 visitas para Capuccino · 6 para Bebida rocas',
    );
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

it('renders the available cycle reward and original deadline in the merchant timezone', () => {
  const rendered = modules(
    build({
      rewardPolicy: 'single_cycle',
      visitsThisCycle: 9,
      visitsRequired: 9,
      rewardName: 'Original upper',
      baseReward: { visitsRequired: 7, rewardName: 'Original base' },
      pendingRewards: 1,
      cycleRewardAvailable: true,
      legacyPendingRewards: 0,
      merchantTimezone: 'America/Mazatlan',
      nextRewardExpiresAt: '2026-11-06T18:00:00Z',
    }),
  ).find((module) => module.id === 'pending_rewards');
  expect(rendered?.body).toContain('Original upper');
  expect(rendered?.body).toContain('11:00');
  expect(rendered?.body).toContain('Canjea antes de otra visita');
  expect(rendered?.body).not.toContain('Original base');
});
