import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosHardwareController } from './pos-hardware.controller';
import { PosHardwareRepository } from './pos-hardware.repository';
import { PosHardwareService } from './pos-hardware.service';

@Module({
  imports: [AuthModule, IntegrityModule],
  controllers: [PosHardwareController],
  providers: [PosHardwareRepository, PosHardwareService],
  exports: [PosHardwareService],
})
export class PosHardwareModule {}
