import { Module } from '@nestjs/common';
import { OperationsModule } from '../../shared/operations/operations.module';
import { AuthModule } from '../auth/auth.module';
import { InventoryCostingController } from './inventory-costing.controller';
import { InventoryCostingRepository } from './inventory-costing.repository';
import { InventoryCostingService } from './inventory-costing.service';

/**
 * The console's costing reads (plan §8E steps 5 and 6).
 *
 * A module of its own rather than an extension of `pos-inventory`, and the reason is
 * a boundary rather than taste. `pos-inventory` IS the till's surface: its controller
 * is versioned (`/api/v1/pos/...`), it authenticates a device and an operator session,
 * and the plan's fourth rule for this workstream is that a route the POS calls is
 * always versioned because the POS is the client that lives in the field on an old
 * build. These four reads are the opposite in every one of those respects: a browser
 * session, unversioned, and gated by a console permission. Putting them in the till's
 * module would mean the module's own documentation was false, and the next reader
 * would have to hold two contradictory rules about the same controller.
 *
 * It reads three modules' tables — procurement's receipts, inventory's ledger and
 * balances, and the catalogue — and writes none of them, so it declares no
 * dependencies beyond the database the platform already provides globally.
 */
@Module({
  // Named here for the reason `tender.module.ts` gives: the module's own graph must
  // carry the metric registry, not rely on a global registration elsewhere.
  imports: [AuthModule, OperationsModule],
  controllers: [InventoryCostingController],
  providers: [InventoryCostingRepository, InventoryCostingService],
  exports: [InventoryCostingService],
})
export class InventoryCostingModule {}
