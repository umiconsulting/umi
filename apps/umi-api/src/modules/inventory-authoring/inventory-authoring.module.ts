import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { InventoryCostingModule } from '../inventory-costing/inventory-costing.module';
import { InventoryAuthoringController } from './inventory-authoring.controller';
import { InventoryAuthoringRepository } from './inventory-authoring.repository';
import { InventoryAuthoringService } from './inventory-authoring.service';

/**
 * The console's inventory authoring surface (plan §11, phase 1).
 *
 * A module of its own rather than an extension of `pos-inventory`, and the reason
 * is a boundary rather than taste. `pos-inventory` IS the till's surface: its
 * controller is versioned, it authenticates a device and an operator session, and a
 * route the POS calls is always versioned because the POS is the client that lives
 * in the field on an old build. These routes are the opposite in every one of those
 * respects: a browser session, unversioned, and gated by a console permission.
 *
 * `IntegrityModule` is imported because every write is an administrative command
 * (plan D15), and the service exports so `AdministrativeCommandModule` can dispatch
 * its operations.
 *
 * `InventoryCostingModule` is imported for the recipe cost. The cost basis is the
 * quantity-weighted average of receipts, and it has ONE reader in this codebase; a
 * second read inside this module would be a second answer to the same question the day
 * a receipt arrives, and the plate cost and the costing view would disagree.
 */
@Module({
  imports: [AuthModule, IntegrityModule, InventoryCostingModule],
  controllers: [InventoryAuthoringController],
  providers: [InventoryAuthoringRepository, InventoryAuthoringService],
  exports: [InventoryAuthoringService],
})
export class InventoryAuthoringModule {}
