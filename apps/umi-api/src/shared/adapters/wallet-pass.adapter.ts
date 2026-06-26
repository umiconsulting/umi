import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';

/**
 * Wallet-pass refresh (Apple PassKit push + Google Wallet object update). umi-cash
 * fires these best-effort after every money write so the customer's pass updates
 * its balance/visits on the lock screen. The push is non-transactional: a money
 * write must succeed even if the pass refresh fails (exactly the live `.catch`
 * behavior), so callers never await this in their DB transaction.
 *
 * The Apple/Google push is cert/secret-bound (APN cert, Google service-account
 * key, the pass `webServiceURL`). Until those are provisioned in VPS secrets this
 * adapter logs the refresh request and returns; once configured it performs the
 * push. Either way the money write is complete and correct.
 */
@Injectable()
export class WalletPassAdapter {
  private readonly logger = new Logger(WalletPassAdapter.name);
  private readonly configured: boolean;

  constructor(config: ConfigService<AppConfig, true>) {
    this.configured = !!config.get('WALLET_PASS_PUSH_URL', { infer: true });
  }

  /**
   * Refresh the wallet pass for a card after a balance/visit change. Best-effort:
   * resolves even on failure, never throws into the caller's request/transaction.
   */
  async refreshCard(cardId: string): Promise<void> {
    if (!this.configured) {
      this.logger.debug(`wallet_pass_refresh_skipped card=${cardId} (push not configured)`);
      return;
    }
    try {
      await this.push(cardId);
    } catch (err) {
      // Mirror umi-cash: log and continue; the money write already committed.
      this.logger.warn(`wallet_pass_refresh_failed card=${cardId}: ${String(err)}`);
    }
  }

  private async push(cardId: string): Promise<void> {
    // Delegates to the pass push service (APN + Google Wallet) once wired. The
    // body is intentionally minimal — the push service re-reads card state.
    const url = this.urlOrThrow();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cardId }),
      // Bound the request — refreshCard() is awaited after the write commits, so a
      // hung push endpoint would otherwise stall the caller (matches zettle.adapter).
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`pass push ${res.status}`);
  }

  private urlOrThrow(): string {
    // configured === true guarantees this is set.
    return process.env.WALLET_PASS_PUSH_URL as string;
  }
}
