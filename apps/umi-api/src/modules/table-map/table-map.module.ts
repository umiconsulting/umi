import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosTableMapController, TableMapController } from './table-map.controller';
import { TableMapRepository } from './table-map.repository';
import { TableMapService } from './table-map.service';

@Module({
  imports: [AuthModule, IntegrityModule],
  controllers: [TableMapController, PosTableMapController],
  providers: [TableMapRepository, TableMapService],
})
export class TableMapModule {}
