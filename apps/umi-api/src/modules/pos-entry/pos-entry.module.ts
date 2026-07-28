import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PosEntryController } from './pos-entry.controller';
import { PosEntryRepository } from './pos-entry.repository';
import { PosEntryService } from './pos-entry.service';

@Module({
  imports: [AuthModule],
  controllers: [PosEntryController],
  providers: [PosEntryRepository, PosEntryService],
})
export class PosEntryModule {}
