import { Module } from '@nestjs/common';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosHardwareController } from './pos-hardware.controller';
import { PosHardwareRepository } from './pos-hardware.repository';
import { PosHardwareService } from './pos-hardware.service';

@Module({
  imports: [IntegrityModule],
  controllers: [PosHardwareController],
  providers: [PosHardwareRepository, PosHardwareService],
  exports: [PosHardwareService],
})
export class PosHardwareModule {}
