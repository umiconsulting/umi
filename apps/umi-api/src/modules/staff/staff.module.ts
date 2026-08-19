import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { StaffController } from './staff.controller';
import { StaffMerchantController } from './staff-merchant.controller';
import { StaffService } from './staff.service';
import { StaffRepository } from './staff.repository';

/**
 * Staff & access domain. Imports AuthModule (guards) and MerchantsModule
 * (location resolution for new staff rows).
 */
@Module({
  imports: [AuthModule, MerchantsModule],
  controllers: [StaffController, StaffMerchantController],
  providers: [StaffService, StaffRepository],
})
export class StaffModule {}
