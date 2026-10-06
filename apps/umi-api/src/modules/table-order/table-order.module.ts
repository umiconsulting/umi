import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosCartModule } from '../pos-cart/pos-cart.module';
import { PosCatalogModule } from '../pos-catalog/pos-catalog.module';
import { TableOrderCredentialController } from './table-order-credential.controller';
import { TableOrderController } from './table-order.controller';
import { TableOrderRepository } from './table-order.repository';
import { TableOrderService } from './table-order.service';

/**
 * Table-order intake (§8I step 2, ADR 2026-09-13 §9).
 *
 * It imports `PosCartModule` and `PosCatalogModule` rather than re-declaring their
 * repositories, because THE REASON this module exists is that a guest is priced and
 * shown catalog by the SAME code the till uses. A second pricing path is precisely the
 * defect this design is built to avoid: it would let the guest's page and the till
 * disagree about what a dish costs, and the disagreement would only surface at the
 * counter.
 */
@Module({
  imports: [AuthModule, IntegrityModule, PosCartModule, PosCatalogModule],
  controllers: [TableOrderController, TableOrderCredentialController],
  providers: [TableOrderRepository, TableOrderService],
  exports: [TableOrderService],
})
export class TableOrderModule {}
