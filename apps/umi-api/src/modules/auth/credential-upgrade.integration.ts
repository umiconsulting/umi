import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import { AuthRepository } from './auth.repository';
import { PasswordService } from '../../shared/auth/password.service';

/**
 * THE WEAK HASH DRAINS AWAY ON ITS OWN.
 *
 * Production carries two password schemes. The backfill now carries BOTH forward,
 * so nobody is asked to reset a password they still remember — which means this
 * API must verify a `legacy-sha256-v1` row AND replace it with scrypt the first
 * time its owner signs in. Without the replacement, "carry it forward" would mean
 * "keep the weak scheme for ever".
 *
 * Proven against a real database because the claim is about a COLUMN: that the
 * credential read carries `password_algorithm` at all (it did not before), and
 * that the upgrade actually lands on the row.
 *
 * Self-seeding; everything it writes is removed.
 *
 *   DATABASE_URL_APP=... DATABASE_URL_WORKER=... \
 *     npx vitest run --config vitest.integration.config.ts credential-upgrade
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

const USER = '9f000000-0000-4000-8000-0000000000e1';
const EMAIL = 'legacy-harness@umi.invalid';
const SALT = 'c'.repeat(32);
const PASSWORD = 'la contraseña de siempre';
const LEGACY_HASH = createHash('sha256')
  .update(PASSWORD + SALT)
  .digest('hex');

describe('legacy credential · verifies, then upgrades itself', () => {
  let pg: PgService;
  let repo: AuthRepository;
  const passwords = new PasswordService();

  beforeAll(async () => {
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new AuthRepository(pg);
  });

  afterAll(async () => {
    await pg?.query(`DELETE FROM umi."user" WHERE id = $1::uuid`, [USER]);
    await pg?.onModuleDestroy?.();
  });

  beforeEach(async () => {
    await pg.query(`DELETE FROM umi."user" WHERE id = $1::uuid`, [USER]);
    await pg.query(
      `INSERT INTO umi."user" (id, email, full_name, status,
                               password_salt, password_hash, password_algorithm)
       VALUES ($1::uuid, $2, 'Legacy Barista', 'active', $3, $4, 'legacy-sha256-v1')`,
      [USER, EMAIL, SALT, LEGACY_HASH],
    );
  });

  const row = async () => {
    const { rows } = await pg.query<{
      password_salt: string;
      password_hash: string;
      password_algorithm: string | null;
    }>(
      `SELECT password_salt, password_hash, password_algorithm FROM umi."user" WHERE id = $1::uuid`,
      [USER],
    );
    return rows[0];
  };

  it('the credential read carries the scheme', async () => {
    // It did not before this change: the SELECT listed salt and hash only, so the
    // verifier had no way to know which scheme the row used.
    const cred = await repo.findCredentialByEmail(EMAIL);
    expect(cred?.passwordAlgorithm).toBe('legacy-sha256-v1');
  });

  it('the legacy password verifies', async () => {
    const cred = await repo.findCredentialByEmail(EMAIL);
    expect(
      passwords.verify(PASSWORD, cred!.passwordSalt, cred!.passwordHash, cred!.passwordAlgorithm),
    ).toBe(true);
  });

  it('upgrading replaces salt, hash AND scheme in one write', async () => {
    const before = await row();
    const next = passwords.hash(PASSWORD);
    await repo.upgradeCredential(USER, next.salt, next.hash);

    const after = await row();
    expect(after.password_algorithm).toBe('scrypt-sha256-v1');
    expect(after.password_salt).not.toBe(before.password_salt);
    expect(after.password_hash).not.toBe(before.password_hash);
  });

  it('the SAME password still works after the upgrade', async () => {
    // The whole point. The owner never learns this happened.
    const next = passwords.hash(PASSWORD);
    await repo.upgradeCredential(USER, next.salt, next.hash);

    const cred = await repo.findCredentialByEmail(EMAIL);
    expect(
      passwords.verify(PASSWORD, cred!.passwordSalt, cred!.passwordHash, cred!.passwordAlgorithm),
    ).toBe(true);
    expect(passwords.needsUpgrade(cred!.passwordAlgorithm)).toBe(false);
  });

  it('REGRESSION: a password RESET also moves the scheme', async () => {
    // `updatePassword` always writes scrypt. Before this was fixed it left
    // `password_algorithm` alone, so a legacy user who reset their password got a
    // scrypt hash on a row still labelled legacy — the next login ran sha256
    // against a scrypt hash, could never match, and resetting again reproduced the
    // same mismatch. A permanent lockout, reachable only through the happy path.
    const fresh = passwords.hash('una contraseña nueva');
    await repo.updatePassword(USER, fresh.salt, fresh.hash);

    const after = await row();
    expect(after.password_algorithm).toBe('scrypt-sha256-v1');

    const cred = await repo.findCredentialByEmail(EMAIL);
    expect(
      passwords.verify(
        'una contraseña nueva',
        cred!.passwordSalt,
        cred!.passwordHash,
        cred!.passwordAlgorithm,
      ),
    ).toBe(true);
  });

  it('a wrong password still fails after the upgrade', async () => {
    const next = passwords.hash(PASSWORD);
    await repo.upgradeCredential(USER, next.salt, next.hash);

    const cred = await repo.findCredentialByEmail(EMAIL);
    expect(
      passwords.verify(
        'otra cosa',
        cred!.passwordSalt,
        cred!.passwordHash,
        cred!.passwordAlgorithm,
      ),
    ).toBe(false);
  });
});
