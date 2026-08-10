import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosInventoryController } from './pos-inventory.controller';
import { PosInventoryRepository } from './pos-inventory.repository';
import { PosInventoryService } from './pos-inventory.service';

@Module({
  imports: [AuthModule, IntegrityModule],
  controllers: [PosInventoryController],
  providers: [PosInventoryRepository, PosInventoryService],
  exports: [PosInventoryRepository, PosInventoryService],
})
export class PosInventoryModule {}
