import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { CustomerSessionService } from './customer-session.service';

/**
 * ENDING A SESSION IS A THREE-COLUMN WRITE — proven against a real database.
 *
 * `runtime.session` carries `session_revocation_ck`:
 *
 *     check (is_active = (revoked_at is null))
 *
 * so a revoke that clears `is_active` and forgets `revoked_at` does not write a
 * half-revoked row. It raises 23514, the transaction rolls back, and the session
 * STAYS LIVE. The failure mode is the worst one an auth substrate has: the API
 * reports an error nobody reads, and a token the user believes she revoked keeps
 * working until it expires on its own.
 *
 * A unit test cannot see any of this. With a mocked pg the UPDATE is a string
 * nobody parses, and no constraint is evaluated — the mock returns whatever it was
 * told to return, for the correct statement and the broken one alike. That is
 * exactly how `kds.repository.revokeSession` shipped with the broken form.
 *
 * Self-seeding against any build-v3 database; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts cash-logout
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
    JWT_ACCESS_SECRET: 'logout-harness-access-secret-000000000000',
    JWT_REFRESH_SECRET: 'logout-harness-refresh-secret-00000000000',
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const MERCHANT = '9f000000-0000-4000-8000-0000000000c1';
const OTHER_MERCHANT = '9f000000-0000-4000-8000-0000000000c2';
const CUSTOMER = '9f000000-0000-4000-8000-0000000000c3';
const OTHER_CUSTOMER = '9f000000-0000-4000-8000-0000000000c4';

interface SessionRow {
  is_active: boolean;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

describe('cash logout · the session ends, and says why', () => {
  let pg: PgService;
  let sessions: CustomerSessionService;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    sessions = new CustomerSessionService(makeConfig(), pg);

    await pg.query(`DELETE FROM merchant.merchant WHERE id = ANY($1::uuid[])`, [
      [MERCHANT, OTHER_MERCHANT],
    ]);
    await pg.query(
      `INSERT INTO merchant.merchant (id, name, handle) VALUES
         ($1::uuid, 'Logout Test', 'logouttest'),
         ($2::uuid, 'Other Cafe', 'logoutother')`,
      [MERCHANT, OTHER_MERCHANT],
    );
    await pg.query(
      `INSERT INTO merchant.customer (id, merchant_id, name) VALUES
         ($1::uuid, $2::uuid, 'Ana'),
         ($3::uuid, $4::uuid, 'Beto')`,
      [CUSTOMER, MERCHANT, OTHER_CUSTOMER, OTHER_MERCHANT],
    );
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM merchant.merchant WHERE id = ANY($1::uuid[])`, [
      [MERCHANT, OTHER_MERCHANT],
    ]);
    await pg?.onModuleDestroy?.();
  });

  beforeEach(async () => {
    await pg.query(`DELETE FROM runtime.session WHERE merchant_id = ANY($1::uuid[])`, [
      [MERCHANT, OTHER_MERCHANT],
    ]);
  });

  /**
   * Hash in JS, exactly as the service does. `pgcrypto` lives in schema
   * `extensions`, so an unqualified `digest()` here would make the harness depend
   * on the search_path rather than on the behaviour under test.
   */
  const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

  const rowFor = async (token: string): Promise<SessionRow | undefined> => {
    const { rows } = await pg.query<SessionRow>(
      `SELECT is_active, revoked_at, revoked_reason
         FROM runtime.session WHERE token_hash = $1`,
      [hashOf(token)],
    );
    return rows[0];
  };

  it('deactivates the session AND records when and why', async () => {
    const { refreshToken } = await sessions.createSession(CUSTOMER, 'CUSTOMER', MERCHANT);

    await expect(sessions.revokeByRefreshToken(MERCHANT, refreshToken)).resolves.toBe(true);

    const row = await rowFor(refreshToken);
    expect(row?.is_active).toBe(false);
    // The CHECK is the reason all three move together. Asserting only `is_active`
    // would pass against a statement that cannot commit.
    expect(row?.revoked_at).toBeInstanceOf(Date);
    expect(row?.revoked_reason).toBe('logout');
  });

  it('is a no-op the second time, and does not move the timestamp', async () => {
    const { refreshToken } = await sessions.createSession(CUSTOMER, 'CUSTOMER', MERCHANT);
    await sessions.revokeByRefreshToken(MERCHANT, refreshToken);
    const first = await rowFor(refreshToken);

    // A logout the browser retries must not look like a fresh revocation, or the
    // audit trail says the session ended at the retry rather than at the logout.
    await expect(sessions.revokeByRefreshToken(MERCHANT, refreshToken)).resolves.toBe(false);

    const second = await rowFor(refreshToken);
    expect(second?.revoked_at).toEqual(first?.revoked_at);
  });

  it('will not end another cafe’s session with a valid token', async () => {
    const { refreshToken } = await sessions.createSession(
      OTHER_CUSTOMER,
      'CUSTOMER',
      OTHER_MERCHANT,
    );

    await expect(sessions.revokeByRefreshToken(MERCHANT, refreshToken)).resolves.toBe(false);
    expect((await rowFor(refreshToken))?.is_active).toBe(true);
  });

  it('ends a STAFF session too — one table, one revoke path', async () => {
    // A cash staff session is the same row with `principal_type = 'user'`. Logout
    // presents a token; it does not care which kind of principal minted it.
    const { refreshToken } = await sessions.createSession(CUSTOMER, 'ADMIN', MERCHANT);
    await expect(sessions.revokeByRefreshToken(MERCHANT, refreshToken)).resolves.toBe(true);
    expect((await rowFor(refreshToken))?.is_active).toBe(false);
  });

  it('REGRESSION: clearing is_active alone is refused by the database', async () => {
    const { refreshToken } = await sessions.createSession(CUSTOMER, 'CUSTOMER', MERCHANT);

    // This is the statement `kds.repository.revokeSession` carried. It reads as a
    // revoke and it never was one.
    await expect(
      pg.query(
        `UPDATE runtime.session SET is_active = false
          WHERE merchant_id = $1::uuid AND token_hash = $2`,
        [MERCHANT, hashOf(refreshToken)],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    // And the session it claimed to end is still live.
    expect((await rowFor(refreshToken))?.is_active).toBe(true);
  });
});
