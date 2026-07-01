import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { DiagnosticService } from './diagnostic.service';
import { SequencesService } from './sequences.service';
import { LeadsRepository } from './leads.repository';

/**
 * Landing-page leads (Phase 5, spec §7.3). Public contact/diagnostic/webhook
 * endpoints + the diagnostic-followup email sequence engine, backed by canonical
 * `grow.leads`/`grow.lead_events` via the worker pool. No imports needed:
 * PgService (DatabaseModule), EmailAdapter (AdaptersModule) and ConfigService are
 * all global. Exports SequencesService so the worker's LifecycleProcessor can run
 * the `email_sequence` tick (spec §10.1: lifecycle queue = cash crons + landing
 * email sequences).
 */
@Module({
  controllers: [LeadsController],
  providers: [LeadsService, DiagnosticService, SequencesService, LeadsRepository],
  exports: [SequencesService],
})
export class LeadsModule {}
