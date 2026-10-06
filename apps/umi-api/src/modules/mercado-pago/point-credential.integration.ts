import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';
import {
  PointCredentialRepository,
  type PointCredentialInput,
} from './point-credential.repository';
import { PointCredentialRenewalService } from './point-credential-renewal.service';

/**
 * THE PER-MERCHANT CREDENTIAL AGAINST THE REAL SCHEMA — D7/D8's storage, as rows.
 *
 * The plan's sentence for Phase 5 is "a second merchant authorizes, and a charge lands in
 * that merchant's account". A charge can only land there if the token it was asked with is
 * that merchant's, so what this suite proves is the property the whole phase rests on: the
 * token is stored, it is stored under a key nobody can read without the secret, two
 * merchants' credentials never touch each other, and a credential the database has been
 * tampered with is REFUSED rather than half-read.
 *
 * WHAT IT READS BACK FROM SQL, AND WHY THAT MATTERS. Every assertion about secrecy here goes
 * to the `_cipher` columns with raw SQL rather than to the repository's own return value.
 * A repository that encrypted on the way in and decrypted on the way out could pass a
 * round-trip test while storing the token in the clear; only the column itself can say that
 * the plaintext is not there. Case 2 is that check, and case 7 is its other half — a
 * database that has been edited fails closed.
 *
 * Run it against a DISPOSABLE build-v3 database, the way the refund suite is run:
 *
 *   set -a && . apps/umi-api/.env && set +a
 *   DATABASE_URL_APP=$(echo "$DATABASE_URL_APP" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   DATABASE_URL_WORKER=$(echo "$DATABASE_URL_WORKER" | sed 's#/umi_transition_rehearsal_20260901#/umi_build_v3_mp#') \
 *   npx vitest run --config vitest.integration.config.ts src/modules/mercado-pago/point-credential.integration.ts
 */

const APP_DSN = process.env.DATABASE_URL_APP;
const WORKER_DSN = process.env.DATABASE_URL_WORKER;

const JWT_SECRET = 'point-credential-harness-secret-0000';
/** Comfortably over the schema's 32-character floor, and obviously a test value. */
const CREDENTIAL_KEY = 'point-credential-harness-encryption-key-0000';

function makeConfig(withCredentialKey = true): ConfigService<AppConfig, true> {
  const env: Record<string, string | undefined> = {
    DATABASE_URL_APP: APP_DSN,
    DATABASE_URL_WORKER: WORKER_DSN,
    PGSSLROOTCERT: undefined,
    JWT_SECRET,
    MERCADO_PAGO_POINT_CREDENTIAL_KEY: withCredentialKey ? CREDENTIAL_KEY : undefined,
    // The renewal sweep needs the OAuth application identity and the token endpoint; the endpoint
    // is never reached because the suite stubs `fetch`, and the ids only have to be non-empty.
    MERCADO_PAGO_POINT_CLIENT_ID: 'harness-client-id',
    MERCADO_PAGO_POINT_CLIENT_SECRET: 'harness-client-secret',
    MERCADO_PAGO_POINT_OAUTH_TOKEN_URL: 'https://api.mercadopago.com/oauth/token',
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService<AppConfig, true>;
}

/**
 * Four merchants, one per thing a credential can be: bound and re-authorized (A), a second
 * independent account (B), a row the database has been tampered with (CORRUPT), and one that
 * has never been bound at all (UNBOUND). The ids are fixed uuids rather than random, because
 * the harness needs no cleanup (the plan's suite style): a re-run replaces A and B in place,
 * exactly as a re-authorization does, and CORRUPT/UNBOUND are seeded idempotently.
 */
const MERCHANT_A = '7f000000-0000-4000-8000-0000000000f1';
const MERCHANT_B = '7f000000-0000-4000-8000-0000000000f2';
const MERCHANT_CORRUPT = '7f000000-0000-4000-8000-0000000000f3';
const MERCHANT_UNBOUND = '7f000000-0000-4000-8000-0000000000f4';
const MERCHANT_KEYLESS = '7f000000-0000-4000-8000-0000000000f5';
const MERCHANT_UNLINK = '7f000000-0000-4000-8000-0000000000f6';
const MERCHANT_DUE = '7f000000-0000-4000-8000-0000000000f7';

/** `v1.<43-ish base64url>.<base64url>.<22-char base64url>` — the shape the reader requires. */
const ENVELOPE = /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+$/;

describe('the per-merchant Point credential · §3 D7/D8', () => {
  let pg: PgService;
  let repo: PointCredentialRepository;
  let runTag: string;

  const credential = (
    merchantId: string,
    mpUserId: string,
    overrides: Partial<PointCredentialInput> = {},
  ): PointCredentialInput => ({
    merchantId,
    mpUserId,
    accessToken: `APP_USR-ACCESS-${runTag}-${mpUserId}`,
    refreshToken: `TG-REFRESH-${runTag}-${mpUserId}`,
    expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    ...overrides,
  });

  /** The cipher columns, straight out of the table — the only witness to what is at rest. */
  const ciphers = async (merchantId: string) => {
    const { rows } = await pg.tquery<{
      accessTokenCipher: string | null;
      refreshTokenCipher: string | null;
      refreshAttempts: number;
      refreshFailedAt: Date | null;
    }>(
      merchantId,
      `SELECT access_token_cipher AS "accessTokenCipher",
              refresh_token_cipher AS "refreshTokenCipher",
              refresh_attempts AS "refreshAttempts",
              refresh_failed_at AS "refreshFailedAt"
         FROM merchant.mp_point_credential
        WHERE merchant_id=$1::uuid`,
      [merchantId],
    );
    return rows[0] ?? null;
  };

  /** How many rows this merchant has, counted on the bypass-RLS worker pool with the
   *  merchant predicate written out — one row per merchant is the primary key, and this is
   *  the physical count rather than the RLS-visible one. */
  const rowCount = async (merchantId: string) => {
    const { rows } = await pg.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM merchant.mp_point_credential WHERE merchant_id=$1::uuid`,
      [merchantId],
    );
    return Number(rows[0]?.count ?? '0');
  };

  beforeAll(async () => {
    if (!APP_DSN || !WORKER_DSN) {
      throw new Error(
        'Set DATABASE_URL_APP and DATABASE_URL_WORKER to a DISPOSABLE build-v3 database.',
      );
    }
    runTag = `C${Date.now().toString(36).toUpperCase()}`;
    pg = new PgService(makeConfig());
    await pg.onModuleInit();
    repo = new PointCredentialRepository(pg, makeConfig());

    // The harness merchants. Seeded ONCE and left in place: a credential is replaced, never
    // deleted (72_mp_point.sql), so a suite that cleaned up after itself would be rehearsing
    // a lifecycle the product does not have.
    for (const [id, name, handle] of [
      [MERCHANT_A, 'Point Credential A', 'mp-credential-a'],
      [MERCHANT_B, 'Point Credential B', 'mp-credential-b'],
      [MERCHANT_CORRUPT, 'Point Credential Corrupt', 'mp-credential-corrupt'],
      [MERCHANT_UNBOUND, 'Point Credential Unbound', 'mp-credential-unbound'],
      [MERCHANT_KEYLESS, 'Point Credential Keyless', 'mp-credential-keyless'],
      [MERCHANT_UNLINK, 'Point Credential Unlink', 'mp-credential-unlink'],
      [MERCHANT_DUE, 'Point Credential Due', 'mp-credential-due'],
    ] as const) {
      await pg.query(
        `INSERT INTO merchant.merchant (id,name,handle) VALUES ($1::uuid,$2,$3)
         ON CONFLICT (id) DO NOTHING`,
        [id, name, handle],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (pg) await pg.onModuleDestroy();
  }, 60_000);

  it('stores and reads back the exact credential the authorization carried', async () => {
    const input = credential(MERCHANT_A, `MPA-${runTag}`);
    await repo.store(input);

    const read = await repo.readForMerchant(MERCHANT_A);
    expect(read).not.toBeNull();
    expect(read).toMatchObject({
      merchantId: MERCHANT_A,
      mpUserId: input.mpUserId,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    });
    // The expiry round-trips to the millisecond: timestamptz keeps microseconds, and a Date
    // built from `Date.now()` never has any.
    expect(read?.expiresAt?.getTime()).toBe(input.expiresAt.getTime());
  });

  it('leaves no plaintext in the database — the columns hold v1 envelopes', async () => {
    const input = credential(MERCHANT_A, `MPA-${runTag}`);
    await repo.store(input);

    const row = await ciphers(MERCHANT_A);
    expect(row).not.toBeNull();
    // THE ASSERTION THAT MATTERS: the token the vendor gave us is not anywhere in the column.
    expect(row?.accessTokenCipher).not.toContain(input.accessToken);
    expect(row?.refreshTokenCipher).not.toContain(input.refreshToken as string);
    // …and what IS there says what it is: a self-describing v1 envelope, so a rotation can
    // read both formats.
    expect(row?.accessTokenCipher).toMatch(ENVELOPE);
    expect(row?.refreshTokenCipher).toMatch(ENVELOPE);
  });

  it('seals the same token differently every time — a fresh nonce per value', async () => {
    const input = credential(MERCHANT_B, `MPB-${runTag}`);
    await repo.store(input);
    const first = (await ciphers(MERCHANT_B))?.accessTokenCipher;
    await repo.store(input);
    const second = (await ciphers(MERCHANT_B))?.accessTokenCipher;

    expect(first).toMatch(ENVELOPE);
    expect(second).toMatch(ENVELOPE);
    // GCM's confidentiality collapses if a nonce is ever reused under one key, so the SAME
    // plaintext must not seal to the same value twice — the nonce is per write, not per row.
    expect(second).not.toBe(first);
    // …and the value that replaced it still opens to the token that went in.
    expect((await repo.readForMerchant(MERCHANT_B))?.accessToken).toBe(input.accessToken);
  });

  it('replaces the row on re-authorization and clears the old failure trail', async () => {
    const first = credential(MERCHANT_A, `MPA-${runTag}`, {
      accessToken: `APP_USR-OLD-${runTag}`,
      refreshToken: `TG-OLD-${runTag}`,
    });
    await repo.store(first);

    // A token that has been failing: the alert of §7 item 4 is reading this pair.
    await repo.recordRefreshFailure(MERCHANT_A, 'invalid_grant');
    await repo.recordRefreshFailure(MERCHANT_A, 'invalid_grant');
    const failing = await ciphers(MERCHANT_A);
    expect(Number(failing?.refreshAttempts)).toBe(2);
    expect(failing?.refreshFailedAt).not.toBeNull();

    const second = credential(MERCHANT_A, `MPA-${runTag}`, {
      accessToken: `APP_USR-NEW-${runTag}`,
      refreshToken: `TG-NEW-${runTag}`,
    });
    await repo.store(second);

    // One row, not two: `store` replaces in place, which is the migration's rule.
    expect(await rowCount(MERCHANT_A)).toBe(1);
    const read = await repo.readForMerchant(MERCHANT_A);
    expect(read?.accessToken).toBe(second.accessToken);
    expect(read?.refreshToken).toBe(second.refreshToken);
    // The failure trail belongs to the OLD token and would be a lie about the new one.
    const replaced = await ciphers(MERCHANT_A);
    expect(Number(replaced?.refreshAttempts)).toBe(0);
    expect(replaced?.refreshFailedAt).toBeNull();
  });

  it("keeps two merchants' credentials independent", async () => {
    const a = credential(MERCHANT_A, `MPA-${runTag}`);
    const b = credential(MERCHANT_B, `MPB-${runTag}`);
    await repo.store(a);
    await repo.store(b);

    const readA = await repo.readForMerchant(MERCHANT_A);
    const readB = await repo.readForMerchant(MERCHANT_B);
    expect(readA?.accessToken).toBe(a.accessToken);
    expect(readB?.accessToken).toBe(b.accessToken);
    expect(readA?.mpUserId).toBe(`MPA-${runTag}`);
    expect(readB?.mpUserId).toBe(`MPB-${runTag}`);
    // Neither read carries the other merchant's token.
    expect(JSON.stringify(readA)).not.toContain(b.accessToken);
    expect(JSON.stringify(readB)).not.toContain(a.accessToken);
    // And the scope is enforced by the database, not by this code: merchant B's scope cannot
    // see merchant A's row even when the query asks for it by id.
    const crossed = await pg.tquery(
      MERCHANT_B,
      `SELECT * FROM merchant.mp_point_credential WHERE merchant_id=$1::uuid`,
      [MERCHANT_A],
    );
    expect(crossed.rows).toHaveLength(0);
  });

  it('describes the account and the token’s health without ever carrying a token', async () => {
    const input = credential(MERCHANT_A, `MPA-${runTag}`);
    await repo.store(input);

    const meta = await repo.meta(MERCHANT_A);
    expect(meta).not.toBeNull();
    // The keys ARE the answer: what a screen may see is exactly the account and the health.
    expect(Object.keys(meta ?? {}).sort()).toEqual([
      'expiresAt',
      'mpUserId',
      'refreshAttempts',
      'refreshFailedAt',
      'updatedAt',
    ]);
    expect(meta?.mpUserId).toBe(input.mpUserId);
    expect(meta?.expiresAt?.getTime()).toBe(input.expiresAt.getTime());
    expect(meta?.refreshAttempts).toBe(0);
    expect(meta?.refreshFailedAt).toBeNull();
    expect(meta?.updatedAt).toBeInstanceOf(Date);
    // Parsimonious but not redundant: a token cannot be in a response that has no field for it.
    expect(JSON.stringify(meta)).not.toContain(input.accessToken);
    expect(JSON.stringify(meta)).not.toContain(input.refreshToken as string);
  });

  it('records a failed renewal without touching either token', async () => {
    const input = credential(MERCHANT_A, `MPA-${runTag}`);
    await repo.store(input);
    const before = await ciphers(MERCHANT_A);

    await repo.recordRefreshFailure(MERCHANT_A, 'invalid_grant');
    const once = await ciphers(MERCHANT_A);
    expect(Number(once?.refreshAttempts)).toBe(1);
    expect(once?.refreshFailedAt).toBeInstanceOf(Date);

    await repo.recordRefreshFailure(MERCHANT_A, 'invalid_grant');
    const twice = await ciphers(MERCHANT_A);
    expect(Number(twice?.refreshAttempts)).toBe(2);
    // The old access token may still be accepted for a charge — different grant, different
    // lifetime — so a failed renewal records the fact and destroys nothing.
    expect(twice?.accessTokenCipher).toBe(before?.accessTokenCipher);
    expect(twice?.refreshTokenCipher).toBe(before?.refreshTokenCipher);
    expect((await repo.readForMerchant(MERCHANT_A))?.accessToken).toBe(input.accessToken);
  });

  it('refuses to read a credential the database has been tampered with', async () => {
    const input = credential(MERCHANT_CORRUPT, `MPC-${runTag}`);
    await repo.store(input);

    // A value that is not the envelope at all…
    await pg.tquery(
      MERCHANT_CORRUPT,
      `UPDATE merchant.mp_point_credential SET access_token_cipher='v1.not-a-thing'
        WHERE merchant_id=$1::uuid`,
      [MERCHANT_CORRUPT],
    );
    await expect(repo.readForMerchant(MERCHANT_CORRUPT)).rejects.toMatchObject({
      response: { code: 'MP_POINT_CREDENTIAL_UNREADABLE' },
    });

    // …and one that has the right shape but the wrong bytes: GCM verifies the tag before it
    // hands back anything, so an edited ciphertext is a refusal rather than a broken token.
    const forged = `v1.${Buffer.alloc(12).toString('base64url')}.${Buffer.from('edited').toString('base64url')}.${Buffer.alloc(16, 7).toString('base64url')}`;
    await pg.tquery(
      MERCHANT_CORRUPT,
      `UPDATE merchant.mp_point_credential SET access_token_cipher=$2::text
        WHERE merchant_id=$1::uuid`,
      [MERCHANT_CORRUPT, forged],
    );
    await expect(repo.readForMerchant(MERCHANT_CORRUPT)).rejects.toMatchObject({
      response: { code: 'MP_POINT_CREDENTIAL_UNREADABLE' },
    });
  });

  it('answers null for a merchant that has never been bound', async () => {
    expect(await repo.readForMerchant(MERCHANT_UNBOUND)).toBeNull();
    expect(await repo.meta(MERCHANT_UNBOUND)).toBeNull();
    // …and `bound` agrees, which is the one query that has to: it is what a console reads to
    // decide whether to draw the account or the connect prompt.
    expect(await repo.bound(MERCHANT_UNBOUND)).toBe(false);
  });

  it('unlinks by erasing the material and keeping the row', async () => {
    const input = credential(MERCHANT_UNLINK, `MPL-${runTag}`);
    await repo.store(input);
    expect(await repo.bound(MERCHANT_UNLINK)).toBe(true);

    await repo.revoke(MERCHANT_UNLINK);

    // THE TOKEN IS THE THING THAT MUST BE GONE. `readForMerchant` is what the transport
    // calls, and a café that has unlinked must not be chargeable through this row.
    expect(await repo.readForMerchant(MERCHANT_UNLINK)).toBeNull();
    expect(await repo.bound(MERCHANT_UNLINK)).toBe(false);

    const row = await ciphers(MERCHANT_UNLINK);
    expect(row?.accessTokenCipher).toBeNull();
    expect(row?.refreshTokenCipher).toBeNull();
    expect(row?.refreshAttempts).toBe(0);
    expect(row?.refreshFailedAt).toBeNull();

    // AND THE ROW IS STILL THERE, which is the migration's own doctrine rather than an
    // accident: `mp_point_credential` is granted no DELETE, its only delete path is the
    // merchant's cascade, and the café that links again is the same café. A count of 1 here
    // is the difference between unlinking and pretending to.
    expect(await rowCount(MERCHANT_UNLINK)).toBe(1);
    // The identity survives the unlink — it is what makes the re-link an update.
    expect((await repo.meta(MERCHANT_UNLINK))?.mpUserId).toBe(`MPL-${runTag}`);

    // RE-LINKING THE SAME ACCOUNT WORKS, because it is an `on conflict` update of the row
    // the unlink left behind rather than an insert that would collide with it.
    const again = credential(MERCHANT_UNLINK, `MPL-${runTag}`, {
      accessToken: `APP_USR-AGAIN-${runTag}`,
    });
    await repo.store(again);
    expect(await repo.bound(MERCHANT_UNLINK)).toBe(true);
    expect((await repo.readForMerchant(MERCHANT_UNLINK))?.accessToken).toBe(again.accessToken);

    // Idempotent: a second unlink erases nothing and answers the same way, which is what the
    // route's `idempotent: true` promises.
    await repo.revoke(MERCHANT_UNLINK);
    await repo.revoke(MERCHANT_UNLINK);
    expect(await repo.bound(MERCHANT_UNLINK)).toBe(false);
    expect(await rowCount(MERCHANT_UNLINK)).toBe(1);
  });

  it('unlinks a café that never linked, without inventing a row for it', async () => {
    await repo.revoke(MERCHANT_UNBOUND);
    expect(await repo.bound(MERCHANT_UNBOUND)).toBe(false);
    expect(await rowCount(MERCHANT_UNBOUND)).toBe(0);
  });

  it('RENEWS a credential inside the margin, and the row is the witness', async () => {
    // FIVE DAYS LEFT: inside the fourteen-day margin of D8, so this is exactly the row the sweep
    // exists to find — the café that would otherwise lose its card method in a week.
    await repo.store(
      credential(MERCHANT_DUE, `MPD-${runTag}`, {
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      }),
    );
    const before = await ciphers(MERCHANT_DUE);
    expect(before?.accessTokenCipher).not.toBeNull();

    const bodies: string[] = [];
    vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return new Response(
        JSON.stringify({
          access_token: `APP_USR-RENEWED-${runTag}`,
          refresh_token: `TG-RENEWED-${runTag}`,
          user_id: 3696430142,
          expires_in: 15_552_000,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    try {
      const renewal = new PointCredentialRenewalService(repo, makeConfig());
      const result = await renewal.renewDue(14, 50);

      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toContain('grant_type=refresh_token');
      expect(result.renewed).toBeGreaterThanOrEqual(1);

      // READ BACK FROM THE ROW rather than from the sweep's own answer: a renewal that reported
      // success while writing nothing is the failure mode this assertion exists for.
      const after = await ciphers(MERCHANT_DUE);
      expect(after?.accessTokenCipher).not.toBe(before?.accessTokenCipher);
      expect((await repo.readForMerchant(MERCHANT_DUE))?.accessToken).toBe(
        `APP_USR-RENEWED-${runTag}`,
      );
      // A successful renewal is a CLEAN SLATE: the D8 alert's counter and timestamp are cleared,
      // because an alert that outlived the failure it described would fire on a healthy café.
      expect(after?.refreshAttempts).toBe(0);
      expect(after?.refreshFailedAt).toBeNull();
      // …and the expiry moved out of the margin, which is what stops the next run asking again.
      const moved = (await repo.meta(MERCHANT_DUE))?.expiresAt;
      expect(moved).not.toBeNull();
      expect((moved as Date).getTime()).toBeGreaterThan(Date.now() + 100 * 24 * 60 * 60 * 1000);
    } finally {
      vi.unstubAllGlobals();
    }
  }, 60_000);

  it('RECORDS a refused renewal, so the owner has something to act on', async () => {
    await repo.store(
      credential(MERCHANT_DUE, `MPD-${runTag}`, {
        expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      }),
    );
    // The OAuth endpoint's own envelope (RFC 6749): the reason is a top-level `error`, not the
    // Orders API's `code`, and losing it would report every refusal as "400".
    vi.stubGlobal('fetch', async () =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'expired' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    try {
      const renewal = new PointCredentialRenewalService(repo, makeConfig());
      const result = await renewal.renewDue(14, 50);

      expect(result.failed).toBeGreaterThanOrEqual(1);
      const after = await ciphers(MERCHANT_DUE);
      // THE ALERT IS THE COLUMN PAIR the console renders as "Conectado, con avisos".
      expect(after?.refreshAttempts).toBeGreaterThanOrEqual(1);
      expect(after?.refreshFailedAt).not.toBeNull();
      // …and the token the café is still using is untouched: a refused renewal does not revoke
      // anything, it reports that the account has to be connected again.
      expect((await repo.readForMerchant(MERCHANT_DUE))?.refreshToken).toBe(
        `TG-REFRESH-${runTag}-MPD-${runTag}`,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  }, 60_000);

  it('refuses to write or read at all when no key is configured', async () => {
    // A deployment with no credential key cannot hold a token: the alternative to this
    // refusal is a merchant's bearer token sitting in the clear, so it must not be a warning.
    const keyless = new PointCredentialRepository(pg, makeConfig(false));

    await expect(
      keyless.store(credential(MERCHANT_UNBOUND, `MPU-${runTag}`)),
    ).rejects.toMatchObject({ response: { code: 'MP_POINT_CREDENTIAL_KEY_UNAVAILABLE' } });
    // The zero below is evidence rather than a tautology: this merchant EXISTS and has never
    // held a credential, so an insert that skipped the key check would have succeeded here.
    expect(await rowCount(MERCHANT_UNBOUND)).toBe(0);
    expect(await ciphers(MERCHANT_UNBOUND)).toBeNull();

    // The read path refuses the same way once there IS a credential to read — the guard is
    // not only on the write side.
    await repo.store(credential(MERCHANT_KEYLESS, `MPK-${runTag}`));
    await expect(keyless.readForMerchant(MERCHANT_KEYLESS)).rejects.toMatchObject({
      response: { code: 'MP_POINT_CREDENTIAL_KEY_UNAVAILABLE' },
    });
    await expect(
      keyless.recordRefreshed(credential(MERCHANT_KEYLESS, `MPK-${runTag}`)),
    ).rejects.toMatchObject({ response: { code: 'MP_POINT_CREDENTIAL_KEY_UNAVAILABLE' } });
    // …and the configured key still reads that same row, so the refusals above are about the
    // missing key and not about a credential that failed to store.
    expect((await repo.readForMerchant(MERCHANT_KEYLESS))?.mpUserId).toBe(`MPK-${runTag}`);
  });
});
