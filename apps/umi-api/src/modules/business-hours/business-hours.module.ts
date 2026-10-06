import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { BusinessHoursController } from './business-hours.controller';
import { BusinessHoursMerchantController } from './business-hours-merchant.controller';
import { BusinessHoursService } from './business-hours.service';
import { BusinessHoursRepository } from './business-hours.repository';
import { OrderingSettingsRepository } from './ordering-settings.repository';

/**
 * Business hours + ordering-window settings — the single canonical home shared
 * by the dashboard and the WhatsApp bot. Imports AuthModule (guards) and
 * MerchantsModule (effective-location resolution + timezone). Exports BusinessHoursService
 * (and the repos) so ConversationsModule can reuse them for the bot (DRY) instead
 * of re-querying merchant.open_hours / merchant.merchant.config.
 */
@Module({
  imports: [AuthModule, MerchantsModule],
  controllers: [BusinessHoursController, BusinessHoursMerchantController],
  providers: [BusinessHoursService, BusinessHoursRepository, OrderingSettingsRepository],
  exports: [BusinessHoursService, BusinessHoursRepository, OrderingSettingsRepository],
})
export class BusinessHoursModule {}
