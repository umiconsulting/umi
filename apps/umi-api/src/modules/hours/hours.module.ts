import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { HoursController } from './hours.controller';
import { HoursService } from './hours.service';
import { HoursRepository } from './hours.repository';

/**
 * Business hours domain. Imports AuthModule (guards) and TenantsModule
 * (effective-location resolution).
 */
@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [HoursController],
  providers: [HoursService, HoursRepository],
})
export class HoursModule {}
