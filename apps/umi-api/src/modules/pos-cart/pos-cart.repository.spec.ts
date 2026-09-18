import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { PgService } from '../../shared/database/pg.service';
import { PosCartRepository } from './pos-cart.repository';

const MERCHANT = '10000000-0000-4000-8000-000000000001';
const LOCATION = '20000000-0000-4000-8000-000000000001';
const OPERATOR_SESSION = '30000000-0000-4000-8000-000000000001';
const CART = '40000000-0000-4000-8000-000000000001';

describe('PosCartRepository.create', () => {
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
      query: vi.fn().mockResolvedValue({ rows: [{ id: CART }], rowCount: 1 }),
    } as unknown as PoolClient;
    const pg = { app: { query: vi.fn() }, worker: { query: vi.fn() } };
    const repository = new PosCartRepository(pg as unknown as PgService);

    await expect(repository.create(client, MERCHANT, LOCATION, OPERATOR_SESSION)).resolves.toBe(
      CART,
    );

    expect(client.query).toHaveBeenCalledTimes(1);
    const [sql, params] = (client.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
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

  it('keeps branch_not_allowed when the upsert inserts no row', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as unknown as PoolClient;
    const repository = new PosCartRepository({} as PgService);

    await expect(repository.create(client, MERCHANT, LOCATION, OPERATOR_SESSION)).rejects.toThrow(
      'branch_not_allowed',
    );
  });
});
