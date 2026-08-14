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
  exports: [PosCatalogService],
})
export class PosCatalogModule {}
