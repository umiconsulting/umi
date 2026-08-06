import { Module } from '@nestjs/common';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosCustomerValueController } from './pos-customer-value.controller';
import { PosCustomerValueRepository } from './pos-customer-value.repository';
import { PosCustomerValueService } from './pos-customer-value.service';

@Module({
  imports: [IntegrityModule],
  controllers: [PosCustomerValueController],
  providers: [PosCustomerValueRepository, PosCustomerValueService],
  exports: [PosCustomerValueRepository],
})
export class PosCustomerValueModule {}
