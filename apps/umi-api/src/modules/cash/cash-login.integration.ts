import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { CustomerSessionService } from './customer-session.service';

/**
 * A REFRESH IS A QUESTION FOR THE DATABASE, NOT FOR THE SIGNATURE.
 *
 * umi-cash verified the refresh JWT and looked the session up, so a revoked
 * session could not mint a new access token. The dashboard's refresh does NOT do
 * this — it verifies the signature and issues a new pair — which is why logging
 * out of the dashboard does not stop a captured refresh token.
 *
 * This suite pins the stateful behaviour for cash, because logout only means
 * anything if refresh honours it. `revokeByRefreshToken` sets `is_active = false`;
 * if the lookup ignored that column, logout would clear a cookie and nothing more.
 *
 * These are constraint- and column-level facts. A mocked repository returns what
 * it was told to return for the correct query and the broken one alike.
 *
 * Self-seeding against any build-v3 database; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts cash-login
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
    JWT_ACCESS_SECRET: 'login-harness-access-secret-0000000000000',
    JWT_REFRESH_SECRET: 'login-harness-refresh-secret-000000000000',
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '9f000000-0000-4000-8000-0000000000d1';
const OTHER_MERCHANT = '9f000000-0000-4000-8000-0000000000d2';
const USER = '9f000000-0000-4000-8000-0000000000d3';
const CUSTOMER = '9f000000-0000-4000-8000-0000000000d4';

describe('cash staff session · a refresh asks the database', () => {
  let pg: PgService;
  let sessions: CustomerSessionService;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    sessions = new CustomerSessionService(makeConfig(), pg);

    await pg.query(`DELETE FROM merchant.merchant WHERE id = ANY($1::uuid[])`, [
      [MERCHANT, OTHER_MERCHANT],
    ]);
    await pg.query(`DELETE FROM umi."user" WHERE id = $1::uuid`, [USER]);
    await pg.query(
      `INSERT INTO merchant.merchant (id, name, handle) VALUES
         ($1::uuid, 'Login Test', 'logintest'), ($2::uuid, 'Other', 'loginother')`,
      [MERCHANT, OTHER_MERCHANT],
    );
    await pg.query(`INSERT INTO umi."user" (id, full_name) VALUES ($1::uuid, 'Barista')`, [USER]);
    await pg.query(
      `INSERT INTO merchant.customer (id, merchant_id, name)
       VALUES ($1::uuid, $2::uuid, 'Ana')`,
      [CUSTOMER, MERCHANT],
    );
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM merchant.merchant WHERE id = ANY($1::uuid[])`, [
      [MERCHANT, OTHER_MERCHANT],
    ]);
    await pg?.query(`DELETE FROM umi."user" WHERE id = $1::uuid`, [USER]);
    await pg?.onModuleDestroy?.();
  });

  beforeEach(async () => {
    await pg.query(`DELETE FROM runtime.session WHERE merchant_id = ANY($1::uuid[])`, [
      [MERCHANT, OTHER_MERCHANT],
    ]);
  });

  const staffSession = () => sessions.createSession(USER, 'ADMIN', MERCHANT);

  it('resolves a live staff session to the user who owns it', async () => {
    const { refreshToken } = await staffSession();
    await expect(sessions.staffSessionByRefreshToken(MERCHANT, refreshToken)).resolves.toEqual({
      userId: USER,
    });
  });

  it('REFUSES a session that was logged out — the point of the whole suite', async () => {
    const { refreshToken } = await staffSession();
    await sessions.revokeByRefreshToken(MERCHANT, refreshToken);

    await expect(sessions.staffSessionByRefreshToken(MERCHANT, refreshToken)).resolves.toBeNull();
  });

  it('refuses a session past its expiry', async () => {
    const { refreshToken } = await staffSession();
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    await pg.query(
      `UPDATE runtime.session SET expires_at = now() - interval '1 second' WHERE token_hash = $1`,
      [hash],
    );

    await expect(sessions.staffSessionByRefreshToken(MERCHANT, refreshToken)).resolves.toBeNull();
  });

  it('will not let a CUSTOMER token refresh a staff session', async () => {
    // Both kinds live in runtime.session and are signed with the same secret. The
    // principal type is the only thing separating a card holder from a cashier,
    // so the lookup must assert it rather than trust the signature.
    const { refreshToken } = await sessions.createSession(CUSTOMER, 'CUSTOMER', MERCHANT);

    await expect(sessions.staffSessionByRefreshToken(MERCHANT, refreshToken)).resolves.toBeNull();
  });

  it('will not let one cafe refresh another cafe’s session', async () => {
    const { refreshToken } = await sessions.createSession(USER, 'ADMIN', OTHER_MERCHANT);

    await expect(sessions.staffSessionByRefreshToken(MERCHANT, refreshToken)).resolves.toBeNull();
  });
});
