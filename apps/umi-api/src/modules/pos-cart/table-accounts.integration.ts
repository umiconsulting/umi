import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Cart } from '@umi/contract';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { TableMapRepository } from '../table-map/table-map.repository';
import type { AuthUser } from '../auth/auth.types';
import { PosCartRepository } from './pos-cart.repository';

// Run against a disposable build-v3 database with migrations 018 and 020.
describe('table accounts under the API role', () => {
  const merchant = randomUUID(),
    location = randomUUID(),
    table = randomUUID();
  const actors = [0, 1].map(() => ({
    user: randomUUID(),
    staff: randomUUID(),
    device: randomUUID(),
    session: randomUUID(),
    operator: randomUUID(),
  }));
  let pg: PgService;
  let repo: PosCartRepository;
  const scoped = <T>(fn: Parameters<PgService['runWithMerchant']>[2]) =>
    pg.runWithMerchant(merchant, null, fn, location) as Promise<T>;
  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error('Set both database URLs to a disposable build-v3 database.');
    const values = { ...process.env, JWT_SECRET: 'table-account-test-secret-000000000000000' };
    pg = new PgService({
      get: (key: string) => values[key as keyof typeof values],
    } as unknown as ConfigService<AppConfig, true>);
    await pg.onModuleInit();
    repo = new PosCartRepository(pg);
    await pg.query(`INSERT INTO merchant.merchant(id,name,handle) VALUES ($1,'Accounts test',$2)`, [
      merchant,
      `accounts-${merchant}`,
    ]);
    await pg.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Room')`, [
      location,
      merchant,
    ]);
    for (const actor of actors) {
      await pg.query(`INSERT INTO umi."user"(id,full_name) VALUES ($1,'Account operator')`, [
        actor.user,
      ]);
      await pg.query(
        `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name)
        SELECT $1,$2,$3,$4,id,'Account operator' FROM umi.role WHERE NOT is_platform LIMIT 1`,
        [actor.staff, merchant, location, actor.user],
      );
      await pg.query(
        `INSERT INTO merchant.device(id,merchant_id,location_id,name,kind)
        VALUES ($1,$2,$3,'Tablet','pos_terminal')`,
        [actor.device, merchant, location],
      );
      await pg.query(
        `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash)
        VALUES ($1,$2,'user',$3,$4)`,
        [actor.session, merchant, actor.user, randomUUID()],
      );
      await pg.query(
        `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY['cart.write','order.fire'],'[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')`,
        [actor.operator, actor.session, actor.user, actor.staff, actor.device, merchant, location],
      );
    }
    const plan = {
      areas: [
        {
          id: randomUUID(),
          elements: [{ id: table, kind: 'table', label: 'Mesa 1', capacity: 4 }],
        },
      ],
    };
    await pg.query(
      `INSERT INTO merchant.floor_plan(merchant_id,location_id,version,draft,published_version,published,published_at)
      VALUES ($1,$2,1,$3::jsonb,1,$3::jsonb,now())`,
      [merchant, location, JSON.stringify(plan)],
    );
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('allows a cart writer to read tables while lifecycle writes remain restricted', async () => {
    const actor = actors[0];
    const user = { id: actor.user, sessionId: actor.session, deviceId: actor.device } as AuthUser;
    const tables = new TableMapRepository(pg);
    await expect(
      tables.readForPos(user, merchant, {
        locationId: location,
        operatorSessionId: actor.operator,
      }),
    ).resolves.toMatchObject({ locationId: location });
    await expect(
      scoped((client) => tables.assertOperator(client, user, merchant, location, actor.operator)),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('refuses to open a table that exists only in the draft plan', async () => {
    await pg.query(
      `UPDATE merchant.floor_plan SET published=NULL,published_version=0,published_at=NULL
      WHERE merchant_id=$1 AND location_id=$2`,
      [merchant, location],
    );
    await expect(
      scoped((client) => repo.openTable(client, merchant, location, actors[0].operator, table)),
    ).rejects.toMatchObject({ response: { code: 'TABLE_NOT_IN_PLAN' } });
    expect(await repo.openAccountIds(merchant, location)).toEqual([]);
    await pg.query(
      `UPDATE merchant.floor_plan SET published=draft,published_version=version,published_at=now()
      WHERE merchant_id=$1 AND location_id=$2`,
      [merchant, location],
    );
  });

  it('persists one visit, transfers only on claim, and rejects stale or busy actors', async () => {
    const first = await scoped<Cart>((client) =>
      repo.openTable(client, merchant, location, actors[0].operator, table),
    );
    expect(first.tableId).toBe(table);
    expect(first.tableVisitId).toBeTruthy();
    expect(first.tableName).toBe('Mesa 1');
    expect(await repo.openAccountIds(merchant, location)).toEqual([first.id]);
    const read = await repo.readAccount(merchant, location, first.id);
    expect(read?.operatorSessionId).toBe(actors[0].operator);
    expect(read?.accountOwnerActive).toBe(true);
    await pg.query("UPDATE runtime.operator_session SET state='ended',ended_at=now() WHERE id=$1", [
      actors[0].operator,
    ]);
    const released = await repo.readAccount(merchant, location, first.id);
    expect(released?.accountOwnerActive).toBe(false);
    expect(released?.operatorSessionId).toBe(actors[0].operator);
    expect(released?.version).toBe(first.version);
    await pg.query("UPDATE runtime.operator_session SET state='active',ended_at=NULL WHERE id=$1", [
      actors[0].operator,
    ]);
    await expect(
      scoped((client) =>
        repo.claimAccount(client, merchant, location, actors[1].operator, first.id, first.version),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_ACCOUNT_BUSY' } });
    await expect(
      scoped((client) =>
        repo.suspendAccount(client, merchant, {
          cartId: first.id,
          locationId: location,
          operatorSessionId: actors[0].operator,
          expectedVersion: first.version + 1,
          idempotencyKey: randomUUID(),
        }),
      ),
    ).resolves.toBeNull();
    await pg.query(
      `INSERT INTO merchant.pos_payment_attempt
      (merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,query_only,correlation_id)
      VALUES ($1,$2,$3,'external_terminal',100,'MXN','unknown',true,$4)`,
      [merchant, location, first.id, randomUUID()],
    );
    await expect(
      scoped((client) =>
        repo.suspendAccount(client, merchant, {
          cartId: first.id,
          locationId: location,
          operatorSessionId: actors[0].operator,
          expectedVersion: first.version,
          idempotencyKey: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    await expect(
      scoped((client) =>
        repo.openTable(client, merchant, location, actors[0].operator, table, first.version),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    await expect(
      scoped((client) =>
        repo.claimAccount(client, merchant, location, actors[1].operator, first.id, first.version),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    await expect(
      scoped((client) => repo.assertFinanciallyMutable(client, merchant, first.id)),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    await expect(
      scoped((client) => repo.fire(client, merchant, first, first.version, actors[0].operator)),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    await pg.query(`DELETE FROM merchant.pos_payment_attempt WHERE merchant_id=$1 AND cart_id=$2`, [
      merchant,
      first.id,
    ]);
    await pg.query(
      `INSERT INTO merchant.pos_checkout_draft
      (merchant_id,location_id,cart_id,operator_session_id,device_id,state,receipt_delivery)
      VALUES ($1,$2,$3,$4,$5,'collecting_payment','{}'::jsonb)`,
      [merchant, location, first.id, actors[0].operator, actors[0].device],
    );
    const saved = await scoped<Cart>((client) =>
      repo.suspendAccount(client, merchant, {
        cartId: first.id,
        locationId: location,
        operatorSessionId: actors[0].operator,
        expectedVersion: first.version,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(saved.lifecycleState).toBe('suspended');
    await expect(
      scoped((client) =>
        repo.claimAccount(client, merchant, location, actors[1].operator, first.id, first.version),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_VERSION_CONFLICT' } });
    const claimed = await scoped<Cart>((client) =>
      repo.claimAccount(client, merchant, location, actors[1].operator, first.id, saved.version),
    );
    expect(claimed.operatorSessionId).toBe(actors[1].operator);
    expect(claimed.tableVisitId).toBe(first.tableVisitId);
    expect(claimed.version).toBe(saved.version + 1);
    await expect(
      scoped((client) =>
        client.query(
          `UPDATE merchant.table_state SET state='dirty',seated_at=NULL,party_size=NULL
      WHERE merchant_id=$1 AND location_id=$2 AND table_id=$3`,
          [merchant, location, table],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('TABLE_HAS_OPEN_ACCOUNT'),
    });
    await pg.query(`UPDATE runtime.operator_session SET state='locked' WHERE id=$1`, [
      actors[1].operator,
    ]);
    const recovered = await scoped<Cart>((client) =>
      repo.claimAccount(client, merchant, location, actors[0].operator, first.id, claimed.version),
    );
    expect(recovered.id).toBe(first.id);
    expect(recovered.tableVisitId).toBe(first.tableVisitId);
    await scoped((client) =>
      client.query(
        `UPDATE merchant.pos_cart SET status='committed',lifecycle_state='committed'
      WHERE merchant_id=$1 AND id=$2`,
        [merchant, first.id],
      ),
    );
    expect(await repo.openAccountIds(merchant, location)).toEqual([]);
    expect(await repo.readAccount(merchant, location, first.id)).toBeNull();
    const next = await scoped<Cart>((client) =>
      repo.openTable(client, merchant, location, actors[0].operator, table),
    );
    expect(next.id).not.toBe(first.id);
    expect(next.tableVisitId).toBe(first.tableVisitId);
    await scoped((client) =>
      client.query(
        `UPDATE merchant.pos_cart SET status='abandoned',lifecycle_state='cancelled'
      WHERE merchant_id=$1 AND id=$2`,
        [merchant, next.id],
      ),
    );
    await scoped((client) =>
      client.query(
        `UPDATE merchant.table_state SET state='dirty',seated_at=NULL,party_size=NULL
      WHERE merchant_id=$1 AND location_id=$2 AND table_id=$3`,
        [merchant, location, table],
      ),
    );
    const newParty = await scoped<Cart>((client) =>
      repo.openTable(client, merchant, location, actors[0].operator, table),
    );
    expect(newParty.tableVisitId).not.toBe(first.tableVisitId);
    expect(await repo.readAccount(randomUUID(), location, newParty.id)).toBeNull();
  });
  it('keeps suspended accounts without a table available to another actor', async () => {
    const currentId = await repo.activeCartId(merchant, location, actors[0].operator);
    const current = await repo.snapshot(merchant, location, currentId!);
    await scoped((client) =>
      repo.suspendAccount(client, merchant, {
        cartId: current!.id,
        locationId: location,
        operatorSessionId: actors[0].operator,
        expectedVersion: current!.version,
        idempotencyKey: randomUUID(),
      }),
    );
    const counterId = await scoped<string>((client) =>
      repo.create(client, merchant, location, actors[0].operator),
    );
    const counter = await repo.readAccount(merchant, location, counterId);
    expect(counter?.tableId).toBeNull();
    // THE COUNTER ACCOUNT HOLDS A LINE BEFORE IT IS SAVED. `suspendAccount` closes a
    // cart with no lines, no table, no name and no fired order instead of saving it: an
    // account nobody can charge is not an account, and saving it would spend the next
    // account number (2026-10-13, accounts 71 to 77 in `merchant.pos_cart`). So the
    // fixture gives the counter something to keep before it puts it aside.
    const product = randomUUID();
    await pg.query(
      `INSERT INTO merchant.product(id,merchant_id,name,price) VALUES ($1,$2,'Coffee',100)`,
      [product, merchant],
    );
    await pg.query(
      `INSERT INTO merchant.pos_cart_line(merchant_id,cart_id,product_id,identity_key,product_name,
      quantity,base_price,tax_rate_basis_points) VALUES ($1,$2,$3,$4,'Coffee',1,100,0)`,
      [merchant, counterId, product, 'a'.repeat(64)],
    );
    const holdable = await repo.readAccount(merchant, location, counterId);
    const saved = await scoped<Cart>((client) =>
      repo.suspendAccount(client, merchant, {
        cartId: counterId,
        locationId: location,
        operatorSessionId: actors[0].operator,
        expectedVersion: holdable!.version,
        idempotencyKey: randomUUID(),
      }),
    );
    expect(await repo.openAccountIds(merchant, location)).toContain(counterId);
    await pg.query(
      `UPDATE runtime.operator_session SET state='active',expires_at=now()+interval '2 hours' WHERE id=$1`,
      [actors[1].operator],
    );
    const claimed = await scoped<Cart>((client) =>
      repo.claimAccount(client, merchant, location, actors[1].operator, counterId, saved.version),
    );
    expect(claimed.id).toBe(counterId);
    expect(claimed.tableId).toBeNull();
    expect(claimed.operatorSessionId).toBe(actors[1].operator);
    expect((await repo.readAccount(merchant, location, counterId))?.operatorSessionId).toBe(
      actors[1].operator,
    );
  });
  it('recovers the same operator table account after the prior session ends', async () => {
    const actor = actors[0];
    const first = await scoped<Cart>((client) =>
      repo.openTable(client, merchant, location, actor.operator, table),
    );
    const product = randomUUID();
    await pg.query(
      `INSERT INTO merchant.product(id,merchant_id,name,price) VALUES ($1,$2,'Recovery drink',5000)`,
      [product, merchant],
    );
    await pg.query(
      `INSERT INTO merchant.pos_cart_line(merchant_id,cart_id,product_id,identity_key,product_name,quantity,base_price,tax_rate_basis_points)
      VALUES ($1,$2,$3,$4,'Recovery drink',2,5000,0)`,
      [merchant, first.id, product, 'b'.repeat(64)],
    );
    const before = (await repo.readAccount(merchant, location, first.id))!;
    const session = randomUUID(),
      replacement = randomUUID();
    await pg.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash)
      VALUES ($1,$2,'user',$3,$4)`,
      [session, merchant, actor.user, randomUUID()],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session
      (id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY['cart.write','order.fire'],'[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')`,
      [replacement, session, actor.user, actor.staff, actors[1].device, merchant, location],
    );
    await expect(
      scoped((client) => repo.create(client, merchant, location, replacement)),
    ).rejects.toMatchObject({ response: { code: 'CART_ACCOUNT_BUSY' } });
    expect((await repo.readAccount(merchant, location, first.id))?.operatorSessionId).toBe(
      actor.operator,
    );
    await pg.query(`UPDATE runtime.operator_session SET state='ended',ended_at=now() WHERE id=$1`, [
      actor.operator,
    ]);
    const payment = randomUUID();
    await pg.query(
      `INSERT INTO merchant.pos_payment_attempt
      (id,merchant_id,location_id,cart_id,method,amount_minor_units,currency,status,query_only,correlation_id)
      VALUES ($1,$2,$3,$4,'external_terminal',100,'MXN','unknown',true,$5)`,
      [payment, merchant, location, first.id, randomUUID()],
    );
    await expect(
      scoped((client) => repo.create(client, merchant, location, replacement)),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    await pg.query(`UPDATE merchant.pos_payment_attempt SET status='cancelled' WHERE id=$1`, [
      payment,
    ]);
    const id = await scoped<string>((client) =>
      repo.create(client, merchant, location, replacement),
    );
    const recovered = (await repo.readAccount(merchant, location, id))!;
    expect(id).toBe(first.id);
    expect(recovered.operatorSessionId).toBe(replacement);
    const original = await pg.query<{ id: string }>(
      `SELECT original_operator_session_id::text AS id FROM merchant.pos_cart WHERE id=$1`,
      [id],
    );
    expect(original.rows[0].id).toBe(actor.operator);
    expect(recovered.tableId).toBe(before.tableId);
    expect(recovered.tableVisitId).toBe(before.tableVisitId);
    expect(recovered.accountFolio).toBe(before.accountFolio);
    expect(recovered.items).toEqual(before.items);
    expect(recovered.totals).toEqual(before.totals);
    expect(recovered.version).toBe(before.version + 1);
    await expect(
      scoped((client) => repo.create(client, merchant, location, replacement)),
    ).resolves.toBe(id);
    expect((await repo.readAccount(merchant, location, id))?.version).toBe(recovered.version);
  });

  it('keeps the waiter baseline free of payment permissions and invalidates changed grants', async () => {
    const baseline = await pg.query<{ key: string }>(`SELECT p.key FROM umi.role_template t
      JOIN umi.role_template_revision_permission rp ON rp.template_id=t.id AND rp.version=t.current_version
      JOIN umi.permission p ON p.id=rp.permission_id WHERE t.key='waiter' ORDER BY p.key`);
    expect(baseline.rows.map((row) => row.key)).toEqual([
      'cart.write',
      'catalog.read',
      'order.fire',
    ]);
    const role = randomUUID();
    await pg.query(
      `INSERT INTO merchant.role(id,merchant_id,key,name) VALUES ($1,$2,'waiter-test','Waiter test')`,
      [role, merchant],
    );
    await pg.query(
      `INSERT INTO merchant.role_permission(merchant_id,role_id,permission_id)
      SELECT $1,$2,id FROM umi.permission WHERE key IN ('cart.write','catalog.read','order.fire')`,
      [merchant, role],
    );
    await pg.query(`UPDATE merchant.staff SET merchant_role_id=$1 WHERE id=$2`, [
      role,
      actors[1].staff,
    ]);
    const effective = await pg.query<{ permissions: string[] }>(
      `SELECT umi.resolve_staff_permissions($1) AS permissions`,
      [actors[1].staff],
    );
    expect(effective.rows[0].permissions).toEqual(['cart.write', 'catalog.read', 'order.fire']);
    let session = await pg.query<{ state: string }>(
      `SELECT state FROM runtime.operator_session WHERE id=$1`,
      [actors[1].operator],
    );
    expect(session.rows[0].state).toBe('ended');
    await pg.query(`UPDATE runtime.operator_session SET state='active',ended_at=NULL WHERE id=$1`, [
      actors[1].operator,
    ]);
    await pg.query(
      `DELETE FROM merchant.role_permission WHERE role_id=$1
      AND permission_id=(SELECT id FROM umi.permission WHERE key='order.fire')`,
      [role],
    );
    session = await pg.query<{ state: string }>(
      `SELECT state FROM runtime.operator_session WHERE id=$1`,
      [actors[1].operator],
    );
    expect(session.rows[0].state).toBe('ended');
  });
});
