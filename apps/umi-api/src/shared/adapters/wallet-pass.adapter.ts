import { Injectable, Logger } from '@nestjs/common';
import { ApplePushService } from '../../modules/wallet/apple-push.service';
import { WalletPassService } from '../../modules/wallet/wallet-pass.service';

/**
 * Wallet-pass refresh, fired best-effort after every money or visit write so the
 * customer's pass updates on their lock screen.
 *
 * THIS USED TO BE AN HTTP CALL. The adapter POSTed a `cardId` at
 * `WALLET_PASS_PUSH_URL` and let umi-cash do the work, because umi-cash owned the
 * signing certificates and the pass tables. It was never configured in
 * production, so it logged and returned — every refresh was a no-op.
 *
 * The wallet layer now lives in this process, so the hop is gone: this calls
 * `ApplePushService` directly. One less network round trip on the write path, one
 * less secret to provision, and no way for the two halves to be pointed at
 * different databases.
 *
 * The contract is unchanged and is the reason this stays a thin seam: a money
 * write must succeed even when the push fails. Nothing here throws, and callers
 * must never await it inside their transaction.
 */
@Injectable()
export class WalletPassAdapter {
  private readonly logger = new Logger(WalletPassAdapter.name);

  constructor(
    private readonly push: ApplePushService,
    private readonly wallet: WalletPassService,
  ) {}

  /**
   * Refresh the wallet pass for a card after a balance or visit change.
   *
   * BOTH PLATFORMS, and they work in opposite directions. Apple gets a push that
   * makes the phone come and re-download the pass; Google gets a PATCH that
   * carries the new state to it. Neither may be skipped: a customer with an
   * Android pass is exactly as entitled to a correct stamp count.
   *
   * Resolves even on failure; never throws into the caller.
   */
  async refreshCard(cardId: string): Promise<void> {
    // Independent of each other — one platform failing must not silence the other.
    const [apple, google] = await Promise.allSettled([
      this.push.pushCard(cardId),
      this.wallet.refreshGoogleObject(cardId),
    ]);
    if (apple.status === 'fulfilled') {
      const { sent, failed } = apple.value;
      if (sent || failed) {
        this.logger.debug(`wallet_pass_refresh card=${cardId} sent=${sent} failed=${failed}`);
      }
    } else {
      // A second guard: pushCard also catches its own errors.
      this.logger.warn(`wallet_pass_refresh_failed card=${cardId}: ${String(apple.reason)}`);
    }
    if (google.status === 'rejected') {
      this.logger.warn(`google_object_refresh_failed card=${cardId}: ${String(google.reason)}`);
    }
  }

  /**
   * Refresh every pass at one café, after a change that alters what all of them
   * say — the reward config, the branding, the promotion.
   *
   * Same best-effort contract: a café must be able to rename its reward even when
   * Apple is unreachable.
   */
  async refreshMerchant(merchantId: string): Promise<void> {
    try {
      const { cards, sent } = await this.push.pushMerchant(merchantId);
      if (cards) {
        this.logger.debug(
          `wallet_merchant_refresh merchant=${merchantId} cards=${cards} sent=${sent}`,
        );
      }
    } catch (err) {
      this.logger.warn(`wallet_merchant_refresh_failed merchant=${merchantId}: ${String(err)}`);
    }
  }
}
