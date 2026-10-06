import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantsController } from './merchants.controller';
import { MerchantsService } from './merchants.service';
import { MerchantsRepository } from './merchants.repository';

/**
 * Merchant shell domain (switcher, capabilities, settings, locations). Imports
 * AuthModule for the guard chain (Auth → MerchantAccess → Entitlement).
 */
@Module({
  imports: [AuthModule],
  controllers: [MerchantsController],
  providers: [MerchantsService, MerchantsRepository],
  exports: [MerchantsService, MerchantsRepository],
})
export class MerchantsModule {}
