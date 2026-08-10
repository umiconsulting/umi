import { Module } from '@nestjs/common';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosInventoryController } from './pos-inventory.controller';
import { PosInventoryRepository } from './pos-inventory.repository';
import { PosInventoryService } from './pos-inventory.service';

@Module({
  imports: [IntegrityModule],
  controllers: [PosInventoryController],
  providers: [PosInventoryRepository, PosInventoryService],
  exports: [PosInventoryRepository, PosInventoryService],
})
export class PosInventoryModule {}
