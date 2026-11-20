import { createHash, scryptSync, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgService } from '../../shared/database/pg.service';
import { DevicesRepository } from './devices.repository';
import { DevicesService } from './devices.service';
import { PosEntryRepository } from '../pos-entry/pos-entry.repository';

const merchantId = 'a1100000-0000-4000-8000-000000000001';
const locationId = 'a1100000-0000-4000-8000-000000000002';
const userId = 'a1100000-0000-4000-8000-000000000003';
const code = 'TESTREV1';
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const admin = new Client({
  connectionString:
    process.env.DATABASE_URL_ADMIN ??
    'postgresql://postgres:postgres@127.0.0.1:5233/umi_build_v3_ci',
});
const config = {
  get: (key: string) =>
    (
      ({
        DATABASE_URL_APP:
          process.env.DATABASE_URL_APP ??
          'postgresql://api_login:harness_api@127.0.0.1:5233/umi_build_v3_ci',
        DATABASE_URL_WORKER:
          process.env.DATABASE_URL_WORKER ??
          'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_build_v3_ci',
        JWT_SECRET: 'test-review-secret-not-used-in-production',
      }) as Record<string, string | undefined>
    )[key],
};
let pg: PgService;
let service: DevicesService;

describe('store review access stays within the reserved demo merchant', () => {
  beforeAll(async () => {
    await admin.connect();
    pg = new PgService(config as never);
    await pg.onModuleInit();
    await admin.query(
      `INSERT INTO merchant.merchant(id,name,status) VALUES($1,'Review integration','active') ON CONFLICT(id) DO NOTHING`,
      [merchantId],
    );
    await admin.query(
      `INSERT INTO merchant.location(id,merchant_id,name,status) VALUES($1,$2,'Review integration','active') ON CONFLICT(id) DO NOTHING`,
      [locationId, merchantId],
    );
    await admin.query(
      `INSERT INTO umi."user"(id,email,full_name,status) VALUES($1,'review-integration@umi.invalid','Review integration','active') ON CONFLICT(id) DO NOTHING`,
      [userId],
    );
    await admin.query(
      `INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name,status)
      SELECT 'a1100000-0000-4000-8000-000000000004',$1,$2,$3,id,'Review integration','active' FROM umi.role WHERE key='owner' AND NOT is_platform ON CONFLICT(merchant_id,user_id) DO NOTHING`,
      [merchantId, locationId, userId],
    );
    await admin.query(
      `INSERT INTO runtime.app_review_access(merchant_id,location_id,created_by,setup_code_hash,enabled)
      VALUES($1,$2,$3,$4,true) ON CONFLICT(merchant_id) DO UPDATE SET enabled=true,setup_code_hash=excluded.setup_code_hash`,
      [merchantId, locationId, userId, hash(code)],
    );
    service = new DevicesService(
      new DevicesRepository(pg),
      config as never,
      {} as never,
      { hit: () => ({ allowed: true }) } as never,
      { emitPairingChanged: () => {} } as never,
    );
  });

  afterAll(async () => {
    if (admin) {
      await admin.query('DELETE FROM runtime.app_review_access WHERE merchant_id=$1', [merchantId]);
      await admin.query(
        'DELETE FROM runtime.device_pairing_session WHERE enrollment_request_id IN (SELECT id FROM runtime.device_enrollment_request WHERE merchant_id=$1)',
        [merchantId],
      );
      await admin.query('DELETE FROM runtime.device_enrollment_request WHERE merchant_id=$1', [
        merchantId,
      ]);
      await admin.query('DELETE FROM runtime.operator_session WHERE merchant_id=$1', [merchantId]);
      await admin.query('DELETE FROM runtime.session WHERE merchant_id=$1', [merchantId]);
      await admin.query('DELETE FROM merchant.device WHERE merchant_id=$1', [merchantId]);
      for (const table of [
        'physical_register',
        'pos_checkout_policy',
        'cash_shift_policy',
        'pos_exception_policy',
        'product',
        'product_category',
        'loyalty_program',
      ]) {
        await admin.query(`DELETE FROM merchant.${table} WHERE merchant_id=$1`, [merchantId]);
      }
      await admin.query('DELETE FROM umi.subscription WHERE merchant_id=$1', [merchantId]);
      await admin.query('DELETE FROM merchant.merchant WHERE id=$1', [merchantId]);
      await admin.query('DELETE FROM umi."user" WHERE id=$1', [userId]);
      await admin.end();
    }
    await pg?.onModuleDestroy();
  });

  it('delivers independent normal credentials for two fresh installations and permits reenrollment', async () => {
    const devices = [];
    for (const installationId of [
      'review-first-install',
      'review-second-install',
      'review-first-install',
    ]) {
      const pairing = await service.claim(
        { setupCode: code, installationId, platform: 'android', deviceType: 'pos_terminal' },
        '127.0.0.1',
      );
      const credential = await service.poll(
        pairing.pairingSessionId,
        { installationId, pollingCredential: pairing.pollingCredential },
        '127.0.0.1',
      );
      expect(credential.state).toBe('credential_delivered');
      expect(credential.device?.merchantId).toBe(merchantId);
      expect(credential.device?.locationId).toBe(locationId);
      expect(credential.credential).toBeTruthy();
      const authenticated = await service.authenticate(
        credential.device!.publicId,
        installationId,
        credential.credential!,
      );
      expect(authenticated.id).toBe(credential.device!.id);
      devices.push(credential);
    }
    expect(new Set(devices.map((d) => d.device!.id)).size).toBe(3);
    expect(new Set(devices.map((d) => d.credential)).size).toBe(3);
    await expect(
      service.authenticate(
        devices[0].device!.publicId,
        'review-first-install',
        devices[0].credential!,
      ),
    ).rejects.toThrow();
    await expect(
      service.authenticate(
        devices[1].device!.publicId,
        'review-first-install',
        devices[1].credential!,
      ),
    ).rejects.toThrow();
  });

  it('rejects disabled access and cannot configure another merchant or write through application roles', async () => {
    await expect(
      admin.query(
        `UPDATE runtime.app_review_access SET merchant_id=gen_random_uuid() WHERE merchant_id=$1`,
        [merchantId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pg.worker.query('UPDATE runtime.app_review_access SET enabled=false'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(pg.app.query('SELECT * FROM runtime.app_review_access')).rejects.toMatchObject({
      code: '42501',
    });
    await admin.query('UPDATE runtime.app_review_access SET enabled=false WHERE merchant_id=$1', [
      merchantId,
    ]);
    await expect(
      service.claim(
        {
          setupCode: code,
          installationId: 'disabled-install',
          platform: 'android',
          deviceType: 'pos_terminal',
        },
        '127.0.0.1',
      ),
    ).rejects.toThrow();
  });
  it('seeds repeatedly and preserves the enrollment secret when API verification fails', async () => {
    await admin.query("UPDATE merchant.merchant SET name='UmiPOS Google Play Demo' WHERE id=$1", [
      merchantId,
    ]);
    await admin.query('UPDATE umi."user" SET email=\'play-review@umipos.invalid\' WHERE id=$1', [
      userId,
    ]);
    let failLogin = true;
    let failPin = false;
    let pinUpdates = 0;
    const server = createServer((request, response) => {
      void (async () => {
        response.statusCode = (request.url?.includes('/login') ? failLogin : failPin) ? 503 : 200;
        if (request.method === 'PATCH' && response.statusCode === 200) {
          pinUpdates += 1;
          const salt = 'ab'.repeat(16);
          await admin.query(
            'UPDATE merchant.staff SET operator_pin_salt=$1,operator_pin_hash=$2,operator_pin_lookup=$3 WHERE user_id=$4 AND merchant_id=$5',
            [
              salt,
              scryptSync('482619', salt, 64).toString('hex'),
              hash('test-only-lookup'),
              userId,
              merchantId,
            ],
          );
        }
        response.setHeader('content-type', 'application/json');
        response.end('{}');
      })().catch(() => {
        response.statusCode = 500;
        response.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local API port');
    const seed = (setupCode = code, operatorPin = '482619') =>
      promisify(execFile)(process.execPath, ['../../scripts/umi-play-review-seed.mjs'], {
        env: {
          ...process.env,
          DATABASE_URL:
            process.env.DATABASE_URL_ADMIN ??
            'postgresql://postgres:postgres@127.0.0.1:5233/umi_build_v3_ci',
          REVIEW_API_URL: `http://127.0.0.1:${address.port}`,
          REVIEW_SEED_CONFIRM: 'isolated-demo',
          REVIEW_SETUP_CODE: setupCode,
          REVIEW_ADMIN_PASSWORD: 'test-only-password-long-enough',
          REVIEW_OPERATOR_PIN: operatorPin,
        },
      });
    try {
      await expect(seed()).rejects.toThrow();
      expect(
        (
          await admin.query('SELECT enabled FROM runtime.app_review_access WHERE merchant_id=$1', [
            merchantId,
          ])
        ).rows[0].enabled,
      ).toBe(false);
      failLogin = false;
      await seed();
      await seed();
      expect(pinUpdates).toBe(1);
      expect(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM merchant.product WHERE merchant_id=$1',
            [merchantId],
          )
        ).rows[0].n,
      ).toBe(4);
      const register = await admin.query(
        'SELECT display_name,assignment_policy FROM merchant.physical_register WHERE merchant_id=$1',
        [merchantId],
      );
      expect(register.rows).toEqual([
        { display_name: 'Google Play Demo', assignment_policy: 'operator_selects' },
      ]);
      failPin = true;
      await expect(seed(code, '482620')).rejects.toThrow();
      await expect(seed('NEWCODE1')).rejects.toThrow();
      const grant = (
        await admin.query(
          'SELECT setup_code_hash,enabled FROM runtime.app_review_access WHERE merchant_id=$1',
          [merchantId],
        )
      ).rows[0];
      expect(grant).toMatchObject({ setup_code_hash: hash(code), enabled: true });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
  it('starts the demo on a replacement installation while keeping normal operator exclusivity', async () => {
    const repo = new PosEntryRepository(pg);
    const inputs = [];
    for (let i = 0; i < 3; i++) {
      const deviceId = randomUUID();
      const durableSessionId = randomUUID();
      await admin.query(
        `INSERT INTO merchant.device(id,merchant_id,location_id,name,kind,platform)
         VALUES($1,$2,$3,'Review replacement','pos_terminal','android')`,
        [deviceId, merchantId, locationId],
      );
      await admin.query(
        `INSERT INTO runtime.session(id,merchant_id,principal_type,principal_id,token_hash,metadata,expires_at)
         VALUES($1,$2,'device',$3,$4,jsonb_build_object('app','pos','operatorUserId',$5::text,'locationId',$6::text),now()+interval '1 day')`,
        [durableSessionId, merchantId, deviceId, hash(durableSessionId), userId, locationId],
      );
      inputs.push({
        durableSessionId,
        deviceId,
        userId,
        merchantId,
        locationId,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }
    expect(await repo.startOperator(inputs[0])).toMatchObject({ deviceId: inputs[0].deviceId });
    expect(await repo.startOperator(inputs[1])).toMatchObject({ deviceId: inputs[1].deviceId });
    await admin.query('UPDATE runtime.app_review_access SET enabled=false WHERE merchant_id=$1', [
      merchantId,
    ]);
    await expect(repo.startOperator(inputs[2])).rejects.toMatchObject({
      response: { code: 'OPERATOR_SESSION_BUSY' },
    });
    await admin.query('UPDATE runtime.app_review_access SET enabled=true WHERE merchant_id=$1', [
      merchantId,
    ]);
    const otherLocation = randomUUID();
    await admin.query(
      "INSERT INTO merchant.location(id,merchant_id,name) VALUES($1,$2,'Other location')",
      [otherLocation, merchantId],
    );
    await admin.query('UPDATE runtime.app_review_access SET location_id=$2 WHERE merchant_id=$1', [
      merchantId,
      otherLocation,
    ]);
    await expect(repo.startOperator(inputs[2])).rejects.toMatchObject({
      response: { code: 'OPERATOR_SESSION_BUSY' },
    });
    await admin.query('UPDATE runtime.app_review_access SET location_id=$2 WHERE merchant_id=$1', [
      merchantId,
      locationId,
    ]);
    const otherUser = randomUUID();
    await admin.query(`INSERT INTO umi."user"(id,full_name) VALUES($1,'Other owner')`, [otherUser]);
    await admin.query('UPDATE runtime.app_review_access SET created_by=$2 WHERE merchant_id=$1', [
      merchantId,
      otherUser,
    ]);
    await expect(repo.startOperator(inputs[2])).rejects.toMatchObject({
      response: { code: 'OPERATOR_SESSION_BUSY' },
    });
    await admin.query('UPDATE runtime.app_review_access SET created_by=$2 WHERE merchant_id=$1', [
      merchantId,
      userId,
    ]);
    await admin.query('DELETE FROM umi."user" WHERE id=$1', [otherUser]);
    await admin.query("UPDATE merchant.device SET platform='ios' WHERE id=$1", [
      inputs[2].deviceId,
    ]);
    await expect(repo.startOperator(inputs[2])).rejects.toMatchObject({
      response: { code: 'OPERATOR_SESSION_BUSY' },
    });
    await admin.query("UPDATE merchant.device SET platform='android' WHERE id=$1", [
      inputs[2].deviceId,
    ]);
    expect(await repo.startOperator(inputs[2])).toMatchObject({ deviceId: inputs[2].deviceId });
  });
});
