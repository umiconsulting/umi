import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';
import { PointCredentialRepository } from './point-credential.repository';
import {
  PointOAuthError,
  refreshPointAuthorization,
  type PointOAuthTokenEndpoint,
} from './point-oauth';

/**
 * THE RENEWAL MARGIN, IN DAYS — decision D8, phase 5 step 2.
 *
 * Fourteen days is a POLICY and not a vendor number: the vendor publishes an expiry of 180 days
 * and no margin at all, so the window in which a failed renewal can still be noticed by a person
 * is ours to choose. Two weeks is long enough to survive a holiday and a broken alert, and short
 * enough that the token the job replaces is not one it just wrote.
 */
export const POINT_CREDENTIAL_RENEWAL_MARGIN_DAYS = 14;

/** How many cafés one run renews. The scan is ordered by expiry, so the batch is the most urgent. */
export const POINT_CREDENTIAL_RENEWAL_BATCH = 100;

/**
 * KEEPING EVERY CAFÉ'S TOKEN ALIVE — D8's "the OAuth lifecycle is a job, not a hope".
 *
 * WHY THIS IS A JOB AND NOT A RETRY ON THE CALL PATH. A token that expires does not fail loudly
 * at the moment it expires: the café discovers it when a customer is standing at the counter and
 * the till offers no card method, which is the worst possible time and the wrong person to tell.
 * The whole point of a margin is that the failure happens TWO WEEKS EARLIER, in a background run,
 * where there is time to tell the owner.
 *
 * THE FAILURE IS THE FEATURE, STATED PLAINLY. `recordRefreshFailure` writes the timestamp and
 * increments the counter, and `mpPoint.status` returns both — which is what the console renders
 * as "Conectado, con avisos" with the attempt count beside it. That is D8's owner-visible alert,
 * and it needs no second channel: the screen where the café connected the account is the screen
 * where it learns the account needs reconnecting.
 *
 * NOTHING HERE IS ALL-OR-NOTHING. One café's refused refresh must not stop the others, so each
 * credential is attempted, recorded and logged on its own; the run reports how many of each it
 * did. A credential whose envelope cannot be decrypted is one of those failures rather than an
 * exception that ends the sweep.
 */
@Injectable()
export class PointCredentialRenewalService {
  private readonly logger = new Logger(PointCredentialRenewalService.name);

  constructor(
    private readonly credentials: PointCredentialRepository,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** What one run did, which is what the job logs and what a test can assert. */
  async renewDue(
    marginDays: number = POINT_CREDENTIAL_RENEWAL_MARGIN_DAYS,
    batchSize: number = POINT_CREDENTIAL_RENEWAL_BATCH,
  ): Promise<{ checked: number; renewed: number; failed: number }> {
    const endpoint = this.tokenEndpoint();
    if (endpoint === null) {
      // A deployment with no OAuth application identity cannot renew anyone, and saying so once
      // per run is the honest answer: the alternative is a sweep that reports zeros forever
      // while the tokens it should be watching quietly age out.
      this.logger.warn(
        'mercado_pago_point_renewal_unconfigured: MERCADO_PAGO_POINT_CLIENT_ID/CLIENT_SECRET are not both set, so no credential can be renewed',
      );
      return { checked: 0, renewed: 0, failed: 0 };
    }

    const due = await this.credentials.dueForRenewal(marginDays, batchSize);
    let renewed = 0;
    let failed = 0;

    for (const credential of due) {
      if (credential.refreshToken === null) {
        // There is nothing to renew WITH. The row is reported as a failure on purpose: a token we
        // cannot renew is a café that will lose its card method, and the only fix is a person
        // authorizing again — which the console asks for precisely because this counter is up.
        await this.credentials.recordRefreshFailure(
          credential.merchantId,
          'no refresh token is stored, so the café must authorize again before the access token expires',
        );
        failed += 1;
        continue;
      }

      try {
        const tokens = await refreshPointAuthorization(endpoint, credential.refreshToken);
        await this.credentials.recordRefreshed({
          merchantId: credential.merchantId,
          // THE ACCOUNT IS NOT REBOUND BY A RENEWAL: the vendor returns the same `user_id`, and
          // `recordRefreshed` deliberately leaves `mp_user_id` alone rather than trusting a
          // second answer to a question that was settled at authorization.
          mpUserId: credential.mpUserId,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
        });
        renewed += 1;
      } catch (error) {
        failed += 1;
        await this.credentials.recordRefreshFailure(credential.merchantId, this.reasonOf(error));
      }
    }

    this.logger.log(
      `mercado_pago_point_credential_renewal checked=${due.length} renewed=${renewed} failed=${failed} marginDays=${marginDays}`,
    );
    return { checked: due.length, renewed, failed };
  }

  /**
   * WHAT WENT WRONG, IN WORDS THAT ARE SAFE TO KEEP.
   *
   * `PointOAuthError` messages are already redacted at the point they are built (the secret and
   * the refresh token never reach one), and an unexpected error is truncated the same way the
   * tender path truncates a provider failure. A renewal's reason is written to the LOG only —
   * `refresh_failed_at` has no message column, deliberately: a free-text vendor string kept
   * forever beside a credential is a string nobody audits.
   */
  private reasonOf(error: unknown): string {
    if (error instanceof PointOAuthError) return `${error.code} (status ${error.status})`;
    return error instanceof Error ? error.message.slice(0, 200) : 'the renewal failed';
  }

  /**
   * THE VENDOR'S TOKEN ENDPOINT, OR NULL WHEN THIS DEPLOYMENT HAS NO APPLICATION IDENTITY.
   *
   * Null rather than a throw, unlike the console's own `oauthConfig`: the console is answering a
   * person who asked for something, and a refusal is the right answer there. A background sweep
   * that threw would fill the dead-letter sink every night for a deployment that simply does not
   * offer third-party accounts.
   */
  private tokenEndpoint(): PointOAuthTokenEndpoint | null {
    const clientId = this.config.get('MERCADO_PAGO_POINT_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('MERCADO_PAGO_POINT_CLIENT_SECRET', { infer: true });
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      tokenUrl: this.config.get('MERCADO_PAGO_POINT_OAUTH_TOKEN_URL', { infer: true }),
    };
  }
}
