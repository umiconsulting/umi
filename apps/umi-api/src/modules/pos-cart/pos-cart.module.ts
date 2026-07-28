import { Module } from '@nestjs/common';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosCartController } from './pos-cart.controller';
import { PosCartRepository } from './pos-cart.repository';
import { PosCartService } from './pos-cart.service';

@Module({
  imports: [IntegrityModule],
  controllers: [PosCartController],
  providers: [PosCartRepository, PosCartService],
  exports: [PosCartRepository],
})
export class PosCartModule {}
