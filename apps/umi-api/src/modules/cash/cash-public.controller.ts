import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { PublicMerchantGuard, type PublicMerchant } from '../auth/public-merchant.guard';
import { PubMerchant } from '../auth/current-user.decorator';
import { resolveRewardProfile } from '../../shared/loyalty/reward-profile';
import { CashRepository } from './cash.repository';

@UseGuards(PublicMerchantGuard)
@Controller('api/:merchantRef')
export class CashPublicController {
  constructor(private readonly repo: CashRepository) {}

  @Get('config')
  async config(@PubMerchant() merchant: PublicMerchant) {
    const [row, locations, rewards] = await Promise.all([
      this.repo.branding(merchant.merchantId),
      this.repo.publicLocations(merchant.merchantId),
      this.repo.rewardProfileRows(merchant.merchantId, null),
    ]);
    if (!row) throw new NotFoundException({ error: 'Merchant no encontrado' });
    // Explicit fields keep internal settings out of this public response.
    return {
      id: row.id,
      slug: row.handle ?? row.id,
      name: row.name,
      timezone: row.timezone,
      city: row.city,
      cardPrefix: row.cardPrefix,
      topupEnabled: row.topupEnabled ?? false,
      selfRegistration: row.selfRegistration ?? false,
      multiSealEnabled: row.multiSealEnabled ?? false,
      passStyle: row.passStyle ?? 'default',
      birthdayRewardEnabled: row.birthdayRewardEnabled ?? false,
      birthdayRewardName: row.birthdayRewardName,
      primaryColor: row.primaryColor ?? '#B5605A',
      secondaryColor: row.secondaryColor,
      logoUrl: row.logoUrl,
      stripImageUrl: row.stripImageUrl,
      promoMessage: row.promoMessage,
      promoDays: row.promoDays,
      promoStartsAt: row.promoStartsAt,
      promoEndsAt: row.promoEndsAt,
      businessHours: row.businessHours,
      locations,
      rewardProfile: resolveRewardProfile(rewards.defaultConfig, null, rewards.upgradeConfig),
    };
  }
}
