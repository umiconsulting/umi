import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PointAuthorization, PointCredentialStatus } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import type { AuthUser } from '../auth/auth.types';
import { PointCredentialRepository } from './point-credential.repository';
import {
  exchangePointAuthorizationCode,
  POINT_OAUTH_STATE_TTL_MS,
  PointOAuthError,
  pointAuthorizationUrl,
  signPointOAuthState,
  verifyPointOAuthState,
  type PointOAuthConfig,
} from './point-oauth';

/**
 * CONNECTING A MERCHANT TO MERCADO PAGO — Phase 5 steps 1 and 3, and decisions D7 and D8.
 *
 * WHY THIS EXISTS AT ALL. One credential serves one account, and Umi's clients are other
 * sellers: their money has to reach THEIR books (research note 08 §1). So the café's owner
 * authorizes Umi from the console, and the token that comes back is stored per merchant,
 * encrypted, and used when that merchant's card terminal is asked for money.
 *
 * THE FLOW, AND WHAT EACH STEP IS FOR.
 *   1. `authorize` signs a short-lived state naming the merchant and the operator, and hands the
 *      seller a URL. The state is what makes the callback safe: it is the only part of the
 *      return trip we minted, and the callback will not act without it.
 *   2. The seller approves at the vendor and comes back to the callback with `code` and `state`.
 *   3. `complete` verifies the state, exchanges the code for tokens, and stores them encrypted.
 *
 * IT NEVER THROWS FOR THE SELLER'S PROBLEM. A vendor refusal, a bad state and a stale
 * invitation all end in a REDIRECT back to the console with a reason on it — the seller is a
 * person in a browser at this point, and an API error page would be a dead end with no way back.
 * The one thing that throws is a deployment that has not been configured to connect anyone at
 * all, which the console needs to hear before it sends anyone to the vendor.
 */
@Injectable()
export class PointCredentialService {
  constructor(
    private readonly credentials: PointCredentialRepository,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Where to send the seller, and when that invitation stops being valid. */
  authorize(user: AuthUser, merchantId: string): PointAuthorization {
    const oauth = this.oauthConfig();
    const now = new Date();
    const state = signPointOAuthState({ merchantId, userId: user.id, now }, oauth.stateSecret);
    return {
      url: pointAuthorizationUrl(oauth, state),
      expiresAt: new Date(now.getTime() + POINT_OAUTH_STATE_TTL_MS).toISOString(),
    };
  }

  /**
   * The account and the token's health. `connected` is the only field that decides whether the
   * card terminal can be offered; the rest is what an owner needs to see it coming (D8).
   */
  async status(merchantId: string): Promise<PointCredentialStatus> {
    // A ROW IS NOT A CONNECTION. Unlinking erases the material and keeps the row — the
    // migration grants no DELETE, on purpose, so the café that links again is the same café —
    // which means `connected` has to be read from the cipher column's presence rather than
    // from the row's. Reading it the other way would leave a café the console still calls
    // connected with nothing behind it, which is exactly what an unlink is supposed to end.
    const meta = (await this.credentials.bound(merchantId))
      ? await this.credentials.meta(merchantId)
      : null;
    if (!meta) {
      return {
        connected: false,
        mpUserId: null,
        expiresAt: null,
        daysUntilExpiry: null,
        refreshFailedAt: null,
        refreshAttempts: 0,
      };
    }
    const expiresAt = meta.expiresAt;
    return {
      connected: true,
      mpUserId: meta.mpUserId,
      expiresAt: expiresAt?.toISOString() ?? null,
      // Floored, so "14 days left" never means twelve. The subtraction is done here rather
      // than on a screen, so two screens cannot disagree about the same token.
      daysUntilExpiry:
        expiresAt === null
          ? null
          : Math.floor((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      refreshFailedAt: meta.refreshFailedAt?.toISOString() ?? null,
      refreshAttempts: meta.refreshAttempts,
    };
  }

  /**
   * UNLINK THIS CAFÉ'S ACCOUNT.
   *
   * The operator's need is blunt and must be answerable from a screen: stop charging this
   * account. What it does NOT do is delete anything — the credential row is the café's
   * relationship with the vendor, the migration grants no DELETE for a reason, and
   * re-linking the same account is an update of the same row (`repository.revoke` states
   * the whole argument). The answer is the status AFTER the change rather than an
   * acknowledgement, so a console that has just unlinked renders the state it is actually in
   * instead of assuming one.
   */
  async disconnect(merchantId: string): Promise<PointCredentialStatus> {
    await this.credentials.revoke(merchantId);
    return this.status(merchantId);
  }

  /**
   * The seller came back. Returns the URL to send the BROWSER to next, always — the outcome
   * travels as a query parameter the console reads, never as an error page.
   */
  async complete(input: { code: string | null; state: string | null }): Promise<string> {
    const destination = this.dashboardDestination();
    let oauth: PointOAuthConfig;
    try {
      oauth = this.oauthConfig();
    } catch {
      // The deployment stopped being configured mid-flow. Nothing can be verified or stored, so
      // the seller is told plainly rather than shown a 500.
      return withOutcome(destination, 'unavailable', null);
    }
    const claims = input.state ? verifyPointOAuthState(input.state, oauth.stateSecret) : null;
    if (!claims) return withOutcome(destination, 'invalid_state', null);
    if (!input.code) return withOutcome(destination, 'missing_code', null);

    try {
      const tokens = await exchangePointAuthorizationCode(oauth, input.code);
      await this.credentials.store({
        merchantId: claims.merchantId,
        mpUserId: tokens.mpUserId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      });
      return withOutcome(destination, 'connected', null);
    } catch (error) {
      // The VENDOR'S code, not ours: "invalid_grant" and "invalid_client" mean different things
      // to whoever has to fix it, and neither is a token.
      const code = error instanceof PointOAuthError ? error.code : 'unknown';
      return withOutcome(destination, 'failed', code);
    }
  }

  /**
   * The application's identity to the vendor, or a refusal that says what is missing. Every
   * value is required: an OAuth flow with a missing client secret or no key to hold the token
   * under would fail at the vendor, in the seller's browser, with nothing to explain it.
   */
  private oauthConfig(): PointOAuthConfig {
    const clientId = this.config.get('MERCADO_PAGO_POINT_CLIENT_ID', { infer: true });
    const clientSecret = this.config.get('MERCADO_PAGO_POINT_CLIENT_SECRET', { infer: true });
    const redirectUri = this.config.get('MERCADO_PAGO_POINT_OAUTH_REDIRECT_URI', { infer: true });
    const stateSecret = this.config.get('MERCADO_PAGO_POINT_CREDENTIAL_KEY', { infer: true });
    const missing = [
      clientId ? null : 'MERCADO_PAGO_POINT_CLIENT_ID',
      clientSecret ? null : 'MERCADO_PAGO_POINT_CLIENT_SECRET',
      redirectUri ? null : 'MERCADO_PAGO_POINT_OAUTH_REDIRECT_URI',
      // The state is signed with the same key the credential is encrypted under: one secret
      // for "this deployment's Mercado Pago material", named as such, rather than a second
      // secret nobody would remember to rotate.
      stateSecret ? null : 'MERCADO_PAGO_POINT_CREDENTIAL_KEY',
    ].filter((name): name is string => name !== null);
    if (missing.length > 0) {
      throw new ConflictException({
        code: 'MP_POINT_OAUTH_UNAVAILABLE',
        details: { missing },
      });
    }
    return {
      clientId: clientId as string,
      clientSecret: clientSecret as string,
      redirectUri: redirectUri as string,
      authorizeUrl: this.config.get('MERCADO_PAGO_POINT_OAUTH_AUTHORIZE_URL', { infer: true }),
      tokenUrl: this.config.get('MERCADO_PAGO_POINT_OAUTH_TOKEN_URL', { infer: true }),
      stateSecret: stateSecret as string,
    };
  }

  /** Where the browser goes back to. The console, and nothing else. */
  private dashboardDestination(): string {
    const base = this.config.get('PUBLIC_DASHBOARD_URL', { infer: true }) ?? '';
    return `${base}/devices`;
  }
}

/**
 * The console's landing spot, with the outcome on it. The reason is a VENDOR code, never a
 * token and never the authorization code — those are credentials, and a query string is the
 * most logged part of any request.
 */
function withOutcome(destination: string, outcome: string, reason: string | null): string {
  const separator = destination.includes('?') ? '&' : '?';
  const base = `${destination}${separator}mpPoint=${encodeURIComponent(outcome)}`;
  return reason === null ? base : `${base}&code=${encodeURIComponent(reason)}`;
}
