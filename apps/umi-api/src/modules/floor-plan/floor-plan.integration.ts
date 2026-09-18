import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { FloorPlanDocument } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { runWithRequestContext } from '../../shared/database/request-context';
import type { MerchantAccess } from '../auth/auth.types';
import { IntegrityRepository } from '../integrity/integrity.repository';
import { IntegrityService } from '../integrity/integrity.service';
import { FloorPlanRepository } from './floor-plan.repository';
import { FloorPlanService } from './floor-plan.service';

// Run against a disposable build-v3 database. Audit rows are immutable.
describe('floor-plan publication under real RLS', () => {
  let pg: PgService;
  let service: FloorPlanService;
  const merchantId = randomUUID();
  const locationId = randomUUID();
  const otherLocationId = randomUUID();
  const access: MerchantAccess = {
    merchantId,
    locationId,
    name: 'Floor plan test',
    handle: null,
    timezone: null,
    membershipId: null,
    role: 'owner',
    roles: ['owner'],
    permissions: ['merchant.manage'],
  };
  const document = FloorPlanDocument.parse({
    schemaVersion: 1,
    areas: [
      {
        id: randomUUID(),
        name: 'Dining room',
        width: 1200,
        height: 800,
        elements: [
          {
            id: randomUUID(),
            kind: 'table',
            shape: 'round',
            label: 'T1',
            capacity: 4,
            x: 100,
            y: 100,
            width: 80,
            height: 80,
            rotation: 0,
          },
        ],
      },
    ],
  });
  const scoped = <T>(fn: () => Promise<T>, scope = locationId, merchant = merchantId) =>
    runWithRequestContext(
      { merchantId: merchant, locationId: scope, userId: null, requestId: randomUUID() },
      fn,
    );
  const command = (expectedVersion: number) => ({
    locationId,
    expectedVersion,
    idempotencyKey: randomUUID(),
  });

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_APP || !process.env.DATABASE_URL_WORKER)
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a disposable build-v3 database.',
      );
    pg = new PgService({ get: (key: string) => process.env[key] } as unknown as ConfigService<
      AppConfig,
      true
    >);
    await pg.onModuleInit();
    service = new FloorPlanService(
      new FloorPlanRepository(pg),
      new IntegrityService(new IntegrityRepository(pg)),
    );
    await pg.query('INSERT INTO merchant.merchant(id,name) VALUES ($1,$2)', [
      merchantId,
      'Floor plan test',
    ]);
    await pg.query(
      'INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,$3),($4,$2,$5)',
      [locationId, merchantId, 'Dining room', otherLocationId, 'Terrace'],
    );
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('saves once on retry, publishes a snapshot, and isolates later draft changes', async () => {
    expect(await scoped(() => service.read(access, locationId))).toMatchObject({
      version: 0,
      published: null,
    });
    const save = { ...command(0), document };
    const first = await scoped(() => service.change(access, save));
    expect(first).toMatchObject({ version: 1, published: null });
    expect(await scoped(() => service.change(access, save))).toEqual(first);
    const publication = command(1);
    const published = await scoped(() => service.change(access, publication));
    expect(published).toMatchObject({ version: 2, publishedVersion: 2, published: document });
    expect(await scoped(() => service.change(access, publication))).toEqual(published);
    const changed = structuredClone(document);
    changed.areas[0].elements[0].label = 'T2';
    const next = await scoped(() => service.change(access, { ...command(2), document: changed }));
    expect(next).toMatchObject({
      version: 3,
      publishedVersion: 2,
      published: document,
      draft: changed,
    });
    const audit = await pg.query(
      'SELECT public_data FROM merchant.audit_event WHERE merchant_id=$1 AND event_type=$2',
      [merchantId, 'floor_plan.published'],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].public_data.document).toEqual(document);
  });
  it('rejects an incomplete published snapshot at the database boundary', async () => {
    await expect(
      scoped(() =>
        pg.withMerchant((client) =>
          client.query(
            'UPDATE merchant.floor_plan SET published=null WHERE merchant_id=$1 AND location_id=$2',
            [merchantId, locationId],
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('rejects stale versions and idempotency key reuse with a different payload', async () => {
    await expect(
      scoped(() => service.change(access, { ...command(0), document })),
    ).rejects.toMatchObject({ status: 409 });
    const save = { ...command(3), document };
    await scoped(() => service.change(access, save));
    await expect(
      scoped(() => service.change(access, { ...save, expectedVersion: 4 })),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('allows only one concurrent writer at a version', async () => {
    const results = await Promise.allSettled([
      scoped(() => service.change(access, { ...command(4), document })),
      scoped(() => service.change(access, { ...command(4), document })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
  it('rejects unauthorized branch switches before a write', async () => {
    await expect(
      scoped(() =>
        service.change(access, { ...command(5), locationId: otherLocationId, document }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('hides a plan from another location or merchant at the database boundary', async () => {
    const read = () =>
      pg.withMerchant((client) => client.query('SELECT * FROM merchant.floor_plan'));
    expect((await scoped(read, otherLocationId)).rows).toHaveLength(0);
    expect((await scoped(read, locationId, randomUUID())).rows).toHaveLength(0);
  });
  it('serves only published content to a valid operator and rejects locked sessions', async () => {
    const userId = randomUUID(),
      deviceId = randomUUID(),
      sessionId = randomUUID(),
      staffId = randomUUID(),
      operatorSessionId = randomUUID();
    await pg.query('INSERT INTO umi.user(id,full_name,status) VALUES ($1,$2,$3)', [
      userId,
      'Test operator',
      'active',
    ]);
    await pg.query(
      `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name)
      SELECT $1,$2,$3,$4,id,'Test operator' FROM umi.role WHERE NOT is_platform LIMIT 1`,
      [staffId, merchantId, locationId, userId],
    );
    await pg.query(
      'INSERT INTO merchant.device(id,merchant_id,location_id,name,kind) VALUES ($1,$2,$3,$4,$5)',
      [deviceId, merchantId, locationId, 'Test device', 'pos_terminal'],
    );
    await pg.query(
      `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash)
      VALUES ($1,$2,'user',$3,$4)`,
      [sessionId, merchantId, userId, randomUUID()],
    );
    await pg.query(
      `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY['sale.lifecycle'],'[{"featureKey":"pos","enabled":true}]',now()+interval '1 hour')`,
      [operatorSessionId, sessionId, userId, staffId, deviceId, merchantId, locationId],
    );
    const user = { id: userId, deviceId, sessionId, email: null };
    const query = { locationId, operatorSessionId };
    const published = await service.readForPos(user, merchantId, query);
    expect(published).toMatchObject({ publishedVersion: 2, published: document });
    expect(published).not.toHaveProperty('draft');
    await expect(
      service.readForPos(user, merchantId, { ...query, locationId: otherLocationId }),
    ).rejects.toMatchObject({ status: 403 });
    await pg.query("UPDATE runtime.operator_session SET state='locked' WHERE id=$1", [
      operatorSessionId,
    ]);
    await expect(service.readForPos(user, merchantId, query)).rejects.toMatchObject({
      status: 403,
    });
  });
  it('rejects a POS request without an enrolled device or active operator', async () => {
    const user = { id: randomUUID(), email: null, sessionId: randomUUID(), deviceId: null };
    const query = { locationId, operatorSessionId: randomUUID() };
    await expect(service.readForPos(user, merchantId, query)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      service.readForPos({ ...user, deviceId: randomUUID() }, merchantId, query),
    ).rejects.toMatchObject({ status: 403 });
  });
});
