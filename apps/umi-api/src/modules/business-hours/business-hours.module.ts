import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { BusinessHoursController } from './business-hours.controller';
import { BusinessHoursTenantController } from './business-hours-tenant.controller';
import { BusinessHoursService } from './business-hours.service';
import { BusinessHoursRepository } from './business-hours.repository';
import { OrderingSettingsRepository } from './ordering-settings.repository';

/**
 * Business hours + ordering-window settings — the single canonical home shared
 * by the dashboard and the WhatsApp bot. Imports AuthModule (guards) and
 * TenantsModule (effective-location resolution + timezone). Exports BusinessHoursService
 * (and the repos) so ConversationsModule can reuse them for the bot (DRY) instead
 * of re-querying tenant.open_hours / tenant.business.config.
 */
@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [BusinessHoursController, BusinessHoursTenantController],
  providers: [BusinessHoursService, BusinessHoursRepository, OrderingSettingsRepository],
  exports: [BusinessHoursService, BusinessHoursRepository, OrderingSettingsRepository],
})
export class BusinessHoursModule {}
