import { Module } from '@nestjs/common';
import { AdministrativeCommandContextService } from './administrative-command-context.service';
import { AdministrativeCommandRepository } from './administrative-command.repository';

@Module({
  providers: [AdministrativeCommandContextService, AdministrativeCommandRepository],
  exports: [AdministrativeCommandContextService],
})
export class AdministrativeCommandModule {}
