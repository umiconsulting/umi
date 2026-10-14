import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  MerchantBrandingLogoAssetController,
  MerchantBrandingLogoController,
} from './merchant-branding.controller';
import { MerchantBrandingLogoRepository } from './merchant-branding.repository';
import { MerchantBrandingLogoService } from './merchant-branding.service';

/**
 * The café's own logo (migration 014): the dashboard's upload and the public
 * asset route that serves it. Imports AuthModule for the guard chain — the asset
 * controller carries no guards, and does not need them.
 */
@Module({
  imports: [AuthModule],
  controllers: [MerchantBrandingLogoController, MerchantBrandingLogoAssetController],
  providers: [MerchantBrandingLogoService, MerchantBrandingLogoRepository],
  exports: [MerchantBrandingLogoService],
})
export class MerchantBrandingLogoModule {}
