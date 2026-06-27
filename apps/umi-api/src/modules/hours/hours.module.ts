import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { HoursController } from './hours.controller';
import { HoursTenantController } from './hours-tenant.controller';
import { HoursService } from './hours.service';
import { HoursRepository } from './hours.repository';
import { OrderingSettingsRepository } from './ordering-settings.repository';

/**
 * Business hours + ordering-window settings — the single canonical home shared
 * by the dashboard and the WhatsApp bot. Imports AuthModule (guards) and
 * TenantsModule (effective-location resolution + timezone). Exports HoursService
 * (and the repos) so ConversationsModule can reuse them for the bot (DRY) instead
 * of re-querying ops.business_hours / ops.businesses.config.
 */
@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [HoursController, HoursTenantController],
  providers: [HoursService, HoursRepository, OrderingSettingsRepository],
  exports: [HoursService, HoursRepository, OrderingSettingsRepository],
})
export class HoursModule {}
