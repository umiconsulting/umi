import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey } from 'node:crypto';
import http2 from 'node:http2';
import { SignJWT } from 'jose';
import type { AppConfig } from '../../shared/config/config.schema';
import { WalletPassRepository } from './wallet-pass.repository';

const APN_HOST = 'https://api.push.apple.com';
/** Apple rejects a provider token older than 1 hour; refresh before that. */
const TOKEN_TTL_MS = 50 * 60 * 1000;
const PUSH_TIMEOUT_MS = 10_000;
/** Cards pushed at the same time in a café-wide refresh. */
const PUSH_BATCH = 25;

/**
 * Tells a phone that its pass changed.
 *
 * The push body is empty. This push is only a signal. The device wakes, calls
 * `GET /v1/devices/.../registrations/...` to ask what changed, and then downloads
 * the pass again. The stamp count is not in the push, so a lost push causes a
 * delay and never a wrong number.
 *
 * HTTP/2 is necessary. Node's `fetch` uses HTTP/1.1 and Apple refuses it. This
 * service therefore uses `node:http2` and not the adapter style of this codebase.
 */
@Injectable()
export class ApplePushService {
  private readonly logger = new Logger(ApplePushService.name);
  private readonly keyId?: string;
  private readonly teamId?: string;
  private readonly topic: string;
  private readonly key: Buffer | null;
  private cached: { jwt: string; expiresAt: number } | null = null;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly repo: WalletPassRepository,
  ) {
    this.keyId = config.get('APPLE_APN_KEY_ID', { infer: true })?.trim();
    this.teamId = config.get('APPLE_TEAM_ID', { infer: true })?.trim();
    this.topic = (config.get('APPLE_PASS_TYPE_ID', { infer: true }) ?? '').trim();
    const raw = config.get('APPLE_APN_KEY', { infer: true });
    this.key = raw ? Buffer.from(raw, 'base64') : null;
  }

  isConfigured(): boolean {
    return !!this.key && !!this.keyId && !!this.teamId && !!this.topic;
  }

  /**
   * Push to every device registered for one card.
   *
   * Best-effort by contract: the caller has already committed a money or visit
   * write, and a failed push must never undo it. Nothing here throws.
   */
  async pushCard(cardId: string): Promise<{ sent: number; failed: number }> {
    if (!this.isConfigured()) {
      // WARN, not debug. A production log level does not print debug, so an
      // unconfigured APNs was invisible: every push returned "sent 0" and
      // nothing anywhere said why. The pass stays installed and stops updating,
      // which is the one failure mode of this module that no gate can see.
      this.logger.warn(`apn_not_configured card=${cardId}`);
      return { sent: 0, failed: 0 };
    }
    const token = await this.providerToken();
    if (!token) return { sent: 0, failed: 0 };

    const devices = await this.repo.pushTokensForCard(cardId);
    if (devices.length === 0) return { sent: 0, failed: 0 };

    // One card's devices go out together. Each push carries its own timeout, so
    // sending in series would make the worst case timeout × devices.
    const results = await Promise.all(devices.map((d) => this.send(token, d)));
    const sent = results.filter(Boolean).length;
    return { sent, failed: results.length - sent };
  }

  /**
   * Push every Apple pass at one café. A café-wide change starts this: the
   * reward config, the branding, or the promotion.
   *
   * ⚠️ THE TOUCH IS NECESSARY, and umi-cash omitted it.
   * `sendApplePushUpdateForTenant` sent a push but changed no `updated_at`. The
   * phone then asked what changed, got the answer "nothing", and downloaded
   * nothing. Each café-wide push from the reward-config screen and the settings
   * screen did nothing. `umi/push-passes` touched the rows first and was correct.
   *
   * The web service compares the card row against `passesUpdatedSince`. Touch the
   * rows first, then send the push.
   *
   * CONCURRENCY. The cards go out in batches. One café has more than 500 cards,
   * each push has a 10 second limit, and a caller waits for this. In series that
   * is more than an hour. The batch keeps the connection count to Apple small.
   */
  async pushMerchant(merchantId: string): Promise<{ cards: number; sent: number }> {
    if (!this.isConfigured()) return { cards: 0, sent: 0 };

    const cardIds = await this.repo.cardsWithApplePass(merchantId);
    if (cardIds.length === 0) return { cards: 0, sent: 0 };

    await this.repo.touchCards(cardIds);

    let sent = 0;
    for (let i = 0; i < cardIds.length; i += PUSH_BATCH) {
      const batch = cardIds.slice(i, i + PUSH_BATCH);
      const results = await Promise.all(batch.map((id) => this.pushCard(id)));
      sent += results.reduce((n, r) => n + r.sent, 0);
    }
    this.logger.log(
      `wallet_merchant_push merchant=${merchantId} cards=${cardIds.length} sent=${sent}`,
    );
    return { cards: cardIds.length, sent };
  }

  /** The ES256 provider token Apple wants in `authorization`. Cached ~50 min. */
  private async providerToken(): Promise<string | null> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.jwt;
    if (!this.key || !this.keyId || !this.teamId) return null;
    try {
      const jwt = await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
        .setIssuer(this.teamId)
        .setIssuedAt()
        .sign(createPrivateKey({ key: this.key, format: 'pem' }));
      this.cached = { jwt, expiresAt: Date.now() + TOKEN_TTL_MS };
      return jwt;
    } catch (err) {
      this.logger.error(`apn_token_sign_failed: ${String(err)}`);
      return null;
    }
  }

  private send(providerToken: string, pushToken: string): Promise<boolean> {
    return new Promise((resolve) => {
      const client = http2.connect(APN_HOST);
      let status = 0;
      let body = '';
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        client.close();
        resolve(ok);
      };

      client.on('error', (err) => {
        this.logger.warn(`apn_connection_error: ${err.message}`);
        finish(false);
      });

      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${pushToken}`,
        authorization: `bearer ${providerToken}`,
        'apns-topic': this.topic,
        'apns-push-type': 'background',
        'apns-priority': '5',
      });
      req.setTimeout(PUSH_TIMEOUT_MS, () => {
        this.logger.warn('apn_timeout');
        req.close();
        finish(false);
      });
      req.on('response', (headers) => {
        status = Number(headers[':status']);
      });
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('error', (err) => {
        this.logger.warn(`apn_request_error: ${err.message}`);
        finish(false);
      });
      req.on('end', () => {
        if (status !== 200) {
          // 410 BadDeviceToken means the customer deleted the pass. It is the
          // normal end of a registration, not a fault.
          this.logger.warn(`apn_push_rejected status=${status} ${body}`);
        }
        finish(status === 200);
      });
      req.end('{}');
    });
  }
}
