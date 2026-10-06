import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PosCatalogController } from './pos-catalog.controller';
import { PosCatalogRepository } from './pos-catalog.repository';
import { PosCatalogService } from './pos-catalog.service';
import { IntegrityModule } from '../integrity/integrity.module';

@Module({
  imports: [AuthModule, IntegrityModule],
  controllers: [PosCatalogController],
  providers: [PosCatalogRepository, PosCatalogService],
  // The repository is exported as well as the service: the PUBLIC table-order intake
  // (§8I step 2) must show a guest the same catalog the till reads, and it cannot go
  // through `PosCatalogService` — every method there authorizes an operator session,
  // and a guest has none. Reusing the repository keeps ONE availability-and-price
  // expression rather than a second one that would drift.
  exports: [PosCatalogService, PosCatalogRepository],
})
export class PosCatalogModule {}
