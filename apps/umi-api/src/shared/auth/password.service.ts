import { Injectable } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing — preserves the dashboard's exact scrypt scheme so existing
 * `tenant.login` hashes verify without a forced reset (D9). The hash is
 * `scrypt(password, salt, 64)` hex; the salt is a 16-byte hex string. Both
 * columns (`password_salt`, `password_hash`) live in `tenant.login`.
 *
 * Ported verbatim from `apps/umi-dashboard/server.js`
 * (`hashLocalPassword`/`verifyLocalPassword`) — do not change the parameters
 * (keylen 64, hex encoding) or every stored hash breaks.
 */
@Injectable()
export class PasswordService {
  /** Derive a {salt, hash} pair for a new/changed password. */
  hash(password: string, salt: string = randomBytes(16).toString('hex')): {
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
   */
  verify(password: string, salt: string, expectedHashHex: string): boolean {
    if (!salt || !expectedHashHex) return false;
    let expected: Buffer;
    try {
      expected = Buffer.from(expectedHashHex, 'hex');
    } catch {
      return false;
    }
    const actual = scryptSync(password, salt, 64);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}
