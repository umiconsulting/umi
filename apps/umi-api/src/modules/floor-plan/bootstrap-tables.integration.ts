import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { FloorPlanDocument, InitializePosTablesRequest } from '@umi/contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { FloorPlanRepository } from './floor-plan.repository';
import { FloorPlanService } from './floor-plan.service';

// Use a disposable build-v3 database. The API pool enforces merchant and location RLS.
describe('POS initial table grid under real API authorization and RLS', () => {
  const merchant = randomUUID(),
    user = randomUUID(),
    device = randomUUID(),
    staff = randomUUID();
  let pg: PgService;
  let service: FloorPlanService;
  type Actor = { location: string; operator: string; durable: string };
  let initialized: Actor;
  let first: InitializePosTablesRequest;
  const actorUser = (actor: Actor) => ({
    id: user,
    email: null,
    deviceId: device,
    sessionId: actor.durable,
  });
  const scoped = <T>(actor: Actor, work: () => Promise<T>) =>
    runWithRequestContext(
      {
        merchantId: merchant,
        locationId: actor.location,
        userId: user,
        deviceId: device,
        requestId: randomUUID(),
      },
      work,
    );
  const request = (
    actor: Actor,
    slots = [0, 1],
    expectedPublishedVersion = 0,
  ): InitializePosTablesRequest => ({
    locationId: actor.location,
    operatorSessionId: actor.operator,
    idempotencyKey: randomUUID(),
    expectedPublishedVersion,
    slots,
  });
  const bootstrap = (actor: Actor, dto = request(actor)) =>
    scoped(actor, () => service.bootstrapTables(actorUser(actor), merchant, dto));
  const state = async (actor: Actor) =>
    (
      await pg.query('SELECT * FROM merchant.floor_plan WHERE merchant_id=$1 AND location_id=$2', [
        merchant,
        actor.location,
      ])
    ).rows[0];
  async function actor(): Promise<Actor> {
    const result = { location: randomUUID(), operator: randomUUID(), durable: randomUUID() };
    await pg.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Room')`, [
      result.location,
      merchant,
    ]);
    await pg.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash)
      VALUES ($1,$2,'user',$3,$4)`,
      [result.durable, merchant, user, randomUUID()],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,
      merchant_id,location_id,permissions,entitlements,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,
      ARRAY['cart.write'],'[{"featureKey":"pos","enabled":true}]',now()+interval '2 hours')`,
      [result.operator, result.durable, user, staff, device, merchant, result.location],
    );
    return result;
  }
  const room = (elements: unknown[] = []) =>
    FloorPlanDocument.parse({
      schemaVersion: 1,
      areas: [
        {
          id: randomUUID(),
          name: 'Prepared room',
          width: 800,
          height: 800,
          elements,
        },
      ],
    });
  const wall = () => ({
    id: randomUUID(),
    kind: 'wall',
    shape: 'rectangle',
    label: 'Wall',
    capacity: 0,
    x: 400,
    y: 400,
    width: 200,
    height: 20,
    rotation: 0,
  });
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
    service = new FloorPlanService(
      new FloorPlanRepository(pg),
      new IntegrityService(new IntegrityRepository(pg)),
    );
    await pg.query(`INSERT INTO merchant.merchant(id,name,handle) VALUES ($1,'POS grid test',$2)`, [
      merchant,
      `grid-${merchant}`,
    ]);
    await pg.query(`INSERT INTO umi."user"(id,full_name) VALUES ($1,'Waiter')`, [user]);
    await pg.query(
      `INSERT INTO merchant.staff(id,merchant_id,user_id,role_id,name)
      SELECT $1,$2,$3,id,'Waiter' FROM umi.role WHERE key='staff' AND NOT is_platform`,
      [staff, merchant, user],
    );
    await pg.query(
      `INSERT INTO merchant.device(id,merchant_id,name,kind) VALUES ($1,$2,'Portable','pos_terminal')`,
      [device, merchant],
    );
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('creates selected slots, publishes once and returns the same identities on retry', async () => {
    initialized = await actor();
    first = request(initialized, [49, 5, 0]);
    const result = await bootstrap(initialized, first);
    expect(result.publishedVersion).toBe(1);
    const tables = result.published!.areas.flatMap((area) => area.elements);
    expect(
      tables.map((table) => ({
        label: table.label,
        x: table.x,
        y: table.y,
        capacity: table.capacity,
      })),
    ).toEqual([
      { label: 'Mesa 1', x: 100, y: 100, capacity: 4 },
      { label: 'Mesa 2', x: 260, y: 260, capacity: 4 },
      { label: 'Mesa 3', x: 260, y: 2020, capacity: 4 },
    ]);
    expect(new Set(tables.map((table) => table.id)).size).toBe(3);
    expect(await bootstrap(initialized, first)).toEqual(result);
    expect((await state(initialized)).version).toBe(1);
    expect(
      (
        await pg.query(
          `SELECT count(*)::int AS count FROM merchant.audit_event
      WHERE merchant_id=$1 AND event_type='floor_plan.tables_initialized'`,
          [merchant],
        )
      ).rows[0].count,
    ).toBe(1);
    await expect(bootstrap(initialized, { ...first, slots: [0] })).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
  });

  it('refuses a second initialization without changing the published tables', async () => {
    const before = await state(initialized);
    await expect(bootstrap(initialized, request(initialized, [0, 1, 2], 1))).rejects.toMatchObject({
      response: { code: 'FLOOR_PLAN_ALREADY_CONFIGURED' },
    });
    expect(await state(initialized)).toEqual(before);
  });

  it('allows only one concurrent initialization at the expected published version', async () => {
    const fresh = await actor();
    const results = await Promise.allSettled([
      bootstrap(fresh, request(fresh, [0, 1])),
      bootstrap(fresh, request(fresh, [4, 5])),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await state(fresh)).published_version).toBe(1);
    expect(
      FloorPlanDocument.parse((await state(fresh)).published).areas.flatMap(
        (area) => area.elements,
      ),
    ).toHaveLength(2);
  });

  it('preserves published room elements and an empty prepared room', async () => {
    for (const elements of [[wall()], []]) {
      const fresh = await actor();
      const document = room(elements);
      await pg.query(
        `INSERT INTO merchant.floor_plan(merchant_id,location_id,version,draft,published_version,published,published_at)
        VALUES ($1,$2,1,$3,1,$3,now())`,
        [merchant, fresh.location, JSON.stringify(document)],
      );
      const result = await bootstrap(fresh, request(fresh, [0], 1));
      expect(result.published!.areas.find((area) => area.id === document.areas[0].id)).toEqual(
        document.areas[0],
      );
      expect(
        result
          .published!.areas.flatMap((area) => area.elements)
          .filter((element) => element.kind === 'table'),
      ).toHaveLength(1);
    }
  });

  it('refuses a prepared unpublished draft and preserves all prepared elements', async () => {
    const fresh = await actor();
    const draft = room([wall()]);
    await pg.query(
      `INSERT INTO merchant.floor_plan(merchant_id,location_id,version,draft) VALUES ($1,$2,1,$3)`,
      [merchant, fresh.location, JSON.stringify(draft)],
    );
    const before = await state(fresh);
    await expect(bootstrap(fresh)).rejects.toMatchObject({
      response: { code: 'FLOOR_PLAN_DRAFT_PENDING' },
    });
    expect(await state(fresh)).toEqual(before);
  });

  it('refuses locked, expired, different device, durable and location actors, including a cached retry', async () => {
    await pg.query("UPDATE runtime.operator_session SET state='locked' WHERE id=$1", [
      initialized.operator,
    ]);
    await expect(bootstrap(initialized, first)).rejects.toMatchObject({
      response: { code: 'PERMISSION_DENIED' },
    });
    await pg.query("UPDATE runtime.operator_session SET state='active' WHERE id=$1", [
      initialized.operator,
    ]);
    const fresh = await actor();
    for (const changes of [
      { deviceId: randomUUID() },
      { sessionId: randomUUID() },
      { id: randomUUID() },
    ])
      await expect(
        scoped(fresh, () =>
          service.bootstrapTables({ ...actorUser(fresh), ...changes }, merchant, request(fresh)),
        ),
      ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await expect(
      bootstrap(fresh, { ...request(fresh), locationId: initialized.location }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await pg.query(
      "UPDATE runtime.operator_session SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [fresh.operator],
    );
    await expect(bootstrap(fresh)).rejects.toMatchObject({
      response: { code: 'PERMISSION_DENIED' },
    });
    expect(await state(fresh)).toBeUndefined();
  });

  it('refuses creation around a legacy occupied table without changing its visit', async () => {
    const fresh = await actor();
    const table = randomUUID();
    await pg.query(
      `INSERT INTO merchant.table_state(merchant_id,location_id,table_id,state,seated_at,party_size)
      VALUES ($1,$2,$3,'seated',now(),2)`,
      [merchant, fresh.location, table],
    );
    const before = (
      await pg.query('SELECT * FROM merchant.table_state WHERE merchant_id=$1 AND table_id=$2', [
        merchant,
        table,
      ])
    ).rows[0];
    await expect(bootstrap(fresh)).rejects.toMatchObject({
      response: { code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED' },
    });
    expect(await state(fresh)).toBeUndefined();
    expect(
      (
        await pg.query('SELECT * FROM merchant.table_state WHERE merchant_id=$1 AND table_id=$2', [
          merchant,
          table,
        ])
      ).rows[0],
    ).toEqual(before);
  });

  it('validates unique bounded grid slots at the public contract', () => {
    const valid = request(initialized, [0, 49]);
    expect(InitializePosTablesRequest.safeParse(valid).success).toBe(true);
    for (const slots of [
      [],
      [0, 0],
      [-1],
      [50],
      [0.5],
      Array.from({ length: 51 }, (_, index) => index),
    ])
      expect(InitializePosTablesRequest.safeParse({ ...valid, slots }).success).toBe(false);
  });
});
