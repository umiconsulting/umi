import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { Cart } from '@umi/contract';
import type { PgService } from '../../shared/database/pg.service';
import { PosCartRepository } from './pos-cart.repository';
import { voidAfterPreparationFingerprint } from '../../shared/orders/void-after-preparation-fingerprint';

const MERCHANT = '10000000-0000-4000-8000-000000000001';
const LOCATION = '20000000-0000-4000-8000-000000000001';
const OPERATOR_SESSION = '30000000-0000-4000-8000-000000000001';
const CART = '40000000-0000-4000-8000-000000000001';
const TABLE = '50000000-0000-4000-8000-000000000009';
const FIRE_ORDER = '60000000-0000-4000-8000-000000000009';
const LINE = '70000000-0000-4000-8000-000000000001';
const COMMAND = '80000000-0000-4000-8000-000000000001';
const APPROVAL = '90000000-0000-4000-8000-000000000001';

describe('PosCartRepository.create', () => {
  it('names the owner of an active account without transferring its ownership', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            version: 4,
            operatorSessionId: 'another-session',
            lifecycleState: 'draft',
            ownerActive: true,
            ownerName: 'Mesero 2',
            deviceName: 'Tablet A9',
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const client = { query } as unknown as PoolClient;
    const repository = new PosCartRepository({} as PgService);
    await expect(
      repository.claimAccount(client, MERCHANT, LOCATION, OPERATOR_SESSION, CART),
    ).rejects.toMatchObject({
      response: {
        code: 'CART_ACCOUNT_BUSY',
        details: { operatorName: 'Mesero 2', deviceName: 'Tablet A9' },
      },
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(
      query.mock.calls.every((call) => !String(call[0]).includes('UPDATE merchant.pos_cart')),
    ).toBe(true);
  });
  // Two defects have lived on this call. build-v3-64 fixed the first (the request
  // path wrote pos_cart.business_date itself, which api has no column privilege
  // for, so the recovery branch — an operator who already has a live cart —
  // answered 500 `permission denied for table pos_cart`). build-v3-66 removed the
  // privileged helper the first fix introduced, because the re-stamp it performed
  // was never the answer: 90_rls.sql seals the column on purpose, merchant.tg_
  // business_date re-derives it from created_at on update, and the day a cash sale
  // belongs to is the DRAWER's, decided at checkout from the open shift. So the
  // upsert names the column nowhere and the resume moves the lifecycle state only.
  it('upserts the cart on the caller client and never names the sealed date', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: CART }], rowCount: 1 }),
    } as unknown as PoolClient;
    const pg = { app: { query: vi.fn() }, worker: { query: vi.fn() } };
    const repository = new PosCartRepository(pg as unknown as PgService);

    await expect(repository.create(client, MERCHANT, LOCATION, OPERATOR_SESSION)).resolves.toBe(
      CART,
    );

    expect(client.query).toHaveBeenCalledTimes(2);
    const [sql, params] = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    const statement = String(sql);
    expect(statement).toMatch(/insert\s+into\s+merchant\.pos_cart\s*\(/iu);
    expect(statement).toContain("lifecycle_state='recovered'");
    // The invariant, and the reason the helper was deleted: api holds no UPDATE
    // privilege on this column, so naming it anywhere on the request path is a
    // 500. The trigger derives it, and the shift decides the sale's day.
    expect(statement).not.toContain('business_date');
    expect(statement).not.toContain('create_or_recover_pos_cart');
    expect(params).toEqual([MERCHANT, LOCATION, OPERATOR_SESSION]);
    // Nothing leaks onto a pool the caller did not scope.
    expect(pg.app.query).not.toHaveBeenCalled();
    expect(pg.worker.query).not.toHaveBeenCalled();
  });

  it('refuses the cart when the actor cannot recover it', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as unknown as PoolClient;
    const repository = new PosCartRepository({} as PgService);

    await expect(
      repository.create(client, MERCHANT, LOCATION, OPERATOR_SESSION),
    ).rejects.toMatchObject({ response: { code: 'CART_ACTOR_BUSY' } });
  });

  it('resumes an existing table account through the guarded claim path', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValue({ rows: [{ id: CART, operatorSessionId: 'previous-session' }] }),
    } as unknown as PoolClient;
    const repository = new PosCartRepository({} as PgService);
    const claim = vi.spyOn(repository, 'claimAccount').mockResolvedValue({ id: CART } as never);
    await expect(repository.create(client, MERCHANT, LOCATION, OPERATOR_SESSION)).resolves.toBe(
      CART,
    );
    expect(claim).toHaveBeenCalledWith(client, MERCHANT, LOCATION, OPERATOR_SESSION, CART);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('keeps an account already held by this session without a write', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValue({ rows: [{ id: CART, operatorSessionId: OPERATOR_SESSION }] }),
    } as unknown as PoolClient;
    const repository = new PosCartRepository({} as PgService);
    const claim = vi.spyOn(repository, 'claimAccount');
    await expect(repository.create(client, MERCHANT, LOCATION, OPERATOR_SESSION)).resolves.toBe(
      CART,
    );
    expect(claim).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});

describe('PosCartRepository.snapshotWithClient', () => {
  // The cart view carries the fired order (ADR 2026-10-07-pos-fired-order §7).
  // Without the column in the read, the till cannot tell a cart it already fired
  // from a fresh one after a restart, and would offer a second fire the server
  // answers `already_fired`.
  it('reads the order this cart created, beside its own fields', async () => {
    const cartRow = {
      id: CART,
      merchantId: MERCHANT,
      locationId: LOCATION,
      operatorSessionId: OPERATOR_SESSION,
      status: 'draft',
      version: 2,
      firedOrderId: '50000000-0000-4000-8000-000000000001',
      fulfillmentType: 'takeout',
      businessDate: '2026-10-07',
      updatedAt: '2026-10-07T12:00:00.000Z',
      currency: 'MXN',
    };
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [cartRow] })
        .mockResolvedValueOnce({ rows: [] }),
    } as unknown as PoolClient;
    const repository = new PosCartRepository({} as PgService);

    const cart = await repository.snapshotWithClient(client, MERCHANT, CART);

    const [sql] = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(sql)).toMatch(/fired_order_id/iu);
    expect(cart?.firedOrderId).toBe(cartRow.firedOrderId);
    // The order type rides the same view (plan §8.2 F3): the fire and the checkout
    // read it from here instead of assuming dine-in.
    expect(String(sql)).toMatch(/fulfillment_type/iu);
    expect(cart?.fulfillmentType).toBe('takeout');
  });
});

describe('PosCartRepository.setFulfillment', () => {
  // The order type is data (plan §7 D5). It is no longer frozen once the order
  // exists: a guest who sat down and then takes the food away is the ordinary case
  // (owner, 2026-10-12), and the order the cart already fired is re-synced so the
  // record follows the sale.
  const clientFor = (cart: Record<string, unknown>) => {
    const query = vi.fn(async (sql: unknown, ..._params: unknown[]) => {
      if (/FROM merchant\.pos_cart/i.test(String(sql))) {
        return { rowCount: 1, rows: [cart] };
      }
      if (/UPDATE merchant\.table_state/i.test(String(sql))) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [{ id: 'kitchen', version: '2', status: 'queued' }] };
    });
    return { client: { query } as unknown as PoolClient, query };
  };

  it('writes the type after the fire and carries it onto the order', async () => {
    const { client, query } = clientFor({
      locationId: LOCATION,
      tableId: null,
      firedOrderId: FIRE_ORDER,
    });
    const repository = new PosCartRepository({} as PgService);

    await expect(
      repository.setFulfillment(client, MERCHANT, CART, 3, OPERATOR_SESSION, 'takeout'),
    ).resolves.toBe(true);

    const write = query.mock.calls.find(([sql]) => /UPDATE merchant\.pos_cart/i.test(String(sql)));
    expect(String(write?.[0])).toMatch(/set\s+fulfillment_type/iu);
    // The freeze guard is gone, and the same statement clears the table.
    expect(String(write?.[0])).not.toMatch(/fired_order_id\s+is\s+null/iu);
    expect(String(write?.[0])).toMatch(/table_id=CASE WHEN \$5='takeout' THEN NULL/iu);
    // `query(sql, values)`: the values are the second argument, as pg takes them.
    expect((write?.[1] as unknown[])[4]).toBe('takeout');
    // The order the cart already fired learns the new type.
    const orderWrite = query.mock.calls.find(([sql]) =>
      /UPDATE merchant\.kitchen_order/i.test(String(sql)),
    );
    expect(orderWrite).toBeTruthy();
  });

  it('gives the table back to the floor when the account goes takeout', async () => {
    const { client, query } = clientFor({
      locationId: LOCATION,
      tableId: TABLE,
      firedOrderId: null,
    });
    const repository = new PosCartRepository({} as PgService);

    await expect(
      repository.setFulfillment(client, MERCHANT, CART, 3, OPERATOR_SESSION, 'takeout'),
    ).resolves.toBe(true);

    const released = query.mock.calls.find(([sql]) =>
      /UPDATE merchant\.table_state/i.test(String(sql)),
    );
    expect(String(released?.[0])).toMatch(/state='dirty',seated_at=NULL,party_size=NULL/iu);
    expect(released?.[1]).toEqual([MERCHANT, LOCATION, TABLE]);
  });

  it('leaves the table alone when the account stays dine in', async () => {
    const { client, query } = clientFor({
      locationId: LOCATION,
      tableId: TABLE,
      firedOrderId: null,
    });
    const repository = new PosCartRepository({} as PgService);

    await expect(
      repository.setFulfillment(client, MERCHANT, CART, 3, OPERATOR_SESSION, 'dine_in'),
    ).resolves.toBe(true);

    expect(
      query.mock.calls.some(([sql]) => /UPDATE merchant\.table_state/i.test(String(sql))),
    ).toBe(false);
  });
});

describe('PosCartRepository.fire — the second round', () => {
  const line = (id: string, fired: boolean) => ({
    id,
    productId: '60000000-0000-4000-8000-000000000001',
    productName: 'Latte',
    saleAction: 'merchandise',
    quantity: 1,
    courseNumber: 1,
    variant: null,
    modifiers: [],
    note: null,
    fired,
    price: {
      unitPrice: { minorUnits: 6500, currency: 'MXN' },
      lineSubtotal: { minorUnits: 6500, currency: 'MXN' },
      tax: { minorUnits: 1000, currency: 'MXN' },
      lineTotal: { minorUnits: 6500, currency: 'MXN' },
      taxRateBasisPoints: 1600,
    },
  });

  const cart = Cart.parse({
    id: CART,
    merchantId: MERCHANT,
    locationId: LOCATION,
    operatorSessionId: OPERATOR_SESSION,
    status: 'draft',
    version: 3,
    firedOrderId: '50000000-0000-4000-8000-000000000001',
    fulfillmentType: 'dine_in',
    items: [
      line('70000000-0000-4000-8000-000000000001', true),
      line('70000000-0000-4000-8000-000000000002', false),
    ],
    totals: {
      subtotal: { minorUnits: 13000, currency: 'MXN' },
      tax: { minorUnits: 2000, currency: 'MXN' },
      discounts: { total: { minorUnits: 0, currency: 'MXN' }, entries: [] },
      grandTotal: { minorUnits: 13000, currency: 'MXN' },
      businessDate: '2026-10-07',
    },
    checkoutEnabled: false,
    checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
    updatedAt: '2026-10-07T12:00:00.000Z',
  });

  it('appends only the unfired lines to the order the cart already owns', async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn().mockImplementation((sql: unknown) => {
        const s = String(sql);
        if (s.includes("jsonb_build_object('accountFolio'"))
          return {
            rows: [
              {
                locationId: LOCATION,
                fulfillmentType: 'dine_in',
                context: { accountFolio: 'Cuenta 001' },
                reference: 'Cuenta 001',
              },
            ],
            rowCount: 1,
          };
        if (s.includes('merchant.pos_checkout_draft')) return { rows: [], rowCount: 0 };
        statements.push(s);
        if (/FROM merchant\.pos_cart[\s\S]*FOR UPDATE/u.test(s)) {
          return {
            rows: [
              {
                firedOrderId: '50000000-0000-4000-8000-000000000001',
                version: 3,
                status: 'draft',
                lifecycleState: 'building_cart',
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT COALESCE\(MAX\(display_order\)/u.test(s)) {
          return { rows: [{ next: 1 }], rowCount: 1 };
        }
        if (/INSERT INTO merchant\.order_item\b/u.test(s)) {
          return { rows: [{ id: '80000000-0000-4000-8000-000000000001' }], rowCount: 1 };
        }
        if (/SELECT COALESCE\(external_ref,id::text\) AS reference/u.test(s)) {
          return { rows: [{ reference: 'A-101' }], rowCount: 1 };
        }
        if (/UPDATE merchant\.pos_cart SET version=version\+1/u.test(s)) {
          return { rows: [{ version: 4 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as PoolClient;
    const repository = new PosCartRepository({} as PgService);

    const result = await repository.fire(client, MERCHANT, cart, 3, OPERATOR_SESSION);

    expect(result).toEqual({
      state: 'fired',
      orderId: '50000000-0000-4000-8000-000000000001',
      reference: 'A-101',
      lineCount: 1,
      cartVersion: 4,
    });
    const joined = statements.join('\n');
    // The round grows the ORDER this cart owns; it does not mint a second one.
    expect(joined).toMatch(/INSERT INTO merchant\.order_item\b/u);
    expect(joined).not.toMatch(/INSERT INTO merchant\.customer_order/u);
    // And the lines it sent stop looking like local work.
    expect(joined).toMatch(/UPDATE merchant\.pos_cart_line l SET fired_at=now\(\)/u);
    const firedLine = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([sql]) => String(sql).includes('fired_by_user_id'),
    );
    expect(firedLine?.[1]?.[4]).toBe(OPERATOR_SESSION);
    expect(String(firedLine?.[0])).toMatch(/fired_by_user_id=.*runtime\.operator_session/u);
  });

  it('answers already_fired when there is nothing new to send', async () => {
    const empty = Cart.parse({
      ...cart,
      items: [line('70000000-0000-4000-8000-000000000001', true)],
    });
    const client = {
      query: vi.fn().mockImplementation((sql: unknown) => {
        const s = String(sql);
        if (s.includes("jsonb_build_object('accountFolio'"))
          return {
            rows: [
              {
                locationId: LOCATION,
                fulfillmentType: 'dine_in',
                context: { accountFolio: 'Cuenta 001' },
                reference: 'Cuenta 001',
              },
            ],
            rowCount: 1,
          };
        if (s.includes('merchant.pos_checkout_draft')) return { rows: [], rowCount: 0 };
        if (/FROM merchant\.pos_cart[\s\S]*FOR UPDATE/u.test(s)) {
          return {
            rows: [
              {
                firedOrderId: '50000000-0000-4000-8000-000000000001',
                version: 3,
                status: 'draft',
                lifecycleState: 'building_cart',
              },
            ],
            rowCount: 1,
          };
        }
        if (/SELECT COALESCE\(o\.external_ref,o\.id::text\)/u.test(s)) {
          return { rows: [{ reference: 'A-101', lineCount: '2' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as PoolClient;
    const repository = new PosCartRepository({} as PgService);

    const result = await repository.fire(client, MERCHANT, empty, 3, OPERATOR_SESSION);

    expect(result).toMatchObject({ state: 'already_fired', lineCount: 2 });
  });
});

describe('PosCartRepository.sweepCarriedOverAccounts — the day close', () => {
  describe('PosCartRepository.suspendAccount — an empty account is closed, not kept', () => {
    const dto = {
      cartId: CART,
      locationId: LOCATION,
      operatorSessionId: OPERATOR_SESSION,
      expectedVersion: 3,
      idempotencyKey: COMMAND,
    };

    function clientForSuspend(empty: boolean) {
      const query = vi.fn(async (sql: unknown) => {
        const statement = String(sql);
        if (/AS empty/u.test(statement)) return { rows: [{ empty }], rowCount: 1 };
        if (/UPDATE merchant\.pos_cart/u.test(statement)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });
      return { query } as unknown as PoolClient;
    }

    function suspendWrite(client: PoolClient) {
      const calls = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls;
      return calls.find(([sql]) => /UPDATE merchant\.pos_cart SET/u.test(String(sql)));
    }

    async function repository() {
      const instance = new PosCartRepository({} as PgService);
      vi.spyOn(
        instance as unknown as { snapshotWithClient: () => Promise<Cart> },
        'snapshotWithClient',
      ).mockResolvedValue({ id: CART, version: 4, items: [] } as unknown as Cart);
      return instance;
    }

    it('asks the four facts that make an account recognizable', async () => {
      // The same four the open-accounts list reads: no lines, no table, no label and no
      // fired order. Anything less and the rule would discard an account the operator
      // can see on another screen.
      const client = clientForSuspend(true);
      await (await repository()).suspendAccount(client, MERCHANT, dto);

      const read = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([sql]) =>
        /AS empty/u.test(String(sql)),
      );
      const statement = String(read?.[0]);
      expect(statement).toMatch(/c\.table_id IS NULL/u);
      expect(statement).toMatch(/c\.display_label IS NULL/u);
      expect(statement).toMatch(/c\.fired_order_id IS NULL/u);
      expect(statement).toMatch(/FROM merchant\.pos_cart_line/u);
      expect(statement).toMatch(/FOR UPDATE/u);
    });

    it('closes a cart with nothing in it and names the reason', async () => {
      // Measured 2026-10-13: `Nueva cuenta` on a cart with no lines wrote one empty
      // `suspended` record per tap — accounts 71 to 77, eight of them in 25 seconds —
      // and each one spent an account number the next customer's ticket will show.
      const client = clientForSuspend(true);
      await (await repository()).suspendAccount(client, MERCHANT, dto);

      const write = suspendWrite(client);
      const statement = String(write?.[0]);
      expect(statement).toMatch(
        /lifecycle_state=CASE WHEN \$8::boolean THEN 'cancelled' ELSE 'suspended' END/u,
      );
      expect(statement).toMatch(/status=CASE WHEN \$8::boolean THEN 'abandoned' ELSE status END/u);
      expect(statement).toMatch(/cancellation_reason_code=CASE WHEN \$8::boolean THEN 'other'/u);
      expect(write?.[1]?.[7]).toBe(true);
      expect(write?.[1]?.[8]).toBe('Cuenta vacía: se cierra al apartarla.');
    });

    it('keeps an account that holds a line', async () => {
      const client = clientForSuspend(false);
      await (await repository()).suspendAccount(client, MERCHANT, dto);

      expect(suspendWrite(client)?.[1]?.[7]).toBe(false);
    });

    it('keeps an empty cart the operator named', async () => {
      // A name is content: the operator who types one is opening an account on purpose.
      const client = clientForSuspend(true);
      await (
        await repository()
      ).suspendAccount(client, MERCHANT, {
        ...dto,
        accountName: 'Ana',
      });

      const write = suspendWrite(client);
      expect(write?.[1]?.[7]).toBe(false);
      expect(write?.[1]?.[5]).toBe(true);
      expect(write?.[1]?.[6]).toBe('Ana');
    });
  });

  // Toast's configuration, copied: the factory setting does nothing and the resolution
  // belongs to a person; a store that turns the option on gets its unpaid accounts
  // voided once the business day has turned, and only the unpaid ones (a charged sale is
  // a fact, and no clock undoes it). A voided account also hands its table back, or the
  // day close would manufacture the orphan table we already have three of.
  const clientFor = (policy: string, carts: { id: string; tableId: string | null }[]) => {
    const query = vi.fn(async (sql: unknown, ...params: unknown[]) => {
      void params;
      if (/UPDATE merchant\.pos_cart/i.test(String(sql))) {
        return { rowCount: carts.length, rows: carts };
      }
      if (/FROM merchant\.merchant/i.test(String(sql))) {
        return { rowCount: 1, rows: [{ policy }] };
      }
      return { rowCount: carts.length, rows: [] };
    });
    const client = { query, release: vi.fn() };
    const pg = {
      // The repository runs through the tenant-scoped helper; the fake is the helper.
      runWithMerchant: vi.fn(
        async (
          _merchantId: string,
          _userId: string | null,
          work: (c: unknown) => Promise<unknown>,
          _locationId?: string | null,
        ) => work(client),
      ),
    };
    return { repository: new PosCartRepository(pg as unknown as PgService), query };
  };
  const posCartWrite = (query: ReturnType<typeof vi.fn>) =>
    query.mock.calls.find(([sql]) => /UPDATE merchant\.pos_cart/i.test(String(sql)));

  it('does nothing when the setting is manual, which is the one it ships with', async () => {
    const { repository, query } = clientFor('manual', []);

    await expect(repository.sweepCarriedOverAccounts(MERCHANT, LOCATION)).resolves.toBe(0);

    expect(posCartWrite(query)).toBeUndefined();
  });

  it('voids only accounts the business day left behind, and names the reason', async () => {
    const { repository, query } = clientFor('auto_void', [{ id: CART, tableId: TABLE }]);

    await expect(repository.sweepCarriedOverAccounts(MERCHANT, LOCATION)).resolves.toBe(1);

    const write = posCartWrite(query);
    const statement = String(write?.[0]);
    expect(statement).toMatch(/status='abandoned'/iu);
    expect(statement).toMatch(/lifecycle_state='cancelled'/iu);
    expect(statement).toMatch(/cancellation_reason_code='other'/iu);
    expect(statement).toMatch(/cancelled_at=now\(\)/iu);
    // The boundary is the merchant's own: its timezone minus its business_day_start,
    // never the server's midnight.
    expect(statement).toMatch(/business_date\s*<\s*\(SELECT value FROM today\)/iu);
    expect(statement).toMatch(/at time zone m\.timezone/iu);
    expect(statement).toMatch(/m\.business_day_start::interval/iu);
    // A charged sale is never in scope.
    expect(statement).toMatch(/status IN \('draft','prepared'\)/iu);
    // A SAVED account ("guardar y salir") is out of scope, and the schema says so: its
    // only legal exit is `suspended` → `recovered`, so voiding it in one step is refused
    // by `merchant.pos_cart_lifecycle_guard` and would take the whole sweep down.
    expect(statement).toMatch(/'building_cart','ready_for_checkout','recovered'\)/iu);
    expect(statement).not.toMatch(/'suspended'/iu);
    expect(write?.[1]).toEqual([MERCHANT, LOCATION, 'Anulada por el cierre del día (auto-void)']);
  });

  it('gives the table back so the account does not leave it seated', async () => {
    const { repository, query } = clientFor('auto_void', [
      { id: CART, tableId: TABLE },
      { id: '40000000-0000-4000-8000-000000000002', tableId: null },
    ]);

    await repository.sweepCarriedOverAccounts(MERCHANT, LOCATION);

    const released = query.mock.calls.find(([sql]) =>
      /UPDATE merchant\.table_state/i.test(String(sql)),
    );
    expect(String(released?.[0])).toMatch(/state='dirty',seated_at=NULL/iu);
    expect(released?.[1]).toEqual([MERCHANT, LOCATION, [TABLE]]);
  });

  it('touches no table when the voided accounts had none', async () => {
    const { repository, query } = clientFor('auto_void', [{ id: CART, tableId: null }]);

    await expect(repository.sweepCarriedOverAccounts(MERCHANT, LOCATION)).resolves.toBe(1);

    expect(
      query.mock.calls.some(([sql]) => /UPDATE merchant\.table_state/i.test(String(sql))),
    ).toBe(false);
  });
});

describe('PosCartRepository.removeSent, when a manager authorized the void', () => {
  const dto = {
    cartId: CART,
    locationId: LOCATION,
    operatorSessionId: OPERATOR_SESSION,
    expectedVersion: 7,
    idempotencyKey: 'cart-line-cancel-approved',
    reasonCode: 'operator_mistake' as const,
    approvalId: APPROVAL,
    approvalFingerprint: voidAfterPreparationFingerprint({
      merchantId: MERCHANT,
      locationId: LOCATION,
      cartId: CART,
      lineId: LINE,
      reasonCode: 'operator_mistake',
      expectedVersion: 7,
    }),
  };

  function clientForApprovedVoid() {
    const seen: string[] = [];
    let cancelAttempts = 0;
    const client = {
      query: vi.fn(async (sql: unknown) => {
        const statement = String(sql);
        seen.push(statement);
        if (/cancel_sent_cart_line/i.test(statement)) {
          cancelAttempts += 1;
          // The kitchen already started the line, and the second attempt — the one the
          // manager's elevation pays for — is the one that cancels.
          return { rows: [{ state: cancelAttempts === 1 ? 'preparation_started' : 'cancelled' }] };
        }
        if (/UPDATE runtime\.elevation_grant/i.test(statement)) return { rows: [], rowCount: 1 };
        if (/DELETE FROM merchant\.pos_cart_line/i.test(statement))
          return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as PoolClient;
    return { client, seen, attempts: () => cancelAttempts };
  }

  it('finishes the cancel instead of reporting the forced success as a failure', async () => {
    // The envelope COMMITS a business failure, so an operation that wrote and then
    // answered "failed" would leave the kitchen ticket cancelled and the bill untouched
    // while telling the till nothing happened. That is exactly what the first cut of this
    // path did: `state` still held the refusal from the first attempt.
    const { client, seen, attempts } = clientForApprovedVoid();
    const pg = { app: { query: vi.fn() }, worker: { query: vi.fn() } };
    const repository = new PosCartRepository(pg as unknown as PgService);
    vi.spyOn(
      repository as unknown as { snapshotWithClient: () => Promise<Cart> },
      'snapshotWithClient',
    ).mockResolvedValue({ id: CART, version: 8, items: [] } as unknown as Cart);

    await expect(
      repository.removeSent(client, MERCHANT, LINE, dto, COMMAND),
    ).resolves.toMatchObject({ id: CART, version: 8 });

    expect(attempts()).toBe(2);
    expect(seen.some((sql) => /DELETE FROM merchant\.pos_cart_line/i.test(sql))).toBe(true);
  });

  it('spends the elevation against the act the manager approved', async () => {
    const { client } = clientForApprovedVoid();
    const pg = { app: { query: vi.fn() }, worker: { query: vi.fn() } };
    const repository = new PosCartRepository(pg as unknown as PgService);
    vi.spyOn(
      repository as unknown as { snapshotWithClient: () => Promise<Cart> },
      'snapshotWithClient',
    ).mockResolvedValue({ id: CART, version: 8, items: [] } as unknown as Cart);

    await repository.removeSent(client, MERCHANT, LINE, dto, COMMAND);

    const spend = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([sql]) =>
      /UPDATE runtime\.elevation_grant/i.test(String(sql)),
    );
    // Id, merchant, location, permission, fingerprint, command — the six things that make
    // the grant the manager gave cover THIS cancel and no other.
    expect(spend?.[1]).toEqual([
      APPROVAL,
      MERCHANT,
      LOCATION,
      'order.void_after_preparation.approve',
      dto.approvalFingerprint,
      COMMAND,
    ]);
  });

  it('refuses a fingerprint the manager did not approve', async () => {
    const { client } = clientForApprovedVoid();
    const pg = { app: { query: vi.fn() }, worker: { query: vi.fn() } };
    const repository = new PosCartRepository(pg as unknown as PgService);

    await expect(
      repository.removeSent(
        client,
        MERCHANT,
        LINE,
        { ...dto, approvalFingerprint: 'a'.repeat(64) },
        COMMAND,
      ),
    ).rejects.toMatchObject({ response: { code: 'APPROVAL_FINGERPRINT_MISMATCH' } });
  });

  it('names a closed business day instead of blaming the kitchen', async () => {
    // Migration 027: the account belongs to a day the merchant already counted. The
    // operator's next step is charging it or the day close, NOT fetching a manager —
    // so the answer must be its own code, and no elevation is even looked at.
    const client = {
      query: vi.fn(async (sql: unknown) => {
        if (/cancel_sent_cart_line/i.test(String(sql))) return { rows: [{ state: 'day_closed' }] };
        return { rows: [], rowCount: 1 };
      }),
    } as unknown as PoolClient;
    const pg = { app: { query: vi.fn() }, worker: { query: vi.fn() } };
    const repository = new PosCartRepository(pg as unknown as PgService);

    await expect(repository.removeSent(client, MERCHANT, LINE, dto, COMMAND)).rejects.toMatchObject(
      {
        response: { code: 'CART_LINE_DAY_CLOSED' },
      },
    );
    expect(
      (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) =>
        /UPDATE runtime\.elevation_grant/i.test(String(sql)),
      ),
    ).toBe(false);
  });
});
