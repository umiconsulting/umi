import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosSaleRepository } from '../pos-sale/pos-sale.repository';
import { PosEntryRepository } from './pos-entry.repository';
import { AuthRepository } from '../auth/auth.repository';

// Run only in a disposable build-v3 database with forward migrations through 021.
describe('same device operator recovery preserves account authority', () => {
  const merchant = randomUUID(),
    location = randomUUID(),
    otherLocation = randomUUID();
  const user = randomUUID(),
    otherUser = randomUUID(),
    staff = randomUUID(),
    device = randomUUID(),
    otherDevice = randomUUID();
  const oldSession = randomUUID(),
    incoming = randomUUID(),
    oldOperator = randomUUID(),
    duplicate = randomUUID();
  const cartId = randomUUID(),
    checkoutId = randomUUID();
  const excluded = [
    { user, device: otherDevice, location },
    { user: otherUser, device, location },
    { user, device, location: otherLocation },
  ].map((scope) => ({ ...scope, session: randomUUID(), operator: randomUUID() }));
  let pg: PgService;
  let repo: PosEntryRepository;
  let carts: PosCartRepository;
  const input = (session: string = incoming) => ({
    durableSessionId: session,
    userId: user,
    deviceId: device,
    merchantId: merchant,
    locationId: location,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  const read = async () =>
    (await pg.query('SELECT * FROM merchant.pos_cart WHERE id=$1', [cartId])).rows[0];
  async function newLogin() {
    const session = randomUUID();
    await pg.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash,metadata,expires_at)
       VALUES ($1,$2,'device',$3,$4,jsonb_build_object('app','pos','operatorUserId',$5::text,'locationId',$6::text),now()+interval '1 day')`,
      [session, merchant, device, randomUUID(), user, location],
    );
    return session;
  }
  beforeAll(async () => {
    if (
      !process.env.DATABASE_URL_APP ||
      !process.env.DATABASE_URL_WORKER ||
      !new URL(process.env.DATABASE_URL_WORKER).pathname.includes('verify')
    )
      throw new Error('Set both database URLs to a disposable verification database.');
    const values = { ...process.env };
    pg = new PgService({
      get: (key: string) => values[key as keyof typeof values],
    } as unknown as ConfigService<AppConfig, true>);
    await pg.onModuleInit();
    repo = new PosEntryRepository(pg);
    carts = new PosCartRepository(pg);
    await pg.query(`INSERT INTO merchant.merchant(id,name,handle) VALUES ($1,'Resume test',$2)`, [
      merchant,
      `resume-${merchant}`,
    ]);
    for (const id of [location, otherLocation])
      await pg.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Room')`, [
        id,
        merchant,
      ]);
    await pg.query(
      `INSERT INTO umi.subscription(merchant_id,plan_id,status)
      SELECT $1,id,'active' FROM umi.plan LIMIT 1`,
      [merchant],
    );
    await pg.query(
      `INSERT INTO umi.entitlement_override(subscription_id,feature_id)
      SELECT s.id,f.id FROM umi.subscription s CROSS JOIN umi.feature f
      WHERE s.merchant_id=$1 AND f.key IN ('pos','pos.offline_cash')`,
      [merchant],
    );
    for (const id of [user, otherUser]) {
      await pg.query(`INSERT INTO umi."user"(id,full_name) VALUES ($1,'Operator')`, [id]);
      await pg.query(
        `INSERT INTO merchant.staff(id,merchant_id,user_id,role_id,name)
        SELECT $1,$2,$3,id,'Operator' FROM umi.role WHERE key='admin' AND NOT is_platform`,
        [id === user ? staff : randomUUID(), merchant, id],
      );
    }
    for (const id of [device, otherDevice])
      await pg.query(
        `INSERT INTO merchant.device(id,merchant_id,name,kind) VALUES ($1,$2,'POS','pos_terminal')`,
        [id, merchant],
      );
    const sessions = [
      { user, device, location, session: oldSession, operator: oldOperator },
      { user, device, location, session: incoming, operator: duplicate },
      ...excluded,
    ];
    for (const [index, actor] of sessions.entries()) {
      await pg.query(
        `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash,metadata,expires_at,created_at)
        VALUES ($1,$2,'device',$3,$4,jsonb_build_object('app','pos','operatorUserId',$5::text,'locationId',$6::text),
          now()+interval '1 day',now()-($7::int*interval '1 minute'))`,
        [
          actor.session,
          merchant,
          actor.device,
          randomUUID(),
          actor.user,
          actor.location,
          index === 0 ? 2 : 1,
        ],
      );
      await pg.query(
        `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,merchant_id,
        location_id,permissions,entitlements,expires_at)
        SELECT $1,$2,$3,s.id,$4,$5,$6,ARRAY['cart.write','revoked.permission'],
          '[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours'
        FROM merchant.staff s WHERE s.user_id=$3 AND s.merchant_id=$5`,
        [actor.operator, actor.session, actor.user, actor.device, merchant, actor.location],
      );
    }
    await pg.query(
      `INSERT INTO merchant.pos_cart(id,merchant_id,location_id,operator_session_id,
      original_operator_session_id,original_operator_user_id,operator_user_id,table_id,table_name,display_label)
      VALUES ($1,$2,$3,$4,$4,$5,$5,$6,'Mesa test','Cuenta con pago')`,
      [cartId, merchant, location, oldOperator, user, randomUUID()],
    );
    await pg.query(
      `INSERT INTO merchant.pos_checkout_draft(id,merchant_id,location_id,cart_id,operator_session_id,device_id,state,receipt_delivery)
      VALUES ($1,$2,$3,$4,$5,$6,'payment_unknown','{}')`,
      [checkoutId, merchant, location, cartId, oldOperator, device],
    );
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('rejects another active POS without changing its session or account', async () => {
    const before = await read();
    const actor = excluded[0];
    for (const state of ['active', 'locked']) {
      await pg.query('UPDATE runtime.operator_session SET state=$2 WHERE id=$1', [
        actor.operator,
        state,
      ]);
      await expect(repo.startOperator(input())).rejects.toMatchObject({
        response: { code: 'OPERATOR_SESSION_BUSY' },
      });
      expect(await read()).toEqual(before);
      expect(
        (await pg.query('SELECT is_active FROM runtime.session WHERE id=$1', [actor.session]))
          .rows[0].is_active,
      ).toBe(true);
    }
    // An expired session does not reserve the user's access on another POS.
    await pg.query(
      "UPDATE runtime.operator_session SET state='active',expires_at=now()-interval '1 minute' WHERE id=$1",
      [actor.operator],
    );
  });

  it('chooses the account owner over a duplicate and preserves cart, checkout and other devices', async () => {
    const before = await read();
    const operator = await repo.startOperator(input());
    expect(operator?.id).toBe(oldOperator);
    expect(operator?.permissions).toEqual(['cart.write']);
    expect(operator?.entitlements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureKey: 'pos', enabled: true }),
        expect.objectContaining({ featureKey: 'pos.offline_cash', enabled: true }),
      ]),
    );
    expect(await read()).toEqual(before);
    const session = (
      await pg.query('SELECT * FROM runtime.operator_session WHERE id=$1', [oldOperator])
    ).rows[0];
    expect(session.durable_session_id).toBe(incoming);
    expect(session.state).toBe('active');
    expect(
      (await pg.query('SELECT state FROM runtime.operator_session WHERE id=$1', [duplicate]))
        .rows[0].state,
    ).toBe('ended');
    const revoked = (await pg.query('SELECT * FROM runtime.session WHERE id=$1', [oldSession]))
      .rows[0];

    expect(revoked.is_active).toBe(false);
    expect(revoked.revoked_reason).toBe('operator_same_device_recovery');
    expect(revoked.replaced_by_id).toBe(incoming);
    for (const actor of excluded) {
      expect(
        (await pg.query('SELECT state FROM runtime.operator_session WHERE id=$1', [actor.operator]))
          .rows[0].state,
      ).toBe('active');
      expect(
        (await pg.query('SELECT is_active FROM runtime.session WHERE id=$1', [actor.session]))
          .rows[0].is_active,
      ).toBe(true);
    }
    const checkout = (
      await pg.query('SELECT * FROM merchant.pos_checkout_draft WHERE id=$1', [checkoutId])
    ).rows[0];
    expect(checkout.operator_session_id).toBe(oldOperator);
    expect(checkout.state).toBe('payment_unknown');
    expect(
      (await new PosSaleRepository(pg, carts).current(merchant, location, oldOperator))?.id,
    ).toBe(cartId);
    await expect(
      runWithRequestContext(
        {
          merchantId: merchant,
          locationId: location,
          deviceId: device,
          userId: user,
          requestId: randomUUID(),
        },
        () =>
          pg.runWithMerchant(
            merchant,
            user,
            (client) => carts.assertFinanciallyMutable(client, merchant, cartId),
            location,
          ),
      ),
    ).rejects.toMatchObject({ response: { code: 'CART_PAYMENT_UNRESOLVED' } });
    const audit = await pg.query(
      `SELECT event_type FROM runtime.security_audit_event WHERE entity_id=$1::uuid`,
      [oldOperator],
    );
    expect(audit.rows.some((row) => row.event_type === 'operator.session_resumed')).toBe(true);
  });

  it('rejects replay from the revoked durable without moving the operator back', async () => {
    expect(await repo.startOperator(input(oldSession))).toBeNull();
    expect(
      (
        await pg.query('SELECT durable_session_id FROM runtime.operator_session WHERE id=$1', [
          oldOperator,
        ])
      ).rows[0].durable_session_id,
    ).toBe(incoming);
  });

  it('rejects altered device, user, location and merchant before any recovery write', async () => {
    for (const changes of [
      { deviceId: otherDevice },
      { userId: otherUser },
      { locationId: otherLocation },
      { merchantId: randomUUID() },
    ])
      expect(await repo.startOperator({ ...input(), ...changes })).toBeNull();
    expect(
      (await pg.query('SELECT is_active FROM runtime.session WHERE id=$1', [incoming])).rows[0]
        .is_active,
    ).toBe(true);
  });

  it('serializes repeated starts and preserves the current operator identity', async () => {
    const results = await Promise.all([repo.startOperator(input()), repo.startOperator(input())]);
    expect(results.map((operator) => operator?.id)).toEqual([oldOperator, oldOperator]);
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS count FROM runtime.operator_session WHERE merchant_id=$1
      AND location_id=$2 AND device_id=$3 AND user_id=$4 AND state<>'ended'`,
          [merchant, location, device, user],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('rejects an older valid login once a newer login exists', async () => {
    const newer = randomUUID();
    await pg.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash,metadata,expires_at)
      VALUES ($1,$2,'device',$3,$4,jsonb_build_object('app','pos','operatorUserId',$5::text,'locationId',$6::text),now()+interval '1 day')`,
      [newer, merchant, device, randomUUID(), user, location],
    );
    expect(await repo.startOperator(input())).toBeNull();
    expect((await repo.startOperator(input(newer)))?.id).toBe(oldOperator);
    expect(
      (await pg.query('SELECT is_active FROM runtime.session WHERE id=$1', [incoming])).rows[0]
        .is_active,
    ).toBe(false);
  });

  it('preserves a newer PIN login created during recovery of an earlier login', async () => {
    const first = await newLogin();
    let later: string | undefined;
    const wrapped = new PosEntryRepository({
      workerTx: (work: (client: PoolClient) => Promise<unknown>) =>
        pg.workerTx(async (client) => {
          const intercepted = {
            query: async (sql: string, params: unknown[]) => {
              const result = await client.query(sql, params);
              if (sql.includes('SELECT s.id,s.created_at::text') && !later)
                later = await newLogin();
              return result;
            },
          } as unknown as PoolClient;
          return work(intercepted);
        }),
    } as PgService);
    expect((await wrapped.startOperator(input(first)))?.id).toBe(oldOperator);
    expect(later).toBeTruthy();
    expect(
      (await pg.query('SELECT is_active FROM runtime.session WHERE id=$1', [later])).rows[0]
        .is_active,
    ).toBe(true);
    expect(await repo.startOperator(input(first))).toBeNull();
    expect((await repo.startOperator(input(later)))?.id).toBe(oldOperator);
  });

  it('recovers an active account after its old durable explicitly logged out', async () => {
    const current = (
      await pg.query('SELECT durable_session_id FROM runtime.operator_session WHERE id=$1', [
        oldOperator,
      ])
    ).rows[0].durable_session_id;
    const token = (await pg.query('SELECT token_hash FROM runtime.session WHERE id=$1', [current]))
      .rows[0].token_hash;
    const before = await read();
    await new AuthRepository(pg).revokePosSession(current, user, token);
    expect(
      (await pg.query('SELECT state FROM runtime.operator_session WHERE id=$1', [oldOperator]))
        .rows[0].state,
    ).toBe('ended');
    const next = await newLogin();
    expect((await repo.startOperator(input(next)))?.id).toBe(oldOperator);
    expect(await read()).toEqual(before);
    expect(
      (await pg.query('SELECT ended_at FROM runtime.operator_session WHERE id=$1', [oldOperator]))
        .rows[0].ended_at,
    ).toBeNull();
  });

  it('avoids lock inversion with an explicit logout that already owns the old durable', async () => {
    const current = (
      await pg.query('SELECT durable_session_id FROM runtime.operator_session WHERE id=$1', [
        oldOperator,
      ])
    ).rows[0].durable_session_id;
    const token = (await pg.query('SELECT token_hash FROM runtime.session WHERE id=$1', [current]))
      .rows[0].token_hash;
    const next = await newLogin();
    let started!: () => void;
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    const logout = pg.workerTx(async (client) => {
      await client.query('SELECT id FROM runtime.session WHERE id=$1 FOR UPDATE', [current]);
      started();
      await client.query('SELECT pg_sleep(0.05)');
      const auth = new AuthRepository({
        worker: { query: client.query.bind(client) },
      } as unknown as PgService);
      await auth.revokePosSession(current, user, token);
    });
    await begin;
    const recovery = repo.startOperator(input(next));
    const [result] = await Promise.all([recovery, logout]);
    expect(result?.id).toBe(oldOperator);
    expect(
      (await pg.query('SELECT state FROM runtime.operator_session WHERE id=$1', [oldOperator]))
        .rows[0].state,
    ).toBe('active');
    expect(
      (await pg.query('SELECT is_active FROM runtime.session WHERE id=$1', [current])).rows[0]
        .is_active,
    ).toBe(false);
  });

  it('rejects revoked staff authorization before it revokes or rebinds a durable', async () => {
    const next = await newLogin();
    const before = (
      await pg.query('SELECT durable_session_id FROM runtime.operator_session WHERE id=$1', [
        oldOperator,
      ])
    ).rows[0].durable_session_id;
    await pg.query("UPDATE merchant.staff SET status='disabled' WHERE id=$1", [staff]);
    try {
      expect(await repo.startOperator(input(next))).toBeNull();
      expect(
        (await pg.query('SELECT is_active FROM runtime.session WHERE id=$1', [next])).rows[0]
          .is_active,
      ).toBe(true);
      expect(
        (
          await pg.query('SELECT durable_session_id FROM runtime.operator_session WHERE id=$1', [
            oldOperator,
          ])
        ).rows[0].durable_session_id,
      ).toBe(before);
    } finally {
      await pg.query("UPDATE merchant.staff SET status='active' WHERE id=$1", [staff]);
    }
  });

  it('rejects inconsistent historical duplicate owners without changing either account', async () => {
    const next = await newLogin();
    const otherCart = randomUUID();
    await pg.query("UPDATE runtime.operator_session SET state='active',ended_at=NULL WHERE id=$1", [
      duplicate,
    ]);
    // This fixture represents historical ownership drift that the current actor index cannot prevent.
    await pg.query(
      `INSERT INTO merchant.pos_cart(id,merchant_id,location_id,operator_session_id,
      original_operator_session_id,original_operator_user_id,operator_user_id)
      VALUES ($1,$2,$3,$4,$4,$5,$6)`,
      [otherCart, merchant, location, duplicate, user, otherUser],
    );
    const before = await read();
    try {
      await expect(repo.startOperator(input(next))).rejects.toMatchObject({
        response: { code: 'CART_ACTOR_BUSY' },
      });
      expect(await read()).toEqual(before);
      expect(
        (
          await pg.query('SELECT operator_session_id FROM merchant.pos_cart WHERE id=$1', [
            otherCart,
          ])
        ).rows[0].operator_session_id,
      ).toBe(duplicate);
      expect(
        (await pg.query('SELECT state FROM runtime.operator_session WHERE id=$1', [duplicate]))
          .rows[0].state,
      ).toBe('active');
      expect(
        (await pg.query('SELECT is_active FROM runtime.session WHERE id=$1', [next])).rows[0]
          .is_active,
      ).toBe(true);
    } finally {
      await pg.query('DELETE FROM merchant.pos_cart WHERE id=$1', [otherCart]);
      await pg.query(
        "UPDATE runtime.operator_session SET state='ended',ended_at=now() WHERE id=$1",
        [duplicate],
      );
    }
  });

  it('starts a fresh operator after logout when the ended operator has no active account', async () => {
    const actor = excluded[1];
    const token = (
      await pg.query('SELECT token_hash FROM runtime.session WHERE id=$1', [actor.session])
    ).rows[0].token_hash;
    await new AuthRepository(pg).revokePosSession(actor.session, actor.user, token);
    const next = randomUUID();
    await pg.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash,metadata,expires_at)
      VALUES ($1,$2,'device',$3,$4,jsonb_build_object('app','pos','operatorUserId',$5::text,'locationId',$6::text),now()+interval '1 day')`,
      [next, merchant, actor.device, randomUUID(), actor.user, actor.location],
    );
    const created = await repo.startOperator({ ...input(next), userId: actor.user });
    expect(created?.id).toBeTruthy();
    expect(created?.id).not.toBe(actor.operator);
    expect(
      (await pg.query('SELECT state FROM runtime.operator_session WHERE id=$1', [actor.operator]))
        .rows[0].state,
    ).toBe('ended');
  });

  it('allows only one of two simultaneous starts on different POS devices', async () => {
    const concurrentUser = randomUUID();
    await pg.query('INSERT INTO umi."user"(id,full_name) VALUES ($1,\'Concurrent operator\')', [
      concurrentUser,
    ]);
    await pg.query(
      `INSERT INTO merchant.staff(id,merchant_id,user_id,role_id,name)
      SELECT $1,$2,$3,id,'Concurrent operator' FROM umi.role WHERE key='admin' AND NOT is_platform`,
      [randomUUID(), merchant, concurrentUser],
    );
    const attempts = [device, otherDevice].map((deviceId) => ({
      ...input(randomUUID()),
      userId: concurrentUser,
      deviceId,
    }));
    for (const attempt of attempts) {
      await pg.query(
        `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash,metadata,expires_at)
        VALUES ($1,$2,'device',$3,$4,jsonb_build_object('app','pos','operatorUserId',$5::text,'locationId',$6::text),now()+interval '1 day')`,
        [
          attempt.durableSessionId,
          merchant,
          attempt.deviceId,
          randomUUID(),
          concurrentUser,
          location,
        ],
      );
    }
    const results = await Promise.allSettled(
      attempts.map((attempt) => repo.startOperator(attempt)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      response: { code: 'OPERATOR_SESSION_BUSY' },
    });
    const loser = attempts[results.findIndex((result) => result.status === 'rejected')];
    await pg.query(
      "UPDATE runtime.operator_session SET state='ended',ended_at=now() WHERE merchant_id=$1 AND user_id=$2",
      [merchant, concurrentUser],
    );
    expect((await repo.startOperator(loser))?.deviceId).toBe(loser.deviceId);
  });
});
