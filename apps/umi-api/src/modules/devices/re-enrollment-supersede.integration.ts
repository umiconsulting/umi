import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { DevicesRepository } from './devices.repository';

/**
 * RE-ENROLLING AN INSTALLATION MUST NOT COLLIDE WITH ITS OWN PREVIOUS DEVICE.
 *
 * A till that loses its credential claims a new setup code with the SAME `installation_hash`, and
 * the partial unique index `device_active_installation_uq` refuses a second active row for one
 * installation. Before this test's fix the approve let the INSERT hit that index: the dashboard got
 * `INTERNAL_ERROR` (marked retryable, so retrying was the obvious advice and could never work) and
 * the till waited on "Se requiere la aprobación del administrador" forever — measured on the iMin
 * on 2026-10-11, `detail=duplicate key value violates unique constraint
 * "device_active_installation_uq"`.
 *
 * Proven against a real database because the claim is about ROWS: the previous device has to come
 * back `replaced` with its credential cleared, and exactly one active device may carry the
 * installation afterwards. Self-seeding; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts re-enrollment-supersede
 */

const APP_DSN = process.env.DATABASE_URL_APP ?? '';
const WORKER_DSN = process.env.DATABASE_URL_WORKER ?? '';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

const REQUEST = '9f000000-0000-4000-8000-0000000000e1';
const SESSION = '9f000000-0000-4000-8000-0000000000e2';
const OLD_DEVICE = '9f000000-0000-4000-8000-0000000000e3';
const INSTALLATION_ID = 'installation-id-for-the-re-enrollment-test';
const SETUP_CODE = 'setup-code-for-the-re-enrollment-test';
const POLLING_CREDENTIAL = 'polling-credential-for-the-re-enrollment-test';

describe('re-enrolling one installation supersedes its previous device', () => {
  let pg: PgService;
  let repo: DevicesRepository;
  let merchantId: string;
  let locationId: string;
  let userId: string;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new DevicesRepository(pg);
    const merchant = await pg.query<{ id: string }>(
      `SELECT id::text FROM merchant.merchant ORDER BY created_at LIMIT 1`,
    );
    merchantId = merchant.rows[0].id;
    const location = await pg.query<{ id: string }>(
      `SELECT id::text FROM merchant.location WHERE merchant_id = $1::uuid LIMIT 1`,
      [merchantId],
    );
    locationId = location.rows[0].id;
    const user = await pg.query<{ id: string }>(`SELECT id::text FROM umi."user" LIMIT 1`);
    userId = user.rows[0].id;
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM runtime.device_enrollment_request WHERE id = $1::uuid`, [REQUEST]);
    await pg?.query(`DELETE FROM merchant.device WHERE installation_hash = $1`, [
      hash(INSTALLATION_ID),
    ]);
    await pg?.onModuleDestroy?.();
  });

  it("retires the installation's active device and activates the new one", async () => {
    await pg.query(`DELETE FROM runtime.device_enrollment_request WHERE id = $1::uuid`, [REQUEST]);
    await pg.query(`DELETE FROM merchant.device WHERE installation_hash = $1`, [
      hash(INSTALLATION_ID),
    ]);
    await pg.query(
      `INSERT INTO merchant.device
         (id, merchant_id, location_id, name, kind, status, platform,
          installation_hash, credential_hash, credential_version, mobility)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Till que perdió su credencial', 'pos_terminal',
               'active', 'android', $4, $5, 1, 'static')`,
      [OLD_DEVICE, merchantId, locationId, hash(INSTALLATION_ID), hash('old-credential')],
    );
    await pg.query(
      `INSERT INTO runtime.device_enrollment_request
         (id, merchant_id, location_id, display_name, device_kind, platform, setup_code_hash,
          idempotency_key, state, installation_hash, expires_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Till re-registrado', 'pos_terminal', 'android', $4,
               gen_random_uuid(), 'awaiting_approval', $5, now() + interval '5 minutes', $6::uuid)`,
      [REQUEST, merchantId, locationId, hash(SETUP_CODE), hash(INSTALLATION_ID), userId],
    );
    await pg.query(
      `INSERT INTO runtime.device_pairing_session
         (id, enrollment_request_id, polling_credential_hash, polling_attempts)
       VALUES ($1::uuid, $2::uuid, $3, 0)`,
      [SESSION, REQUEST, hash(POLLING_CREDENTIAL)],
    );

    const decision = await repo.decidePairing({
      merchantId,
      requestId: REQUEST,
      actorUserId: userId,
      idempotencyKey: '9f000000-0000-4000-8000-0000000000e4',
      approve: true,
      credentialHash: hash('fresh-credential'),
      allowedBranchIds: null,
    });

    expect(decision).toMatchObject({ enrollmentRequestId: REQUEST, state: 'credential_ready' });

    const retired = await pg.query<{
      status: string;
      credentialHash: string | null;
      replacementDeviceId: string | null;
    }>(
      `SELECT status, credential_hash AS "credentialHash",
              replacement_device_id::text AS "replacementDeviceId"
       FROM merchant.device WHERE id = $1::uuid`,
      [OLD_DEVICE],
    );
    expect(retired.rows[0]).toMatchObject({ status: 'replaced', credentialHash: null });
    expect(retired.rows[0].replacementDeviceId).toBeTruthy();

    const active = await pg.query<{ id: string; status: string }>(
      `SELECT id::text, status FROM merchant.device
       WHERE merchant_id = $1::uuid AND installation_hash = $2 AND status = 'active'`,
      [merchantId, hash(INSTALLATION_ID)],
    );
    expect(active.rows).toHaveLength(1);
    expect(active.rows[0].id).toBe(retired.rows[0].replacementDeviceId);
  });
});
