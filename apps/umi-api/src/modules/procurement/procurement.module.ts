import { Global, Module } from '@nestjs/common';
import { OperationsModule } from '../../shared/operations/operations.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import {
  PurchaseOrderController,
  SupplierController,
  SupplierInvoiceController,
} from './procurement.controller';
import { ProcurementRepository } from './procurement.repository';
import { ProcurementService } from './procurement.service';

/**
 * Purchasing (plan §8E step 3, and the supplier invoice of plan §10). The controllers
 * live in one module because they are one workflow — a supplier is the party an order
 * points at, and a receipt is the order's own fact — so splitting them would put three
 * modules' worth of ceremony around one aggregate.
 *
 * THE MODULE IS GLOBAL, AND THE INVOICE COMMANDS ARE WHY. The console's one command
 * door dispatches `inventory.invoice.upload|match|commit` to `ProcurementService`, so
 * the provider must be resolvable from a module that does not import this one. A global
 * export is how that is done for three operations without a new module edge. It changes
 * RESOLUTION only, never authority: every call still passes the command policy, the
 * permission check and the purchasing journal it always did.
 */
@Global()
@Module({
  // Named here for the reason `tender.module.ts` gives: the module's own graph must
  // carry the metric registry, not rely on a global registration elsewhere.
  imports: [AuthModule, IntegrityModule, OperationsModule],
  controllers: [SupplierController, PurchaseOrderController, SupplierInvoiceController],
  providers: [ProcurementRepository, ProcurementService],
  exports: [ProcurementRepository, ProcurementService],
})
export class ProcurementModule {}
