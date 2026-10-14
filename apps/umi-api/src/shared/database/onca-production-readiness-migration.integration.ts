import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../docs/migration/build-v3/migrations/039_onca_production_readiness.sql',
  ),
  'utf8',
);

const kdsKeys = [
  'kitchen.cancel_ack',
  'kitchen.complete',
  'kitchen.prepare',
  'kitchen.read',
  'kitchen.ready',
  'kitchen.recall',
  'kitchen.station.read',
];

describe('ONCA production readiness migration', () => {
  let db: Client;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL_WORKER) {
      throw new Error('Set DATABASE_URL_WORKER to a populated local test database');
    }
    db = new Client({ connectionString: process.env.DATABASE_URL_WORKER });
    await db.connect();
    await db.query('begin');
  });

  afterAll(async () => {
    if (db) {
      await db.query('rollback');
      await db.end();
    }
  });

  it('creates only the needed roles, keeps identities untouched, and repeats without change', async () => {
    const merchant = await db.query<{ id: string }>(
      "select id::text from merchant.merchant where handle = 'onca'",
    );
    expect(merchant.rowCount).toBe(1);
    const merchantId = merchant.rows[0].id;

    const countIdentity = async () => {
      const { rows } = await db.query<{
        staff: number;
        devices: number;
        checkoutPolicies: number;
      }>(
        `select
           (select count(*)::int from merchant.staff where merchant_id=$1) as staff,
           (select count(*)::int from merchant.device where merchant_id=$1) as devices,
           (select count(*)::int from merchant.pos_checkout_policy where merchant_id=$1)
             as "checkoutPolicies"`,
        [merchantId],
      );
      return rows[0];
    };
    const before = await countIdentity();

    await db.query(sql);
    const first = await db.query<{ key: string; grants: string[]; legacyRoleId: string | null }>(
      `select r.key, r.legacy_role_id::text as "legacyRoleId",
              coalesce(array_agg(p.key order by p.key)
                filter (where p.key is not null), '{}'::text[]) as grants
         from merchant.role r
         left join merchant.role_permission rp on rp.role_id=r.id
         left join umi.permission p on p.id=rp.permission_id
        where r.merchant_id=$1 and r.key in ('admin','cashier','waiter','onca-kds')
        group by r.id order by r.key`,
      [merchantId],
    );
    expect(first.rows.map((row) => row.key)).toEqual(['admin', 'cashier', 'onca-kds', 'waiter']);
    expect(first.rows.find((row) => row.key === 'onca-kds')?.grants).toEqual(kdsKeys);
    const staffRole = await db.query<{ id: string }>(
      "select id::text from umi.role where key='staff' and not is_platform",
    );
    expect(first.rows.find((row) => row.key === 'waiter')?.legacyRoleId).toBe(staffRole.rows[0].id);

    for (const key of ['admin', 'cashier', 'waiter']) {
      const source = await db.query<{ grants: string[] }>(
        `select coalesce(array_agg(p.key order by p.key), '{}'::text[]) as grants
           from umi.role_template t
           join umi.role_template_revision_permission rp
             on rp.template_id=t.id and rp.version=t.current_version
           join umi.permission p on p.id=rp.permission_id
          where t.key=$1`,
        [key],
      );
      expect(first.rows.find((row) => row.key === key)?.grants).toEqual(source.rows[0].grants);
    }

    await db.query(sql);
    const second = await db.query<{ key: string; grants: string[]; legacyRoleId: string | null }>(
      `select r.key, r.legacy_role_id::text as "legacyRoleId",
              coalesce(array_agg(p.key order by p.key)
                filter (where p.key is not null), '{}'::text[]) as grants
         from merchant.role r
         left join merchant.role_permission rp on rp.role_id=r.id
         left join umi.permission p on p.id=rp.permission_id
        where r.merchant_id=$1 and r.key in ('admin','cashier','waiter','onca-kds')
        group by r.id order by r.key`,
      [merchantId],
    );
    expect(second.rows).toEqual(first.rows);
    expect(await countIdentity()).toEqual(before);

    const settings = await db.query<{ timezone: string; businessDayStart: string }>(
      `select timezone, business_day_start::text as "businessDayStart"
         from merchant.merchant where id=$1`,
      [merchantId],
    );
    expect(settings.rows[0]).toEqual({
      timezone: 'America/Mazatlan',
      businessDayStart: '04:00:00',
    });
  });
});
