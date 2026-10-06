import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosCartModule } from '../pos-cart/pos-cart.module';
import { PosSaleController } from './pos-sale.controller';
import { PosSaleRepository } from './pos-sale.repository';
import { PosSaleService } from './pos-sale.service';

@Module({
  imports: [AuthModule, IntegrityModule, PosCartModule],
  controllers: [PosSaleController],
  providers: [PosSaleRepository, PosSaleService],
})
export class PosSaleModule {}
