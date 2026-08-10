import { Module } from '@nestjs/common';
import { AdministrativeCommandContextService } from './administrative-command-context.service';
import { AdministrativeCommandController } from './administrative-command.controller';
import { AdministrativeCommandExecutionService } from './administrative-command-execution.service';
import { AdministrativeCommandRepository } from './administrative-command.repository';
import { PosExceptionModule } from '../pos-exception/pos-exception.module';
import { PosInventoryModule } from '../pos-inventory/pos-inventory.module';
import { PosEntryModule } from '../pos-entry/pos-entry.module';
import { PosHardwareModule } from '../pos-hardware/pos-hardware.module';
import { PosCustomerValueModule } from '../pos-customer-value/pos-customer-value.module';
import { KdsModule } from '../kds/kds.module';
import { PosCatalogModule } from '../pos-catalog/pos-catalog.module';

@Module({
  imports: [
    KdsModule,
    PosCatalogModule,
    PosCustomerValueModule,
    PosEntryModule,
    PosExceptionModule,
    PosHardwareModule,
    PosInventoryModule,
  ],
  controllers: [AdministrativeCommandController],
  providers: [
    AdministrativeCommandContextService,
    AdministrativeCommandExecutionService,
    AdministrativeCommandRepository,
  ],
  exports: [AdministrativeCommandContextService],
})
export class AdministrativeCommandModule {}
