import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { DevicesRepository } from './devices.repository';

/**
 * THE SOCKET HANDSHAKE MUST NOT SPEND THE POLL BUDGET.
 *
 * `pollPairing` guards the credential: it locks the row, counts the attempt, and
 * refuses the session once `polling_attempts` reaches 240. The realtime handshake
 * validates the same triplet, but a device that reconnects a socket must not burn
 * that budget, and must not push the request toward `expired` or
 * `credential_delivered` on the way past.
 *
 * Proven against a real database because the claim is about COLUMNS the code does
 * not write: `polling_attempts`, `last_polled_at`, and `state` must all read back
 * unchanged after a handshake.
 *
 * Self-seeding; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts pairing-realtime-handshake
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

const REQUEST = '9f000000-0000-4000-8000-0000000000f1';
const SESSION = '9f000000-0000-4000-8000-0000000000f2';
const POLLING_CREDENTIAL = 'polling-credential-for-the-handshake-test';
const INSTALLATION_ID = 'installation-id-for-the-handshake-test';
const SETUP_CODE = 'setup-code-for-the-handshake-test';

describe('realtime pairing handshake · reads without spending the poll budget', () => {
  let pg: PgService;
  let repo: DevicesRepository;
  let merchantId: string;
  let userId: string;

  const seed = async (
    overrides: { state?: string; attempts?: number; expiresAt?: string } = {},
  ) => {
    const state = overrides.state ?? 'awaiting_approval';
    const attempts = overrides.attempts ?? 0;
    const expiresAt = overrides.expiresAt ?? "now() + interval '5 minutes'";
    await pg.query(
      `INSERT INTO runtime.device_enrollment_request
         (id, merchant_id, display_name, device_kind, platform, setup_code_hash,
          idempotency_key, state, installation_hash, expires_at, created_by)
       VALUES ($1::uuid, $2::uuid, 'Handshake harness', 'pos_terminal', 'linux', $3,
               gen_random_uuid(), $4, $5, ${expiresAt}, $6::uuid)`,
      [REQUEST, merchantId, hash(SETUP_CODE), state, hash(INSTALLATION_ID), userId],
    );
    await pg.query(
      `INSERT INTO runtime.device_pairing_session
         (id, enrollment_request_id, polling_credential_hash, polling_attempts)
       VALUES ($1::uuid, $2::uuid, $3, $4)`,
      [SESSION, REQUEST, hash(POLLING_CREDENTIAL), attempts],
    );
  };

  const sessionRow = async () => {
    const result = await pg.query<{
      pollingAttempts: number;
      lastPolledAt: Date | null;
      credentialDeliveredAt: Date | null;
      state: string;
    }>(
      `SELECT s.polling_attempts AS "pollingAttempts", s.last_polled_at AS "lastPolledAt",
              s.credential_delivered_at AS "credentialDeliveredAt", r.state
       FROM runtime.device_pairing_session s
       JOIN runtime.device_enrollment_request r ON r.id = s.enrollment_request_id
       WHERE s.id = $1::uuid`,
      [SESSION],
    );
    return result.rows[0];
  };

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new DevicesRepository(pg);
    const merchant = await pg.query<{ id: string }>(
      `SELECT id::text FROM merchant.merchant ORDER BY created_at LIMIT 1`,
    );
    const user = await pg.query<{ id: string }>(`SELECT id::text FROM umi."user" LIMIT 1`);
    merchantId = merchant.rows[0].id;
    userId = user.rows[0].id;
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM runtime.device_enrollment_request WHERE id = $1::uuid`, [REQUEST]);
    await pg?.onModuleDestroy?.();
  });

  beforeEach(async () => {
    await pg.query(`DELETE FROM runtime.device_enrollment_request WHERE id = $1::uuid`, [REQUEST]);
  });

  it('accepts a valid triplet and leaves every poll column untouched', async () => {
    await seed();
    const before = await sessionRow();

    const found = await repo.findPairingSessionForRealtime({
      pairingSessionId: SESSION,
      pollingCredentialHash: hash(POLLING_CREDENTIAL),
      installationHash: hash(INSTALLATION_ID),
    });

    expect(found).toMatchObject({ pairingSessionId: SESSION, requestId: REQUEST });

    const after = await sessionRow();
    expect(after.pollingAttempts).toBe(before.pollingAttempts);
    expect(after.pollingAttempts).toBe(0);
    expect(after.lastPolledAt).toBeNull();
    expect(after.credentialDeliveredAt).toBeNull();
    expect(after.state).toBe('awaiting_approval');
  });

  it('refuses a wrong installation hash without touching the row', async () => {
    await seed();

    const found = await repo.findPairingSessionForRealtime({
      pairingSessionId: SESSION,
      pollingCredentialHash: hash(POLLING_CREDENTIAL),
      installationHash: hash('a different installation'),
    });

    expect(found).toBeNull();
    const after = await sessionRow();
    expect(after.pollingAttempts).toBe(0);
    expect(after.state).toBe('awaiting_approval');
  });

  it('refuses a wrong polling credential', async () => {
    await seed();

    const found = await repo.findPairingSessionForRealtime({
      pairingSessionId: SESSION,
      pollingCredentialHash: hash('a different credential'),
      installationHash: hash(INSTALLATION_ID),
    });

    expect(found).toBeNull();
  });

  it('refuses a session that already spent the poll budget', async () => {
    await seed({ attempts: 240 });

    const found = await repo.findPairingSessionForRealtime({
      pairingSessionId: SESSION,
      pollingCredentialHash: hash(POLLING_CREDENTIAL),
      installationHash: hash(INSTALLATION_ID),
    });

    expect(found).toBeNull();
  });

  it('refuses an expired session and does not mark it expired', async () => {
    await seed({ expiresAt: "now() - interval '1 minute'" });

    const found = await repo.findPairingSessionForRealtime({
      pairingSessionId: SESSION,
      pollingCredentialHash: hash(POLLING_CREDENTIAL),
      installationHash: hash(INSTALLATION_ID),
    });

    expect(found).toBeNull();
    // The read-only path reports expiry; only the poll route may write it.
    const after = await sessionRow();
    expect(after.state).toBe('awaiting_approval');
  });
});
