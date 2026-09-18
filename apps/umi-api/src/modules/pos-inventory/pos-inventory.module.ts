import { Module } from '@nestjs/common';
import { OperationsModule } from '../../shared/operations/operations.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { InventoryAuthoringModule } from '../inventory-authoring/inventory-authoring.module';
import { PosInventoryController } from './pos-inventory.controller';
import { PosInventoryRepository } from './pos-inventory.repository';
import { PosInventoryService } from './pos-inventory.service';

@Module({
  // `InventoryCostingModule` is here for ONE read: the weighted-average receipt basis
  // that production rolls up (plan D5). A second basis read inside this module would be a
  // second answer to the same question the day a receipt arrives.
  // `OperationsModule` is imported explicitly, not because it is not `@Global()`, but to
  // name the metric registry in this module's own graph (the `tender.module.ts` reason).
  imports: [
    InventoryAuthoringModule,
    AuthModule,
    IntegrityModule,
    InventoryCostingModule,
    OperationsModule,
  ],
  controllers: [PosInventoryController],
  providers: [PosInventoryRepository, PosInventoryService],
  exports: [PosInventoryRepository, PosInventoryService],
})
export class PosInventoryModule {}
