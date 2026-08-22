import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { JwtService } from '../../shared/auth/jwt.service';
import { PgService } from '../../shared/database/pg.service';
import { AuthRepository } from './auth.repository';

/**
 * Dashboard refresh rotation against the real build-v3 constraints.
 *
 * A mock cannot prove that a merchantless dashboard session fits the shared
 * session table, that replacement is atomic, or that replay revokes the family.
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_backfill_v3';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_backfill_v3';

const USER = '9f000000-0000-4000-8000-0000000000d1';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET: 'dashboard-session-integration-secret-000000000',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
  };
  return { get: (key: string) => env[key] } as unknown as ConfigService<AppConfig, true>;
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

interface SessionRow {
  id: string;
  merchant_id: string | null;
  is_active: boolean;
  refresh_family_id: string;
  replaced_by_id: string | null;
  revoked_reason: string | null;
}

describe('dashboard session · rotate, detect replay, and revoke', () => {
  let pg: PgService;
  let repo: AuthRepository;
  let jwt: JwtService;

  beforeAll(async () => {
    const config = makeConfig();
    pg = new PgService(config);
    await pg.onModuleInit();
    repo = new AuthRepository(pg);
    jwt = new JwtService(config);
  });

  afterAll(async () => {
    await pg?.query(
      `DELETE FROM runtime.session
        WHERE merchant_id IS NULL AND principal_type = 'user' AND principal_id = $1::uuid`,
      [USER],
    );
    await pg?.onModuleDestroy?.();
  });

  beforeEach(async () => {
    await pg.query(
      `DELETE FROM runtime.session
        WHERE merchant_id IS NULL AND principal_type = 'user' AND principal_id = $1::uuid`,
      [USER],
    );
  });

  const rowFor = async (token: string): Promise<SessionRow | undefined> => {
    const { rows } = await pg.query<SessionRow>(
      `SELECT id::text, merchant_id::text, is_active, refresh_family_id::text,
              replaced_by_id::text, revoked_reason
         FROM runtime.session
        WHERE token_hash = $1`,
      [hashOf(token)],
    );
    return rows[0];
  };

  const start = async (): Promise<string> => {
    const token = await jwt.signRefresh(USER);
    await repo.startDashboardSession(USER, hashOf(token), jwt.refreshExpiresAt(token));
    return token;
  };

  it('stores a dashboard user session without an arbitrary café', async () => {
    const token = await start();

    expect((await rowFor(token))?.merchant_id).toBeNull();
  });

  it('rejects merchantless sessions outside the dashboard user contract', async () => {
    const insert = (principalType: string, metadata: Record<string, string>) =>
      pg.query(
        `INSERT INTO runtime.session
           (merchant_id, principal_type, principal_id, token_hash, metadata)
         VALUES (NULL, $1, $2::uuid, $3, $4::jsonb)`,
        [principalType, USER, hashOf(`${principalType}-${JSON.stringify(metadata)}`), metadata],
      );

    await expect(insert('person', { client: 'dashboard' })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(insert('user', {})).rejects.toMatchObject({ code: '23514' });
  });

  it('rotates once, then treats reuse of the old token as a family replay', async () => {
    const oldToken = await start();
    const nextToken = await jwt.signRefresh(USER);

    await expect(
      repo.rotateDashboardSession(
        USER,
        hashOf(oldToken),
        hashOf(nextToken),
        jwt.refreshExpiresAt(nextToken),
      ),
    ).resolves.toBe(true);

    const oldRow = await rowFor(oldToken);
    const nextRow = await rowFor(nextToken);
    expect(oldRow).toMatchObject({ is_active: false, revoked_reason: 'rotated' });
    expect(oldRow?.replaced_by_id).toBe(nextRow?.id);
    expect(nextRow).toMatchObject({ is_active: true, revoked_reason: null });
    expect(nextRow?.refresh_family_id).toBe(oldRow?.refresh_family_id);

    await expect(
      repo.rotateDashboardSession(
        USER,
        hashOf(oldToken),
        hashOf(await jwt.signRefresh(USER)),
        new Date(Date.now() + 60_000),
      ),
    ).resolves.toBe(false);
    expect(await rowFor(nextToken)).toMatchObject({
      is_active: false,
      revoked_reason: 'refresh_reuse',
    });
  });

  it('logout revokes every live token in the named family', async () => {
    const oldToken = await start();
    const currentToken = await jwt.signRefresh(USER);
    await expect(
      repo.rotateDashboardSession(
        USER,
        hashOf(oldToken),
        hashOf(currentToken),
        jwt.refreshExpiresAt(currentToken),
      ),
    ).resolves.toBe(true);

    await expect(repo.revokeDashboardSession(hashOf(oldToken))).resolves.toBe(true);
    expect(await rowFor(currentToken)).toMatchObject({
      is_active: false,
      revoked_reason: 'logout',
    });
  });

  const expectNoLiveSession = async (): Promise<void> => {
    const { rows } = await pg.query<{ count: string }>(
      `SELECT count(*)::text
         FROM runtime.session
        WHERE merchant_id IS NULL
          AND principal_type = 'user'
          AND principal_id = $1::uuid
          AND is_active`,
      [USER],
    );
    expect(rows[0]?.count).toBe('0');
  };

  it.each(['replay', 'logout'] as const)(
    'leaves no live replacement when stale-token %s races the current refresh',
    async (staleAction) => {
      const staleToken = await start();
      const currentToken = await jwt.signRefresh(USER);
      await repo.rotateDashboardSession(
        USER,
        hashOf(staleToken),
        hashOf(currentToken),
        jwt.refreshExpiresAt(currentToken),
      );

      const nextToken = await jwt.signRefresh(USER);
      const staleOperation =
        staleAction === 'replay'
          ? repo.rotateDashboardSession(
              USER,
              hashOf(staleToken),
              hashOf(await jwt.signRefresh(USER)),
              new Date(Date.now() + 60_000),
            )
          : repo.revokeDashboardSession(hashOf(staleToken));
      await Promise.all([
        staleOperation,
        repo.rotateDashboardSession(
          USER,
          hashOf(currentToken),
          hashOf(nextToken),
          jwt.refreshExpiresAt(nextToken),
        ),
      ]);

      await expectNoLiveSession();
    },
  );
});
