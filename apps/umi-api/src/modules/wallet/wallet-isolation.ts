import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../shared/config/config.schema';

/** Signing for test merchants is separate from delivery to installed wallets. */
export class WalletIsolation {
  readonly deliveryEnabled: boolean;
  private readonly merchants: Set<string>;

  constructor(config: ConfigService<AppConfig, true>) {
    this.deliveryEnabled = config.get('WALLET_MODE', { infer: true }) !== 'isolated';
    this.merchants = new Set(
      (config.get('WALLET_TEST_MERCHANT_IDS', { infer: true }) ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );
  }

  assertCanIssue(reference: string | null): void {
    if (!this.deliveryEnabled && (!reference || !this.merchants.has(reference))) {
      throw new ForbiddenException({ error: 'wallet_test_merchant_required' });
    }
  }
}
