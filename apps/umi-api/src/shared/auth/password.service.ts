import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing — preserves the dashboard's exact scrypt scheme so existing
 * `merchant.login` hashes verify without a forced reset (D9). The hash is
 * `scrypt(password, salt, 64)` hex; the salt is a 16-byte hex string. Both
 * columns (`password_salt`, `password_hash`) live in `merchant.login`.
 *
 * Ported verbatim from `apps/umi-dashboard/server.js`
 * (`hashLocalPassword`/`verifyLocalPassword`) — do not change the parameters
 * (keylen 64, hex encoding) or every stored hash breaks.
 *
 * TWO SCHEMES, because production still holds both. `umi.user.password_algorithm`
 * names the scheme per row: `scrypt-sha256-v1` is the one we write, and
 * `legacy-sha256-v1` is `sha256(password + salt)` inherited from umi-cash. Rows
 * carrying the legacy scheme are UPGRADED on their next successful login (see
 * `needsUpgrade`), so the weak scheme drains away without asking anyone to reset
 * a password they still remember.
 */
@Injectable()
export class PasswordService {
  /** Derive a {salt, hash} pair for a new/changed password. */
  hash(
    password: string,
    salt: string = randomBytes(16).toString('hex'),
  ): {
    salt: string;
    hash: string;
  } {
    return {
      salt,
      hash: scryptSync(password, salt, 64).toString('hex'),
    };
  }

  /**
   * Constant-time verify against a stored salt + hex hash. Returns false (never
   * throws) on length mismatch or malformed input, so a bad row can't 500 login.
   *
   * `algorithm` selects the scheme. THE TEST IS A PREFIX, not equality, and that
   * is deliberate: a migration once tagged scrypt rows as `scrypt-v1`, and
   * matching the exact string `scrypt-sha256-v1` would send those down the sha256
   * branch and fail every login on them silently. umi-cash learned this and its
   * comment says so — `auth.ts` uses `startsWith('scrypt')` for the same reason.
   *
   * Anything that is NOT a scrypt label — `legacy-sha256-v1`, and null — takes the
   * legacy branch, matching umi-cash exactly. Defaulting the other way would fail
   * closed on a row whose algorithm was never recorded, which is a lockout rather
   * than a refusal.
   */
  verify(
    password: string,
    salt: string,
    expectedHashHex: string,
    algorithm?: string | null,
  ): boolean {
    if (!salt || !expectedHashHex) return false;
    let expected: Buffer;
    try {
      expected = Buffer.from(expectedHashHex, 'hex');
    } catch {
      return false;
    }
    const actual =
      algorithm === undefined || algorithm?.startsWith('scrypt')
        ? scryptSync(password, salt, 64)
        : createHash('sha256')
            .update(password + salt)
            .digest();
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  /**
   * Should this row's credential be re-hashed after a successful login?
   *
   * True for every scheme that is not scrypt. The upgrade is what makes carrying
   * the legacy hashes forward safe: the account keeps working, and the weak hash
   * is replaced the first time its owner signs in — so nobody is asked to reset a
   * password they still know, and the scheme still disappears.
   */
  needsUpgrade(algorithm?: string | null): boolean {
    return !algorithm?.startsWith('scrypt');
  }
}
