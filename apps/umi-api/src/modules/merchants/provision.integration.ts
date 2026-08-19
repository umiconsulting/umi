import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { PasswordService } from '../../shared/auth/password.service';
import { MerchantsRepository } from './merchants.repository';
import { MerchantsService } from './merchants.service';
import { AuthRepository } from '../auth/auth.repository';

/**
 * CAN A CAFÉ BE OPENED ON A PLATFORM BUILT FROM NOTHING?
 *
 * Until this file, the honest answer was no, and nothing said so. build-v3 was
 * only ever a MIGRATION TARGET: `backfill_identity.sql` copies `core.roles` and
 * `core.permissions` across, so a migrated platform holds owner/admin/staff/
 * viewer because production held them. A database built by `00_run.sh` alone
 * holds none — and `merchant.staff.role_id` is NOT NULL against `umi.role`, so
 * there was no role to make anyone a member of anything.
 *
 * That is why this suite runs against the PRISTINE build, in CI, on every pull
 * request. Run against the rehearsal clone it would pass for the wrong reason:
 * the roles would be there because production had them.
 *
 * It asserts the whole chain a café needs to exist, not just that rows landed:
 * the owner can be authenticated, her membership resolves, and her café owns the
 * products her plan includes.
 */

const APP_DSN =
  process.env.DATABASE_URL_APP ??
  'postgresql://api_login:harness_api@127.0.0.1:5233/umi_build_v3_ci';
const WORKER_DSN =
  process.env.DATABASE_URL_WORKER ??
  'postgresql://worker_login:harness_worker@127.0.0.1:5233/umi_build_v3_ci';

function makeConfig(): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

const EMAIL = 'provision-harness@umi.invalid';

describe('opening a café on a platform built from scratch', () => {
  let pg: PgService;
  let service: MerchantsService;
  let auth: AuthRepository;
  const passwords = new PasswordService();
  let merchantId: string;
  let userId: string;

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    const repo = new MerchantsRepository(pg);
    service = new MerchantsService(repo, passwords);
    auth = new AuthRepository(pg);

    await pg.query(`DELETE FROM umi."user" WHERE email = $1`, [EMAIL]);
    await pg.query(`DELETE FROM merchant.merchant WHERE name = 'Provision Harness'`);

    const out = await service.provision({
      name: 'Provision Harness',
      city: 'Guadalajara',
      plan: 'pro',
      cardPrefix: 'PRV',
      primaryColor: '#123456',
      secondaryColor: '#654321',
      adminEmail: EMAIL,
      adminPassword: 'a-strong-enough-password',
      adminName: 'Ana',
      locations: [
        { name: 'Centro', address: 'Av. Chapultepec 1', latitude: 20.6736, longitude: -103.344 },
      ],
    });
    merchantId = out.merchantId;
    userId = out.userId;
  }, 60_000);

  afterAll(async () => {
    // `merchant.merchant` cascades to the café's rows; the login is its own row.
    await pg
      ?.query(`DELETE FROM merchant.merchant WHERE id = $1::uuid`, [merchantId])
      .catch(() => {});
    await pg?.query(`DELETE FROM umi."user" WHERE id = $1::uuid`, [userId]).catch(() => {});
    await pg?.onModuleDestroy?.();
  });

  it('the owner can be authenticated with the password she was given', async () => {
    const cred = await auth.findCredentialByEmail(EMAIL);
    expect(cred).not.toBeNull();
    expect(
      passwords.verify(
        'a-strong-enough-password',
        cred!.passwordSalt,
        cred!.passwordHash,
        cred!.passwordAlgorithm,
      ),
    ).toBe(true);
    // Never a legacy hash on a login created today.
    expect(passwords.needsUpgrade(cred!.passwordAlgorithm)).toBe(false);
  });

  it('her membership resolves, which is what every merchant-scoped route needs', async () => {
    // THE assertion. `MerchantAccessGuard` calls exactly this, and a café whose
    // owner does not resolve here answers 404 on every one of its own routes.
    const access = await auth.findMembershipAccess(userId, merchantId);
    expect(access).not.toBeNull();
    expect(access!.merchantId).toBe(merchantId);
    expect(access!.roles).toContain('admin');
  });

  it('the café owns the products its plan includes, and no others', async () => {
    // Entitlements are a VIEW over subscription → plan_feature → feature. Nothing
    // is written to grant a product; choosing the plan IS the grant.
    const { rows } = await pg.query<{ feature_key: string }>(
      `SELECT feature_key FROM umi.effective_entitlement
        WHERE merchant_id = $1::uuid AND enabled ORDER BY feature_key`,
      [merchantId],
    );
    expect(rows.map((r) => r.feature_key)).toEqual(['cash', 'conversaflow', 'dashboard', 'kds']);
  });

  it('takes no handle — the column is designed to stop growing', async () => {
    // `merchant.handle` exists only because 350 issued Apple passes carry a café
    // name inside a signed URL that cannot be recalled. A café opened today has
    // no such passes and is reached by id.
    const { rows } = await pg.query<{ handle: string | null }>(
      `SELECT handle FROM merchant.merchant WHERE id = $1::uuid`,
      [merchantId],
    );
    expect(rows[0].handle).toBeNull();
  });

  it('gives the café a loyalty program, a reward and its location', async () => {
    const { rows } = await pg.query<{
      prefix: string;
      stamps: number;
      reward: string;
      locs: number;
    }>(
      `SELECT p.card_prefix AS prefix,
              p.stamps_per_reward AS stamps,
              (SELECT name FROM merchant.loyalty_reward WHERE merchant_id = $1::uuid) AS reward,
              (SELECT count(*)::int FROM merchant.location WHERE merchant_id = $1::uuid) AS locs
         FROM merchant.loyalty_program p WHERE p.merchant_id = $1::uuid`,
      [merchantId],
    );
    expect(rows[0].prefix).toBe('PRV');
    // umi-cash's defaults, carried: ten stamps for a free drink.
    expect(rows[0].stamps).toBe(10);
    expect(rows[0].reward).toBe('Bebida gratis');
    expect(rows[0].locs).toBe(1);
  });

  it('refuses a plan nobody sells, without leaving a half-made café behind', async () => {
    await expect(
      service.provision({
        name: 'Rollback Harness',
        plan: 'enterprise-unlimited',
        cardPrefix: 'RBK',
        primaryColor: '#000000',
        adminEmail: 'rollback-harness@umi.invalid',
        adminPassword: 'a-strong-enough-password',
      }),
    ).rejects.toThrow(/enterprise-unlimited/);

    // The transaction is the point: the plan is looked up FIRST, but a café that
    // failed halfway would still be a café nobody can reach.
    const { rows } = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM merchant.merchant WHERE name = 'Rollback Harness'`,
    );
    expect(rows[0].n).toBe(0);
  });
});
