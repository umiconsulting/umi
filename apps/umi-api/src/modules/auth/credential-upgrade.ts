import { Logger } from '@nestjs/common';
import type { AuthRepository } from './auth.repository';
import type { PasswordService } from '../../shared/auth/password.service';

const logger = new Logger('CredentialUpgrade');

/**
 * Re-hash a legacy credential to scrypt, keeping the same password.
 *
 * This is what lets the backfill carry `legacy-sha256-v1` rows forward instead of
 * force-resetting them: the account keeps working, its owner is never asked to do
 * anything, and the weak hash is gone from the moment they next sign in. The
 * scheme drains out of production one login at a time.
 *
 * ⚠️ CALL THIS ONLY AFTER THE PASSWORD VERIFIED. Re-hashing on a failed attempt
 * would write the WRONG password's hash over the right one and lock the owner
 * out permanently.
 *
 * NOT AWAITED, and it never throws outward. The caller has already authenticated
 * the user; a database hiccup during a background re-hash must not turn a good
 * login into a 500. A failure just means the row is upgraded on the next login.
 */
export function upgradeCredentialIfLegacy(
  repo: AuthRepository,
  passwords: PasswordService,
  credential: { userId: string; passwordAlgorithm: string | null },
  plaintext: string,
): void {
  if (!passwords.needsUpgrade(credential.passwordAlgorithm)) return;
  const next = passwords.hash(plaintext);
  void repo.upgradeCredential(credential.userId, next.salt, next.hash).catch((err: unknown) => {
    logger.warn(
      `credential_upgrade_failed user=${credential.userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  });
}
