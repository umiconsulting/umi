import { Injectable } from '@nestjs/common';
import { ApplePushService } from '../modules/wallet/apple-push.service';
import { WalletPassService } from '../modules/wallet/wallet-pass.service';
import { WalletPassRepository } from '../modules/wallet/wallet-pass.repository';
@Injectable()
export class StampRewardExpiryWallet {
  constructor(
    private readonly repo: WalletPassRepository,
    private readonly apple: ApplePushService,
    private readonly google: WalletPassService,
  ) {}
  async refresh(cardId: string): Promise<boolean> {
    const [apple, google] = await Promise.allSettled([
      this.refreshApple(cardId),
      this.google.refreshGoogleObjectWithOutcome(cardId),
    ]);
    return (
      apple.status === 'fulfilled' && apple.value && google.status === 'fulfilled' && google.value
    );
  }
  private async refreshApple(cardId: string): Promise<boolean> {
    const devices = await this.repo.pushTokensForCard(cardId);
    if (!devices.length) return true;
    if (!this.apple.isConfigured()) return false;
    const result = await this.apple.pushCard(cardId);
    return result.failed === 0 && result.sent >= devices.length;
  }
}
