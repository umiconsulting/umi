import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { StaffRepository } from './staff.repository';

/**
 * Staff & access domain. Imports AuthModule (guards) and TenantsModule
 * (location resolution for new staff rows).
 */
@Module({
  imports: [AuthModule, TenantsModule],
  controllers: [StaffController],
  providers: [StaffService, StaffRepository],
})
export class StaffModule {}
