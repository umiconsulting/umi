import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { PosCartRepository } from '../pos-cart/pos-cart.repository';
import { PosCashRepository } from './pos-cash.repository';

// Fixtures live only in the disposable build-v3 integration database.
describe('POS startup against the canonical database', () => {
  let pg: PgService;
  const merchantId = randomUUID(),
    locationId = randomUUID(),
    userId = randomUUID();
  const deviceId = randomUUID(),
    sessionId = randomUUID(),
    operatorId = randomUUID();
  const registerId = randomUUID(),
    shiftId = randomUUID();
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
    await pg.workerTx(async (client) => {
      await client.query(
        "INSERT INTO merchant.merchant(id,name,timezone,business_day_start) VALUES ($1,'POS runtime test','America/Mazatlan','04:00')",
        [merchantId],
      );
      await client.query(
        "INSERT INTO merchant.location(id,merchant_id,name) VALUES ($1,$2,'Test location')",
        [locationId, merchantId],
      );
      await client.query(
        "INSERT INTO umi.user(id,full_name,status) VALUES ($1,'Test operator','active')",
        [userId],
      );
      const staff = await client.query(
        `INSERT INTO merchant.staff(merchant_id,location_id,user_id,role_id,name)
        SELECT $1,$2,$3,id,'Test operator' FROM umi.role WHERE NOT is_platform LIMIT 1 RETURNING id`,
        [merchantId, locationId, userId],
      );
      await client.query(
        "INSERT INTO merchant.device(id,merchant_id,location_id,name,kind) VALUES ($1,$2,$3,'Test device','pos_terminal')",
        [deviceId, merchantId, locationId],
      );
      await client.query(
        "INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash) VALUES ($1,$2,'user',$3,$4)",
        [sessionId, merchantId, userId, randomUUID()],
      );
      await client.query(
        `INSERT INTO runtime.operator_session(id,durable_session_id,user_id,staff_id,device_id,merchant_id,location_id,permissions,entitlements,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY['cart.write','sale.lifecycle'],'[{"featureKey":"pos","enabled":true}]',now()+interval '1 hour')`,
        [operatorId, sessionId, userId, staff.rows[0].id, deviceId, merchantId, locationId],
      );
      await client.query(
        "INSERT INTO merchant.physical_register(id,merchant_id,location_id,display_name,public_reference,currency,assigned_device_id) VALUES ($1,$2,$3,'Test register','test-register','MXN',$4)",
        [registerId, merchantId, locationId, deviceId],
      );
      await client.query(
        `INSERT INTO merchant.cash_shift(id,merchant_id,location_id,register_id,device_id,device_credential_version,holding_device_id,holding_device_credential_version,
        opening_operator_id,responsible_operator_id,operator_session_id,currency,business_date,status,opening_command_id,opening_float_minor_units)
        VALUES ($1,$2,$3,$4,$5,1,$5,1,$6,$6,$7,'MXN',current_date,'open',$8,1000)`,
        [shiftId, merchantId, locationId, registerId, deviceId, userId, operatorId, randomUUID()],
      );
      for (let sequence = 1; sequence <= 12; sequence++) {
        await client.query(
          `INSERT INTO merchant.cash_ledger_entry(merchant_id,location_id,register_id,shift_id,sequence,entry_type,amount_minor_units,currency,command_id,business_date)
          VALUES($1,$2,$3,$4,$5,$6,$7,'MXN',$8,current_date)`,
          [
            merchantId,
            locationId,
            registerId,
            shiftId,
            sequence,
            sequence === 1 ? 'opening_float' : 'paid_in',
            sequence === 1 ? 1000 : 100,
            randomUUID(),
          ],
        );
        await client.query('UPDATE merchant.cash_shift SET ledger_sequence=$2 WHERE id=$1', [
          shiftId,
          sequence,
        ]);
      }
    });
  });
  afterAll(async () => {
    await pg?.onModuleDestroy();
  });

  it('reads twelve ledger entries in numeric order under the API role', async () => {
    const repo = new PosCashRepository(pg);
    const total = await pg.runWithMerchant(
      merchantId,
      userId,
      (client) => repo.expectedCash(client, shiftId),
      locationId,
    );
    expect(total.ledgerSequence).toBe(12);
    expect(total.expectedDrawerCash.minorUnits).toBe(2100);
    expect(total.openingFloat.minorUnits).toBe(1000);
    expect(total.paidIn.minorUnits).toBe(1100);
  });
  it('creates and recovers the same cart without permission to edit its business date', async () => {
    const repo = new PosCartRepository(pg);
    const create = () =>
      pg.runWithMerchant(
        merchantId,
        userId,
        (client) => repo.create(client, merchantId, locationId, operatorId),
        locationId,
      );
    const id = await create();
    // A cart can survive overnight. Its creation date remains authoritative.
    await pg.query("UPDATE merchant.pos_cart SET created_at=now()-interval '2 days' WHERE id=$1", [
      id,
    ]);
    const before = await pg.query('SELECT business_date::text FROM merchant.pos_cart WHERE id=$1', [
      id,
    ]);
    expect(await create()).toBe(id);
    const after = await pg.query(
      'SELECT business_date::text,lifecycle_state FROM merchant.pos_cart WHERE id=$1',
      [id],
    );
    expect(after.rows[0]).toMatchObject({ ...before.rows[0], lifecycle_state: 'recovered' });
    const permission = await pg.app.query(
      "SELECT has_column_privilege(current_user,'merchant.pos_cart','business_date','UPDATE') AS allowed",
    );
    expect(permission.rows[0].allowed).toBe(false);
  });
});
