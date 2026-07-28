import { Module } from '@nestjs/common';
import { PosOfflineController } from './pos-offline.controller';
import { PosOfflineRepository } from './pos-offline.repository';
import { PosOfflineService } from './pos-offline.service';

@Module({
  controllers: [PosOfflineController],
  providers: [PosOfflineRepository, PosOfflineService],
})
export class PosOfflineModule {}
