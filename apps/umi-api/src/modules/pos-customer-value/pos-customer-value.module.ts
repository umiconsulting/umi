import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosCustomerValueController } from './pos-customer-value.controller';
import { PosCustomerValueRepository } from './pos-customer-value.repository';
import { PosCustomerValueService } from './pos-customer-value.service';

@Module({
  imports: [AuthModule, IntegrityModule],
  controllers: [PosCustomerValueController],
  providers: [PosCustomerValueRepository, PosCustomerValueService],
  exports: [PosCustomerValueRepository, PosCustomerValueService],
})
export class PosCustomerValueModule {}
