import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { StaffController } from './staff.controller';
import { StaffMerchantController } from './staff-merchant.controller';
import { StaffService } from './staff.service';
import { StaffRepository } from './staff.repository';
import { MerchantRolesController } from './roles.controller';
import { RolesRepository } from './roles.repository';
import { RolesService } from './roles.service';

/**
 * Staff & access domain. Imports AuthModule (guards) and MerchantsModule
 * (location resolution for new staff rows).
 */
@Module({
  imports: [AuthModule, MerchantsModule],
  controllers: [StaffController, StaffMerchantController, MerchantRolesController],
  providers: [StaffService, StaffRepository, RolesService, RolesRepository],
})
export class StaffModule {}
