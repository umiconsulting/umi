import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { FloorPlanController, PosFloorPlanController } from './floor-plan.controller';
import { FloorPlanRepository } from './floor-plan.repository';
import { FloorPlanService } from './floor-plan.service';

@Module({
  imports: [AuthModule, IntegrityModule],
  controllers: [FloorPlanController, PosFloorPlanController],
  providers: [FloorPlanRepository, FloorPlanService],
})
export class FloorPlanModule {}
