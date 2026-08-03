import { Module } from '@nestjs/common';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosEntryModule } from '../pos-entry/pos-entry.module';
import { PosExceptionController } from './pos-exception.controller';
import { PosExceptionRepository } from './pos-exception.repository';
import { PosExceptionService } from './pos-exception.service';

@Module({
  imports: [IntegrityModule, PosEntryModule],
  controllers: [PosExceptionController],
  providers: [PosExceptionRepository, PosExceptionService],
})
export class PosExceptionModule {}
