import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { IntegrityModule } from '../integrity/integrity.module';
import { PosEntryModule } from '../pos-entry/pos-entry.module';
import { TenderModule } from '../tender/tender.module';
import { PosExceptionController } from './pos-exception.controller';
import { PosExceptionRepository } from './pos-exception.repository';
import { PosExceptionService } from './pos-exception.service';

@Module({
  // FiscalModule is imported because VOIDING a committed sale cancels its CFDI in the same
  // command and the same transaction — see the reason written into `PosExceptionService`.
  // TenderModule is imported because a CARD tender's refund is asked of the terminal through
  // the tender path (plan §4 Phase 4): the money moves there, in its own command and with its
  // own attempt, before this module records that the sale gave anything back.
  imports: [AuthModule, IntegrityModule, PosEntryModule, FiscalModule, TenderModule],
  controllers: [PosExceptionController],
  providers: [PosExceptionRepository, PosExceptionService],
  exports: [PosExceptionService],
})
export class PosExceptionModule {}
