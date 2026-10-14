import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Pool, type PoolClient } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FloorPlanDocument } from '@umi/contract';
import { FloorPlanRepository } from './floor-plan.repository';
import { FloorPlanService } from './floor-plan.service';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { TableMapRepository } from '../table-map/table-map.repository';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import type { PgService } from '../../shared/database/pg.service';

// Every fixture and audit row stays inside one transaction, then rolls back.
describe('additional tables and account visibility in PostgreSQL', () => {
  let pool: Pool, client: PoolClient, repo: FloorPlanRepository, service: FloorPlanService;
  let room: TableMapRepository, carts: PosCartRepository;
  let merchant: string, location: string, area: string, table: string, operator: string;
  let user: { id: string; sessionId: string; deviceId: string; email: null };
  let document: FloorPlanDocument;
  beforeAll(() => {
    if (!process.env.DATABASE_URL_WORKER) throw new Error('DATABASE_URL_WORKER is required');
    pool = new Pool({ connectionString: process.env.DATABASE_URL_WORKER });
  });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
    merchant = randomUUID();
    location = randomUUID();
    area = randomUUID();
    table = randomUUID();
    operator = randomUUID();
    user = { id: randomUUID(), sessionId: randomUUID(), deviceId: randomUUID(), email: null };
    const staff = randomUUID();
    await client.query(`INSERT INTO umi."user"(id,full_name) VALUES ($1,'Table test')`, [user.id]);
    await client.query(
      `INSERT INTO merchant.merchant(id,name,handle) VALUES ($1::uuid,'Table test',$1::text)`,
      [merchant],
    );
    await client.query(`INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Room')`, [
      location,
      merchant,
    ]);
    await client.query(
      `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name)
      SELECT $1,$2,$3,$4,id,'Table test' FROM umi.role WHERE NOT is_platform LIMIT 1`,
      [staff, merchant, location, user.id],
    );
    await client.query(
      `INSERT INTO merchant.device(id,merchant_id,location_id,name,kind) VALUES ($1,$2,$3,'Test','pos_terminal')`,
      [user.deviceId, merchant, location],
    );
    await client.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash)
      VALUES ($1,$2,'user',$3,$4)`,
      [user.sessionId, merchant, user.id, randomUUID()],
    );
    await client.query(
      `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY['cart.write','sale.lifecycle'],'[{"featureKey":"pos","enabled":true}]',now()+interval '1 hour')`,
      [operator, user.sessionId, user.id, staff, user.deviceId, merchant, location],
    );
    document = FloorPlanDocument.parse({
      schemaVersion: 1,
      areas: [
        {
          id: area,
          name: 'Sala',
          width: 720,
          height: 480,
          elements: [
            {
              id: table,
              label: 'Mesa 1',
              kind: 'table',
              shape: 'square',
              capacity: 4,
              x: 100,
              y: 100,
              width: 120,
              height: 120,
              rotation: 0,
            },
          ],
        },
      ],
    });
    await client.query(
      `INSERT INTO merchant.floor_plan(merchant_id,location_id,version,draft,published_version,published,published_at)
      VALUES ($1,$2,2,$3::jsonb,2,$3::jsonb,now())`,
      [merchant, location, JSON.stringify(document)],
    );
    const pg = {
      withMerchant: (work: (c: PoolClient) => Promise<unknown>) => work(client),
      runWithMerchant: (_m: string, _u: string, work: (c: PoolClient) => Promise<unknown>) =>
        work(client),
    } as unknown as PgService;
    repo = new FloorPlanRepository(pg);
    service = new FloorPlanService(repo, new IntegrityService(new IntegrityRepository(pg)));
    room = new TableMapRepository(pg);
    carts = new PosCartRepository(pg);
  });
  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });
  afterAll(async () => pool.end());
  const request = () => ({
    locationId: location,
    operatorSessionId: operator,
    areaId: area,
    label: 'Mesa extra',
    capacity: 3,
    expectedPublishedVersion: 2,
    idempotencyKey: randomUUID(),
  });
  async function snapshot() {
    return (
      await client.query(
        `SELECT draft,published,version,published_version FROM merchant.floor_plan WHERE merchant_id=$1`,
        [merchant],
      )
    ).rows[0];
  }

  it('appends once on retry, preserves occupied tables and retains unpublished edits', async () => {
    const account = await carts.openTable(client, merchant, location, operator, table);
    assert(account);
    const beforeRoom = await room.readInTransaction(client, merchant, location);
    const draft = structuredClone(document);
    draft.areas[0].elements.push({
      ...draft.areas[0].elements[0],
      id: randomUUID(),
      label: 'Borrador',
      x: 260,
    });
    await client.query(
      `UPDATE merchant.floor_plan SET draft=$2::jsonb,version=3 WHERE merchant_id=$1`,
      [merchant, JSON.stringify(draft)],
    );
    const cmd = request();
    const first = await service.addTable(user, merchant, cmd);
    expect(await service.addTable(user, merchant, cmd)).toEqual(first);
    const after = await snapshot();
    expect(after.version).toBe(4);
    expect(after.published.areas[0].elements).toHaveLength(2);
    expect(after.draft.areas[0].elements).toHaveLength(3);
    expect(after.published.areas[0].elements[0]).toEqual(document.areas[0].elements[0]);
    expect(after.draft.areas[0].elements[1]).toEqual(draft.areas[0].elements[1]);
    expect(after.draft.areas[0].elements[2]).toEqual(after.published.areas[0].elements[1]);
    expect((await room.readInTransaction(client, merchant, location)).states).toEqual(
      beforeRoom.states,
    );
    expect(beforeRoom.states[0]).toMatchObject({
      openAccountId: account.id,
      openAccountFolio: account.accountFolio,
      openAccountTableId: table,
    });
    expect(
      (
        await client.query(
          `SELECT 1 FROM merchant.audit_event WHERE merchant_id=$1 AND event_type='floor_plan.table_added'`,
          [merchant],
        )
      ).rowCount,
    ).toBe(1);
  });
  it('refuses a stale version without changing the plan', async () => {
    const before = await snapshot();
    await expect(
      repo.addTable(client, user, merchant, { ...request(), expectedPublishedVersion: 1 }),
    ).rejects.toMatchObject({ response: { code: 'OPTIMISTIC_VERSION_CONFLICT' } });
    expect(await snapshot()).toEqual(before);
  });
  it('refuses duplicate labels in either snapshot', async () => {
    await expect(
      repo.addTable(client, user, merchant, { ...request(), label: 'mesa 1' }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect((await snapshot()).version).toBe(2);
    const draft = structuredClone(document);
    draft.areas[0].elements.push({
      ...draft.areas[0].elements[0],
      id: randomUUID(),
      label: 'Mesa extra',
      x: 260,
    });
    await client.query(`UPDATE merchant.floor_plan SET draft=$2::jsonb WHERE merchant_id=$1`, [
      merchant,
      JSON.stringify(draft),
    ]);
    await expect(repo.addTable(client, user, merchant, request())).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect((await snapshot()).draft).toEqual(draft);
  });
  it('refuses a changed payload under the same command key', async () => {
    const cmd = request();
    await service.addTable(user, merchant, cmd);
    const before = await snapshot();
    await expect(
      service.addTable(user, merchant, { ...cmd, label: 'Otra mesa' }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(await snapshot()).toEqual(before);
  });
  it('refuses a full area without changing either document', async () => {
    const full = structuredClone(document);
    full.areas[0].height = 5000;
    full.areas[0].elements.push({
      id: randomUUID(),
      kind: 'counter',
      shape: 'rectangle',
      label: 'Occupied space',
      capacity: 0,
      x: 360,
      y: 2500,
      width: 720,
      height: 5000,
      rotation: 0,
    });
    await client.query(
      `UPDATE merchant.floor_plan SET draft=$2::jsonb,published=$2::jsonb WHERE merchant_id=$1`,
      [merchant, JSON.stringify(full)],
    );
    const before = await snapshot();
    await expect(repo.addTable(client, user, merchant, request())).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
    expect(await snapshot()).toEqual(before);
  });
  it('preserves a pending draft that removed the selected area', async () => {
    const draft = structuredClone(document);
    draft.areas[0].id = randomUUID();
    await client.query(`UPDATE merchant.floor_plan SET draft=$2::jsonb WHERE merchant_id=$1`, [
      merchant,
      JSON.stringify(draft),
    ]);
    await expect(repo.addTable(client, user, merchant, request())).rejects.toMatchObject({
      response: { code: 'FLOOR_PLAN_DRAFT_PENDING' },
    });
    expect((await snapshot()).draft).toEqual(draft);
  });
  it('requires a cart writer on the enrolled device and the requested location', async () => {
    await expect(
      repo.addTable(client, { ...user, deviceId: randomUUID() }, merchant, request()),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await expect(
      repo.addTable(client, user, merchant, { ...request(), locationId: randomUUID() }),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
    await client.query(
      `UPDATE runtime.operator_session SET permissions=ARRAY['sale.lifecycle'] WHERE id=$1`,
      [operator],
    );
    await expect(repo.addTable(client, user, merchant, request())).rejects.toMatchObject({
      response: { code: 'PERMISSION_DENIED' },
    });
    expect((await snapshot()).version).toBe(2);
  });
  it('cannot release an open account; closing it keeps occupancy until an explicit departure', async () => {
    const account = await carts.openTable(client, merchant, location, operator, table);
    assert(account);
    await client.query('SAVEPOINT guard_check');
    await expect(room.clear(client, merchant, location, { tableId: table })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('TABLE_HAS_OPEN_ACCOUNT'),
    });
    await client.query('ROLLBACK TO SAVEPOINT guard_check');
    await client.query(
      `UPDATE merchant.pos_cart SET status='committed',lifecycle_state='committed' WHERE id=$1`,
      [account.id],
    );
    expect((await room.readInTransaction(client, merchant, location)).states[0]).toMatchObject({
      state: 'seated',
      openAccountId: null,
    });
    expect(await room.clear(client, merchant, location, { tableId: table })).toMatchObject([
      { state: 'dirty' },
    ]);
    expect(await room.openTable(client, merchant, location, { tableId: table })).toMatchObject([
      { state: 'open' },
    ]);
  });
  it('projects the open account to every member of a joined group', async () => {
    const account = await carts.openTable(client, merchant, location, operator, table);
    assert(account);
    const group = randomUUID(),
      other = randomUUID();
    await client.query(`UPDATE merchant.table_state SET group_id=$2 WHERE table_id=$1`, [
      table,
      group,
    ]);
    await client.query(
      `INSERT INTO merchant.table_state(merchant_id,location_id,table_id,state,seated_at,party_size,group_id)
      VALUES ($1,$2,$3,'seated',now(),1,$4)`,
      [merchant, location, other, group],
    );
    const map = await room.readInTransaction(client, merchant, location);
    expect(map.states).toHaveLength(2);
    expect(
      map.states.every(
        (state) => state.openAccountId === account.id && state.openAccountTableId === table,
      ),
    ).toBe(true);
    document.areas[0].elements.push({
      ...document.areas[0].elements[0],
      id: other,
      label: 'Mesa 2',
      x: 260,
    });
    await client.query(
      `UPDATE merchant.floor_plan SET draft=$2::jsonb,published=$2::jsonb WHERE merchant_id=$1`,
      [merchant, JSON.stringify(document)],
    );
    await client.query('SAVEPOINT group_guard_check');
    await expect(room.clear(client, merchant, location, { tableId: other })).rejects.toMatchObject({
      code: '23514',
      message: expect.stringContaining('TABLE_HAS_OPEN_ACCOUNT'),
    });
    await client.query('ROLLBACK TO SAVEPOINT group_guard_check');
    expect((await room.readInTransaction(client, merchant, location)).states).toEqual(map.states);
  });
});
